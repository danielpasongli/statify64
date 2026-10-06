// naive-bayes/rust/src/stats/raw_text.rs
//
// Fase N3b (PLAN_V2) — jalur Raw Text anti-leakage (AGENTS_V2 V7 / §7, gerbang G3).
//
// Kontrak: `naive-bayes/AGENTS_V2.md` §7 dan §11,
// `plan-reports-v2/CATATAN_TAHAP2_negatif_dan_notscored.md`, serta API `CORE`
// (`statify_text_core::{fit, transform, fit_transform}`, PLAN_FIX §3.4).
//
// === Prinsip anti-leakage (V7) ===
//
// Pada jalur Raw Text, kosakata/IDF di-*fit* HANYA pada data latih tiap
// evaluasi (holdout atau satu fold):
//
//   1. `model_text = CORE::fit(docs_latih, cfg_text)`
//      `X_latih    = transform(model_text, docs_latih)`
//      `X_uji      = transform(model_text, docs_uji)`        -> `fit_split`
//   2. likelihood Text dilatih di `X_latih`, `X_uji` diskor (`text_features`).
//   3. kosakata kosong -> `NB_E_TEXT_EMPTY_VOCAB_FOLD` (menyebut holdout/fold).
//
// Model final di-*fit* pada SELURUH baris valid (`build_raw_text_context`);
// resepnya (`RawTextContext::final_recipe`) disimpan di model terlatih supaya
// Fase N4 dapat mengekspornya sebagai `text.recipe`.
//
// MATRIKS HASIL FIT GLOBAL (`TextFeatureData::x` untuk jalur raw) HANYA
// BOLEH dipakai oleh model final. Evaluasi holdout/k-fold WAJIB lewat
// `fit_split`; `text_features::prepare_split_text` yang menegakkannya.
//
// === Titik masuk (BUKAN jalur paralel) ===
//
// Berkas ini tidak punya orkestrasi sendiri. `text_features::build_v2_context`
// memanggil `build_raw_text_context` (menggantikan cabang penolakan raw milik
// N3a) dan `text_features::train_and_predict_v2_split` memanggil `fit_split`.
// Urutan wajib tetap: align_text_payload -> NotScored dari payload mentah ->
// CSR (lihat kepala `text_features.rs`).
//
// Mesin teks hanya `CORE` (P-V2): tidak ada tokenizer/vectorizer di sini.
use statify_text_core::{
    self as text_core, CsrMatrix, TextError, TextVectorizerConfig, TextVectorizerModel,
};

/// Label evaluasi untuk pesan galat (nomor fold dimulai dari 1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SplitLabel {
    /// Pemanggil tidak menyebutkan jenis evaluasi (mis. test unit).
    Unspecified,
    Holdout,
    /// Nomor fold 1-based (sama dengan yang dilihat pengguna).
    Fold(usize),
}

impl SplitLabel {
    fn describe(&self) -> String {
        match self {
            SplitLabel::Unspecified => "this evaluation".to_string(),
            SplitLabel::Holdout => "the holdout split".to_string(),
            SplitLabel::Fold(number) => format!("fold {}", number),
        }
    }
}

/// Konteks jalur Raw Text untuk satu run: dokumen yang sudah diselaraskan
/// dengan baris valid (target tidak missing), konfigurasi pipeline teks, dan
/// resep hasil fit pada SELURUH baris valid (model final).
#[derive(Debug, Clone)]
pub struct RawTextContext {
    /// Nama Raw Text Variable (untuk export `raw_variable` di Fase N4).
    pub variable: String,
    /// Dokumen sejajar `PreprocessedData::cases` (`null` -> `""`).
    pub docs: Vec<String>,
    /// Konfigurasi `Text` dari TS (`toRustConfig(formData.text)`).
    pub config: TextVectorizerConfig,
    /// Resep model final (fit di seluruh baris valid).
    pub final_recipe: TextVectorizerModel,
}

/// Hasil vektorisasi satu evaluasi: matriks latih/uji, nama term sejajar
/// kolom, dan (jalur raw) resep yang di-*fit* pada data latih evaluasi itu.
#[derive(Debug, Clone)]
pub struct SplitText {
    pub train_x: CsrMatrix,
    pub eval_x: CsrMatrix,
    pub terms: Vec<String>,
    /// `Some` hanya untuk jalur raw; jalur vector tidak melakukan fit.
    pub recipe: Option<TextVectorizerModel>,
}

enum ErrorScope<'a> {
    Final,
    Split(&'a SplitLabel),
}

