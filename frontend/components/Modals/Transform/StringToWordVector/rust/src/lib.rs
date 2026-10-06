use wasm_bindgen::prelude::*;

use statify_text_core::{TextError, TextVectorizerConfig};

// ─────────────────────────────────────────────────────────────────────────────
// Config struct — didefinisikan di crate inti (statify-text-core).
// Alias dipertahankan agar nama lama `VectorizerConfig` tetap tersedia.
// ─────────────────────────────────────────────────────────────────────────────
pub type VectorizerConfig = TextVectorizerConfig;

/// Konversi TextError ke JsValue berupa OBJEK JS `{ code, message }` (F04),
/// bukan string JSON. Bila serialisasi objek gagal, jatuh ke string JSON sebagai pengaman terakhir.
fn error_to_js(err: &TextError) -> JsValue {
    serde_wasm_bindgen::to_value(err).unwrap_or_else(|_| JsValue::from_str(&err.to_json_string()))
}

// ─────────────────────────────────────────────────────────────────────────────
// Init panic hook (dipanggil sekali di awal setiap invokasi)
// ─────────────────────────────────────────────────────────────────────────────
#[wasm_bindgen]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fungsi utama yang dipanggil oleh Web Worker (pembungkus tipis atas crate inti)
// ─────────────────────────────────────────────────────────────────────────────
/// Menerima:
/// - `js_data`   : Array<string> (kolom teks dari dataset)
/// - `js_config` : VectorizerConfig object
///
/// Mengembalikan objek: { vocabulary, matrix, stats }; bila error, melempar objek JS { code, message }.
#[wasm_bindgen]
pub fn process_text_data(js_data: JsValue, js_config: JsValue) -> Result<JsValue, JsValue> {
    init_panic_hook();

    // ── Parse config dari JavaScript ─────────────────────────────────────────
    let config: VectorizerConfig = serde_wasm_bindgen::from_value(js_config).map_err(|e| {
        error_to_js(&TextError::new(
            "INVALID_CONFIG",
            &format!("Failed to parse the text configuration: {}", e),
        ))
    })?;

    // ── Parse array dokumen dari JavaScript ──────────────────────────────────
    let raw_docs: Vec<String> = serde_wasm_bindgen::from_value(js_data).map_err(|e| {
        error_to_js(&TextError::new(
            "INVALID_DATA",
            &format!("Failed to parse the text data: {}", e),
        ))
    })?;

    // ── Seluruh logika ada di crate inti: fit_transform (validasi → NLP → statistik fit → CSR) ─
    // Model (resep) tidak disimpan oleh STWV (D3); keluaran ke UI tetap dense (D10, §3.5) lewat to_dense().
    let (model, csr) = statify_text_core::fit_transform(&raw_docs, &config).map_err(|e| error_to_js(&e))?;
    let output = statify_text_core::output_from_model(&model, &csr);

    // ── Serialize output ke JsValue ───────────────────────────────────────────
    serde_wasm_bindgen::to_value(&output).map_err(|e| {
        error_to_js(&TextError::new(
            "SERIALIZE_ERROR",
            &format!("Failed to serialize the output: {}", e),
        ))
    })
}
