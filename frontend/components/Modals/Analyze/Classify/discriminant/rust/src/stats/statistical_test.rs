//! Statistical tests for discriminant analysis.
//!
//! This module implements various statistical tests used in discriminant analysis,
//! including univariate F tests, Wilks' Lambda, and tolerance calculations.

use nalgebra::DMatrix;

use crate::{
    models::{ result::WilksLambdaTest, AnalysisData, DiscriminantConfig },
    stats::core::{ AnalyzedDataset, EPSILON },
};

use super::core::{
    calculate_between_within_matrices,
    calculate_eigen_statistics,
    calculate_p_value_from_chi_square,
    extract_analyzed_dataset,
    get_stepwise_selected_variables,
};

/// Tests of Equality of Group Means for one variable (one-way ANOVA):
///
/// SSB = Σₖ nₖ (x̄ₖ − x̄)²,   SSW = Σₖ Σᵢ (xᵢₖ − x̄ₖ)²
/// F   = [SSB / (g − 1)] / [SSW / (n − g)]
/// Λ   = SSW / (SSB + SSW)
///
/// g and n count only the groups that have cases. F = 0 when SSW = 0 or there are
/// fewer than two groups; Λ = 1 when SSB + SSW = 0.
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset containing group data and means
///
/// # Returns
/// A tuple of (F value, Wilks' lambda)
pub fn calculate_univariate_f(variable: &str, dataset: &AnalyzedDataset) -> (f64, f64) {
    // x̄, the overall mean
    let overall_mean = *dataset.overall_means.get(variable).unwrap_or(&0.0);

    // Calculate between-groups and within-groups sums of squares
    let mut between_ss = 0.0;
    let mut within_ss = 0.0;
    let mut valid_groups = 0;
    let mut valid_cases = 0;

    for group_label in &dataset.group_labels {
        if
            let Some(group_values) = dataset.group_data
                .get(variable)
                .and_then(|g| g.get(group_label))
        {
            if group_values.is_empty() {
                continue;
            }

            valid_groups += 1;
            valid_cases += group_values.len();

            let group_mean = dataset.group_means
                .get(group_label)
                .and_then(|m| m.get(variable))
                .copied()
                .unwrap_or(0.0);

            // Between-groups SS
            between_ss += (group_values.len() as f64) * (group_mean - overall_mean).powi(2);

            // Within-groups SS
            within_ss += group_values
                .iter()
                .map(|&val| (val - group_mean).powi(2))
                .sum::<f64>();
        }
    }

    // Calculate F statistic
    let f_value = if within_ss > 0.0 && valid_groups > 1 {
        let between_df = valid_groups - 1;
        let within_df = valid_cases - valid_groups;

        between_ss / (between_df as f64) / (within_ss / (within_df as f64))
    } else {
        0.0
    };

    // Calculate Wilks' lambda
    let wilks_lambda = if between_ss + within_ss > 0.0 {
        within_ss / (between_ss + within_ss)
    } else {
        1.0
    };

    (f_value, wilks_lambda)
}

