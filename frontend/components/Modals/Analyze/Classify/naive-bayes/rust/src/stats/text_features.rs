// naive-bayes/rust/src/stats/text_features.rs
//
// Fase N3a (PLAN_V2) — integrasi fitur Text jalur `vector` ke pelatihan dan
// prediksi Naive Bayes, plus penyimpanan `TextNbParams` di model terlatih.
//
// Kontrak: `naive-bayes/AGENTS_V2.md` §3.3, §5.2, §6, §7 dan
// `plan-reports-v2/CATATAN_TAHAP2_negatif_dan_notscored.md`.
//
// === Prinsip (AGENTS_V2 P-V2, P-V3) ===
//
// Kontribusi Text HANYA dihitung oleh `statify_text_core::nb_text`
// (`train` / `score_rows`); berkas ini TIDAK punya rumus Multinomial,
// Bernoulli, maupun Complement sendiri. Skor NB untuk satu baris sama dengan
// skor Apply Model: `ln prior` (hanya bila `uses_class_prior`) + kontribusi
// Numeric/Categorical v1 + `score_rows` (lihat `prediction::predict_case_with_text`).
//
// === Urutan WAJIB penanganan payload Text (REVIEW-G1 N1-5) ===
//
//   1. `align_text_payload`  — baris Text ikut terbuang bila target missing.
//   2. Tentukan baris "teks missing" (NotScored) dari `TextPayload` MENTAH.
//   3. `vector_to_csr`       — null/non-finite -> 0, negatif -> galat.
//
// Alasannya: (a) nilai negatif di baris target-missing tidak boleh menggagalkan
// analisis (baris itu sudah dibuang di langkah 1); (b) setelah konversi ke CSR
// `null` dan `0` tidak lagi dapat dibedakan, padahal `null` = missing sedangkan
// `0` = nilai (V11). Urutan ini diuji di `tests::urutan_*`.
//
// === Aturan baris NotScored (CATATAN_TAHAP2 §2, sama dengan Apply Model) ===
//
// Ditentukan DI SINI (pemanggil), bukan oleh CORE:
//   - raw    : teks null / kosong / whitespace (di-trim) = missing.
//   - vector : teks missing bila SEMUA kolom payload bernilai null/non-finite.
//   - Baris yang semua prediktornya missing (Text missing DAN semua covariate
//     `None` DAN semua factor berkategori "(Missing)") tidak diprediksi
//     (NotScored) dan dikeluarkan dari confusion matrix. Bila masih ada
//     prediktor lain, teks missing = vektor nol dan baris tetap diskor
//     (Multinomial/Complement: kontribusi 0; Bernoulli: tetap `Σ A_ct`) —
//     JANGAN diseragamkan dan JANGAN menambah filter "baris nol" di CORE.
//   - Complement hanya-Text dengan teks missing = NotScored (bukan skor 0):
//     otomatis terpenuhi oleh aturan di atas karena Complement tidak boleh
//     bercampur dengan Numeric/Categorical (`NB_E_COMPLEMENT_MIXED`).
//   - Aturan NotScored hanya berlaku bila ada fitur Text; model tanpa Text
//     (v1) tidak pernah menghasilkan NotScored (perilaku v1 tidak berubah).
//   - Baris NotScored TETAP ikut pelatihan (vektor nol); hanya dikeluarkan dari
//     evaluasi. Jumlahnya dilaporkan terpisah dari baris yang dibuang karena
//     target missing.
use statify_text_core::nb_text::{self, TextNbParams};
use statify_text_core::{CsrMatrix, TextVectorizerConfig, TextVectorizerModel};

use crate::models::config::{self, NaiveBayesConfig, NaiveBayesConfigV2};
use crate::models::data::{AnalysisData, PreprocessedCase, PreprocessedData, TextPayload};

use super::numerical_distribution::NumericLikelihoodSpec;
use super::prediction::predict_case_with_text;
use super::preprocess_data::{align_text_payload, kept_row_indices};
use super::raw_text::{self, RawTextContext, SplitLabel, SplitText};
use super::training::{train_naive_bayes_model_v2, TrainedModelParams};

/// Label kategori factor untuk nilai missing. HARUS sama dengan
/// `MISSING_CATEGORY_LABEL` di `preprocess_data.rs` (konstanta itu privat dan
/// fungsi terkunci P-V4 tidak diubah, jadi nilainya diulang di sini).
pub const FACTOR_MISSING_LABEL: &str = "(Missing)";

/// Batas atas `TextAlpha` (AGENTS_V2 §3.6: `0 < alpha <= 999`).
pub const TEXT_ALPHA_MAX: f64 = 999.0;

// Fase N3b: konstanta `RAW_TEXT_NOT_SUPPORTED_MESSAGE` (penolakan jalur raw
// milik N3a) DIHAPUS; payload `raw` kini diproses lewat `raw_text`.

/// Enum likelihood NB (`models::config`) dan CORE (`nb_text`) disamakan lewat
/// `From` (REVIEW-G1 N1-3) supaya hanya ada satu pemetaan nama -> rumus.
impl From<config::TextLikelihood> for nb_text::TextLikelihood {
    fn from(value: config::TextLikelihood) -> Self {
        match value {
            config::TextLikelihood::Multinomial => nb_text::TextLikelihood::Multinomial,
            config::TextLikelihood::Bernoulli => nb_text::TextLikelihood::Bernoulli,
            config::TextLikelihood::Complement => nb_text::TextLikelihood::Complement,
        }
    }
}

/// Model Text terlatih yang disimpan di `TrainedModelParams::text`:
/// parameter CORE + nama term (nama kolom vektor) sejajar indeks parameter.
#[derive(Debug, Clone)]
pub struct TrainedTextModel {
    pub params: TextNbParams,
    pub terms: Vec<String>,
    /// Fase N3b: resep CORE (jalur `raw`) hasil fit pada SELURUH baris valid;
    /// hanya diisi oleh `retrain_final_model_v2` (model final). `None` untuk
    /// jalur `vector` dan untuk model per-fold/holdout. Diekspor Fase N4.
    pub recipe: Option<TextVectorizerModel>,
}

/// Data latih Text untuk satu pemanggilan `train_naive_bayes_model_v2`.
/// Baris `x` HARUS sejajar dengan `cases` yang dilatih.
#[derive(Debug, Clone)]
pub struct TextTrainInput<'a> {
    pub x: &'a CsrMatrix,
    pub terms: &'a [String],
    pub likelihood: config::TextLikelihood,
    pub alpha: f64,
}

/// Fitur Text jalur `vector` untuk seluruh baris valid (target tidak missing).
#[derive(Debug, Clone)]
pub struct TextFeatureData {
    /// Nama kolom vektor = nama term.
    pub terms: Vec<String>,
    /// Matriks term-dokumen; baris ke-`i` sejajar dengan `PreprocessedData::cases[i]`.
    pub x: CsrMatrix,
    /// `true` bila teks baris ke-`i` missing (V11), dari payload mentah.
    pub missing: Vec<bool>,
}

