use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;

use crate::{
    models::{
        result::{
            PairwiseComparison, StepwiseNote, StepwiseStatistics, VariableInAnalysis,
            VariableNotInAnalysis,
        },
        AnalysisData, DiscriminantConfig,
    },
    stats::common::chi_squared_cdf_upper,
    stats::core::{calculate_p_value_from_f, extract_analyzed_dataset, AnalyzedDataset},
};

use super::core::{
    analyze_variables_in_model, analyze_variables_not_in_model, calculate_min_f_ratio_with_groups,
    calculate_min_mahalanobis_distance, calculate_min_mahalanobis_distance_with_groups,
    calculate_overall_wilks_lambda, calculate_raos_v, calculate_total_unexplained_variation,
    determine_method_type, find_best_variable_to_enter, find_worst_variable_to_remove,
    generate_pairwise_comparisons,
};

/// Method type enum for different stepwise methods
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum MethodType {
    Wilks,
    Unexplained,
    Mahalanobis,
    FRatio,
    Raos,
}

/// Helper struct to store step data
#[derive(Debug, Serialize, Deserialize, Clone)]
struct StepData {
    variable_entered: Option<String>,
    variable_removed: Option<String>,
    min_d_squared: f64,       // method statistic of the model (Min D² / Min F / Residual Variance)
    between_groups: String,   // closest/min pair for Mahalanobis & Smallest F methods
    wilks_lambda: f64,
    wilks_exact_f: f64,       // model's Wilks F (Rao's F) for the Wilks' Lambda table
    wilks_exact_df1: i32,
    wilks_exact_df2: f64,     // fractional when Rao's F is approximate
    wilks_exact_sig: f64,
    wilks_f_exact: bool,      // Rao's F is exact: min(p, g - 1) <= 2
    f_to_enter: f64,
    f_to_enter_df1: i32,
    f_to_enter_df2: f64,
    significance: f64,
    raos_v: f64,              // Rao's V cumulative value
    change_in_v: f64,         // Change in V (ΔV)
    change_sig: f64,          // Significance of change
    variables_in_analysis: Vec<VariableInAnalysis>,
    variables_not_in_analysis: Vec<VariableNotInAnalysis>,
    pairwise_comparisons: HashMap<String, Vec<PairwiseComparison>>,
}

