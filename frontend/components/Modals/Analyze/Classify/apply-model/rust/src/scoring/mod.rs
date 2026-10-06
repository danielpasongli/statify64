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
// Revisi v2 (AGENTS_V2.md §10): fitur Text (schema 2.0) lewat `statify-text-core`.
pub mod text;

use naive_bayes::NaiveBayesScorer;
use text::TextModel;

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

/// Masukan Text untuk satu baris (revisi v2, AGENTS_V2.md §10.4). Dihitung
/// SEKALI per proses lewat `TextModel::prepare` (batch), lalu diteruskan per
/// baris ke `ClassifierScorer::score_row_with_text`.
#[derive(Debug, Clone, Copy)]
pub struct TextRowInput<'a> {
    /// Kontribusi log Text per kelas (TANPA `ln prior`), sejajar `classes()`.
    /// Baris teks missing = vektor nol (Bernoulli tetap `Σ A_ct`).
    pub contribution: &'a [f64],
    /// Teks dihitung prediktor missing (K5/V11): raw null/kosong/whitespace,
    /// atau vector tanpa satu pun nilai pada kolom terpetakan.
    pub missing: bool,
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

    /// Revisi v2: parameter fitur Text (schema 2.0) bila model punya. Default
    /// `None` (model v1 dan scorer algoritma lain).
    fn text_model(&self) -> Option<&TextModel> {
        None
    }

    /// Revisi v2: skor satu baris dengan kontribusi Text. Default = `score_row`
    /// (mengabaikan `text`) sehingga perilaku v1 tidak berubah.
    fn score_row_with_text(&self, values: &[DataValue], _text: Option<TextRowInput<'_>>) -> RowScore {
        self.score_row(values)
    }
}

/// Registry scorer: cek objek & `model_type` (AGENTS.md §4.2), lalu dispatch.
/// Semua pesan error berbentuk `"AM_E_XXX: detail"`.
pub fn build_scorer(model: &Value) -> Result<Box<dyn ClassifierScorer>, String> {
    let obj = match model.as_object() {
        Some(obj) => obj,
        None => {
            return Err("AM_E_NOT_OBJECT: The model file must contain a JSON object.".to_string());
        }
    };

    let model_type = match obj.get("model_type").and_then(|v| v.as_str()) {
        Some(model_type) => model_type,
        None => {
            return Err(
                "AM_E_MODEL_TYPE_MISSING: The model file has no 'model_type' field, or it is not a string."
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
