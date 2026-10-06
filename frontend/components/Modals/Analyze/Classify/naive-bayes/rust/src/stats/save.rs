// naive-bayes/rust/src/stats/save.rs
//
// PLAN.md Fase 16 item 1 — "Retrain model final, serialisasi JSON export".
//
// AGENTS.md §5.5 (titik paling gampang salah, ditegaskan ulang di kepala
// `stats/attribute_distribution.rs` Fase 15): model yang diekspor WAJIB
// hasil retrain di SELURUH dataset SETELAH proses validasi (holdout/k-fold)
// selesai dipakai murni untuk mengukur performa — bukan model dari satu
// fold/holdout tertentu. `retrain_final_model` di bawah TIDAK menerima
// parameter fold/subset apa pun (hanya `PreprocessedData` lengkap), sengaja
// supaya tidak ada jalan bagi kode ini untuk diam-diam dipanggil dengan
// subset data — sama pola dengan `attribute_distribution.rs` Fase 15.
// Pemanggil (`wasm::function::run_analysis`, Fase 16 item 2) yang
// bertanggung jawab memastikan model evaluasi (dipakai Model Evaluation
// Metrics/Confusion Matrix) dan model final di sini adalah DUA hasil
// training yang terpisah.
//
// `build_exported_model` menyerialisasi model final itu ke struktur JSON
// sesuai skema AGENTS.md §5.10 — NAMA FIELD DIJAGA PERSIS seperti yang
// didaftarkan di sana (dan seperti yang sudah dipakai sisi TypeScript sejak
// Fase 7/8, lihat `NaiveBayesTrainedModelRaw` di
// `naive-bayes-analysis-formatter.ts` serta stub
// `services/__fixtures__/naive-bayes-stub-result.json`): `schema_version`,
// `model_type`, `trained_at`, `target` (`name`/`classes`/`class_priors`),
// `features` (`name`/`role`/parameter distribusi), `smoothing_alpha`,
// `variance_floor`, `feature_order`, `label_mapping`, `validation_config`,
// `missing_value_policy`, `unseen_category_policy` — TIDAK ADA field yang
// diganti nama walau terasa lebih rapi secara teknis, karena ini kontrak
// file yang mungkin dipakai ulang pengguna (instruksi tugas Fase 16).
use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Serialize;
use statify_text_core::nb_text::{TextLikelihood as CoreTextLikelihood, TextNbParams};
use statify_text_core::TextVectorizerModel;

use crate::models::config::{NaiveBayesConfig, ValidationConfig};
use crate::models::data::{PredictorRole, PreprocessedData};

use super::training::{train_naive_bayes_model, TrainedModelParams};
use super::text_feature_table::likelihood_name;
use super::text_features::TrainedTextModel;

/// Deskripsi kebijakan missing-value (AGENTS.md §5.4), ditulis sebagai
/// metadata self-describing di file export (AGENTS.md §5.10: "developer
/// disarankan tetap mendokumentasikan hal ini secara terlihat oleh
/// pengguna"). Kebijakan ini FIXED (bukan dikonfigurasi pengguna — tab
/// Options hanya mengekspos `SmoothingAlpha`, AGENTS.md §4.1), jadi
/// deskripsinya konstan, bukan diturunkan dari
/// `OptionsConfig::missing_value_policy` (field itu sendiri nilainya
/// selalu `"exclude"` dari sisi TS, sekadar penanda internal — lihat
/// `constants/naive-bayes-default.ts` — bukan teks deskriptif untuk
/// pengguna akhir).
const MISSING_VALUE_POLICY_DESCRIPTION: &str = "Kategorik missing dianggap kategori '(Missing)'; numerik missing dikecualikan per-atribut untuk kelas terkait; target missing dibuang (listwise).";

/// Deskripsi kebijakan kategori tak dikenal (AGENTS.md §5.9), sama
/// alasannya dengan konstanta di atas (fixed, bukan dikonfigurasi
/// pengguna).
const UNSEEN_CATEGORY_POLICY_DESCRIPTION: &str = "Kategori tak dikenal pada evaluasi diberi probabilitas kecil melalui smoothing, bukan error.";

/// Skenario validasi apa adanya dari config (bentuk field sama persis
/// dengan `stats::case_summary::ValidationScenario` — didefinisikan
/// terpisah di sini, BUKAN dengan mengimpor/menambah `derive(Serialize)`
/// pada struct `case_summary.rs`, supaya file itu — bagian Fase 15 yang
/// sudah selesai & lulus test — tidak perlu disentuh sama sekali oleh
/// Fase 16 ini. Sedikit duplikasi logika kecil ini adalah trade-off
/// eksplisit untuk menjaga batas file per fase, dicatat di laporan
/// implementasi.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportValidationConfig {
    pub method: String,
    pub training_percentage: Option<f64>,
    pub holdout_percentage: Option<f64>,
    pub folds: Option<i32>,
    pub seed: Option<i64>,
}

