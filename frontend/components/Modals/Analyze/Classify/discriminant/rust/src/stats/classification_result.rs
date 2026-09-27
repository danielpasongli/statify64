//! Classification results for discriminant analysis.
//!
//! This module implements functions to calculate classification results,
//! including original and cross-validated classifications.

use nalgebra::DVector;
use rayon::prelude::*;
use std::collections::HashMap;

use crate::models::result::{
    CanonicalFunctions, ClassificationFunctionCoefficients, EigenDescription,
};
use crate::models::{result::ClassificationResults, AnalysisData, DiscriminantConfig};

use super::core::{
    calculate_canonical_functions, calculate_eigen_statistics, calculate_pooled_within_matrix,
    calculate_prior_probabilities, classification_case_values, extract_analyzed_dataset,
    fit_groups, get_stepwise_selected_variables, is_rank_deficient, push_analysis_warning,
    separate_groups_rule, AnalyzedDataset, MeanSubstitutedCase, SeparateGroupsRule, EPSILON,
};

use crate::stats::matrix_calculation::calculate_pooled_within_matrix_no_epsilon;

/// Classification Results table: counts and row percentages of actual group ×
/// predicted group, for the original classification and, with Leave-one-out, the
/// cross-validated one. A case is predicted into the group with the largest posterior
/// probability (see `classify_case_safe`); row % = 100 · count / row total.
///
/// `unselected` are the cases the selection variable leaves out (the testing part of
/// a training/testing split); they are classified with the same functions and
/// reported in their own block, as SPSS does. Empty when no selection is in use.
/// `ungrouped` are the cases with a missing or out-of-range group code
/// (`ungrouped_cases`); SPSS classifies them too and reports them in an "Ungrouped
/// cases" row of the Original block they belong to (selected or not selected).
pub fn calculate_classification_results(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    substituted: &[MeanSubstitutedCase],
    unselected: &[MeanSubstitutedCase],
    ungrouped: &[MeanSubstitutedCase],
) -> Result<ClassificationResults, String> {
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

    if variables_to_use.is_empty() {
        return Err("No independent variables available for classification.".into());
    }

    let eigen_stats = calculate_eigen_statistics(data, config)?;
    let canonical_functions = calculate_canonical_functions(data, config)?;
    let priors = resolve_priors(data, config, &dataset)?;
    // Some(..) under Classify → Use Covariance Matrix → Separate-groups.
    let separate_rule = separate_groups_rule(data, config)?;

    let mut original_classification = HashMap::new();
    let mut original_percentage = HashMap::new();

    for group in &dataset.group_labels {
        original_classification.insert(group.clone(), vec![0; dataset.group_labels.len()]);
        original_percentage.insert(group.clone(), vec![0.0; dataset.group_labels.len()]);
    }

    // --- ORIGINAL CLASSIFICATION ---
    // Analysis cases plus, with "Replace missing values with mean", the
    // mean-substituted cases (classified, but not used to estimate the functions).
    // Cross-validation below covers only the analysis cases.
    for group_name in &dataset.group_labels {
        for case_values in
            classification_case_values(&dataset, group_name, &variables_to_use, substituted)
        {

            // Largest posterior, compared on the log scale as in the casewise statistics.
            let predicted_idx = classify_case_safe(
                &case_values,
                &canonical_functions,
                &eigen_stats,
                &dataset,
                &variables_to_use,
                &priors,
                separate_rule.as_ref(),
            );

            if let Some(counts) = original_classification.get_mut(group_name) {
                counts[predicted_idx] += 1;
            }
        }
    }

    // Row percentages of the original classification.
    for group in &dataset.group_labels {
        if let Some(counts) = original_classification.get(group) {
            let total_cases = counts.iter().sum::<i32>() as f64;
            if total_cases > 0.0 {
                if let Some(percentages) = original_percentage.get_mut(group) {
                    for (i, &count) in counts.iter().enumerate() {
                        percentages[i] = ((count as f64) * 100.0) / total_cases;
                    }
                }
            }
        }
    }

    // Predicted group (index into dataset.group_labels) of a case classified
    // outside the analysis: an unselected or an ungrouped case.
    let predict = |case: &MeanSubstitutedCase| -> usize {
        let case_values: Vec<f64> = variables_to_use
            .iter()
            .map(|var| case.values.get(var).copied().unwrap_or(f64::NAN))
            .collect();
        classify_case_safe(
            &case_values,
            &canonical_functions,
            &eigen_stats,
            &dataset,
            &variables_to_use,
            &priors,
            separate_rule.as_ref(),
        )
    };
    let (selected_ungrouped, unselected_ungrouped): (Vec<&MeanSubstitutedCase>, Vec<&MeanSubstitutedCase>) =
        ungrouped.iter().partition(|case| case.selected);

    // --- CASES NOT SELECTED (testing part of a training/testing split) ---
    // Classified with the functions, priors and rule of the selected cases, and never
    // cross-validated. Only groups present in the analysis can be counted (their
    // actual group must be a row of the table); unselected_cases guarantees that.
    // The block also exists when its only cases are ungrouped ones.
    let (unselected_classification, unselected_percentage) =
        if unselected.is_empty() && unselected_ungrouped.is_empty() {
            (None, None)
        } else {
            let mut counts: HashMap<String, Vec<i32>> = dataset
                .group_labels
                .iter()
                .map(|g| (g.clone(), vec![0; dataset.group_labels.len()]))
                .collect();
            for case in unselected {
                let predicted_idx = predict(case);
                if let Some(row) = counts.get_mut(&case.group) {
                    row[predicted_idx] += 1;
                }
            }
            let percentages = row_percentages(&counts);
            (Some(counts), Some(percentages))
        };

    // --- UNGROUPED CASES ---
    // One row per block: how the ungrouped cases were classified. They have no actual
    // group, so they never count toward the share of correctly classified cases.
    let ungrouped_row = |cases: &[&MeanSubstitutedCase]| -> (Option<Vec<i32>>, Option<Vec<f64>>) {
        if cases.is_empty() {
            return (None, None);
        }
        let mut counts = vec![0; dataset.group_labels.len()];
        for case in cases {
            counts[predict(case)] += 1;
        }
        let total = counts.iter().sum::<i32>() as f64;
        let percentages = counts.iter().map(|&c| (c as f64) * 100.0 / total).collect();
        (Some(counts), Some(percentages))
    };
    let (ungrouped_classification, ungrouped_percentage) = ungrouped_row(&selected_ungrouped);
    let (unselected_ungrouped_classification, unselected_ungrouped_percentage) =
        ungrouped_row(&unselected_ungrouped);

    // --- CROSS-VALIDATED CLASSIFICATION (leave-one-out) ---
    // A failed cross-validation keeps the original classification table and reports
    // why the cross-validated part is missing. It always uses the pooled (linear)
    // rule, also under Separate-groups: SPSS cross-validates only the linear rule.
    let (cross_validated_classification, cross_validated_percentage) = if config.classify.leave {
        match calculate_cross_validation(&dataset, &variables_to_use, &priors) {
            Ok(cv) => cv,
            Err(e) => {
                push_analysis_warning("cross_validation", e);
                (None, None)
            }
        }
    } else {
        (None, None)
    };

    Ok(ClassificationResults {
        original_classification,
        cross_validated_classification,
        original_percentage,
        cross_validated_percentage,
        unselected_classification,
        unselected_percentage,
        ungrouped_classification,
        ungrouped_percentage,
        unselected_ungrouped_classification,
        unselected_ungrouped_percentage,
    })
}

