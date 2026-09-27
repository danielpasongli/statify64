//! Core functionality and data structures for discriminant analysis.
//!
//! This module contains the foundational elements used across the discriminant
//! analysis implementation, including data extraction, statistical calculations,
//! and utility functions.

use nalgebra::{ DMatrix, SVD };
use statrs::distribution::{ ChiSquared, ContinuousCDF, FisherSnedecor };
use std::collections::HashMap;
use std::sync::Mutex;
use rayon::prelude::*;

use crate::models::{ AnalysisData, DataRecord, DataValue, DiscriminantConfig };

/// Relative threshold below which a singular or eigenvalue counts as zero
/// (a value v is kept when v > EPSILON × the largest value).
pub const EPSILON: f64 = 1e-10;
pub const TOLERANCE_THRESHOLD: f64 = 0.001;

/// Per-analysis warnings raised deep inside the statistics routines (singular
/// matrices, fallbacks, excluded groups). Routines that still return a value push
/// here instead of failing silently; `run_analysis` clears the sink at the start and
/// forwards its contents to the ErrorCollector at the end, so they reach the user.
/// A Mutex (not thread_local) so warnings raised inside rayon closures are kept.
static ANALYSIS_WARNINGS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Clear the warning sink. Call at the start of every analysis.
pub fn clear_analysis_warnings() {
    if let Ok(mut w) = ANALYSIS_WARNINGS.lock() {
        w.clear();
    }
}

/// Record a warning. Identical (context, message) pairs are kept once, because the
/// same routine is often re-run by several output tables in one analysis.
pub fn push_analysis_warning(context: &str, message: String) {
    if let Ok(mut w) = ANALYSIS_WARNINGS.lock() {
        if !w.iter().any(|(c, m)| c == context && *m == message) {
            w.push((context.to_string(), message));
        }
    }
}

/// Drain every recorded warning as (context, message).
pub fn take_analysis_warnings() -> Vec<(String, String)> {
    match ANALYSIS_WARNINGS.lock() {
        Ok(mut w) => std::mem::take(&mut *w),
        Err(_) => Vec::new(),
    }
}

/// True when a square matrix is singular or numerically near-singular: its rank
/// (singular values above EPSILON × the largest, the same rule as the Log
/// Determinants table) is below its dimension.
pub fn is_rank_deficient(matrix: &DMatrix<f64>) -> bool {
    let p = matrix.nrows();
    p > 0 && (calculate_rank_and_log_det(matrix).0 as usize) < p
}

/// Analyzed dataset structure to consolidate extracted data
#[derive(Debug, Clone)]
pub struct AnalyzedDataset {
    /// Variable values organized by variable name, group, and observations
    pub group_data: HashMap<String, HashMap<String, Vec<f64>>>,
    /// List of group labels found in the data
    pub group_labels: Vec<String>,
    /// Mean values for each variable in each group
    pub group_means: HashMap<String, HashMap<String, f64>>,
    /// Overall mean values for each variable
    pub overall_means: HashMap<String, f64>,
    /// Number of distinct groups
    pub num_groups: usize,
    /// Total number of cases across all groups
    pub total_cases: usize,
}

