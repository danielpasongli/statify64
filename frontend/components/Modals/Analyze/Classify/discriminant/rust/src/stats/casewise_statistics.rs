use rayon::prelude::*;
use std::collections::{HashMap, HashSet};

use crate::models::{
    result::{
        CanonicalFunctions, CasewiseStatistics, CrossValidatedCasewiseStatistics,
        HighestGroupStatistics, ScatterData,
    },
    AnalysisData, DiscriminantConfig,
};

use super::core::{
    analysis_case_rows, calculate_canonical_functions, calculate_eigen_statistics,
    calculate_p_value_from_chi_square, classification_case_values, group_row_indices, fit_groups, separate_groups_rule, MeanSubstitutedCase, UNGROUPED_LABEL,
    calculate_pooled_within_matrix_no_epsilon, calculate_prior_probabilities,
    extract_analyzed_dataset, get_stepwise_selected_variables, is_rank_deficient,
    push_analysis_warning, EPSILON,
};

/// Casewise Statistics: for every case its actual and predicted group, its
/// discriminant scores fⱼ = a₀ⱼ + Σᵢ aᵢⱼ xᵢ, and for the highest and second-highest
/// group k
///
/// D²ₖ          = squared Mahalanobis distance of the scores to the centroid of group k
///                (with the pooled matrix, the Euclidean distance in function space)
/// P(D>d | G=k) = P(χ²(df) > D²ₖ),  df = number of functions
/// P(G=k | D=d) = πₖ exp(−½ D²ₖ) / Σⱼ πⱼ exp(−½ D²ⱼ)
///
/// Under Separate-groups the distance and posterior use each group's own covariance
/// matrix of the functions, and df is its rank (see `fit_groups`).
///
/// `ungrouped` are the cases with a missing or out-of-range group code
/// (`ungrouped_cases`); the selected ones are listed with "ungrouped" as their actual
/// group, as SPSS does. They have no cross-validated row: cross-validation covers only
/// the cases in the analysis.
pub fn calculate_casewise_statistics(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    substituted: &[MeanSubstitutedCase],
    ungrouped: &[MeanSubstitutedCase],
) -> Result<CasewiseStatistics, String> {

    if !config.classify.case {
        return Err("Casewise statistics not requested in configuration".to_string());
    }

    let dataset = extract_analyzed_dataset(data, config)?;
    let grouping_var = &config.main.grouping_variable;

    // Model variables: the stepwise selection, or every predictor.
    let variables_to_use: Vec<String> = if config.main.stepwise {
        get_stepwise_selected_variables(data, config)?
    } else {
        config
            .main
            .independent_variables
            .iter()
            .filter(|v| *v != grouping_var)
            .cloned()
            .collect()
    };

    let canonical_functions = calculate_canonical_functions(data, config)?;
    let eigen_stats = calculate_eigen_statistics(data, config)?;
    let num_functions = eigen_stats.eigenvalue.len();

    let mut case_number = Vec::new();
    let mut actual_group = Vec::new();
    let mut predicted_group = Vec::new();

    let mut highest_p_value = Vec::new();
    let mut highest_df = Vec::new();
    let mut highest_p_g_equals_d = Vec::new();
    let mut highest_squared_mahalanobis_distance = Vec::new();
    let mut highest_group = Vec::new();

    let mut second_p_value = Vec::new();
    let mut second_df = Vec::new();
    let mut second_p_g_equals_d = Vec::new();
    let mut second_squared_mahalanobis_distance = Vec::new();
    let mut second_group = Vec::new();

    let mut discriminant_scores: HashMap<String, Vec<f64>> = (1..=num_functions)
        .map(|i| (format!("Function {}", i), Vec::new()))
        .collect();

    let prior_probs = calculate_prior_probabilities(data, config)?;
    // Some(..) under Classify → Use Covariance Matrix → Separate-groups.
    let separate_rule = separate_groups_rule(data, config)?;

    let limit = if config.classify.limit {
        let val = config.classify.limit_value.unwrap_or(i32::MAX);
        if val <= 0 {
            usize::MAX
        } else {
            val as usize
        }
    } else {
        usize::MAX
    };

    // Every case to classify with its data-file row: per group, the analysis cases
    // and then any mean-substituted cases ("Replace missing values with mean"),
    // which are classified but were not used to estimate the functions. Listed in
    // file order with the row as the Case Number, as SPSS does; "Limit cases to
    // first n" keeps the first n rows of the file.
    let case_rows = analysis_case_rows(data, config);
    let mut all_cases: Vec<(usize, String, Vec<f64>)> = Vec::new();
    let mut rows_known = true;
    for group_name in &dataset.group_labels {
        let group_cases =
            classification_case_values(&dataset, group_name, &variables_to_use, substituted);
        let analysis_rows = case_rows.get(group_name).cloned().unwrap_or_default();
        let substituted_rows: Vec<usize> = substituted
            .iter()
            .filter(|c| &c.group == group_name)
            .map(|c| c.row)
            .collect();
        if analysis_rows.len() + substituted_rows.len() != group_cases.len() {
            rows_known = false;
        }
        let rows = analysis_rows.into_iter().chain(substituted_rows);
        for (row, case_values) in rows.zip(group_cases) {
            all_cases.push((row, group_name.clone(), case_values));
        }
    }
    for case in ungrouped.iter().filter(|case| case.selected) {
        all_cases.push((case.row, UNGROUPED_LABEL.to_string(), predictor_values(case, &variables_to_use)));
    }
    if rows_known {
        all_cases.sort_by_key(|(row, _, _)| *row);
    } else {
        // Should not happen: a case's values could not be matched to its row. Keep
        // the cases in group order and number them 1..n rather than print wrong rows.
        push_analysis_warning(
            "casewise_statistics",
            "Casewise Statistics: the data-file row of some cases could not be determined, so cases are numbered in group order instead.".to_string(),
        );
        all_cases = all_cases
            .into_iter()
            .enumerate()
            .map(|(i, (_, group, values))| (i, group, values))
            .collect();
    }
    all_cases.truncate(limit);

    for (row, group_name, case_values) in all_cases.iter() {
        let disc_scores = calculate_discriminant_scores(
            &case_values,
            &canonical_functions,
            &variables_to_use,
            num_functions,
        );

        for (func_idx, score) in disc_scores.iter().enumerate() {
            if let Some(scores) =
                discriminant_scores.get_mut(&format!("Function {}", func_idx + 1))
            {
                // A NaN score is shown as 0.
                scores.push(if score.is_nan() { 0.0 } else { *score });
            }
        }

        // With the pooled matrix the Mahalanobis distance in function space is the
        // Euclidean distance. Under Separate-groups each group's own covariance matrix of
        // the functions is used instead, with its rank as the df.
        let fits = fit_groups(
            &disc_scores,
            &canonical_functions,
            &dataset.group_labels,
            &prior_probs.prior_probabilities,
            separate_rule.as_ref(),
        );
        let group_distances: Vec<(usize, f64)> =
            fits.iter().enumerate().map(|(g_idx, fit)| (g_idx, fit.d2)).collect();
        let mut group_probs: Vec<(usize, f64)> =
            fits.iter().enumerate().map(|(g_idx, fit)| (g_idx, fit.log_score)).collect();

        group_probs
            .sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

        // Posterior P(G=k | D=d): exp of each log score minus the largest one (so the
        // exponentials cannot underflow), divided by their sum.
        let max_log_prob = group_probs[0].1;
        let mut sum_exp = 0.0;
        for (_, log_prob) in &mut group_probs {
            *log_prob = (*log_prob - max_log_prob).exp();
            sum_exp += *log_prob;
        }

        if sum_exp > 0.0 {
            for (_, prob) in &mut group_probs {
                *prob /= sum_exp;
            }
        }

        let highest = &group_probs[0];
        let second = if group_probs.len() > 1 {
            &group_probs[1]
        } else {
            highest
        };

        let highest_dist = group_distances
            .iter()
            .find(|(idx, _)| *idx == highest.0)
            .unwrap()
            .1;
        let second_dist = group_distances
            .iter()
            .find(|(idx, _)| *idx == second.0)
            .unwrap()
            .1;

        case_number.push(row + 1);
        actual_group.push(group_name.clone());
        predicted_group.push(dataset.group_labels[highest.0].clone());

        let highest_df_case = fits[highest.0].df;
        let second_df_case = fits[second.0].df;
        let p_val_highest = calculate_p_value_from_chi_square(highest_dist, highest_df_case);
        let p_val_second = calculate_p_value_from_chi_square(second_dist, second_df_case);

        highest_p_value.push(p_val_highest);
        highest_df.push(highest_df_case);
        highest_p_g_equals_d.push(highest.1);
        highest_squared_mahalanobis_distance.push(highest_dist);
        highest_group.push(dataset.group_labels[highest.0].clone());

        second_p_value.push(p_val_second);
        second_df.push(second_df_case);
        second_p_g_equals_d.push(second.1);
        second_squared_mahalanobis_distance.push(second_dist);
        second_group.push(dataset.group_labels[second.0].clone());
    }

    // ---- CROSS-VALIDATED (Leave-One-Out) ----
    // Only compute if config.classify.leave is true
    let cross_validated = if config.classify.leave {
        // A failed cross-validation keeps the original casewise rows and reports why
        // the cross-validated block is missing.
        // Same cases as the Original rows (by data-file row), so the limit applies
        // to both blocks. Without known rows, every case is cross-validated.
        let shown_rows: Option<HashSet<usize>> =
            rows_known.then(|| all_cases.iter().map(|(row, _, _)| *row).collect());
        match calculate_cross_validated_casewise(
            data,
            config,
            &dataset,
            &variables_to_use,
            shown_rows.as_ref(),
        ) {
            Ok(cv_result) => Some(cv_result),
            Err(e) => {
                push_analysis_warning("cross_validation", e);
                None
            }
        }
    } else {
        None
    };

    Ok(CasewiseStatistics {
        case_number,
        actual_group,
        predicted_group,
        highest_group: HighestGroupStatistics {
            p_value: highest_p_value,
            df: highest_df,
            p_g_equals_d: highest_p_g_equals_d,
            squared_mahalanobis_distance: highest_squared_mahalanobis_distance,
            group: highest_group,
        },
        second_highest_group: HighestGroupStatistics {
            p_value: second_p_value,
            df: second_df,
            p_g_equals_d: second_p_g_equals_d,
            squared_mahalanobis_distance: second_squared_mahalanobis_distance,
            group: second_group,
        },
        discriminant_scores,
        cross_validated,
    })
}