/// Row percentages of a classification table: each count over its row total.
fn row_percentages(counts: &HashMap<String, Vec<i32>>) -> HashMap<String, Vec<f64>> {
    counts
        .iter()
        .map(|(group, row)| {
            let total = row.iter().sum::<i32>() as f64;
            let percentages = row
                .iter()
                .map(|&c| if total > 0.0 { (c as f64) * 100.0 / total } else { 0.0 })
                .collect();
            (group.clone(), percentages)
        })
        .collect()
}

/// Leave-one-out cross-validated classification. Each analysis case is held out, the
/// group means and the pooled within-groups covariance S₍₋ᵢ₎ are re-estimated without
/// it, and the case is predicted into the group k with the largest
///
/// ln πₖ − ½ D²ₖ,   D²ₖ = (x − x̄ₖ₍₋ᵢ₎)ᵀ S₍₋ᵢ₎⁻¹ (x − x̄ₖ₍₋ᵢ₎)
///
/// computed on the predictors rather than on the discriminant functions, as SPSS does.
///
/// `priors` are the full-sample priors (same as the Prior Probabilities table and the
/// cross-validated casewise statistics); they are not re-estimated per held-out case,
/// so the cross-validated classification table and casewise rows always agree.
fn calculate_cross_validation(
    dataset: &AnalyzedDataset,
    variables_to_use: &[String],
    priors: &[f64],
) -> Result<
    (
        Option<HashMap<String, Vec<i32>>>,
        Option<HashMap<String, Vec<f64>>>,
    ),
    String,
