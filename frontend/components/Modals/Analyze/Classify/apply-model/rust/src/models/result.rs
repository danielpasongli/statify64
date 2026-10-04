// Struktur hasil yang dikirim balik ke TypeScript, persis mengikuti
// `ApplyModelRawResult` di `../AGENTS.md` §3.6 (PLAN.md Fase 6 item 4).
// Field memakai nama snake_case agar hasil `serde_wasm_bindgen` identik dengan
// kontrak TS. Sub-tipe `evaluation.confusion_matrix`/`evaluation_metrics`
// direpresentasikan sebagai `serde_json::Value`; isinya dibangun oleh
// `stats::evaluation` dengan bentuk identik `evaluation_result_to_json` NB.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelSummaryFeature {
    pub name: String,
    pub role: String, // "categorical" | "numerical"
    pub mapped_variable: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelSummaryParameter {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelSummary {
    pub model_type: String,
    pub schema_version: String,
    pub trained_at: Option<String>,
    pub target_name: String,
    pub classes: Vec<String>,
    pub features: Vec<ModelSummaryFeature>,
    pub parameters: Vec<ModelSummaryParameter>,
    pub legacy_unseen_handling: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CaseProcessingSummary {
    pub total_rows: u32,
    pub scored_rows: u32,
    pub not_scored_all_missing: u32,
    pub rows_with_missing_predictor: u32,
    pub rows_with_unseen_category: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PredictionDistribution {
    pub classes: Vec<String>,
    pub counts: Vec<u32>,
    pub percentages: Vec<f64>,
    pub not_scored: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Predictions {
    pub predicted: Vec<Option<String>>,
    pub max_probability: Vec<Option<f64>>,
    pub class_probabilities: Vec<Vec<Option<f64>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Evaluation {
    pub evaluated_rows: u32,
    pub excluded_actual_missing: u32,
    pub excluded_actual_unknown_class: u32,
    pub excluded_not_scored: u32,
    // Diisi `stats::evaluation::build_evaluation` (bentuk JSON sama dengan
    // `NaiveBayesConfusionMatrixRaw` / `NaiveBayesEvaluationMetricsRaw`).
    pub confusion_matrix: serde_json::Value,
    pub evaluation_metrics: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApplyModelWarning {
    pub code: String, // ApplyModelWarningCode di sisi TS
    pub count: u32,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApplyModelRawResult {
    pub model_summary: ModelSummary,
    pub case_processing_summary: CaseProcessingSummary,
    pub prediction_distribution: PredictionDistribution,
    pub predictions: Predictions,
    pub evaluation: Option<Evaluation>,
    pub warnings: Vec<ApplyModelWarning>,
}