/// Cross-validated (leave-one-out) casewise statistics. Each case is held out, the
/// group means and the pooled within-groups covariance S₍₋ᵢ₎ are re-estimated from
/// the other cases, and
///
/// D²ₖ          = (x − x̄ₖ₍₋ᵢ₎)ᵀ S₍₋ᵢ₎⁻¹ (x − x̄ₖ₍₋ᵢ₎)   (on the p predictors)
/// P(D>d | G=k) = P(χ²(p) > D²ₖ)
/// P(G=k | D=d) = πₖ exp(−½ D²ₖ) / Σⱼ πⱼ exp(−½ D²ⱼ)
///
/// `shown_rows` limits the output to the cases the Original rows show (same data-file
/// rows, so "Limit cases to first n" applies to both blocks); `None` keeps every case.
fn calculate_cross_validated_casewise(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    dataset: &super::core::AnalyzedDataset,
    variables_to_use: &[String],
    shown_rows: Option<&HashSet<usize>>,
) -> Result<CrossValidatedCasewiseStatistics, String> {

    // Guard against empty variables
    if variables_to_use.is_empty() {
        return Err("No variables available for casewise statistics".to_string());
    }

    let prior_probs = calculate_prior_probabilities(data, config)?;
    let p_vars = variables_to_use.len();

    // Rows (in `data`) of every group's cases, in the order their values are stored,
    // from the same grouping rules the dataset was extracted with.
    let group_rows = group_row_indices(
        data,
        &config.main.grouping_variable,
        config.define_range.min_range,
        config.define_range.max_range,
    );

    // Collect the cases: (group, index within group, values, row in `data`, file row).
    let mut all_cases: Vec<(String, usize, Vec<f64>, usize, usize)> = Vec::new();
    for group_name in &dataset.group_labels {
        let n_cases = dataset
            .group_data
            .get(&variables_to_use[0])
            .and_then(|g| g.get(group_name))
            .map(|v| v.len())
            .unwrap_or(0);
        let rows = group_rows.get(group_name).cloned().unwrap_or_default();
        if rows.len() != n_cases {
            return Err(format!(
                "Cross-validated casewise statistics: the cases of group {} could not be matched to their data rows.",
                group_name
            ));
        }

        for i in 0..n_cases {
            let data_row = rows[i];
            let file_row = data
                .row_numbers
                .as_ref()
                .and_then(|rn| rn.get(data_row).copied())
                .unwrap_or(data_row);
            if shown_rows.map_or(false, |shown| !shown.contains(&file_row)) {
                continue;
            }
            let case_values: Vec<f64> = variables_to_use
                .iter()
                .map(|var| {
                    dataset
                        .group_data
                        .get(var)
                        .and_then(|g| g.get(group_name))
                        .map(|v| v[i])
                        .unwrap_or(0.0)
                })
                .collect();
            all_cases.push((group_name.clone(), i, case_values, data_row, file_row));
        }
    }

    let total_cases = all_cases.len();

    // First singular-matrix failure seen by any held-out case (see below).
    let singular_failure: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

    // Process in parallel using rayon
    let results: Vec<CrossValidatedCaseResult> = all_cases
        .par_iter()
        .filter_map(
            |(group_name, _case_idx, case_values, data_row, file_row)| {
                // Skip single-case groups (can't compute LOO for n=1)
                let group_cases = dataset
                    .group_data
                    .get(&variables_to_use[0])
                    .and_then(|g| g.get(group_name))
                    .map_or(0, |v| v.len());
                if group_cases <= 1 {
                    return None;
                }

                // Create temp data with this case removed. The group/independent
                // columns are parallel by row, and `data_row` is this case's row in
                // them (from group_row_indices, the rules the dataset was built with).
                let mut temp_data = data.clone();
                let global_case_idx = *data_row;

                // Remove the case from every parallel column (grouping + independent).
                for col in temp_data.group_data.iter_mut() {
                    if global_case_idx < col.len() {
                        col.remove(global_case_idx);
                    }
                }
                for var_idx in 0..temp_data.independent_data.len() {
                    if global_case_idx < temp_data.independent_data[var_idx].len() {
                        temp_data.independent_data[var_idx].remove(global_case_idx);
                    }
                }

                let leave_dataset = match extract_analyzed_dataset(&temp_data, config) {
                    Ok(ds) => ds,
                    Err(_) => return None,
                };

                // Pooled within-groups covariance of the other cases. D² is computed on
                // the predictors, not on the discriminant functions, as SPSS does.
                let pooled_cov =
                    calculate_pooled_within_matrix_no_epsilon(&leave_dataset, variables_to_use);
                let mut reg_cov = pooled_cov.clone();
                for i in 0..p_vars {
                    reg_cov[(i, i)] += EPSILON;
                }
                // Holding a case out can make S_pooled singular. An identity-matrix
                // substitute would report Euclidean distances as cross-validated D², so
                // the failure is recorded and the whole cross-validated block dropped.
                let singular_msg = || {
                    format!(
                        "Cross-validated casewise statistics cannot be computed: the pooled within-groups covariance matrix becomes singular when case {} (group {}) is held out.",
                        file_row + 1,
                        group_name
                    )
                };
                if is_rank_deficient(&pooled_cov) {
                    if let Ok(mut f) = singular_failure.lock() {
                        f.get_or_insert_with(singular_msg);
                    }
                    return None;
                }
                let inv_cov = match reg_cov.try_inverse() {
                    Some(inv) => inv,
                    None => {
                        if let Ok(mut f) = singular_failure.lock() {
                            f.get_or_insert_with(singular_msg);
                        }
                        return None;
                    }
                };

                let mut group_probs: Vec<(usize, f64)> = Vec::new();
                let mut group_distances: Vec<(usize, f64)> = Vec::new();
                let x_vec = nalgebra::DVector::from_vec(case_values.clone());

                // D² to every group, on the predictors.
                for (g_idx, target_group) in leave_dataset.group_labels.iter().enumerate() {
                    let mut diff = nalgebra::DVector::zeros(p_vars);
                    for (v_idx, var_name) in variables_to_use.iter().enumerate() {
                        let g_mean = leave_dataset
                            .group_means
                            .get(target_group)
                            .and_then(|m| m.get(var_name))
                            .copied()
                            .unwrap_or(0.0);
                        diff[v_idx] = x_vec[v_idx] - g_mean;
                    }

                    // D^2 = (x - mean)^T * S^-1 * (x - mean)
                    let d2 = (diff.transpose() * &inv_cov * &diff)[0];
                    group_distances.push((g_idx, d2));

                    let prior = if g_idx < prior_probs.prior_probabilities.len() {
                        prior_probs.prior_probabilities[g_idx]
                    } else {
                        1.0 / (leave_dataset.num_groups as f64)
                    };

                    let log_prob = prior.ln() - 0.5 * d2;
                    group_probs.push((g_idx, log_prob));
                }

                group_probs.sort_by(|(_, a), (_, b)| {
                    b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal)
                });

                if group_probs.is_empty() {
                    return None;
                }

                // Posterior P(G=k | D=d), normalized from the log scale as above.

                let max_log_prob = group_probs[0].1;
                let mut sum_exp = 0.0;
                for (_, log_prob) in &mut group_probs {
                    *log_prob = (*log_prob - max_log_prob).exp();
                    sum_exp += *log_prob;
                }
                if sum_exp > 0.0 {
                    for (_, prob) in &mut group_probs {
                        *prob /= sum_exp;
                    }
                }

                let highest = &group_probs[0];
                let second = if group_probs.len() > 1 {
                    &group_probs[1]
                } else {
                    highest
                };

                let highest_dist = group_distances
                    .iter()
                    .find(|(idx, _)| *idx == highest.0)
                    .unwrap()
                    .1;
                let second_dist = group_distances
                    .iter()
                    .find(|(idx, _)| *idx == second.0)
                    .unwrap()
                    .1;

                // df = p (the number of predictors), not the number of functions: D² above
                // is computed on the predictors, (x − x̄)ᵀ S₍₋ᵢ₎⁻¹ (x − x̄), which under the
                // model is chi-square with p degrees of freedom. The original rows use
                // df = number of functions because their distance is in function space.
                let df_cv = p_vars;

                let p_val_highest = calculate_p_value_from_chi_square(highest_dist, df_cv);
                let p_val_second = calculate_p_value_from_chi_square(second_dist, df_cv);

                let highest_group_name = leave_dataset
                    .group_labels
                    .get(highest.0)
                    .cloned()
                    .unwrap_or_default();
                let second_group_name = leave_dataset
                    .group_labels
                    .get(second.0)
                    .cloned()
                    .unwrap_or_default();

                Some(CrossValidatedCaseResult {
                    actual_group: group_name.clone(),
                    predicted_group: highest_group_name.clone(),
                    highest_p_value: p_val_highest,
                    highest_df: df_cv,
                    highest_p_g_equals_d: highest.1,
                    highest_squared_mahalanobis_distance: highest_dist,
                    highest_group: highest_group_name,
                    second_p_value: p_val_second,
                    second_df: df_cv,
                    second_p_g_equals_d: second.1,
                    second_squared_mahalanobis_distance: second_dist,
                    second_group: second_group_name,
                    original_idx: *file_row,
                })
            },
        )
        .collect();

    if let Some(msg) = singular_failure.lock().ok().and_then(|mut f| f.take()) {
        return Err(msg);
    }

    // Sort results back into original sequential case order
    let mut sorted_results = results;
    sorted_results.sort_by_key(|r| r.original_idx);

    // Case numbers and actual groups come from the results themselves, so a skipped
    // case (single-case group) cannot shift the rows out of line with the predictions.
    if sorted_results.len() < total_cases {
        push_analysis_warning(
            "cross_validation",
            format!(
                "{} case(s) could not be held out (their group has only one case) and are omitted from the cross-validated casewise statistics.",
                total_cases - sorted_results.len()
            ),
        );
    }
    let case_number: Vec<usize> = sorted_results.iter().map(|r| r.original_idx + 1).collect();
    let actual_group: Vec<String> = sorted_results.iter().map(|r| r.actual_group.clone()).collect();
    let predicted_group: Vec<String> = sorted_results
        .iter()
        .map(|r| r.predicted_group.clone())
        .collect();

    let highest_p_value: Vec<f64> = sorted_results.iter().map(|r| r.highest_p_value).collect();
    let highest_df: Vec<usize> = sorted_results.iter().map(|r| r.highest_df).collect();
    let highest_p_g_equals_d: Vec<f64> = sorted_results
        .iter()
        .map(|r| r.highest_p_g_equals_d)
        .collect();
    let highest_squared_mahalanobis_distance: Vec<f64> = sorted_results
        .iter()
        .map(|r| r.highest_squared_mahalanobis_distance)
        .collect();
    let highest_group_cv: Vec<String> = sorted_results
        .iter()
        .map(|r| r.highest_group.clone())
        .collect();

    let second_p_value: Vec<f64> = sorted_results.iter().map(|r| r.second_p_value).collect();
    let second_df: Vec<usize> = sorted_results.iter().map(|r| r.second_df).collect();
    let second_p_g_equals_d: Vec<f64> = sorted_results
        .iter()
        .map(|r| r.second_p_g_equals_d)
        .collect();
    let second_squared_mahalanobis_distance: Vec<f64> = sorted_results
        .iter()
        .map(|r| r.second_squared_mahalanobis_distance)
        .collect();
    let second_group_cv: Vec<String> = sorted_results
        .iter()
        .map(|r| r.second_group.clone())
        .collect();

    Ok(CrossValidatedCasewiseStatistics {
        case_number,
        actual_group,
        predicted_group,
        highest_group: HighestGroupStatistics {
            p_value: highest_p_value,
            df: highest_df,
            p_g_equals_d: highest_p_g_equals_d,
            squared_mahalanobis_distance: highest_squared_mahalanobis_distance,
            group: highest_group_cv,
        },
        second_highest_group: HighestGroupStatistics {
            p_value: second_p_value,
            df: second_df,
            p_g_equals_d: second_p_g_equals_d,
            squared_mahalanobis_distance: second_squared_mahalanobis_distance,
            group: second_group_cv,
        },
        discriminant_scores: None,
    })
}
struct CrossValidatedCaseResult {
    actual_group: String,
    predicted_group: String,
    highest_p_value: f64,
    highest_df: usize,
    highest_p_g_equals_d: f64,
    highest_squared_mahalanobis_distance: f64,
    highest_group: String,
    second_p_value: f64,
    second_df: usize,
    second_p_g_equals_d: f64,
    second_squared_mahalanobis_distance: f64,
    second_group: String,
    /// Data-file row (0-based): the sort key, and Case Number = row + 1
    original_idx: usize,
}

