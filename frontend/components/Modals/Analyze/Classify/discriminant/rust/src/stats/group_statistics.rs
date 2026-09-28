use std::collections::HashMap;
use rayon::prelude::*;

use crate::models::{ result::GroupStatistics, AnalysisData, DiscriminantConfig };
use super::core::{ extract_analyzed_dataset, calculate_std_dev };

/// Group Statistics table, per group and for all groups together ("Total"):
///
/// mean x̄ = Σx / n,   standard deviation s = √[Σ(x − x̄)² / (n − 1)]
///
/// and the valid N (unweighted and weighted, equal because no case weights are
/// applied). Means and standard deviations are filled only with Statistics → Means;
/// the valid N always.
pub fn calculate_group_statistics(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<GroupStatistics, String> {
    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;
    let independent_variables = &config.main.independent_variables;

    let mut result = GroupStatistics {
        groups: Vec::new(),
        variables: independent_variables.clone(),
        means: HashMap::new(),
        std_deviations: HashMap::new(),
        unweighted_n: HashMap::new(),
        weighted_n: HashMap::new(),
    };

    // Calculate "Total" group statistics for all variables
    let mut total_values = HashMap::new();
    for variable in independent_variables {
        let mut all_values = Vec::new();
        for group in &dataset.group_labels {
            if let Some(values) = dataset.group_data.get(variable).and_then(|g| g.get(group)) {
                all_values.extend(values.clone());
            }
        }
        total_values.insert(variable.clone(), all_values);
    }

    // Initialize mean, std_dev, and count maps
    for variable in independent_variables {
        result.means.insert(variable.clone(), Vec::new());
        result.std_deviations.insert(variable.clone(), Vec::new());
        result.unweighted_n.insert(variable.clone(), Vec::new());
        result.weighted_n.insert(variable.clone(), Vec::new());
    }

    // Add "Total" group
    let mut unique_groups = vec!["Total".to_string()];
    unique_groups.extend(dataset.group_labels.clone());
    result.groups = unique_groups;

    // Calculate statistics for each group and variable in parallel
    let statistics: Vec<(String, Vec<(String, f64, f64, f64, f64)>)> = result.groups
        .par_iter()
        .map(|group| {
            let var_stats = independent_variables
                .par_iter()
                .map(|variable| {
                    // Create a static empty Vec that can be referenced safely
                    let empty_vec: Vec<f64> = Vec::new();

                    let values = if group == "Total" {
                        total_values.get(variable).unwrap_or(&empty_vec)
                    } else {
                        dataset.group_data
                            .get(variable)
                            .and_then(|g| g.get(group))
                            .unwrap_or(&empty_vec)
                    };

                    if values.is_empty() {
                        (variable.clone(), 0.0, 0.0, 0.0, 0.0)
                    } else {
                        let mean = values.iter().sum::<f64>() / (values.len() as f64);
                        let std_dev = calculate_std_dev(values, Some(mean));
                        let count = values.len() as f64;
                        // In this implementation, unweighted_n and weighted_n are the same
                        // since we're not applying any weights to the data
                        (variable.clone(), mean, std_dev, count, count)
                    }
                })
                .collect();

            (group.clone(), var_stats)
        })
        .collect();

    // Combine results — always populate N counts regardless of means flag
    // Group Statistics table always shows Valid N, even when Means option is off
    let has_means = config.statistics.means;
    for (_group_idx, (_group, var_stats)) in statistics.iter().enumerate() {
        for (variable, mean, std_dev, unweighted, weighted) in var_stats {
            if has_means {
                result.means.get_mut(variable).unwrap().push(*mean);
                result.std_deviations.get_mut(variable).unwrap().push(*std_dev);
            }
            // N counts are always populated — they are independent of the Means statistic option
            result.unweighted_n.get_mut(variable).unwrap().push(*unweighted);
            result.weighted_n.get_mut(variable).unwrap().push(*weighted);
        }
    }

    Ok(result)
}
