use serde::Serialize;
use std::fmt;

/// Tipe error terpusat untuk seluruh pipeline NLP (crate inti).
/// Semua modul mengembalikan tipe ini. Crate inti TIDAK mengenal JsValue;
/// pembungkus WASM yang bertugas mengubahnya menjadi nilai JS { code, message }.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct TextError {
    pub code: String,
    pub message: String,
}

impl TextError {
    pub fn new(code: &str, message: &str) -> Self {
        TextError {
            code: code.to_string(),
            message: message.to_string(),
        }
    }

    /// Serialisasi ke string JSON `{"code":"...","message":"..."}`.
    /// Kontrak v1 pembungkus WASM: error dikirim ke JS sebagai string JSON.
    /// Sejak Fase S2 pembungkus WASM mengirim objek JS `{ code, message }`
    /// (serde_wasm_bindgen::to_value); fungsi ini dipertahankan sebagai fallback.
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self)
            .unwrap_or_else(|_| r#"{"code":"SERIALIZE_ERROR","message":"Failed to serialize the error."}"#.to_string())
    }
}

impl fmt::Display for TextError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for TextError {}
