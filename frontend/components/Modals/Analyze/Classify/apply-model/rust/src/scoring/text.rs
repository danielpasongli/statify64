// Fitur Text Naive Bayes v2 (schema 2.0) untuk Apply Model — Fase A2.
//
// Kontrak: `naive-bayes/AGENTS_V2.md` §6 (rumus), §8 (schema 2.0), §10 (Apply
// Model v2) dan `plan-reports-v2/CATATAN_TAHAP2_negatif_dan_notscored.md`.
//
// PENGECUALIAN ATURAN SALIN P6 (AGENTS_V2.md V13): kode di berkas ini TIDAK
// menyalin tokenizer/stemmer/vectorizer/likelihood dari Naive Bayes. Semua
// matematika teks dipanggil dari crate `statify-text-core` (path dependency):
//   - jalur raw    : `statify_text_core::transform` dengan resep model;
//   - skor Text    : `statify_text_core::nb_text::score_rows` (P-V2, P-V3).
// Kode yang TETAP salinan dari NB v1 (`value_label.rs`, `log_gaussian_density`,
// `safe_ln` di `naive_bayes.rs`, `utils/error.rs`) tidak diubah.
//
// ATURAN BARIS MISSING (NotScored) ditentukan DI SINI, bukan oleh CORE
// (CATATAN_TAHAP2 §2; AGENTS_V2.md V11, §10.4):
//   - raw    : teks null / kosong / hanya whitespace = missing. Dokumen yang
//              ditransformasi tetap "" (vektor nol).
//   - vector : teks missing bila SEMUA kolom terpetakan bernilai null/non-finite
//              (atau tidak ada kolom terpetakan, atau baris tidak ada di payload).
//              Kolom model yang tidak terpetakan diisi 0 dan TIDAK dihitung
//              sebagai "ada nilai".
//   - Baris yang semua prediktornya missing (fitur Numeric/Categorical dan
//     Text) tidak diprediksi (NotScored). Bila masih ada prediktor lain, teks
//     missing = vektor nol dan baris tetap diskor (Multinomial/Complement: kontribusi 0;
//     Bernoulli: tetap Σ A_ct) — jangan diseragamkan dan jangan menambah filter
//     "baris nol". Complement hanya-Text dengan teks missing = NotScored (tidak
//     ada informasi), bukan skor 0.
//   - Nilai negatif pada kolom vektor terpetakan DITOLAK (`AM_E_TEXT_NEGATIVE`,
//     pesan menyebut nama kolom pertama + jumlah kolom bermasalah) sebelum
//     `score_rows` dipanggil. Nilai null/non-finite = 0 (bukan negatif).
use std::collections::HashSet;

use serde_json::{Map, Number, Value};
use statify_text_core::nb_text::{self, TextLikelihood, TextNbParams};
use statify_text_core::{transform, CsrMatrix, TextVectorizerModel};

use crate::models::payload::{TextPayload, TextValues};
use crate::scoring::TextRowInput;

type JsonObject = Map<String, Value>;

const SCHEMA_VERSION_V2: &str = "2.0";
/// Toleransi tanda bobot (`log_weights` ≤ 0 atau ≥ 0). Bobot di fixture dibulatkan 6 desimal.
const SIGN_TOLERANCE: f64 = 1e-9;

// ---------------------------------------------------------------------------
// Helper kecil
// ---------------------------------------------------------------------------

fn err(code: &str, detail: &str) -> String {
    format!("{}: {}", code, detail)
}

fn payload_error(detail: &str) -> String {
    err("AM_E_PAYLOAD", detail)
}

/// Teks nilai JSON untuk pesan error (string tanpa tanda kutip).
fn show(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn as_string_vec(value: &Value) -> Option<Vec<String>> {
    let array = value.as_array()?;
    array
        .iter()
        .map(|item| item.as_str().map(str::to_string))
        .collect()
}

fn has_duplicates(values: &[String]) -> bool {
    let unique: HashSet<&String> = values.iter().collect();
    unique.len() != values.len()
}

fn parse_likelihood(name: &str) -> Option<TextLikelihood> {
    match name {
        "multinomial" => Some(TextLikelihood::Multinomial),
        "bernoulli" => Some(TextLikelihood::Bernoulli),
        "complement" => Some(TextLikelihood::Complement),
        _ => None,
    }
}

pub fn likelihood_name(likelihood: TextLikelihood) -> &'static str {
    match likelihood {
        TextLikelihood::Multinomial => "multinomial",
        TextLikelihood::Bernoulli => "bernoulli",
        TextLikelihood::Complement => "complement",
    }
}