/// Calculate statistics for stepwise discriminant analysis
///
/// This function performs stepwise variable selection and calculates
/// associated statistics for discriminant analysis.
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A StepwiseStatistics object with variable selection results
pub fn calculate_stepwise_statistics(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<StepwiseStatistics, String> {
    // Check if stepwise analysis is requested
    if !config.main.stepwise {
        let err = "Stepwise analysis not requested".to_string();
        return Err(err);
    }

    // Get variables and extract analyzed dataset
    let variables = &config.main.independent_variables;

    let dataset = match extract_analyzed_dataset(data, config) {
        Ok(ds) => ds,
        Err(e) => {
            return Err(e);
        }
    };

    if dataset.num_groups < 2 {
        let err = format!(
            "Not enough valid groups for analysis: found {} groups",
            dataset.num_groups
        );
        return Err(err);
    }

    // Selection runs when an entry criterion is flagged, or under Rao's V; otherwise
    // only step 0 is reported.
    let steps_data = if config.method.f_value || config.method.f_probability || determine_method_type(config) == MethodType::Raos {
        match perform_stepwise_analysis(&dataset, variables, config) {
            Ok(data) => data,
            Err(e) => {
                return Err(e);
            }
        }
    } else {
        vec![create_initial_step(&dataset, variables, config)?]
    };

    // Convert step data to output format
    match convert_steps_to_output(steps_data, config, dataset.num_groups) {
        Ok(result) => Ok(result),
        Err(e) => Err(e),
    }
}

/// Perform stepwise analysis
///
/// Each step first tries to remove the model variable with the smallest F to Remove
/// (when it fails the removal criterion), and otherwise to enter the best candidate
/// (when it passes the entry criterion). The procedure stops when no variable moves,
/// after 2 × (number of variables) steps, or when a step would return to a variable
/// set already visited.
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `variables` - Variables to consider for selection
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A vector of StepData containing results for each step
fn perform_stepwise_analysis(
    dataset: &AnalyzedDataset,
    variables: &Vec<String>,
    config: &DiscriminantConfig,
) -> Result<Vec<StepData>, String> {
    let mut current_variables: Vec<String> = Vec::new();
    let mut remaining_variables: Vec<String> = variables.clone();
    let mut steps_data: Vec<StepData> = Vec::new();

    // Variable sets already visited; returning to one would cycle forever.
    let mut seen_states: HashSet<String> = HashSet::new();
    seen_states.insert(String::new());

    // Add initial step (Step 0)
    let initial_step = create_initial_step(dataset, variables, config)?;
    steps_data.push(initial_step.clone());

    let method_type = determine_method_type(config);
    let max_steps = variables.len() * 2;
    let mut step = 0;
    let mut prev_raos_v: f64 = 0.0;

    while step < max_steps {
        let mut step_action_taken = false;

        // 1. Removal first: the variable with the smallest F to Remove.
        if current_variables.len() > 1 {
            let (worst_var_to_remove, worst_stats) =
                find_worst_variable_to_remove(&current_variables, dataset, method_type, config)?;

            let should_remove = should_remove_variable(
                &worst_var_to_remove,
                &worst_stats,
                dataset,
                &current_variables,
                config,
            );

            if should_remove {
                if let Some(var_name) = worst_var_to_remove {
                    // Stop when the step would return to a variable set already visited.
                    let mut next_state = current_variables.clone();
                    next_state.retain(|v| v != &var_name);
                    next_state.sort();
                    let state_key = next_state.join(",");

                    if seen_states.contains(&state_key) {
                        break; // cycle
                    }
                    seen_states.insert(state_key);

                    // Remove it.
                    current_variables.retain(|v| v != &var_name);
                    remaining_variables.push(var_name.clone());

                    let step_data = create_step_data(
                        dataset,
                        &current_variables,
                        &remaining_variables,
                        None,
                        Some(var_name.clone()),
                        (step as i32) + 1,
                        method_type,
                        config,
                        prev_raos_v,
                    )?;
                    prev_raos_v = step_data.raos_v;
                    steps_data.push(step_data);

                    step += 1;
                    continue;
                }
            }
        }

        // 2. Otherwise entry: the best candidate.
        if !step_action_taken && !remaining_variables.is_empty() {
            let (best_var_to_enter, best_stats) = find_best_variable_to_enter(
                &remaining_variables,
                dataset,
                &current_variables,
                method_type,
                config,
            )?;

            let should_enter = should_enter_variable(
                &best_var_to_enter,
                &best_stats,
                dataset,
                &current_variables,
                config,
            );

            if should_enter {
                if let Some(var_name) = best_var_to_enter {
                    // Stop when the step would return to a variable set already visited.
                    let mut next_state = current_variables.clone();
                    next_state.push(var_name.clone());
                    next_state.sort();
                    let state_key = next_state.join(",");

                    if seen_states.contains(&state_key) {
                        break; // cycle
                    }
                    seen_states.insert(state_key);

                    // Enter it.
                    current_variables.push(var_name.clone());
                    remaining_variables.retain(|v| v != &var_name);
                    step_action_taken = true;

                    let step_data = create_step_data(
                        dataset,
                        &current_variables,
                        &remaining_variables,
                        Some(var_name.clone()),
                        None,
                        (step as i32) + 1,
                        method_type,
                        config,
                        prev_raos_v,
                    )?;
                    prev_raos_v = step_data.raos_v;
                    steps_data.push(step_data);
                }
            }
        }

        if !step_action_taken {
            break;
        }

        step += 1;
    }

    Ok(steps_data)
}

/// Whether the best candidate enters the model:
///
/// - Rao's V: first ΔV ≥ VIN;
/// - then F ≥ FIN, or with probability of F, P(F(g − 1, n − g − q) > F) ≤ PIN
///   (q = variables already in the model).
///
/// With neither criterion flagged no variable enters, except under Rao's V, which
/// then uses F values.
pub fn should_enter_variable(
    var_opt: &Option<String>,
    stats: &VariableNotInAnalysis,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
    config: &DiscriminantConfig,
) -> bool {
    if var_opt.is_none() {
        return false;
    }

    let num_groups = dataset.num_groups;
    let total_cases = dataset.total_cases;
    let num_current_vars = current_variables.len();

    let thresholds = stepwise_thresholds(config);
    let f_entry_threshold = thresholds.f_entry;
    let p_entry_threshold = thresholds.p_entry;

    // Rao's V: f_to_enter holds the partial Wilks F (for display), and
    // min_d_squared holds ΔV (for selection and the VIN gate). Both gates must
    // pass: VIN (ΔV ≥ V-to-enter), then the same F / probability-of-F criterion
    // as every other method.
    let method_type = determine_method_type(config);
    if method_type == MethodType::Raos && stats.min_d_squared < thresholds.v_enter {
        return false;
    }

    // Rao's V runs even with neither criterion flagged, and then uses F values.
    let criterion_set = config.method.f_value || config.method.f_probability;
    if !criterion_set && method_type != MethodType::Raos {
        return false;
    }

    if uses_probability_of_f(config) {
        // df must match calculate_f_to_enter_wilks: (g - 1, n - g - q),
        // q = variables already in the model (candidate excluded).
        let df1 = num_groups as f64 - 1.0;
        let df2 = total_cases as f64 - num_groups as f64 - num_current_vars as f64;
        if df1 <= 0.0 || df2 <= 0.0 {
            return false;
        }
        let p_value = calculate_p_value_from_f(stats.f_to_enter, df1, df2);
        p_value <= p_entry_threshold
    } else {
        stats.f_to_enter >= f_entry_threshold
    }
}

/// True when entry and removal use the probability of F (PIN/POUT) instead of F
/// values (FIN/FOUT). F values win when both are flagged, and are the fallback
/// when neither is. create_stepwise_note uses the same rule for its footnotes.
fn uses_probability_of_f(config: &DiscriminantConfig) -> bool {
    !config.method.f_value && config.method.f_probability
}

/// Whether the model variable with the smallest F to Remove leaves the model:
/// F ≤ FOUT, or with probability of F, P(F(g − 1, n − g − p + 1) > F) ≥ POUT
/// (p = variables in the model).
fn should_remove_variable(
    var_opt: &Option<String>,
    stats: &VariableInAnalysis,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
    config: &DiscriminantConfig,
) -> bool {
    if var_opt.is_none() {
        return false;
    }

    let num_groups = dataset.num_groups;
    let total_cases = dataset.total_cases;
    let num_current_vars = current_variables.len();

    let thresholds = stepwise_thresholds(config);
    let f_removal_threshold = thresholds.f_removal;
    let p_removal_threshold = thresholds.p_removal;

    // Every method, Rao's V included, removes on the partial Wilks F-to-remove,
    // judged by F value or by its probability as the user chose.
    let method_type = determine_method_type(config);
    let criterion_set = config.method.f_value || config.method.f_probability;
    if !criterion_set && method_type != MethodType::Raos {
        return false;
    }

    if uses_probability_of_f(config) {
        // df2 must match how F-to-remove was computed in calculate_f_to_remove_wilks:
        // df2 = n - p - g + 1 (where p = num_current_vars)
        let df2 = total_cases as f64 - num_groups as f64 - num_current_vars as f64 + 1.0;
        let p_value = calculate_p_value_from_f(stats.f_to_remove, num_groups as f64 - 1.0, df2);
        p_value >= p_removal_threshold
    } else {
        stats.f_to_remove <= f_removal_threshold
    }
}

/// Create data for the initial step (no variables in the model)
fn create_initial_step(
    dataset: &AnalyzedDataset,
    variables: &[String],
    config: &DiscriminantConfig,
) -> Result<StepData, String> {
    let initial_variables_not_in = analyze_variables_not_in_model(variables, dataset, &[], config)?;

    Ok(StepData {
        variable_entered: None,
        variable_removed: None,
        min_d_squared: 0.0,
        between_groups: String::new(),
        wilks_lambda: 1.0,
        wilks_exact_f: 0.0,
        wilks_exact_df1: 0,
        wilks_exact_df2: 0.0,
        wilks_exact_sig: 1.0,
        wilks_f_exact: true,
        f_to_enter: 0.0,
        f_to_enter_df1: 0,
        f_to_enter_df2: 0.0,
        significance: 1.0,
        raos_v: 0.0,
        change_in_v: 0.0,
        change_sig: 1.0,
        variables_in_analysis: Vec::new(),
        variables_not_in_analysis: initial_variables_not_in,
        pairwise_comparisons: HashMap::new(),
    })
}

/// Create data for a step in the stepwise procedure
fn create_step_data(
    dataset: &AnalyzedDataset,
    current_variables: &[String],
    remaining_variables: &[String],
    variable_entered: Option<String>,
    variable_removed: Option<String>,
    step: i32,
    method_type: MethodType,
    config: &DiscriminantConfig,
    prev_raos_v: f64,
) -> Result<StepData, String> {
    let vars_in_analysis =
        analyze_variables_in_model(current_variables, dataset, method_type, config)?;

    // SPSS lists every variable not in the model in this table, so the full ranked
    // list is kept.
    let vars_not_in_analysis =
        analyze_variables_not_in_model(remaining_variables, dataset, current_variables, config)?;

    let combined_vars = current_variables.to_vec();
    let p = combined_vars.len() as f64;
    let k = dataset.num_groups as f64;
    let n = dataset.total_cases as f64;

    let wilks_lambda = if combined_vars.is_empty() {
        1.0
    } else {
        calculate_overall_wilks_lambda(dataset, &combined_vars)?
    };

    // Method statistic of the current model, shown in the Variables Entered/Removed
    // table (Min D² / Min F / Residual Variance). between_groups carries the pair
    // for the Mahalanobis & Smallest F methods.
    let (min_d_squared, step_between_groups) = if combined_vars.is_empty() {
        (0.0, String::new())
    } else {
        match method_type {
            MethodType::FRatio => {
                let r = calculate_min_f_ratio_with_groups(dataset, &combined_vars);
                let pair = if r.group_i.is_empty() {
                    String::new()
                } else {
                    format!("{} and {}", r.group_i, r.group_j)
                };
                (r.min_f, pair)
            }
            MethodType::Unexplained => (
                calculate_total_unexplained_variation(dataset, &combined_vars),
                String::new(),
            ),
            MethodType::Mahalanobis => {
                let r = calculate_min_mahalanobis_distance_with_groups(dataset, &combined_vars);
                (r.min_d2, format!("{} and {}", r.group_i, r.group_j))
            }
            _ => (calculate_min_mahalanobis_distance(dataset, &combined_vars), String::new()),
        }
    };

    let pairwise_comparisons = if config.method.pairwise {
        generate_pairwise_comparisons(dataset, current_variables, step)
    } else {
        HashMap::new()
    };

    // --- Calculate Rao's V for this step ---
    let raos_v = if combined_vars.is_empty() {
        0.0
    } else {
        calculate_raos_v(dataset, &combined_vars)
    };

    let change_in_v = raos_v - prev_raos_v;

    // ΔV = V(this step) − V(previous step), approximately chi-square with g − 1 df:
    // Sig. = P(χ²(g − 1) > ΔV).
    let df_change = k - 1.0;
    let change_sig = if change_in_v > 0.0 && df_change > 0.0 {
        chi_squared_cdf_upper(change_in_v, df_change)
    } else {
        1.0
    };

    // --- Model's Wilks F (Rao's F), computed for the per-step "Wilks' Lambda" table
    //     whatever the selection method. With p variables, g groups and n cases:
    //       t   = √[(p²(g − 1)² − 4) / (p² + (g − 1)² − 5)]   (1 when p(g − 1) = 2)
    //       w   = n − 1 − (p + g) / 2
    //       df1 = p(g − 1),   df2 = w·t − (p(g − 1) − 2) / 2
    //       F   = [(1 − Λ^(1/t)) / Λ^(1/t)] · df2 / df1
    // Rao's F is exact when min(p, g - 1) <= 2; df2 is then a whole number (rounded
    // only to drop floating-point noise). Otherwise it is an approximation with a
    // fractional df2, which is kept as is: truncating it would print the wrong df
    // and compute Sig. on a different df than the F itself.
    let (wilks_exact_f, wilks_exact_df1, wilks_exact_df2, wilks_f_exact) = if combined_vars.is_empty() {
        (0.0, 0, n - k, true)
    } else {
        let p_k1 = p * (k - 1.0);
        let t = if p_k1 == 2.0 {
            1.0
        } else {
            let numerator = p.powi(2) * (k - 1.0).powi(2) - 4.0;
            let denominator = p.powi(2) + (k - 1.0).powi(2) - 5.0;
            if denominator > 0.0 {
                (numerator / denominator).sqrt()
            } else {
                1.0
            }
        };
        let w = n - 1.0 - (p + k) / 2.0;
        let exact = p.min(k - 1.0) <= 2.0;
        let df2_raw = w * t - (p_k1 - 2.0) / 2.0;
        let df2_val = if exact { df2_raw.round() } else { df2_raw };
        let l_t = wilks_lambda.powf(1.0 / t);
        let f_val = if l_t > 0.0 && l_t <= 1.0 {
            ((1.0 - l_t) / l_t) * (df2_val / p_k1)
        } else {
            0.0
        };
        (f_val, p_k1 as i32, df2_val, exact)
    };
    let wilks_exact_sig =
        calculate_p_value_from_f(wilks_exact_f, wilks_exact_df1 as f64, wilks_exact_df2);

    // --- Method-specific statistic for the "Variables Entered/Removed" table. ---
    let (exact_f, exact_df1, exact_df2) = if combined_vars.is_empty() {
        (0.0, 0, n - k)
    } else if method_type == MethodType::FRatio {
        // Smallest F Ratio: shows the model's Min. F, distributed as F(p, N-g-p+1).
        (min_d_squared, p as i32, n - k - p + 1.0)
    } else if method_type == MethodType::Mahalanobis {
        // Mahalanobis: Exact F of the two closest groups, the same F test as the
        // pairwise group comparisons and the Smallest F Ratio method:
        // F = (N-g-p+1) / (p(N-g)) · n_i·n_j/(n_i+n_j) · D², on (p, N-g-p+1) df.
        let min_result = calculate_min_mahalanobis_distance_with_groups(dataset, &combined_vars);
        let df2 = n - k - p + 1.0;
        let n_i = min_result.n_i as f64;
        let n_j = min_result.n_j as f64;
        let f_val = if df2 > 0.0 && p > 0.0 && (n - k) > 0.0 && (n_i + n_j) > 0.0 {
            (df2 / (p * (n - k))) * ((n_i * n_j) / (n_i + n_j)) * min_result.min_d2
        } else {
            0.0
        };
        (f_val, p as i32, df2)
    } else {
        // Wilks / Rao's V / Unexplained: model's Wilks F (Rao's F).
        (wilks_exact_f, wilks_exact_df1, wilks_exact_df2)
    };

    let significance = calculate_p_value_from_f(exact_f, exact_df1 as f64, exact_df2);

    Ok(StepData {
        variable_entered,
        variable_removed,
        min_d_squared,
        between_groups: step_between_groups,
        wilks_lambda,
        wilks_exact_f,
        wilks_exact_df1,
        wilks_exact_df2,
        wilks_exact_sig,
        wilks_f_exact,
        f_to_enter: exact_f,
        f_to_enter_df1: exact_df1,
        f_to_enter_df2: exact_df2,
        significance,
        raos_v,
        change_in_v,
        change_sig,
        variables_in_analysis: vars_in_analysis,
        variables_not_in_analysis: vars_not_in_analysis,
        pairwise_comparisons,
    })
}

/// Convert internal step data to the output format
fn convert_steps_to_output(
    steps_data: Vec<StepData>,
    config: &DiscriminantConfig,
    num_groups: usize,
) -> Result<StepwiseStatistics, String> {
    let method_type = determine_method_type(config);
    let method_str = match method_type {
        MethodType::Wilks => "wilks",
        MethodType::Unexplained => "unexplained",
        MethodType::Mahalanobis => "mahalanobis",
        MethodType::FRatio => "f_ratio",
        MethodType::Raos => "raos_v",
    }.to_string();

    let mut result = StepwiseStatistics {
        method: method_str,
        num_groups,
        variables_entered: Vec::new(),
        variables_removed: Vec::new(),
        min_d_squared: Vec::new(),
        between_groups: Vec::new(),
        wilks_lambda: Vec::new(),
        f_to_enter: Vec::new(),
        f_to_enter_df1: Vec::new(),
        f_to_enter_df2: Vec::new(),
        significance: Vec::new(),
        wilks_exact_f: Vec::new(),
        wilks_exact_df1: Vec::new(),
        wilks_exact_df2: Vec::new(),
        wilks_exact_sig: Vec::new(),
        wilks_f_exact: Vec::new(),
        raos_v: Vec::new(),
        raos_v_sig: Vec::new(),
        raos_v_df: Vec::new(),
        change_in_v: Vec::new(),
        change_sig: Vec::new(),
        variables_in_analysis: HashMap::new(),
        variables_not_in_analysis: HashMap::new(),
        pairwise_comparisons: HashMap::new(),
        note: create_stepwise_note(config),
    };

    let k = num_groups as f64;

    for (step_idx, step) in steps_data.iter().enumerate() {
        // Variables Not in the Analysis is kept for every step, step 0 included.
        result.variables_not_in_analysis.insert(
            step_idx.to_string(),
            step.variables_not_in_analysis.clone(),
        );

        if !step.pairwise_comparisons.is_empty() {
            result
                .pairwise_comparisons
                .insert((step_idx).to_string(), step.pairwise_comparisons.clone());
        }

        if step_idx == 0 {
            continue;
        }

        // Approx. sig. of cumulative Rao's V: chi-squared upper tail with
        // df = p * (k-1), p = variables in the model after this step. (Not
        // step * (k-1): after a removal step the two differ.)
        let raos_v_df = step.variables_in_analysis.len() as f64 * (k - 1.0);
        let raos_v_sig = if step.raos_v > 0.0 && raos_v_df > 0.0 {
            chi_squared_cdf_upper(step.raos_v, raos_v_df)
        } else {
            1.0
        };

        result.variables_entered.push(step.variable_entered.clone().unwrap_or_default());
        result.variables_removed.push(step.variable_removed.clone());
        result.wilks_lambda.push(step.wilks_lambda);
        result.min_d_squared.push(step.min_d_squared);
        result.between_groups.push(step.between_groups.clone());
        result.f_to_enter.push(step.f_to_enter);
        result.f_to_enter_df1.push(step.f_to_enter_df1);
        result.f_to_enter_df2.push(step.f_to_enter_df2);
        result.significance.push(step.significance);
        result.wilks_exact_f.push(step.wilks_exact_f);
        result.wilks_exact_df1.push(step.wilks_exact_df1);
        result.wilks_exact_df2.push(step.wilks_exact_df2);
        result.wilks_exact_sig.push(step.wilks_exact_sig);
        result.wilks_f_exact.push(step.wilks_f_exact);
        result.raos_v.push(step.raos_v);
        result.raos_v_sig.push(raos_v_sig);
        result.raos_v_df.push(raos_v_df);
        result.change_in_v.push(step.change_in_v);
        result.change_sig.push(step.change_sig);

        result.variables_in_analysis.insert(
            (step_idx).to_string(), step.variables_in_analysis.clone()
        );
    }
    Ok(result)
}

/// Entry/removal thresholds the stepwise procedure actually applies.
///
/// A blank dialog field reaches Rust as 0, so F-to-enter, F-to-remove and the two
/// probabilities fall back to the SPSS defaults (3.84, 2.71, 0.05, 0.10) when not
/// positive. V-to-enter is different: its SPSS default is 0 itself, so the value is
/// used exactly as given (negative values are treated as 0). The selection rules and
/// the output footnotes both read from here, so they can never disagree.
struct StepwiseThresholds {
    f_entry: f64,
    f_removal: f64,
    p_entry: f64,
    p_removal: f64,
    v_enter: f64,
}

fn stepwise_thresholds(config: &DiscriminantConfig) -> StepwiseThresholds {
    let positive_or = |value: f64, default: f64| if value > 0.0 { value } else { default };
    StepwiseThresholds {
        f_entry: positive_or(config.method.f_entry, 3.84),
        f_removal: positive_or(config.method.f_removal, 2.71),
        p_entry: positive_or(config.method.p_entry, 0.05),
        p_removal: positive_or(config.method.p_removal, 0.10),
        v_enter: config.method.v_enter.max(0.0),
    }
}

fn create_stepwise_note(config: &DiscriminantConfig) -> StepwiseNote {
    let max_steps = config.main.independent_variables.len() * 2;
    let thresholds = stepwise_thresholds(config);

    let (entry_msg, removal_msg) = if uses_probability_of_f(config) {
        (
            format!("b. Maximum probability of F to enter is {}.", thresholds.p_entry),
            format!("c. Minimum probability of F to remove is {}.", thresholds.p_removal),
        )
    } else {
        (
            format!("b. Minimum partial F to enter is {}.", thresholds.f_entry),
            format!("c. Maximum partial F to remove is {}.", thresholds.f_removal),
        )
    };

    // Rao's V adds its own V-to-enter footnote, which moves the last one to "e".
    let (min_v_to_enter, last_letter) = if determine_method_type(config) == MethodType::Raos {
        (format!("d. Minimum Rao's V to enter is {}.", thresholds.v_enter), "e")
    } else {
        (String::new(), "d")
    };

    StepwiseNote {
        max_steps: format!("a. Maximum number of steps is {}.", max_steps),
        min_f_to_enter: entry_msg,
        max_f_to_remove: removal_msg,
        min_v_to_enter,
        note: format!(
            "{}. F level, tolerance, or VIN insufficient for further computation.",
            last_letter
        ),
    }
}