/// Calculate overall Wilks' lambda for a set of variables
///
/// Wilks' lambda is the ratio of the within-groups determinant to the total
/// determinant, and measures the proportion of variance not explained by group
/// differences.
///
/// Uses raw SSCP matrices: Λ = |W| / |B + W|
/// where W = Σ(nᵢ-1)Sᵢ (NOT divided by n-k)
/// This matches SPSS and standard textbook formulas.
///
/// The ratio is computed on the log scale, ln Λ = ln|W| − ln|T|, with each log
/// determinant taken from a Cholesky factorization. This avoids overflow of the raw
/// determinants on large-scale data, and Cholesky fails exactly when a matrix is not
/// positive definite — that case is returned as an error rather than being replaced
/// by a plausible-looking value.
pub fn calculate_overall_wilks_lambda(
    dataset: &AnalyzedDataset,
    variables: &[String]
) -> Result<f64, String> {
    if variables.is_empty() {
        return Ok(1.0);
    }

    // Calculate between-groups and within-groups matrices
    let (between_mat, within_mat) = calculate_between_within_matrices(dataset, variables);

    // within_mat is the pooled covariance W_cov = W_raw / (n-k), as returned by
    // calculate_between_within_matrices (correct for covariance display).
    // Wilks' Lambda requires the raw SSCP: W_raw = W_cov * (n-k), T = B + W_raw.
    let total_df = (dataset.total_cases as f64) - (dataset.num_groups as f64);
    if total_df <= 0.0 {
        return Err(
            format!(
                "Wilks' lambda is undefined: total cases minus groups is {} (must be positive)",
                total_df
            )
        );
    }
    let within_raw = &within_mat * total_df;
    let total_mat = &between_mat + &within_raw;

    let log_det_within = cholesky_log_determinant(&within_raw).ok_or_else(|| {
        format!(
            "Within-groups SSCP matrix is not positive definite for variables [{}]; Wilks' lambda cannot be computed",
            variables.join(", ")
        )
    })?;
    let log_det_total = cholesky_log_determinant(&total_mat).ok_or_else(|| {
        format!(
            "Total SSCP matrix is not positive definite for variables [{}]; Wilks' lambda cannot be computed",
            variables.join(", ")
        )
    })?;

    Ok((log_det_within - log_det_total).exp())
}

/// ln|A| of a symmetric positive-definite matrix via Cholesky, A = LLᵀ:
/// ln|A| = 2 · Σ ln(Lᵢᵢ). Returns None when A is not positive definite.
fn cholesky_log_determinant(matrix: &DMatrix<f64>) -> Option<f64> {
    let cholesky = matrix.clone().cholesky()?;
    let l = cholesky.l();
    Some(
        2.0 *
            l
                .diagonal()
                .iter()
                .map(|v| v.ln())
                .sum::<f64>()
    )
}

/// Calculate tolerance for a variable
///
/// Tolerance measures the proportion of a variable's variance that is not
/// explained by the other independent variables in the model. Low tolerance
/// indicates multicollinearity.
///
/// Computed from the pooled within-groups correlation matrix R of `other_variables`
/// plus the target: tolerance_i = 1 / (R⁻¹)_ii, which equals 1 - R²_i where R²_i is
/// the squared multiple correlation of variable i with all the other variables
/// (pooled within groups). No explicit regression is run.
///
/// This matches SPSS's "Tolerance" column in stepwise output.
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset containing group data and means
/// * `other_variables` - Other variables already in the model
///
/// # Returns
/// A tuple of (tolerance of `variable`, minimum tolerance over every variable in the set)
pub fn calculate_tolerance(
    variable: &str,
    dataset: &AnalyzedDataset,
    other_variables: &[String]
) -> (f64, f64) {
    if other_variables.is_empty() {
        return (1.0, 1.0);
    }

    // 1. The variables of the model, then the target.
    let mut all_vars = other_variables.to_vec();
    all_vars.push(variable.to_string());
    let target_idx = all_vars.len() - 1;

    // 2. Pooled within-groups covariance matrix.
    let (_, within_cov) = calculate_between_within_matrices(dataset, &all_vars);
    let p = all_vars.len();

    // 3. Pooled within-groups correlation matrix R, rᵢⱼ = sᵢⱼ / (sᵢ sⱼ).
    let mut within_cor = nalgebra::DMatrix::zeros(p, p);
    for i in 0..p {
        for j in 0..p {
            let sd_i = within_cov[(i, i)].sqrt();
            let sd_j = within_cov[(j, j)].sqrt();
            if sd_i > 0.0 && sd_j > 0.0 {
                within_cor[(i, j)] = within_cov[(i, j)] / (sd_i * sd_j);
            } else if i == j {
                within_cor[(i, j)] = 1.0;
            }
        }
    }

    // Small ridge so that R stays invertible under strong multicollinearity.
    for i in 0..p {
        within_cor[(i, i)] += EPSILON;
    }

    // 4. VIFᵢ = (R⁻¹)ᵢᵢ and tolerance = 1 / VIFᵢ.
    match within_cor.try_inverse() {
        Some(inv_cor) => {
            let mut min_tol = 1.0_f64;
            let mut target_tol = 0.0;

            for i in 0..p {
                let vif = inv_cor[(i, i)];
                let tol = if vif > 0.0 { 1.0 / vif } else { 0.0 };
                let clamped_tol = tol.clamp(0.0, 1.0); // kept within [0, 1]

                if i == target_idx {
                    target_tol = clamped_tol;
                }
                
                // Minimum tolerance over every variable of the set.
                if clamped_tol < min_tol {
                    min_tol = clamped_tol;
                }
            }
            (target_tol, min_tol)
        }
        None => (0.0, 0.0), // R could not be inverted
    }
}