/// Extract and prepare data for discriminant analysis
///
/// This function takes the raw analysis data and configuration, and returns
/// a structured dataset ready for discriminant analysis computations.
pub fn extract_analyzed_dataset(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<AnalyzedDataset, String> {
    // Extract configuration parameters
    let independent_variables = &config.main.independent_variables;
    let grouping_variable = &config.main.grouping_variable;
    let min_range = config.define_range.min_range;
    let max_range = config.define_range.max_range;

    crate::debug_log!("Extracting dataset with {} variables", independent_variables.len());

    // Extract grouped data with proper error handling
    let (group_data, group_labels, total_cases) = match
        extract_grouped_data(data, grouping_variable, independent_variables, min_range, max_range)
    {
        Ok(result) => result,
        Err(e) => {
            return Err(format!("Failed to extract grouped data: {}", e));
        }
    };

    if group_labels.is_empty() {
        return Err("No valid groups found after filtering".to_string());
    }

    let num_groups = group_labels.len();

    // Calculate group and overall means
    let group_means = calculate_group_means(&group_data, &group_labels, independent_variables);
    let overall_means = calculate_overall_means(&group_data, &group_labels, independent_variables);

    Ok(AnalyzedDataset {
        group_data,
        group_labels,
        group_means,
        overall_means,
        num_groups,
        total_cases,
    })
}

/// Order of group labels everywhere in the analysis: numeric codes ascending by
/// value (so 10 follows 2, as SPSS orders them), then non-numeric labels as text.
pub fn compare_group_labels(a: &str, b: &str) -> std::cmp::Ordering {
    let key = |g: &str| match g.parse::<f64>() {
        Ok(n) if n.is_finite() => (0_u8, n),
        _ => (1_u8, 0.0),
    };
    let (ka, kb) = (key(a), key(b));
    ka.0
        .cmp(&kb.0)
        .then(ka.1.partial_cmp(&kb.1).unwrap_or(std::cmp::Ordering::Equal))
        .then_with(|| a.cmp(b))
}

/// Rows (indices into `data`) of each group, in row order, applying the group
/// labelling and range rules of the analysis: a numeric code inside the defined
/// range is labelled with `f64::to_string`, a text code is used as is, anything
/// else is left out. The single source of these rules, so the data extraction,
/// the bootstrap strata and the casewise row numbers always agree.
pub fn group_row_indices(
    data: &AnalysisData,
    grouping_variable: &str,
    min_range: Option<f64>,
    max_range: Option<f64>
) -> HashMap<String, Vec<usize>> {
    let mut group_mappings: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, record) in data.group_data.iter().flatten().enumerate() {
        if let Some(value) = record.values.get(grouping_variable) {
            let group_label = match value {
                DataValue::Number(num) => {
                    // Check if value is within range
                    if
                        min_range.map_or(true, |min| *num >= min) &&
                        max_range.map_or(true, |max| *num <= max)
                    {
                        num.to_string()
                    } else {
                        continue;
                    }
                }
                DataValue::Text(text) => text.clone(),
                _ => {
                    continue;
                }
            };

            group_mappings.entry(group_label).or_default().push(i);
        }
    }

    group_mappings
}

