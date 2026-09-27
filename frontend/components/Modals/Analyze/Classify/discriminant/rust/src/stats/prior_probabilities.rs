use std::collections::HashMap;

use crate::models::{ result::PriorProbabilities, AnalysisData, DiscriminantConfig };

use super::core::extract_analyzed_dataset;

/// Calculate prior probabilities for discriminant analysis
///
/// Prior probability of each group k:
///
/// πₖ = 1 / g          (All groups equal)
/// πₖ = nₖ / n         (Compute from group sizes; equal priors when n = 0)
///
/// # Parameters
/// * `data` - The analysis data
/// * `config` - The discriminant analysis configuration
///
/// # Returns
/// A PriorProbabilities object with prior probabilities for each group
pub fn calculate_prior_probabilities(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<PriorProbabilities, String> {
    crate::debug_log!("Executing calculate_prior_probabilities");

    // Extract analyzed dataset
    let dataset = extract_analyzed_dataset(data, config)?;

    let num_groups = dataset.group_labels.len();
    let mut groups = Vec::with_capacity(num_groups);
    let mut prior_probabilities = Vec::with_capacity(num_groups);
    let mut cases_used = HashMap::new();

    // Count cases in each group
    let mut total_cases = 0;
    let mut group_sizes = Vec::with_capacity(num_groups);

    for group in dataset.group_labels.iter() {
        let group_size = dataset.group_data
            .get(dataset.group_data.keys().next().unwrap_or(&String::new()))
            .and_then(|g| g.get(group))
            .map_or(0, |v| v.len());

        total_cases += group_size;
        group_sizes.push(group_size);
        // Use the actual group value (e.g. "1", "2") so the output matches SPSS.
        groups.push(group.clone());
    }

    // Calculate prior probabilities
    if config.classify.all_group_equal {
        // Equal priors
        for _ in 0..num_groups {
            prior_probabilities.push(1.0 / (num_groups as f64));
        }
    } else if config.classify.group_size {
        // Priors based on group sizes
        if total_cases > 0 {
            for size in &group_sizes {
                prior_probabilities.push((*size as f64) / (total_cases as f64));
            }
        } else {
            // Fallback to equal priors if no cases
            for _ in 0..num_groups {
                prior_probabilities.push(1.0 / (num_groups as f64));
            }
        }
    } else {
        // Default to equal priors
        for _ in 0..num_groups {
            prior_probabilities.push(1.0 / (num_groups as f64));
        }
    }

    // Populate "Cases Used in Analysis". Without case weighting, the weighted
    // count equals the unweighted count (n_g). Keys must match the
    // "Unweighted"/"Weighted" columns rendered in the output table.
    cases_used.insert("Unweighted".to_string(), group_sizes.clone());
    cases_used.insert("Weighted".to_string(), group_sizes);

    Ok(PriorProbabilities {
        groups,
        prior_probabilities,
        cases_used,
        total: total_cases as f64,
    })
}
