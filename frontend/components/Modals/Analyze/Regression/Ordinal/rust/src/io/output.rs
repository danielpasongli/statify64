use crate::model::{cell_probabilities, cumulative_probabilities};
use crate::optimizer::fit_location_only;
use crate::parallel::fit_non_parallel_location_only;
use crate::statistics::{
    actual_probabilities, correlation_matrix, covariance_matrix, displayed_log_likelihood,
    goodness_of_fit, model_fit_statistics,
    multinomial_log_likelihood_constant,
    parameter_statistics, predicted_categories, predicted_cell_counts, predicted_probabilities,
    excluding_log_likelihood, including_log_likelihood,
};
use crate::types::{
    EstimationOptions, FitResult, IterationHistoryMeta,
    IterationHistoryOptions, ModelType, PlumError, PlumFitOutput, PlumOutputMetadata,
    PlumOutputOptions, PlumSavedVariableOptions, PlumSpec, PlumWorkerPayload, SavedVariableColumn,
    SavedVariablesResult, Subpopulation,
};
use crate::validation::validate_input;

pub fn build_plum_output(
    input: &PlumWorkerPayload,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    fit: &FitResult,
) -> Result<PlumFitOutput, PlumError> {
    let output_options: Option<PlumOutputOptions> =
        serde_json::from_value(input.output_options.clone()).ok();
    let default_all = output_options.is_none();

    let want_goodness = output_options
        .as_ref()
        .and_then(|opt| opt.goodness_of_fit)
        .unwrap_or(default_all);
    let want_summary = output_options
        .as_ref()
        .and_then(|opt| opt.summary_statistics)
        .unwrap_or(default_all);
    let want_iteration = output_options
        .as_ref()
        .and_then(|opt| opt.print_iteration_history.or(opt.iteration_history))
        .unwrap_or(default_all);
    let want_cell_info = output_options
        .as_ref()
        .and_then(|opt| opt.cell_information)
        .unwrap_or(false);
    let want_predicted_prob = output_options
        .as_ref()
        .and_then(|opt| opt.predicted_probability)
        .unwrap_or(false);
    let want_actual_prob = output_options
        .as_ref()
        .and_then(|opt| opt.actual_probability)
        .unwrap_or(false);
    let want_parameters = output_options
        .as_ref()
        .and_then(|opt| opt.parameter_estimates)
        .unwrap_or(default_all);
    let want_covariance_table = output_options
        .as_ref()
        .and_then(|opt| opt.asymptotic_covariance)
        .unwrap_or(default_all);
    let want_correlation = output_options
        .as_ref()
        .and_then(|opt| opt.asymptotic_correlation)
        .unwrap_or(default_all);
    let want_covariance = want_covariance_table
        || output_options
        .as_ref()
        .and_then(|opt| opt.asymptotic_correlation)
        .unwrap_or(default_all)
        || want_parameters;
    let want_parallel = output_options
        .as_ref()
        .and_then(|opt| opt.test_of_parallel_lines)
        .unwrap_or(false);
    let iteration_history_every = output_options
        .as_ref()
        .and_then(|opt| opt.iteration_history_every.or(opt.iteration_history_step))
        .unwrap_or(1)
        .max(1);

    let mut warnings = fit.warnings.clone();
    let validation = validate_input(input);
    warnings.extend(validation.warnings);

    let mut covariance = None;
    if let Some(info) = &fit.information {
        if want_covariance || want_correlation || output_options.is_none() {
            if let Ok(matrix) = covariance_matrix(info) {
                covariance = Some(matrix);
            } else {
                warnings.push("Covariance matrix gagal dihitung".to_string());
            }
        }
    }

    let mut correlation = None;
    if let Some(cov) = &covariance {
        if want_correlation {
            correlation = Some(correlation_matrix(cov));
        }
    }

    let mut fit_with_cov = fit.clone();
    fit_with_cov.covariance = covariance.clone();
    fit_with_cov.correlation = correlation.clone();

    let alpha = EstimationOptions::from_payload(Some(&input.estimation_options)).alpha;
    let (mut parameter_estimates, mut param_warn) =
        parameter_statistics(&fit_with_cov, spec, alpha);
    warnings.append(&mut param_warn);

    let threshold_estimates: Vec<_> = parameter_estimates
        .iter()
        .filter(|row| row.group == "Threshold")
        .cloned()
        .collect();
    let mut location_parameter_estimates: Vec<_> = parameter_estimates
        .iter()
        .filter(|row| row.group == "Location")
        .cloned()
        .collect();
    let scale_parameter_estimates: Vec<_> = parameter_estimates
        .iter()
        .filter(|row| row.group == "Scale")
        .cloned()
        .collect();

    if !spec.factor_level_metadata.is_empty() {
        let covariate_count = input
            .location_model
            .predictors
            .iter()
            .filter(|pred| pred.role == "covariate")
            .count();
        let mut ordered_location: Vec<_> = location_parameter_estimates
            .iter()
            .take(covariate_count)
            .cloned()
            .collect();
        let mut consumed_indices: std::collections::HashSet<usize> =
            (0..covariate_count).collect();

        for meta in &spec.factor_level_metadata {
            if let Some(active_idx) = meta.active_column_index {
                if let Some(row) = location_parameter_estimates.get(active_idx) {
                    let mut cloned = row.clone();
                    cloned.variable = meta.parameter_name.clone();
                    cloned.is_redundant = Some(meta.is_redundant);
                    ordered_location.push(cloned);
                    consumed_indices.insert(active_idx);
                } else {
                    warnings.push(format!(
                        "Parameter aktif untuk '{}' tidak ditemukan",
                        meta.parameter_name
                    ));
                }
            } else {
                ordered_location.push(crate::types::ParameterEstimateRow {
                    group: "Location".to_string(),
                    variable: meta.parameter_name.clone(),
                    estimate: 0.0,
                    std_error: None,
                    wald: None,
                    degrees_of_freedom: Some(0.0),
                    sig: None,
                    lower: None,
                    upper: None,
                    is_redundant: Some(true),
                });
            }
        }
        for (idx, row) in location_parameter_estimates.iter().enumerate() {
            if !consumed_indices.contains(&idx) {
                ordered_location.push(row.clone());
            }
        }
        location_parameter_estimates = ordered_location;
        parameter_estimates = threshold_estimates.clone();
        parameter_estimates.extend(location_parameter_estimates.clone());
        parameter_estimates.extend(scale_parameter_estimates.clone());
    }

    let goodness = if want_goodness {
        let (gof, mut gof_warn) = goodness_of_fit(&fit_with_cov, data, spec);
        warnings.append(&mut gof_warn);
        Some(gof)
    } else {
        None
    };

    let display_mode = output_options
        .as_ref()
        .and_then(|opt| opt.print_log_likelihood.as_deref())
        .map(|value| match value {
            "Including" | "SPSS_COMPATIBLE" | "including_log_likelihood" => including_log_likelihood,
            "Excluding" | "KERNEL" | "excluding_log_likelihood" => excluding_log_likelihood,
            _ => excluding_log_likelihood,
        })
        .unwrap_or(excluding_log_likelihood);

    let log_likelihood_constant = multinomial_log_likelihood_constant(data);
    let log_likelihood_kernel = fit.log_likelihood;
    let log_likelihood_complete = log_likelihood_kernel + log_likelihood_constant;
    let log_likelihood_displayed =
        displayed_log_likelihood(log_likelihood_kernel, log_likelihood_constant, display_mode);
    let minus2_log_likelihood_displayed = -2.0 * log_likelihood_displayed;

    let summary = if want_summary {
        let intercept_spec = intercept_only_spec(spec);
        let options = EstimationOptions::from_payload(Some(&input.estimation_options));
        let history_off = IterationHistoryOptions::disabled();
        let intercept_fit = fit_location_only(data, &intercept_spec, &options, &history_off)?;
        Some(model_fit_statistics(
            &fit_with_cov,
            &intercept_fit,
            spec,
            &options.method_label(),
            data.total_count,
            log_likelihood_constant,
            display_mode,
        ))
    } else {
        None
    };

    let iteration_history = if want_iteration {
        let adjustment = if display_mode == including_log_likelihood {
            -2.0 * log_likelihood_constant
        } else {
            0.0
        };
        let mut rows = Vec::with_capacity(fit.iteration_history.len());
        for row in &fit.iteration_history {
            let mut cloned = row.clone();
            cloned.minus2_log_likelihood_displayed = row.minus2_log_likelihood + adjustment;
            rows.push(cloned);
        }
        Some(rows)
    } else {
        None
    };
    let iteration_history_meta = if want_iteration {
        let threshold_names = (0..spec.threshold_count())
            .map(|index| format!("{}", index + 1))
            .collect::<Vec<_>>();
        let location_names = spec.feature_names.clone();
        let scale_names = spec.scale_feature_names.clone();
        Some(IterationHistoryMeta {
            link_function: input.estimation_options.link_function.clone(),
            iteration_history_every,
            threshold_names,
            location_names,
            scale_names,
            last_abs_change_minus2_log_likelihood: fit.last_abs_change_minus2_log_likelihood,
            last_max_abs_change_parameters: fit.last_max_abs_change_parameters,
            converged: fit.converged,
        })
    } else {
        None
    };

    let cell_information = if want_cell_info {
        Some(predicted_cell_counts(&fit_with_cov, data, spec))
    } else {
        None
    };

    let predicted_probability = if want_predicted_prob {
        Some(predicted_probabilities(&fit_with_cov, data, spec))
    } else {
        None
    };

    let actual_probability = if want_actual_prob {
        Some(actual_probabilities(data, spec))
    } else {
        None
    };

    let predicted_category = if want_predicted_prob {
        Some(predicted_categories(&fit_with_cov, data, spec))
    } else {
        None
    };
    let saved_variables = build_saved_variables(input, spec, &fit_with_cov, &mut warnings);

    let test_of_parallel_lines = if want_parallel {
        let options = EstimationOptions::from_payload(Some(&input.estimation_options));
        println!(
            "[ORDINAL][PARALLEL_LINES][PARALLEL_LL] {{\"logLikelihood\":{},\"minus2LogLikelihood\":{}}}",
            fit.log_likelihood,
            fit.minus2_log_likelihood
        );
        match fit_non_parallel_location_only(data, spec, &options, Some(fit)) {
            Ok(mut non_parallel_fit) => {
                warnings.append(&mut non_parallel_fit.warnings);
                let mut test = crate::parallel::test_parallel_lines(
                    fit,
                    &non_parallel_fit,
                    spec.location_parameter_count(),
                    spec.category_count,
                );
                if display_mode == including_log_likelihood {
                    let adjustment = -2.0 * log_likelihood_constant;
                    test.minus2_log_likelihood_parallel += adjustment;
                    test.minus2_log_likelihood_non_parallel += adjustment;
                }
                if !non_parallel_fit.converged {
                    warnings.push(
                        "The general model may be unstable or failed to converge.".to_string(),
                    );
                }
                if test.minus2_log_likelihood_non_parallel
                    > test.minus2_log_likelihood_parallel + 1e-8
                {
                    warnings.push(
                        "Parallel lines general model has a larger -2 Log Likelihood than the null hypothesis model; the general optimizer may not have reached the optimum.".to_string(),
                    );
                }
                Some(test)
            }
            Err(err) => {
                println!("[ORDINAL][PARALLEL_LINES][ERROR] {err}");
                warnings.push(format!("Parallel lines test gagal: {err}"));
                None
            }
        }
    } else {
        None
    };

    let metadata = PlumOutputMetadata {
        model_type: input.metadata.model_type.clone(),
        total_rows: input.metadata.total_rows,
        valid_rows: input.metadata.valid_rows,
        dropped_rows: input.metadata.dropped_rows,
        response_category_count: input.metadata.response_category_count,
        location_parameter_count: input.metadata.location_parameter_count,
        scale_parameter_count: input.metadata.scale_parameter_count,
    };

    Ok(PlumFitOutput {
        converged: fit.converged,
        iterations: fit.iterations,
        log_likelihood: log_likelihood_displayed,
        minus2_log_likelihood: minus2_log_likelihood_displayed,
        log_likelihood_constant,
        log_likelihood_kernel,
        log_likelihood_complete,
        log_likelihood_displayed,
        minus2_log_likelihood_displayed,
        log_likelihood_display_mode: display_mode.to_string(),
        parameter_estimates,
        threshold_estimates,
        location_parameter_estimates,
        scale_parameter_estimates,
        iteration_history: iteration_history.unwrap_or_else(|| Vec::new()),
        iteration_history_meta,
        warnings,
        metadata,
        goodness_of_fit: goodness,
        summary_statistics: summary,
        test_of_parallel_lines,
        cell_information,
        predicted_category,
        predicted_probability,
        actual_probability,
        saved_variables,
        covariance_matrix: if want_covariance_table { covariance.map(|m| matrix_to_vec(&m)) } else { None },
        correlation_matrix: if want_correlation { correlation.map(|m| matrix_to_vec(&m)) } else { None },
        errors: Vec::new(),
    })
}

