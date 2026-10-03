// Kelas WASM utama untuk menu Apply Model.
//
// PLAN.md Fase 10 langkah 3 — MENGGANTIKAN scaffold dummy Fase 6: constructor
// memparse payload 6 argumen (`AGENTS.md` §7.1), lalu MENJALANKAN
// `wasm::function::run_apply_model` sekali dan menyimpan hasilnya (pola
// `naive-bayes/rust/src/wasm/constructor.rs`). `get_formatted_results()` hanya
// menserialisasi hasil yang sudah dihitung. Kegagalan fatal (validasi
// model/payload) dikembalikan sebagai `Err(JsValue)` berpesan
// `"AM_E_XXX: detail"` (P3) dan dicatat di `ErrorCollector`.
//
// Signature constructor TIDAK BOLEH diubah tanpa merevisi `../AGENTS.md`.
// Argumen (bentuk data = §3.6):
//   1. `predictors`     — `Vec<Vec<DataRecord>>`, satu slice per fitur.
//   2. `predictor_defs` — `Vec<Vec<VariableDefinition>>`, urutan sama.
//   3. `mapping`        — `Vec<MappingEntry>` fitur model -> variabel dataset.
//   4. `actual`         — `Vec<Vec<DataRecord>>`: `[]` atau satu slice target aktual.
//   5. `actual_defs`    — `Vec<Vec<VariableDefinition>>`: `[]` atau satu defs.
//   6. `model`          — isi file model apa adanya (`serde_json::Value`).
use wasm_bindgen::prelude::*;

use crate::models::data::{DataRecord, VariableDefinition};
use crate::models::payload::MappingEntry;
use crate::models::result::ApplyModelRawResult;
use crate::utils::converter::string_to_js_error;
use crate::utils::error::ErrorCollector;
use crate::wasm::function;

#[wasm_bindgen]
pub struct ApplyModelAnalysis {
    result: Option<ApplyModelRawResult>,
    error_collector: ErrorCollector,
}

#[wasm_bindgen]
impl ApplyModelAnalysis {
    #[wasm_bindgen(constructor)]
    pub fn new(
        predictors: JsValue,
        predictor_defs: JsValue,
        mapping: JsValue,
        actual: JsValue,
        actual_defs: JsValue,
        model: JsValue,
    ) -> Result<ApplyModelAnalysis, JsValue> {
        let mut error_collector = ErrorCollector::default();

        let predictors: Vec<Vec<DataRecord>> = match serde_wasm_bindgen::from_value(predictors) {
            Ok(value) => value,
            Err(e) => return Err(fail(&mut error_collector, "constructor.predictors", format!("AM_E_PAYLOAD: predictors: {}", e))),
        };
        let predictor_defs: Vec<Vec<VariableDefinition>> =
            match serde_wasm_bindgen::from_value(predictor_defs) {
                Ok(value) => value,
                Err(e) => return Err(fail(&mut error_collector, "constructor.predictor_defs", format!("AM_E_PAYLOAD: predictorDefs: {}", e))),
            };
        let mapping: Vec<MappingEntry> = match serde_wasm_bindgen::from_value(mapping) {
            Ok(value) => value,
            Err(e) => return Err(fail(&mut error_collector, "constructor.mapping", format!("AM_E_PAYLOAD: mapping: {}", e))),
        };
        let actual: Vec<Vec<DataRecord>> = match serde_wasm_bindgen::from_value(actual) {
            Ok(value) => value,
            Err(e) => return Err(fail(&mut error_collector, "constructor.actual", format!("AM_E_PAYLOAD: actual: {}", e))),
        };
        let actual_defs: Vec<Vec<VariableDefinition>> =
            match serde_wasm_bindgen::from_value(actual_defs) {
                Ok(value) => value,
                Err(e) => return Err(fail(&mut error_collector, "constructor.actual_defs", format!("AM_E_PAYLOAD: actualDefs: {}", e))),
            };
        let model: serde_json::Value = match serde_wasm_bindgen::from_value(model) {
            Ok(value) => value,
            Err(e) => return Err(fail(&mut error_collector, "constructor.model", format!("AM_E_PAYLOAD: model: {}", e))),
        };

        // Jalankan analisis sungguhan sekali di sini; error berkode (model
        // tidak valid, payload tidak sejajar, tanpa baris) -> `Err(JsValue)`.
        let result = match function::run_apply_model(
            &predictors,
            &predictor_defs,
            &mapping,
            &actual,
            &actual_defs,
            &model,
        ) {
            Ok(result) => result,
            Err(message) => {
                return Err(fail(&mut error_collector, "constructor.run_apply_model", message));
            }
        };

        Ok(ApplyModelAnalysis {
            result: Some(result),
            error_collector,
        })
    }

    pub fn get_formatted_results(&self) -> Result<JsValue, JsValue> {
        function::get_formatted_results(&self.result)
    }

    pub fn get_all_errors(&self) -> JsValue {
        function::get_all_errors(&self.error_collector)
    }
}

/// Catat error di collector lalu ubah menjadi `JsValue` (pesan tetap
/// berbentuk `"AM_E_XXX: detail"`).
fn fail(error_collector: &mut ErrorCollector, context: &str, message: String) -> JsValue {
    error_collector.add_error(context, &message);
    string_to_js_error(message)
}
