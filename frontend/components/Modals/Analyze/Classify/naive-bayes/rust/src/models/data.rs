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

// --- Fase N1 (PLAN_V2 / AGENTS_V2 §5.1–5.2) — payload Text v2 -------------
//
// `TextPayload` TIDAK menjadi field `AnalysisData` (struct itu dibangun lewat
// literal di test fase lain; menambah field akan merusak kompilasinya).
// Constructor menyimpannya terpisah dan fase berikutnya (N3a/N3b)
// mengonsumsinya bersama `AnalysisData`.

/// Pesan galat nilai negatif pada kolom vektor (AGENTS_V2 §5.2, diperluas oleh
/// CATATAN_TAHAP2 butir 1): WAJIB menyebut nama kolom negatif pertama dan
/// jumlah kolom bermasalah. Kalimat inti §5.2 tetap ada.
pub fn text_negative_message(first_column: &str, n_columns: usize) -> String {
    format!(
        "NB_E_TEXT_NEGATIVE: Text vector column '{}' contains negative values ({} column(s) affected). Multinomial, Bernoulli and Complement Naive Bayes require values >= 0. Check that the column is a real word vector (not a standardized/PCA column or a missing-value code such as -1) and remove it from Word-Vector Variables.",
        first_column, n_columns
    )
}

/// Payload fitur Text dari TS (AGENTS_V2 §5.1). Baris SEJAJAR dengan baris
/// target yang dikirim (sebelum filter target-missing).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(tag = "source")]
pub enum TextPayload {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "raw")]
    Raw {
        variable: String,
        values: Vec<Option<String>>,
    },
    #[serde(rename = "vector")]
    Vector {
        columns: Vec<String>,
        values: Vec<Vec<Option<f64>>>,
    },
}

impl TextPayload {
    /// Jumlah baris payload (0 untuk `None`).
    pub fn n_rows(&self) -> usize {
        match self {
            TextPayload::None => 0,
            TextPayload::Raw { values, .. } => values.len(),
            TextPayload::Vector { values, .. } => values.len(),
        }
    }

    /// Dokumen mentah (jalur `raw`): `null` -> `""` (AGENTS_V2 §5.2).
    /// `None` bila sumbernya bukan `raw`.
    pub fn raw_documents(&self) -> Option<Vec<String>> {
        match self {
            TextPayload::Raw { values, .. } => Some(
                values
                    .iter()
                    .map(|v| v.clone().unwrap_or_default())
                    .collect(),
            ),
            _ => None,
        }
    }

    /// Konversi jalur `vector` ke `CsrMatrix` (AGENTS_V2 §5.2):
    /// `null`/non-finite -> 0, nilai negatif -> galat `NB_E_TEXT_NEGATIVE`.
    /// Nol tidak disimpan (struktur sparse). Kolom CSR terurut naik.
    /// Mengembalikan `Ok(None)` bila sumbernya bukan `vector`.
    pub fn vector_to_csr(
        &self,
    ) -> Result<Option<(Vec<String>, statify_text_core::CsrMatrix)>, String> {
        let (columns, values) = match self {
            TextPayload::Vector { columns, values } => (columns, values),
            _ => return Ok(None),
        };

        let n_cols = columns.len();
        let mut indptr: Vec<usize> = Vec::with_capacity(values.len() + 1);
        let mut indices: Vec<u32> = Vec::new();
        let mut data: Vec<f64> = Vec::new();
        indptr.push(0);
        // Kolom bernilai negatif (indeks kolom, tanpa duplikat) — seluruh data
        // dipindai dulu supaya pesan memuat nama kolom pertama + jumlah kolom.
        let mut negative_cols: Vec<bool> = vec![false; n_cols];

        for (row_idx, row) in values.iter().enumerate() {
            if row.len() != n_cols {
                return Err(format!(
                    "Row {} of the word-vector data has {} values, but {} were expected (one per vector column).",
                    row_idx + 1,
                    row.len(),
                    n_cols
                ));
            }
            for (col_idx, cell) in row.iter().enumerate() {
                let v = match cell {
                    Some(v) if v.is_finite() => *v,
                    _ => 0.0,
                };
                if v < 0.0 {
                    negative_cols[col_idx] = true;
                    continue;
                }
                if v > 0.0 {
                    indices.push(col_idx as u32);
                    data.push(v);
                }
            }
            indptr.push(indices.len());
        }

        // Validasi SEBELUM CORE::nb_text dipanggil (CATATAN_TAHAP2 butir 1.1).
        let n_negative = negative_cols.iter().filter(|&&neg| neg).count();
        if let Some(first) = negative_cols.iter().position(|&neg| neg) {
            let name = columns.get(first).map(String::as_str).unwrap_or("");
            return Err(text_negative_message(name, n_negative));
        }

        Ok(Some((
            columns.clone(),
            statify_text_core::CsrMatrix {
                n_rows: values.len(),
                n_cols,
                indptr,
                indices,
                data,
            },
        )))
    }
}

#[cfg(test)]
mod tests_text_payload {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_none_raw_and_vector_payloads() {
        let none: TextPayload = serde_json::from_value(json!({"source": "none"})).unwrap();
        assert_eq!(none, TextPayload::None);

