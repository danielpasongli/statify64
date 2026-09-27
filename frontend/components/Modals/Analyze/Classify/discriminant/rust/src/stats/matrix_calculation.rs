//! Matrix calculations for discriminant analysis.
//!
//! This module implements the matrix operations needed for discriminant analysis,
//! including between-groups and within-groups matrices, Mahalanobis distances,
//! and statistical metrics derived from these matrices.

use std::collections::HashMap;

use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;

use crate::{
    models::{
        result::{CovarianceMatrices, PooledMatrices},
        AnalysisData, DiscriminantConfig,
    },
    stats::core::{
        calculate_covariance, is_rank_deficient, push_analysis_warning, AnalyzedDataset, EPSILON,
    },
};

use super::core::extract_analyzed_dataset;

/// Compute the within-groups SSCP matrix Σ(nᵢ-1)Sᵢ and the pooled degrees of
/// freedom Σ(nᵢ-1). Single source of truth for every pooled/within covariance
/// computation (pooled within matrix, between/within pair, Wilks, etc.).
fn within_group_sscp(dataset: &AnalyzedDataset, variables: &[String]) -> (DMatrix<f64>, usize) {
    let p = variables.len();

    let group_contributions: Vec<(DMatrix<f64>, usize)> = dataset
        .group_labels
        .par_iter()
        .filter_map(|group_label| {
            let n = dataset
                .group_data
                .get(&variables[0])
                .and_then(|g| g.get(group_label))
                .map_or(0, |v| v.len());

            if n <= 1 {
                return None;
            }

            let df = n - 1;
            let mut group_within = DMatrix::zeros(p, p);

            for (i, var_i) in variables.iter().enumerate() {
                for (j, var_j) in variables.iter().enumerate() {
                    if let (Some(values_i), Some(values_j)) = (
                        dataset
                            .group_data
                            .get(var_i)
                            .and_then(|g| g.get(group_label)),
                        dataset
                            .group_data
                            .get(var_j)
                            .and_then(|g| g.get(group_label)),
                    ) {
                        if values_i.len() > 1 && values_i.len() == values_j.len() {
                            let mean_i = dataset.group_means[group_label][var_i];
                            let mean_j = dataset.group_means[group_label][var_j];

                            let cov = calculate_covariance(
                                values_i,
                                values_j,
                                Some(mean_i),
                                Some(mean_j),
                            );

                            group_within[(i, j)] = (df as f64) * cov;
                        }
                    }
                }
            }

            Some((group_within, df))
        })
        .collect();

    let mut sscp = DMatrix::zeros(p, p);
    let mut total_df = 0;
    for (group_within, df) in group_contributions {
        sscp += &group_within;
        total_df += df;
    }

    (sscp, total_df)
}