/// Bangun `ExportValidationConfig` dari `ValidationConfig` payload —
/// logika identik `case_summary::compute_case_processing_summary`. Field
/// `ValidationConfig::training_percentage` (di-rename dari `holdout_percent`
/// pada perbaikan Fase 18 Temuan 1 — lihat catatan di kepala
/// `case_summary.rs`) diperlakukan APA ADANYA sebagai persentase training,
/// `holdout_percentage = 100 - training_percentage`.
pub fn export_validation_config(validation: &ValidationConfig) -> ExportValidationConfig {
    match validation.validation_method.as_str() {
        "kfold" => ExportValidationConfig {
            method: "kfold".to_string(),
            training_percentage: None,
            holdout_percentage: None,
            folds: Some(validation.k_folds),
            seed: validation.random_seed,
        },
        _ => {
            let training_percentage = validation.training_percentage;
            let holdout_percentage = 100.0 - training_percentage;
            ExportValidationConfig {
                method: "holdout".to_string(),
                training_percentage: Some(training_percentage),
                holdout_percentage: Some(holdout_percentage),
                folds: None,
                seed: validation.random_seed,
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportTarget {
    pub name: String,
    pub classes: Vec<String>,
    /// Sejajar index dengan `classes` (bukan map) — sesuai bentuk
    /// `NaiveBayesTrainedModelRaw::target::class_priors: number[]` di sisi
    /// TS.
    pub class_priors: Vec<f64>,
    /// AGENTS.md NB §5.10 schema 1.1 — dipakai Apply Model untuk kategori tak
    /// dikenal (§5.9). Jumlah baris training per kelas, sejajar index dengan
    /// `classes` (0 bila kelas tidak ada di `model.class_priors.class_counts`).
    pub class_counts: Vec<u64>,
}

/// Satu entri `features` (AGENTS.md §5.10: "daftar atribut dengan `name`,
/// `role` (`"categorical" | "numerical"`), dan parameter distribusinya").
/// `#[serde(untagged)]` supaya tiap varian serialize sebagai object JSON
/// polos (tanpa wrapper tag tambahan) — konsisten dengan bentuk union
/// `NaiveBayesCategoricalAttribute | NaiveBayesNumericalAttribute` di sisi
/// TS.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ExportFeature {
    Categorical {
        name: String,
        role: &'static str,
        categories: Vec<String>,
        /// class -> probabilitas per kategori (urutan sejajar
        /// `categories`), sudah termasuk hasil smoothing (AGENTS.md
        /// §5.10: "termasuk hasil smoothing").
        distribution: HashMap<String, Vec<f64>>,
        /// AGENTS.md NB §5.10 schema 1.1 — dipakai Apply Model untuk kategori
        /// tak dikenal (§5.9). class -> Σ `raw_count` kelas itu pada fitur ini
        /// (0 bila fitur/kelas tidak ada di model).
        class_totals: HashMap<String, u64>,
    },
    Numerical {
        name: String,
        role: &'static str,
        mean: HashMap<String, f64>,
        variance: HashMap<String, f64>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportedModel {
    pub schema_version: String,
    pub model_type: String,
    pub trained_at: String,
    pub target: ExportTarget,
    pub features: Vec<ExportFeature>,
    pub smoothing_alpha: f64,
    pub variance_floor: f64,
    /// Urutan fitur yang dipakai model (AGENTS.md §5.10: "untuk
    /// konsistensi bila model dipakai ulang") — SAMA dengan urutan
    /// `PreprocessedData::predictor_order` (urutan payload asli), juga
    /// dipakai `attribute_distribution.rs` Fase 15 untuk urutan baris
    /// tabel.
    pub feature_order: Vec<String>,
    /// class -> index (0-based, urutan `classes` yang sama dipakai di
    /// seluruh modul lain — alfabetis, `PreprocessedData::classes`).
    pub label_mapping: HashMap<String, i32>,
    pub validation_config: ExportValidationConfig,
    pub missing_value_policy: String,
    pub unseen_category_policy: String,
}

/// Retrain model Naive Bayes di SELURUH `preprocessed.cases` (AGENTS.md
/// §5.5) — dipanggil terpisah dari model(-model) yang dipakai evaluasi
/// holdout/k-fold di `wasm::function::run_analysis`. Fungsi ini sengaja
/// TIDAK menerima subset/fold apa pun sebagai parameter.
pub fn retrain_final_model(
    preprocessed: &PreprocessedData,
    config: &NaiveBayesConfig,
) -> TrainedModelParams {
    train_naive_bayes_model(
        &preprocessed.cases,
        &preprocessed.classes,
        &preprocessed.factor_names,
        &preprocessed.covariate_names,
        config.options.smoothing_alpha,
        config.options.variance_floor,
    )
}

/// Serialisasi model final (`retrain_final_model`) menjadi `ExportedModel`
/// sesuai skema AGENTS.md §5.10.
pub fn build_exported_model(
    preprocessed: &PreprocessedData,
    model: &TrainedModelParams,
    config: &NaiveBayesConfig,
) -> ExportedModel {
    let classes = &preprocessed.classes;

    let class_priors: Vec<f64> = classes
        .iter()
        .map(|class| *model.class_priors.priors.get(class).unwrap_or(&0.0))
        .collect();

    let class_counts: Vec<u64> = classes
        .iter()
        .map(|class| {
            model
                .class_priors
                .class_counts
                .get(class)
                .copied()
                .unwrap_or(0) as u64
        })
        .collect();

    let features: Vec<ExportFeature> = preprocessed
        .predictor_order
        .iter()
        .map(|(name, role)| build_export_feature(name, *role, model, classes))
        .collect();

    let label_mapping: HashMap<String, i32> = classes
        .iter()
        .enumerate()
        .map(|(idx, class)| (class.clone(), idx as i32))
        .collect();

    let feature_order: Vec<String> = preprocessed
        .predictor_order
        .iter()
        .map(|(name, _)| name.clone())
        .collect();

    ExportedModel {
        schema_version: "1.1".to_string(),
        model_type: "naive_bayes".to_string(),
        trained_at: now_iso8601(),
        target: ExportTarget {
            name: preprocessed.target_variable.clone(),
            classes: classes.clone(),
            class_priors,
            class_counts,
        },
        features,
        smoothing_alpha: config.options.smoothing_alpha,
        variance_floor: config.options.variance_floor,
        feature_order,
        label_mapping,
        validation_config: export_validation_config(&config.validation),
        missing_value_policy: MISSING_VALUE_POLICY_DESCRIPTION.to_string(),
        unseen_category_policy: UNSEEN_CATEGORY_POLICY_DESCRIPTION.to_string(),
    }
}

fn build_export_feature(
    name: &str,
    role: PredictorRole,
    model: &TrainedModelParams,
    classes: &[String],
) -> ExportFeature {
    match role {
        PredictorRole::Factor => {
            let distribution_source = model.categorical.get(name);
            let categories: Vec<String> = distribution_source
                .map(|dist| dist.categories.clone())
                .unwrap_or_default();

            let distribution: HashMap<String, Vec<f64>> = classes
                .iter()
                .map(|class| {
                    let probabilities = categories
                        .iter()
                        .map(|category| {
                            distribution_source
                                .and_then(|dist| dist.per_class.get(class))
                                .and_then(|per_class| per_class.get(category))
                                .map(|stat| stat.probability)
                                .unwrap_or(0.0)
                        })
                        .collect();
                    (class.clone(), probabilities)
                })
                .collect();

            let class_totals: HashMap<String, u64> = classes
                .iter()
                .map(|class| {
                    let total: usize = distribution_source
                        .and_then(|dist| dist.per_class.get(class))
                        .map(|per_class| per_class.values().map(|stat| stat.raw_count).sum())
                        .unwrap_or(0);
                    (class.clone(), total as u64)
                })
                .collect();

            ExportFeature::Categorical {
                name: name.to_string(),
                role: "categorical",
                categories,
                distribution,
                class_totals,
            }
        }
        PredictorRole::Covariate => {
            let params_source = model.gaussian.get(name);

            let mean: HashMap<String, f64> = classes
                .iter()
                .map(|class| {
                    let value = params_source
                        .and_then(|per_class| per_class.get(class))
                        .map(|params| params.mean)
                        .unwrap_or(0.0);
                    (class.clone(), value)
                })
                .collect();

            let variance: HashMap<String, f64> = classes
                .iter()
                .map(|class| {
                    let value = params_source
                        .and_then(|per_class| per_class.get(class))
                        .map(|params| params.variance)
                        .unwrap_or(0.0);
                    (class.clone(), value)
                })
                .collect();

            ExportFeature::Numerical {
                name: name.to_string(),
                role: "numerical",
                mean,
                variance,
            }
        }
    }
}

// =====================================================================
// Fase N4 (PLAN_V2 / AGENTS_V2 V8, §8) — export schema 2.0.
//
// ATURAN V8: model setara v1 (tanpa fitur Text DAN tanpa `gaussian_minstd`)
// WAJIB tetap diekspor sebagai schema `1.1` persis seperti sebelum v2 — itu
// sebabnya `build_exported_model` / `ExportedModel` / `ExportFeature` di atas
// TIDAK diubah sama sekali (P-V1; diuji snapshot di `tests_n4`). Selain itu
// schema `2.0` = struct 1.1 + `likelihood`/`min_variance` per fitur + blok
// `text` (`null` EKSPLISIT bila tanpa Text, bukan field yang hilang).
//
// Pemilihan versi ada di `build_export` (satu-satunya pintu masuk pemanggil):
// `export_requires_schema_2` memeriksa MODEL FINAL — ada `text` atau ada
// atribut Numeric ber-`gaussian_minstd` (`numeric_min_variance` tidak kosong).
//
// Export 2.0 harus lolos validasi lapis kedua Apply Model
// (`apply-model/rust/src/scoring/text.rs`): `terms` tidak kosong & unik,
// `recipe.vocabulary == terms` (raw), `columns == terms` (vector),
// `log_weights`/`class_term_counts` `[kelas][term]` finite, `log_weights_absent`
// wajib untuk Bernoulli, `uses_class_prior` konsisten, `min_variance > 0` untuk
// `gaussian_minstd`. Pemeriksaan serupa dilakukan di `build_export_text_parts`
// (galat `NB_E_TEXT_SHAPE`, tanpa `unwrap`) supaya file export yang rusak tidak
// pernah dihasilkan diam-diam.

/// Nilai `schema_version` export v2 (AGENTS_V2 §8).
pub const EXPORT_SCHEMA_V2: &str = "2.0";

/// Entri `features` schema 2.0: field 1.1 TIDAK berubah nama/arti, ditambah
/// `likelihood` (`"categorical"` / `"gaussian"` / `"gaussian_minstd"`) dan, untuk
/// Numeric, `min_variance` (`null` bila `gaussian`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ExportFeatureV2 {
    Categorical {
        name: String,
        role: &'static str,
        likelihood: &'static str,
        categories: Vec<String>,
        distribution: HashMap<String, Vec<f64>>,
        class_totals: HashMap<String, u64>,
    },
    Numerical {
        name: String,
        role: &'static str,
        likelihood: &'static str,
        mean: HashMap<String, f64>,
        /// Variance SETELAH min-std dan floor (AGENTS_V2 §8).
        variance: HashMap<String, f64>,
        /// `min_var` §6.4 untuk `gaussian_minstd`; `None` (JSON `null`) untuk `gaussian`.
        min_variance: Option<f64>,
    },
}

/// Blok `text` schema 2.0 (AGENTS_V2 §8). Peta per kelas memakai `BTreeMap`
/// supaya urutan kunci file export deterministik.
#[derive(Debug, Clone, Serialize)]
pub struct ExportText {
    /// `"raw"` atau `"vector"`.
    pub source: &'static str,
    /// `"multinomial"` / `"bernoulli"` / `"complement"`.
    pub likelihood: &'static str,
    pub alpha: f64,
    /// Urutan indeks parameter: raw = `recipe.vocabulary`; vector = nama kolom.
    pub terms: Vec<String>,
    /// Wajib (non-null) bila `source = "raw"`.
    pub raw_variable: Option<String>,
    /// Wajib (non-null, sama dengan `terms`) bila `source = "vector"`.
    pub columns: Option<Vec<String>>,
    /// `L_ct` per kelas.
    pub log_weights: BTreeMap<String, Vec<f64>>,
    /// `A_ct` per kelas; hanya Bernoulli (selain itu `null`).
    pub log_weights_absent: Option<BTreeMap<String, Vec<f64>>>,
    /// `N_ct` (Multinomial), `n_ct` (Bernoulli), `C_ct` (Complement).
    pub class_term_counts: BTreeMap<String, Vec<f64>>,
    /// `false` hanya Complement dengan K >= 2 (AGENTS_V2 §6.3).
    pub uses_class_prior: bool,
    /// Resep CORE hasil fit di SELURUH baris valid; wajib bila `source = "raw"`.
    pub recipe: Option<TextVectorizerModel>,
}

/// Struct export schema 2.0: seluruh field 1.1 + `text` (`null` bila tanpa Text).
#[derive(Debug, Clone, Serialize)]
pub struct ExportedModelV2 {
    pub schema_version: String,
    pub model_type: String,
    pub trained_at: String,
    pub target: ExportTarget,
    pub features: Vec<ExportFeatureV2>,
    pub smoothing_alpha: f64,
    pub variance_floor: f64,
    /// Hanya fitur Numeric/Categorical (Text disimpan di blok `text`).
    pub feature_order: Vec<String>,
    pub label_mapping: HashMap<String, i32>,
    pub validation_config: ExportValidationConfig,
    pub missing_value_policy: String,
    pub unseen_category_policy: String,
    pub text: Option<ExportText>,
}

/// Hasil export yang dipilih V8: `V1` (schema 1.1, struct lama) atau `V2`.
/// `untagged` -> JSON-nya persis bentuk struct di dalamnya (tanpa pembungkus).
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum ExportedModelAny {
    V1(ExportedModel),
    V2(ExportedModelV2),
}

impl ExportedModelAny {
    /// `"1.1"` atau `"2.0"`.
    pub fn schema_version(&self) -> &str {
        match self {
            ExportedModelAny::V1(model) => &model.schema_version,
            ExportedModelAny::V2(model) => &model.schema_version,
        }
    }
}

/// V8: `true` bila model final memerlukan schema 2.0 — ada fitur Text atau ada
/// atribut Numeric ber-`gaussian_minstd`. Gaussian biasa tanpa Text = `false`.
pub fn export_requires_schema_2(model: &TrainedModelParams) -> bool {
    model.text.is_some() || !model.numeric_min_variance.is_empty()
}

/// Periksa matriks `[kelas][term]`: jumlah baris = K, panjang baris = V, semua finite.
fn check_export_matrix(
    label: &str,
    matrix: &[Vec<f64>],
    n_classes: usize,
    n_terms: usize,
) -> Result<(), String> {
    if matrix.len() != n_classes {
        return Err(format!(
            "NB_E_TEXT_SHAPE: Model export: '{}' has {} class rows, but {} were expected.",
            label,
            matrix.len(),
            n_classes
        ));
    }
    for (class_idx, row) in matrix.iter().enumerate() {
        if row.len() != n_terms {
            return Err(format!(
                "NB_E_TEXT_SHAPE: Model export: '{}' for class {} has {} values, but {} were expected (one per term).",
                label,
                class_idx + 1,
                row.len(),
                n_terms
            ));
        }
        if row.iter().any(|value| !value.is_finite()) {
            return Err(format!(
                "NB_E_TEXT_SHAPE: Model export: '{}' for class {} contains values that are not finite numbers.",
                label,
                class_idx + 1
            ));
        }
    }
    Ok(())
}

/// Peta kelas -> baris matriks (urutan `classes` sejajar baris `matrix`).
fn matrix_by_class(classes: &[String], matrix: &[Vec<f64>]) -> BTreeMap<String, Vec<f64>> {
    classes
        .iter()
        .cloned()
        .zip(matrix.iter().cloned())
        .collect()
}

/// Susun blok `text` dari bagian-bagian model Text final (AGENTS_V2 §8).
///
///   - `recipe` + `raw_variable` terisi  -> sumber `raw` (`columns = null`);
///   - keduanya `None`                    -> sumber `vector` (`columns = terms`);
///   - kombinasi lain (resep tanpa nama variabel atau sebaliknya) -> galat.
///
/// Semua pemeriksaan bentuk mengembalikan `Err("NB_E_TEXT_SHAPE: ...")` (tanpa
/// panic/`unwrap`), bukan file export yang akan ditolak Apply Model.
pub fn build_export_text_parts(
    classes: &[String],
    params: &TextNbParams,
    terms: &[String],
    recipe: Option<&TextVectorizerModel>,
    raw_variable: Option<&str>,
) -> Result<ExportText, String> {
    let n_classes = classes.len();
    let n_terms = terms.len();

    if n_terms == 0 {
        return Err(
            "NB_E_TEXT_SHAPE: Model export: the text model has no terms.".to_string(),
        );
    }
    if params.classes != classes {
        return Err(
            "NB_E_TEXT_SHAPE: Model export: the class order of the text parameters differs from the target classes."
                .to_string(),
        );
    }
    let unique_terms: HashSet<&String> = terms.iter().collect();
    if unique_terms.len() != n_terms {
        return Err("NB_E_TEXT_SHAPE: Model export: the text term/column names are not unique.".to_string());
    }

    check_export_matrix("log_weights", &params.log_weights, n_classes, n_terms)?;
    check_export_matrix(
        "class_term_counts",
        &params.class_term_counts,
        n_classes,
        n_terms,
    )?;
    let log_weights_absent = match (params.likelihood, params.log_weights_absent.as_ref()) {
        (CoreTextLikelihood::Bernoulli, Some(absent)) => {
            check_export_matrix("log_weights_absent", absent, n_classes, n_terms)?;
            Some(matrix_by_class(classes, absent))
        }
        (CoreTextLikelihood::Bernoulli, None) => {
            return Err(
                "NB_E_TEXT_SHAPE: Model export: Bernoulli requires the log_weights_absent values."
                    .to_string(),
            );
        }
        _ => None,
    };

    let (source, raw_variable_out, columns, recipe_out) = match (recipe, raw_variable) {
        (Some(model), Some(name)) if !name.trim().is_empty() => {
            if model.vocabulary != terms {
                return Err(
                    "NB_E_TEXT_SHAPE: Model export: the preprocessing vocabulary differs from the model term list."
                        .to_string(),
                );
            }
            if model.idf.len() != n_terms || model.doc_freq.len() != n_terms {
                return Err(
                    "NB_E_TEXT_SHAPE: Model export: the IDF/document-frequency lengths of the preprocessing recipe do not match the number of terms."
                        .to_string(),
                );
            }
            ("raw", Some(name.to_string()), None, Some(model.clone()))
        }
        (Some(_), _) => {
            return Err(
                "NB_E_TEXT_SHAPE: Model export: a raw text source requires the Raw Text Variable name."
                    .to_string(),
            );
        }
        (None, None) => ("vector", None, Some(terms.to_vec()), None),
        (None, Some(_)) => {
            return Err(
                "NB_E_TEXT_SHAPE: Model export: a raw text source requires the fitted preprocessing recipe."
                    .to_string(),
            );
        }
    };

    Ok(ExportText {
        source,
        likelihood: likelihood_name(params.likelihood),
        alpha: params.alpha,
        terms: terms.to_vec(),
        raw_variable: raw_variable_out,
        columns,
        log_weights: matrix_by_class(classes, &params.log_weights),
        log_weights_absent,
        class_term_counts: matrix_by_class(classes, &params.class_term_counts),
        uses_class_prior: params.uses_class_prior,
        recipe: recipe_out,
    })
}

/// Padanan `build_export_text_parts` untuk `TrainedTextModel` (model final).
/// `raw_variable` = nama Raw Text Variable (`RawTextContext::variable`) — belum
/// disalin ke model oleh N3b, jadi pemanggil (`function.rs`) mengirimkannya.
pub fn build_export_text(
    classes: &[String],
    text: &TrainedTextModel,
    raw_variable: Option<&str>,
) -> Result<ExportText, String> {
    build_export_text_parts(
        classes,
        &text.params,
        &text.terms,
        text.recipe.as_ref(),
        raw_variable,
    )
}

/// Naikkan satu entri fitur 1.1 menjadi entri 2.0 (menambah `likelihood` dan
/// `min_variance`); isi field 1.1 dipakai apa adanya dari `build_export_feature`.
fn upgrade_feature(feature: ExportFeature, model: &TrainedModelParams) -> ExportFeatureV2 {
    match feature {
        ExportFeature::Categorical {
            name,
            role,
            categories,
            distribution,
            class_totals,
        } => ExportFeatureV2::Categorical {
            name,
            role,
            likelihood: "categorical",
            categories,
            distribution,
            class_totals,
        },
        ExportFeature::Numerical {
            name,
            role,
            mean,
            variance,
        } => {
            let min_variance = model.numeric_min_variance.get(&name).copied();
            let likelihood = if min_variance.is_some() {
                "gaussian_minstd"
            } else {
                "gaussian"
            };
            ExportFeatureV2::Numerical {
                name,
                role,
                likelihood,
                mean,
                variance,
                min_variance,
            }
        }
    }
}

/// Serialisasi model final menjadi export schema 2.0 (AGENTS_V2 §8). Bagian
/// 1.1 dibangun oleh `build_exported_model` (tidak diduplikasi); di sini hanya
/// ditambah `likelihood`/`min_variance` per fitur dan blok `text`.
pub fn build_exported_model_v2(
    preprocessed: &PreprocessedData,
    model: &TrainedModelParams,
    config: &NaiveBayesConfig,
    raw_variable: Option<&str>,
) -> Result<ExportedModelV2, String> {
    let base = build_exported_model(preprocessed, model, config);

    let features: Vec<ExportFeatureV2> = base
        .features
        .into_iter()
        .map(|feature| upgrade_feature(feature, model))
        .collect();

    let text = match model.text.as_ref() {
        Some(text_model) => Some(build_export_text(
            &preprocessed.classes,
            text_model,
            raw_variable,
        )?),
        None => None,
    };

    Ok(ExportedModelV2 {
        schema_version: EXPORT_SCHEMA_V2.to_string(),
        model_type: base.model_type,
        trained_at: base.trained_at,
        target: base.target,
        features,
        smoothing_alpha: base.smoothing_alpha,
        variance_floor: base.variance_floor,
        feature_order: base.feature_order,
        label_mapping: base.label_mapping,
        validation_config: base.validation_config,
        missing_value_policy: base.missing_value_policy,
        unseen_category_policy: base.unseen_category_policy,
        text,
    })
}

/// Pintu masuk export untuk pemanggil (`wasm::function::run_analysis`): memilih
/// schema 1.1 (struct lama, tidak berubah) atau 2.0 sesuai V8.
pub fn build_export(
    preprocessed: &PreprocessedData,
    model: &TrainedModelParams,
    config: &NaiveBayesConfig,
    raw_variable: Option<&str>,
) -> Result<ExportedModelAny, String> {
    if export_requires_schema_2(model) {
        build_exported_model_v2(preprocessed, model, config, raw_variable).map(ExportedModelAny::V2)
    } else {
        Ok(ExportedModelAny::V1(build_exported_model(
            preprocessed,
            model,
            config,
        )))
    }
}

/// Timestamp ISO 8601 UTC untuk `trained_at`. Mengikuti pola
/// `#[cfg(target_arch = "wasm32")]` yang SUDAH dipakai
/// `mersenne_twister.rs` (Fase 10) untuk sumber entropi: di build wasm32
/// (produksi lewat `wasm-pack`) memakai `js_sys::Date` (js-sys SUDAH jadi
/// dependency sejak Fase 8, TIDAK menambah dependency baru); di build
/// native (`cargo test`) memakai `std::time::SystemTime` + konversi
/// hari->tanggal manual (`civil_from_days`, algoritma Howard Hinnant, kode
/// publik domain, ditulis langsung di sini) — supaya crate ini TIDAK perlu
/// menambah dependency `chrono` (AGENTS.md §7 / batasan tugas: hindari
/// dependency baru tanpa alasan kuat) hanya untuk format timestamp yang
/// notabene hanya bernilai metadata.
#[cfg(target_arch = "wasm32")]
fn now_iso8601() -> String {
    js_sys::Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_seconds = duration.as_secs() as i64;
    let millis = duration.subsec_millis();

    let days = total_seconds.div_euclid(86400);
    let secs_of_day = total_seconds.rem_euclid(86400);
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, millis
    )
}

/// Konversi "hari sejak 1970-01-01" ke (tahun, bulan, hari) kalender
/// Gregorian proleptik — algoritma "civil_from_days" Howard Hinnant
/// (public domain, banyak direproduksi mis. di implementasi `<chrono>`
/// C++ standar), dipilih supaya `now_iso8601` di target native tidak perlu
/// dependency eksternal.
#[cfg(not(target_arch = "wasm32"))]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data::PreprocessedCase;
    use std::collections::HashMap as StdHashMap;

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn civil_from_days_matches_known_reference_dates() {
        // Epoch Unix: 1970-01-01.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 adalah hari ke-11017 sejak epoch (nilai referensi
        // yang umum dipakai untuk menguji algoritma Hinnant).
        assert_eq!(civil_from_days(11017), (2000, 3, 1));
        // 2024-02-29 (tahun kabisat) -> 1969-12-31 + N; dicek lewat
        // round-trip kasar: hari berikutnya harus 2024-03-01.
        // (19782 dihitung manual dari (2024-1970)*365 + leap days s.d.
        // 2024-02-29 = 19782.)
        assert_eq!(civil_from_days(19782), (2024, 2, 29));
        assert_eq!(civil_from_days(19783), (2024, 3, 1));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn now_iso8601_produces_well_formed_timestamp() {
        let ts = now_iso8601();
        // Format tetap: YYYY-MM-DDTHH:MM:SS.mmmZ (24 karakter).
        assert_eq!(ts.len(), 24);
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert!(ts.ends_with('Z'));
    }

    fn preprocessed_fixture() -> (PreprocessedData, TrainedModelParams) {
        let mut factors1 = StdHashMap::new();
        factors1.insert("Outlook".to_string(), "Sunny".to_string());
        let mut covariates1 = StdHashMap::new();
        covariates1.insert("Temp".to_string(), Some(70.0));

        let mut factors2 = StdHashMap::new();
        factors2.insert("Outlook".to_string(), "Rain".to_string());
        let mut covariates2 = StdHashMap::new();
        covariates2.insert("Temp".to_string(), Some(85.0));

        let cases = vec![
            PreprocessedCase {
                target_class: "Yes".to_string(),
                factors: factors1,
                covariates: covariates1,
            },
            PreprocessedCase {
                target_class: "No".to_string(),
                factors: factors2,
                covariates: covariates2,
            },
        ];

        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let preprocessed = PreprocessedData {
            total_instances: 2,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("Outlook".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ],
            factor_names: factor_names.clone(),
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };

        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        (preprocessed, model)
    }

    /// AGENTS.md §5.10: field inti WAJIB ada dan namanya dijaga stabil.
    /// Test ini menegaskan `build_exported_model` menghasilkan seluruh
    /// field itu, dengan bentuk yang sejajar dengan `class_priors`/
    /// `label_mapping`/`feature_order` (bukan hanya "ada", tapi konsisten
    /// urutan/isinya satu sama lain).
    #[test]
    fn exported_model_contains_all_required_fields_with_consistent_shape() {
        let (preprocessed, model) = preprocessed_fixture();
        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                // Fase 18 Temuan 1: field ini sekarang benar-benar
                // TrainingPercentage (dulu keliru diisi sebagai holdout%).
                // 70 di sini -> holdout_percentage turunan = 30 (lihat
                // assert di bawah), sama seperti sebelum perbaikan.
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: Some(42),
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        assert_eq!(exported.schema_version, "1.1");
        assert_eq!(exported.model_type, "naive_bayes");
        assert_eq!(exported.target.name, "Play");
        assert_eq!(exported.target.classes, vec!["No".to_string(), "Yes".to_string()]);
        assert_eq!(exported.target.class_priors.len(), 2);
        // Fixture 2 baris: No=1, Yes=1 (schema 1.1).
        assert_eq!(exported.target.class_counts, vec![1u64, 1u64]);
        assert_eq!(exported.feature_order, vec!["Outlook".to_string(), "Temp".to_string()]);
        assert_eq!(exported.features.len(), 2);
        assert_eq!(exported.smoothing_alpha, 1.0);
        assert_eq!(exported.variance_floor, 1e-9);
        assert_eq!(exported.label_mapping.get("No"), Some(&0));
        assert_eq!(exported.label_mapping.get("Yes"), Some(&1));
        assert_eq!(exported.validation_config.method, "holdout");
        assert_eq!(exported.validation_config.training_percentage, Some(70.0));
        assert_eq!(exported.validation_config.holdout_percentage, Some(30.0));
        assert_eq!(exported.validation_config.seed, Some(42));
        assert!(!exported.missing_value_policy.is_empty());
        assert!(!exported.unseen_category_policy.is_empty());

        match &exported.features[0] {
            ExportFeature::Categorical {
                name,
                role,
                categories,
                distribution,
                class_totals,
            } => {
                assert_eq!(name, "Outlook");
                assert_eq!(class_totals.len(), 2);
                assert_eq!(class_totals.get("No"), Some(&1u64));
                assert_eq!(class_totals.get("Yes"), Some(&1u64));
                assert_eq!(*role, "categorical");
                assert_eq!(categories.len(), 2); // "Rain", "Sunny"
                assert_eq!(distribution.len(), 2); // satu entri per kelas
                for probs in distribution.values() {
                    assert_eq!(probs.len(), categories.len());
                }
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }

        match &exported.features[1] {
            ExportFeature::Numerical { name, role, mean, variance } => {
                assert_eq!(name, "Temp");
                assert_eq!(*role, "numerical");
                assert_eq!(mean.len(), 2);
                assert_eq!(variance.len(), 2);
            }
            other => panic!("expected numerical feature, got {:?}", other),
        }
    }

    /// `class_priors` HARUS sejajar index dengan `target.classes`, bukan
    /// map — properti yang mudah rusak diam-diam kalau urutan berubah.
    #[test]
    fn class_priors_are_aligned_by_index_with_classes() {
        let (preprocessed, model) = preprocessed_fixture();
        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "kfold".to_string(),
                training_percentage: 30.0,
                k_folds: 5,
                random_seed: None,
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        for (idx, class) in exported.target.classes.iter().enumerate() {
            let expected = model.class_priors.priors[class];
            assert!((exported.target.class_priors[idx] - expected).abs() < 1e-12);
        }

        assert_eq!(exported.validation_config.method, "kfold");
        assert_eq!(exported.validation_config.folds, Some(5));
        assert_eq!(exported.validation_config.training_percentage, None);
        assert_eq!(exported.validation_config.seed, None);
    }

    /// Predictor yang tidak punya entri di model (kasus degenerate,
    /// seharusnya tidak terjadi di jalur normal) tidak boleh panic —
    /// fallback ke kategori/nilai kosong, bukan crash.
    #[test]
    fn missing_model_entry_for_predictor_does_not_panic() {
        let (mut preprocessed, model) = preprocessed_fixture();
        preprocessed
            .predictor_order
            .push(("Ghost".to_string(), PredictorRole::Factor));

        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 30.0,
                k_folds: 10,
                random_seed: None,
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);
        assert_eq!(exported.features.len(), 3);
        match &exported.features[2] {
            ExportFeature::Categorical { categories, distribution, class_totals, .. } => {
                assert!(categories.is_empty());
                assert_eq!(class_totals.len(), 2);
                assert_eq!(class_totals.get("No"), Some(&0u64));
                assert_eq!(class_totals.get("Yes"), Some(&0u64));
                assert_eq!(distribution.len(), 2);
                for probs in distribution.values() {
                    assert!(probs.is_empty());
                }
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }
    }

    /// Apply Model PLAN.md Fase 0 langkah 5: dataset 6-baris yang sama dengan
    /// `prediction.rs` tests (No=3, Yes=3) -> `class_counts == [3,3]` dan
    /// `class_totals == {No:3, Yes:3}` (Σ raw_count per kelas).
    #[test]
    fn class_counts_and_class_totals_match_training_counts() {
        fn case(target_class: &str, outlook: &str, temp: f64) -> PreprocessedCase {
            let mut factors = StdHashMap::new();
            factors.insert("Outlook".to_string(), outlook.to_string());
            let mut covariates = StdHashMap::new();
            covariates.insert("Temp".to_string(), Some(temp));
            PreprocessedCase {
                target_class: target_class.to_string(),
                factors,
                covariates,
            }
        }

        let cases = vec![
            case("Yes", "Sunny", 70.0),
            case("Yes", "Sunny", 72.0),
            case("Yes", "Rain", 74.0),
            case("No", "Sunny", 80.0),
            case("No", "Overcast", 82.0),
            case("No", "Overcast", 90.0),
        ];
        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let preprocessed = PreprocessedData {
            total_instances: 6,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("Outlook".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ],
            factor_names: factor_names.clone(),
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: Some(42),
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        assert_eq!(exported.schema_version, "1.1");
        assert_eq!(exported.target.class_counts, vec![3u64, 3u64]);
        match &exported.features[0] {
            ExportFeature::Categorical { class_totals, .. } => {
                let mut expected: HashMap<String, u64> = HashMap::new();
                expected.insert("No".to_string(), 3);
                expected.insert("Yes".to_string(), 3);
                assert_eq!(class_totals, &expected);
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }
    }
}

// =====================================================================
// Fase N4 — test export schema 1.1 (snapshot) dan 2.0.
//
// Modul terpisah dari `tests` di atas (yang tidak diubah) supaya ekspektasi
// test lama tetap utuh (P-V1).
// =====================================================================
#[cfg(test)]
mod tests_n4 {
    use super::*;
    use crate::models::config::{
        MainConfig, NumericLikelihood, OptionsConfig, OutputConfig,
        TextLikelihood as ConfigTextLikelihood,
    };
    use crate::models::data::PreprocessedCase;
    use crate::stats::numerical_distribution::NumericLikelihoodSpec;
    use crate::stats::text_features::TextTrainInput;
    use crate::stats::training::{train_naive_bayes_model, train_naive_bayes_model_v2};
    use serde_json::{json, Value};
    use statify_text_core::{CsrMatrix, TextVectorizerConfig};
    use std::collections::HashMap as StdHashMap;

    const TOL: f64 = 1e-6;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    fn close(actual: f64, expected: f64, context: &str) {
        assert!(
            (actual - expected).abs() < TOL,
            "{}: diperoleh {}, diharapkan {}",
            context,
            actual,
            expected
        );
    }

    fn num(value: &Value, context: &str) -> f64 {
        value
            .as_f64()
            .unwrap_or_else(|| panic!("{}: bukan angka: {}", context, value))
    }

    /// Bandingkan dua nilai JSON: struktur, kunci, string, bool, null PERSIS
    /// sama; angka dalam toleransi relatif 1e-12.
    fn assert_json_approx(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(a), Value::Number(e)) => {
                let (a, e) = (
                    a.as_f64().unwrap_or(f64::NAN),
                    e.as_f64().unwrap_or(f64::NAN),
                );
                assert!(
                    (a - e).abs() <= 1e-12 * e.abs().max(1.0),
                    "angka berbeda di {}: {} vs {}",
                    path,
                    a,
                    e
                );
            }
            (Value::Object(a), Value::Object(e)) => {
                let mut actual_keys: Vec<&String> = a.keys().collect();
                let mut expected_keys: Vec<&String> = e.keys().collect();
                actual_keys.sort();
                expected_keys.sort();
                assert_eq!(actual_keys, expected_keys, "kunci berbeda di {}", path);
                for (key, expected_value) in e {
                    assert_json_approx(&a[key], expected_value, &format!("{}.{}", path, key));
                }
            }
            (Value::Array(a), Value::Array(e)) => {
                assert_eq!(a.len(), e.len(), "panjang larik berbeda di {}", path);
                for (index, (actual_item, expected_item)) in a.iter().zip(e.iter()).enumerate() {
                    assert_json_approx(actual_item, expected_item, &format!("{}[{}]", path, index));
                }
            }
            _ => assert_eq!(actual, expected, "nilai berbeda di {}", path),
        }
    }

    fn config(method: &str) -> NaiveBayesConfig {
        NaiveBayesConfig {
            main: MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: method.to_string(),
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: Some(42),
            },
            output: OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        }
    }

    // ------------------------------------------------------------------
    // Fixture six_row_model (dataset 6 baris v1: Outlook + Temp, No=3, Yes=3).
    // ------------------------------------------------------------------

    fn six_row_case(target_class: &str, outlook: &str, temp: f64) -> PreprocessedCase {
        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), outlook.to_string());
        let mut covariates = StdHashMap::new();
        covariates.insert("Temp".to_string(), Some(temp));
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors,
            covariates,
        }
    }

    fn six_row_model() -> (PreprocessedData, TrainedModelParams) {
        let cases = vec![
            six_row_case("Yes", "Sunny", 70.0),
            six_row_case("Yes", "Sunny", 72.0),
            six_row_case("Yes", "Rain", 74.0),
            six_row_case("No", "Sunny", 80.0),
            six_row_case("No", "Overcast", 82.0),
            six_row_case("No", "Overcast", 90.0),
        ];
        let classes = strings(&["No", "Yes"]);
        let factor_names = strings(&["Outlook"]);
        let covariate_names = strings(&["Temp"]);
        let preprocessed = PreprocessedData {
            total_instances: 6,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("Outlook".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ],
            factor_names: factor_names.clone(),
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);
        (preprocessed, model)
    }

    /// Snapshot export v1 untuk six_row_model: nilai acuan dihitung terpisah
    /// (Python, population variance & smoothing alpha=1) dan identik dengan
    /// keluaran sebelum v2 — satu-satunya field yang berbeda antar-run adalah
    /// `trained_at` (dibuang sebelum membandingkan).
    fn six_row_snapshot_v1() -> Value {
        json!({
            "schema_version": "1.1",
            "model_type": "naive_bayes",
            "target": {
                "name": "Play",
                "classes": ["No", "Yes"],
                "class_priors": [0.5, 0.5],
                "class_counts": [3, 3]
            },
            "features": [
                {
                    "name": "Outlook",
                    "role": "categorical",
                    "categories": ["Overcast", "Rain", "Sunny"],
                    "distribution": {
                        "No": [0.5, 0.16666666666666666, 0.3333333333333333],
                        "Yes": [0.16666666666666666, 0.3333333333333333, 0.5]
                    },
                    "class_totals": {"No": 3, "Yes": 3}
                },
                {
                    "name": "Temp",
                    "role": "numerical",
                    "mean": {"No": 84.0, "Yes": 72.0},
                    "variance": {"No": 18.666666666666668, "Yes": 2.6666666666666665}
                }
            ],
            "smoothing_alpha": 1.0,
            "variance_floor": 1e-9,
            "feature_order": ["Outlook", "Temp"],
            "label_mapping": {"No": 0, "Yes": 1},
            "validation_config": {
                "method": "holdout",
                "training_percentage": 70.0,
                "holdout_percentage": 30.0,
                "folds": null,
                "seed": 42
            },
            "missing_value_policy": "Kategorik missing dianggap kategori '(Missing)'; numerik missing dikecualikan per-atribut untuk kelas terkait; target missing dibuang (listwise).",
            "unseen_category_policy": "Kategori tak dikenal pada evaluasi diberi probabilitas kecil melalui smoothing, bukan error."
        })
    }

    fn without_trained_at(mut value: Value) -> Value {
        let trained_at = value
            .as_object_mut()
            .and_then(|object| object.remove("trained_at"))
            .expect("export harus memuat trained_at");
        let text = trained_at.as_str().expect("trained_at string");
        assert_eq!(text.len(), 24, "format ISO 8601 UTC: {}", text);
        value
    }

    #[test]
    fn snapshot_export_v1_six_row_model_identik_kecuali_trained_at() {
        let (preprocessed, model) = six_row_model();
        let config = config("holdout");

        // Pintu masuk v2 (`build_export`) harus memilih schema 1.1 untuk model setara v1.
        assert!(!export_requires_schema_2(&model));
        let exported = build_export(&preprocessed, &model, &config, None).expect("export v1");
        assert_eq!(exported.schema_version(), "1.1");
        assert!(matches!(exported, ExportedModelAny::V1(_)));

        let actual = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));
        assert_json_approx(&actual, &six_row_snapshot_v1(), "$");

        // Tidak ada kunci/medan v2 yang bocor ke export 1.1.
        let object = actual.as_object().expect("object");
        assert!(!object.contains_key("text"));
        for feature in actual["features"].as_array().expect("features") {
            let feature = feature.as_object().expect("fitur");
            assert!(!feature.contains_key("likelihood"));
            assert!(!feature.contains_key("min_variance"));
        }

        // Dan sama persis dengan keluaran `build_exported_model` v1 langsung.
        let direct = without_trained_at(
            serde_json::to_value(build_exported_model(&preprocessed, &model, &config))
                .expect("serialisasi langsung"),
        );
        assert_json_approx(&actual, &direct, "$");
    }

    #[test]
    fn model_gaussian_biasa_lewat_jalur_v2_tanpa_text_tetap_schema_1_1() {
        let (preprocessed, _) = six_row_model();
        let model = train_naive_bayes_model_v2(
            &preprocessed.cases,
            &preprocessed.classes,
            &preprocessed.factor_names,
            &preprocessed.covariate_names,
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            None,
        )
        .expect("latih v2");
        assert!(!export_requires_schema_2(&model));

        let exported =
            build_export(&preprocessed, &model, &config("holdout"), None).expect("export");
        assert_eq!(exported.schema_version(), "1.1");
        let actual = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));
        assert_json_approx(&actual, &six_row_snapshot_v1(), "$");
    }

    // ------------------------------------------------------------------
    // Schema 2.0: gaussian_minstd memaksa 2.0; text = null eksplisit.
    // ------------------------------------------------------------------

    fn xy_case(target_class: &str, x: f64, y: f64) -> PreprocessedCase {
        let mut covariates = StdHashMap::new();
        covariates.insert("x".to_string(), Some(x));
        covariates.insert("y".to_string(), Some(y));
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors: StdHashMap::new(),
            covariates,
        }
    }

    /// Golden min-std AGENTS_V2 §6.7: x kelas A [1,1,1], kelas B [3,5]
    /// (precision 2, min_var 0.111111); `y` memakai Gaussian biasa.
    fn minstd_model() -> (PreprocessedData, TrainedModelParams) {
        let cases = vec![
            xy_case("A", 1.0, 1.0),
            xy_case("A", 1.0, 2.0),
            xy_case("A", 1.0, 3.0),
            xy_case("B", 3.0, 10.0),
            xy_case("B", 5.0, 20.0),
        ];
        let classes = strings(&["A", "B"]);
        let covariate_names = strings(&["x", "y"]);
        let preprocessed = PreprocessedData {
            total_instances: 5,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("x".to_string(), PredictorRole::Covariate),
                ("y".to_string(), PredictorRole::Covariate),
            ],
            factor_names: vec![],
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };
        let mut overrides = StdHashMap::new();
        overrides.insert("x".to_string(), NumericLikelihood::GaussianMinstd);
        let spec = NumericLikelihoodSpec {
            default: NumericLikelihood::Gaussian,
            overrides,
        };
        let model = train_naive_bayes_model_v2(
            &cases,
            &classes,
            &[],
            &covariate_names,
            1.0,
            1e-9,
            &spec,
            None,
        )
        .expect("latih min-std");
        (preprocessed, model)
    }

    #[test]
    fn gaussian_minstd_memaksa_schema_2_0_dengan_text_null_eksplisit() {
        let (preprocessed, model) = minstd_model();
        assert!(export_requires_schema_2(&model));

        let exported =
            build_export(&preprocessed, &model, &config("kfold"), None).expect("export 2.0");
        assert_eq!(exported.schema_version(), "2.0");
        assert!(matches!(exported, ExportedModelAny::V2(_)));

        let json = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));
        assert_eq!(json["schema_version"], "2.0");
        assert_eq!(json["model_type"], "naive_bayes");
        // `text` WAJIB ada sebagai null eksplisit (bukan kunci yang hilang).
        let object = json.as_object().expect("object");
        assert!(object.contains_key("text"), "kunci text harus ada");
        assert!(object["text"].is_null());
        // feature_order hanya Numeric/Categorical.
        assert_eq!(json["feature_order"], json!(["x", "y"]));

        let features = json["features"].as_array().expect("features");
        assert_eq!(features.len(), 2);
        // x: gaussian_minstd, min_variance (2/6)^2, variance SETELAH min-std.
        assert_eq!(features[0]["name"], "x");
        assert_eq!(features[0]["role"], "numerical");
        assert_eq!(features[0]["likelihood"], "gaussian_minstd");
        close(
            num(&features[0]["min_variance"], "min_variance"),
            0.111111,
            "min_variance x",
        );
        close(
            num(&features[0]["variance"]["A"], "var A"),
            0.111111,
            "variance A",
        );
        close(
            num(&features[0]["variance"]["B"], "var B"),
            1.0,
            "variance B",
        );
        close(num(&features[0]["mean"]["B"], "mean B"), 4.0, "mean B");
        // y: Gaussian biasa tetap punya likelihood dan min_variance = null.
        assert_eq!(features[1]["likelihood"], "gaussian");
        assert!(features[1]
            .as_object()
            .expect("fitur y")
            .contains_key("min_variance"));
        assert!(features[1]["min_variance"].is_null());
        // Field 1.1 tidak berubah nama.
        for key in ["name", "role", "mean", "variance"] {
            assert!(
                features[1].as_object().expect("fitur y").contains_key(key),
                "{}",
                key
            );
        }
        // Blok target/validation tetap bentuk 1.1.
        assert_eq!(json["target"]["class_counts"], json!([3, 2]));
        assert_eq!(json["validation_config"]["method"], "kfold");
    }

    #[test]
    fn fitur_categorical_di_schema_2_0_memuat_likelihood_categorical_dan_field_1_1() {
        // Model campuran: factor Outlook + covariate Temp (min-std) -> 2.0.
        let (preprocessed, _) = six_row_model();
        let spec = NumericLikelihoodSpec {
            default: NumericLikelihood::GaussianMinstd,
            overrides: StdHashMap::new(),
        };
        let model = train_naive_bayes_model_v2(
            &preprocessed.cases,
            &preprocessed.classes,
            &preprocessed.factor_names,
            &preprocessed.covariate_names,
            1.0,
            1e-9,
            &spec,
            None,
        )
        .expect("latih");
        let exported =
            build_export(&preprocessed, &model, &config("holdout"), None).expect("export 2.0");
        let json = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));

        let outlook = &json["features"][0];
        assert_eq!(outlook["likelihood"], "categorical");
        assert_eq!(outlook["categories"], json!(["Overcast", "Rain", "Sunny"]));
        assert_eq!(outlook["class_totals"], json!({"No": 3, "Yes": 3}));
        assert_eq!(
            outlook["distribution"]["Yes"]
                .as_array()
                .map(|values| values.len()),
            Some(3)
        );
        // Temp: [80,82,90] & [70,72,74] -> min-std berlaku; variance >= min_variance.
        let temp = &json["features"][1];
        assert_eq!(temp["likelihood"], "gaussian_minstd");
        let min_variance = num(&temp["min_variance"], "min_variance Temp");
        assert!(min_variance > 0.0);
        for class in ["No", "Yes"] {
            assert!(num(&temp["variance"][class], "variance Temp") >= min_variance - 1e-12);
        }
        assert!(json["text"].is_null());
    }

    // ------------------------------------------------------------------
    // Schema 2.0 dengan Text (golden AGENTS_V2 §6.7).
    // ------------------------------------------------------------------

    fn text_only_data() -> PreprocessedData {
        let cases: Vec<PreprocessedCase> = ["pos", "neg", "pos"]
            .iter()
            .map(|target| PreprocessedCase {
                target_class: target.to_string(),
                factors: StdHashMap::new(),
                covariates: StdHashMap::new(),
            })
            .collect();
        PreprocessedData {
            total_instances: 3,
            excluded_target_missing: 0,
            target_variable: "Class".to_string(),
            predictor_order: vec![],
            factor_names: vec![],
            covariate_names: vec![],
            classes: strings(&["neg", "pos"]),
            cases,
        }
    }

    fn weka_cfg() -> TextVectorizerConfig {
        TextVectorizerConfig::from_json_value(json!({
            "lowercase": true,
            "stemming_method": "none",
            "stopwords_method": "none",
            "custom_stopwords": null,
            "delimiters": r#"[\s.,;:'"()?!]+"#,
            "ngram_min": 1,
            "ngram_max": 1,
            "formula_standard": "weka",
            "tf_method": "raw",
            "idf_method": "none",
            "normalization": "none",
            "words_to_keep": 1000,
            "min_term_freq": 1
        }))
        .expect("config Weka default valid")
    }

    fn golden_docs() -> Vec<String> {
        strings(&[
            "Saya suka makan nasi",
            "Saya tidak suka nasi!",
            "Makan, makan, makan",
        ])
    }

    fn golden_dense_matrix() -> CsrMatrix {
        let rows: Vec<Vec<f64>> = vec![
            vec![1.0, 1.0, 1.0, 1.0, 0.0],
            vec![0.0, 1.0, 1.0, 1.0, 1.0],
            vec![3.0, 0.0, 0.0, 0.0, 0.0],
        ];
        let mut indptr = vec![0usize];
        let mut indices = Vec::new();
        let mut data = Vec::new();
        for row in &rows {
            for (col, &value) in row.iter().enumerate() {
                if value != 0.0 {
                    indices.push(col as u32);
                    data.push(value);
                }
            }
            indptr.push(indices.len());
        }
        CsrMatrix {
            n_rows: rows.len(),
            n_cols: 5,
            indptr,
            indices,
            data,
        }
    }

    fn golden_terms() -> Vec<String> {
        strings(&["makan", "nasi", "saya", "suka", "tidak"])
    }

    fn train_text_only(
        likelihood: ConfigTextLikelihood,
        x: &CsrMatrix,
        terms: &[String],
    ) -> (PreprocessedData, TrainedModelParams) {
        let data = text_only_data();
        let input = TextTrainInput {
            x,
            terms,
            likelihood,
            alpha: 1.0,
        };
        let model = train_naive_bayes_model_v2(
            &data.cases,
            &data.classes,
            &[],
            &[],
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        )
        .expect("latih Text");
        (data, model)
    }

    /// Model final jalur raw: resep di-fit pada 3 dokumen golden (seperti
    /// `retrain_final_model_v2` mengisi `recipe`).
    fn raw_golden_model(
        likelihood: ConfigTextLikelihood,
    ) -> (PreprocessedData, TrainedModelParams) {
        let (recipe, x) =
            statify_text_core::fit_transform(&golden_docs(), &weka_cfg()).expect("fit golden");
        assert_eq!(recipe.vocabulary, golden_terms());
        let terms = recipe.vocabulary.clone();
        let (data, mut model) = train_text_only(likelihood, &x, &terms);
        if let Some(text) = model.text.as_mut() {
            text.recipe = Some(recipe);
        }
        (data, model)
    }

    /// Proksi validasi lapis kedua Apply Model (`apply-model/rust/src/scoring/text.rs`
    /// langkah 13): export 2.0 yang lolos di sini juga lolos di sana.
    fn assert_am_text_block_valid(text: &Value, classes: &[&str], other_features: usize) {
        let terms: Vec<String> = text["terms"]
            .as_array()
            .expect("terms larik")
            .iter()
            .map(|term| term.as_str().expect("term string").to_string())
            .collect();
        assert!(!terms.is_empty());
        let unique: HashSet<&String> = terms.iter().collect();
        assert_eq!(unique.len(), terms.len(), "terms harus unik");

        let likelihood = text["likelihood"].as_str().expect("likelihood");
        assert!(["multinomial", "bernoulli", "complement"].contains(&likelihood));
        assert!(num(&text["alpha"], "alpha") > 0.0);

        let expected_prior = !(likelihood == "complement" && classes.len() >= 2);
        assert_eq!(text["uses_class_prior"], json!(expected_prior));
        if likelihood == "complement" {
            assert_eq!(other_features, 0, "Complement hanya boleh hanya-Text");
        }

        match text["source"].as_str().expect("source") {
            "raw" => {
                assert!(!text["raw_variable"].as_str().unwrap_or("").is_empty());
                let recipe = text["recipe"].as_object().expect("recipe object");
                assert_eq!(recipe["vocabulary"], text["terms"]);
                assert_eq!(recipe["idf"].as_array().map(|v| v.len()), Some(terms.len()));
                assert_eq!(
                    recipe["doc_freq"].as_array().map(|v| v.len()),
                    Some(terms.len())
                );
                assert!(text["columns"].is_null());
            }
            "vector" => {
                assert_eq!(text["columns"], text["terms"]);
                assert!(text["recipe"].is_null());
                assert!(text["raw_variable"].is_null());
            }
            other => panic!("source tidak dikenal: {}", other),
        }

        for class in classes {
            let weights = text["log_weights"][*class].as_array().expect("log_weights");
            assert_eq!(weights.len(), terms.len());
            for value in weights {
                let value = num(value, "log_weights");
                assert!(value.is_finite());
                if likelihood == "complement" {
                    assert!(value >= -1e-9, "Complement: -ln(theta~) >= 0");
                } else {
                    assert!(value <= 1e-9, "Multinomial/Bernoulli: ln p <= 0");
                }
            }
            let counts = text["class_term_counts"][*class]
                .as_array()
                .expect("class_term_counts");
            assert_eq!(counts.len(), terms.len());
            assert!(counts.iter().all(|c| num(c, "count") >= 0.0));
            if likelihood == "bernoulli" {
                let absent = text["log_weights_absent"][*class]
                    .as_array()
                    .expect("log_weights_absent");
                assert_eq!(absent.len(), terms.len());
                assert!(absent.iter().all(|a| num(a, "absent") <= 1e-9));
            }
        }
        if likelihood != "bernoulli" {
            assert!(text["log_weights_absent"].is_null());
        }
    }

    #[test]
    fn export_2_0_raw_memuat_recipe_raw_variable_dan_bobot_golden_multinomial() {
        let (data, model) = raw_golden_model(ConfigTextLikelihood::Multinomial);
        assert!(export_requires_schema_2(&model));

        let exported = build_export(&data, &model, &config("holdout"), Some("Text Tweet"))
            .expect("export raw");
        assert_eq!(exported.schema_version(), "2.0");
        let json = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));

        // Tanpa predictor lain: features/feature_order kosong, Text di blok `text`.
        assert_eq!(json["features"], json!([]));
        assert_eq!(json["feature_order"], json!([]));

        let text = &json["text"];
        assert_eq!(text["source"], "raw");
        assert_eq!(text["likelihood"], "multinomial");
        assert_eq!(text["alpha"], 1.0);
        assert_eq!(
            text["terms"],
            json!(["makan", "nasi", "saya", "suka", "tidak"])
        );
        assert_eq!(text["raw_variable"], "Text Tweet");
        assert!(text["columns"].is_null());
        assert_eq!(text["uses_class_prior"], true);
        assert!(text["log_weights_absent"].is_null());

        // Bobot = golden §6.7 (Multinomial), per kelas [neg, pos].
        let expected_neg = [-2.197225, -1.504077, -1.504077, -1.504077, -1.504077];
        let expected_pos = [-0.875469, -1.791759, -1.791759, -1.791759, -2.484907];
        for (index, (&neg, &pos)) in expected_neg.iter().zip(expected_pos.iter()).enumerate() {
            close(
                num(&text["log_weights"]["neg"][index], "neg"),
                neg,
                "log_weights neg",
            );
            close(
                num(&text["log_weights"]["pos"][index], "pos"),
                pos,
                "log_weights pos",
            );
        }
        // N_ct: neg = [0,1,1,1,1], pos = [4,1,1,1,0].
        assert_eq!(
            text["class_term_counts"]["neg"],
            json!([0.0, 1.0, 1.0, 1.0, 1.0])
        );
        assert_eq!(
            text["class_term_counts"]["pos"],
            json!([4.0, 1.0, 1.0, 1.0, 0.0])
        );

        // Resep ikut diekspor dan dapat dibaca kembali oleh CORE.
        let recipe: statify_text_core::TextVectorizerModel =
            serde_json::from_value(text["recipe"].clone()).expect("recipe dapat di-deserialisasi");
        assert_eq!(recipe.vocabulary, golden_terms());
        assert_eq!(recipe.recipe_version, statify_text_core::RECIPE_VERSION);

        assert_am_text_block_valid(text, &["neg", "pos"], 0);
    }

    #[test]
    fn export_2_0_raw_bernoulli_dan_complement_memenuhi_invarian_validasi_am() {
        let (data, bernoulli) = raw_golden_model(ConfigTextLikelihood::Bernoulli);
        let exported = build_export(&data, &bernoulli, &config("holdout"), Some("Teks"))
            .expect("export Bernoulli");
        let json = serde_json::to_value(&exported).expect("serialisasi");
        let text = &json["text"];
        assert_eq!(text["likelihood"], "bernoulli");
        // A_ct = ln(1 - p): neg makan p = 1/3 -> -0.405465; neg nasi p = 2/3 -> -1.098612.
        close(
            num(&text["log_weights_absent"]["neg"][0], "A"),
            -0.405465,
            "A neg makan",
        );
        close(
            num(&text["log_weights_absent"]["neg"][1], "A"),
            -1.098612,
            "A neg nasi",
        );
        close(
            num(&text["log_weights"]["neg"][0], "L"),
            -1.098612,
            "L neg makan",
        );
        assert_am_text_block_valid(text, &["neg", "pos"], 0);

        let (data, complement) = raw_golden_model(ConfigTextLikelihood::Complement);
        let exported = build_export(&data, &complement, &config("holdout"), Some("Teks"))
            .expect("export Complement");
        let json = serde_json::to_value(&exported).expect("serialisasi");
        let text = &json["text"];
        assert_eq!(text["likelihood"], "complement");
        // Complement K >= 2: tanpa prior (konsisten dengan validasi AM).
        assert_eq!(text["uses_class_prior"], false);
        close(
            num(&text["log_weights"]["neg"][0], "L"),
            0.875469,
            "L neg makan",
        );
        assert_am_text_block_valid(text, &["neg", "pos"], 0);
    }

    #[test]
    fn export_2_0_vector_memuat_columns_tanpa_recipe_dan_raw_variable() {
        let terms = strings(&["VEC_makan", "VEC_nasi", "VEC_saya", "VEC_suka", "VEC_tidak"]);
        let (data, model) = train_text_only(
            ConfigTextLikelihood::Multinomial,
            &golden_dense_matrix(),
            &terms,
        );

        let exported = build_export(&data, &model, &config("kfold"), None).expect("export vector");
        assert_eq!(exported.schema_version(), "2.0");
        let json = without_trained_at(serde_json::to_value(&exported).expect("serialisasi"));

        let text = &json["text"];
        assert_eq!(text["source"], "vector");
        assert_eq!(text["terms"], json!(terms));
        assert_eq!(text["columns"], json!(terms));
        assert!(text["raw_variable"].is_null());
        assert!(text["recipe"].is_null());
        close(
            num(&text["log_weights"]["pos"][0], "L"),
            -0.875469,
            "L pos VEC_makan",
        );
        assert_am_text_block_valid(text, &["neg", "pos"], 0);
    }

    #[test]
    fn export_2_0_model_campuran_numeric_dan_text_memuat_fitur_dan_blok_text() {
        // 1 covariate `x` (Gaussian biasa) + Text vector: tetap 2.0 karena ada Text.
        let cases: Vec<PreprocessedCase> = [("pos", 1.0), ("neg", 2.0), ("pos", 3.0)]
            .iter()
            .map(|(target, x)| {
                let mut covariates = StdHashMap::new();
                covariates.insert("x".to_string(), Some(*x));
                PreprocessedCase {
                    target_class: target.to_string(),
                    factors: StdHashMap::new(),
                    covariates,
                }
            })
            .collect();
        let data = PreprocessedData {
            total_instances: 3,
            excluded_target_missing: 0,
            target_variable: "Class".to_string(),
            predictor_order: vec![("x".to_string(), PredictorRole::Covariate)],
            factor_names: vec![],
            covariate_names: strings(&["x"]),
            classes: strings(&["neg", "pos"]),
            cases: cases.clone(),
        };
        let terms = golden_terms();
        let x = golden_dense_matrix();
        let input = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood: ConfigTextLikelihood::Bernoulli,
            alpha: 1.0,
        };
        let model = train_naive_bayes_model_v2(
            &cases,
            &data.classes,
            &[],
            &data.covariate_names,
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        )
        .expect("latih campuran");

        let exported =
            build_export(&data, &model, &config("holdout"), None).expect("export campuran");
        let json = serde_json::to_value(&exported).expect("serialisasi");
        assert_eq!(json["schema_version"], "2.0");
        assert_eq!(json["feature_order"], json!(["x"]));
        assert_eq!(json["features"][0]["likelihood"], "gaussian");
        assert!(json["features"][0]["min_variance"].is_null());
        assert_eq!(json["text"]["source"], "vector");
        assert_am_text_block_valid(&json["text"], &["neg", "pos"], 1);
    }

    // ------------------------------------------------------------------
    // Galat bentuk (tanpa panic/unwrap) — jangan pernah menghasilkan file rusak.
    // ------------------------------------------------------------------

    #[test]
    fn raw_tanpa_raw_variable_atau_tanpa_recipe_ditolak_dengan_nb_e_text_shape() {
        let (data, model) = raw_golden_model(ConfigTextLikelihood::Multinomial);

        // Resep ada tetapi nama variabel tidak dikirim.
        let error = build_export(&data, &model, &config("holdout"), None).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_SHAPE"), "{}", error);
        let error = build_export(&data, &model, &config("holdout"), Some("  ")).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_SHAPE"), "{}", error);

        // Nama variabel ada tetapi model tidak membawa resep (mis. jalur vector).
        let terms = golden_terms();
        let (data, vector_model) = train_text_only(
            ConfigTextLikelihood::Multinomial,
            &golden_dense_matrix(),
            &terms,
        );
        let error =
            build_export(&data, &vector_model, &config("holdout"), Some("Teks")).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_SHAPE"), "{}", error);
    }

    #[test]
    fn bentuk_parameter_text_yang_tidak_konsisten_ditolak() {
        let terms = golden_terms();
        let (data, model) = train_text_only(
            ConfigTextLikelihood::Multinomial,
            &golden_dense_matrix(),
            &terms,
        );
        let text = model.text.as_ref().expect("model Text");
        let classes = data.classes.clone();

        // Term kosong.
        let error = build_export_text_parts(&classes, &text.params, &[], None, None).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_SHAPE"), "{}", error);

        // Term duplikat.
        let mut duplicated = terms.clone();
        duplicated[1] = duplicated[0].clone();
        let error =
            build_export_text_parts(&classes, &text.params, &duplicated, None, None).unwrap_err();
        assert!(error.contains("are not unique"), "{}", error);

        // Jumlah term tidak sama dengan lebar matriks bobot.
        let short = terms[..4].to_vec();
        let error =
            build_export_text_parts(&classes, &text.params, &short, None, None).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_SHAPE"), "{}", error);

        // Urutan kelas berbeda dari parameter.
        let swapped = strings(&["pos", "neg"]);
        let error =
            build_export_text_parts(&swapped, &text.params, &terms, None, None).unwrap_err();
        assert!(error.contains("class order"), "{}", error);

        // Nilai tidak terhingga ditolak (JSON akan menjadi null -> ditolak Apply Model).
        let mut broken = text.params.clone();
        broken.log_weights[0][0] = f64::NAN;
        let error = build_export_text_parts(&classes, &broken, &terms, None, None).unwrap_err();
        assert!(error.contains("not finite numbers"), "{}", error);

        // Bernoulli tanpa log_weights_absent.
        let (data_b, bernoulli) = train_text_only(
            ConfigTextLikelihood::Bernoulli,
            &golden_dense_matrix(),
            &terms,
        );
        let mut params_b = bernoulli.text.as_ref().expect("model Text").params.clone();
        params_b.log_weights_absent = None;
        let error =
            build_export_text_parts(&data_b.classes, &params_b, &terms, None, None).unwrap_err();
        assert!(error.contains("log_weights_absent"), "{}", error);
    }

    #[test]
    fn resep_dengan_kosakata_berbeda_dari_terms_ditolak() {
        let (recipe, x) =
            statify_text_core::fit_transform(&golden_docs(), &weka_cfg()).expect("fit golden");
        let mut terms = recipe.vocabulary.clone();
        let (data, model) = train_text_only(ConfigTextLikelihood::Multinomial, &x, &terms);
        let params = model.text.as_ref().expect("model Text").params.clone();

        terms[0] = "lain".to_string();
        let error =
            build_export_text_parts(&data.classes, &params, &terms, Some(&recipe), Some("Teks"))
                .unwrap_err();
        assert!(error.contains("preprocessing vocabulary"), "{}", error);
    }

    #[test]
    fn schema_version_any_dan_requires_schema_2_konsisten() {
        let (preprocessed, v1_model) = six_row_model();
        assert!(!export_requires_schema_2(&v1_model));
        let v1 = build_export(&preprocessed, &v1_model, &config("holdout"), None).expect("v1");
        assert_eq!(v1.schema_version(), "1.1");

        let (minstd_data, minstd) = minstd_model();
        assert!(export_requires_schema_2(&minstd));
        let v2 = build_export(&minstd_data, &minstd, &config("holdout"), None).expect("v2");
        assert_eq!(v2.schema_version(), EXPORT_SCHEMA_V2);
    }
}