/// Petakan `TextError` dari CORE ke kode galat NB (AGENTS_V2 §11).
///   - kosakata kosong / semua dokumen kosong -> `NB_E_TEXT_EMPTY_VOCAB`
///     (model final) atau `NB_E_TEXT_EMPTY_VOCAB_FOLD` (holdout/fold);
///   - selain itu (`INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, ...)
///     -> `NB_E_TEXT_CONFIG: [kode] pesan asli` (pesan asli diteruskan).
fn map_core_error(err: &TextError, scope: &ErrorScope<'_>) -> String {
    match err.code.as_str() {
        "EMPTY_VOCABULARY" | "EMPTY_INPUT" => match scope {
            ErrorScope::Final => {
                "NB_E_TEXT_EMPTY_VOCAB: The text vocabulary is empty after preprocessing all rows. Relax the Text Preprocessing settings."
                    .to_string()
            }
            ErrorScope::Split(label) => format!(
                "NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of {}. Relax the Text Preprocessing settings (e.g. Words to Keep, Min term frequency, stopwords) or use fewer folds.",
                label.describe()
            ),
        },
        _ => format!("NB_E_TEXT_CONFIG: [{}] {}", err.code, err.message),
    }
}

/// Ambil dokumen berindeks `indices` (urutan mengikuti `indices`). Indeks di
/// luar rentang menjadi dokumen kosong (tanpa panic).
fn pick_docs(docs: &[String], indices: &[usize]) -> Vec<String> {
    indices
        .iter()
        .map(|&index| docs.get(index).cloned().unwrap_or_default())
        .collect()
}

/// Matriks CSR tanpa baris (untuk himpunan evaluasi kosong).
fn empty_csr(n_cols: usize) -> CsrMatrix {
    CsrMatrix {
        n_rows: 0,
        n_cols,
        indptr: vec![0],
        indices: Vec::new(),
        data: Vec::new(),
    }
}

/// Bangun konteks Raw Text dan fit MODEL FINAL pada seluruh `docs`
/// (sudah selaras dengan baris valid). Mengembalikan konteks beserta matriks
/// hasil fit global — matriks itu HANYA untuk model final (lihat kepala berkas).
///
/// `config` = `NaiveBayesConfigV2::text`; bila `None` (TS tidak mengirim
/// `Text`) galat `NB_E_TEXT_CONFIG`, bukan fallback diam-diam.
pub fn build_raw_text_context(
    variable: &str,
    docs: Vec<String>,
    config: Option<&TextVectorizerConfig>,
) -> Result<(RawTextContext, CsrMatrix), String> {
    let config = config.ok_or_else(|| {
        "NB_E_TEXT_CONFIG: The Text Preprocessing settings were not provided, although the text source is a Raw Text Variable."
            .to_string()
    })?;

    let (final_recipe, x) = text_core::fit_transform(&docs, config)
        .map_err(|err| map_core_error(&err, &ErrorScope::Final))?;

    Ok((
        RawTextContext {
            variable: variable.to_string(),
            docs,
            config: config.clone(),
            final_recipe,
        },
        x,
    ))
}

