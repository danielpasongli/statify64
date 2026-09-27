use std::{cmp::Ordering, collections::HashMap};

use crate::models::{config::KnnConfig, data::DataValue};

/// Breaks ties in the neighbor majority vote the way SPSS KNN does: among the
/// categories with the highest vote, choose the one with the most cases in the
/// training set; if that is still tied, choose the smallest data value
/// (ascending numeric order for numbers, lexical order otherwise).
#[derive(Clone, Debug, Default)]
pub struct CategoryTieBreaker {
    training_counts: HashMap<String, usize>,
}

impl CategoryTieBreaker {
    pub fn from_training(target_values: &[DataValue], training_indices: &[usize]) -> Self {
        let mut training_counts = HashMap::new();
        for &idx in training_indices {
            if let Some(key) = category_key(target_values.get(idx)) {
                *training_counts.entry(key).or_insert(0) += 1;
            }
        }
        Self { training_counts }
    }

    fn training_count(&self, key: &str) -> usize {
        self.training_counts.get(key).copied().unwrap_or(0)
    }

    /// Returns `Ordering::Greater` when `left` should win over `right`.
    fn compare(&self, left: (&str, f64), right: (&str, f64)) -> Ordering {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| self.training_count(left.0).cmp(&self.training_count(right.0)))
            .then_with(|| compare_category_values(right.0, left.0))
    }

    pub fn pick<I>(&self, probabilities: I) -> Option<String>
    where
        I: IntoIterator<Item = (String, f64)>,
    {
        probabilities
            .into_iter()
            .max_by(|left, right| self.compare((&left.0, left.1), (&right.0, right.1)))
            .map(|(key, _)| key)
    }
}

/// Orders category keys by their data value: numerically when both keys are
/// numbers, lexically otherwise.
fn compare_category_values(left: &str, right: &str) -> Ordering {
    match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left_number), Ok(right_number)) => left_number
            .partial_cmp(&right_number)
            .unwrap_or(Ordering::Equal),
        _ => left.cmp(right),
    }
}

pub fn calculate_predictions(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
    config: &KnnConfig,
    target_is_categorical: bool,
    tie_breaker: &CategoryTieBreaker,
) -> DataValue {
    let first_value = neighbors
        .first()
        .and_then(|&(idx, _)| target_values.get(idx));

    if target_is_categorical
        || matches!(
            first_value,
            Some(DataValue::Text(_) | DataValue::Boolean(_))
        )
    {
        return calculate_categorical_prediction(neighbors, target_values, tie_breaker);
    }

    if matches!(first_value, Some(DataValue::Number(_))) {
        if config.neighbors.predictions_median {
            return calculate_median_prediction(neighbors, target_values);
        }

        return calculate_mean_prediction(neighbors, target_values);
    }

    DataValue::Null
}

pub fn calculate_categorical_prediction(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
    tie_breaker: &CategoryTieBreaker,
) -> DataValue {
    let probabilities = calculate_categorical_vote_probabilities(neighbors, target_values);

    tie_breaker
        .pick(probabilities)
        .map(|key| data_value_from_category_key(&key, target_values))
        .unwrap_or(DataValue::Null)
}

pub fn calculate_categorical_probabilities(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
    categories: &[String],
) -> Vec<(String, f64)> {
    if categories.is_empty() {
        return Vec::new();
    }

    let mut counts: HashMap<String, usize> = categories
        .iter()
        .map(|category| (category.clone(), 0))
        .collect();

    for &(idx, _) in neighbors {
        if idx >= target_values.len() {
            continue;
        }

        let Some(key) = category_key(target_values.get(idx)) else {
            continue;
        };

        if let Some(count) = counts.get_mut(&key) {
            *count += 1;
        }
    }

    let neighbor_count = counts.values().sum::<usize>();
    if neighbor_count == 0 {
        return categories
            .iter()
            .map(|category| (category.clone(), 0.0))
            .collect();
    }

    let denominator = (neighbor_count + categories.len()) as f64;
    categories
        .iter()
        .map(|category| {
            let count = counts.get(category).copied().unwrap_or(0) as f64;
            (category.clone(), (count + 1.0) / denominator)
        })
        .collect()
}

