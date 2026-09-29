// Tipe data mentah + definisi variabel, bentuknya sengaja identik dengan
// `nearest-neighbor/rust/src/models/data.rs` (DataRecord/VariableDefinition
// dkk.) supaya konsisten dengan payload yang dibentuk `getSlicedData` /
// `getVarDefs` di sisi TS (pola sama, lihat AGENTS.md §3.5). Ditulis ulang
// di sini (bukan diimpor lintas crate) karena crate ini berdiri sendiri
// (PLAN.md §1).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataRecord {
    #[serde(flatten)]
    pub values: HashMap<String, DataValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum DataValue {
    Number(f64),
    Text(String),
    Boolean(bool),
    Null,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValueLabel {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i32>,
    pub variable_name: String,
    pub value: DataValue,
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum VariableType {
    Numeric,
    Comma,
    Dot,
    Scientific,
    Date,
    Adate,
    Edate,
    Sdate,
    Jdate,
    Qyr,
    Moyr,
    Wkyr,
    Datetime,
    Time,
    Dtime,
    Wkday,
    Month,
    Dollar,
    Cca,
    Ccb,
    Ccc,
    Ccd,
    Cce,
    String,
    #[serde(rename = "RESTRICTED_NUMERIC")]
    RestrictedNumeric,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableAlign {
    Right,
    Left,
    Center,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableMeasure {
    Scale,
    Ordinal,
    Nominal,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableRole {
    Input,
    Target,
    Both,
    None,
    Partition,
    Split,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VariableDefinition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i32>,
    #[serde(rename = "columnIndex")]
    pub column_index: usize,
    pub name: String,
    pub r#type: VariableType,
    pub width: i32,
    pub decimals: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub values: Vec<ValueLabel>,
    pub missing: Vec<DataValue>,
    pub columns: i32,
    pub align: VariableAlign,
    pub measure: VariableMeasure,
    pub role: VariableRole,
}

/// Data yang sudah di-slice untuk satu run analisis Naive Bayes.
///
/// Kontrak payload (PLAN.md §1, AGENTS.md §3.5): predictors dikirim sebagai
/// SATU daftar gabungan (factor + covariate bercampur dalam satu list),
/// BUKAN dua array terpisah — Rust yang nanti (Fase 9+) menentukan factor
/// vs covariate dari `measure` pada setiap `VariableDefinition` di
/// `predictors_data_defs`. Fase 8 ini hanya menyimpan payload apa adanya
/// di constructor, belum memprosesnya sama sekali.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalysisData {
    pub target_data: Vec<Vec<DataRecord>>,
    pub predictors_data: Vec<Vec<DataRecord>>,
    pub target_data_defs: Vec<Vec<VariableDefinition>>,
    pub predictors_data_defs: Vec<Vec<VariableDefinition>>,
}

// --- Fase 9 (PLAN.md §"Preprocessing data di Rust") ---------------------
//
// Struct hasil preprocessing: kebijakan missing-value final AGENTS.md §5.4
// (listwise untuk target, kategori "(Missing)" untuk kategorik, pengecualian
// per-atribut untuk numerik) sudah diterapkan oleh
// `stats::preprocess_data::preprocess_naive_bayes_data` sebelum struct ini
// terbentuk — tahap training (Fase 10+) tinggal mengonsumsi `cases` tanpa
// perlu menangani missing value lagi.

/// Peran satu predictor, ditentukan murni dari `measure` variabel
/// (AGENTS.md §3.1/§3.3) — bukan field yang disimpan manual.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredictorRole {
    /// `measure` nominal/ordinal — dimodelkan sebagai Categorical Naive Bayes.
    Factor,
    /// `measure` scale — dimodelkan sebagai Gaussian Naive Bayes.
    Covariate,
}

/// Satu baris data setelah preprocessing (baris dengan target missing sudah
/// dibuang sebelum sampai di sini).
#[derive(Debug, Clone)]
pub struct PreprocessedCase {
    /// Label kelas target (selalu diperlakukan sebagai kategori nominal
    /// biasa, AGENTS.md §5.1).
    pub target_class: String,
    /// Nama factor -> kategori (nilai asli, atau `"(Missing)"` bila kosong).
    pub factors: HashMap<String, String>,
    /// Nama covariate -> `Some(nilai)`, atau `None` bila nilai itu missing
    /// (baris tetap dipakai untuk atribut lain, hanya atribut ini yang
    /// dikecualikan — AGENTS.md §5.4).
    pub covariates: HashMap<String, Option<f64>>,
}

/// Hasil preprocessing satu run analisis Naive Bayes: input siap pakai untuk
/// tahap training/partition (Fase 10+), plus ringkasan yang dibutuhkan Case
/// Processing Summary (AGENTS.md §5.4).
#[derive(Debug, Clone)]
pub struct PreprocessedData {
    /// Jumlah instance total sebelum missing-value handling apa pun.
    pub total_instances: usize,
    /// Jumlah baris yang dibuang karena target missing (listwise deletion).
    pub excluded_target_missing: usize,
    pub target_variable: String,
    /// Urutan predictor persis seperti payload (`predictors_data_defs`),
    /// dipakai lagi nanti sebagai `feature_order` saat ekspor model
    /// (AGENTS.md §5.10).
    pub predictor_order: Vec<(String, PredictorRole)>,
    pub factor_names: Vec<String>,
    pub covariate_names: Vec<String>,
    /// Kelas target unik, terurut alfabetis untuk keterbacaan/determinisme
    /// tabel (bukan urutan kemunculan, yang tidak stabil terhadap urutan
    /// baris input).
    pub classes: Vec<String>,
    /// Baris valid (target tidak missing) setelah preprocessing.
    pub cases: Vec<PreprocessedCase>,
}
