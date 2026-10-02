// classification_table.rs
use std::collections::HashMap;

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue},
    result::{ClassificationPartition, ClassificationTable},
};

use super::core::{
    calculate_predictor_importance, determine_effective_k, find_k_nearest_neighbors_with_weights,
    preprocess_knn_data,
};
use super::prediction::{
    calculate_categorical_vote_probabilities, category_key, sorted_target_categories,
    CategoryTieBreaker,
};

pub fn calculate_classification_table(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<ClassificationTable, String> {
    // Check if we have a target variable - required for classification
    if config.main.target_var.is_none() {
        return Err("A target variable is required for classification table".to_string());
    }

    // Preprocess data
    let knn_data = preprocess_knn_data(data, config)?;
    if !knn_data.target_is_categorical() {
        return Err("Classification table is only available for categorical targets".to_string());
    }

    // Determine k value
    let k = determine_effective_k(&knn_data, config)?;
    let feature_weights = if config.neighbors.weight {
        Some(calculate_predictor_importance(data, config)?.expanded_feature_weights)
    } else {
        None
    };

    // Create mapping of categorical target values to numeric indices
    let (category_map, categories) = create_category_mapping(&knn_data.target_values);
    let category_labels = display_category_labels(data, &categories);
    let n_categories = categories.len();

    // Use Euclidean or Manhattan distance
    let use_euclidean = config.neighbors.metric_eucli;
    // Calculate confusion matrices and missing values
    let (train_confusion, train_correct, train_total, train_missing) = calculate_confusion_matrix(
        &knn_data,
        &category_map,
        n_categories,
        k,
        use_euclidean,
        true,
        feature_weights.as_deref(),
    );

    let (holdout_confusion, holdout_correct, holdout_total, holdout_missing) =
        calculate_confusion_matrix(
            &knn_data,
            &category_map,
            n_categories,
            k,
            use_euclidean,
            false,
            feature_weights.as_deref(),
        );

    // Extract classification statistics
    let (train_observed, train_predicted) = extract_marginals(&train_confusion, n_categories);
    let (holdout_observed, holdout_predicted) = extract_marginals(&holdout_confusion, n_categories);

    // Calculate overall percentages (distribution of predicted categories)
    let train_overall_percent = calculate_overall_percent(&train_predicted, train_total);
    let holdout_overall_percent = calculate_overall_percent(&holdout_predicted, holdout_total);

    // Calculate accuracy percentages by category
    let train_percent_correct =
        calculate_percent_correct_by_category(&train_confusion, &train_observed);
    let holdout_percent_correct =
        calculate_percent_correct_by_category(&holdout_confusion, &holdout_observed);

    // Calculate overall accuracy percentages
    let _train_overall_accuracy = calculate_percent_correct(train_correct, train_total);
    let _holdout_overall_accuracy = calculate_percent_correct(holdout_correct, holdout_total);

    Ok(ClassificationTable {
        categories: category_labels,
        training: ClassificationPartition {
            confusion_matrix: train_confusion,
            observed: train_observed,
            predicted: train_predicted,
            missing: train_missing,
            overall_percent: train_overall_percent,
            percent_correct: train_percent_correct,
        },
        holdout: ClassificationPartition {
            confusion_matrix: holdout_confusion,
            observed: holdout_observed,
            predicted: holdout_predicted,
            missing: holdout_missing,
            overall_percent: holdout_overall_percent,
            percent_correct: holdout_percent_correct,
        },
    })
}

/// Create a mapping from categorical values to numeric indices
fn create_category_mapping(target_values: &[DataValue]) -> (HashMap<String, usize>, Vec<String>) {
    let categories = sorted_target_categories(target_values);
    let category_map = categories
        .iter()
        .enumerate()
        .map(|(idx, category)| (category.clone(), idx))
        .collect();

    (category_map, categories)
}

fn display_category_labels(data: &AnalysisData, categories: &[String]) -> Vec<String> {
    let value_labels = data
        .target_data_defs
        .iter()
        .flat_map(|group| group.iter())
        .flat_map(|definition| definition.values.iter())
        .collect::<Vec<_>>();

    categories
        .iter()
        .map(|category| {
            value_labels
                .iter()
                .find(|value_label| {
                    category_key(Some(&value_label.value)).as_deref() == Some(category.as_str())
                })
                .and_then(|value_label| {
                    let label = value_label.label.trim();
                    if label.is_empty() {
                        None
                    } else {
                        Some(label.to_string())
                    }
                })
                .unwrap_or_else(|| category.clone())
        })
        .collect()
}

/// Calculate confusion matrix for either training or holdout set
fn calculate_confusion_matrix(
    knn_data: &crate::models::data::KnnData,
    category_map: &HashMap<String, usize>,
    n_categories: usize,
    k: usize,
    use_euclidean: bool,
    is_training: bool,
    feature_weights: Option<&[f64]>,
) -> (Vec<Vec<usize>>, usize, usize, Vec<usize>) {
    let mut confusion = vec![vec![0; n_categories]; n_categories];
    let mut correct = 0;
    let mut total = 0;
    let mut missing = vec![0; n_categories];
    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &knn_data.training_indices);

    // Select indices to process based on set type
    let indices_to_process = if is_training {
        &knn_data.training_indices
    } else {
        &knn_data.holdout_indices
    };

    for &idx in indices_to_process {
        // Get actual category
        let actual_value = &knn_data.target_values[idx];
        let actual_cat = match category_key(Some(actual_value)) {
            Some(category) => category_map.get(&category),
            None => {
                // Consider this as missing value
                if !is_training {
                    // Track missing values in holdout set
                    let neighbors = find_k_nearest_neighbors_with_weights(
                        &knn_data.data_matrix[idx],
                        &knn_data.data_matrix,
                        &knn_data.training_indices,
                        k,
                        use_euclidean,
                        Some(&knn_data.processed_case_indices),
                        feature_weights,
                    );

                    let predicted_cat = predict_category(
                        &neighbors,
                        &knn_data.target_values,
                        category_map,
                        n_categories,
                        &tie_breaker,
                    );

                    missing[predicted_cat] += 1;
                }
                continue;
            }
        };

        if actual_cat.is_none() {
            continue;
        }

        // Find neighbors - depends on whether this is training or holdout
        let neighbors = if is_training {
            // For training, find neighbors excluding self
            let train_indices: Vec<usize> = knn_data
                .training_indices
                .iter()
                .filter(|&&i| i != idx)
                .copied()
                .collect();

            find_k_nearest_neighbors_with_weights(
                &knn_data.data_matrix[idx],
                &knn_data.data_matrix,
                &train_indices,
                k,
                use_euclidean,
                Some(&knn_data.processed_case_indices),
                feature_weights,
            )
        } else {
            // For holdout, find neighbors from training set
            find_k_nearest_neighbors_with_weights(
                &knn_data.data_matrix[idx],
                &knn_data.data_matrix,
                &knn_data.training_indices,
                k,
                use_euclidean,
                Some(&knn_data.processed_case_indices),
                feature_weights,
            )
        };

        // Predict category by majority vote
        let predicted_cat = predict_category(
            &neighbors,
            &knn_data.target_values,
            category_map,
            n_categories,
            &tie_breaker,
        );

        // Update confusion matrix
        let &actual_idx = actual_cat.unwrap();
        confusion[actual_idx][predicted_cat] += 1;

        // Track correct predictions
        if actual_idx == predicted_cat {
            correct += 1;
        }

        total += 1;
    }

    (confusion, correct, total, missing)
}