/// Wilks' Lambda table of the discriminant functions. For the test of functions k
/// through m (λ = eigenvalues, p = variables in the model, g = groups, n = cases):
///
/// Λₖ   = Πᵢ₌ₖᵐ 1 / (1 + λᵢ)
/// χ²ₖ  = −[n − 1 − (p + g) / 2] · ln Λₖ      (Bartlett's approximation)
/// dfₖ  = (p − k + 1)(g − k)
/// Sig. = P(χ²(dfₖ) > χ²ₖ)
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A WilksLambdaTest object with test statistics and significance values
pub fn calculate_wilks_lambda_test(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<WilksLambdaTest, String> {
    // Extract analyzed dataset
    let dataset = match extract_analyzed_dataset(data, config) {
        Ok(ds) => { ds }
        Err(e) => {
            return Err(e);
        }
    };

    // Get eigen statistics
    let eigen_stats = match calculate_eigen_statistics(data, config) {
        Ok(stats) => { stats }
        Err(e) => {
            return Err(e);
        }
    };

    let num_functions = eigen_stats.eigenvalue.len();

    // Initialize result structures
    let mut test_of_functions = Vec::with_capacity(num_functions);
    let mut wilks_lambda = Vec::with_capacity(num_functions);
    let mut chi_square = Vec::with_capacity(num_functions);
    let mut df = Vec::with_capacity(num_functions);
    let mut significance = Vec::with_capacity(num_functions);

    let grouping_var = &config.main.grouping_variable;
    let variables: Vec<String> = if config.main.stepwise {
        get_stepwise_selected_variables(data, config)?
    } else {
        config.main.independent_variables.iter().filter(|v| *v != grouping_var).cloned().collect()
    };

    let p = variables.len() as i32;
    let g = dataset.num_groups as i32;
    let n = dataset.total_cases as f64;

    // Test each function and remaining functions
    for k in 0..num_functions {
        // Test description (e.g., "1 through 3", "2 through 3", etc.)
        let test_desc = if k == 0 {
            format!("1 through {}", num_functions)
        } else {
            format!("{} through {}", k + 1, num_functions)
        };

        test_of_functions.push(test_desc.clone());

        // Calculate Wilks' lambda for remaining functions
        // Lambda_k = Product(1/(1+lambda_i)) for i = k+1 to m
        let lambda_k = eigen_stats.eigenvalue
            .iter()
            .skip(k)
            .fold(1.0, |prod, &eigen| prod * (1.0 / (1.0 + eigen)));

        wilks_lambda.push(lambda_k);

        // Calculate chi-square approximation using Bartlett's formula
        // χ² = -[n - 1 - (p + g)/2] × ln(Λ)
        let chi_square_val = -(n - 1.0 - ((p + g) as f64) / 2.0) * lambda_k.ln();

        chi_square.push(chi_square_val);

        // Calculate degrees of freedom
        // df = (p-k)(g-k-1)
        let degrees_of_freedom = (p - (k as i32)) * (g - (k as i32) - 1);

        df.push(degrees_of_freedom);

        // Calculate p-value
        let p_value = calculate_p_value_from_chi_square(
            chi_square_val,
            degrees_of_freedom as usize
        );

        significance.push(p_value);
    }

    Ok(WilksLambdaTest {
        test_of_functions,
        wilks_lambda,
        chi_square,
        df,
        significance,
    })
}
