use crate::models::{ result::EqualityTests, AnalysisData, DiscriminantConfig };
use rayon::prelude::*;

use super::core::{ calculate_p_value_from_f, calculate_univariate_f, extract_analyzed_dataset };

/// Calculate equality tests for discriminant analysis
///
/// This function performs univariate ANOVAs to test the equality of group means
/// for each independent variable: Wilks' lambda and F from `calculate_univariate_f`,
/// Sig. = P(F(g − 1, n − g) > F).
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// An EqualityTests object with test statistics for each variable
pub fn calculate_equality_tests(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<EqualityTests, String> {
    crate::debug_log!("Executing calculate_equality_tests");

    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;
    let variables = &config.main.independent_variables;

    let mut variables_out = Vec::with_capacity(variables.len());
    let mut wilks_lambda = Vec::with_capacity(variables.len());
    let mut f_values = Vec::with_capacity(variables.len());
    let mut df1 = Vec::with_capacity(variables.len());
    let mut df2 = Vec::with_capacity(variables.len());
    let mut significance = Vec::with_capacity(variables.len());

    // Calculate equality tests for each variable in parallel
    let results: Vec<(String, f64, f64, f64)> = variables
        .par_iter()
        .map(|var| {
            // Use univariate F test for each variable
            let (f_value, wilks) = calculate_univariate_f(var, &dataset);

            // Calculate p-value
            let p_value = calculate_p_value_from_f(
                f_value,
                (dataset.num_groups - 1) as f64,
                (dataset.total_cases - dataset.num_groups) as f64
            );

            (var.clone(), wilks, f_value, p_value)
        })
        .collect();

    // Populate the output vectors
    for (var, wilks, f_value, p_value) in results {
        variables_out.push(var);
        wilks_lambda.push(wilks);
        f_values.push(f_value);
        df1.push((dataset.num_groups - 1) as i32);
        df2.push((dataset.total_cases - dataset.num_groups) as i32);
        significance.push(p_value);
    }

    Ok(EqualityTests {
        variables: variables_out,
        wilks_lambda,
        f_values,
        df1,
        df2,
        significance,
    })
}
