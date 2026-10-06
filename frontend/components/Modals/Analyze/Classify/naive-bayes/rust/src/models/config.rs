// Struct konfigurasi Naive Bayes — bentuknya mengikuti persis
// `NaiveBayesType` di sisi TypeScript
// (`naive-bayes/types/naive-bayes.ts`), termasuk rename field ke
// PascalCase supaya cocok dengan payload JSON yang dikirim dari
// `naive-bayes-analysis.ts` (field `config`). Lihat AGENTS.md §4 untuk
// makna tiap field. Fase 8 ini hanya perlu struct-nya bisa di-parse
// (constructor.rs); belum ada logika yang membaca isinya untuk menghitung
// apa pun (itu Fase 9+).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NaiveBayesConfig {
    pub main: MainConfig,
    pub options: OptionsConfig,
    pub validation: ValidationConfig,
    pub output: OutputConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MainConfig {
    #[serde(rename = "TargetVar")]
    pub target_var: Option<String>,
    #[serde(rename = "ExcludedVar")]
    pub excluded_var: Option<Vec<String>>,
    #[serde(rename = "CandidateFactors")]
    pub candidate_factors: Option<Vec<String>>,
    #[serde(rename = "CandidateCovariates")]
    pub candidate_covariates: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionsConfig {
    #[serde(rename = "MissingValuePolicy")]
    pub missing_value_policy: String,
    #[serde(rename = "UnseenCategoryPolicy")]
    pub unseen_category_policy: String,
    #[serde(rename = "SmoothingAlpha")]
    pub smoothing_alpha: f64,
    #[serde(rename = "VarianceFloor")]
    pub variance_floor: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValidationConfig {
    #[serde(rename = "ValidationMethod")]
    pub validation_method: String,
    #[serde(rename = "TrainingPercentage")]
    pub training_percentage: f64,
    #[serde(rename = "KFolds")]
    pub k_folds: i32,
    #[serde(rename = "RandomSeed")]
    pub random_seed: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OutputConfig {
    #[serde(rename = "CaseProcessingSummary")]
    pub case_processing_summary: bool,
    #[serde(rename = "AttributeDistributionTable")]
    pub attribute_distribution_table: bool,
    #[serde(rename = "ModelEvaluationMetrics")]
    pub model_evaluation_metrics: bool,
    #[serde(rename = "ConfusionMatrix")]
    pub confusion_matrix: bool,
}

// =====================================================================
// Fase N1 (PLAN_V2 / AGENTS_V2 §4–§5.1) — field konfigurasi v2.
//
// KEPUTUSAN: field v2 SENGAJA berada di struct sibling (`*V2`), BUKAN
// ditambahkan ke `MainConfig`/`OptionsConfig`/`OutputConfig`/
// `NaiveBayesConfig` di atas. Test v1 di file milik fase lain
// (`stats/save.rs`, dst.) membangun struct-struct itu lewat literal; menambah
// field akan merusak kompilasinya (P-V1: regresi nol). JSON `config` yang
// sama di-parse dua kali di constructor: struct v1 (mengabaikan field baru,
// serde tidak memakai `deny_unknown_fields`) dan `NaiveBayesConfigV2`
// (mengambil field baru saja). Payload v1 lama otomatis memakai default.
// =====================================================================

/// Likelihood atribut Numeric (AGENTS_V2 V5, §6.4).
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum NumericLikelihood {
    #[default]
    #[serde(rename = "gaussian")]
    Gaussian,
    #[serde(rename = "gaussian_minstd")]
    GaussianMinstd,
}

/// Likelihood kelompok Text (AGENTS_V2 V5, §6.1–6.3).
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextLikelihood {
    #[default]
    #[serde(rename = "multinomial")]
    Multinomial,
    #[serde(rename = "bernoulli")]
    Bernoulli,
    #[serde(rename = "complement")]
    Complement,
}

/// Sumber fitur Text (AGENTS_V2 V2): saling eksklusif.
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextSource {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "raw")]
    Raw,
    #[serde(rename = "vector")]
    Vector,
}

fn default_text_alpha() -> f64 {
    1.0
}

fn default_text_feature_table() -> bool {
    true
}

fn default_text_top_k() -> usize {
    100
}

/// Tambahan `main` v2 (AGENTS_V2 §4). Semua opsional supaya payload v1 valid.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MainConfigV2 {
    #[serde(rename = "TextSource", default)]
    pub text_source: TextSource,
    #[serde(rename = "RawTextVar", default)]
    pub raw_text_var: Option<String>,
    #[serde(rename = "TextVectorVars", default)]
    pub text_vector_vars: Option<Vec<String>>,
}