/// Predict category using majority vote from neighbors, breaking ties the SPSS way.
fn predict_category(
    neighbors: &[(usize, f64)],
    target_values: &[DataValue],
    category_map: &HashMap<String, usize>,
    n_categories: usize,
    tie_breaker: &CategoryTieBreaker,
) -> usize {
    let probabilities = calculate_categorical_vote_probabilities(neighbors, target_values)
        .into_iter()
        .filter(|(category, _)| {
            category_map
                .get(category)
                .is_some_and(|&idx| idx < n_categories)
        });

    tie_breaker
        .pick(probabilities)
        .and_then(|category| category_map.get(&category).copied())
        .unwrap_or(0)
}

/// Extract row and column sums from confusion matrix
fn extract_marginals(confusion: &[Vec<usize>], n_categories: usize) -> (Vec<usize>, Vec<usize>) {
    let mut observed = Vec::with_capacity(n_categories);
    let mut predicted = Vec::with_capacity(n_categories);

    for row in confusion.iter().take(n_categories) {
        let row_sum: usize = row.iter().sum();
        observed.push(row_sum);
    }

    for j in 0..n_categories {
        let col_sum: usize = confusion.iter().take(n_categories).map(|row| row[j]).sum();
        predicted.push(col_sum);
    }

    (observed, predicted)
}

/// Calculate overall percent distribution for each category
fn calculate_overall_percent(predicted: &[usize], total: usize) -> Vec<f64> {
    if total > 0 {
        predicted
            .iter()
            .map(|&count| (100.0 * (count as f64)) / (total as f64))
            .collect()
    } else {
        vec![0.0; predicted.len()]
    }
}

/// Calculate percent correct for each category
fn calculate_percent_correct_by_category(confusion: &[Vec<usize>], observed: &[usize]) -> Vec<f64> {
    observed
        .iter()
        .enumerate()
        .map(|(i, &obs_count)| {
            if obs_count > 0 {
                (100.0 * (confusion[i][i] as f64)) / (obs_count as f64)
            } else {
                0.0
            }
        })
        .collect()
}

/// Calculate overall percent correct
fn calculate_percent_correct(correct: usize, total: usize) -> f64 {
    if total > 0 {
        (100.0 * (correct as f64)) / (total as f64)
    } else {
        0.0
    }
}
