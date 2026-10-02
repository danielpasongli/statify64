//! Canonical discriminant functions calculation.
//!
//! This module implements the computation of canonical discriminant functions,
//! which are linear combinations of the original variables that maximize
//! the separation between groups.

use nalgebra::DMatrix;
use rayon::prelude::*;
use std::cell::RefCell;
use std::collections::HashMap;

use crate::models::{
    result::{CanonicalFunctions, EigenDescription, StepwiseStatistics},
    AnalysisData, DiscriminantConfig,
};

thread_local! {
    /// Per-analysis cache of the stepwise-selected variable list. The selection
    /// depends only on (data, config), which are fixed within a single
    /// `run_analysis`, so it is computed once and reused by every downstream
    /// routine (eigen / canonical / structure / wilks / casewise / classification
    /// / scatter / box_m / log_det). Cleared at the start of each analysis.
    static SELECTED_VARS_CACHE: RefCell<Option<Vec<String>>> = RefCell::new(None);
}

/// Clear the cached stepwise selection. Call at the start of every analysis.
pub fn clear_selected_vars_cache() {
    SELECTED_VARS_CACHE.with(|c| *c.borrow_mut() = None);
}

/// Prime the cache with an already-computed selection (e.g. from the single
/// stepwise run in `run_analysis`) so downstream routines never recompute it.
pub fn prime_selected_vars_cache(vars: Vec<String>) {
    SELECTED_VARS_CACHE.with(|c| *c.borrow_mut() = Some(vars));
}

/// Extract the final-step selected variables from a computed StepwiseStatistics.
/// Pure — shared by the cache primer and get_stepwise.
///
/// Returns an error when no variable met the entry criteria. Falling back to all
/// independent variables would silently turn a stepwise run into "enter
/// independents together" while the output is still read as a stepwise result.
pub fn select_final_variables(stats: &StepwiseStatistics) -> Result<Vec<String>, String> {
    let final_step = stats
        .variables_in_analysis
        .keys()
        .filter_map(|k| k.parse::<i32>().ok())
        .max()
        .unwrap_or(0)
        .to_string();

    let selected: Vec<String> = stats
        .variables_in_analysis
        .get(&final_step)
        .map(|vars_in_model| vars_in_model.iter().map(|v| v.variable.clone()).collect())
        .unwrap_or_default();

    if selected.is_empty() {
        return Err(
            "Stepwise selection: no variable met the entry criteria, so no discriminant function can be estimated."
                .to_string(),
        );
    }

    Ok(selected)
}

use super::core::{
    calculate_between_groups_sscp, calculate_pooled_within_matrix,
    calculate_pooled_within_matrix_no_epsilon, calculate_stepwise_statistics,
    extract_analyzed_dataset, is_rank_deficient, push_analysis_warning, AnalyzedDataset, EPSILON,
};