/// Tambahan `options` v2 (AGENTS_V2 §4). `SmoothingAlpha` (alpha Categorical)
/// tetap di `OptionsConfig` v1.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionsConfigV2 {
    #[serde(rename = "NumericLikelihood", default)]
    pub numeric_likelihood: NumericLikelihood,
    #[serde(rename = "NumericLikelihoodOverrides", default)]
    pub numeric_likelihood_overrides: HashMap<String, NumericLikelihood>,
    #[serde(rename = "TextLikelihood", default)]
    pub text_likelihood: TextLikelihood,
    #[serde(rename = "TextAlpha", default = "default_text_alpha")]
    pub text_alpha: f64,
}

impl Default for OptionsConfigV2 {
    fn default() -> Self {
        OptionsConfigV2 {
            numeric_likelihood: NumericLikelihood::default(),
            numeric_likelihood_overrides: HashMap::new(),
            text_likelihood: TextLikelihood::default(),
            text_alpha: default_text_alpha(),
        }
    }
}

/// Tambahan `output` v2 (AGENTS_V2 §3.7/§4).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OutputConfigV2 {
    #[serde(rename = "TextFeatureTable", default = "default_text_feature_table")]
    pub text_feature_table: bool,
    #[serde(rename = "TextTopK", default = "default_text_top_k")]
    pub text_top_k: usize,
}

impl Default for OutputConfigV2 {
    fn default() -> Self {
        OutputConfigV2 {
            text_feature_table: default_text_feature_table(),
            text_top_k: default_text_top_k(),
        }
    }
}

/// Seluruh field konfigurasi v2. `text` = `Text` tingkat atas pada JSON
/// `config` (hasil `toRustConfig(formData.text)`, snake_case, kontrak CORE
/// PLAN_FIX §3.1); `None` bila payload v1 atau bernilai `null`.
#[derive(Debug, Clone, Default)]
pub struct NaiveBayesConfigV2 {
    pub main: MainConfigV2,
    pub options: OptionsConfigV2,
    pub output: OutputConfigV2,
    pub text: Option<statify_text_core::TextVectorizerConfig>,
}

/// Bentuk JSON mentah `NaiveBayesConfigV2`; `Text` dibaca sebagai `Value`
/// dulu supaya galat CORE (`INVALID_CONFIG`, dst.) diteruskan dengan pesan
/// aslinya (AGENTS_V2 §11 `NB_E_TEXT_CONFIG`).
#[derive(Deserialize)]
struct NaiveBayesConfigV2Raw {
    #[serde(default)]
    main: MainConfigV2,
    #[serde(default)]
    options: OptionsConfigV2,
    #[serde(default)]
    output: OutputConfigV2,
    #[serde(rename = "Text", default)]
    text: Option<serde_json::Value>,
}

/// Parse field konfigurasi v2 dari JSON `config` yang sama dengan v1.
/// Payload v1 (tanpa field baru) menghasilkan default v2.
/// Pesan error berbahasa Indonesia; galat konfigurasi Text berawalan
/// `NB_E_TEXT_CONFIG` (AGENTS_V2 §11).
pub fn parse_config_v2(value: serde_json::Value) -> Result<NaiveBayesConfigV2, String> {
    let raw: NaiveBayesConfigV2Raw = serde_json::from_value(value)
        .map_err(|e| format!("The Naive Bayes configuration is invalid: {}", e))?;

    let text = match raw.text {
        None | Some(serde_json::Value::Null) => None,
        Some(v) => Some(
            statify_text_core::TextVectorizerConfig::from_json_value(v)
                .map_err(|e| format!("NB_E_TEXT_CONFIG: [{}] {}", e.code, e.message))?,
        ),
    };

    Ok(NaiveBayesConfigV2 {
        main: raw.main,
        options: raw.options,
        output: raw.output,
        text,
    })
}

#[cfg(test)]
mod tests_v2 {
    use super::*;
    use serde_json::json;

    fn v1_config_json() -> serde_json::Value {
        json!({
            "main": {
                "TargetVar": "Class",
                "ExcludedVar": null,
                "CandidateFactors": ["Outlook"],
                "CandidateCovariates": ["Temp"]
            },
            "options": {
                "MissingValuePolicy": "default",
                "UnseenCategoryPolicy": "smoothing",
                "SmoothingAlpha": 1,
                "VarianceFloor": 1e-9
            },
            "validation": {
                "ValidationMethod": "holdout",
                "TrainingPercentage": 70,
                "KFolds": 10,
                "RandomSeed": null
            },
            "output": {
                "CaseProcessingSummary": true,
                "AttributeDistributionTable": true,
                "ModelEvaluationMetrics": true,
                "ConfusionMatrix": true
            }
        })
    }

