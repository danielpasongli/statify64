mod models;
mod stats;

use crate::models::config::{AnalysisData, MultinomialConfig};
use crate::stats::core::perform_primary_calculation;
use crate::stats::estimation::estimate_parameters;
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = calculate_multinomial_logistic)]
pub fn calculate_multinomial_logistic(
    data_val: JsValue,
    config_val: JsValue,
) -> Result<JsValue, JsValue> {
    // 1. Debugging Input: Coba parse Config
    let config: MultinomialConfig = match from_value(config_val) {
        Ok(c) => c,
        Err(e) => return Err(JsValue::from_str(&format!("Config Error: {}", e))),
    };

    // 2. Debugging Input: Coba parse Data
    let data: AnalysisData = match from_value(data_val) {
        Ok(d) => d,
        Err(e) => {
            return Err(JsValue::from_str(&format!(
                "Data Error: Pastikan variabel dependen numerik. Detail: {}",
                e
            )))
        }
    };

    // 3. Jalankan Perhitungan Core (Design Matrix)
    let primary_results = match perform_primary_calculation(&data, &config) {
        Ok(res) => res,
        Err(err) => return Err(JsValue::from_str(&err)),
    };

    // 4. Jalankan Estimasi (Newton-Raphson)
    let final_result = match estimate_parameters(&data, &primary_results, &config) {
        Ok(res) => res,
        Err(err) => return Err(JsValue::from_str(&err)),
    };

    // 5. Kembalikan Hasil ke JS
    Ok(to_value(&final_result).unwrap())
}