/// Data-file row (0-based) of every analysis case, per group, in the order the
/// group's values are stored in `AnalyzedDataset::group_data`. `data` is the
/// filtered data the dataset was extracted from.
pub fn analysis_case_rows(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> HashMap<String, Vec<usize>> {
    group_row_indices(
        data,
        &config.main.grouping_variable,
        config.define_range.min_range,
        config.define_range.max_range
    )
        .into_iter()
        .map(|(group, rows)| {
            let file_rows = rows
                .into_iter()
                .map(|r| data.row_numbers.as_ref().and_then(|rn| rn.get(r).copied()).unwrap_or(r))
                .collect();
            (group, file_rows)
        })
        .collect()
}

/// Extract grouped data from analysis data
///
/// This function extracts and organizes the data into groups based on the grouping variable,
/// while applying filtering based on range constraints.
pub fn extract_grouped_data(
    data: &AnalysisData,
    grouping_variable: &str,
    independent_variables: &[String],
    min_range: Option<f64>,
    max_range: Option<f64>
) -> Result<(HashMap<String, HashMap<String, Vec<f64>>>, Vec<String>, usize), String> {
    let group_mappings = group_row_indices(data, grouping_variable, min_range, max_range);

    // Group labels in SPSS order: numeric codes by value, not as text.
    let mut group_labels: Vec<String> = group_mappings.keys().cloned().collect();
    group_labels.sort_by(|a, b| compare_group_labels(a, b));

    // Extract values for each variable by group
    let mut variable_values: HashMap<String, HashMap<String, Vec<f64>>> = HashMap::new();
    let mut total_cases = 0;

    for var_name in independent_variables {
        let mut group_values: HashMap<String, Vec<f64>> = HashMap::new();

        // Column of `independent_data` that holds this predictor, found by name.
        let var_data_opt = data.independent_data.iter().find(|records| {
            records.iter().any(|record| record.values.contains_key(var_name))
        });

        if let Some(var_data) = var_data_opt {
            for group_label in &group_labels {
                if let Some(indices) = group_mappings.get(group_label) {
                    let values: Vec<f64> = indices
                        .iter()
                        .filter_map(|&idx| {
                            if idx < var_data.len() {
                                if
                                    let Some(DataValue::Number(val)) =
                                        var_data[idx].values.get(var_name)
                                {
                                    return Some(*val);
                                }
                            }
                            None
                        })
                        .collect();

                    group_values.insert(group_label.clone(), values);
                }
            }
        } else {
            // Fallback: try to find by index if variable not found by name
            // This handles the case where independent_data is organized by variable position
            if let Some(var_idx) = independent_variables.iter().position(|v| v == var_name) {
                if var_idx < data.independent_data.len() {
                    let var_data = &data.independent_data[var_idx];

                    for group_label in &group_labels {
                        if let Some(indices) = group_mappings.get(group_label) {
                            let values: Vec<f64> = indices
                                .iter()
                                .filter_map(|&idx| {
                                    if idx < var_data.len() {
                                        if
                                            let Some(DataValue::Number(val)) =
                                                var_data[idx].values.get(var_name)
                                        {
                                            return Some(*val);
                                        }
                                    }
                                    None
                                })
                                .collect();

                            group_values.insert(group_label.clone(), values);
                        }
                    }
                }
            }
        }

        // Count total valid cases for the first variable
        if var_name == &independent_variables[0] {
            total_cases = group_values
                .values()
                .map(|v| v.len())
                .sum();
        }

        variable_values.insert(var_name.clone(), group_values);
    }

    Ok((variable_values, group_labels, total_cases))
}

/// Mean of every variable within every group:
///
/// x̄ⱼₖ = Σᵢ xᵢⱼₖ / nₖ   (variable j, group k; 0 for an empty group)
pub fn calculate_group_means(
    group_data: &HashMap<String, HashMap<String, Vec<f64>>>,
    group_labels: &[String],
    variables: &[String]
) -> HashMap<String, HashMap<String, f64>> {
    let mut group_means = HashMap::new();

    // Process groups in parallel for better performance
    let group_mean_results: Vec<(String, HashMap<String, f64>)> = group_labels
        .par_iter()
        .map(|group_label| {
            let mut means = HashMap::new();

            for var_name in variables {
                let mean = group_data
                    .get(var_name)
                    .and_then(|g| g.get(group_label))
                    .filter(|values| !values.is_empty())
                    .map_or(0.0, |values| calculate_mean(values));

                means.insert(var_name.clone(), mean);
            }

            (group_label.clone(), means)
        })
        .collect();

    // Combine parallel results
    for (group_label, means) in group_mean_results {
        group_means.insert(group_label, means);
    }

    group_means
}

/// Mean of every variable over the cases of all groups:
///
/// x̄ⱼ = Σₖ Σᵢ xᵢⱼₖ / N   (N = total number of cases; 0 when there are none)
pub fn calculate_overall_means(
    group_data: &HashMap<String, HashMap<String, Vec<f64>>>,
    group_labels: &[String],
    variables: &[String]
) -> HashMap<String, f64> {
    // Process variables in parallel
    let overall_mean_results: Vec<(String, f64)> = variables
        .par_iter()
        .map(|var_name| {
            let mut all_values = Vec::new();

            for group_label in group_labels {
                if let Some(values) = group_data.get(var_name).and_then(|g| g.get(group_label)) {
                    all_values.extend(values);
                }
            }

            let mean = if !all_values.is_empty() { calculate_mean(&all_values) } else { 0.0 };

            (var_name.clone(), mean)
        })
        .collect();

    // Combine parallel results
    let mut overall_means = HashMap::new();
    for (var_name, mean) in overall_mean_results {
        overall_means.insert(var_name, mean);
    }

    overall_means
}

/// Extract all variable values from a single case
pub fn extract_case_values(record: &DataRecord, variables: &[String]) -> Vec<f64> {
    let values: Vec<f64> = variables
        .iter()
        .filter_map(|var_name| {
            if let Some(DataValue::Number(value)) = record.values.get(var_name) {
                Some(*value)
            } else {
                // Debug-build log of a missing or non-numeric value.
                crate::debug_log!("[extract_case_values] Variable '{}' not found or not numeric in record. Available keys: {:?}",
                    var_name,
                    record.values.keys().collect::<Vec<_>>());
                None
            }
        })
        .collect();

    if values.len() != variables.len() {
        crate::debug_log!("[extract_case_values] Length mismatch! Expected {} variables, got {} values",
            variables.len(),
            values.len());
    }

    values
}

/// Arithmetic mean x̄ = Σxᵢ / n; 0 for an empty slice.
pub fn calculate_mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().sum::<f64>() / (values.len() as f64)
}

