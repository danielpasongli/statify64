use wasm_bindgen::prelude::*;

use crate::models::{
    config::DiscriminantConfig,
    data::{ AnalysisData, DataRecord, VariableDefinition },
    result::DiscriminantResult,
};
use crate::utils::{
    converter::string_to_js_error,
    error::ErrorCollector,
    log::FunctionLogger,
};
use crate::wasm::function;

#[wasm_bindgen]
pub struct DiscriminantAnalysis {
    config: DiscriminantConfig,
    data: AnalysisData,
    result: Option<DiscriminantResult>,
    error_collector: ErrorCollector,
    logger: FunctionLogger,
}

#[wasm_bindgen]
impl DiscriminantAnalysis {
    #[wasm_bindgen(constructor)]
    pub fn new(
        group_data: JsValue,
        independent_data: JsValue,
        selection_data: JsValue,
        group_data_defs: JsValue,
        independent_data_defs: JsValue,
        selection_data_defs: JsValue,
        config_data: JsValue,
        // Appended last so an older worker that omits it still constructs
        // (`undefined` deserialises to `None`).
        strata_data: JsValue
    ) -> Result<DiscriminantAnalysis, JsValue> {
        // Initialize error collector
        let mut error_collector = ErrorCollector::default();

        let logger = FunctionLogger::default();

        // Parse input data using serde_wasm_bindgen
        let group_data: Vec<Vec<DataRecord>> = match serde_wasm_bindgen::from_value(group_data) {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse group data: {}", e);
                error_collector.add_error("constructor.group_data", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let independent_data: Vec<Vec<DataRecord>> = match
            serde_wasm_bindgen::from_value(independent_data)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse independent data: {}", e);
                error_collector.add_error("constructor.independent_data", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let selection_data: Option<Vec<Vec<DataRecord>>> = match
            serde_wasm_bindgen::from_value(selection_data)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse selection data: {}", e);
                error_collector.add_error("constructor.selection_data", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let group_data_defs: Vec<Vec<VariableDefinition>> = match
            serde_wasm_bindgen::from_value(group_data_defs)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse group data definitions: {}", e);
                error_collector.add_error("constructor.group_data_defs", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let independent_data_defs: Vec<Vec<VariableDefinition>> = match
            serde_wasm_bindgen::from_value(independent_data_defs)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse independent data definitions: {}", e);
                error_collector.add_error("constructor.independent_data_defs", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        let selection_data_defs: Option<Vec<Vec<VariableDefinition>>> = match
            serde_wasm_bindgen::from_value(selection_data_defs)
        {
            Ok(data) => data,
            Err(e) => {
                let msg = format!("Failed to parse selection data definitions: {}", e);
                error_collector.add_error("constructor.selection_data_defs", &msg);
                return Err(string_to_js_error(msg));
            }
        };

        // Bootstrap strata variables are optional; a parse failure must not kill
        // the whole analysis, it only costs the bootstrap its stratification.
        let strata_data: Option<Vec<Vec<DataRecord>>> = match
            serde_wasm_bindgen::from_value(strata_data)
        {
            Ok(data) => data,
            Err(e) => {
                error_collector.add_error(
                    "constructor.strata_data",
                    &format!("Failed to parse strata data: {}", e)
                );
                None
            }
        };

        let config: DiscriminantConfig = match serde_wasm_bindgen::from_value::<DiscriminantConfig>(config_data.clone()) {
            Ok(data) => {
                // Debug-build log of the method settings received.
                crate::debug_log!("[DiscriminantAnalysis] Method config received: wilks={}, mahal={}, unex={}, fr={}, raos={}, f_value={}, f_prob={}, f_entry={}, f_removal={}, p_entry={}, p_removal={}",
                    data.method.wilks, data.method.mahalonobis,
                    data.method.unexplained, data.method.f_ratio, data.method.raos,
                    data.method.f_value, data.method.f_probability,
                    data.method.f_entry, data.method.f_removal,
                    data.method.p_entry, data.method.p_removal);
                data
            }
            Err(e) => {
                let msg =
                    format!("Failed to parse configuration: {}. Ensure field names match the expected format.", e);
                error_collector.add_error("constructor.config", &msg);

                // Try to get a more detailed error by inspecting the config data
                if let Ok(config_json) = js_sys::JSON::stringify(&config_data) {
                    let config_str = config_json.as_string().unwrap_or_default();
                    error_collector.add_error(
                        "constructor.config.raw",
                        &format!("Raw config: {}", config_str)
                    );
                }

                return Err(string_to_js_error(msg));
            }
        };

        // Validate important configuration
        if config.main.grouping_variable.is_empty() {
            let msg = "Grouping variable must be selected for discriminant analysis".to_string();
            error_collector.add_error("config.validation.grouping_variable", &msg);
            return Err(string_to_js_error(msg));
        }

        if config.main.independent_variables.is_empty() {
            let msg = "At least one independent variable must be selected".to_string();
            error_collector.add_error("config.validation.independent_variables", &msg);
            return Err(string_to_js_error(msg));
        }

        // Store data
        let data = AnalysisData {
            group_data,
            independent_data,
            selection_data,
            strata_data,
            row_numbers: None,
            group_data_defs,
            independent_data_defs,
            selection_data_defs,
        };

        // Create instance
        let mut analysis = DiscriminantAnalysis {
            config,
            data,
            result: None,
            error_collector,
            logger,
        };

        // Run the analysis using the function from function.rs
        match
            function::run_analysis(
                &analysis.data,
                &analysis.config,
                &mut analysis.error_collector,
                &mut analysis.logger
            )
        {
            Ok(result) => {
                analysis.result = result;
                Ok(analysis)
            }
            Err(e) => Err(e),
        }
    }

    // Use functions from function.rs
    pub fn get_results(&self) -> Result<JsValue, JsValue> {
        function::get_results(&self.result)
    }

    pub fn get_formatted_results(&self) -> Result<JsValue, JsValue> {
        function::get_formatted_results(&self.result)
    }

    pub fn get_all_errors(&self) -> JsValue {
        function::get_all_errors(&self.error_collector)
    }

    pub fn get_all_log(&self) -> Result<JsValue, JsValue> {
        function::get_all_log(&self.logger)
    }
}
