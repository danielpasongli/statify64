use wasm_bindgen::prelude::*;

use crate::models::{
    config::DiscriminantConfig,
    data::AnalysisData,
    result::DiscriminantResult,
};
use crate::stats::core;
use crate::utils::converter::format_result;
use crate::utils::log::FunctionLogger;
use crate::utils::{ converter::string_to_js_error, error::ErrorCollector };

pub fn run_analysis(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    error_collector: &mut ErrorCollector,
    logger: &mut FunctionLogger
) -> Result<Option<DiscriminantResult>, JsValue> {
    crate::debug_log!("Starting discriminant analysis");

    // Reset the per-analysis stepwise-selection cache so this run never reuses a
    // selection from a previous analysis in the same worker instance.
    core::clear_selected_vars_cache();
    core::clear_analysis_warnings();

    // Debug-build log of the configuration.
    crate::debug_log!("Config: {:?}", config);

    // Case processing summary (always computed).
    logger.add_log("basic_processing_summary");
    let processing_summary = match core::basic_processing_summary(data, config) {
        Ok(summary) => summary,
        Err(e) => {
            error_collector.add_error("basic_processing_summary", &e);
            return Err(string_to_js_error(e));
        }
    };

    crate::debug_log!("Processing Summary: {:?}", processing_summary);

    // Analysis cases: selected, group code in range, no missing predictor.
    let filtered_data = match core::filter_valid_cases(data, config) {
        Ok(filtered) => filtered,
        Err(e) => {
            error_collector.add_error("filter_valid_cases", &e);
            return Err(string_to_js_error(e));
        }
    };

    // "Replace missing values with mean": cases left out of the analysis for a missing
    // predictor are still classified (casewise, classification results, plots), with
    // the predictor means of the analysis cases substituted.
    let substituted_cases = if config.classify.replace {
        match core::mean_substituted_cases(data, &filtered_data, config) {
            Ok(cases) => cases,
            Err(e) => {
                error_collector.add_error("mean_substituted_cases", &e);
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    // Cases with a missing or out-of-range group code are left out of the analysis
    // but classified, as SPSS does ("Ungrouped cases"), wherever cases are classified:
    // Classification Results, Casewise Statistics and the plots.
    let classifies_cases = config.classify.summary
        || config.classify.leave
        || config.classify.case
        || config.classify.combine
        || config.classify.sep_grp;
    let ungrouped = if classifies_cases {
        match core::ungrouped_cases(data, &filtered_data, config) {
            Ok(cases) => cases,
            Err(e) => {
                error_collector.add_error("ungrouped_cases", &e);
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    // Group statistics (always computed; means only with Statistics → Means).
    let mut group_statistics = None;
    logger.add_log("calculate_group_statistics");
    match core::calculate_group_statistics(&filtered_data, config) {
        Ok(stats) => {
            group_statistics = Some(stats);
            crate::debug_log!("Group Statistics: {:?}", group_statistics);
        }
        Err(e) => {
            error_collector.add_error("calculate_group_statistics", &e);
            // Continue execution despite errors for non-critical functions
        }
    }

    // Tests of Equality of Group Means.
    let mut equality_tests = None;
    if config.statistics.anova {
        logger.add_log("calculate_equality_tests");
        match core::calculate_equality_tests(&filtered_data, config) {
            Ok(tests) => {
                equality_tests = Some(tests);
                crate::debug_log!("Equaltiy Test: {:?}", equality_tests);
            }
            Err(e) => {
                error_collector.add_error("calculate_equality_tests", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Pooled within-groups covariance / correlation matrices.
    let mut pooled_matrices = None;
    if config.statistics.wg_correlation || config.statistics.wg_covariance {
        logger.add_log("calculate_pooled_matrices");
        match core::calculate_pooled_matrices(&filtered_data, config) {
            Ok(matrices) => {
                pooled_matrices = Some(matrices);
                crate::debug_log!("Pooled Matrices: {:?}", pooled_matrices);
            }
            Err(e) => {
                error_collector.add_error("calculate_pooled_matrices", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Separate-groups and total covariance matrices.
    let mut covariance_matrices = None;
    if config.statistics.sg_covariance || config.statistics.total_covariance {
        logger.add_log("calculate_covariance_matrices");
        match core::calculate_covariance_matrices(&filtered_data, config) {
            Ok(matrices) => {
                covariance_matrices = Some(matrices);
                crate::debug_log!("Covariance Matrices: {:?}", covariance_matrices);
            }
            Err(e) => {
                error_collector.add_error("calculate_covariance_matrices", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Log determinants and Box's M.
    let mut log_determinants = None;
    let mut box_m_test = None;
    if config.statistics.box_m {
        logger.add_log("calculate_log_determinants");
        match core::calculate_log_determinants(&filtered_data, config) {
            Ok(determinants) => {
                log_determinants = Some(determinants);
                crate::debug_log!("Log Determinants: {:?}", log_determinants);
            }
            Err(e) => {
                error_collector.add_error("calculate_log_determinants", &e);
                // Continue execution despite errors for non-critical functions
            }
        }

        logger.add_log("calculate_box_m_test");
        match core::calculate_box_m_test(&filtered_data, config) {
            Ok(test) => {
                box_m_test = Some(test);
                crate::debug_log!("Box M: {:?}", box_m_test);
            }
            Err(e) => {
                error_collector.add_error("calculate_box_m_test", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Stepwise variable selection.
    let mut stepwise_statistics = None;
    let mut wilks_lambda_test = None;

    if config.main.stepwise {
        // Stepwise statistics
        logger.add_log("calculate_stepwise_statistics");
        // A stepwise failure is fatal: every downstream table depends on the selected
        // variables, and continuing would silently report "enter together" results
        // under a stepwise analysis.
        let statistics = match core::calculate_stepwise_statistics(&filtered_data, config) {
            Ok(statistics) => statistics,
            Err(e) => {
                error_collector.add_error("calculate_stepwise_statistics", &e);
                return Err(string_to_js_error(format!("Stepwise selection failed: {}", e)));
            }
        };
        // Prime the cache from this single stepwise run so eigen/canonical/
        // structure/wilks/casewise/classification reuse the selection instead
        // of recomputing the whole procedure.
        match core::select_final_variables(&statistics) {
            Ok(selected) => core::prime_selected_vars_cache(selected),
            Err(e) => {
                error_collector.add_error("select_final_variables", &e);
                return Err(string_to_js_error(e));
            }
        }
        stepwise_statistics = Some(statistics);
        crate::debug_log!("Stepwise Statistics: {:?}", stepwise_statistics);
    }

    // Eigenvalues of the discriminant functions.
    logger.add_log("calculate_eigen_values");
    let eigen_description = match core::calculate_eigen_statistics(&filtered_data, config) {
        Ok(values) => {
            crate::debug_log!("Eigen Values: {:?}", values);
            Some(values)
        }
        Err(e) => {
            error_collector.add_error("calculate_eigen_values", &e);
            return Err(string_to_js_error(e));
        }
    };

    // Wilks' lambda test of the functions.
    logger.add_log("calculate_wilks_lambda_test");
    match core::calculate_wilks_lambda_test(&filtered_data, config) {
        Ok(test) => {
            wilks_lambda_test = Some(test);
            crate::debug_log!("Wilks' Lambda Test: {:?}", wilks_lambda_test);
        }
        Err(e) => {
            error_collector.add_error("calculate_wilks_lambda_test", &e);
            // Continue execution despite errors for non-critical functions
        }
    }

    // Canonical discriminant function coefficients and group centroids.
    logger.add_log("calculate_canonical_functions");
    let canonical_functions = match core::calculate_canonical_functions(&filtered_data, config) {
        Ok(functions) => {
            crate::debug_log!("Canonical Functions: {:?}", functions);
            Some(functions)
        }
        Err(e) => {
            error_collector.add_error("calculate_canonical_functions", &e);
            return Err(string_to_js_error(e));
        }
    };

    // Structure matrix.
    logger.add_log("calculate_structure_matrix");
    let structure_matrix = match core::calculate_structure_matrix(&filtered_data, config) {
        Ok(matrix) => {
            crate::debug_log!("Structure Matrix: {:?}", matrix);
            Some(matrix)
        }
        Err(e) => {
            error_collector.add_error("calculate_structure_matrix", &e);
            None
        }
    };

    // Classification statistics.
    let mut classification_function_coefficients = None;
    let mut prior_probabilities = None;
    // Prior Probabilities for Groups accompany any classification output, so
    // compute them whenever a summary, casewise, leave-one-out, or Fisher's
    // classification function table is asked for.
    if config.classify.summary
        || config.classify.case
        || config.classify.leave
        || config.statistics.fisher
    {
        logger.add_log("calculate_prior_probabilities");
        match core::calculate_prior_probabilities(&filtered_data, config) {
            Ok(probabilities) => {
                prior_probabilities = Some(probabilities);
                crate::debug_log!("Prior Probabilities: {:?}", prior_probabilities);
            }
            Err(e) => {
                error_collector.add_error("calculate_prior_probabilities", &e);
                // Continue execution despite errors for non-critical functions
            }
        }
    }
    // Classification Function Coefficients (Fisher's linear discriminant functions)
    // come from Statistics → Function Coefficients → Fisher's, as in SPSS
    // (/STATISTICS=COEFF) — not from Classify → Summary table.
    if config.statistics.fisher {
        logger.add_log("calculate_summary_classification");
        match core::calculate_summary_classification(&filtered_data, config) {
            Ok(functions) => {
                classification_function_coefficients = Some(functions);
                crate::debug_log!("Summary Classification: {:?}", classification_function_coefficients);
            }
            Err(e) => {
                error_collector.add_error("calculate_summary_classification", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Classify → Use Covariance Matrix → Separate-groups: SPSS displays each group's
    // covariance matrix of the canonical discriminant functions (the matrices that
    // classify the cases under this option) and Box's test of their equality.
    let mut separate_groups_classification = None;
    if config.classify.sep_group {
        logger.add_log("calculate_separate_groups_classification");
        match core::calculate_separate_groups_classification(&filtered_data, config) {
            Ok(result) => {
                separate_groups_classification = Some(result);
            }
            Err(e) => {
                error_collector.add_error("calculate_separate_groups_classification", &e);
            }
        }
    }

    let mut casewise_statistics = None;
    if config.classify.case {
        logger.add_log("Casewise Statistics");
        match core::calculate_casewise_statistics(&filtered_data, config, &substituted_cases, &ungrouped) {
            Ok(stats) => {
                casewise_statistics = Some(stats);
                crate::debug_log!("Casewise Statistics: {:?}", casewise_statistics);
            }
            Err(e) => {
                error_collector.add_error("calculate_casewise_statistics", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // Per-case scores for the Combined-/Separate-groups plots (scatterplots, or
    // histograms with a single function). Computed whenever a plot is requested,
    // also with Casewise on: the casewise table may stop at "Limit cases to first n",
    // but the plots cover every classified case.
    let mut scatter_data = None;
    if config.classify.combine || config.classify.sep_grp {
        match core::calculate_scatter_data(&filtered_data, config, &substituted_cases, &ungrouped) {
            Ok(sd) => {
                scatter_data = Some(sd);
            }
            Err(e) => {
                error_collector.add_error("calculate_scatter_data", &e);
            }
        }
    }

    // Bootstrap resampling. Holds the selected model fixed (reuses the cached
    // selection) and refits the canonical coefficients directly on each resample,
    // so it neither re-runs stepwise nor disturbs the cache.
    // Bootstrap applies only to "enter independents together" and is skipped under
    // the stepwise method.
    let mut bootstrap_results = None;
    if config.bootstrap.perform_boot_strapping && !config.main.stepwise {
        logger.add_log("calculate_bootstrap");
        match core::calculate_bootstrap(&filtered_data, config) {
            Ok(b) => {
                bootstrap_results = Some(b);
            }
            Err(e) => {
                error_collector.add_error("calculate_bootstrap", &e);
            }
        }
    }

    // Pre-results assumption checks (multicollinearity, multivariate &
    // univariate normality). Computed once from the filtered data;
    // each table carries its own PASS/VIOLATED warning to the output.
    let mut assumption_results = None;
    let want_assumptions = config.assumptions.multicollinearity
        || config.assumptions.multivariate_normality
        || config.assumptions.univariate_normality;
    if want_assumptions {
        logger.add_log("calculate_assumptions");
        match core::calculate_assumptions(&filtered_data, config) {
            Ok(a) => {
                assumption_results = Some(a);
            }
            Err(e) => {
                error_collector.add_error("calculate_assumptions", &e);
            }
        }
    }

    // Classification Results (hit ratio): Classify → Summary table gives the
    // Original block (SPSS /STATISTICS=TABLE); Leave-one-out adds the Cross-validated
    // block (/STATISTICS=CROSSVALID), and on its own still shows both blocks, as SPSS
    // does. calculate_classification_results only cross-validates under `leave`.
    let mut classification_results = None;
    if config.classify.summary || config.classify.leave {
        // Testing part of a training/testing split: the cases the selection variable
        // leaves out are classified with the functions from the selected cases and
        // reported separately, as SPSS does. Empty without a selection variable.
        let unselected = match core::unselected_cases(data, &filtered_data, config) {
            Ok(cases) => cases,
            Err(e) => {
                error_collector.add_error("unselected_cases", &e);
                Vec::new()
            }
        };
        logger.add_log("calculate_classification_results");
        match core::calculate_classification_results(&filtered_data, config, &substituted_cases, &unselected, &ungrouped) {
            Ok(results) => {
                crate::debug_log!("Classification Results: {:?}", results);
                classification_results = Some(results);
            }
            Err(e) => {
                error_collector.add_error("calculate_classification_results", &e);
                // Continue execution despite errors for non-critical functions
            }
        };
    }

    // The territorial map is drawn on Functions 1 × 2; like SPSS, it is not
    // displayed when there is only one discriminant function.
    let num_functions = eigen_description.as_ref().map_or(0, |e| e.eigenvalue.len());
    if config.classify.terr && num_functions < 2 {
        core::push_analysis_warning(
            "territorial_map",
            "The territorial map is not displayed because there is only one discriminant function (it needs at least three groups and two predictors).".to_string(),
        );
    }

    // Forward warnings raised inside the statistics routines (singular matrices,
    // fallbacks, excluded groups) so they reach the user alongside the errors.
    for (context, message) in core::take_analysis_warnings() {
        error_collector.add_error(&format!("Warning ({})", context), &message);
    }

    // Assemble the result.
    let result = DiscriminantResult {
        processing_summary,
        group_statistics,
        equality_tests,
        canonical_functions,
        structure_matrix,
        classification_results,
        box_m_test,
        pooled_matrices,
        covariance_matrices,
        log_determinants,
        stepwise_statistics,
        eigen_description,
        wilks_lambda_test,
        casewise_statistics,
        prior_probabilities,
        classification_function_coefficients,
        scatter_data,
        bootstrap_results,
        assumption_results,
        territorial_map: config.classify.terr,
        combined_groups_plot: config.classify.combine,
        separate_groups_plot: config.classify.sep_grp,
        unstandardized_coefficients: config.statistics.unstandardized,
        separate_groups_classification,
    };

    Ok(Some(result))
}

pub fn get_results(result: &Option<DiscriminantResult>) -> Result<JsValue, JsValue> {
    match result {
        Some(result) => {
            if let Some(ref step_stats) = result.stepwise_statistics {
                crate::debug_log!(
                    "[get_results] min_d_squared: {:?}, len={}",
                    step_stats.min_d_squared,
                    step_stats.min_d_squared.len()
                );
            }
            let js_val = serde_wasm_bindgen::to_value(result).unwrap();
            crate::debug_log!("[get_results] serialized");
            Ok(js_val)
        }
        None => Err(string_to_js_error("No analysis results available".to_string())),
    }
}

pub fn get_formatted_results(result: &Option<DiscriminantResult>) -> Result<JsValue, JsValue> {
    format_result(result)
}

pub fn get_all_errors(error_collector: &ErrorCollector) -> JsValue {
    JsValue::from_str(&error_collector.get_error_summary())
}

pub fn get_all_log(logger: &FunctionLogger) -> Result<JsValue, JsValue> {
    Ok(serde_wasm_bindgen::to_value(&logger.get_executed_functions()).unwrap_or(JsValue::NULL))
}
