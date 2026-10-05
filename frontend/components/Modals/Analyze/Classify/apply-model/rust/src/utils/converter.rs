// Helper konversi tipe/error umum — SALINAN dari
// `naive-bayes/rust/src/utils/converter.rs` (AGENTS.md P6; isi identik).
// Hanya `string_to_js_error` yang dibutuhkan: dipakai constructor untuk
// mengembalikan pesan error berkode ("AM_E_XXX: detail") ke JS.
use wasm_bindgen::JsValue;

pub fn string_to_js_error(error: String) -> JsValue {
    JsValue::from_str(&error)
}
