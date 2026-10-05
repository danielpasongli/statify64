// Helper konversi tipe/error umum — pola identik
// `nearest-neighbor/rust/src/utils/converter.rs`. Fase 8 hanya perlu
// `string_to_js_error` (dipakai constructor untuk mengembalikan pesan
// error parsing ke JS). Helper format-hasil-analisis penuh (`format_result`
// versi KNN) belum relevan di sini karena Fase 8 mengembalikan hasil
// hardcoded langsung dari `wasm::function`, bukan dari struct hasil hasil
// komputasi (itu menyusul begitu `models::result` ditulis, Fase 16+).
use wasm_bindgen::JsValue;

pub fn string_to_js_error(error: String) -> JsValue {
    JsValue::from_str(&error)
}