/// Konfigurasi Text yang dipakai satu run (likelihood + alpha dari `config_v2`;
/// SUMBER teks ditentukan payload, bukan `config.TextSource`).
#[derive(Debug, Clone)]
pub struct TextContext {
    /// Jalur `vector`: matriks yang dipakai evaluasi DAN model final.
    /// Jalur `raw`: hasil fit GLOBAL — HANYA untuk model final; evaluasi wajib
    /// lewat `prepare_split_text` (fit per holdout/fold, V7).
    pub data: TextFeatureData,
    pub likelihood: config::TextLikelihood,
    pub alpha: f64,
    /// Fase N3b: konteks Raw Text (`Some` hanya bila payload `raw`).
    pub raw: Option<RawTextContext>,
}

/// Seluruh pilihan v2 untuk satu run: likelihood Numeric + fitur Text.
#[derive(Debug, Clone)]
pub struct V2Context {
    pub numeric: NumericLikelihoodSpec,
    pub text: Option<TextContext>,
}

impl V2Context {
    /// `true` bila model setara v1 (tanpa Text dan semua covariate Gaussian
    /// biasa) — jalur v1 dipakai apa adanya.
    pub fn is_v1_equivalent(&self, covariate_names: &[String]) -> bool {
        self.text.is_none() && self.numeric.all_plain_gaussian(covariate_names)
    }
}

/// Validasi `0 < alpha <= 999` (dan finite) SEBELUM `nb_text::train`.
pub fn validate_text_alpha(alpha: f64) -> Result<(), String> {
    if alpha.is_finite() && alpha > 0.0 && alpha <= TEXT_ALPHA_MAX {
        Ok(())
    } else {
        Err(format!(
            "Text smoothing alpha must be greater than 0 and at most {} (received: {}).",
            TEXT_ALPHA_MAX, alpha
        ))
    }
}

/// Validasi pengaturan model Text: alpha, serta Complement hanya boleh bila
/// model hanya berisi fitur Text (V5; `NB_E_COMPLEMENT_MIXED`).
pub fn validate_text_model_setup(
    likelihood: config::TextLikelihood,
    alpha: f64,
    n_factors: usize,
    n_covariates: usize,
) -> Result<(), String> {
    validate_text_alpha(alpha)?;
    if likelihood == config::TextLikelihood::Complement && n_factors + n_covariates > 0 {
        return Err(format!(
            "NB_E_COMPLEMENT_MIXED: Complement Naive Bayes can only be used when the model contains Text Features only, but this model also has {} numeric/categorical predictor(s).",
            n_factors + n_covariates
        ));
    }
    Ok(())
}

/// Latih parameter Text lewat `CORE::nb_text::train`. Alpha divalidasi dulu.
pub fn train_text_model(
    cases: &[PreprocessedCase],
    classes: &[String],
    input: &TextTrainInput<'_>,
) -> Result<TrainedTextModel, String> {
    validate_text_alpha(input.alpha)?;
    if input.x.n_rows != cases.len() {
        return Err(format!(
            "NB_E_TEXT_SHAPE: The text matrix has {} rows, but the training data has {} rows.",
            input.x.n_rows,
            cases.len()
        ));
    }
    if input.terms.len() != input.x.n_cols {
        return Err(format!(
            "NB_E_TEXT_SHAPE: The number of term names ({}) does not match the number of text matrix columns ({}).",
            input.terms.len(),
            input.x.n_cols
        ));
    }

    // Kelas yang tidak dikenal (seharusnya mustahil) dipetakan ke indeks di
    // luar rentang; `nb_text::train` mengabaikannya tanpa panic.
    let labels: Vec<usize> = cases
        .iter()
        .map(|case| {
            classes
                .iter()
                .position(|class| *class == case.target_class)
                .unwrap_or(usize::MAX)
        })
        .collect();

    let params = nb_text::train(
        input.x,
        &labels,
        classes.len(),
        classes,
        input.likelihood.into(),
        input.alpha,
    );

    Ok(TrainedTextModel {
        params,
        terms: input.terms.to_vec(),
        recipe: None,
    })
}

/// Ambil baris-baris `indices` dari `x` menjadi matriks CSR baru (urutan
/// mengikuti `indices`). Indeks di luar rentang menghasilkan baris kosong.
pub fn slice_csr_rows(x: &CsrMatrix, indices: &[usize]) -> CsrMatrix {
    let mut indptr: Vec<usize> = Vec::with_capacity(indices.len() + 1);
    indptr.push(0);
    let mut col_indices: Vec<u32> = Vec::new();
    let mut data: Vec<f64> = Vec::new();

    for &row in indices {
        if let (Some(&start), Some(&end)) = (x.indptr.get(row), x.indptr.get(row + 1)) {
            let end = end.min(x.indices.len()).min(x.data.len());
            if start < end {
                col_indices.extend_from_slice(&x.indices[start..end]);
                data.extend_from_slice(&x.data[start..end]);
            }
        }
        indptr.push(col_indices.len());
    }

    CsrMatrix {
        n_rows: indices.len(),
        n_cols: x.n_cols,
        indptr,
        indices: col_indices,
        data,
    }
}

/// Baris "teks missing" (V11) dihitung dari `TextPayload` MENTAH (sebelum
/// `vector_to_csr`). Hasil sejajar dengan baris payload; kosong untuk `None`.
///   - raw    : `null`/kosong/whitespace (di-trim) = missing.
///   - vector : semua kolom `null`/non-finite = missing (nilai 0 BUKAN missing).
pub fn text_row_missing(text: &TextPayload) -> Vec<bool> {
    match text {
        TextPayload::None => Vec::new(),
        TextPayload::Raw { values, .. } => values
            .iter()
            .map(|value| value.as_deref().map_or(true, |s| s.trim().is_empty()))
            .collect(),
        TextPayload::Vector { values, .. } => values
            .iter()
            .map(|row| {
                !row.iter()
                    .any(|cell| matches!(cell, Some(v) if v.is_finite()))
            })
            .collect(),
    }
}

/// Apakah baris ini NotScored (semua prediktor missing)? Hanya dipakai bila
/// model punya fitur Text. Lihat aturan lengkap di kepala berkas.
pub fn is_row_not_scored(case: &PreprocessedCase, text_missing: bool) -> bool {
    text_missing
        && case.covariates.values().all(|value| value.is_none())
        && case
            .factors
            .values()
            .all(|category| category == FACTOR_MISSING_LABEL)
}

/// Bangun `TextFeatureData` dari payload Text mentah (tanpa konfigurasi
/// pipeline teks). Payload `raw` membutuhkan konfigurasi `Text`; tanpa itu
/// galat `NB_E_TEXT_CONFIG` (lihat `build_text_feature_data_with_config`).
pub fn build_text_feature_data(
    text: &TextPayload,
    kept: &[usize],
    total_instances: usize,
) -> Result<Option<TextFeatureData>, String> {
    build_text_feature_data_with_config(text, kept, total_instances, None)
        .map(|built| built.map(|(data, _raw)| data))
}