fn intercept_only_spec(spec: &PlumSpec) -> PlumSpec {
    let mut intercept = spec.clone();
    intercept.model_type = ModelType::LocationOnly;
    intercept.feature_names = Vec::new();
    intercept.location_variables = Vec::new();
    intercept
}

fn matrix_to_vec(matrix: &nalgebra::DMatrix<f64>) -> Vec<Vec<f64>> {
    let mut rows = Vec::with_capacity(matrix.nrows());
    for i in 0..matrix.nrows() {
        let mut row = Vec::with_capacity(matrix.ncols());
        for j in 0..matrix.ncols() {
            row.push(matrix[(i, j)]);
        }
        rows.push(row);
    }
    rows
}

fn build_saved_variables(
    input: &PlumWorkerPayload,
    spec: &PlumSpec,
    fit: &FitResult,
    warnings: &mut Vec<String>,
) -> Option<SavedVariablesResult> {
    let options = input.saved_variables.as_ref()?;
    let flags = normalized_saved_variable_flags(options);
    if !flags.any() {
        return None;
    }
    if !fit.converged {
        warnings.push("Model belum konvergen; saved variables tidak dibuat".to_string());
        return None;
    }

    let total_rows = input.metadata.total_rows;
    let valid_rows = input.response.response_vector.len();
    if input.row_index_map.len() != valid_rows {
        warnings.push("rowIndexMap tidak cocok; saved variables tidak dibuat".to_string());
        return None;
    }
    if input.location_model.location_design_matrix.len() != valid_rows {
        warnings.push("locationDesignMatrix tidak cocok; saved variables tidak dibuat".to_string());
        return None;
    }
    if input.scale_model.enabled && input.scale_model.scale_design_matrix.len() != valid_rows {
        warnings.push("scaleDesignMatrix tidak cocok; saved variables tidak dibuat".to_string());
        return None;
    }

    let category_count = spec.category_count;
    let batch_suffix = find_saved_variable_batch_suffix(&input.existing_column_names);
    let predicted_type = if input
        .dependent
        .as_ref()
        .and_then(|var| var.r#type.as_deref())
        .map(|kind| kind.eq_ignore_ascii_case("STRING"))
        .unwrap_or(false)
        || input
            .response
            .response_categories
            .iter()
            .any(|category| category.is_string())
    {
        "string"
    } else {
        "numeric"
    };

    let mut predicted_values = vec![None; total_rows];
    let mut estimated_values = vec![vec![None; total_rows]; category_count];
    let mut predicted_probability_values = vec![None; total_rows];
    let mut actual_probability_values = vec![None; total_rows];

    for row_idx in 0..valid_rows {
        let Some(&original_row_idx) = input.row_index_map.get(row_idx) else {
            continue;
        };
        if original_row_idx >= total_rows {
            continue;
        }

        let x = input.location_model.location_design_matrix[row_idx].clone();
        let z = if input.scale_model.enabled {
            input.scale_model.scale_design_matrix[row_idx].clone()
        } else {
            Vec::new()
        };
        let subpop = Subpopulation {
            x,
            z,
            counts: vec![0.0; category_count],
            cumulative_counts: Vec::new(),
            marginal_count: 0.0,
        };
        let cumulative = cumulative_probabilities(&fit.params, &subpop, spec);
        let probs = cell_probabilities(&cumulative);
        if probs.len() != category_count {
            continue;
        }

        let mut predicted_idx = 0;
        let mut predicted_prob = probs[0];
        for (idx, prob) in probs.iter().enumerate().skip(1) {
            if *prob > predicted_prob {
                predicted_prob = *prob;
                predicted_idx = idx;
            }
        }

        let actual_prob = crate::data::encode_category(
            input.response.response_vector[row_idx],
            &spec.ordered_categories,
        )
        .ok()
        .and_then(|idx| probs.get(idx).copied());

        predicted_values[original_row_idx] = input
            .response
            .response_categories
            .get(predicted_idx)
            .cloned();
        for category_idx in 0..category_count {
            estimated_values[category_idx][original_row_idx] =
                Some(serde_json::Value::from(probs[category_idx]));
        }
        predicted_probability_values[original_row_idx] =
            Some(serde_json::Value::from(predicted_prob));
        actual_probability_values[original_row_idx] = actual_prob.map(serde_json::Value::from);
    }

    let mut columns = Vec::new();
    if flags.predicted_response_category {
        columns.push(SavedVariableColumn {
            name: format!("PRE_{batch_suffix}"),
            label: "Predicted Response Category".to_string(),
            column_type: predicted_type.to_string(),
            decimals: None,
            values: predicted_values,
        });
    }
    if flags.estimated_response_probabilities {
        for category_idx in 0..category_count {
            columns.push(SavedVariableColumn {
                name: format!("EST{}_{}", category_idx + 1, batch_suffix),
                label: format!(
                    "Estimated Cell Probability for Response Category: {}",
                    input
                        .response
                        .response_categories
                        .get(category_idx)
                        .map(value_to_label)
                        .unwrap_or_else(|| spec.category_label(category_idx))
                ),
                column_type: "numeric".to_string(),
                decimals: Some(6),
                values: estimated_values[category_idx].clone(),
            });
        }
    }
    if flags.predicted_category_probability {
        columns.push(SavedVariableColumn {
            name: format!("PCP_{batch_suffix}"),
            label: "Estimated Classification Probability for the Predicted Category".to_string(),
            column_type: "numeric".to_string(),
            decimals: Some(6),
            values: predicted_probability_values,
        });
    }
    if flags.actual_category_probability {
        columns.push(SavedVariableColumn {
            name: format!("ACP_{batch_suffix}"),
            label: "Estimated Classification Probability for the Actual Category".to_string(),
            column_type: "numeric".to_string(),
            decimals: Some(6),
            values: actual_probability_values,
        });
    }

    Some(SavedVariablesResult {
        batch_suffix,
        columns,
    })
}

#[derive(Default)]
struct SavedVariableFlags {
    predicted_response_category: bool,
    estimated_response_probabilities: bool,
    predicted_category_probability: bool,
    actual_category_probability: bool,
}

impl SavedVariableFlags {
    fn any(&self) -> bool {
        self.predicted_response_category
            || self.estimated_response_probabilities
            || self.predicted_category_probability
            || self.actual_category_probability
    }
}

fn normalized_saved_variable_flags(options: &PlumSavedVariableOptions) -> SavedVariableFlags {
    SavedVariableFlags {
        predicted_response_category: options
            .predicted_response_category
            .or(options.predicted_category)
            .unwrap_or(false),
        estimated_response_probabilities: options
            .estimated_response_probabilities
            .or(options.estimate_response_probability)
            .unwrap_or(false),
        predicted_category_probability: options.predicted_category_probability.unwrap_or(false),
        actual_category_probability: options.actual_category_probability.unwrap_or(false),
    }
}

fn find_saved_variable_batch_suffix(existing_column_names: &[String]) -> usize {
    let existing = existing_column_names
        .iter()
        .map(|name| name.to_uppercase())
        .collect::<Vec<_>>();
    let mut suffix = 1;
    while saved_variable_suffix_exists(&existing, suffix) {
        suffix += 1;
    }
    suffix
}

fn saved_variable_suffix_exists(existing: &[String], suffix: usize) -> bool {
    let suffix_text = suffix.to_string();
    existing.iter().any(|name| {
        name == &format!("PRE_{suffix}")
            || name == &format!("PCP_{suffix}")
            || name == &format!("ACP_{suffix}")
            || name
                .strip_prefix("EST")
                .and_then(|rest| rest.split_once('_'))
                .map(|(_, candidate_suffix)| candidate_suffix == suffix_text)
                .unwrap_or(false)
    })
}

fn value_to_label(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Number(number) => number.to_string(),
        serde_json::Value::Bool(flag) => flag.to_string(),
        serde_json::Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}