/// Sample variance s² = Σ(xᵢ − x̄)² / (n − 1); `mean` supplies x̄ when it is already
/// known. 0 when n ≤ 1.
pub fn calculate_variance(values: &[f64], mean: Option<f64>) -> f64 {
    if values.len() <= 1 {
        return 0.0;
    }

    let mean_val = mean.unwrap_or_else(|| calculate_mean(values));
    values
        .iter()
        .map(|&v| (v - mean_val).powi(2))
        .sum::<f64>() / ((values.len() - 1) as f64)
}

/// Sample standard deviation s = √s² (see `calculate_variance`).
pub fn calculate_std_dev(values: &[f64], mean: Option<f64>) -> f64 {
    calculate_variance(values, mean).sqrt()
}

/// Sample covariance s_xy = Σ(xᵢ − x̄)(yᵢ − ȳ) / (n − 1); 0 when n ≤ 1 or the two
/// slices differ in length.
pub fn calculate_covariance(
    values1: &[f64],
    values2: &[f64],
    mean1: Option<f64>,
    mean2: Option<f64>
) -> f64 {
    if values1.len() <= 1 || values1.len() != values2.len() {
        return 0.0;
    }

    let mean1_val = mean1.unwrap_or_else(|| calculate_mean(values1));
    let mean2_val = mean2.unwrap_or_else(|| calculate_mean(values2));

    values1
        .iter()
        .zip(values2.iter())
        .map(|(&v1, &v2)| (v1 - mean1_val) * (v2 - mean2_val))
        .sum::<f64>() / ((values1.len() - 1) as f64)
}

/// Natural log of the determinant, ln|A| (see `calculate_rank_and_log_det`).
///
/// Delegates to `calculate_rank_and_log_det`, so Box's M (which calls this) and the
/// Log Determinants table (which calls that) share a single implementation — same
/// SVD, same truncation threshold — and can never disagree on the same matrix.
pub fn calculate_log_determinant(matrix: &DMatrix<f64>) -> f64 {
    calculate_rank_and_log_det(matrix).1
}

/// Rank and natural-log determinant of a matrix from its singular values σ₁ ≥ … ≥ σₚ:
///
/// rank  = number of σᵢ > EPSILON · σ₁
/// ln|A| = Σ ln σᵢ over those σᵢ
///
/// For a symmetric positive semi-definite matrix (a covariance matrix) the singular
/// values are its eigenvalues, so ln|A| is the log determinant of its non-singular part.
pub fn calculate_rank_and_log_det(matrix: &DMatrix<f64>) -> (i32, f64) {
    let svd = SVD::new(matrix.clone(), false, false);
    let singular_values = &svd.singular_values;

    let max_val = singular_values.iter().fold(0.0_f64, |max, &v| max.max(v));
    let threshold = EPSILON * max_val;

    let rank = singular_values
        .iter()
        .filter(|&v| *v > threshold)
        .count() as i32;

    let log_det = singular_values
        .iter()
        .filter(|&v| *v > threshold)
        .map(|v| v.ln())
        .sum();

    (rank, log_det)
}

/// Upper-tail probability of the F distribution:
///
/// p = P(F(df1, df2) > f_value) = 1 − CDF(f_value)
///
/// # Parameters
/// * `f_value` - The F statistic
/// * `df1` - Numerator degrees of freedom
/// * `df2` - Denominator degrees of freedom
///
/// # Returns
/// The p-value in [0, 1]: 1 for a NaN or non-positive F or a non-positive df, and 0
/// for F > 10⁶.
pub fn calculate_p_value_from_f(f_value: f64, df1: f64, df2: f64) -> f64 {
    if f_value.is_nan() {
        return 1.0;
    }

    if f_value <= 0.0 {
        return 1.0;
    }

    if df1 <= 0.0 {
        return 1.0;
    }

    if df2 <= 0.0 {
        return 1.0;
    }

    // A very large F is reported as p = 0.
    if f_value > 1000000.0 {
        return 0.0;
    }

    match FisherSnedecor::new(df1, df2) {
        Ok(dist) => {
            let p_value = dist.sf(f_value);

            if p_value.is_nan() {
                1.0
            } else {
                p_value.max(0.0).min(1.0)
            }
        }
        Err(_) => 1.0,
    }
}

/// Upper-tail probability of the chi-square distribution, p = P(χ²(df) > chi_square);
/// 1 for a non-positive statistic or df = 0.
pub fn calculate_p_value_from_chi_square(chi_square: f64, df: usize) -> f64 {
    if chi_square <= 0.0 || df == 0 {
        return 1.0;
    }

    match ChiSquared::new(df as f64) {
        Ok(dist) => dist.sf(chi_square),
        Err(_) => 1.0,
    }
}