/// Bangun `TextFeatureData` (+ `RawTextContext` untuk jalur raw) dari payload.
///
/// Urutan wajib: `align_text_payload` -> baris missing dari payload mentah ->
/// `vector_to_csr` / fit model final raw (lihat kepala berkas). `kept` = hasil
/// `kept_row_indices`, `total_instances` = `PreprocessedData::total_instances`.
///
/// Fase N3b: cabang penolakan raw milik N3a DIGANTI di sini (bukan jalur
/// paralel). Jalur raw: dokumen terselaras di-fit SEKALI untuk model final
/// (`raw_text::build_raw_text_context`); matriks globalnya tidak dipakai
/// evaluasi. `text_config` = `NaiveBayesConfigV2::text`.
///
/// `Ok(None)` untuk `TextPayload::None`.
pub fn build_text_feature_data_with_config(
    text: &TextPayload,
    kept: &[usize],
    total_instances: usize,
    text_config: Option<&TextVectorizerConfig>,
) -> Result<Option<(TextFeatureData, Option<RawTextContext>)>, String> {
    if matches!(text, TextPayload::None) {
        return Ok(None);
    }

    // 1. Selaraskan dengan baris yang lolos filter target-missing.
    let aligned = align_text_payload(text, kept, total_instances)?;
    // 2. Baris missing dari payload mentah (sebelum null/0 menjadi sama).
    let missing = text_row_missing(&aligned);

    match &aligned {
        TextPayload::None => Ok(None),
        TextPayload::Raw { variable, .. } => {
            // 3a. Jalur raw: null -> "" lalu fit model final di seluruh baris valid.
            let docs = aligned.raw_documents().unwrap_or_default();
            let (context, x) = raw_text::build_raw_text_context(variable, docs, text_config)?;
            let terms = context.final_recipe.vocabulary.clone();
            Ok(Some((TextFeatureData { terms, x, missing }, Some(context))))
        }
        TextPayload::Vector { .. } => {
            // 3b. Jalur vector: konversi ke CSR; nilai negatif ditolak dengan nama kolom.
            match aligned.vector_to_csr()? {
                Some((terms, x)) => {
                    if terms.is_empty() {
                        return Err(
                            "NB_E_TEXT_SHAPE: No columns are selected in Word-Vector Variables."
                                .to_string(),
                        );
                    }
                    Ok(Some((TextFeatureData { terms, x, missing }, None)))
                }
                None => Ok(None),
            }
        }
    }
}

/// Susun `V2Context` untuk satu run: likelihood Numeric (default + override)
/// dan fitur Text. SUMBER teks diambil dari `text` (payload), BUKAN dari
/// `config_v2.main.text_source`; likelihood/alpha Text dari `config_v2.options`.
pub fn build_v2_context(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
    config_v2: &NaiveBayesConfigV2,
    text: &TextPayload,
    preprocessed: &PreprocessedData,
) -> Result<V2Context, String> {
    let numeric = NumericLikelihoodSpec {
        default: config_v2.options.numeric_likelihood,
        overrides: config_v2.options.numeric_likelihood_overrides.clone(),
    };

    if matches!(text, TextPayload::None) {
        return Ok(V2Context {
            numeric,
            text: None,
        });
    }

    let likelihood = config_v2.options.text_likelihood;
    let alpha = config_v2.options.text_alpha;
    validate_text_model_setup(
        likelihood,
        alpha,
        preprocessed.factor_names.len(),
        preprocessed.covariate_names.len(),
    )?;

    let kept = kept_row_indices(data, config)?;
    let (feature_data, raw) = match build_text_feature_data_with_config(
        text,
        &kept,
        preprocessed.total_instances,
        config_v2.text.as_ref(),
    )? {
        Some(built) => built,
        None => {
            return Ok(V2Context {
                numeric,
                text: None,
            })
        }
    };

    if feature_data.x.n_rows != preprocessed.cases.len() {
        return Err(format!(
            "NB_E_TEXT_SHAPE: After alignment, the text data has {} rows, but there are {} valid rows.",
            feature_data.x.n_rows,
            preprocessed.cases.len()
        ));
    }

    Ok(V2Context {
        numeric,
        text: Some(TextContext {
            data: feature_data,
            likelihood,
            alpha,
            raw,
        }),
    })
}

/// Retrain model final di SELURUH baris valid untuk konfigurasi v2
/// (AGENTS_V2 §7 / AGENTS.md §5.5). Padanan `save::retrain_final_model` untuk
/// model yang memakai Gaussian min-std dan/atau fitur Text.
pub fn retrain_final_model_v2(
    preprocessed: &PreprocessedData,
    config: &NaiveBayesConfig,
    v2: &V2Context,
) -> Result<TrainedModelParams, String> {
    let text_input = v2.text.as_ref().map(|text| TextTrainInput {
        x: &text.data.x,
        terms: &text.data.terms,
        likelihood: text.likelihood,
        alpha: text.alpha,
    });

    let mut model = train_naive_bayes_model_v2(
        &preprocessed.cases,
        &preprocessed.classes,
        &preprocessed.factor_names,
        &preprocessed.covariate_names,
        config.options.smoothing_alpha,
        config.options.variance_floor,
        &v2.numeric,
        text_input.as_ref(),
    )?;

    // Fase N3b: model final jalur raw membawa resep hasil fit di SELURUH baris
    // valid (`text.data` pada jalur raw = hasil fit global itu) supaya Fase N4
    // dapat mengekspornya sebagai `text.recipe`.
    if let (Some(text), Some(trained)) = (&v2.text, model.text.as_mut()) {
        if let Some(raw) = &text.raw {
            trained.recipe = Some(raw.final_recipe.clone());
        }
    }

    Ok(model)
}

/// Vektorisasi Text untuk SATU evaluasi (holdout atau satu fold).
///   - raw    : `raw_text::fit_split` — kosakata/IDF di-fit HANYA di
///              `train_indices`, latih & uji di-transform dengan resep itu
///              (V7, anti-leakage). `text.data` (fit global) TIDAK dipakai.
///   - vector : irisan baris `text.data.x` dengan indeks yang sama (nilai
///              dipakai apa adanya; catatan W-LEAK).
pub fn prepare_split_text(
    text: &TextContext,
    train_indices: &[usize],
    eval_indices: &[usize],
    split: &SplitLabel,
) -> Result<SplitText, String> {
    match &text.raw {
        Some(raw) => raw_text::fit_split(raw, train_indices, eval_indices, split),
        None => Ok(SplitText {
            train_x: slice_csr_rows(&text.data.x, train_indices),
            eval_x: slice_csr_rows(&text.data.x, eval_indices),
            terms: text.data.terms.clone(),
            recipe: None,
        }),
    }
}

/// Padanan `function::train_and_predict` untuk konfigurasi v2 tanpa label
/// evaluasi (pesan galat memakai "evaluasi ini"). Lihat
/// `train_and_predict_v2_split` untuk dokumentasi lengkap.
///
/// Mengembalikan `(actual, predicted, jumlah_not_scored)`.
#[allow(clippy::too_many_arguments)]
pub fn train_and_predict_v2(
    preprocessed_cases: &[PreprocessedCase],
    train_indices: &[usize],
    eval_indices: &[usize],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
    v2: &V2Context,
) -> Result<(Vec<String>, Vec<String>, usize), String> {
    train_and_predict_v2_split(
        preprocessed_cases,
        train_indices,
        eval_indices,
        classes,
        factor_names,
        covariate_names,
        alpha,
        variance_floor,
        v2,
        &SplitLabel::Unspecified,
    )
}

