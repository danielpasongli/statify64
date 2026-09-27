use nalgebra::DMatrix;
use rayon::prelude::*;
use statrs::distribution::ContinuousCDF;

use crate::models::{result::BoxMTest, AnalysisData, DiscriminantConfig};

use super::core::{
    AnalyzedDataset, calculate_covariance, calculate_log_determinant,
    extract_analyzed_dataset, get_stepwise_selected_variables, is_rank_deficient,
    push_analysis_warning, EPSILON,
};

/// Calculates Box's M test for homogeneity of covariance matrices.
///
/// Box's M test is used to test the null hypothesis:
/// H₀: Σ₁ = Σ₂ = ... = Σₖ
///
/// Where Σᵢ is the covariance matrix for the ith group.
/// For moderate to small sample sizes, an F approximation is used to
/// compute the significance level as per Box (1949).
///
/// The Box's M statistic is calculated as:
/// M = (n-g)log|S| - Σ(nᵢ-1)log|Sᵢ|
///
/// Where:
/// - S is the pooled within-groups covariance matrix
/// - Sᵢ is the covariance matrix for group i
/// - n is the total sample size
/// - g is the number of groups
/// - nᵢ is the size of group i
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A BoxMTest structure containing test statistics and p-value
pub fn calculate_box_m_test(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<BoxMTest, String> {
    crate::debug_log!("Executing calculate_box_m_test");

    // Extract analyzed dataset
    let dataset = match extract_analyzed_dataset(data, config) {
        Ok(ds) => ds,
        Err(e) => {
            return Err(format!("Failed to extract dataset for Box's M test: {}", e));
        }
    };

    let grouping_var = &config.main.grouping_variable;
    let variables: Vec<String> = if config.main.stepwise {
        get_stepwise_selected_variables(data, config)?
    } else {
        config.main.independent_variables
            .iter()
            .filter(|v| *v != grouping_var)
            .cloned()
            .collect()
    };

    crate::debug_log!("Box M: using {} variables: {:?}",
        variables.len(),
        variables);

    box_m_test_for(
        &dataset,
        &variables,
        "box_m_test",
        "Note: Tests null hypothesis of equal population covariance matrices.",
    )
}

/// Box's M on `variables` of an already-extracted dataset.
///
/// Split out of `calculate_box_m_test` so Separate-groups classification can run
/// the same test on the canonical discriminant function scores (SPSS displays
/// that test under /CLASSIFY=SEPARATE). `warning_context` labels the warning raised
/// when groups have to be left out of the test.
pub fn box_m_test_for(
    dataset: &AnalyzedDataset,
    variables: &[String],
    warning_context: &str,
    note: &str,
) -> Result<BoxMTest, String> {
    // Compute per-group covariance matrices and log determinants
    let (all_group_covs, all_group_log_dets, all_group_sizes, all_group_names) =
        compute_group_covariances(&dataset, &variables)?;

    // Groups with n ≤ 1 have no covariance matrix at all.
    let too_small: Vec<&String> = dataset
        .group_labels
        .iter()
        .filter(|g| !all_group_names.contains(g))
        .collect();
    let mut excluded: Vec<String> = too_small
        .iter()
        .map(|g| format!("group {} (fewer than 2 cases)", g))
        .collect();

    // A singular group covariance matrix has no log determinant: the SVD-based value
    // would be a pseudo-determinant over the nonzero singular values only, which biases
    // M. Such groups are excluded from the test, as SPSS does.
    let mut group_covs = Vec::new();
    let mut group_log_dets = Vec::new();
    let mut group_sizes = Vec::new();
    for i in 0..all_group_covs.len() {
        if is_rank_deficient(&all_group_covs[i]) {
            excluded.push(format!(
                "group {} (singular covariance matrix, n = {}, p = {})",
                all_group_names[i],
                all_group_sizes[i],
                variables.len()
            ));
        } else {
            group_covs.push(all_group_covs[i].clone());
            group_log_dets.push(all_group_log_dets[i]);
            group_sizes.push(all_group_sizes[i]);
        }
    }

    if group_covs.len() < 2 {
        return Err(format!(
            "Box's M cannot be computed: no test can be performed with fewer than two nonsingular group covariance matrices{}.",
            if excluded.is_empty() {
                String::new()
            } else {
                format!(" (excluded: {})", excluded.join("; "))
            }
        ));
    }
    if !excluded.is_empty() {
        push_analysis_warning(
            warning_context,
            format!(
                "Box's M was computed without {}. Its log determinant is not defined, so the test covers only the remaining groups.",
                excluded.join("; ")
            ),
        );
    }

    let p = variables.len(); // Number of variables
    let k = group_covs.len(); // Number of groups
    let total_sample_size: usize = group_sizes.iter().sum();

    // Compute pooled covariance matrix
    let pooled_cov_matrix = compute_pooled_covariance_matrix(&group_covs, &group_sizes);
    if is_rank_deficient(&pooled_cov_matrix) {
        return Err(format!(
            "Box's M cannot be computed: the pooled within-groups covariance matrix of [{}] is singular (a predictor is a linear combination of the others).",
            variables.join(", ")
        ));
    }
    let pooled_log_det = calculate_log_determinant(&pooled_cov_matrix);

    // Compute Box's M statistic: M = (n-g)log|S| - Σ(nᵢ-1)log|Sᵢ|
    let mut box_m = ((total_sample_size - k) as f64) * pooled_log_det;
    for (i, log_det) in group_log_dets.iter().enumerate() {
        box_m -= ((group_sizes[i] - 1) as f64) * log_det;
    }

    // Compute correction factors A₁ and A₂ (named c1 and c2 in code)
    let c1 = compute_c1_factor(p, k, &group_sizes, total_sample_size); // A₁
    let c2 = compute_c2_factor(p, k, &group_sizes, total_sample_size); // A₂

    // Compute F approximation
    let v1 = ((p * (p + 1) * (k - 1)) as f64) / 2.0; // f₁ = (g-1)p(p+1)/2

    // Calculate f₂ = (f₁+2)/|A₂ − A₁²|
    let v2 = compute_df2(c1, c2, v1);

    // b factor of the F approximation (branches on A₂ vs A₁², see compute_b_factor)
    let b = compute_b_factor(c1, c2, v1, v2);

    // F approximation:
    //   A₂ > A₁²:  F = M / b
    //   A₂ < A₁²:  F = f₂·M / (f₁·(b − M))
    let f_approx = if box_m > EPSILON {
        if c2 > c1 * c1 {
            box_m / b
        } else {
            // F = (f₂ · M) / (f₁ · (b − M))
            if b > box_m {
                (v2 * box_m) / (v1 * (b - box_m))
            } else {
                0.0
            }
        }
    } else {
        0.0
    };

    // P-value calculation: 1 - CDF.F(F_approx, df1, df2)
    let p_value = if f_approx.is_finite() {
        compute_p_value(f_approx, v1, v2)
    } else {
        1.0
    };

    let note = note.to_string();

    crate::debug_log!("Box M Result: M={}, f_approx={}, df1={}, df2={}, p_value={}, c1={}, c2={}, b={}",
        box_m, f_approx, v1, v2, p_value, c1, c2, b);

    Ok(BoxMTest {
        box_m,
        f_approx,
        df1: v1,
        df2: v2,
        p_value,
        note,
        debug_p: p,
        debug_k: k,
        debug_c1: c1,
        debug_c2: c2,
        debug_b: b,
    })
}

/// Computes group covariance matrices, their log determinants, and group sizes.
///
/// This function calculates the covariance matrix for each group with sufficient data,
/// along with the natural logarithm of the determinant of each covariance matrix.
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `variables` - The variables to include in the covariance matrices
///
/// # Returns
/// A tuple containing (covariance matrices, log determinants, group sizes, group labels)
/// for the groups with at least two cases
fn compute_group_covariances(
    dataset: &AnalyzedDataset,
    variables: &[String],
) -> Result<(Vec<DMatrix<f64>>, Vec<f64>, Vec<usize>, Vec<String>), String> {
    let mut group_covs = Vec::new();
    let mut group_log_dets = Vec::new();
    let mut group_sizes = Vec::new();
    let mut group_names = Vec::new();

    // Process each group in parallel
    let results: Vec<Option<(DMatrix<f64>, f64, usize, String)>> = dataset
        .group_labels
        .par_iter()
        .map(|group| {
            // Check if group has enough data for covariance calculation
            let mut valid_values = true;
            for var in variables {
                if let Some(values) = dataset.group_data.get(var).and_then(|g| g.get(group)) {
                    if values.len() <= 1 {
                        valid_values = false;
                        break;
                    }
                } else {
                    valid_values = false;
                    break;
                }
            }

            if !valid_values {
                return None;
            }

            // Get group size
            let group_size = dataset
                .group_data
                .get(variables.first().unwrap_or(&String::new()))
                .and_then(|v| v.get(group))
                .map_or(0, |v| v.len());

            if group_size <= 1 {
                return None;
            }

            // Compute covariance matrix
            match compute_group_covariance_matrix(dataset, group, variables) {
                Ok(cov_matrix) => {
                    let log_det = calculate_log_determinant(&cov_matrix);
                    Some((cov_matrix, log_det, group_size, group.clone()))
                }
                Err(_) => None,
            }
        })
        .collect();

    // Collect valid results
    for result in results {
        if let Some((cov, log_det, size, name)) = result {
            group_covs.push(cov);
            group_log_dets.push(log_det);
            group_sizes.push(size);
            group_names.push(name);
        }
    }

    Ok((group_covs, group_log_dets, group_sizes, group_names))
}

/// Covariance matrix of one group, Sᵢ = Σ (x − x̄ᵢ)(x − x̄ᵢ)ᵀ / (nᵢ − 1).
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `group` - The group label
/// * `variables` - The variables to include in the covariance matrix
///
/// # Returns
/// The covariance matrix for the specified group
fn compute_group_covariance_matrix(
    dataset: &AnalyzedDataset,
    group: &str,
    variables: &[String],
) -> Result<DMatrix<f64>, String> {
    let num_vars = variables.len();

    // Check if we have enough data
    let first_var = variables
        .first()
        .ok_or_else(|| "No variables provided".to_string())?;
    let num_cases = dataset
        .group_data
        .get(first_var)
        .and_then(|g| g.get(group))
        .map_or(0, |v| v.len());

    if num_cases <= 1 {
        return Err("Group too small for covariance computation".to_string());
    }

    // Compute covariance matrix
    let mut cov_matrix = DMatrix::zeros(num_vars, num_vars);

    for (var1_idx, var1) in variables.iter().enumerate() {
        for (var2_idx, var2) in variables.iter().enumerate() {
            if let (Some(values1), Some(values2)) = (
                dataset.group_data.get(var1).and_then(|g| g.get(group)),
                dataset.group_data.get(var2).and_then(|g| g.get(group)),
            ) {
                if !values1.is_empty() && !values2.is_empty() {
                    let mean1 = dataset
                        .group_means
                        .get(group)
                        .and_then(|m| m.get(var1))
                        .unwrap_or(&0.0);
                    let mean2 = dataset
                        .group_means
                        .get(group)
                        .and_then(|m| m.get(var2))
                        .unwrap_or(&0.0);

                    let cov = calculate_covariance(values1, values2, Some(*mean1), Some(*mean2));
                    cov_matrix[(var1_idx, var2_idx)] = cov;
                }
            }
        }
    }

    Ok(cov_matrix)
}

/// Computes the pooled covariance matrix across all groups.
///
/// The pooled matrix is calculated as:
/// S = Σ(nᵢ-1)Sᵢ / (n-g)
///
/// Where:
/// - nᵢ is the size of group i
/// - Sᵢ is the covariance matrix for group i
/// - n is the total sample size
/// - g is the number of groups
///
/// # Parameters
/// * `group_covs` - Individual group covariance matrices
/// * `group_sizes` - Sizes of each group
///
/// # Returns
/// The pooled covariance matrix
fn compute_pooled_covariance_matrix(
    group_covs: &[DMatrix<f64>],
    group_sizes: &[usize],
) -> DMatrix<f64> {
    if group_covs.is_empty() {
        return DMatrix::zeros(0, 0);
    }

    let p = group_covs[0].nrows();
    let mut pooled_cov = DMatrix::zeros(p, p);
    let mut total_df = 0;

    for (cov, &size) in group_covs.iter().zip(group_sizes) {
        let df = size - 1;
        total_df += df;
        pooled_cov += cov * (df as f64);
    }

    if total_df > 0 {
        pooled_cov /= total_df as f64;
    }

    pooled_cov
}

/// Computes the A₁ correction factor for Box's M test (named c1 in code).
///
/// A₁ = (2p²+3p-1)/(6(p+1)(g-1)) * [Σ1/(nᵢ-1) - 1/(n-g)]
///
/// This returns A₁ itself, not ρ = 1 − A₁: the F approximation uses A₁ directly.
///
/// # Parameters
/// * `p` - Number of variables
/// * `k` - Number of groups
/// * `group_sizes` - Sizes of each group
/// * `total_sample_size` - Total sample size
///
/// # Returns
/// The A₁ correction factor
fn compute_c1_factor(p: usize, k: usize, group_sizes: &[usize], total_sample_size: usize) -> f64 {
    let p_f64 = p as f64;
    let k_f64 = k as f64;

    let mut sum1 = 0.0;
    for &size in group_sizes {
        if size > 1 {
            sum1 += 1.0 / ((size - 1) as f64);
        }
    }

    let n_minus_g = (total_sample_size - k) as f64;
    if n_minus_g > EPSILON {
        sum1 -= 1.0 / n_minus_g;
    }

    let numerator = (2.0 * p_f64.powi(2) + 3.0 * p_f64 - 1.0) * sum1;
    let denominator = 6.0 * (p_f64 + 1.0) * (k_f64 - 1.0);

    if denominator > EPSILON {
        numerator / denominator // A₁ itself, not ρ = 1 − A₁
    } else {
        0.0
    }
}

/// Computes the A₂ correction factor for Box's M test (named c2 in code).
///
/// A₂ = (p-1)(p+2)/(6(g-1)) * [Σ1/(nᵢ-1)² - 1/(n-g)²]
///
/// # Parameters
/// * `p` - Number of variables
/// * `k` - Number of groups
/// * `group_sizes` - Sizes of each group
/// * `total_sample_size` - Total sample size
///
/// # Returns
/// The A₂ correction factor
fn compute_c2_factor(p: usize, k: usize, group_sizes: &[usize], total_sample_size: usize) -> f64 {
    let p_f64 = p as f64;
    let k_f64 = k as f64;

    // Calculate sum for squared inverses of group degrees of freedom
    let mut sum2 = 0.0;
    for &size in group_sizes {
        if size > 1 {
            sum2 += 1.0 / ((size - 1) as f64).powi(2);
        }
    }

    let n_minus_g = (total_sample_size - k) as f64;
    if n_minus_g > EPSILON {
        sum2 -= 1.0 / n_minus_g.powi(2);
    }

    ((p_f64 - 1.0) * (p_f64 + 2.0) * sum2) / (6.0 * (k_f64 - 1.0))
}

/// Computes the b factor for the F approximation.
///
/// b = f₁/(1 − A₁ − f₁/f₂)   if A₂ > A₁²
/// b = f₂/(1 − A₁ + 2/f₂)    if A₂ < A₁²
///
/// # Parameters
/// * `c1` - The A₁ correction factor
/// * `c2` - The A₂ correction factor
/// * `v1` - f₁, the first degrees of freedom
/// * `v2` - f₂, the second degrees of freedom
///
/// # Returns
/// The b-factor
fn compute_b_factor(c1: f64, c2: f64, v1: f64, v2: f64) -> f64 {
    if c2 > c1 * c1 {
        v1 / (1.0 - c1 - v1 / v2)
    } else {
        v2 / (1.0 - c1 + 2.0 / v2) 
    }
}

/// Computes the second degrees of freedom (df2) for F approximation.
///
/// f₂ = (f₁+2)/|A₂ − A₁²|
///
/// # Parameters
/// * `c1` - The A₁ correction factor
/// * `c2` - The A₂ correction factor
/// * `df1` - f₁, the first degrees of freedom
///
/// # Returns
/// The second degrees of freedom (df2)
fn compute_df2(c1: f64, c2: f64, df1: f64) -> f64 {
    let denominator = (c2 - c1 * c1).abs();

    if denominator > EPSILON {
        (df1 + 2.0) / denominator
    } else {
        df1 * 2.0
    }
}

/// Computes the p-value from the F distribution.
///
/// P-value = 1 - F_CDF(f_approx, df1, df2)
///
/// # Parameters
/// * `f_approx` - The F approximation value
/// * `df1` - The first degrees of freedom
/// * `df2` - The second degrees of freedom
///
/// # Returns
/// The p-value
fn compute_p_value(f_approx: f64, df1: f64, df2: f64) -> f64 {
    if f_approx <= 0.0 || df1 <= 0.0 || df2 <= 0.0 {
        return 1.0;
    }

    match statrs::distribution::FisherSnedecor::new(df1, df2) {
        Ok(dist) => dist.sf(f_approx).max(0.0).min(1.0),
        Err(_) => 1.0,
    }
}