> {
    let mut cv_classification = HashMap::new();
    let mut cv_percentage = HashMap::new();

    for group in &dataset.group_labels {
        cv_classification.insert(group.clone(), vec![0; dataset.group_labels.len()]);
        cv_percentage.insert(group.clone(), vec![0.0; dataset.group_labels.len()]);
    }

    let p_vars = variables_to_use.len();

    // Every analysis case as (group, index within the group, predictor values).
    let mut all_cases: Vec<(String, usize, Vec<f64>)> = Vec::new();
    for group_name in &dataset.group_labels {
        let n_cases = dataset
            .group_data
            .get(&variables_to_use[0])
            .and_then(|g| g.get(group_name))
            .map_or(0, |v| v.len());
        for i in 0..n_cases {
            let case_values: Vec<f64> = variables_to_use
                .iter()
                .map(|var| {
                    dataset
                        .group_data
                        .get(var)
                        .unwrap()
                        .get(group_name)
                        .unwrap()[i]
                })
                .collect();
            all_cases.push((group_name.clone(), i, case_values));
        }
    }

    let single_case_groups: Vec<&String> = dataset
        .group_labels
        .iter()
        .filter(|g| all_cases.iter().filter(|(c, _, _)| c == *g).count() == 1)
        .collect();
    if !single_case_groups.is_empty() {
        push_analysis_warning(
            "cross_validation",
            format!(
                "Group(s) {} have only one case, which cannot be held out; those cases are not included in the cross-validated classification.",
                single_case_groups.iter().map(|g| g.as_str()).collect::<Vec<_>>().join(", ")
            ),
        );
    }

    let cv_results: Vec<(String, usize)> = all_cases
        .par_iter()
        .map(|(group_name, case_idx, case_values)| -> Result<Option<(String, usize)>, String> {
            let group_cases = all_cases.iter().filter(|(g, _, _)| g == group_name).count();
            if group_cases <= 1 {
                return Ok(None);
            } // a group's only case cannot be held out

            // The dataset without this case.
            let mut leave_dataset = dataset.clone();
            leave_dataset.total_cases -= 1;

            for var in variables_to_use {
                if let Some(g_data) = leave_dataset.group_data.get_mut(var) {
                    if let Some(v_data) = g_data.get_mut(group_name) {
                        v_data.remove(*case_idx);
                    }
                }

                // Mean of the case's group, recomputed without the case.
                let mut sum = 0.0;
                let mut count = 0;
                if let Some(v_data) = leave_dataset.group_data.get(var).unwrap().get(group_name) {
                    for &val in v_data {
                        sum += val;
                        count += 1;
                    }
                }
                let new_mean = if count > 0 { sum / count as f64 } else { 0.0 };
                leave_dataset
                    .group_means
                    .get_mut(group_name)
                    .unwrap()
                    .insert(var.clone(), new_mean);
            }

            // Pooled within-groups covariance without the case.
            let pooled_cov =
                calculate_pooled_within_matrix_no_epsilon(&leave_dataset, variables_to_use);
            // Holding a case out can make S_pooled singular (e.g. a group left with
            // too few cases). Substituting an identity matrix would classify by
            // Euclidean distance while presenting it as cross-validation, so stop.
            if is_rank_deficient(&pooled_cov) {
                return Err(format!(
                    "Leave-one-out cross-validation cannot be computed: the pooled within-groups covariance matrix becomes singular when case {} of group {} is held out.",
                    case_idx + 1,
                    group_name
                ));
            }
            let mut reg_cov = pooled_cov.clone();
            for i in 0..p_vars {
                reg_cov[(i, i)] += EPSILON;
            }
            let inv_cov = reg_cov.try_inverse().ok_or_else(|| {
                format!(
                    "Leave-one-out cross-validation cannot be computed: the pooled within-groups covariance matrix could not be inverted when case {} of group {} is held out.",
                    case_idx + 1,
                    group_name
                )
            })?;

            let mut group_probs = Vec::new();
            let x_vec = nalgebra::DVector::from_vec(case_values.clone());

            for (g_idx, target_group) in leave_dataset.group_labels.iter().enumerate() {
                let mut diff = nalgebra::DVector::zeros(p_vars);
                for (v_idx, var_name) in variables_to_use.iter().enumerate() {
                    let g_mean = leave_dataset
                        .group_means
                        .get(target_group)
                        .unwrap()
                        .get(var_name)
                        .copied()
                        .unwrap_or(0.0);
                    diff[v_idx] = x_vec[v_idx] - g_mean;
                }

                let d2 = (diff.transpose() * &inv_cov * &diff)[0];

                // ln πₖ − ½ D²ₖ: the log posterior up to a shared term, free of underflow.
                let log_prob = priors[g_idx].ln() - 0.5 * d2;
                group_probs.push((g_idx, log_prob));
            }

            // Group with the largest posterior.
            group_probs
                .sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
            Ok(Some((group_name.clone(), group_probs[0].0)))
        })
        .collect::<Result<Vec<_>, String>>()?
        .into_iter()
        .flatten()
        .collect();

    // Counts of actual × predicted group.
    for (group_name, predicted_idx) in cv_results {
        cv_classification.get_mut(&group_name).unwrap()[predicted_idx] += 1;
    }

    // Row percentages.
    for group in &dataset.group_labels {
        if let Some(counts) = cv_classification.get(group) {
            let total_cases = counts.iter().sum::<i32>() as f64;
            if total_cases > 0.0 {
                if let Some(percentages) = cv_percentage.get_mut(group) {
                    for (i, &count) in counts.iter().enumerate() {
                        percentages[i] = ((count as f64) * 100.0) / total_cases;
                    }
                }
            }
        }
    }

    Ok((Some(cv_classification), Some(cv_percentage)))
}

