// Payload mapping fitur model -> variabel dataset aktif (AGENTS.md §3).
// PLAN.md Fase 6 item 3: hanya `MappingEntry`; struktur payload lengkap
// (predictors/actual/model dsb.) di-parse lewat serde di `wasm::constructor`.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MappingEntry {
    pub feature: String,
    pub variable: String,
}
