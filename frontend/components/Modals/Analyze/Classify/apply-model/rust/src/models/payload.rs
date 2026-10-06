// Payload mapping fitur model -> variabel dataset aktif (AGENTS.md §3).
// PLAN.md Fase 6 item 3: hanya `MappingEntry`; struktur payload lengkap
// (predictors/actual/model dsb.) di-parse lewat serde di `wasm::constructor`.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MappingEntry {
    pub feature: String,
    pub variable: String,
}


// Revisi v2 (AGENTS_V2.md §10.3): payload fitur Text untuk model schema 2.0.
//
// Bentuk di sisi TS (`ApplyModelTextPayload`):
//   null
//   | { source: "raw";    values: (string | null)[] }
//   | { source: "vector"; mapped_columns: number[]; values: (number | null)[][] }
// `mapped_columns` = indeks ke `model.text.columns`; `values[row][j]` sejajar
// `mapped_columns`. Kolom model yang tidak terpetakan diisi 0 oleh scorer.
//
// `values` memakai enum `untagged` (bukan `tag = "source"`) karena enum
// internally-tagged mem-buffer angka sebagai `Content` dan dapat gagal untuk
// bilangan bulat dari `serde_wasm_bindgen`. Kecocokan `source` dengan bentuk
// `values` diperiksa di `scoring::text`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum TextValues {
    /// `raw`: satu string (atau null) per baris.
    Raw(Vec<Option<String>>),
    /// `vector`: satu larik per baris, sejajar `mapped_columns`.
    Vector(Vec<Vec<Option<f64>>>),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextPayload {
    /// "raw" | "vector"
    pub source: String,
    #[serde(default)]
    pub mapped_columns: Option<Vec<usize>>,
    pub values: TextValues,
}

impl TextPayload {
    /// Jumlah baris yang dibawa payload Text.
    pub fn row_count(&self) -> usize {
        match &self.values {
            TextValues::Raw(values) => values.len(),
            TextValues::Vector(rows) => rows.len(),
        }
    }
}