/// Predicted group (index into `dataset.group_labels`) of one case: the group with the
/// largest posterior probability
///
/// P(G = k | D) = πₖ exp(−½ D²ₖ) / Σⱼ πⱼ exp(−½ D²ⱼ)
///
/// where D²ₖ is the squared distance of the case's discriminant scores
/// (fⱼ = a₀ⱼ + Σᵢ aᵢⱼ xᵢ for function j) to the centroid of group k; with the pooled
/// matrix this is the Euclidean distance in function space. The groups are compared on
/// ln πₖ − ½ D²ₖ, which has the same maximum and cannot underflow. Under
/// Separate-groups each group uses its own covariance matrix of the functions
/// (see `fit_groups`).
fn classify_case_safe(
    case_values: &[f64],
    canonical_functions: &CanonicalFunctions,
    eigen_stats: &EigenDescription,
    dataset: &AnalyzedDataset,
    variables_to_use: &[String],
    priors: &[f64],
    separate_rule: Option<&SeparateGroupsRule>,
) -> usize {
    let num_functions = eigen_stats.eigenvalue.len();

    let mut disc_scores = vec![0.0; num_functions];
    for (var_idx, var_name) in variables_to_use.iter().enumerate() {
        if let Some(coefs) = canonical_functions.coefficients.get(var_name) {
            for func_idx in 0..num_functions {
                if func_idx < coefs.len() && var_idx < case_values.len() {
                    disc_scores[func_idx] += case_values[var_idx] * coefs[func_idx];
                }
            }
        }
    }

    if let Some(constants) = canonical_functions.coefficients.get("(Constant)") {
        for func_idx in 0..num_functions.min(constants.len()) {
            disc_scores[func_idx] += constants[func_idx];
        }
    }

    // ln(prior) − ½·d2 per group (pooled), or with each group's own covariance
    // matrix of the functions under Separate-groups.
    let mut group_probs: Vec<(usize, f64)> = fit_groups(
        &disc_scores,
        canonical_functions,
        &dataset.group_labels,
        priors,
        separate_rule,
    )
    .iter()
    .enumerate()
    .map(|(g_idx, fit)| (g_idx, fit.log_score))
    .collect();

    group_probs.sort_by(|(_, a), (_, b)| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    group_probs[0].0
}

/// Prior probabilities in `dataset.group_labels` order.
///
/// Taken from `calculate_prior_probabilities` — the same source as the Prior
/// Probabilities table and the casewise statistics — so every classification output
/// uses exactly the priors the output reports, instead of re-deriving them here.
fn resolve_priors(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    dataset: &AnalyzedDataset,
) -> Result<Vec<f64>, String> {
    let prior_table = calculate_prior_probabilities(data, config)?;
    if prior_table.groups != dataset.group_labels
        || prior_table.prior_probabilities.len() != dataset.group_labels.len()
    {
        return Err(
            "Prior probabilities do not line up with the analysis groups".to_string(),
        );
    }
    Ok(prior_table.prior_probabilities)
}

/// Classification Function Coefficients (Fisher's linear discriminant functions), one
/// function per group k:
///
/// bₖ  = S⁻¹ x̄ₖ               (S = pooled within-groups covariance)
/// b₀ₖ = ln πₖ − ½ bₖᵀ x̄ₖ     (constant; πₖ = prior probability)
///
/// A case is assigned to the group with the largest bₖᵀ x + b₀ₖ.
pub fn calculate_summary_classification(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<ClassificationFunctionCoefficients, String> {
    let dataset = extract_analyzed_dataset(data, config)?;
    let grouping_var = &config.main.grouping_variable;

    // Model variables: the stepwise selection, or every predictor.
    let variables: Vec<String> = if config.main.stepwise {
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

    // The EPSILON ridge in calculate_pooled_within_matrix makes a singular matrix
    // invertible, but the coefficients from that inverse are meaningless.
    if is_rank_deficient(&calculate_pooled_within_matrix_no_epsilon(&dataset, &variables)) {
        return Err(format!(
            "Classification function coefficients cannot be computed: the pooled within-groups covariance matrix of [{}] is singular (a predictor is a linear combination of the others).",
            variables.join(", ")
        ));
    }

    let pooled_within = calculate_pooled_within_matrix(&dataset, &variables);

    let pooled_within_inv = match pooled_within.try_inverse() {
        Some(inv) => inv,
        None => return Err("Failed to invert pooled within-groups matrix".to_string()),
    };

    // Same priors as the Prior Probabilities table and case classification, so the
    // constant term reflects "All groups equal" vs "Compute from group sizes".
    let priors = resolve_priors(data, config, &dataset)?;

    let mut coefficients: HashMap<String, Vec<f64>> = HashMap::new();
    let mut constant_terms: Vec<f64> = Vec::with_capacity(dataset.group_labels.len());
    // Column labels are the group codes themselves, in the analysis group order.
    let mut groups: Vec<String> = Vec::with_capacity(dataset.group_labels.len());

    for (group_idx, group) in dataset.group_labels.iter().enumerate() {
        groups.push(group.clone());

        let mut group_means = DVector::zeros(variables.len());
        for (var_idx, var_name) in variables.iter().enumerate() {
            let mean = dataset
                .group_means
                .get(group)
                .and_then(|m| m.get(var_name))
                .copied()
                .unwrap_or(0.0);
            group_means[var_idx] = mean;
        }

        // b_g = S_pooled^-1 * mean_g (Johnson & Wichern 11-51). pooled_within is
        // already the covariance matrix (SSCP / (n - G)), so SPSS's (n - G)
        // factor, which applies to the inverse of the SSCP matrix, is not needed.
        for (var_idx, var_name) in variables.iter().enumerate() {
            let coef = (0..variables.len())
                .map(|l| pooled_within_inv[(var_idx, l)] * group_means[l])
                .sum::<f64>();

            coefficients
                .entry(var_name.clone())
                .or_insert_with(|| vec![0.0; dataset.group_labels.len()])[group_idx] = coef;
        }

        let log_prior = priors[group_idx].ln();

        let half_sum = 0.5
            * variables
                .iter()
                .enumerate()
                .map(|(var_idx, var_name)| {
                    let coef = coefficients
                        .get(var_name)
                        .map(|c| c[group_idx])
                        .unwrap_or(0.0);
                    coef * group_means[var_idx]
                })
                .sum::<f64>();

        constant_terms.push(log_prior - half_sum);
    }

    Ok(ClassificationFunctionCoefficients {
        groups,
        variables: variables.clone(),
        coefficients,
        constant_terms,
    })
}