pub fn calculate_categorical_vote_probabilities(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
) -> Vec<(String, f64)> {
    let categories = sorted_target_categories(target_values);
    if categories.is_empty() {
        return Vec::new();
    }

    let mut votes: HashMap<String, f64> = categories
        .iter()
        .map(|category| (category.clone(), 0.0))
        .collect();

    for &(idx, _) in neighbors {
        if idx >= target_values.len() {
            continue;
        }

        let Some(key) = category_key(target_values.get(idx)) else {
            continue;
        };

        *votes.entry(key).or_insert(0.0) += 1.0;
    }

    let total_votes = votes.values().sum::<f64>();
    if total_votes <= f64::EPSILON {
        categories
            .into_iter()
            .map(|category| (category, 0.0))
            .collect()
    } else {
        categories
            .into_iter()
            .map(|category| {
                let vote = votes.get(&category).copied().unwrap_or(0.0);
                (category, vote / total_votes)
            })
            .collect()
    }
}

pub fn sorted_target_categories(target_values: &[DataValue]) -> Vec<String> {
    let mut categories: Vec<String> = target_values
        .iter()
        .filter_map(|value| category_key(Some(value)))
        .collect();
    categories.sort();
    categories.dedup();
    categories
}

pub fn sorted_target_categories_for_indices(
    target_values: &[DataValue],
    indices: &[usize],
) -> Vec<String> {
    let mut categories: Vec<String> = indices
        .iter()
        .filter_map(|&idx| target_values.get(idx))
        .filter_map(|value| category_key(Some(value)))
        .collect();
    categories.sort();
    categories.dedup();
    categories
}

pub fn category_key(value: Option<&DataValue>) -> Option<String> {
    match value {
        Some(DataValue::Text(text)) if !text.trim().is_empty() => Some(text.clone()),
        Some(DataValue::Boolean(value)) => Some(value.to_string()),
        Some(DataValue::Number(value)) if value.is_finite() => Some(value.to_string()),
        _ => None,
    }
}

fn data_value_from_category_key(key: &str, target_values: &[DataValue]) -> DataValue {
    if let Some(value) = target_values
        .iter()
        .find(|value| category_key(Some(value)).as_deref() == Some(key))
    {
        return value.clone();
    }

    if key.eq_ignore_ascii_case("true") {
        DataValue::Boolean(true)
    } else if key.eq_ignore_ascii_case("false") {
        DataValue::Boolean(false)
    } else {
        DataValue::Text(key.to_string())
    }
}

pub fn calculate_mean_prediction(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
) -> DataValue {
    let mut sum = 0.0;
    let mut count = 0;

    for &(idx, _) in neighbors {
        if idx >= target_values.len() {
            continue;
        }

        if let DataValue::Number(val) = target_values[idx] {
            sum += val;
            count += 1;
        }
    }

    if count > 0 {
        DataValue::Number(sum / (count as f64))
    } else {
        DataValue::Null
    }
}

pub fn calculate_median_prediction(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
) -> DataValue {
    let mut values: Vec<f64> = neighbors
        .iter()
        .filter_map(|&(idx, _)| {
            if idx < target_values.len() {
                match target_values[idx] {
                    DataValue::Number(val) => Some(val),
                    _ => None,
                }
            } else {
                None
            }
        })
        .collect();

    if values.is_empty() {
        return DataValue::Null;
    }

    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));

    let n = values.len();
    if n % 2 == 1 {
        DataValue::Number(values[n / 2])
    } else {
        DataValue::Number((values[n / 2 - 1] + values[n / 2]) / 2.0)
    }
}

#[cfg(test)]
mod tests {
    use crate::models::data::DataValue;

    use super::{
        calculate_categorical_prediction, calculate_categorical_probabilities,
        calculate_categorical_vote_probabilities, calculate_mean_prediction,
        calculate_median_prediction, calculate_predictions, sorted_target_categories_for_indices,
        CategoryTieBreaker,
    };

    fn all_training(targets: &[DataValue]) -> CategoryTieBreaker {
        let indices = (0..targets.len()).collect::<Vec<_>>();
        CategoryTieBreaker::from_training(targets, &indices)
    }

    #[test]
    fn categorical_prediction_uses_majority_vote() {
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let neighbors = vec![(0, 0.1), (1, 10.0), (2, 11.0)];

        assert!(matches!(
            calculate_categorical_prediction(&neighbors, &targets, &all_training(&targets)),
            DataValue::Text(value) if value == "B"
        ));
    }

