// Struct konfigurasi Naive Bayes — bentuknya mengikuti persis
// `NaiveBayesType` di sisi TypeScript
// (`naive-bayes/types/naive-bayes.ts`), termasuk rename field ke
// PascalCase supaya cocok dengan payload JSON yang dikirim dari
// `naive-bayes-analysis.ts` (field `config`). Lihat AGENTS.md §4 untuk
// makna tiap field. Fase 8 ini hanya perlu struct-nya bisa di-parse
// (constructor.rs); belum ada logika yang membaca isinya untuk menghitung
// apa pun (itu Fase 9+).
use serde::{Deserialize, Serialize};

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
