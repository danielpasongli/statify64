// Sub-modul `scoring/` — kontrak scorer per algoritma (AGENTS.md §5.1).
//
// PLAN.md Fase 7: hanya tipe, trait, dan `build_scorer` (dispatch registry
// scorer Rust, P2). Posterior/argmax BUKAN di sini (Fase 9) — modul generik
// `stats/` tidak boleh tahu algoritmanya.
//
// Menambah algoritma baru = satu file scorer + satu baris `match` di
// `build_scorer`.
use serde_json::Value;

use crate::models::data::DataValue;

pub mod naive_bayes;

use naive_bayes::NaiveBayesScorer;

/// Peran fitur di model: `categorical` (dari variabel nominal/ordinal) atau
/// `numerical` (dari variabel scale). AGENTS.md §3.4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeatureRole {
    Categorical,
    Numerical,
}

impl FeatureRole {
    /// Teks yang sama dengan nilai `role` di JSON model / `ModelDescriptor`.
    pub fn as_str(&self) -> &'static str {
        match self {
            FeatureRole::Categorical => "categorical",
            FeatureRole::Numerical => "numerical",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureSpec {
    pub name: String,
    pub role: FeatureRole,
}

/// Hasil scoring satu baris (AGENTS.md §5.1).
#[derive(Debug, Clone, PartialEq)]
pub enum RowScore {
    /// Seluruh prediktor missing (K5).
    NotScored,
    Scored {
        /// Sejajar `ClassifierScorer::classes()`.
        log_scores: Vec<f64>,
        /// >=1 prediktor missing.
        had_missing: bool,
        /// >=1 kategori tak dikenal (dihitung atau dilewati).
        had_unseen: bool,
        /// Jumlah kontribusi dilewati (hanya schema 1.0).
        skipped_unseen: usize,
    },
}

pub trait ClassifierScorer {
    fn model_type(&self) -> &str;
    fn schema_version(&self) -> &str;
    /// Urutan kelas dari model.
    fn classes(&self) -> &[String];
    /// Urutan = `feature_order` model.
    fn features(&self) -> &[FeatureSpec];
    fn summary_parameters(&self) -> Vec<(String, String)>;
    /// NB: `schema_version == "1.0"`.
    fn is_legacy_unseen_handling(&self) -> bool;
    /// `values` sejajar `features()`.
    fn score_row(&self, values: &[DataValue]) -> RowScore;
}

/// Registry scorer: cek objek & `model_type` (AGENTS.md §4.2), lalu dispatch.
/// Semua pesan error berbentuk `"AM_E_XXX: detail"`.
pub fn build_scorer(model: &Value) -> Result<Box<dyn ClassifierScorer>, String> {
    let obj = match model.as_object() {
        Some(obj) => obj,
        None => {
            return Err("AM_E_NOT_OBJECT: model bukan objek JSON".to_string());
        }
    };

    let model_type = match obj.get("model_type").and_then(|v| v.as_str()) {
        Some(model_type) => model_type,
        None => {
            return Err(
                "AM_E_MODEL_TYPE_MISSING: field model_type tidak ada atau bukan string"
                    .to_string(),
            );
        }
    };

    match model_type {
        "naive_bayes" => {
            let scorer = NaiveBayesScorer::from_json(model)?;
            Ok(Box::new(scorer))
        }
        other => Err(format!("AM_E_MODEL_TYPE_UNSUPPORTED: {}", other)),
    }
}
