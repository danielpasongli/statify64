// Kelas WASM utama untuk analisis Naive Bayes.
//
// PLAN.md Fase 16 item 2 ("binding WASM lengkap") — MENGGANTIKAN dummy
// Fase 8: parsing payload (target/predictors data+defs, config) TIDAK
// berubah dari Fase 8 (sudah teruji, murni pipeline serialisasi JS<->Rust),
// tapi sekarang constructor juga MENJALANKAN analisis sungguhan sekali
// lewat `wasm::function::run_analysis` dan menyimpan hasilnya (`result:
// Option<NaiveBayesAnalysisResult>`) — pola identik
// `nearest-neighbor/rust/src/wasm/constructor.rs::KNNAnalysis::new`
// (struct dibangun dulu dengan `result: None`, lalu `run_analysis`
// dipanggil lewat referensi field struct itu sendiri, baru hasilnya
// ditulis balik — supaya field `data`/`config` tetap "terpakai" dari sudut
// pandang `dead_code` lint, bukan sekadar variabel lokal yang dibuang
// setelah dipindah ke struct).
use wasm_bindgen::prelude::*;

use crate::models::config::{parse_config_v2, NaiveBayesConfig, NaiveBayesConfigV2};
use crate::models::data::{AnalysisData, DataRecord, TextPayload, VariableDefinition};
use crate::utils::converter::string_to_js_error;
use crate::utils::error::ErrorCollector;
use crate::wasm::function::{self, NaiveBayesAnalysisResult};

#[wasm_bindgen]
pub struct NaiveBayesAnalysis {
    #[allow(dead_code)]
    config: NaiveBayesConfig,
    #[allow(dead_code)]
    data: AnalysisData,
    // Fase N1 (PLAN_V2): field konfigurasi v2 + payload Text. Disimpan
    // terpisah dari `config`/`data` v1 supaya struct v1 tidak berubah;
    // Fase N3a: diteruskan ke `run_analysis` (jalur Text `vector`).
    config_v2: NaiveBayesConfigV2,
    text: TextPayload,
    result: Option<NaiveBayesAnalysisResult>,
    error_collector: ErrorCollector,
}