    #[test]
    fn tie_breaking_uses_smallest_value_when_training_counts_are_equal() {
        let targets = vec![
            DataValue::Text("B".to_string()),
            DataValue::Text("A".to_string()),
        ];
        let neighbors = vec![(0, 1.0), (1, 1.0)];

        assert!(matches!(
            calculate_categorical_prediction(&neighbors, &targets, &all_training(&targets)),
            DataValue::Text(value) if value == "A"
        ));
    }

    #[test]
    fn tie_breaking_prefers_category_with_most_training_cases() {
        // "B" has more training cases than "A", so it wins a 1–1 vote tie
        // even though "A" is lexically smaller.
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let neighbors = vec![(0, 1.0), (1, 1.0)];

        assert!(matches!(
            calculate_categorical_prediction(&neighbors, &targets, &all_training(&targets)),
            DataValue::Text(value) if value == "B"
        ));
    }

    #[test]
    fn tie_breaking_counts_only_training_cases() {
        // Case 2 ("B") is a holdout case and must not count toward the prior.
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let tie_breaker = CategoryTieBreaker::from_training(&targets, &[0, 1]);

        assert!(matches!(
            calculate_categorical_prediction(&[(0, 1.0), (1, 1.0)], &targets, &tie_breaker),
            DataValue::Text(value) if value == "A"
        ));
    }

    #[test]
    fn tie_breaking_orders_numeric_categories_numerically() {
        // Lexically "10" < "2", but SPSS uses ascending numeric order.
        let targets = vec![DataValue::Number(10.0), DataValue::Number(2.0)];
        let neighbors = vec![(0, 1.0), (1, 1.0)];

        assert!(matches!(
            calculate_categorical_prediction(&neighbors, &targets, &all_training(&targets)),
            DataValue::Number(value) if (value - 2.0).abs() < f64::EPSILON
        ));
    }

    #[test]
    fn categorical_probabilities_sum_to_one() {
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let training_indices = vec![0, 1, 2];
        let categories = sorted_target_categories_for_indices(&targets, &training_indices);
        let neighbors = vec![(0, 1.0), (1, 2.0), (2, 4.0)];

        let total = calculate_categorical_probabilities(&neighbors, &targets, &categories)
            .iter()
            .map(|(_, probability)| probability)
            .sum::<f64>();

        assert!((total - 1.0).abs() < 1e-12);
    }

    #[test]
    fn categorical_probabilities_use_laplace_correction() {
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let training_indices = vec![0, 1, 2];
        let categories = sorted_target_categories_for_indices(&targets, &training_indices);
        let neighbors = vec![(0, 1.0), (1, 2.0), (2, 4.0)];
        let probabilities: std::collections::HashMap<String, f64> =
            calculate_categorical_probabilities(&neighbors, &targets, &categories)
                .into_iter()
                .collect();

        assert!((probabilities["A"] - 0.6).abs() < 1e-12);
        assert!((probabilities["B"] - 0.4).abs() < 1e-12);
    }