/// Model schema 2.0?
pub fn is_v2(root: &JsonObject) -> bool {
    root.get("schema_version").and_then(Value::as_str) == Some(SCHEMA_VERSION_V2)
}

/// Schema 2.0 dengan blok `text` yang bukan `null`. Blok `text` pada schema
/// 1.0/1.1 diabaikan (sama dengan adapter TS).
pub fn has_text_block(root: &JsonObject) -> bool {
    is_v2(root) && root.get("text").map_or(false, |value| !value.is_null())
}

/// Ubah bilangan float bernilai bulat (mis. `2.0`) menjadi bilangan bulat JSON
/// agar field bertipe `u32`/`usize` pada resep (`doc_freq`, `n_docs`,
/// `ngram_min`, ...) dapat dideserialisasi walau nilai tiba dari JS sebagai
/// float. Field bertipe f64 (mis. `idf`) tetap menerima bilangan bulat.
fn normalize_integers(value: &mut Value) {
    let replacement: Option<Value> = match value {
        Value::Number(number) => match number.as_f64() {
            Some(f)
                if number.is_f64() && f.is_finite() && f.fract() == 0.0 && f.abs() < 9.0e15 =>
            {
                Some(Value::Number(Number::from(f as i64)))
            }
            _ => None,
        },
        Value::Array(items) => {
            for item in items.iter_mut() {
                normalize_integers(item);
            }
            None
        }
        Value::Object(map) => {
            for (_, item) in map.iter_mut() {
                normalize_integers(item);
            }
            None
        }
        _ => None,
    };
    if let Some(new_value) = replacement {
        *value = new_value;
    }
}

/// Deserialisasi resep `TextVectorizerModel` (CORE §3.4) dari JSON model.
fn parse_recipe(value: &Value) -> Result<TextVectorizerModel, String> {
    let mut normalized = value.clone();
    normalize_integers(&mut normalized);
    serde_json::from_value::<TextVectorizerModel>(normalized)
        .map_err(|e| err("AM_E_NB2_TEXT_SOURCE", &format!("invalid recipe: {}", e)))
}

// ---------------------------------------------------------------------------
// Tipe model Text
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextSource {
    Raw,
    Vector,
}

impl TextSource {
    /// Teks yang sama dengan nilai `text.source` di JSON model / payload.
    pub fn as_str(&self) -> &'static str {
        match self {
            TextSource::Raw => "raw",
            TextSource::Vector => "vector",
        }
    }
}

/// Pembungkus resep supaya `TextModel`/`NaiveBayesScorer` tetap `PartialEq`
/// (`TextVectorizerModel` milik CORE tidak menurunkan `PartialEq`).
#[derive(Debug, Clone)]
pub struct RecipeHandle(pub TextVectorizerModel);

impl PartialEq for RecipeHandle {
    fn eq(&self, other: &Self) -> bool {
        self.0.recipe_version == other.0.recipe_version
            && self.0.vocabulary == other.0.vocabulary
            && self.0.idf == other.0.idf
            && self.0.doc_freq == other.0.doc_freq
            && self.0.n_docs == other.0.n_docs
            && self.0.avg_doc_norm == other.0.avg_doc_norm
            && self.0.resolved_stopwords == other.0.resolved_stopwords
    }
}

/// Parameter fitur Text model schema 2.0 (AGENTS_V2.md §8, blok `text`).
#[derive(Debug, Clone, PartialEq)]
pub struct TextModel {
    pub source: TextSource,
    /// Bobot per kelas (urutan `classes` model), siap dipakai `CORE::nb_text`.
    pub params: TextNbParams,
    /// Urutan indeks parameter (raw = `recipe.vocabulary`; vector = `columns`).
    pub terms: Vec<String>,
    pub raw_variable: Option<String>,
    pub columns: Option<Vec<String>>,
    pub recipe: Option<RecipeHandle>,
}