/// Predictor values of a case classified outside the analysis, in `variables` order.
fn predictor_values(case: &MeanSubstitutedCase, variables: &[String]) -> Vec<f64> {
    variables
        .iter()
        .map(|var| case.values.get(var).copied().unwrap_or(f64::NAN))
        .collect()
}

/// Compute per-case discriminant scores for scatter plot rendering.
/// Does NOT require config.classify.case — called when combine || sep_grp is true.
/// The selected ungrouped cases are included with "ungrouped" as their group, as in
/// the casewise table (SPSS plots them as "Ungrouped Cases").
pub fn calculate_scatter_data(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    substituted: &[MeanSubstitutedCase],
    ungrouped: &[MeanSubstitutedCase],
) -> Result<ScatterData, String> {
    let dataset = extract_analyzed_dataset(data, config)?;
    let grouping_var = &config.main.grouping_variable;

    let variables_to_use: Vec<String> = if config.main.stepwise {
        get_stepwise_selected_variables(data, config)?
    } else {
        config
            .main
            .independent_variables
            .iter()
            .filter(|v| *v != grouping_var)
            .cloned()
            .collect()
    };

    let canonical_functions = calculate_canonical_functions(data, config)?;
    let eigen_stats = calculate_eigen_statistics(data, config)?;
    let num_functions = eigen_stats.eigenvalue.len();

    let mut actual_group: Vec<String> = Vec::new();
    let mut discriminant_scores: HashMap<String, Vec<f64>> = (1..=num_functions)
        .map(|i| (format!("Function {}", i), Vec::new()))
        .collect();

    // Same cases as the casewise table: per group the analysis cases, then the
    // mean-substituted ones; then the selected ungrouped cases.
    let mut cases: Vec<(String, Vec<f64>)> = Vec::new();
    for group_name in &dataset.group_labels {
        for case_values in
            classification_case_values(&dataset, group_name, &variables_to_use, substituted)
        {
            cases.push((group_name.clone(), case_values));
        }
    }
    for case in ungrouped.iter().filter(|case| case.selected) {
        cases.push((UNGROUPED_LABEL.to_string(), predictor_values(case, &variables_to_use)));
    }

    for (group, case_values) in cases {
        actual_group.push(group);

        let scores = calculate_discriminant_scores(
            &case_values,
            &canonical_functions,
            &variables_to_use,
            num_functions,
        );

        for (func_idx, score) in scores.iter().enumerate() {
            let key = format!("Function {}", func_idx + 1);
            if let Some(sv) = discriminant_scores.get_mut(&key) {
                sv.push(if score.is_nan() { 0.0 } else { *score });
            }
        }
    }

    Ok(ScatterData { actual_group, discriminant_scores })
}

/// Discriminant scores of one case: fⱼ = a₀ⱼ + Σᵢ aᵢⱼ xᵢ for every function j
/// (aᵢⱼ = unstandardized coefficient, a₀ⱼ = constant).
pub fn calculate_discriminant_scores(
    case_values: &[f64],
    canonical_functions: &CanonicalFunctions,
    variables: &[String],
    num_functions: usize,
) -> Vec<f64> {
    let mut discriminant_scores = vec![0.0; num_functions];

    for (var_idx, var_name) in variables.iter().enumerate() {
        if let Some(coefs) = canonical_functions.coefficients.get(var_name) {
            for func_idx in 0..num_functions {
                if func_idx < coefs.len() && var_idx < case_values.len() {
                    discriminant_scores[func_idx] += case_values[var_idx] * coefs[func_idx];
                }
            }
        }
    }

    if let Some(constants) = canonical_functions.coefficients.get("(Constant)") {
        for func_idx in 0..num_functions.min(constants.len()) {
            discriminant_scores[func_idx] += constants[func_idx];
        }
    }

    discriminant_scores
}