    #[test]
    fn categorical_probabilities_keep_absent_classes_nonzero() {
        let targets = vec![
            DataValue::Text("A".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
            DataValue::Text("B".to_string()),
        ];
        let training_indices = vec![0, 1, 2, 3];
        let categories = sorted_target_categories_for_indices(&targets, &training_indices);
        let neighbors = vec![(1, 1.0), (2, 2.0), (3, 4.0)];
        let probabilities: std::collections::HashMap<String, f64> =
            calculate_categorical_probabilities(&neighbors, &targets, &categories)
                .into_iter()
                .collect();

        assert!((probabilities["A"] - 0.2).abs() < 1e-12);
        assert!((probabilities["B"] - 0.8).abs() < 1e-12);
    }

    #[test]
    fn numeric_scale_predictions_use_neighbor_target_mean_or_median() {
        let targets = vec![
            DataValue::Number(120.0),
            DataValue::Number(130.0),
            DataValue::Number(500.0),
        ];
        let neighbors = vec![(0, 0.1), (1, 0.2), (2, 0.3)];

        assert!(matches!(
            calculate_mean_prediction(&neighbors, &targets),
            DataValue::Number(value) if (value - 250.0).abs() < f64::EPSILON
        ));
        assert!(matches!(
            calculate_median_prediction(&neighbors, &targets),
            DataValue::Number(value) if (value - 130.0).abs() < f64::EPSILON
        ));
    }

    #[test]
    fn numeric_ordinal_target_can_be_predicted_as_category() {
        let targets = vec![
            DataValue::Number(1.0),
            DataValue::Number(2.0),
            DataValue::Number(2.0),
        ];
        let neighbors = vec![(0, 1.0), (1, 2.0), (2, 3.0)];
        let config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: true,
                auto_selection: false,
                specify_k: 3,
                min_k: None,
                max_k: None,
                metric_eucli: true,
                metric_manhattan: false,
                weight: false,
                predictions_mean: false,
                predictions_median: false,
            },
            features: crate::models::config::FeaturesConfig {
                forward_selection: None,
                forced_entry_var: None,
                features_to_evaluate: 0,
                forced_features: 0,
                perform_selection: false,
                max_reached: true,
                below_min: false,
                max_to_select: None,
                min_change: 0.01,
            },
            partition: crate::models::config::PartitionConfig {
                src_var: None,
                partitioning_variable: None,
                use_randomly: false,
                use_variable: false,
                v_fold_partitioning_variable: None,
                v_fold_use_randomly: false,
                v_fold_use_partitioning_var: false,
                training_number: 70,
                num_partition: 2,
                set_seed: false,
                seed: None,
            },
            save: crate::models::config::SaveConfig {
                auto_name: true,
                custom_name: false,
                max_cats_to_save: None,
                has_target_var: false,
                is_cate_target_var: false,
                random_assign_to_partition: false,
                random_assign_to_fold: false,
                predicted_value_name: None,
                probability_name: None,
                partition_name: None,
                fold_name: None,
            },
            run: Default::default(),
            output: crate::models::config::OutputConfig {
                case_summary: true,
                feature_selection_summary: true,
                k_selection_chart: true,
                predictor_space: true,
                prediction_results: true,
                confusion_matrix: true,
                show_neighbor_detail: false,
                chart_and_table: true,
                export_model_xml: false,
                xml_file_path: None,
                export_distance: false,
                create_dataset: false,
                write_data_file: false,
                new_data_file_path: None,
                dataset_name: None,
            },
        };

        assert!(matches!(
            calculate_predictions(&neighbors, &targets, &config, true, &all_training(&targets)),
            DataValue::Number(value) if (value - 2.0).abs() < f64::EPSILON
        ));
    }

    #[test]
    fn categorical_probabilities_handle_empty_categories_and_invalid_neighbors() {
        let targets = vec![DataValue::Text("A".to_string())];

        assert!(calculate_categorical_probabilities(&[(0, 1.0)], &targets, &[]).is_empty());
        assert_eq!(
            calculate_categorical_probabilities(&[(99, 1.0)], &targets, &["A".to_string()]),
            vec![("A".to_string(), 0.0)]
        );
        assert_eq!(
            calculate_categorical_vote_probabilities(&[(99, 1.0)], &targets),
            vec![("A".to_string(), 0.0)]
        );
    }

    #[test]
    fn numeric_predictions_ignore_invalid_or_non_numeric_neighbors() {
        let targets = vec![
            DataValue::Number(10.0),
            DataValue::Text("missing".to_string()),
        ];
        let neighbors = vec![(1, 1.0), (99, 2.0)];

        assert!(matches!(
            calculate_mean_prediction(&neighbors, &targets),
            DataValue::Null
        ));
        assert!(matches!(
            calculate_median_prediction(&neighbors, &targets),
            DataValue::Null
        ));
    }

    #[test]
    fn median_prediction_averages_middle_values_for_even_neighbor_count() {
        let targets = vec![
            DataValue::Number(40.0),
            DataValue::Number(10.0),
            DataValue::Number(20.0),
            DataValue::Number(30.0),
        ];

        assert!(matches!(
            calculate_median_prediction(&[(0, 1.0), (1, 2.0), (2, 3.0), (3, 4.0)], &targets),
            DataValue::Number(value) if (value - 25.0).abs() < f64::EPSILON
        ));
    }
}