/// Hasil `TextModel::prepare` untuk seluruh baris (dihitung sekali per proses).
#[derive(Debug, Clone)]
pub struct TextScores {
    /// `[baris][kelas]` — kontribusi log Text TANPA `ln prior`.
    pub contributions: Vec<Vec<f64>>,
    /// Teks dihitung prediktor missing (K5/V11) per baris.
    pub missing: Vec<bool>,
    /// Jumlah kolom model yang diisi 0 karena tidak terpetakan (vector; raw = 0).
    pub zero_filled_columns: usize,
    /// Jumlah baris dengan teks kosong/null/whitespace (raw; vector = 0).
    pub empty_rows: u32,
}

impl TextScores {
    pub fn row(&self, row: usize) -> Option<TextRowInput<'_>> {
        let contribution = self.contributions.get(row)?;
        Some(TextRowInput {
            contribution: contribution.as_slice(),
            missing: self.missing.get(row).copied().unwrap_or(true),
        })
    }
}

// ---------------------------------------------------------------------------
// Validasi lapis kedua (AGENTS_V2.md §10.1) — port Rust dari langkah 12–13
// `adapters/naive-bayes-adapter.ts`, ditambah pemeriksaan konsistensi
// (`uses_class_prior`, tanda `log_weights`) yang belum ada di sisi TS.
// ---------------------------------------------------------------------------

