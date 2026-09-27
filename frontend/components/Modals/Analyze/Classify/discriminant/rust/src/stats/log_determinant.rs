use std::collections::HashMap;

use nalgebra::DMatrix;

use crate::models::{ result::LogDeterminants, AnalysisData, DiscriminantConfig };

use super::core::{
    AnalyzedDataset,
    calculate_covariance,
    calculate_rank_and_log_det,
    extract_analyzed_dataset,
    get_stepwise_selected_variables,
};
use super::matrix_calculation::calculate_pooled_within_matrix_no_epsilon;

/// Calculate log determinants of covariance matrices
///
/// This function calculates the logarithm of determinants for each group's
/// covariance matrix and the pooled covariance matrix as required for Box's M test.
///
/// Box's M test uses these log determinants to test the homogeneity of
/// covariance matrices across groups, which is an assumption in discriminant analysis.
///
/// Each value is ln|S| = Σ ln σᵢ over the singular values σᵢ above EPSILON × the
/// largest, and the rank printed beside it is the number of those σᵢ (see
/// `calculate_rank_and_log_det`).
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A LogDeterminants object with log determinants for each group and pooled matrix
pub fn calculate_log_determinants(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<LogDeterminants, String> {
    crate::debug_log!("Executing calculate_log_determinants");

    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    // Determine variables to use: stepwise-selected or all (enter)
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

    crate::debug_log!("Log Determinants: using {} variables: {:?}",
        variables.len(),
        variables);

    // Add explanatory note based on Box's M documentation
    let note =
        "Note: Log determinants are used in Box's M test to evaluate the homogeneity of covariance matrices. \
                The test compares individual group determinants with the pooled determinant.".to_string();

    Ok(log_determinants_for(&dataset, &variables, note))
}

/// Log Determinants table on `variables` of an already-extracted dataset.
///
/// Split out of `calculate_log_determinants` so Separate-groups classification can
/// report the same table for the canonical discriminant function scores.
pub fn log_determinants_for(
    dataset: &AnalyzedDataset,
    variables: &[String],
    note: String,
) -> LogDeterminants {
    let mut groups = Vec::new();
    let mut ranks = Vec::new();
    let mut log_determinants = Vec::new();

    // Process each group
    for group in &dataset.group_labels {
        // Create a single-group subset for analysis
        let _single_group_vars: Vec<String> = vec![group.clone()];

        // Get variables values for this group
        let mut group_data = HashMap::new();
        for var in variables {
            if let Some(group_values) = dataset.group_data.get(var.as_str()).and_then(|g| g.get(group)) {
                if group_values.len() > 1 {
                    // We only need values for one group to construct its covariance matrix
                    let mut var_data = HashMap::new();
                    var_data.insert(group.clone(), group_values.clone());
                    group_data.insert(var.clone(), var_data);
                }
            }
        }

        let group_size = dataset.group_data
            .get(&variables[0])
            .and_then(|g| g.get(group))
            .map_or(0, |v| v.len());

        if group_size <= 1 {
            continue; // Skip groups with insufficient data
        }

        // Build covariance matrix for this group
        let mut cov_matrix = DMatrix::zeros(variables.len(), variables.len());

        for (i, var_i) in variables.iter().enumerate() {
            for (j, var_j) in variables.iter().enumerate() {
                if
                    let (Some(values_i), Some(values_j)) = (
                        dataset.group_data.get(var_i.as_str()).and_then(|g| g.get(group)),
                        dataset.group_data.get(var_j.as_str()).and_then(|g| g.get(group)),
                    )
                {
                    if values_i.len() > 1 && values_i.len() == values_j.len() {
                        let mean_i = dataset.group_means[group][var_i];
                        let mean_j = dataset.group_means[group][var_j];

                        let cov = calculate_covariance(
                            values_i,
                            values_j,
                            Some(mean_i),
                            Some(mean_j)
                        );

                        cov_matrix[(i, j)] = cov;
                    }
                }
            }
        }

        // Calculate rank and log determinant
        let (rank, log_det) = calculate_rank_and_log_det(&cov_matrix);

        groups.push(group.clone());
        ranks.push(rank);
        log_determinants.push(log_det);
    }

    // Calculate pooled within-groups covariance matrix (no EPSILON — must match Box's M)
    let pooled_cov = calculate_pooled_within_matrix_no_epsilon(dataset, variables);

    // Calculate rank and log determinant of pooled matrix
    let (rank_pooled, pooled_log_det) = calculate_rank_and_log_det(&pooled_cov);

    crate::debug_log!("Log Determinants Result: groups={:?}, ranks={:?}, log_dets={:?}, pooled_rank={}, pooled_log_det={}",
        groups, ranks, log_determinants, rank_pooled, pooled_log_det);

    LogDeterminants {
        groups,
        ranks,
        log_determinants,
        rank_pooled,
        pooled_log_determinant: pooled_log_det,
        note,
        debug_variables: variables.to_vec(),
    }
}