/// Compute the between-groups SSCP matrix: B_ij = Σ_g n_g·(x̄_gi - x̄_i)·(x̄_gj - x̄_j).
/// Single source of truth shared by the between/within pair and canonical analysis.
pub fn calculate_between_groups_sscp(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> DMatrix<f64> {
    let p = variables.len();
    let mut between_matrix = DMatrix::zeros(p, p);

    for (i, var_i) in variables.iter().enumerate() {
        for (j, var_j) in variables.iter().enumerate() {
            let overall_mean_i = *dataset.overall_means.get(var_i).unwrap_or(&0.0);
            let overall_mean_j = *dataset.overall_means.get(var_j).unwrap_or(&0.0);

            let mut sum = 0.0;

            for group_label in &dataset.group_labels {
                if let (Some(values_i), Some(mean_i), Some(mean_j)) = (
                    dataset
                        .group_data
                        .get(var_i)
                        .and_then(|g| g.get(group_label)),
                    dataset
                        .group_means
                        .get(group_label)
                        .and_then(|m| m.get(var_i)),
                    dataset
                        .group_means
                        .get(group_label)
                        .and_then(|m| m.get(var_j)),
                ) {
                    let n_g = values_i.len() as f64;
                    if n_g > 0.0 {
                        sum += n_g * (mean_i - overall_mean_i) * (mean_j - overall_mean_j);
                    }
                }
            }

            between_matrix[(i, j)] = sum;
        }
    }

    between_matrix
}

/// Calculate between-groups and within-groups matrices
///
/// These are fundamental matrices for discriminant analysis:
/// - Between-groups: size-weighted SSCP of the group means, B = Σ nᵢ(x̄ᵢ-x̄)(x̄ᵢ-x̄)ᵀ
/// - Within-groups: pooled within-groups covariance (W_SSCP / (n-g)), no EPSILON
///
/// # Parameters
/// * `dataset` - The analyzed dataset containing group data and means
/// * `variables` - The variables to include in the matrices
///
/// # Returns
/// A tuple containing (between-groups SSCP matrix, within-groups covariance matrix)
pub fn calculate_between_within_matrices(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> (DMatrix<f64>, DMatrix<f64>) {
    let between_matrix = calculate_between_groups_sscp(dataset, variables);
    let within_matrix = calculate_pooled_within_matrix_no_epsilon(dataset, variables);
    (between_matrix, within_matrix)
}

/// Calculate pooled within-groups covariance matrix
///
/// This function computes the pooled within-groups covariance matrix,
/// which is used in discriminant analysis for classification and testing.
///
/// The matrix is calculated as:
/// S = Σ(nᵢ − 1)Sᵢ / (n − g), plus EPSILON on the diagonal
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `variables` - The variables to include in the matrix
///
/// # Returns
/// The pooled within-groups covariance matrix
pub fn calculate_pooled_within_matrix(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> DMatrix<f64> {
    let mut pooled_within = calculate_pooled_within_matrix_no_epsilon(dataset, variables);

    // Add small regularization for numerical stability
    for i in 0..variables.len() {
        pooled_within[(i, i)] += EPSILON;
    }

    pooled_within
}

/// Calculate pooled within-groups covariance matrix WITHOUT EPSILON diagonal regularization.
///
/// This is identical to `calculate_pooled_within_matrix` but does NOT add EPSILON
/// to the diagonal. Used for:
/// - Log Determinants table (must match Box's M internal computation)
/// - Box's M test (pooled log determinant must match table value)
///
/// The matrix is calculated as:
/// S = Σ(nᵢ − 1)Sᵢ / (n − g)
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `variables` - The variables to include in the matrix
///
/// # Returns
/// The pooled within-groups covariance matrix (no EPSILON added)
pub fn calculate_pooled_within_matrix_no_epsilon(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> DMatrix<f64> {
    let (mut pooled_within, total_df) = within_group_sscp(dataset, variables);

    if total_df > 0 {
        pooled_within /= total_df as f64;
    }

    // NO EPSILON added here — this is the key difference from calculate_pooled_within_matrix

    pooled_within
}

/// Calculate the total covariance matrix: covariance of all cases pooled
/// together, ignoring group membership (SPSS "Total" covariance, df = N - 1):
///
/// T = Σ (x − x̄)(x − x̄)ᵀ / (N − 1)
///
/// Values for variables i and j are concatenated across groups in the same
/// group order, so each case's (xᵢ, xⱼ) pair stays aligned. The deviations are
/// taken from the overall means.
pub fn calculate_total_covariance_matrix(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> DMatrix<f64> {
    let p = variables.len();
    let mut total = DMatrix::zeros(p, p);
    if p == 0 {
        return total;
    }

    // Concatenate each variable's observations across all groups (case order).
    let columns: Vec<Vec<f64>> = variables
        .iter()
        .map(|var| {
            let mut all = Vec::new();
            for group_label in &dataset.group_labels {
                if let Some(vals) = dataset.group_data.get(var).and_then(|g| g.get(group_label)) {
                    all.extend(vals.iter().copied());
                }
            }
            all
        })
        .collect();

    let n = columns[0].len();
    if n <= 1 {
        return total;
    }

    for i in 0..p {
        let mean_i = *dataset.overall_means.get(&variables[i]).unwrap_or(&0.0);
        for j in 0..p {
            let mean_j = *dataset.overall_means.get(&variables[j]).unwrap_or(&0.0);
            total[(i, j)] =
                calculate_covariance(&columns[i], &columns[j], Some(mean_i), Some(mean_j));
        }
    }

    total
}

/// Calculate pooled within-groups covariance and correlation matrices
///
/// This function computes both the pooled within-groups covariance matrix
/// S = Σ(nᵢ − 1)Sᵢ / (n − g) and the corresponding correlation matrix
/// rᵢⱼ = sᵢⱼ / √(sᵢᵢ sⱼⱼ).
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A PooledMatrices object with covariance and correlation matrices
pub fn calculate_pooled_matrices(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<PooledMatrices, String> {
    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    // Exclude grouping variable from pooled matrices output
    let grouping_var = &config.main.grouping_variable;
    let variables: Vec<String> = config
        .main
        .independent_variables
        .iter()
        .filter(|v| *v != grouping_var)
        .cloned()
        .collect();

    // Calculate pooled within-groups covariance matrix (exact, no EPSILON on the
    // diagonal so the displayed variances are the true pooled values).
    let pooled_cov_matrix = calculate_pooled_within_matrix_no_epsilon(&dataset, &variables);

    // Convert covariance matrix to HashMap format
    let mut covariance = HashMap::new();
    let mut correlation = HashMap::new();

    for (i, var_i) in variables.iter().enumerate() {
        let mut cov_row = HashMap::new();
        let mut corr_row = HashMap::new();

        for (j, var_j) in variables.iter().enumerate() {
            // Store covariance value
            cov_row.insert(var_j.clone(), pooled_cov_matrix[(i, j)]);

            // Calculate correlation value
            let var_i_std = pooled_cov_matrix[(i, i)].sqrt();
            let var_j_std = pooled_cov_matrix[(j, j)].sqrt();

            let corr_value = if var_i_std > EPSILON && var_j_std > EPSILON {
                pooled_cov_matrix[(i, j)] / (var_i_std * var_j_std)
            } else {
                0.0
            };

            corr_row.insert(var_j.clone(), corr_value);
        }

        covariance.insert(var_i.clone(), cov_row);
        correlation.insert(var_i.clone(), corr_row);
    }

    // Calculate degrees of freedom for the pooled matrix
    // For pooled covariance matrix, df = total_cases - num_groups
    let total_df = dataset.total_cases - dataset.num_groups;
    let note_df = format!(
        "a. The covariance matrix has {} degrees of freedom.",
        total_df
    );

    Ok(PooledMatrices {
        variables: variables.clone(),
        covariance,
        correlation,
        note_df,
    })
}

/// Calculate covariance matrices for the "Covariance Matrices" table.
///
/// Produces the separate-groups covariance matrices (one per group, df = nᵢ-1)
/// when `sg_covariance` is requested, and a pooled "Total" covariance matrix
/// (all cases, df = N-1) when `total_covariance` or `sg_covariance` is requested
/// — matching SPSS, which appends a Total section to the separate-groups table.
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A CovarianceMatrices object keyed by group name (plus "Total" when applicable)
pub fn calculate_covariance_matrices(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<CovarianceMatrices, String> {
    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    // Exclude the grouping variable, consistent with the pooled matrices output.
    let grouping_var = &config.main.grouping_variable;
    let variables: Vec<String> = config
        .main
        .independent_variables
        .iter()
        .filter(|v| *v != grouping_var)
        .cloned()
        .collect();

    if variables.is_empty() {
        return Err("No independent variables found after filtering grouping variable.".into());
    }

    let want_separate = config.statistics.sg_covariance;
    let want_total = config.statistics.total_covariance || want_separate;

    // Helper: convert a dense p×p matrix into the nested-HashMap row form.
    let to_rows = |m: &DMatrix<f64>| -> HashMap<String, HashMap<String, f64>> {
        let mut rows = HashMap::new();
        for (i, var_i) in variables.iter().enumerate() {
            let mut row = HashMap::new();
            for (j, var_j) in variables.iter().enumerate() {
                row.insert(var_j.clone(), m[(i, j)]);
            }
            rows.insert(var_i.clone(), row);
        }
        rows
    };

    let mut matrices: HashMap<String, HashMap<String, HashMap<String, f64>>> = HashMap::new();
    let mut groups: Vec<String> = Vec::new();

    // Separate-groups covariance matrices (one per group with ≥ 2 cases).
    if want_separate {
        let group_matrices: Vec<(String, HashMap<String, HashMap<String, f64>>)> = dataset
            .group_labels
            .par_iter()
            .filter_map(|group| {
                let group_size = dataset
                    .group_data
                    .get(&variables[0])
                    .and_then(|g| g.get(group))
                    .map_or(0, |v| v.len());

                if group_size <= 1 {
                    return None; // Skip groups with insufficient data
                }

                let mut group_matrix = HashMap::new();
                for var_i in variables.iter() {
                    let mut row = HashMap::new();
                    for var_j in variables.iter() {
                        let cov = match (
                            dataset.group_data.get(var_i).and_then(|g| g.get(group)),
                            dataset.group_data.get(var_j).and_then(|g| g.get(group)),
                        ) {
                            (Some(values_i), Some(values_j))
                                if values_i.len() > 1 && values_i.len() == values_j.len() =>
                            {
                                let mean_i = dataset.group_means[group][var_i];
                                let mean_j = dataset.group_means[group][var_j];
                                calculate_covariance(values_i, values_j, Some(mean_i), Some(mean_j))
                            }
                            _ => 0.0,
                        };
                        row.insert(var_j.clone(), cov);
                    }
                    group_matrix.insert(var_i.clone(), row);
                }
                Some((group.clone(), group_matrix))
            })
            .collect();

        for group in &dataset.group_labels {
            if let Some((_, matrix)) = group_matrices.iter().find(|(g, _)| g == group) {
                matrices.insert(group.clone(), matrix.clone());
                groups.push(group.clone());
            }
        }
    }

    // Total covariance matrix (all cases pooled, ignoring group membership).
    if want_total {
        let total = calculate_total_covariance_matrix(&dataset, &variables);
        matrices.insert("Total".to_string(), to_rows(&total));
        groups.push("Total".to_string());
    }

    // Total covariance df = N - 1.
    let df = dataset.total_cases.saturating_sub(1);
    let note_df = format!(
        "a. The total covariance matrix has {} degrees of freedom.",
        df
    );

    Ok(CovarianceMatrices {
        groups,
        variables,
        matrices,
        note_df,
    })
}

/// Calculate total unexplained variation between groups (SPSS "Residual Variance").
///
/// SPSS's Unexplained Variance (MINRESID) method minimizes the sum, over all pairs
/// of groups, of the unexplained variation. For each pair (i, j):
///
///   U_ij = 4 / (4 + D²_ij)
///
/// where D²_ij is the squared Mahalanobis distance between the two group
/// centroids using the common (all-groups) pooled within-groups covariance. The
/// constant 4 is the between-centroid variance of two equally-weighted means at
/// distance D — i.e. (D/2)² → D²/4 — so unexplained = within / (within + between)
/// = 1 / (1 + D²/4). It is NOT weighted by the group sizes (no Hotelling T² and
/// no pair degrees of freedom).
///
/// Residual Variance = Σ_{i<j} U_ij; lower = better separation.
pub fn calculate_total_unexplained_variation(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> f64 {
    let num_pairs =
        (dataset.group_labels.len() * dataset.group_labels.len().saturating_sub(1) / 2) as f64;

    if variables.is_empty() {
        return num_pairs; // Each pair fully unexplained (U_ij = 1)
    }

    // Common all-groups pooled inverse for D² — computed once for all pairs.
    let inv = pooled_within_inverse(dataset, variables);

    let mut sum = 0.0;
    for (i, group_i) in dataset.group_labels.iter().enumerate() {
        let values: Vec<f64> = dataset.group_labels[i + 1..]
            .par_iter()
            .map(|group_j| {
                let d2 =
                    group_mahalanobis_with_inv(dataset, group_i, group_j, variables, inv.as_ref());
                4.0 / (4.0 + d2)
            })
            .collect();
        sum += values.iter().sum::<f64>();
    }

    sum
}

/// Helper: number of cases in a group for a given variable (as f64).
fn group_size(dataset: &AnalyzedDataset, variable: &str, group: &str) -> f64 {
    dataset
        .group_data
        .get(variable)
        .and_then(|g| g.get(group))
        .map_or(0.0, |v| v.len() as f64)
}

/// Result containing minimum Mahalanobis distance and the two closest groups
#[derive(Debug, Clone)]
pub struct MinMahalanobisResult {
    /// The minimum squared Mahalanobis distance
    pub min_d2: f64,
    /// First group of the closest pair
    pub group_i: String,
    /// Second group of the closest pair
    pub group_j: String,
    /// Sample size of first group
    pub n_i: usize,
    /// Sample size of second group
    pub n_j: usize,
}

/// Calculate minimum Mahalanobis distance between any two groups
///
/// min over the group pairs (i, j) of D²ᵢⱼ = (x̄ᵢ − x̄ⱼ)ᵀ S⁻¹ (x̄ᵢ − x̄ⱼ), with S the
/// pooled within-groups covariance matrix of `variables`.
pub fn calculate_min_mahalanobis_distance(dataset: &AnalyzedDataset, variables: &[String]) -> f64 {
    calculate_min_mahalanobis_distance_with_groups(dataset, variables).min_d2
}

/// Calculate minimum Mahalanobis distance between any two groups with group information
///
/// This version returns detailed information about which groups are closest,
/// which is needed for the Exact F calculation in the Mahalanobis method.
pub fn calculate_min_mahalanobis_distance_with_groups(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> MinMahalanobisResult {
    if variables.is_empty() || dataset.group_labels.len() < 2 {
        return MinMahalanobisResult {
            min_d2: 0.0,
            group_i: String::new(),
            group_j: String::new(),
            n_i: 0,
            n_j: 0,
        };
    }

    // Pooled inverse depends only on `variables` — compute once for all pairs.
    let inv = pooled_within_inverse(dataset, variables);

    let mut min_result = MinMahalanobisResult {
        min_d2: f64::MAX,
        group_i: String::new(),
        group_j: String::new(),
        n_i: 0,
        n_j: 0,
    };

    for (i, group_i) in dataset.group_labels.iter().enumerate() {
        for group_j in &dataset.group_labels[i + 1..] {
            let d = group_mahalanobis_with_inv(dataset, group_i, group_j, variables, inv.as_ref());

            if d < min_result.min_d2 {
                // Get group sizes
                let n_i = dataset
                    .group_data
                    .get(&variables[0])
                    .and_then(|g| g.get(group_i))
                    .map_or(0, |v| v.len());

                let n_j = dataset
                    .group_data
                    .get(&variables[0])
                    .and_then(|g| g.get(group_j))
                    .map_or(0, |v| v.len());

                min_result = MinMahalanobisResult {
                    min_d2: d,
                    group_i: group_i.clone(),
                    group_j: group_j.clone(),
                    n_i,
                    n_j,
                };
            }
        }
    }

    min_result
}

/// Result of the smallest-F-ratio search: the minimum pairwise F and which pair.
#[derive(Debug, Clone)]
pub struct MinFRatioResult {
    /// Minimum F ratio across all group pairs
    pub min_f: f64,
    /// First group of the pair achieving the minimum
    pub group_i: String,
    /// Second group of the pair achieving the minimum
    pub group_j: String,
}

/// Calculate minimum F ratio between any two groups, tracking the pair.
///
/// Per-pair F: F_ij = D²_ij · (N-g-p+1) · n_i·n_j / (p · (N-g) · (n_i+n_j)),
/// distributed as F(p, N-g-p+1). SPSS's Smallest F Ratio method reports the
/// minimum of these and the "Between Groups" pair that achieves it.
pub fn calculate_min_f_ratio_with_groups(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> MinFRatioResult {
    let empty = MinFRatioResult {
        min_f: 0.0,
        group_i: String::new(),
        group_j: String::new(),
    };
    if variables.is_empty() || dataset.group_labels.len() < 2 {
        return empty;
    }

    let p = variables.len() as f64;
    let n = dataset.total_cases as f64;
    let g = dataset.num_groups as f64;

    // Pooled inverse depends only on `variables` — compute once for all pairs.
    let inv = pooled_within_inverse(dataset, variables);

    let mut best = MinFRatioResult {
        min_f: f64::MAX,
        group_i: String::new(),
        group_j: String::new(),
    };

    for (i, group_i) in dataset.group_labels.iter().enumerate() {
        for group_j in &dataset.group_labels[i + 1..] {
            let d2 = group_mahalanobis_with_inv(dataset, group_i, group_j, variables, inv.as_ref());
            let n_i = group_size(dataset, &variables[0], group_i);
            let n_j = group_size(dataset, &variables[0], group_j);
            if n_i > 0.0 && n_j > 0.0 && p > 0.0 && (n - g) > 0.0 {
                let f =
                    (d2 * (n - g - p + 1.0) * (n_i * n_j)) / (p * (n - g) * (n_i + n_j));
                if f < best.min_f {
                    best = MinFRatioResult {
                        min_f: f,
                        group_i: group_i.clone(),
                        group_j: group_j.clone(),
                    };
                }
            }
        }
    }

    if best.min_f == f64::MAX {
        empty
    } else {
        best
    }
}

/// Pooled within-groups inverse S⁻¹ (EPSILON-regularized), computed ONCE per
/// variable set. The inverse depends only on the variables, not on the group
/// pair, so all pairwise D² loops share a single inversion via this helper.
///
/// Returns `None` if the pooled matrix is singular or near-singular (callers fall
/// back to the squared Euclidean distance of the mean difference). That fallback is
/// not a Mahalanobis distance, so it is reported as a warning rather than silently.
pub(crate) fn pooled_within_inverse(dataset: &AnalyzedDataset, variables: &[String]) -> Option<DMatrix<f64>> {
    if variables.is_empty() {
        return None;
    }
    let mut reg_cov = calculate_pooled_within_matrix_no_epsilon(dataset, variables);
    // The EPSILON ridge below keeps near-singular matrices invertible, but their
    // inverse is dominated by 1/EPSILON and the resulting D² is meaningless, so the
    // rank is checked on the unregularized matrix first.
    if is_rank_deficient(&reg_cov) {
        push_analysis_warning(
            "mahalanobis_distance",
            format!(
                "The pooled within-groups covariance matrix of [{}] is singular (a predictor is a linear combination of the others). Group-pair Mahalanobis distances (Min. D Squared, Smallest F Ratio, Residual Variance, pairwise F) for this set were replaced by squared Euclidean distances and are not valid.",
                variables.join(", ")
            ),
        );
        return None;
    }
    for i in 0..variables.len() {
        reg_cov[(i, i)] += EPSILON;
    }
    reg_cov.try_inverse()
}

/// Build the (group_i − group_j) mean-difference vector for the variable set.
fn group_mean_diff(
    dataset: &AnalyzedDataset,
    group_i: &str,
    group_j: &str,
    variables: &[String],
) -> DVector<f64> {
    let mut mean_diff = DVector::zeros(variables.len());
    for (idx, var) in variables.iter().enumerate() {
        let mean_i = dataset
            .group_means
            .get(group_i)
            .and_then(|m| m.get(var))
            .copied()
            .unwrap_or(0.0);
        let mean_j = dataset
            .group_means
            .get(group_j)
            .and_then(|m| m.get(var))
            .copied()
            .unwrap_or(0.0);
        mean_diff[idx] = mean_i - mean_j;
    }
    mean_diff
}

/// Squared Mahalanobis distance D² = δ'·S⁻¹·δ between two groups, given a
/// precomputed pooled inverse. `None` → singular fallback (‖δ‖²).
pub(crate) fn group_mahalanobis_with_inv(
    dataset: &AnalyzedDataset,
    group_i: &str,
    group_j: &str,
    variables: &[String],
    inv: Option<&DMatrix<f64>>,
) -> f64 {
    let mean_diff = group_mean_diff(dataset, group_i, group_j, variables);
    match inv {
        Some(inv_cov) => (mean_diff.transpose() * (inv_cov * &mean_diff))[0],
        None => mean_diff.norm_squared(),
    }
}

/// Calculate Rao's V statistic
///
/// Rao's V is a multivariate statistic that measures the separation between
/// group means: V = tr(S_pooled⁻¹·B) = (n-g)·tr(W⁻¹B), i.e. the Lawley-Hotelling
/// trace tr(W⁻¹B) scaled by the within-groups degrees of freedom (n-g).
pub fn calculate_raos_v(dataset: &AnalyzedDataset, variables: &[String]) -> f64 {
    if variables.is_empty() {
        return 0.0;
    }

    // Calculate between-groups and within-groups matrices
    let (between_mat, within_mat) = calculate_between_within_matrices(dataset, variables);

    if is_rank_deficient(&within_mat) {
        push_analysis_warning(
            "raos_v",
            format!(
                "The pooled within-groups covariance matrix of [{}] is singular, so Rao's V is undefined for this set; the value shown is the trace of the between-groups matrix and is not valid.",
                variables.join(", ")
            ),
        );
        return (0..variables.len()).map(|i| between_mat[(i, i)]).sum();
    }

    // Try to invert within-groups matrix
    // within_mat = S_pooled = W_SS / (n-k), so w_inv = S_pooled^{-1}
    // trace = tr(S_pooled^{-1} * B) = SPSS Rao's V directly
    // Do NOT divide by (n-k) again — that would give V/(n-k), not V.
    match within_mat.clone().try_inverse() {
        Some(w_inv) => {
            let product = w_inv * between_mat;
            (0..variables.len()).map(|i| product[(i, i)]).sum()
        }
        None => {
            // Fallback: singular matrix
            (0..variables.len()).map(|i| between_mat[(i, i)]).sum()
        }
    }
}