/// Langkah 12 (khusus 2.0): `likelihood` per fitur Numeric/Categorical.
/// Fitur tanpa field `likelihood` dianggap `gaussian`/`categorical` (model 1.1 yang di-upgrade).
pub fn validate_feature_likelihoods(root: &JsonObject, errors: &mut Vec<String>) {
    if !is_v2(root) {
        return;
    }
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };

    for (index, item) in features.iter().enumerate() {
        let feature = match item.as_object() {
            Some(feature) => feature,
            None => continue,
        };
        let label = feature
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("features[{}]", index));
        let likelihood = feature.get("likelihood");

        match feature.get("role").and_then(Value::as_str) {
            Some("categorical") => {
                if let Some(value) = likelihood {
                    if value.as_str() != Some("categorical") {
                        errors.push(err(
                            "AM_E_NB2_LIKELIHOOD",
                            &format!("{}: {}", label, show(value)),
                        ));
                    }
                }
            }
            Some("numerical") => match likelihood {
                None => {}
                Some(value) => match value.as_str() {
                    Some("gaussian") => {}
                    Some("gaussian_minstd") => {
                        let valid = feature
                            .get("min_variance")
                            .and_then(Value::as_f64)
                            .map_or(false, |v| v.is_finite() && v > 0.0);
                        if !valid {
                            errors.push(err("AM_E_GAUSSIAN_INVALID", &label));
                        }
                    }
                    _ => errors.push(err(
                        "AM_E_NB2_LIKELIHOOD",
                        &format!("{}: {}", label, show(value)),
                    )),
                },
            },
            _ => {}
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Sign {
    NonPositive,
    NonNegative,
}

/// `obj[kelas]` harus larik sepanjang `expected_len` berisi bilangan finite
/// dengan tanda sesuai `sign`. Berhenti pada masalah pertama.
fn check_class_vectors(
    label: &str,
    object: Option<&Value>,
    classes: &[String],
    expected_len: usize,
    sign: Option<Sign>,
    errors: &mut Vec<String>,
) {
    let object = match object.and_then(Value::as_object) {
        Some(object) => object,
        None => {
            errors.push(err("AM_E_FIELD_TYPE", label));
            return;
        }
    };
    for class_name in classes {
        let vector = match object.get(class_name).and_then(Value::as_array) {
            Some(vector) => vector,
            None => {
                errors.push(err(
                    "AM_E_NB2_TEXT_SHAPE",
                    &format!("{}[{}]", label, class_name),
                ));
                return;
            }
        };
        if vector.len() != expected_len {
            errors.push(err(
                "AM_E_NB2_TEXT_SHAPE",
                &format!(
                    "{}[{}]: {} values, expected {}",
                    label,
                    class_name,
                    vector.len(),
                    expected_len
                ),
            ));
            return;
        }
        let all_finite = vector
            .iter()
            .all(|x| x.as_f64().map_or(false, f64::is_finite));
        if !all_finite {
            errors.push(err("AM_E_FIELD_TYPE", &format!("{}.{}", label, class_name)));
            return;
        }
        let sign_ok = vector.iter().filter_map(Value::as_f64).all(|x| match sign {
            Some(Sign::NonPositive) => x <= SIGN_TOLERANCE,
            Some(Sign::NonNegative) => x >= -SIGN_TOLERANCE,
            None => true,
        });
        if !sign_ok {
            errors.push(err(
                "AM_E_FIELD_TYPE",
                &format!("{}.{}: value signs do not match the likelihood", label, class_name),
            ));
            return;
        }
    }
}

/// Langkah 13 (khusus 2.0): blok `text`. Tidak melakukan apa pun bila tidak ada blok `text`.
pub fn validate_text_block(
    root: &JsonObject,
    classes: Option<&[String]>,
    errors: &mut Vec<String>,
) {
    if !has_text_block(root) {
        return;
    }
    let text = match root.get("text").and_then(Value::as_object) {
        Some(text) => text,
        None => {
            errors.push(err("AM_E_FIELD_TYPE", "text"));
            return;
        }
    };

    // --- source & likelihood ---
    let source = text.get("source").and_then(Value::as_str);
    if !matches!(source, Some("raw") | Some("vector")) {
        let shown = text
            .get("source")
            .map(show)
            .unwrap_or_else(|| "missing".to_string());
        errors.push(err("AM_E_NB2_TEXT_SOURCE", &format!("source={}", shown)));
    }
    let likelihood = text
        .get("likelihood")
        .and_then(Value::as_str)
        .and_then(parse_likelihood);
    if likelihood.is_none() {
        let shown = text
            .get("likelihood")
            .map(show)
            .unwrap_or_else(|| "missing".to_string());
        errors.push(err("AM_E_NB2_LIKELIHOOD", &format!("text: {}", shown)));
    }

    // --- alpha > 0 ---
    let alpha_ok = text
        .get("alpha")
        .and_then(Value::as_f64)
        .map_or(false, |a| a.is_finite() && a > 0.0);
    if !alpha_ok {
        errors.push(err("AM_E_PARAM_INVALID", "text.alpha"));
    }

    // --- uses_class_prior: tipe + konsistensi dengan likelihood dan K ---
    match text.get("uses_class_prior").and_then(Value::as_bool) {
        None => errors.push(err("AM_E_FIELD_TYPE", "text.uses_class_prior")),
        Some(flag) => {
            if let (Some(kind), Some(class_list)) = (likelihood, classes) {
                // Complement dengan K >= 2 = tanpa prior (§6.3); selain itu memakai prior.
                let expected = !(kind == TextLikelihood::Complement && class_list.len() >= 2);
                if flag != expected {
                    errors.push(err(
                        "AM_E_NB2_LIKELIHOOD",
                        &format!(
                            "text.uses_class_prior={} is inconsistent with likelihood {} and class count {} (expected {})",
                            flag,
                            likelihood_name(kind),
                            class_list.len(),
                            expected
                        ),
                    ));
                }
            }
        }
    }

    // --- Complement hanya sah bila model hanya berisi Text ---
    let has_other_features = root
        .get("features")
        .and_then(Value::as_array)
        .map_or(false, |features| !features.is_empty());
    if likelihood == Some(TextLikelihood::Complement) && has_other_features {
        errors.push(err(
            "AM_E_NB2_COMPLEMENT_MIXED",
            "a Complement model must not contain numeric/categorical features",
        ));
    }

    // --- terms ---
    let terms = match text.get("terms").and_then(as_string_vec) {
        Some(terms) => terms,
        None => {
            errors.push(err("AM_E_FIELD_TYPE", "text.terms"));
            return; // panjang acuan tidak ada
        }
    };
    if terms.is_empty() {
        errors.push(err("AM_E_NB2_TEXT_SHAPE", "text.terms: empty"));
        return;
    }
    if has_duplicates(&terms) {
        errors.push(err("AM_E_NB2_TEXT_SHAPE", "text.terms: contains duplicates"));
    }

    // --- sumber raw: raw_variable + recipe ---
    if source == Some("raw") {
        let raw_variable_ok = text
            .get("raw_variable")
            .and_then(Value::as_str)
            .map_or(false, |name| !name.is_empty());
        if !raw_variable_ok {
            errors.push(err("AM_E_NB2_TEXT_SOURCE", "raw source without raw_variable"));
        }
        match text.get("recipe").filter(|value| value.is_object()) {
            None => errors.push(err("AM_E_NB2_TEXT_SOURCE", "raw source without recipe")),
            Some(recipe_value) => match parse_recipe(recipe_value) {
                Err(message) => errors.push(message),
                Ok(recipe) => {
                    if recipe.vocabulary != terms {
                        errors.push(err(
                            "AM_E_NB2_TEXT_SHAPE",
                            "recipe.vocabulary differs from text.terms",
                        ));
                    }
                    if recipe.idf.len() != terms.len() {
                        errors.push(err("AM_E_NB2_TEXT_SHAPE", "recipe.idf"));
                    }
                    if recipe.doc_freq.len() != terms.len() {
                        errors.push(err("AM_E_NB2_TEXT_SHAPE", "recipe.doc_freq"));
                    }
                }
            },
        }
    }

    // --- sumber vector: columns sama dengan terms ---
    if source == Some("vector") {
        match text.get("columns").and_then(as_string_vec) {
            None => errors.push(err("AM_E_NB2_TEXT_SOURCE", "vector source without columns")),
            Some(columns) => {
                if columns != terms {
                    errors.push(err(
                        "AM_E_NB2_TEXT_SHAPE",
                        "text.columns differs from text.terms",
                    ));
                }
            }
        }
    }

    // --- parameter per kelas ---
    if let Some(class_list) = classes {
        // L_ct: Multinomial/Bernoulli = ln p <= 0; Complement = -ln θ̃ >= 0 (§6.1–6.3).
        let weight_sign = match likelihood {
            Some(TextLikelihood::Complement) => Some(Sign::NonNegative),
            Some(_) => Some(Sign::NonPositive),
            None => None,
        };
        check_class_vectors(
            "text.log_weights",
            text.get("log_weights"),
            class_list,
            terms.len(),
            weight_sign,
            errors,
        );
        check_class_vectors(
            "text.class_term_counts",
            text.get("class_term_counts"),
            class_list,
            terms.len(),
            Some(Sign::NonNegative),
            errors,
        );
        if likelihood == Some(TextLikelihood::Bernoulli) {
            // A_ct = ln(1 - p) <= 0, wajib hanya untuk Bernoulli.
            match text.get("log_weights_absent").filter(|value| !value.is_null()) {
                None => errors.push(err("AM_E_NB2_TEXT_SHAPE", "text.log_weights_absent")),
                Some(absent) => check_class_vectors(
                    "text.log_weights_absent",
                    Some(absent),
                    class_list,
                    terms.len(),
                    Some(Sign::NonPositive),
                    errors,
                ),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Ekstraksi (hanya setelah validasi lolos)
// ---------------------------------------------------------------------------

fn per_class_matrix(
    value: Option<&Value>,
    classes: &[String],
    path: &str,
) -> Result<Vec<Vec<f64>>, String> {
    let object = value
        .and_then(Value::as_object)
        .ok_or_else(|| err("AM_E_FIELD_TYPE", path))?;
    classes
        .iter()
        .map(|class_name| {
            let array = object
                .get(class_name)
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    err("AM_E_NB2_TEXT_SHAPE", &format!("{}[{}]", path, class_name))
                })?;
            array
                .iter()
                .map(|item| {
                    item.as_f64()
                        .ok_or_else(|| err("AM_E_FIELD_TYPE", &format!("{}.{}", path, class_name)))
                })
                .collect::<Result<Vec<f64>, String>>()
        })
        .collect()
}

/// Bangun `TextModel` dari JSON model; `Ok(None)` bila tidak ada blok `text`.
pub fn extract_text_model(
    root: &JsonObject,
    classes: &[String],
) -> Result<Option<TextModel>, String> {
    if !has_text_block(root) {
        return Ok(None);
    }
    let text = root
        .get("text")
        .and_then(Value::as_object)
        .ok_or_else(|| err("AM_E_FIELD_TYPE", "text"))?;

    let source = match text.get("source").and_then(Value::as_str) {
        Some("raw") => TextSource::Raw,
        Some("vector") => TextSource::Vector,
        other => {
            return Err(err(
                "AM_E_NB2_TEXT_SOURCE",
                &format!("source={}", other.unwrap_or("missing")),
            ));
        }
    };
    let likelihood = text
        .get("likelihood")
        .and_then(Value::as_str)
        .and_then(parse_likelihood)
        .ok_or_else(|| err("AM_E_NB2_LIKELIHOOD", "text"))?;
    let alpha = text
        .get("alpha")
        .and_then(Value::as_f64)
        .ok_or_else(|| err("AM_E_FIELD_TYPE", "text.alpha"))?;
    let uses_class_prior = text
        .get("uses_class_prior")
        .and_then(Value::as_bool)
        .ok_or_else(|| err("AM_E_FIELD_TYPE", "text.uses_class_prior"))?;
    let terms = text
        .get("terms")
        .and_then(as_string_vec)
        .ok_or_else(|| err("AM_E_FIELD_TYPE", "text.terms"))?;

    let log_weights = per_class_matrix(text.get("log_weights"), classes, "text.log_weights")?;
    let class_term_counts = per_class_matrix(
        text.get("class_term_counts"),
        classes,
        "text.class_term_counts",
    )?;
    let log_weights_absent = if likelihood == TextLikelihood::Bernoulli {
        Some(per_class_matrix(
            text.get("log_weights_absent"),
            classes,
            "text.log_weights_absent",
        )?)
    } else {
        None
    };

    let raw_variable = text
        .get("raw_variable")
        .and_then(Value::as_str)
        .map(str::to_string);
    let columns = text.get("columns").and_then(as_string_vec);
    let recipe = if source == TextSource::Raw {
        let recipe_value = text
            .get("recipe")
            .ok_or_else(|| err("AM_E_NB2_TEXT_SOURCE", "raw source without recipe"))?;
        Some(RecipeHandle(parse_recipe(recipe_value)?))
    } else {
        None
    };

    Ok(Some(TextModel {
        source,
        params: TextNbParams {
            likelihood,
            alpha,
            classes: classes.to_vec(),
            log_weights,
            log_weights_absent,
            class_term_counts,
            uses_class_prior,
        },
        terms,
        raw_variable,
        columns,
        recipe,
    }))
}

// ---------------------------------------------------------------------------
// Payload -> kontribusi skor (AGENTS_V2.md §10.3–10.4)
// ---------------------------------------------------------------------------

impl TextModel {
    /// Hitung kontribusi Text untuk `total_rows` baris. Baris yang tidak ada di
    /// payload diperlakukan sebagai teks missing (vektor nol).
    pub fn prepare(&self, payload: &TextPayload, total_rows: usize) -> Result<TextScores, String> {
        if payload.source != self.source.as_str() {
            return Err(payload_error(&format!(
                "the payload text source \"{}\" does not match the model text source \"{}\"",
                payload.source,
                self.source.as_str()
            )));
        }
        if total_rows == 0 {
            return Ok(TextScores {
                contributions: Vec::new(),
                missing: Vec::new(),
                zero_filled_columns: 0,
                empty_rows: 0,
            });
        }
        match self.source {
            TextSource::Raw => self.prepare_raw(payload, total_rows),
            TextSource::Vector => self.prepare_vector(payload, total_rows),
        }
    }

    fn prepare_raw(&self, payload: &TextPayload, total_rows: usize) -> Result<TextScores, String> {
        let values: &[Option<String>] = match &payload.values {
            TextValues::Raw(values) => values.as_slice(),
            TextValues::Vector(rows) if rows.is_empty() => &[],
            TextValues::Vector(_) => {
                return Err(payload_error(
                    "text.values for a raw source must be an array of strings/null",
                ));
            }
        };
        let recipe = self
            .recipe
            .as_ref()
            .ok_or_else(|| err("AM_E_NB2_TEXT_SOURCE", "raw source without recipe"))?;

        let mut docs: Vec<String> = Vec::with_capacity(total_rows);
        let mut missing: Vec<bool> = Vec::with_capacity(total_rows);
        let mut empty_rows: u32 = 0;
        for row in 0..total_rows {
            match values.get(row).and_then(|value| value.as_ref()) {
                Some(text) if !text.trim().is_empty() => {
                    docs.push(text.clone());
                    missing.push(false);
                }
                // null / kosong / whitespace: dokumen "" (vektor nol) + prediktor missing (V11).
                _ => {
                    docs.push(String::new());
                    missing.push(true);
                    empty_rows += 1;
                }
            }
        }

        // `transform` hanya MEMBACA resep (tidak menghitung ulang statistik apa pun).
        let matrix = transform(&recipe.0, &docs).map_err(|e| {
            err(
                "AM_E_NB2_TEXT_SOURCE",
                &format!("the text recipe cannot be used: {}", e),
            )
        })?;
        self.finish(matrix, missing, 0, empty_rows)
    }

    fn prepare_vector(
        &self,
        payload: &TextPayload,
        total_rows: usize,
    ) -> Result<TextScores, String> {
        let mapped: Vec<usize> = payload.mapped_columns.clone().unwrap_or_default();
        let n_terms = self.terms.len();
        let mut seen: HashSet<usize> = HashSet::new();
        for &index in &mapped {
            if index >= n_terms {
                return Err(payload_error(&format!(
                    "mapped_columns contains index {} outside the {} model columns",
                    index, n_terms
                )));
            }
            if !seen.insert(index) {
                return Err(payload_error(&format!(
                    "mapped_columns contains index {} more than once",
                    index
                )));
            }
        }

        let rows: &[Vec<Option<f64>>] = match &payload.values {
            TextValues::Vector(rows) => rows.as_slice(),
            TextValues::Raw(values) if values.is_empty() => &[],
            TextValues::Raw(_) => {
                return Err(payload_error(
                    "text.values for a vector source must be an array of arrays of numbers/null",
                ));
            }
        };
        for (row_index, row) in rows.iter().enumerate() {
            if row.len() != mapped.len() {
                return Err(payload_error(&format!(
                    "text.values[{}] has {} values, expected {} (aligned with mapped_columns)",
                    row_index,
                    row.len(),
                    mapped.len()
                )));
            }
        }

        // Nilai negatif ditolak SEBELUM scoring; hanya kolom terpetakan yang diperiksa
        // (kolom zero-filled tidak punya nilai).
        let mut negative = vec![false; mapped.len()];
        for row in rows {
            for (j, cell) in row.iter().enumerate() {
                if let Some(x) = cell {
                    if x.is_finite() && *x < 0.0 {
                        negative[j] = true;
                    }
                }
            }
        }
        if let Some(first) = negative.iter().position(|flag| *flag) {
            let total = negative.iter().filter(|flag| **flag).count();
            let names: &[String] = self
                .columns
                .as_deref()
                .unwrap_or(self.terms.as_slice());
            let name = names
                .get(mapped[first])
                .cloned()
                .unwrap_or_else(|| format!("column[{}]", mapped[first]));
            let detail = if total > 1 {
                format!("{} ({} columns affected)", name, total)
            } else {
                name
            };
            return Err(err("AM_E_TEXT_NEGATIVE", &detail));
        }

        // CSR: indeks kolom model menaik per baris (sama dengan urutan matriks NB).
        let mut order: Vec<usize> = (0..mapped.len()).collect();
        order.sort_by_key(|j| mapped[*j]);

        let mut indptr: Vec<usize> = Vec::with_capacity(total_rows + 1);
        indptr.push(0);
        let mut indices: Vec<u32> = Vec::new();
        let mut data: Vec<f64> = Vec::new();
        let mut missing: Vec<bool> = Vec::with_capacity(total_rows);
        for row_index in 0..total_rows {
            match rows.get(row_index) {
                Some(cells) => {
                    let mut has_value = false;
                    for &j in &order {
                        if let Some(Some(x)) = cells.get(j) {
                            if x.is_finite() {
                                has_value = true;
                                if *x != 0.0 {
                                    indices.push(mapped[j] as u32);
                                    data.push(*x);
                                }
                            }
                        }
                    }
                    missing.push(!has_value);
                }
                None => missing.push(true),
            }
            indptr.push(indices.len());
        }

        let matrix = CsrMatrix {
            n_rows: total_rows,
            n_cols: n_terms,
            indptr,
            indices,
            data,
        };
        self.finish(matrix, missing, n_terms - mapped.len(), 0)
    }

    /// Skor lewat `CORE::nb_text::score_rows` (satu-satunya implementasi likelihood Text).
    fn finish(
        &self,
        matrix: CsrMatrix,
        missing: Vec<bool>,
        zero_filled_columns: usize,
        empty_rows: u32,
    ) -> Result<TextScores, String> {
        if matrix.n_cols != self.terms.len() {
            return Err(err(
                "AM_E_NB2_TEXT_SHAPE",
                &format!(
                    "the text matrix has {} columns, expected {}",
                    matrix.n_cols,
                    self.terms.len()
                ),
            ));
        }
        let contributions = nb_text::score_rows(&self.params, &matrix);
        if contributions.len() != missing.len() {
            return Err(err(
                "AM_E_NB2_TEXT_SHAPE",
                &format!(
                    "the text scores have {} rows, expected {}",
                    contributions.len(),
                    missing.len()
                ),
            ));
        }
        Ok(TextScores {
            contributions,
            missing,
            zero_filled_columns,
            empty_rows,
        })
    }
}