/// Latih satu model di `train_indices` lalu prediksi `eval_indices` (indeks ke
/// `preprocessed_cases`) — berlaku untuk holdout maupun tiap fold k-fold.
/// Fitur Text memakai baris yang SAMA (`prepare_split_text`); pada jalur raw
/// vektorisasi di-fit per evaluasi (Fase N3b, V7). Baris NotScored dikeluarkan
/// dari pasangan actual/predicted dan dihitung pada nilai ketiga. `split`
/// hanya dipakai untuk pesan galat (`NB_E_TEXT_EMPTY_VOCAB_FOLD`).
///
/// Mengembalikan `(actual, predicted, jumlah_not_scored)`.
#[allow(clippy::too_many_arguments)]
pub fn train_and_predict_v2_split(
    preprocessed_cases: &[PreprocessedCase],
    train_indices: &[usize],
    eval_indices: &[usize],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
    v2: &V2Context,
    split: &SplitLabel,
) -> Result<(Vec<String>, Vec<String>, usize), String> {
    let train_cases: Vec<PreprocessedCase> = train_indices
        .iter()
        .map(|&idx| preprocessed_cases[idx].clone())
        .collect();

    let split_text: Option<SplitText> = match &v2.text {
        Some(text) => Some(prepare_split_text(text, train_indices, eval_indices, split)?),
        None => None,
    };
    let train_text = match (&v2.text, &split_text) {
        (Some(text), Some(prepared)) => Some(TextTrainInput {
            x: &prepared.train_x,
            terms: &prepared.terms,
            likelihood: text.likelihood,
            alpha: text.alpha,
        }),
        _ => None,
    };

    let model = train_naive_bayes_model_v2(
        &train_cases,
        classes,
        factor_names,
        covariate_names,
        alpha,
        variance_floor,
        &v2.numeric,
        train_text.as_ref(),
    )?;

    // Kontribusi Text semua baris evaluasi dihitung sekali lewat CORE.
    let eval_text_scores: Option<Vec<Vec<f64>>> = match (&model.text, &split_text) {
        (Some(trained), Some(prepared)) => {
            Some(nb_text::score_rows(&trained.params, &prepared.eval_x))
        }
        _ => None,
    };

    let mut actual = Vec::with_capacity(eval_indices.len());
    let mut predicted = Vec::with_capacity(eval_indices.len());
    let mut not_scored = 0usize;

    for (position, &idx) in eval_indices.iter().enumerate() {
        let case = &preprocessed_cases[idx];

        if let Some(text) = &v2.text {
            let text_missing = text.data.missing.get(idx).copied().unwrap_or(true);
            if is_row_not_scored(case, text_missing) {
                not_scored += 1;
                continue;
            }
        }

        let row_scores: Option<&[f64]> = eval_text_scores
            .as_ref()
            .and_then(|scores| scores.get(position))
            .map(|row| row.as_slice());
        let prediction = predict_case_with_text(&model, case, alpha, row_scores);

        actual.push(case.target_class.clone());
        // Fallback sama dengan `function::train_and_predict` (v1).
        predicted.push(
            prediction
                .predicted_class
                .unwrap_or_else(|| case.target_class.clone()),
        );
    }

    Ok((actual, predicted, not_scored))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::numerical_distribution::NumericLikelihoodSpec;
    use crate::stats::training::{train_naive_bayes_model, train_naive_bayes_model_v2};
    use std::collections::HashMap;

    const TOL: f64 = 1e-6;

    fn classes_neg_pos() -> Vec<String> {
        vec!["neg".to_string(), "pos".to_string()]
    }

    fn terms_golden() -> Vec<String> {
        ["makan", "nasi", "saya", "suka", "tidak"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    fn csr_from_dense(rows: &[Vec<f64>]) -> CsrMatrix {
        let n_cols = rows.first().map_or(0, |row| row.len());
        let mut indptr = vec![0usize];
        let mut indices = Vec::new();
        let mut data = Vec::new();
        for row in rows {
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
            n_cols,
            indptr,
            indices,
            data,
        }
    }

    fn text_only_case(target: &str) -> PreprocessedCase {
        PreprocessedCase {
            target_class: target.to_string(),
            factors: HashMap::new(),
            covariates: HashMap::new(),
        }
    }

    fn numeric_case(target: &str, x: Option<f64>) -> PreprocessedCase {
        let mut covariates = HashMap::new();
        covariates.insert("x".to_string(), x);
        PreprocessedCase {
            target_class: target.to_string(),
            factors: HashMap::new(),
            covariates,
        }
    }

    /// Data latih golden AGENTS_V2 §6.7: pos, neg, pos (kelas terurut [neg, pos]).
    fn golden_train_cases() -> Vec<PreprocessedCase> {
        vec![
            text_only_case("pos"),
            text_only_case("neg"),
            text_only_case("pos"),
        ]
    }

    fn golden_train_matrix() -> CsrMatrix {
        csr_from_dense(&[
            vec![1.0, 1.0, 1.0, 1.0, 0.0],
            vec![0.0, 1.0, 1.0, 1.0, 1.0],
            vec![3.0, 0.0, 0.0, 0.0, 0.0],
        ])
    }

    /// Dokumen uji "makan nasi enak" -> x = [1,1,0,0,0].
    fn golden_test_matrix() -> CsrMatrix {
        csr_from_dense(&[vec![1.0, 1.0, 0.0, 0.0, 0.0]])
    }

    fn train_golden(likelihood: config::TextLikelihood) -> TrainedModelParams {
        let cases = golden_train_cases();
        let x = golden_train_matrix();
        let terms = terms_golden();
        let input = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood,
            alpha: 1.0,
        };
        train_naive_bayes_model_v2(
            &cases,
            &classes_neg_pos(),
            &[],
            &[],
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        )
        .expect("pelatihan golden harus berhasil")
    }

    fn golden_scores(likelihood: config::TextLikelihood) -> (TrainedModelParams, f64, f64) {
        let model = train_golden(likelihood);
        let params = &model.text.as_ref().expect("model Text").params;
        let contributions = nb_text::score_rows(params, &golden_test_matrix());
        let prediction = predict_case_with_text(
            &model,
            &text_only_case("UNUSED"),
            1.0,
            Some(contributions[0].as_slice()),
        );
        let neg = prediction.scores["neg"];
        let pos = prediction.scores["pos"];
        (model, neg, pos)
    }

    fn posterior_pos(neg: f64, pos: f64) -> f64 {
        let max = neg.max(pos);
        let e_neg = (neg - max).exp();
        let e_pos = (pos - max).exp();
        e_pos / (e_neg + e_pos)
    }

    fn assert_close(actual: f64, expected: f64, context: &str) {
        assert!(
            (actual - expected).abs() < TOL,
            "{}: diperoleh {}, diharapkan {}",
            context,
            actual,
            expected
        );
    }

    // ------------------------------------------------------------------
    // Golden §6.7: model hanya-Text menghasilkan skor gabungan §6.7.
    // ------------------------------------------------------------------

    #[test]
    fn golden_multinomial_hanya_text_cocok_dengan_tabel() {
        let (_, neg, pos) = golden_scores(config::TextLikelihood::Multinomial);
        assert_close(neg, -4.799914, "multinomial neg");
        assert_close(pos, -3.072693, "multinomial pos");
        assert_close(posterior_pos(neg, pos), 0.849057, "multinomial P(pos)");
    }

    #[test]
    fn golden_bernoulli_hanya_text_cocok_dengan_tabel() {
        let (_, neg, pos) = golden_scores(config::TextLikelihood::Bernoulli);
        assert_close(neg, -5.898527, "bernoulli neg");
        assert_close(pos, -3.060271, "bernoulli pos");
        assert_close(posterior_pos(neg, pos), 0.944708, "bernoulli P(pos)");
    }

    #[test]
    fn golden_complement_hanya_text_tanpa_prior_cocok_dengan_tabel() {
        let (model, neg, pos) = golden_scores(config::TextLikelihood::Complement);
        assert!(!model.text.as_ref().expect("model Text").params.uses_class_prior);
        assert_close(neg, 2.667228, "complement neg");
        assert_close(pos, 3.701302, "complement pos");
        assert_close(posterior_pos(neg, pos), 0.737705, "complement P(pos)");
    }

    /// P-V3: skor NB = `ln prior` (hanya bila `uses_class_prior`) + `CORE::nb_text::score_rows`.
    #[test]
    fn skor_nb_sama_dengan_ln_prior_ditambah_score_rows() {
        for likelihood in [
            config::TextLikelihood::Multinomial,
            config::TextLikelihood::Bernoulli,
            config::TextLikelihood::Complement,
        ] {
            let (model, neg, pos) = golden_scores(likelihood);
            let params = &model.text.as_ref().expect("model Text").params;
            let contributions = nb_text::score_rows(params, &golden_test_matrix());
            // Urutan kelas model: [neg, pos]; prior: neg = 1/3, pos = 2/3.
            let priors = [1.0_f64 / 3.0, 2.0_f64 / 3.0];
            let expected: Vec<f64> = (0..2)
                .map(|c| {
                    let prior_part = if params.uses_class_prior {
                        priors[c].ln()
                    } else {
                        0.0
                    };
                    prior_part + contributions[0][c]
                })
                .collect();
            assert!((neg - expected[0]).abs() < 1e-9, "{:?} neg", likelihood);
            assert!((pos - expected[1]).abs() < 1e-9, "{:?} pos", likelihood);
        }
    }

    // ------------------------------------------------------------------
    // Model campuran: skor = jumlah kontribusi.
    // ------------------------------------------------------------------

    #[test]
    fn model_campuran_numeric_dan_text_adalah_jumlah_kontribusi() {
        let classes = vec!["A".to_string(), "B".to_string()];
        let cases = vec![
            numeric_case("A", Some(1.0)),
            numeric_case("A", Some(3.0)),
            numeric_case("B", Some(5.0)),
            numeric_case("B", Some(8.0)),
        ];
        let x = csr_from_dense(&[
            vec![2.0, 0.0, 1.0],
            vec![3.0, 1.0, 0.0],
            vec![0.0, 2.0, 2.0],
            vec![1.0, 3.0, 1.0],
        ]);
        let terms: Vec<String> = ["t1", "t2", "t3"].iter().map(|s| s.to_string()).collect();
        let covariate_names = vec!["x".to_string()];
        let spec = NumericLikelihoodSpec::default();

        let input = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood: config::TextLikelihood::Multinomial,
            alpha: 1.0,
        };

        let mixed = train_naive_bayes_model_v2(
            &cases,
            &classes,
            &[],
            &covariate_names,
            1.0,
            1e-9,
            &spec,
            Some(&input),
        )
        .expect("model campuran");
        let numeric_only =
            train_naive_bayes_model(&cases, &classes, &[], &covariate_names, 1.0, 1e-9);
        let text_cases: Vec<PreprocessedCase> =
            cases.iter().map(|c| text_only_case(&c.target_class)).collect();
        let text_only = train_naive_bayes_model_v2(
            &text_cases,
            &classes,
            &[],
            &[],
            1.0,
            1e-9,
            &spec,
            Some(&input),
        )
        .expect("model hanya-Text");

        let query_x = csr_from_dense(&[vec![1.0, 0.0, 2.0]]);
        let contributions = nb_text::score_rows(
            &mixed.text.as_ref().expect("Text").params,
            &query_x,
        );
        let row = contributions[0].as_slice();

        let mixed_scores =
            predict_case_with_text(&mixed, &numeric_case("?", Some(2.0)), 1.0, Some(row)).scores;
        let numeric_scores =
            crate::stats::prediction::predict_case(&numeric_only, &numeric_case("?", Some(2.0)), 1.0)
                .scores;
        let text_scores =
            predict_case_with_text(&text_only, &text_only_case("?"), 1.0, Some(row)).scores;

        for class in &classes {
            let prior = 0.5_f64.ln();
            // numeric_scores = ln prior + numeric; text_scores = ln prior + text.
            let expected = numeric_scores[class] + text_scores[class] - prior;
            assert!(
                (mixed_scores[class] - expected).abs() < 1e-9,
                "kelas {}: {} vs {}",
                class,
                mixed_scores[class],
                expected
            );
        }
    }

    // ------------------------------------------------------------------
    // Validasi.
    // ------------------------------------------------------------------

    #[test]
    fn enum_text_likelihood_nb_dipetakan_ke_core_lewat_from() {
        assert_eq!(
            nb_text::TextLikelihood::from(config::TextLikelihood::Multinomial),
            nb_text::TextLikelihood::Multinomial
        );
        assert_eq!(
            nb_text::TextLikelihood::from(config::TextLikelihood::Bernoulli),
            nb_text::TextLikelihood::Bernoulli
        );
        assert_eq!(
            nb_text::TextLikelihood::from(config::TextLikelihood::Complement),
            nb_text::TextLikelihood::Complement
        );
    }

    #[test]
    fn alpha_harus_lebih_dari_nol_dan_paling_besar_999() {
        for bad in [0.0, -1.0, 1000.0, 999.0001, f64::NAN, f64::INFINITY] {
            assert!(validate_text_alpha(bad).is_err(), "alpha {} harus ditolak", bad);
        }
        for good in [1e-9, 0.5, 1.0, 999.0] {
            assert!(validate_text_alpha(good).is_ok(), "alpha {} harus lolos", good);
        }
    }

    #[test]
    fn alpha_tidak_valid_menggagalkan_train_sebelum_nb_text_train() {
        let cases = golden_train_cases();
        let x = golden_train_matrix();
        let terms = terms_golden();
        let input = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood: config::TextLikelihood::Multinomial,
            alpha: 0.0,
        };
        let result = train_naive_bayes_model_v2(
            &cases,
            &classes_neg_pos(),
            &[],
            &[],
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("alpha"));
    }

    #[test]
    fn complement_campuran_ditolak_dengan_kode_nb_e_complement_mixed() {
        let mixed = validate_text_model_setup(config::TextLikelihood::Complement, 1.0, 1, 0);
        assert!(mixed.unwrap_err().starts_with("NB_E_COMPLEMENT_MIXED"));
        let mixed_numeric =
            validate_text_model_setup(config::TextLikelihood::Complement, 1.0, 0, 2);
        assert!(mixed_numeric
            .unwrap_err()
            .starts_with("NB_E_COMPLEMENT_MIXED"));
        assert!(
            validate_text_model_setup(config::TextLikelihood::Complement, 1.0, 0, 0).is_ok()
        );
        assert!(validate_text_model_setup(config::TextLikelihood::Multinomial, 1.0, 1, 1).is_ok());
        assert!(validate_text_model_setup(config::TextLikelihood::Bernoulli, 1.0, 1, 1).is_ok());
    }

    #[test]
    fn jumlah_baris_atau_term_tidak_sejajar_ditolak_tanpa_panic() {
        let cases = golden_train_cases();
        let x = golden_train_matrix();
        let terms = terms_golden();
        let short_terms = terms[..2].to_vec();
        let bad_terms = TextTrainInput {
            x: &x,
            terms: &short_terms,
            likelihood: config::TextLikelihood::Multinomial,
            alpha: 1.0,
        };
        assert!(train_text_model(&cases, &classes_neg_pos(), &bad_terms)
            .unwrap_err()
            .starts_with("NB_E_TEXT_SHAPE"));

        let good = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood: config::TextLikelihood::Multinomial,
            alpha: 1.0,
        };
        assert!(train_text_model(&cases[..2], &classes_neg_pos(), &good)
            .unwrap_err()
            .starts_with("NB_E_TEXT_SHAPE"));
    }

    // ------------------------------------------------------------------
    // Urutan: align_text_payload -> NotScored dari payload mentah -> vector_to_csr.
    // ------------------------------------------------------------------

    fn vector_payload(rows: Vec<Vec<Option<f64>>>) -> TextPayload {
        TextPayload::Vector {
            columns: vec!["VEC_a".to_string(), "VEC_b".to_string()],
            values: rows,
        }
    }

    #[test]
    fn urutan_negatif_di_baris_target_missing_tidak_menggagalkan_analisis() {
        // Baris 1 (target missing) berisi nilai negatif; baris itu dibuang lebih dulu.
        let payload = vector_payload(vec![
            vec![Some(1.0), Some(0.0)],
            vec![Some(-5.0), Some(2.0)],
            vec![Some(0.0), Some(3.0)],
        ]);
        let kept = vec![0usize, 2usize];
        let data = build_text_feature_data(&payload, &kept, 3)
            .expect("negatif di baris yang dibuang tidak boleh menggagalkan")
            .expect("payload vector");
        assert_eq!(data.x.n_rows, 2);
        assert_eq!(data.missing, vec![false, false]);
        assert_eq!(data.x.to_dense(), vec![vec![1.0, 0.0], vec![0.0, 3.0]]);
    }

    #[test]
    fn urutan_negatif_di_baris_yang_dipakai_tetap_ditolak_dengan_nama_kolom() {
        let payload = vector_payload(vec![
            vec![Some(1.0), Some(0.0)],
            vec![Some(-5.0), Some(2.0)],
            vec![Some(0.0), Some(3.0)],
        ]);
        let kept = vec![0usize, 1usize, 2usize];
        let error = build_text_feature_data(&payload, &kept, 3).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_NEGATIVE"), "{}", error);
        assert!(error.contains("'VEC_a'"), "{}", error);
        assert!(error.contains("(1 column(s) affected)"), "{}", error);
    }

    #[test]
    fn urutan_notscored_ditentukan_dari_payload_mentah_bukan_dari_csr() {
        // Baris 0: semua null -> missing. Baris 1: nilai 0 eksplisit -> BUKAN missing.
        // Setelah `vector_to_csr` keduanya baris kosong yang identik.
        let payload = vector_payload(vec![
            vec![None, None],
            vec![Some(0.0), Some(0.0)],
            vec![None, Some(2.0)],
        ]);
        let kept = vec![0usize, 1usize, 2usize];
        let data = build_text_feature_data(&payload, &kept, 3)
            .expect("payload valid")
            .expect("payload vector");
        assert_eq!(data.missing, vec![true, false, false]);
        let dense = data.x.to_dense();
        assert_eq!(dense[0], dense[1]);
        assert_eq!(dense[0], vec![0.0, 0.0]);
    }

    #[test]
    fn baris_target_missing_tidak_ikut_menentukan_not_scored() {
        let payload = vector_payload(vec![
            vec![None, None], // target missing -> dibuang
            vec![Some(1.0), None],
        ]);
        let kept = vec![1usize];
        let data = build_text_feature_data(&payload, &kept, 2)
            .expect("valid")
            .expect("vector");
        assert_eq!(data.missing, vec![false]);
        assert_eq!(data.x.n_rows, 1);
    }

    #[test]
    fn payload_raw_tanpa_konfigurasi_ditolak_dan_none_tidak_menghasilkan_data() {
        // Fase N3b: jalur raw tidak lagi ditolak "belum didukung"; tanpa
        // konfigurasi `Text` galatnya `NB_E_TEXT_CONFIG` (bukan fallback diam-diam).
        let raw = TextPayload::Raw {
            variable: "Teks".to_string(),
            values: vec![Some("a".to_string())],
        };
        let error = build_text_feature_data(&raw, &[0], 1).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_CONFIG"), "{}", error);
        assert!(build_text_feature_data(&TextPayload::None, &[], 0)
            .expect("none valid")
            .is_none());
    }

    #[test]
    fn payload_vector_tanpa_kolom_dan_jumlah_baris_salah_ditolak() {
        let no_columns = TextPayload::Vector {
            columns: vec![],
            values: vec![vec![]],
        };
        assert!(build_text_feature_data(&no_columns, &[0], 1)
            .unwrap_err()
            .starts_with("NB_E_TEXT_SHAPE"));

        let payload = vector_payload(vec![vec![Some(1.0), Some(1.0)]]);
        assert!(build_text_feature_data(&payload, &[0], 5).is_err());
    }

    // ------------------------------------------------------------------
    // Aturan NotScored (sama dengan Apply Model, CATATAN_TAHAP2 §2).
    // ------------------------------------------------------------------

    #[test]
    fn text_row_missing_raw_men_trim_whitespace() {
        let raw = TextPayload::Raw {
            variable: "Teks".to_string(),
            values: vec![
                None,
                Some(String::new()),
                Some("  \t\n ".to_string()),
                Some(" a ".to_string()),
            ],
        };
        assert_eq!(text_row_missing(&raw), vec![true, true, true, false]);
        assert!(text_row_missing(&TextPayload::None).is_empty());
    }

    #[test]
    fn text_row_missing_vector_nol_bukan_missing_dan_non_finite_dianggap_null() {
        let payload = vector_payload(vec![
            vec![None, None],
            vec![Some(f64::NAN), Some(f64::INFINITY)],
            vec![Some(0.0), None],
            vec![Some(1.5), Some(0.0)],
        ]);
        assert_eq!(
            text_row_missing(&payload),
            vec![true, true, false, false]
        );
    }

    #[test]
    fn not_scored_hanya_bila_semua_prediktor_missing() {
        // Hanya-Text: teks missing -> NotScored; teks ada -> diskor.
        assert!(is_row_not_scored(&text_only_case("a"), true));
        assert!(!is_row_not_scored(&text_only_case("a"), false));

        // Ada covariate bernilai -> teks missing tetap diskor (vektor nol).
        assert!(!is_row_not_scored(&numeric_case("a", Some(1.0)), true));
        // Covariate juga missing -> NotScored.
        assert!(is_row_not_scored(&numeric_case("a", None), true));

        // Factor berkategori nyata -> diskor; hanya "(Missing)" -> NotScored.
        let mut with_factor = text_only_case("a");
        with_factor
            .factors
            .insert("Warna".to_string(), "merah".to_string());
        assert!(!is_row_not_scored(&with_factor, true));
        let mut missing_factor = text_only_case("a");
        missing_factor
            .factors
            .insert("Warna".to_string(), FACTOR_MISSING_LABEL.to_string());
        assert!(is_row_not_scored(&missing_factor, true));
    }

    // ------------------------------------------------------------------
    // slice_csr_rows.
    // ------------------------------------------------------------------

    #[test]
    fn slice_csr_rows_mengambil_baris_sesuai_urutan_indeks() {
        let x = csr_from_dense(&[
            vec![1.0, 0.0, 2.0],
            vec![0.0, 0.0, 0.0],
            vec![0.0, 3.0, 0.0],
        ]);
        let sliced = slice_csr_rows(&x, &[2, 0, 1, 99]);
        assert_eq!(sliced.n_rows, 4);
        assert_eq!(sliced.n_cols, 3);
        assert_eq!(
            sliced.to_dense(),
            vec![
                vec![0.0, 3.0, 0.0],
                vec![1.0, 0.0, 2.0],
                vec![0.0, 0.0, 0.0],
                vec![0.0, 0.0, 0.0],
            ]
        );
        assert_eq!(slice_csr_rows(&x, &[]).n_rows, 0);
    }

    // ------------------------------------------------------------------
    // Evaluasi holdout/fold memakai baris yang sama untuk Text.
    // ------------------------------------------------------------------

    fn six_docs() -> (Vec<PreprocessedCase>, TextFeatureData) {
        let cases = vec![
            text_only_case("a"),
            text_only_case("a"),
            text_only_case("b"),
            text_only_case("b"),
            text_only_case("a"), // evaluasi: [4,0] -> a
            text_only_case("b"), // evaluasi: teks missing -> NotScored
        ];
        let x = csr_from_dense(&[
            vec![3.0, 0.0],
            vec![2.0, 1.0],
            vec![0.0, 3.0],
            vec![1.0, 2.0],
            vec![4.0, 0.0],
            vec![0.0, 0.0],
        ]);
        let data = TextFeatureData {
            terms: vec!["t1".to_string(), "t2".to_string()],
            x,
            missing: vec![false, false, false, false, false, true],
        };
        (cases, data)
    }

    #[test]
    fn evaluasi_memakai_baris_yang_sama_dan_mengeluarkan_notscored() {
        let (cases, data) = six_docs();
        let v2 = V2Context {
            numeric: NumericLikelihoodSpec::default(),
            text: Some(TextContext {
                data,
                likelihood: config::TextLikelihood::Multinomial,
                alpha: 1.0,
                raw: None,
            }),
        };
        let classes = vec!["a".to_string(), "b".to_string()];
        let (actual, predicted, not_scored) = train_and_predict_v2(
            &cases,
            &[0, 1, 2, 3],
            &[4, 5],
            &classes,
            &[],
            &[],
            1.0,
            1e-9,
            &v2,
        )
        .expect("evaluasi v2");
        assert_eq!(not_scored, 1);
        assert_eq!(actual, vec!["a".to_string()]);
        assert_eq!(predicted, vec!["a".to_string()]);
    }

    #[test]
    fn urutan_indeks_evaluasi_menentukan_baris_text_yang_dipakai() {
        // Holdout dengan indeks latih/uji TIDAK berurutan: baris Text harus
        // mengikuti indeks yang sama, bukan posisi.
        let (cases, data) = six_docs();
        let v2 = V2Context {
            numeric: NumericLikelihoodSpec::default(),
            text: Some(TextContext {
                data,
                likelihood: config::TextLikelihood::Multinomial,
                alpha: 1.0,
                raw: None,
            }),
        };
        let classes = vec!["a".to_string(), "b".to_string()];
        // Latih di [5,3,0,2,1] (baris 5 = vektor nol berlabel b), uji [4].
        let (actual, predicted, not_scored) = train_and_predict_v2(
            &cases,
            &[5, 3, 0, 2, 1],
            &[4],
            &classes,
            &[],
            &[],
            1.0,
            1e-9,
            &v2,
        )
        .expect("evaluasi v2");
        assert_eq!(not_scored, 0);
        assert_eq!(actual, vec!["a".to_string()]);
        assert_eq!(predicted, vec!["a".to_string()]);
    }

    #[test]
    fn teks_missing_dengan_prediktor_lain_tetap_diskor() {
        let classes = vec!["a".to_string(), "b".to_string()];
        let cases = vec![
            numeric_case("a", Some(1.0)),
            numeric_case("a", Some(2.0)),
            numeric_case("b", Some(9.0)),
            numeric_case("b", Some(10.0)),
            numeric_case("a", Some(1.5)), // evaluasi: teks missing, covariate ada
        ];
        let x = csr_from_dense(&[
            vec![1.0],
            vec![1.0],
            vec![1.0],
            vec![1.0],
            vec![0.0],
        ]);
        let data = TextFeatureData {
            terms: vec!["t1".to_string()],
            x,
            missing: vec![false, false, false, false, true],
        };
        let v2 = V2Context {
            numeric: NumericLikelihoodSpec::default(),
            text: Some(TextContext {
                data,
                likelihood: config::TextLikelihood::Bernoulli,
                alpha: 1.0,
                raw: None,
            }),
        };
        let (actual, predicted, not_scored) = train_and_predict_v2(
            &cases,
            &[0, 1, 2, 3],
            &[4],
            &classes,
            &[],
            &["x".to_string()],
            1.0,
            1e-9,
            &v2,
        )
        .expect("evaluasi v2");
        assert_eq!(not_scored, 0);
        assert_eq!(actual, vec!["a".to_string()]);
        assert_eq!(predicted, vec!["a".to_string()]);
    }

    // ------------------------------------------------------------------
    // Regresi v1: v2 tanpa Text dan Gaussian biasa = v1.
    // ------------------------------------------------------------------

    #[test]
    fn v2_tanpa_text_dan_gaussian_biasa_sama_dengan_v1() {
        let factor_case = |target: &str, outlook: &str, temp: f64| {
            let mut factors = HashMap::new();
            factors.insert("Outlook".to_string(), outlook.to_string());
            let mut covariates = HashMap::new();
            covariates.insert("Temp".to_string(), Some(temp));
            PreprocessedCase {
                target_class: target.to_string(),
                factors,
                covariates,
            }
        };
        let cases = vec![
            factor_case("Yes", "Sunny", 70.0),
            factor_case("Yes", "Sunny", 72.0),
            factor_case("Yes", "Rain", 74.0),
            factor_case("No", "Sunny", 80.0),
            factor_case("No", "Overcast", 82.0),
            factor_case("No", "Overcast", 90.0),
        ];
        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let v1 =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);
        let v2 = train_naive_bayes_model_v2(
            &cases,
            &classes,
            &factor_names,
            &covariate_names,
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            None,
        )
        .expect("v2 tanpa Text");

        assert_eq!(v1.class_priors, v2.class_priors);
        assert_eq!(v1.gaussian, v2.gaussian);
        assert_eq!(v1.categorical, v2.categorical);
        assert!(v2.text.is_none());
        assert!(v2.numeric_min_variance.is_empty());

        let context = V2Context {
            numeric: NumericLikelihoodSpec::default(),
            text: None,
        };
        assert!(context.is_v1_equivalent(&covariate_names));
    }

    // ------------------------------------------------------------------
    // End-to-end `build_v2_context` dengan AnalysisData nyata.
    // ------------------------------------------------------------------

    fn nb_config(target: &str) -> NaiveBayesConfig {
        use crate::models::config::{MainConfig, OptionsConfig, OutputConfig, ValidationConfig};
        NaiveBayesConfig {
            main: MainConfig {
                target_var: Some(target.to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: OptionsConfig {
                missing_value_policy: String::new(),
                unseen_category_policy: String::new(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: None,
            },
            output: OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        }
    }

    /// Dataset hanya-target (tanpa predictor Numeric/Categorical).
    fn target_only_data(labels: &[Option<&str>]) -> AnalysisData {
        use crate::models::data::{DataRecord, DataValue};
        let slice: Vec<DataRecord> = labels
            .iter()
            .map(|label| DataRecord {
                values: HashMap::from([(
                    "Class".to_string(),
                    match label {
                        Some(text) => DataValue::Text((*text).to_string()),
                        None => DataValue::Null,
                    },
                )]),
            })
            .collect();
        AnalysisData {
            target_data: vec![slice],
            predictors_data: vec![],
            target_data_defs: vec![],
            predictors_data_defs: vec![],
        }
    }

    fn preprocess_text_only(data: &AnalysisData, config: &NaiveBayesConfig) -> PreprocessedData {
        crate::stats::preprocess_data::preprocess_naive_bayes_data_v2(data, config, true)
            .expect("model hanya-Text harus lolos preprocessing")
    }

    #[test]
    fn end_to_end_negatif_di_baris_target_missing_tidak_menggagalkan_analisis() {
        let data = target_only_data(&[Some("A"), None, Some("B"), Some("A")]);
        let config = nb_config("Class");
        let payload = vector_payload(vec![
            vec![Some(1.0), Some(0.0)],
            vec![Some(-7.0), Some(1.0)], // baris target missing: negatif TIDAK boleh menggagalkan
            vec![Some(0.0), Some(2.0)],
            vec![Some(3.0), None],
        ]);
        let preprocessed = preprocess_text_only(&data, &config);
        let context = build_v2_context(
            &data,
            &config,
            &NaiveBayesConfigV2::default(),
            &payload,
            &preprocessed,
        )
        .expect("negatif di baris target-missing tidak boleh menggagalkan analisis");
        let text = context.text.as_ref().expect("konteks Text");
        assert_eq!(text.data.x.n_rows, 3);
        assert_eq!(text.data.missing, vec![false, false, false]);
        assert_eq!(
            text.data.x.to_dense(),
            vec![vec![1.0, 0.0], vec![0.0, 2.0], vec![3.0, 0.0]]
        );
        assert!(!context.is_v1_equivalent(&[]));
    }

    #[test]
    fn end_to_end_negatif_di_baris_valid_ditolak_dengan_nama_kolom_pertama() {
        let data = target_only_data(&[Some("A"), None, Some("B")]);
        let config = nb_config("Class");
        let payload = vector_payload(vec![
            vec![Some(1.0), Some(-1.0)], // baris valid dengan negatif di kolom VEC_b
            vec![Some(0.0), Some(1.0)],
            vec![Some(2.0), Some(2.0)],
        ]);
        let preprocessed = preprocess_text_only(&data, &config);
        let error = build_v2_context(
            &data,
            &config,
            &NaiveBayesConfigV2::default(),
            &payload,
            &preprocessed,
        )
        .unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_NEGATIVE"), "{}", error);
        assert!(error.contains("'VEC_b'"), "{}", error);
    }

    #[test]
    fn end_to_end_sumber_teks_diambil_dari_payload_bukan_dari_config() {
        let data = target_only_data(&[Some("A"), Some("B")]);
        let config = nb_config("Class");
        let preprocessed = preprocess_text_only(&data, &config);

        // Config mengaku "raw" tetapi payload "vector": payload yang menang.
        let mut config_v2 = NaiveBayesConfigV2::default();
        config_v2.main.text_source = config::TextSource::Raw;
        let vector = vector_payload(vec![vec![Some(1.0), Some(0.0)], vec![Some(0.0), Some(1.0)]]);
        let context = build_v2_context(&data, &config, &config_v2, &vector, &preprocessed)
            .expect("payload vector diproses walau config.TextSource = raw");
        assert!(context.text.is_some());

        // Config mengaku "vector" tetapi payload "raw": payload yang menang; tanpa
        // konfigurasi `Text` jalur raw ditolak dengan NB_E_TEXT_CONFIG (Fase N3b).
        let mut config_v2 = NaiveBayesConfigV2::default();
        config_v2.main.text_source = config::TextSource::Vector;
        let raw = TextPayload::Raw {
            variable: "Teks".to_string(),
            values: vec![Some("a".to_string()), Some("b".to_string())],
        };
        let error = build_v2_context(&data, &config, &config_v2, &raw, &preprocessed).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_CONFIG"), "{}", error);
    }

    #[test]
    fn end_to_end_text_none_menghasilkan_konteks_setara_v1() {
        let data = target_only_data(&[Some("A"), Some("B")]);
        let config = nb_config("Class");
        let preprocessed = preprocess_text_only(&data, &config);
        let context = build_v2_context(
            &data,
            &config,
            &NaiveBayesConfigV2::default(),
            &TextPayload::None,
            &preprocessed,
        )
        .expect("tanpa Text");
        assert!(context.text.is_none());
        assert!(context.is_v1_equivalent(&[]));
    }

    #[test]
    fn end_to_end_alpha_tidak_valid_dan_complement_campuran_ditolak() {
        let data = target_only_data(&[Some("A"), Some("B")]);
        let config = nb_config("Class");
        let payload = vector_payload(vec![vec![Some(1.0), Some(0.0)], vec![Some(0.0), Some(1.0)]]);
        let preprocessed = preprocess_text_only(&data, &config);

        let mut bad_alpha = NaiveBayesConfigV2::default();
        bad_alpha.options.text_alpha = 0.0;
        assert!(build_v2_context(&data, &config, &bad_alpha, &payload, &preprocessed).is_err());

        // Complement + satu factor Categorical -> NB_E_COMPLEMENT_MIXED.
        let mut mixed = preprocessed.clone();
        mixed.factor_names = vec!["Warna".to_string()];
        let mut complement = NaiveBayesConfigV2::default();
        complement.options.text_likelihood = config::TextLikelihood::Complement;
        let error =
            build_v2_context(&data, &config, &complement, &payload, &mixed).unwrap_err();
        assert!(error.starts_with("NB_E_COMPLEMENT_MIXED"), "{}", error);

        // Complement hanya-Text tetap sah.
        assert!(build_v2_context(&data, &config, &complement, &payload, &preprocessed).is_ok());
    }
}