/// Upper-tail probability P(χ²(df) > chi_square) for a real-valued df (as
/// `calculate_p_value_from_chi_square`); 1 for a non-positive statistic or df.
pub fn chi_squared_cdf_upper(chi_square: f64, df: f64) -> f64 {
    if chi_square <= 0.0 || df <= 0.0 {
        return 1.0;
    }

    match ChiSquared::new(df) {
        Ok(dist) => dist.sf(chi_square),
        Err(_) => 1.0,
    }
}

/// The analysis cases: rows that pass the selection filter, have a group code inside
/// the defined range, and have no missing predictor (listwise deletion).
pub fn filter_valid_cases(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<AnalysisData, String> {
    crate::debug_log!("Executing filter_valid_cases");

    let group_var = &config.main.grouping_variable;
    let independent_vars = &config.main.independent_variables;
    let min_range = config.define_range.min_range;
    let max_range = config.define_range.max_range;

    // Track valid indices for each group
    let mut valid_indices: Vec<Vec<usize>> = Vec::new();

    // Initialize with all indices
    for group in &data.group_data {
        valid_indices.push((0..group.len()).collect());
    }

    // Step 1: Apply selection filter if applicable
    if
        let (Some(selection_data), Some(selection_var), Some(set_value)) = (
            &data.selection_data,
            &config.main.selection_variable,
            &config.set_value.value,
        )
    {
        for (group_idx, sel_group) in selection_data.iter().enumerate() {
            if group_idx < valid_indices.len() {
                // Filter valid indices based on selection criteria
                valid_indices[group_idx] = valid_indices[group_idx]
                    .iter()
                    .filter(|&&idx| {
                        if idx < sel_group.len() {
                            match sel_group[idx].values.get(selection_var) {
                                Some(DataValue::Number(val)) => (val - set_value).abs() < EPSILON,
                                Some(DataValue::Text(s)) => s == &set_value.to_string(),
                                _ => false,
                            }
                        } else {
                            false
                        }
                    })
                    .copied()
                    .collect();
            }
        }
    }

    // Step 2: Apply group range filter
    for (group_idx, group) in data.group_data.iter().enumerate() {
        if group_idx < valid_indices.len() {
            // Filter valid indices based on group range
            valid_indices[group_idx] = valid_indices[group_idx]
                .iter()
                .filter(|&&idx| {
                    if idx < group.len() {
                        match group[idx].values.get(group_var) {
                            Some(DataValue::Number(val)) => {
                                let min_valid = min_range.map_or(true, |min| val >= &min);
                                let max_valid = max_range.map_or(true, |max| val <= &max);
                                min_valid && max_valid
                            }
                            Some(DataValue::Text(_)) => true, // Text values valid for groups
                            _ => false,
                        }
                    } else {
                        false
                    }
                })
                .copied()
                .collect();
        }
    }

    // Step 3: Apply independent variables filter (check for missing values)
    for (group_idx, _) in data.group_data.iter().enumerate() {
        if group_idx < valid_indices.len() {
            // Filter valid indices based on missing independent vars
            valid_indices[group_idx] = valid_indices[group_idx]
                .iter()
                .filter(|&&idx| {
                    // Check if all independent variables have valid values
                    !independent_vars.iter().any(|var_name| {
                        let var_idx = independent_vars.iter().position(|v| v == var_name);

                        match var_idx {
                            Some(var_idx) if var_idx < data.independent_data.len() => {
                                let var_data = &data.independent_data[var_idx];
                                if idx >= var_data.len() {
                                    return true;
                                }

                                match var_data[idx].values.get(var_name) {
                                    Some(DataValue::Number(val)) if val.is_nan() => true,
                                    Some(DataValue::Text(s)) if s.trim().is_empty() => true,
                                    Some(DataValue::Null) => true,
                                    None => true,
                                    _ => false,
                                }
                            }
                            _ => true,
                        }
                    })
                })
                .copied()
                .collect();
        }
    }

    // Now use the filtered valid_indices to construct the final datasets
    let mut filtered_group_data = Vec::new();

    // Filter group_data
    for (group_idx, group) in data.group_data.iter().enumerate() {
        if group_idx < valid_indices.len() {
            let filtered_group = valid_indices[group_idx]
                .iter()
                .filter_map(|&idx| {
                    if idx < group.len() { Some(group[idx].clone()) } else { None }
                })
                .collect();

            filtered_group_data.push(filtered_group);
        } else {
            filtered_group_data.push(Vec::new());
        }
    }

    // Filter independent_data
    let mut filtered_independent_data = Vec::new();

    for var_idx in 0..data.independent_data.len() {
        let mut filtered_var_data = Vec::new();

        for (_group_idx, group_valid_indices) in valid_indices.iter().enumerate() {
            for &idx in group_valid_indices {
                if idx < data.independent_data[var_idx].len() {
                    filtered_var_data.push(data.independent_data[var_idx][idx].clone());
                }
            }
        }

        filtered_independent_data.push(filtered_var_data);
    }

    // Filter strata_data the same way as independent_data, so bootstrap strata
    // keys stay aligned with the cases that survive the filters.
    let filtered_strata_data = data.strata_data.as_ref().map(|strata_data| {
        strata_data
            .iter()
            .map(|var_rows| {
                let mut filtered_var_data = Vec::new();
                for group_valid_indices in valid_indices.iter() {
                    for &idx in group_valid_indices {
                        if idx < var_rows.len() {
                            filtered_var_data.push(var_rows[idx].clone());
                        }
                    }
                }
                filtered_var_data
            })
            .collect()
    });

    // Filter selection_data if applicable
    let filtered_selection_data = match &data.selection_data {
        Some(selection_data) => {
            let mut filtered = Vec::new();

            for (group_idx, sel_group) in selection_data.iter().enumerate() {
                if group_idx < valid_indices.len() {
                    let filtered_sel_group = valid_indices[group_idx]
                        .iter()
                        .filter_map(|&idx| {
                            if idx < sel_group.len() { Some(sel_group[idx].clone()) } else { None }
                        })
                        .collect();

                    filtered.push(filtered_sel_group);
                } else {
                    filtered.push(Vec::new());
                }
            }

            Some(filtered)
        }
        None => None,
    };

    // File row of every surviving row, so per-case output can print the case's
    // own row number. Rows of later group_data blocks are offset by the earlier
    // blocks' lengths, matching the flattened row order used everywhere else.
    let mut row_numbers = Vec::new();
    let mut offset = 0;
    for (group_idx, group) in data.group_data.iter().enumerate() {
        if let Some(indices) = valid_indices.get(group_idx) {
            for &idx in indices {
                let row = offset + idx;
                row_numbers.push(
                    data.row_numbers.as_ref().and_then(|rn| rn.get(row).copied()).unwrap_or(row)
                );
            }
        }
        offset += group.len();
    }

    Ok(AnalysisData {
        group_data: filtered_group_data,
        independent_data: filtered_independent_data,
        selection_data: filtered_selection_data,
        strata_data: filtered_strata_data,
        row_numbers: Some(row_numbers),
        group_data_defs: data.group_data_defs.clone(),
        independent_data_defs: data.independent_data_defs.clone(),
        selection_data_defs: data.selection_data_defs.clone(),
    })
}

/// A case that is classified but never used to estimate anything, and never
/// cross-validated (cross-validation covers only the cases in the analysis). Three kinds:
///
/// - a mean-substituted case: it passes the selection filter but has at least one
///   missing predictor, so it is left out of the analysis (listwise); with "Replace
///   missing values with mean" (SPSS /CLASSIFY=MEANSUB) it is still classified, each
///   missing predictor replaced by that predictor's mean over the analysis cases;
/// - an unselected case: the selection variable leaves it out of the analysis (the
///   testing part of a training/testing split). SPSS classifies these too and
///   reports them separately; a missing predictor is mean-substituted only with
///   "Replace missing values with mean", otherwise the case is not classified;
/// - an ungrouped case: its group code is missing or outside the defined range.
///   SPSS (GROUPS subcommand): "Cases with values outside the value range or missing
///   are ignored during the analysis phase but are classified during the
///   classification phase." Its group is `UNGROUPED_LABEL`; a missing predictor is
///   handled as for an unselected case.
#[derive(Debug, Clone)]
pub struct MeanSubstitutedCase {
    /// Data-file row (0-based) of the case.
    pub row: usize,
    /// Group label, formatted like `AnalyzedDataset::group_labels`, or
    /// `UNGROUPED_LABEL` for an ungrouped case.
    pub group: String,
    /// One value per independent variable, missing ones already replaced by the mean.
    pub values: HashMap<String, f64>,
    /// Whether the case passes the selection filter (true when no selection
    /// variable is in use). Ungrouped cases are reported with the selected or the
    /// unselected cases accordingly.
    pub selected: bool,
}

/// Actual-group label of an ungrouped case (missing or out-of-range group code), as
/// SPSS prints it in the Casewise Statistics.
pub const UNGROUPED_LABEL: &str = "ungrouped";

/// Which extra cases `collect_extra_cases` returns.
#[derive(Clone, Copy, PartialEq)]
enum ExtraCases {
    /// Selected cases with a missing predictor ("Replace missing values with mean").
    MeanSubstituted,
    /// Cases the selection variable leaves out (the testing part of a split).
    Unselected,
    /// Cases with a missing or out-of-range group code, selected or not.
    Ungrouped,
}

/// Collect the mean-substituted cases from the raw (unfiltered) data.
pub fn mean_substituted_cases(
    raw: &AnalysisData,
    filtered: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<Vec<MeanSubstitutedCase>, String> {
    collect_extra_cases(raw, filtered, config, ExtraCases::MeanSubstituted)
}

/// Collect the unselected cases from the raw (unfiltered) data: every case the
/// selection variable leaves out whose group code is one of the analysis groups.
/// Empty when no selection variable (with a value) is in use.
pub fn unselected_cases(
    raw: &AnalysisData,
    filtered: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<Vec<MeanSubstitutedCase>, String> {
    collect_extra_cases(raw, filtered, config, ExtraCases::Unselected)
}

/// Collect the ungrouped cases from the raw (unfiltered) data: every case whose group
/// code is missing or outside the defined range, selected or not. They never enter the
/// analysis, but are classified, as SPSS does ("Ungrouped cases" in the Classification
/// Results). A case with a missing predictor is classified only with "Replace missing
/// values with mean".
pub fn ungrouped_cases(
    raw: &AnalysisData,
    filtered: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<Vec<MeanSubstitutedCase>, String> {
    collect_extra_cases(raw, filtered, config, ExtraCases::Ungrouped)
}

/// Shared scan behind `mean_substituted_cases`, `unselected_cases` and
/// `ungrouped_cases`.
///
/// Uses the same rules as the analysis pipeline so no case is counted twice or
/// dropped: the selection filter and "missing" test of `filter_valid_cases`, and the
/// group-label formatting and range check of `extract_grouped_data`. Outside
/// `ExtraCases::Ungrouped`, cases whose group is not one of the analysis groups are
/// skipped. The means come from the analysis cases (`filtered`), i.e. the same
/// `overall_means` the functions use.
fn collect_extra_cases(
    raw: &AnalysisData,
    filtered: &AnalysisData,
    config: &DiscriminantConfig,
    kind: ExtraCases
) -> Result<Vec<MeanSubstitutedCase>, String> {
    let dataset = extract_analyzed_dataset(filtered, config)?;
    let group_var = &config.main.grouping_variable;
    let min_range = config.define_range.min_range;
    let max_range = config.define_range.max_range;

    let variables: Vec<&String> = config.main.independent_variables
        .iter()
        .filter(|v| *v != group_var)
        .collect();

    // Each predictor lives in its own column of `independent_data`.
    let columns: Vec<Option<&Vec<crate::models::data::DataRecord>>> = variables
        .iter()
        .map(|var| {
            raw.independent_data
                .iter()
                .find(|records| records.iter().any(|r| r.values.contains_key(*var)))
        })
        .collect();

    let selection_rows: Option<Vec<&crate::models::data::DataRecord>> = match
        (&raw.selection_data, &config.main.selection_variable, &config.set_value.value)
    {
        (Some(selection_data), Some(_), Some(_)) => Some(selection_data.iter().flatten().collect()),
        _ => None,
    };

    let mut cases = Vec::new();

    for (row, record) in raw.group_data.iter().flatten().enumerate() {
        // Group label and range check, as in extract_grouped_data. `None` is a
        // missing or out-of-range group code (a blank text code counts as missing,
        // as in basic_processing_summary).
        let group = match record.values.get(group_var) {
            Some(DataValue::Number(num)) if !num.is_nan() => {
                if min_range.map_or(true, |min| *num >= min) && max_range.map_or(true, |max| *num <= max) {
                    Some(num.to_string())
                } else {
                    None
                }
            }
            Some(DataValue::Text(text)) if !text.trim().is_empty() => Some(text.clone()),
            _ => None,
        };
        let group = match (kind, group) {
            (ExtraCases::Ungrouped, None) => UNGROUPED_LABEL.to_string(),
            (ExtraCases::Ungrouped, Some(_)) | (_, None) => {
                continue;
            }
            (_, Some(group)) => {
                if !dataset.group_labels.contains(&group) {
                    continue;
                }
                group
            }
        };

        // Selection filter, as in filter_valid_cases. `None` when no selection
        // variable (with a value) is in use, i.e. every case counts as selected.
        let selected: Option<bool> = match
            (&selection_rows, &config.main.selection_variable, &config.set_value.value)
        {
            (Some(rows), Some(selection_var), Some(set_value)) =>
                Some(match rows.get(row).and_then(|r| r.values.get(selection_var)) {
                    Some(DataValue::Number(val)) => (val - set_value).abs() < EPSILON,
                    Some(DataValue::Text(s)) => s == &set_value.to_string(),
                    _ => false,
                }),
            _ => None,
        };
        let in_scope = match kind {
            ExtraCases::MeanSubstituted => selected.unwrap_or(true),
            ExtraCases::Unselected => selected == Some(false),
            ExtraCases::Ungrouped => true,
        };
        if !in_scope {
            continue;
        }

        let cells: Vec<Option<&DataValue>> = columns
            .iter()
            .zip(&variables)
            .map(|(column, var)| column.and_then(|c| c.get(row)).and_then(|r| r.values.get(*var)))
            .collect();

        // "Missing", as in filter_valid_cases.
        let is_missing = |cell: &Option<&DataValue>| {
            match cell {
                Some(DataValue::Number(val)) => val.is_nan(),
                Some(DataValue::Text(s)) => s.trim().is_empty(),
                Some(DataValue::Null) | None => true,
                _ => false,
            }
        };
        let any_missing = cells.iter().any(is_missing);
        match kind {
            // A complete selected case is already in the analysis.
            ExtraCases::MeanSubstituted => if !any_missing {
                continue;
            }
            // An unselected or ungrouped case with a missing predictor is classified
            // only when "Replace missing values with mean" is on.
            ExtraCases::Unselected | ExtraCases::Ungrouped => if any_missing && !config.classify.replace {
                continue;
            }
        }

        let mut values = HashMap::new();
        for (var, cell) in variables.iter().zip(&cells) {
            let present = match cell {
                Some(DataValue::Number(val)) if val.is_finite() => Some(*val),
                Some(DataValue::Text(s)) => s.trim().parse::<f64>().ok(),
                _ => None,
            };
            let value = match present {
                Some(val) => val,
                None =>
                    *dataset.overall_means
                        .get(*var)
                        .ok_or_else(|| format!("No analysis mean available for variable {}", var))?,
            };
            values.insert((*var).clone(), value);
        }

        let file_row = raw.row_numbers.as_ref().and_then(|rn| rn.get(row).copied()).unwrap_or(row);
        cases.push(MeanSubstitutedCase { row: file_row, group, values, selected: selected.unwrap_or(true) });
    }

    Ok(cases)
}

/// Predictor values (in `variables` order) of every case of `group` to classify: the
/// analysis cases in dataset order, then that group's mean-substituted cases.
pub fn classification_case_values(
    dataset: &AnalyzedDataset,
    group: &str,
    variables: &[String],
    substituted: &[MeanSubstitutedCase]
) -> Vec<Vec<f64>> {
    let n_cases = variables
        .first()
        .and_then(|v| dataset.group_data.get(v))
        .and_then(|g| g.get(group))
        .map_or(0, |v| v.len());

    // After listwise filtering every predictor holds a value for every analysis case;
    // NaN (not 0) marks a broken invariant so it cannot pass as a real value.
    let mut cases: Vec<Vec<f64>> = (0..n_cases)
        .map(|i| {
            variables
                .iter()
                .map(|var| {
                    dataset.group_data
                        .get(var)
                        .and_then(|g| g.get(group))
                        .and_then(|values| values.get(i))
                        .copied()
                        .unwrap_or(f64::NAN)
                })
                .collect()
        })
        .collect();

    cases.extend(
        substituted
            .iter()
            .filter(|case| case.group == group)
            .map(|case| {
                variables
                    .iter()
                    .map(|var| case.values.get(var).copied().unwrap_or(f64::NAN))
                    .collect()
            })
    );

    cases
}