/// Eigenvalues of the canonical discriminant functions (Eigenvalues table).
///
/// With W = within-groups SSCP and B = between-groups SSCP of the model variables,
/// the functions are the solutions of
///
/// B v = λ W v,   λ₁ ≥ λ₂ ≥ … ,   m = min(g − 1, p) functions
///
/// % of variance        = 100 · λₖ / Σⱼ λⱼ
/// canonical correlation = √(λₖ / (1 + λₖ))
///
/// The eigenvectors are scaled so that vᵀ S v = 1 with S = W / (n − g), i.e. the
/// scores have unit pooled within-groups variance (unstandardized coefficients).
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// An EigenDescription containing eigenvalues, eigenvectors, and related statistics
pub fn calculate_eigen_statistics(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<EigenDescription, String> {
    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    // Exclude grouping variable from canonical function calculation
    let grouping_var = &config.main.grouping_variable;

    // If stepwise, only use variables selected by stepwise procedure
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

    // Calculate number of discriminant functions
    let num_functions = std::cmp::min(dataset.num_groups - 1, variables_to_use.len());

    if num_functions == 0 {
        return Err("Not enough groups or variables for canonical functions".to_string());
    }

    // Calculate pooled within-groups matrix
    let pooled_within = calculate_pooled_within_matrix(&dataset, &variables_to_use);

    // Calculate between-groups matrix (shared SSCP helper)
    let between_groups = calculate_between_groups_sscp(&dataset, &variables_to_use);

    // Within-groups SSCP: W = (n − g) · S_pooled.
    let df_within = dataset.total_cases - dataset.num_groups;
    let mut w_sscp = pooled_within.clone();
    for i in 0..w_sscp.nrows() {
        for j in 0..w_sscp.ncols(){
            w_sscp[(i,j)] *= df_within as f64;
        }
    }

    // A singular W is handled by the pseudo-inverse in solve_eigenvalue_problem, which
    // still returns functions; they then ignore the redundant direction(s), so the user
    // is told rather than shown ordinary-looking results.
    // Checked on the unregularized matrix: the EPSILON ridge in pooled_within would
    // otherwise lift a zero eigenvalue just enough to hide the singularity.
    if is_rank_deficient(&calculate_pooled_within_matrix_no_epsilon(&dataset, &variables_to_use)) {
        push_analysis_warning(
            "canonical_functions",
            format!(
                "The within-groups matrix of [{}] is singular (a predictor is a linear combination of the others). The discriminant functions were computed with a pseudo-inverse; remove the redundant predictor(s) for interpretable coefficients.",
                variables_to_use.join(", ")
            ),
        );
    }

    // Solved with the SSCP matrices W and B (neither divided by its df), so λ is the
    // eigenvalue of W⁻¹B that enters Wilks' lambda, Λ = Π 1 / (1 + λᵢ).
    let (eigenvalues, eigenvectors) =
        solve_eigenvalue_problem(&w_sscp, &between_groups, num_functions);

    // % of variance and cumulative %.
    let (variance_percentage, cumulative_percentage) = calculate_variance_percentages(&eigenvalues);

    // Canonical correlation rₖ = √(λₖ / (1 + λₖ)).
    let canonical_correlation: Vec<f64> = eigenvalues
        .iter()
        .map(|&eigen| {
            let corr = (eigen / (1.0 + eigen)).sqrt();
            if corr.is_nan() {
                0.0
            } else {
                corr
            }
        })
        .collect();

    // Scale the eigenvectors by sqrt(n-g) and flatten them for storage.
    // solve_eigenvalue_problem returns w with wᵀ·W·w = 1 (W = SSCP). Since
    // S_pooled = W/(n-g), the scaled vector satisfies wᵀ·S_pooled·w = 1, i.e. the
    // discriminant scores have unit pooled within-groups variance (SPSS
    // unstandardized coefficients).
    let scale_factor = (df_within as f64).sqrt();
    let flat_eigenvectors: Vec<f64> = eigenvectors
        .iter()
        .flat_map(|vec| vec.iter().map(|&v| v * scale_factor))
        .collect();

    // Create function names (Function 1, Function 2, etc.)
    let functions: Vec<String> = (1..=num_functions)
        .map(|i| format!("Function {}", i))
        .collect();

    Ok(EigenDescription {
        functions,
        eigenvalue: eigenvalues,
        eigenvector: flat_eigenvectors,
        variance_percentage,
        cumulative_percentage,
        canonical_correlation,
    })
}

/// Calculate canonical discriminant functions
///
/// Unstandardized and standardized coefficients of the canonical discriminant
/// functions and the function values at the group centroids (formulas in
/// `process_discriminant_coefficients` and `calculate_function_at_group_centroids`).
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A CanonicalFunctions object containing coefficients and function values
pub fn calculate_canonical_functions(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<CanonicalFunctions, String> {
    // First calculate the eigenvalues and eigenvectors
    let eigen_desc = calculate_eigen_statistics(data, config)?;

    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    // Use same variable filtering as calculate_eigen_statistics
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

    // Calculate number of discriminant functions
    let num_functions = std::cmp::min(dataset.num_groups - 1, variables_to_use.len());

    // Reshape the flat eigenvectors back to the original matrix form
    let num_variables = variables_to_use.len();
    let mut eigenvectors = Vec::with_capacity(num_variables);

    for i in 0..num_variables {
        let mut row = Vec::with_capacity(num_functions);
        for j in 0..num_functions {
            let index = i * num_functions + j;
            if index < eigen_desc.eigenvector.len() {
                row.push(eigen_desc.eigenvector[index]);
            } else {
                row.push(0.0); // Fill with zeros if we're out of bounds
            }
        }
        eigenvectors.push(row);
    }

    // Calculate pooled within-groups matrix (needed for coefficients)
    let pooled_within = calculate_pooled_within_matrix(&dataset, &variables_to_use);

    // Process coefficients, standardized coefficients, and constants
    let (coefficients, standardized_coefficients) = process_discriminant_coefficients(
        &eigenvectors,
        &variables_to_use,
        &pooled_within,
        &dataset.overall_means,
        num_functions,
    );

    // Calculate function at group centroids using the unstandardized coefficients
    let function_at_centroids = calculate_function_at_group_centroids(
        &dataset,
        &coefficients,
        &variables_to_use,
        num_functions,
    );

    // Row order for the coefficient tables. `variables_to_use` carries the stepwise
    // table's own order (most recently entered first), which is not the order SPSS
    // prints these two tables in — SPSS follows the analysis variable list. So order
    // by the user's independent-variable list, restricted to the variables that made
    // it into the final model.
    let variables: Vec<String> = config
        .main
        .independent_variables
        .iter()
        .filter(|v| *v != grouping_var && variables_to_use.contains(v))
        .cloned()
        .collect();

    // Return only the fields defined in the CanonicalFunctions struct from result.rs
    Ok(CanonicalFunctions {
        variables,
        coefficients,
        standardized_coefficients,
        function_at_centroids,
    })
}

/// Solve the eigenvalue problem for discriminant analysis
///
/// This function solves the generalized eigenvalue problem Bv = λWv (B = between-groups
/// SSCP, W = within-groups SSCP) to find the eigenvalues and eigenvectors that define
/// the discriminant functions. It is reduced to a symmetric problem via
/// W^(-1/2) B W^(-1/2), with W^(-1/2) formed as a pseudo-inverse square root.
///
/// # Parameters
/// * `pooled_within` - The within-groups SSCP matrix W = Σ(nᵢ-1)Sᵢ (NOT divided by n-g;
///   callers multiply the pooled covariance by n-g before passing it in)
/// * `between_groups` - The between-groups SSCP matrix B = Σ nᵢ(x̄ᵢ-x̄)(x̄ᵢ-x̄)ᵀ
/// * `num_functions` - The number of discriminant functions to calculate
///
/// # Returns
/// A tuple containing (eigenvalues sorted descending, eigenvectors w = W^(-1/2)u).
/// Eigenvectors are indexed [variable][function] and normalized so that wᵀ·W·w = 1.
pub fn solve_eigenvalue_problem(
    pooled_within: &DMatrix<f64>,
    between_groups: &DMatrix<f64>,
    num_functions: usize,
) -> (Vec<f64>, Vec<Vec<f64>>) {
    let n = pooled_within.nrows();

    // 1. W^(-1/2) from the symmetric eigen decomposition W = V D Vᵀ (defined for a
    //    singular W as well).
    let eigen_w = pooled_within.clone().symmetric_eigen();
    let d_w = eigen_w.eigenvalues;
    let v_w = eigen_w.eigenvectors;

    // Eigenvalues of W at or below EPSILON × the largest one count as zero
    // (pseudo-inverse). The threshold is relative so that it scales with the data (an
    // SSCP can reach 1e10 and more); the same rule as calculate_rank_and_log_det in
    // common.rs.
    let d_w_max = d_w.iter().fold(0.0_f64, |max, &v| max.max(v));
    let truncation_threshold = EPSILON * d_w_max;

    let mut d_w_inv_sqrt = DMatrix::zeros(n, n);
    for i in 0..n {
        if d_w_max > 0.0 && d_w[i] > truncation_threshold {
            d_w_inv_sqrt[(i, i)] = 1.0 / d_w[i].sqrt();
        } else {
            d_w_inv_sqrt[(i, i)] = 0.0; // null direction of W (pseudo-inverse)
        }
    }

    // W^(-1/2) = V D^(-1/2) Vᵀ
    let w_inv_sqrt = &v_w * &d_w_inv_sqrt * v_w.transpose();

    // 2. Symmetric form of W⁻¹B: M = W^(-1/2) B W^(-1/2).
    let transformed = &w_inv_sqrt * between_groups * &w_inv_sqrt;

    // 3. M u = λ u; M has the same eigenvalues as W⁻¹B.
    let eigen_b = transformed.symmetric_eigen();
    let eigenvalues_raw = eigen_b.eigenvalues;
    let eigenvectors_raw = eigen_b.eigenvectors;

    // Functions in order of eigenvalue, largest first.
    let mut indices: Vec<usize> = (0..n).collect();
    indices.sort_by(|&i, &j| {
        eigenvalues_raw[j]
            .partial_cmp(&eigenvalues_raw[i])
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut eigenvalues = Vec::with_capacity(num_functions);
    let mut eigenvectors: Vec<Vec<f64>> = vec![vec![0.0; num_functions]; n];

    let actual_functions = num_functions.min(n);

    for func_idx in 0..actual_functions {
        let orig_idx = indices[func_idx];
        eigenvalues.push(eigenvalues_raw[orig_idx]);

        // Eigenvector u of M for this function.
        let transformed_v = eigenvectors_raw.column(orig_idx);

        // Back to the variable space: w = W^(-1/2) u, so that wᵀ W w = 1.
        let original_v = &w_inv_sqrt * transformed_v;

        for var_idx in 0..n {
            eigenvectors[var_idx][func_idx] = original_v[var_idx];
        }
    }

    (eigenvalues, eigenvectors)
}

/// Unstandardized and standardized canonical discriminant function coefficients.
///
/// aᵢₖ  = eigenvector element (variable i, function k), scaled so that aₖᵀ S aₖ = 1
/// a*ᵢₖ = aᵢₖ · √sᵢᵢ        (standardized; sᵢᵢ = pooled within-groups variance of i)
/// a₀ₖ  = −Σᵢ aᵢₖ · x̄ᵢ      (constant; x̄ᵢ = overall mean of i)
///
/// Standardizing makes the coefficients comparable across variables with different scales.
///
/// # Parameters
/// * `eigenvectors` - Eigenvectors already scaled by sqrt(n-g) (wᵀ·S_pooled·w = 1),
///   indexed [variable][function]; used directly as the unstandardized coefficients
/// * `variables` - Variables in the model
/// * `pooled_within` - Pooled within-groups covariance matrix
/// * `overall_means` - Overall means for each variable
/// * `num_functions` - Number of discriminant functions
///
/// # Returns
/// A tuple of (unstandardized coefficients, standardized coefficients)
pub fn process_discriminant_coefficients(
    eigenvectors: &[Vec<f64>],
    variables: &[String],
    pooled_within: &DMatrix<f64>,
    overall_means: &HashMap<String, f64>,
    num_functions: usize,
) -> (HashMap<String, Vec<f64>>, HashMap<String, Vec<f64>>) {
    let num_vars = variables.len();

    // Extract standard deviations from pooled within-groups covariance matrix diagonal
    // Standardized coefficient = Unstandardized × Pooled_StD
    let std_devs: Vec<f64> = (0..num_vars)
        .map(|i| pooled_within[(i, i)].sqrt())
        .collect();

    // Unstandardized coefficients
    let mut coefficients: HashMap<String, Vec<f64>> = variables
        .iter()
        .enumerate()
        .map(|(var_idx, var)| {
            let coef_values: Vec<f64> = (0..num_functions)
                .map(|func_idx| {
                    if var_idx < eigenvectors.len() && func_idx < eigenvectors[var_idx].len() {
                        eigenvectors[var_idx][func_idx]
                    } else {
                        0.0
                    }
                })
                .collect();
            (var.clone(), coef_values)
        })
        .collect();

    // Standardized coefficients = Unstandardized × Pooled_Within_StD
    // This follows SPSS convention for standardized canonical discriminant function coefficients
    let standardized_coefficients: HashMap<String, Vec<f64>> = variables
        .iter()
        .enumerate()
        .map(|(var_idx, var)| {
            let std_dev = if var_idx < std_devs.len() {
                std_devs[var_idx]
            } else {
                1.0
            };
            let std_coef_values: Vec<f64> = (0..num_functions)
                .map(|func_idx| {
                    if var_idx < eigenvectors.len()
                        && func_idx < eigenvectors[var_idx].len()
                        && std_dev > EPSILON
                    {
                        eigenvectors[var_idx][func_idx] * std_dev
                    } else {
                        0.0
                    }
                })
                .collect();
            (var.clone(), std_coef_values)
        })
        .collect();

    // Calculate constants for each function
    // Constant = -Σ(coef × mean) for each function
    let mut constants = Vec::with_capacity(num_functions);

    for func_idx in 0..num_functions {
        let constant = variables.iter().fold(0.0, |acc, var| {
            if let Some(coef_values) = coefficients.get(var) {
                if func_idx < coef_values.len() {
                    let coef = coef_values[func_idx];
                    let mean = overall_means.get(var).copied().unwrap_or(0.0);
                    acc - coef * mean
                } else {
                    acc
                }
            } else {
                acc
            }
        });
        constants.push(constant);
    }

    // Add constants to the coefficients map
    coefficients.insert("(Constant)".to_string(), constants);

    (coefficients, standardized_coefficients)
}

/// Get variables selected by stepwise procedure
///
/// This function retrieves the variables selected by the stepwise procedure.
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A vector of selected variable names
pub fn get_stepwise_selected_variables(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<Vec<String>, String> {
    let grouping_var = &config.main.grouping_variable;

    // Non-stepwise: all independent variables (cheap, no caching needed).
    if !config.main.stepwise {
        return Ok(config
            .main
            .independent_variables
            .iter()
            .filter(|v| *v != grouping_var)
            .cloned()
            .collect());
    }

    // Reuse the per-analysis cached selection if available — this is what avoids
    // re-running the entire stepwise procedure for every downstream routine.
    if let Some(cached) = SELECTED_VARS_CACHE.with(|c| c.borrow().clone()) {
        return Ok(cached);
    }

    // Cache miss: compute the stepwise selection once, then store it. A failed
    // stepwise run is an error, never a silent fallback to all variables (which
    // would be the "enter" method presented as a stepwise result).
    let stats = calculate_stepwise_statistics(data, config)
        .map_err(|e| format!("Stepwise selection failed: {}", e))?;
    let selected = select_final_variables(&stats)?;
    prime_selected_vars_cache(selected.clone());
    Ok(selected)
}

/// Calculate function values at group centroids
///
/// This function evaluates the discriminant functions at the centroid
/// (mean) of each group.
///
/// The unstandardized discriminant function for function k evaluated at group g is:
///   D_gk = constant_k + Σ(a_ik * x̄_gi)
/// where a_ik are the unstandardized coefficients and x̄_gi are group means.
///
/// # Parameters
/// * `dataset` - The analyzed dataset
/// * `coefficients` - Unstandardized coefficients HashMap (variable -> [coef per function])
/// * `variables` - Variables in the model
/// * `num_functions` - Number of discriminant functions
///
/// # Returns
/// A hashmap of group names to function values
pub fn calculate_function_at_group_centroids(
    dataset: &AnalyzedDataset,
    coefficients: &HashMap<String, Vec<f64>>,
    variables: &[String],
    num_functions: usize,
) -> HashMap<String, Vec<f64>> {
    let mut function_at_centroids = HashMap::new();

    // Get constants from the coefficients map (stored under "(Constant)")
    let constants: Vec<f64> = coefficients
        .get("(Constant)")
        .cloned()
        .unwrap_or_else(|| vec![0.0; num_functions]);

    // Process each group in parallel
    let results: Vec<(String, Vec<f64>)> = dataset
        .group_labels
        .par_iter()
        .map(|group| {
            let mut centroid_values = vec![0.0; num_functions];

            for func_idx in 0..num_functions {
                // Start with the constant
                let mut value = if func_idx < constants.len() {
                    constants[func_idx]
                } else {
                    0.0
                };

                // Add coefficient * group_mean for each variable
                for (_var_idx, variable) in variables.iter().enumerate() {
                    if let Some(coef_values) = coefficients.get(variable) {
                        if func_idx < coef_values.len() {
                            if let Some(group_mean) =
                                dataset.group_means.get(group).and_then(|m| m.get(variable))
                            {
                                value += coef_values[func_idx] * group_mean;
                            }
                        }
                    }
                }

                centroid_values[func_idx] = value;
            }

            (group.clone(), centroid_values)
        })
        .collect();

    // Combine results
    for (group, values) in results {
        function_at_centroids.insert(group, values);
    }

    function_at_centroids
}

/// Percentage of variance explained by each discriminant function, and the cumulative
/// percentage:
///
/// %ₖ = 100 · λₖ / Σⱼ λⱼ,   cumulative %ₖ = Σⱼ≤ₖ %ⱼ
///
/// Equal shares when Σλ ≤ EPSILON.
///
/// # Parameters
/// * `eigenvalues` - Eigenvalues from the eigenvalue problem
///
/// # Returns
/// A tuple of (variance percentages, cumulative percentages)
pub fn calculate_variance_percentages(eigenvalues: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let total_eigenvalue: f64 = eigenvalues.iter().sum();

    let variance_percentage: Vec<f64> = if total_eigenvalue > EPSILON {
        eigenvalues
            .iter()
            .map(|&eigen| (100.0 * eigen) / total_eigenvalue)
            .collect()
    } else {
        vec![100.0 / eigenvalues.len() as f64; eigenvalues.len()]
    };

    let mut cumulative_percentage = Vec::with_capacity(eigenvalues.len());
    let mut cumsum = 0.0;
    for percent in &variance_percentage {
        cumsum += percent;
        cumulative_percentage.push(cumsum);
    }

    (variance_percentage, cumulative_percentage)
}