/// Vektorisasi SATU evaluasi tanpa kebocoran: fit di `train_indices`, lalu
/// transform data latih dan data uji (`eval_indices`) dengan resep yang sama.
/// Kata yang hanya muncul di data uji TIDAK masuk kosakata (T18).
pub fn fit_split(
    context: &RawTextContext,
    train_indices: &[usize],
    eval_indices: &[usize],
    label: &SplitLabel,
) -> Result<SplitText, String> {
    let scope = ErrorScope::Split(label);

    let train_docs = pick_docs(&context.docs, train_indices);
    let (recipe, train_x) = text_core::fit_transform(&train_docs, &context.config)
        .map_err(|err| map_core_error(&err, &scope))?;

    // `CORE::transform` menolak array dokumen kosong; himpunan uji kosong
    // (kasus degenerate) cukup menghasilkan matriks tanpa baris.
    let eval_x = if eval_indices.is_empty() {
        empty_csr(recipe.vocabulary.len())
    } else {
        let eval_docs = pick_docs(&context.docs, eval_indices);
        text_core::transform(&recipe, &eval_docs).map_err(|err| map_core_error(&err, &scope))?
    };

    Ok(SplitText {
        train_x,
        eval_x,
        terms: recipe.vocabulary.clone(),
        recipe: Some(recipe),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use statify_text_core::nb_text;

    use crate::models::config::{
        MainConfig, NaiveBayesConfig, NaiveBayesConfigV2, OptionsConfig, OutputConfig,
        ValidationConfig,
    };
    use crate::models::data::{AnalysisData, DataRecord, DataValue, TextPayload};
    use crate::stats::preprocess_data::preprocess_naive_bayes_data_v2;
    use crate::stats::text_features::{
        build_v2_context, prepare_split_text, retrain_final_model_v2, train_and_predict_v2_split,
    };
    use crate::utils::error::ErrorCollector;
    use crate::wasm::function::run_analysis;

    const TOL: f64 = 1e-6;

    /// Konfigurasi Weka default (raw/none/none, lowercase, tanpa stopword/stemming).
    fn weka_cfg() -> TextVectorizerConfig {
        TextVectorizerConfig::from_json_value(serde_json::json!({
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

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
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

    fn nb_config(method: &str, k_folds: i32, seed: Option<i64>) -> NaiveBayesConfig {
        NaiveBayesConfig {
            main: MainConfig {
                target_var: Some("Class".to_string()),
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
                validation_method: method.to_string(),
                training_percentage: 70.0,
                k_folds,
                random_seed: seed,
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

    fn raw_payload(docs: &[Option<&str>]) -> TextPayload {
        TextPayload::Raw {
            variable: "Teks".to_string(),
            values: docs
                .iter()
                .map(|doc| doc.map(|text| text.to_string()))
                .collect(),
        }
    }

    fn config_v2_with_text() -> NaiveBayesConfigV2 {
        let mut config_v2 = NaiveBayesConfigV2::default();
        config_v2.text = Some(weka_cfg());
        config_v2
    }

    // ------------------------------------------------------------------
    // T18: tidak ada kebocoran kosakata dari data uji.
    // ------------------------------------------------------------------

    #[test]
    fn t18_kata_yang_hanya_ada_di_data_uji_tidak_masuk_kosakata_split() {
        let docs = strings(&["makan nasi", "tidak suka", "makan rahasia"]);
        let (context, _global_x) =
            build_raw_text_context("Teks", docs, Some(&weka_cfg())).expect("konteks raw");

        // Model final (seluruh baris valid) memang memuat "rahasia" ...
        assert!(context.final_recipe.vocabulary.contains(&"rahasia".to_string()));

        // ... tetapi evaluasi holdout (latih [0,1], uji [2]) TIDAK boleh.
        let split = fit_split(&context, &[0, 1], &[2], &SplitLabel::Holdout).expect("fit_split");
        assert!(!split.terms.contains(&"rahasia".to_string()));
        assert_eq!(split.terms, strings(&["makan", "nasi", "suka", "tidak"]));
        assert_eq!(split.eval_x.n_cols, split.terms.len());
        assert_eq!(split.train_x.n_rows, 2);
        assert_eq!(split.eval_x.n_rows, 1);

        // Baris uji = "makan rahasia" -> hanya "makan" yang dikenal (OOV diabaikan).
        let dense = split.eval_x.to_dense();
        assert_eq!(dense, vec![vec![1.0, 0.0, 0.0, 0.0]]);
    }

    #[test]
    fn t18_jalur_evaluasi_text_features_memakai_fit_split_bukan_matriks_global() {
        // `prepare_split_text` adalah satu-satunya jalan evaluasi memperoleh
        // matriks Text; pada jalur raw terms-nya harus dari fit data latih.
        let data = target_only_data(&[Some("a"), Some("b"), Some("a")]);
        let config = nb_config("holdout", 10, None);
        let pre = preprocess_naive_bayes_data_v2(&data, &config, true).expect("preprocess");
        let payload = raw_payload(&[Some("makan nasi"), Some("tidak suka"), Some("makan rahasia")]);
        let v2 = build_v2_context(&data, &config, &config_v2_with_text(), &payload, &pre)
            .expect("konteks v2");
        let text = v2.text.as_ref().expect("Text aktif");
        assert!(text.raw.is_some());
        // Hasil fit global (khusus model final) memuat "rahasia".
        assert!(text.data.terms.contains(&"rahasia".to_string()));

        let split = prepare_split_text(text, &[0, 1], &[2], &SplitLabel::Fold(1)).expect("split");
        assert!(!split.terms.contains(&"rahasia".to_string()));
        assert!(split.recipe.is_some());
    }

    // ------------------------------------------------------------------
    // Model final jalur raw = golden Multinomial §6.7.
    // ------------------------------------------------------------------

    #[test]
    fn model_final_raw_golden_log_weights_dan_skor_sama_dengan_ln_prior_plus_score_rows() {
        let data = target_only_data(&[Some("pos"), Some("neg"), Some("pos")]);
        let config = nb_config("holdout", 10, None);
        let pre = preprocess_naive_bayes_data_v2(&data, &config, true).expect("preprocess");
        assert_eq!(pre.classes, strings(&["neg", "pos"]));

        let payload = raw_payload(&[
            Some("Saya suka makan nasi"),
            Some("Saya tidak suka nasi!"),
            Some("Makan, makan, makan"),
        ]);
        let v2 = build_v2_context(&data, &config, &config_v2_with_text(), &payload, &pre)
            .expect("konteks v2");
        let model = retrain_final_model_v2(&pre, &config, &v2).expect("model final");
        let text = model.text.as_ref().expect("model Text");

        assert_eq!(text.terms, strings(&["makan", "nasi", "saya", "suka", "tidak"]));
        let expected = [
            [-2.197225, -1.504077, -1.504077, -1.504077, -1.504077],
            [-0.875469, -1.791759, -1.791759, -1.791759, -2.484907],
        ];
        for (class_idx, row) in expected.iter().enumerate() {
            for (term_idx, &value) in row.iter().enumerate() {
                assert_close(
                    text.params.log_weights[class_idx][term_idx],
                    value,
                    &format!("log_weights[{}][{}]", class_idx, term_idx),
                );
            }
        }

        // Resep final tersimpan (untuk export `text.recipe` di Fase N4).
        let recipe = text.recipe.as_ref().expect("resep model final");
        assert_eq!(recipe.vocabulary, text.terms);

        // Skor NB = ln prior (uses_class_prior) + CORE::nb_text::score_rows (P-V3).
        assert!(text.params.uses_class_prior);
        let xt = text_core::transform(recipe, &strings(&["makan nasi enak"])).expect("transform");
        let rows = nb_text::score_rows(&text.params, &xt);
        let prior_neg = model.class_priors.priors["neg"];
        let prior_pos = model.class_priors.priors["pos"];
        let neg = prior_neg.ln() + rows[0][0];
        let pos = prior_pos.ln() + rows[0][1];
        assert_close(neg, -4.799914, "skor neg");
        assert_close(pos, -3.072693, "skor pos");
        let p_pos = 1.0 / (1.0 + (neg - pos).exp());
        assert_close(p_pos, 0.849057, "P(pos)");
    }

    // ------------------------------------------------------------------
    // k-fold / holdout lewat `run_analysis`.
    // ------------------------------------------------------------------

    fn twenty_docs() -> (Vec<String>, Vec<String>) {
        let mut labels = Vec::new();
        let mut docs = Vec::new();
        for i in 0..10 {
            labels.push("pos".to_string());
            docs.push(format!("bagus mantap senang puas unik{}", i));
            labels.push("neg".to_string());
            docs.push(format!("buruk jelek sedih kecewa unik{}", i + 100));
        }
        (labels, docs)
    }

    fn run_raw_analysis(method: &str, seed: Option<i64>) -> serde_json::Value {
        let (labels, docs) = twenty_docs();
        let label_refs: Vec<Option<&str>> = labels.iter().map(|l| Some(l.as_str())).collect();
        let doc_refs: Vec<Option<&str>> = docs.iter().map(|d| Some(d.as_str())).collect();
        let data = target_only_data(&label_refs);
        let config = nb_config(method, 5, seed);
        let mut errors = ErrorCollector::default();
        let result = run_analysis(
            &data,
            &config,
            &config_v2_with_text(),
            &raw_payload(&doc_refs),
            &mut errors,
        )
        .unwrap_or_else(|| panic!("analisis raw harus berhasil: {}", errors.get_error_summary()));
        serde_json::to_value(&result).expect("serialisasi hasil")
    }

    #[test]
    fn kfold_raw_dengan_seed_tetap_deterministik() {
        let first = run_raw_analysis("kfold", Some(7));
        let second = run_raw_analysis("kfold", Some(7));
        assert_eq!(first["confusion_matrix"], second["confusion_matrix"]);
        assert_eq!(first["evaluation_metrics"], second["evaluation_metrics"]);
        // Semua 20 baris valid dievaluasi tepat sekali di k-fold.
        assert_eq!(first["confusion_matrix"]["grand_total"], 20);
    }

    #[test]
    fn holdout_raw_berjalan_dan_menghasilkan_evaluasi() {
        let result = run_raw_analysis("holdout", Some(7));
        let grand_total = result["confusion_matrix"]["grand_total"]
            .as_u64()
            .expect("grand_total");
        assert!(grand_total > 0 && grand_total < 20);
    }

    // ------------------------------------------------------------------
    // Galat dari CORE dipetakan ke kode NB (AGENTS_V2 §11).
    // ------------------------------------------------------------------

    #[test]
    fn kosakata_fold_kosong_menghasilkan_kode_fold_dengan_nomor_fold() {
        let docs = strings(&["makan nasi", "!!!", "???", "saya"]);
        let (context, _x) =
            build_raw_text_context("Teks", docs, Some(&weka_cfg())).expect("konteks raw");
        // Data latih fold ke-2 hanya berisi tanda baca -> kosakata kosong.
        let error = fit_split(&context, &[1, 2], &[0], &SplitLabel::Fold(2)).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_EMPTY_VOCAB_FOLD"), "{}", error);
        assert!(error.contains("training data of fold 2."), "{}", error);

        let error = fit_split(&context, &[1, 2], &[0], &SplitLabel::Holdout).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_EMPTY_VOCAB_FOLD"), "{}", error);
        assert!(error.contains("of the holdout split."), "{}", error);
    }

    #[test]
    fn kosakata_model_final_kosong_menghasilkan_kode_empty_vocab() {
        let docs = strings(&["!!!", "???"]);
        let error = build_raw_text_context("Teks", docs, Some(&weka_cfg())).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_EMPTY_VOCAB:"), "{}", error);
    }

    #[test]
    fn konfigurasi_tidak_valid_diteruskan_sebagai_nb_e_text_config() {
        let mut cfg = weka_cfg();
        cfg.delimiters = "(".to_string();
        let error =
            build_raw_text_context("Teks", strings(&["makan nasi"]), Some(&cfg)).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_CONFIG"), "{}", error);
        assert!(error.contains("INVALID_REGEX"), "{}", error);
    }

    #[test]
    fn konfigurasi_text_tidak_dikirim_ditolak_bukan_fallback_diam_diam() {
        let error = build_raw_text_context("Teks", strings(&["makan nasi"]), None).unwrap_err();
        assert!(error.starts_with("NB_E_TEXT_CONFIG"), "{}", error);
    }

    // ------------------------------------------------------------------
    // NotScored pada jalur raw (CATATAN_TAHAP2 §2) + urutan baris.
    // ------------------------------------------------------------------

    #[test]
    fn teks_raw_kosong_tanpa_prediktor_lain_notscored_dan_tidak_masuk_evaluasi() {
        let data = target_only_data(&[
            Some("a"),
            Some("a"),
            Some("b"),
            Some("b"),
            Some("a"),
            Some("b"),
        ]);
        let config = nb_config("holdout", 10, None);
        let pre = preprocess_naive_bayes_data_v2(&data, &config, true).expect("preprocess");
        let payload = raw_payload(&[
            Some("aaa x"),
            Some("aaa"),
            Some("bbb y"),
            Some("bbb"),
            Some("aaa"),
            Some("   "), // whitespace = missing (V11)
        ]);
        let v2 = build_v2_context(&data, &config, &config_v2_with_text(), &payload, &pre)
            .expect("konteks v2");

        let (actual, predicted, not_scored) = train_and_predict_v2_split(
            &pre.cases,
            &[0, 1, 2, 3],
            &[4, 5],
            &pre.classes,
            &pre.factor_names,
            &pre.covariate_names,
            1.0,
            1e-9,
            &v2,
            &SplitLabel::Fold(1),
        )
        .expect("evaluasi raw");
        assert_eq!(not_scored, 1);
        assert_eq!(actual, strings(&["a"]));
        assert_eq!(predicted, strings(&["a"]));
    }

    #[test]
    fn baris_target_missing_ikut_terbuang_dari_dokumen_raw() {
        // Baris ke-2 target missing: dokumennya ("bocor") tidak boleh ikut fit.
        let data = target_only_data(&[Some("a"), None, Some("b")]);
        let config = nb_config("holdout", 10, None);
        let pre = preprocess_naive_bayes_data_v2(&data, &config, true).expect("preprocess");
        let payload = raw_payload(&[Some("aaa"), Some("bocor"), Some("bbb")]);
        let v2 = build_v2_context(&data, &config, &config_v2_with_text(), &payload, &pre)
            .expect("konteks v2");
        let text = v2.text.expect("Text aktif");
        let raw = text.raw.expect("konteks raw");
        assert_eq!(raw.docs, strings(&["aaa", "bbb"]));
        assert_eq!(text.data.terms, strings(&["aaa", "bbb"]));
        assert_eq!(text.data.x.n_rows, pre.cases.len());
    }
}
