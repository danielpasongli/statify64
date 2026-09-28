use std::collections::HashMap;

use crate::models::{result::StructureMatrix, AnalysisData, DiscriminantConfig};

use super::core::{
    calculate_canonical_functions, calculate_pooled_within_matrix_no_epsilon,
    extract_analyzed_dataset, EPSILON,
};

/// Structure Matrix: pooled within-groups correlation between each predictor Xᵢ and
/// each discriminant function Zₘ = Σₖ bₖₘ Xₖ (structure loadings):
///
/// rᵢₘ = Cov(Xᵢ, Zₘ) / (sᵢ · s_Zₘ) = Σₖ Sᵢₖ bₖₘ / √Sᵢᵢ
///
/// S = pooled within-groups covariance matrix, bₖₘ = unstandardized coefficient of Xₖ
/// in Zₘ (the sum runs over the model variables). s_Zₘ = 1 because the coefficients
/// satisfy bₘᵀ S bₘ = 1.
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A StructureMatrix object with correlations between variables and functions
pub fn calculate_structure_matrix(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<StructureMatrix, String> {
    crate::debug_log!("Executing calculate_structure_matrix");

    // Every predictor except the grouping variable gets a row, as in SPSS: also those
    // a stepwise method left out of the model.
    let grouping_var = &config.main.grouping_variable;
    let all_variables: Vec<String> = config
        .main
        .independent_variables
        .iter()
        .filter(|v| *v != grouping_var)
        .cloned()
        .collect();

    if all_variables.is_empty() {
        return Err("No independent variables found after filtering grouping variable.".into());
    }

    let canonical_functions = calculate_canonical_functions(data, config)?;
    let num_functions = canonical_functions
        .coefficients
        .get("(Constant)")
        .map_or(0, |v| v.len());

    if num_functions == 0 {
        return Ok(StructureMatrix {
            variables: all_variables.clone(),
            correlations: HashMap::new(),
        });
    }

    let dataset = extract_analyzed_dataset(data, config)?;

    // Pooled within-groups covariance S of all predictors (without the EPSILON ridge).
    let s_pooled = calculate_pooled_within_matrix_no_epsilon(&dataset, &all_variables);
    let num_all_vars = all_variables.len();

    let mut correlations = HashMap::new();

    // Structure loadings.
    for i in 0..num_all_vars {
        // sᵢ = √Sᵢᵢ, the pooled within-groups standard deviation of Xᵢ.
        let std_dev_i = s_pooled[(i, i)].sqrt();
        let mut var_correlations = Vec::with_capacity(num_functions);

        for m in 0..num_functions {
            let mut cov_xz = 0.0;

            // Cov(Xᵢ, Zₘ) = Σₖ Sᵢₖ bₖₘ, summed
            // in variable order: iterating the coefficient map would sum in hash order,
            // which differs between builds and moves the last bit of the result.
            for (k, var_k_name) in all_variables.iter().enumerate() {
                if let Some(coefs) = canonical_functions.coefficients.get(var_k_name) {
                    if m < coefs.len() {
                        // S_pooled[i][k] * b_k[m]
                        cov_xz += s_pooled[(i, k)] * coefs[m];
                    }
                }
            }

            // rᵢₘ = Cov(Xᵢ, Zₘ) / (sᵢ · s_Zₘ). The unstandardized coefficients satisfy
            // bₘᵀ S bₘ = 1, so the pooled within-groups variance of Zₘ is 1 and s_Zₘ = 1.
            let loading = if std_dev_i > EPSILON {
                cov_xz / std_dev_i
            } else {
                0.0
            };

            var_correlations.push(loading);
        }

        correlations.insert(all_variables[i].clone(), var_correlations);
    }

    Ok(StructureMatrix {
        variables: all_variables,
        correlations,
    })
}