        let raw: TextPayload = serde_json::from_value(json!({
            "source": "raw", "variable": "Text Tweet", "values": ["halo dunia", null, ""]
        }))
        .unwrap();
        assert_eq!(raw.n_rows(), 3);
        // null -> "" (AGENTS_V2 §5.2)
        assert_eq!(
            raw.raw_documents().unwrap(),
            vec!["halo dunia".to_string(), String::new(), String::new()]
        );

        let vector: TextPayload = serde_json::from_value(json!({
            "source": "vector", "columns": ["a", "b"], "values": [[1.0, null], [0, 2.5]]
        }))
        .unwrap();
        assert_eq!(vector.n_rows(), 2);
        assert!(vector.raw_documents().is_none());
    }

    #[test]
    fn default_payload_is_none() {
        assert_eq!(TextPayload::default(), TextPayload::None);
        assert_eq!(TextPayload::None.n_rows(), 0);
        assert!(TextPayload::None.vector_to_csr().unwrap().is_none());
    }

    #[test]
    fn vector_to_csr_zero_fills_null_and_non_finite() {
        let payload = TextPayload::Vector {
            columns: vec!["a".into(), "b".into(), "c".into()],
            values: vec![
                vec![Some(1.0), None, Some(2.5)],
                vec![Some(f64::NAN), Some(f64::INFINITY), Some(0.0)],
                vec![None, Some(3.0), None],
            ],
        };
        let (cols, csr) = payload.vector_to_csr().unwrap().unwrap();
        assert_eq!(cols, vec!["a", "b", "c"]);
        assert_eq!(csr.n_rows, 3);
        assert_eq!(csr.n_cols, 3);
        assert_eq!(csr.indptr, vec![0, 2, 2, 3]);
        assert_eq!(csr.indices, vec![0, 2, 1]);
        assert_eq!(csr.data, vec![1.0, 2.5, 3.0]);
        assert_eq!(
            csr.to_dense(),
            vec![
                vec![1.0, 0.0, 2.5],
                vec![0.0, 0.0, 0.0],
                vec![0.0, 3.0, 0.0]
            ]
        );
    }

    #[test]
    fn vector_to_csr_accepts_fractional_tfidf_values() {
        let payload = TextPayload::Vector {
            columns: vec!["a".into()],
            values: vec![vec![Some(0.4054651081081644)]],
        };
        let (_, csr) = payload.vector_to_csr().unwrap().unwrap();
        assert_eq!(csr.data, vec![0.4054651081081644]);
    }

    #[test]
    fn vector_to_csr_rejects_negative_values_with_nb_e_text_negative() {
        // (a) satu kolom negatif -> pesan memuat nama kolomnya.
        let payload = TextPayload::Vector {
            columns: vec!["VEC_a".into(), "VEC_b".into()],
            values: vec![vec![Some(1.0), Some(0.0)], vec![Some(-0.5), Some(1.0)]],
        };
        let err = payload.vector_to_csr().unwrap_err();
        assert!(err.starts_with("NB_E_TEXT_NEGATIVE"), "{}", err);
        assert!(err.contains("'VEC_a'"), "{}", err);
        assert!(err.contains("(1 column(s) affected)"), "{}", err);
        // Kalimat inti AGENTS_V2 §5.2 tetap ada.
        assert!(err.contains("Multinomial, Bernoulli and Complement Naive Bayes require values >= 0."));
        assert_eq!(err, text_negative_message("VEC_a", 1));
    }

    #[test]
    fn vector_to_csr_reports_first_negative_column_and_count_for_several() {
        // (b) beberapa kolom negatif (kolom b dan d, di baris berbeda; b juga
        // negatif dua kali -> dihitung sekali): nama pertama menurut urutan
        // kolom + jumlah kolom bermasalah.
        let payload = TextPayload::Vector {
            columns: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            values: vec![
                vec![Some(1.0), Some(0.0), Some(0.0), Some(-1.0)],
                vec![Some(0.0), Some(-2.0), Some(1.0), Some(0.0)],
                vec![Some(0.0), Some(-3.0), Some(0.0), Some(0.0)],
            ],
        };
        let err = payload.vector_to_csr().unwrap_err();
        assert!(err.contains("'b'"), "{}", err);
        assert!(!err.contains("'d'"), "{}", err);
        assert!(err.contains("(2 column(s) affected)"), "{}", err);
    }

    #[test]
    fn vector_to_csr_without_negatives_does_not_error() {
        // (c) tanpa negatif (termasuk null, NaN, nol, pecahan) -> tidak error.
        let payload = TextPayload::Vector {
            columns: vec!["a".into(), "b".into()],
            values: vec![vec![Some(0.0), None], vec![Some(f64::NAN), Some(0.25)]],
        };
        assert!(payload.vector_to_csr().is_ok());
    }

    #[test]
    fn vector_to_csr_rejects_ragged_rows_without_panic() {
        let payload = TextPayload::Vector {
            columns: vec!["a".into(), "b".into()],
            values: vec![vec![Some(1.0)]],
        };
        let err = payload.vector_to_csr().unwrap_err();
        assert!(err.contains("Row 1"));
    }

    #[test]
    fn raw_payload_has_no_csr() {
        let payload = TextPayload::Raw {
            variable: "T".into(),
            values: vec![Some("x".into())],
        };
        assert!(payload.vector_to_csr().unwrap().is_none());
    }
}