    fn text_cfg_json() -> serde_json::Value {
        json!({
            "lowercase": true,
            "stemming_method": "none",
            "stopwords_method": "none",
            "custom_stopwords": null,
            "delimiters": "",
            "ngram_min": 1,
            "ngram_max": 1,
            "tf_method": "raw",
            "idf_method": "none",
            "words_to_keep": 1000
        })
    }

    #[test]
    fn v1_payload_still_parses_and_v2_defaults_apply() {
        let value = v1_config_json();

        // Struct v1 (tidak berubah) tetap ter-parse dari payload v1.
        let v1: NaiveBayesConfig = serde_json::from_value(value.clone()).expect("v1 parse");
        assert_eq!(v1.main.target_var.as_deref(), Some("Class"));

        // Struct v2 memakai default AGENTS_V2 §4 / §5.1.
        let v2 = parse_config_v2(value).expect("v2 parse");
        assert_eq!(v2.main.text_source, TextSource::None);
        assert_eq!(v2.main.raw_text_var, None);
        assert_eq!(v2.main.text_vector_vars, None);
        assert_eq!(v2.options.numeric_likelihood, NumericLikelihood::Gaussian);
        assert!(v2.options.numeric_likelihood_overrides.is_empty());
        assert_eq!(v2.options.text_likelihood, TextLikelihood::Multinomial);
        assert_eq!(v2.options.text_alpha, 1.0);
        assert!(v2.output.text_feature_table);
        assert_eq!(v2.output.text_top_k, 100);
        assert!(v2.text.is_none());
    }

    #[test]
    fn v2_payload_with_new_fields_parses_in_both_structs() {
        let mut value = v1_config_json();
        value["main"]["TextSource"] = json!("raw");
        value["main"]["RawTextVar"] = json!("Text Tweet");
        value["options"]["NumericLikelihood"] = json!("gaussian_minstd");
        value["options"]["NumericLikelihoodOverrides"] = json!({"Temp": "gaussian"});
        value["options"]["TextLikelihood"] = json!("bernoulli");
        value["options"]["TextAlpha"] = json!(0.5);
        value["output"]["TextFeatureTable"] = json!(false);
        value["output"]["TextTopK"] = json!(25);
        value["Text"] = text_cfg_json();

        // Field tambahan diabaikan oleh struct v1.
        let _v1: NaiveBayesConfig = serde_json::from_value(value.clone()).expect("v1 parse");

        let v2 = parse_config_v2(value).expect("v2 parse");
        assert_eq!(v2.main.text_source, TextSource::Raw);
        assert_eq!(v2.main.raw_text_var.as_deref(), Some("Text Tweet"));
        assert_eq!(v2.options.numeric_likelihood, NumericLikelihood::GaussianMinstd);
        assert_eq!(
            v2.options.numeric_likelihood_overrides.get("Temp"),
            Some(&NumericLikelihood::Gaussian)
        );
        assert_eq!(v2.options.text_likelihood, TextLikelihood::Bernoulli);
        assert_eq!(v2.options.text_alpha, 0.5);
        assert!(!v2.output.text_feature_table);
        assert_eq!(v2.output.text_top_k, 25);
        let text = v2.text.expect("Text harus ada");
        assert!(text.lowercase);
        assert_eq!(text.words_to_keep, 1000);
    }

    #[test]
    fn vector_source_and_complement_parse() {
        let mut value = v1_config_json();
        value["main"]["TextSource"] = json!("vector");
        value["main"]["TextVectorVars"] = json!(["VEC_a", "VEC_b"]);
        value["options"]["TextLikelihood"] = json!("complement");
        value["Text"] = serde_json::Value::Null;

        let v2 = parse_config_v2(value).expect("v2 parse");
        assert_eq!(v2.main.text_source, TextSource::Vector);
        assert_eq!(
            v2.main.text_vector_vars,
            Some(vec!["VEC_a".to_string(), "VEC_b".to_string()])
        );
        assert_eq!(v2.options.text_likelihood, TextLikelihood::Complement);
        assert!(v2.text.is_none());
    }

    #[test]
    fn invalid_text_config_is_forwarded_with_nb_e_text_config_prefix() {
        let mut value = v1_config_json();
        let mut bad = text_cfg_json();
        bad["tf_method"] = json!("tidak_dikenal");
        value["Text"] = bad;

        let err = parse_config_v2(value).unwrap_err();
        assert!(err.starts_with("NB_E_TEXT_CONFIG: [INVALID_CONFIG]"), "{}", err);
    }

    #[test]
    fn unknown_likelihood_string_is_rejected() {
        let mut value = v1_config_json();
        value["options"]["TextLikelihood"] = json!("laplace");
        assert!(parse_config_v2(value).is_err());
    }
}