#[wasm_bindgen]
impl NaiveBayesAnalysis {
    #[wasm_bindgen(constructor)]
    pub fn new(
        target_data: JsValue,
        predictors_data: JsValue,
        target_data_defs: JsValue,
        predictors_data_defs: JsValue,
        config_data: JsValue,
        // Fase N1: argumen baru; `undefined`/`null` (payload v1) -> `TextPayload::None`.
        text: JsValue,
    ) -> Result<NaiveBayesAnalysis, JsValue> {
        let mut error_collector = ErrorCollector::default();

        let target_data: Vec<Vec<DataRecord>> = match serde_wasm_bindgen::from_value(target_data)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse target data: {}", e);
                error_collector.add_error("constructor.target_data", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let predictors_data: Vec<Vec<DataRecord>> =
            match serde_wasm_bindgen::from_value(predictors_data) {
                Ok(data) => data,
                Err(e) => {
                    let msg = format!("Failed to parse predictors data: {}", e);
                    error_collector.add_error("constructor.predictors_data", &msg);
                    return Err(string_to_js_error(msg));
                }
            };

        let target_data_defs: Vec<Vec<VariableDefinition>> =
            match serde_wasm_bindgen::from_value(target_data_defs) {
                Ok(data) => data,
                Err(e) => {
                    let msg = format!("Failed to parse target data definitions: {}", e);
                    error_collector.add_error("constructor.target_data_defs", &msg);
                    return Err(string_to_js_error(msg));
                }
            };

        let predictors_data_defs: Vec<Vec<VariableDefinition>> =
            match serde_wasm_bindgen::from_value(predictors_data_defs) {
                Ok(data) => data,
                Err(e) => {
                    let msg = format!("Failed to parse predictors data definitions: {}", e);
                    error_collector.add_error("constructor.predictors_data_defs", &msg);
                    return Err(string_to_js_error(msg));
                }
            };

        let config: NaiveBayesConfig = match serde_wasm_bindgen::from_value(config_data.clone()) {
            Ok(data) => data,
            Err(e) => {
                let msg = format!(
                    "Failed to parse configuration: {}. Ensure field names match the expected format.",
                    e
                );
                error_collector.add_error("constructor.config", &msg);

                if let Ok(config_json) = js_sys::JSON::stringify(&config_data) {
                    if let Some(config_str) = config_json.as_string() {
                        error_collector.add_error(
                            "constructor.config.raw",
                            &format!("Raw config: {}", config_str),
                        );
                    }
                }

                return Err(string_to_js_error(msg));
            }
        };

        // Fase N1: field konfigurasi v2 dari JSON `config` yang sama. Payload
        // v1 (tanpa field baru) menghasilkan default v2 sehingga perilaku v1
        // tidak berubah.
        let config_v2: NaiveBayesConfigV2 =
            match serde_wasm_bindgen::from_value::<serde_json::Value>(config_data.clone())
                .map_err(|e| format!("The Naive Bayes configuration is invalid: {}", e))
                .and_then(parse_config_v2)
            {
                Ok(cfg) => cfg,
                Err(msg) => {
                    error_collector.add_error("constructor.config_v2", &msg);
                    return Err(string_to_js_error(msg));
                }
            };

        // Fase N1: payload Text (AGENTS_V2 §5.1). `undefined`/`null` -> None.
        let text_payload: TextPayload = if text.is_undefined() || text.is_null() {
            TextPayload::None
        } else {
            match serde_wasm_bindgen::from_value(text) {
                Ok(payload) => payload,
                Err(e) => {
                    let msg = format!("Failed to read the text data: {}", e);
                    error_collector.add_error("constructor.text", &msg);
                    return Err(string_to_js_error(msg));
                }
            }
        };

        // Validasi minimal (pengaman lapis kedua di sisi Rust, mengikuti
        // pola KNN) — validasi lengkap sesuai AGENTS.md §4.4 sudah ditegakkan
        // di sisi UI (`useNaiveBayesValidation`) sejak Fase 5; validasi
        // numerik/fold lebih rinci ditegakkan di dalam pipeline
        // (`preprocess_naive_bayes_data`, `validate_fold_count`, dipanggil
        // dari `wasm::function::run_analysis` di bawah).
        let target_is_missing = config
            .main
            .target_var
            .as_ref()
            .is_none_or(|target| target.trim().is_empty());
        // Fase N1: model hanya-Text (tanpa predictor Numeric/Categorical)
        // sah di v2 (AGENTS_V2 §3.3); untuk payload v1 (`TextPayload::None`)
        // aturan lama tetap persis sama.
        let predictors_are_missing =
            predictors_data_defs.is_empty() && matches!(text_payload, TextPayload::None);

        if target_is_missing && predictors_are_missing {
            let msg = "At least one target and predictor variable must be selected".to_string();
            error_collector.add_error("config.validation.variables", &msg);
            return Err(string_to_js_error(msg));
        }

        if target_is_missing {
            let msg = "A target variable is required for Naive Bayes classification".to_string();
            error_collector.add_error("config.validation.target_var", &msg);
            return Err(string_to_js_error(msg));
        }

        if predictors_are_missing {
            let msg = "At least one predictor variable is required".to_string();
            error_collector.add_error("config.validation.predictors_data", &msg);
            return Err(string_to_js_error(msg));
        }

        let data = AnalysisData {
            target_data,
            predictors_data,
            target_data_defs,
            predictors_data_defs,
        };

        let mut analysis = NaiveBayesAnalysis {
            config,
            data,
            config_v2,
            text: text_payload,
            result: None,
            error_collector,
        };

        // Jalankan analisis sungguhan sekali di sini (PLAN.md Fase 16 item
        // 2) — MENGGANTIKAN hasil hardcoded Fase 8. Kegagalan blokir-keras
        // (preprocessing gagal, tidak ada kasus valid, jumlah fold tidak
        // mungkin dieksekusi) tercatat di `error_collector` dan
        // `analysis.result` tetap `None`; `get_formatted_results()` di
        // bawah mengembalikan `Err` untuk kasus itu (bukan panic, bukan
        // hasil kosong yang diam-diam dianggap sukses).
        analysis.result = function::run_analysis(
            &analysis.data,
            &analysis.config,
            &analysis.config_v2,
            &analysis.text,
            &mut analysis.error_collector,
        );

        // Fase N3a: pada run dengan fitur Text, kegagalan blokir-keras (mis.
        // `NB_E_TEXT_NEGATIVE` dengan nama kolom, `NB_E_COMPLEMENT_MIXED`) harus
        // sampai ke pengguna lewat pesan galat konstruktor — bukan hanya lewat
        // `get_formatted_results()` yang berpesan generik "No analysis results
        // available". Run tanpa Text (v1) TIDAK berubah: galatnya tetap diambil
        // dari `get_formatted_results()`/`get_all_errors()` seperti sebelumnya.
        if analysis.result.is_none() && !matches!(analysis.text, TextPayload::None) {
            return Err(string_to_js_error(
                analysis.error_collector.get_error_summary(),
            ));
        }

        Ok(analysis)
    }

    /// Fase 16: hasil analisis SUNGGUHAN (bukan lagi hardcoded/dummy Fase
    /// 8) — lihat `wasm::function::get_formatted_results`.
    pub fn get_formatted_results(&self) -> Result<JsValue, JsValue> {
        function::get_formatted_results(&self.result)
    }

    pub fn get_all_errors(&self) -> JsValue {
        function::get_all_errors(&self.error_collector)
    }
}
