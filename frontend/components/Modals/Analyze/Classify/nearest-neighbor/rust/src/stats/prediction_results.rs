use std::collections::{HashMap, HashSet};

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData},
    result::{PredictionResultRow, PredictionResults},
};

use super::{
    core::{calculate_predictor_importance, determine_effective_k},
    distance::find_k_nearest_neighbors_with_weights,
    prediction::{
        calculate_categorical_prediction, calculate_categorical_probabilities,
        calculate_mean_prediction, calculate_median_prediction, category_key,
        sorted_target_categories_for_indices, CategoryTieBreaker,
    },
    preprocess_data::preprocess_knn_data,
};

pub struct PredictionComputation {
    pub knn_data: KnnData,
    pub rows: Vec<PredictionResultRow>,
    pub predicted_values: Vec<DataValue>,
    pub category_probabilities: HashMap<String, Vec<f64>>,
    pub target_type: String,
}

pub fn calculate_prediction_results(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<PredictionResults, String> {
    let computation = calculate_prediction_computation(data, config)?;

    Ok(prediction_results_from_computation(&computation))
}

pub fn calculate_prediction_computation(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<PredictionComputation, String> {
    let knn_data = preprocess_knn_data(data, config)?;
    let feature_weights = if config.neighbors.weight {
        Some(calculate_predictor_importance(data, config)?.expanded_feature_weights)
    } else {
        None
    };
    calculate_prediction_computation_for_knn_data_with_weights(
        knn_data,
        config,
        feature_weights.as_deref(),
    )
}

pub fn calculate_prediction_computation_for_knn_data(
    knn_data: KnnData,
    config: &KnnConfig,
) -> Result<PredictionComputation, String> {
    calculate_prediction_computation_for_knn_data_with_weights(knn_data, config, None)
}

fn calculate_prediction_computation_for_knn_data_with_weights(
    knn_data: KnnData,
    config: &KnnConfig,
    feature_weights: Option<&[f64]>,
) -> Result<PredictionComputation, String> {
    let k = determine_effective_k(&knn_data, config)?;
    let mut ordered_indices = knn_data.holdout_indices.clone();
    ordered_indices.extend(knn_data.training_indices.iter().copied());

    let target_type = if knn_data.target_is_numeric_scale() {
        "continuous".to_string()
    } else {
        "categorical".to_string()
    };
    let case_predictions =
        calculate_case_predictions_for_knn_data(&knn_data, config, k, feature_weights);
    let rows = build_prediction_result_rows_from_case_predictions(
        &knn_data,
        &case_predictions,
        &ordered_indices,
    );

    Ok(PredictionComputation {
        knn_data,
        rows,
        predicted_values: case_predictions.predicted_values,
        category_probabilities: case_predictions.category_probabilities,
        target_type,
    })
}

pub fn prediction_results_from_computation(
    computation: &PredictionComputation,
) -> PredictionResults {
    PredictionResults {
        rows: computation.rows.clone(),
        target_type: computation.target_type.clone(),
    }
}

pub fn build_prediction_result_rows_for_knn_data(
    knn_data: &KnnData,
    config: &KnnConfig,
    k: usize,
    ordered_indices: &[usize],
) -> Vec<PredictionResultRow> {
    let case_predictions = calculate_case_predictions_for_knn_data(knn_data, config, k, None);
    build_prediction_result_rows_from_case_predictions(knn_data, &case_predictions, ordered_indices)
}

struct CasePredictions {
    predicted_values: Vec<DataValue>,
    correct_values: Vec<Option<bool>>,
    probabilities_predicted_class: Vec<Option<f64>>,
    errors: Vec<Option<f64>>,
    squared_errors: Vec<Option<f64>>,
    category_probabilities: HashMap<String, Vec<f64>>,
}

fn calculate_case_predictions_for_knn_data(
    knn_data: &KnnData,
    config: &KnnConfig,
    k: usize,
    feature_weights: Option<&[f64]>,
) -> CasePredictions {
    let target_is_numeric = knn_data.target_is_numeric_scale();
    let categories =
        sorted_target_categories_for_indices(&knn_data.target_values, &knn_data.training_indices);
    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &knn_data.training_indices);
    let case_count = knn_data.data_matrix.len();
    let mut predicted_values = vec![DataValue::Null; case_count];
    let mut correct_values = vec![None; case_count];
    let mut probabilities_predicted_class = vec![None; case_count];
    let mut errors = vec![None; case_count];
    let mut squared_errors = vec![None; case_count];
    let mut category_probabilities: HashMap<String, Vec<f64>> = categories
        .iter()
        .map(|category| (category.clone(), vec![0.0; case_count]))
        .collect();

    for idx in 0..case_count {
        let candidate_indices: Vec<usize> = knn_data
            .training_indices
            .iter()
            .copied()
            .filter(|&candidate_idx| candidate_idx != idx)
            .collect();
        if candidate_indices.is_empty() {
            continue;
        }

        let neighbors = find_k_nearest_neighbors_with_weights(
            &knn_data.data_matrix[idx],
            &knn_data.data_matrix,
            &candidate_indices,
            k,
            config.neighbors.metric_eucli,
            Some(&knn_data.processed_case_indices),
            feature_weights,
        );

        let actual = knn_data.target_values[idx].clone();
        let (predicted, correct, probability, error, squared_error) = if target_is_numeric {
            let predicted = if config.neighbors.predictions_median {
                calculate_median_prediction(&neighbors, &knn_data.target_values)
            } else {
                calculate_mean_prediction(&neighbors, &knn_data.target_values)
            };
            let (error, squared_error) = match (&actual, &predicted) {
                (DataValue::Number(actual), DataValue::Number(predicted)) => {
                    let error = actual - predicted;
                    (Some(error), Some(error.powi(2)))
                }
                _ => (None, None),
            };
            (predicted, None, None, error, squared_error)
        } else {
            let predicted = calculate_categorical_prediction(&neighbors, &knn_data.target_values, &tie_breaker);
            let probability = category_key(Some(&predicted)).and_then(|predicted_key| {
                calculate_categorical_probabilities(
                    &neighbors,
                    &knn_data.target_values,
                    &categories,
                )
                .into_iter()
                .find_map(|(key, value)| {
                    if key == predicted_key {
                        Some(value)
                    } else {
                        None
                    }
                })
            });
            let correct = Some(category_key(Some(&actual)) == category_key(Some(&predicted)));
            (predicted, correct, probability, None, None)
        };

        predicted_values[idx] = predicted;
        correct_values[idx] = correct;
        probabilities_predicted_class[idx] = probability;
        errors[idx] = error;
        squared_errors[idx] = squared_error;

        if !categories.is_empty() && !neighbors.is_empty() {
            let probabilities = calculate_categorical_probabilities(
                &neighbors,
                &knn_data.target_values,
                &categories,
            );
            let probability_by_category: HashMap<String, f64> = probabilities.into_iter().collect();

            for category in &categories {
                let probability = probability_by_category
                    .get(category)
                    .copied()
                    .unwrap_or(0.0);
                if let Some(values) = category_probabilities.get_mut(category) {
                    values[idx] = probability;
                }
            }
        }
    }

    CasePredictions {
        predicted_values,
        correct_values,
        probabilities_predicted_class,
        errors,
        squared_errors,
        category_probabilities,
    }
}

fn build_prediction_result_rows_from_case_predictions(
    knn_data: &KnnData,
    case_predictions: &CasePredictions,
    ordered_indices: &[usize],
) -> Vec<PredictionResultRow> {
    let training_set: HashSet<usize> = knn_data.training_indices.iter().copied().collect();
    let holdout_set: HashSet<usize> = knn_data.holdout_indices.iter().copied().collect();
    let mut rows = Vec::new();

    for &idx in ordered_indices {
        let sample_type = if holdout_set.contains(&idx) {
            "Holdout"
        } else if training_set.contains(&idx) {
            "Training"
        } else {
            continue;
        };

        rows.push(PredictionResultRow {
            case_id: knn_data.case_identifiers[idx],
            row_index: knn_data.processed_case_indices[idx],
            sample_type: sample_type.to_string(),
            actual: knn_data.target_values[idx].clone(),
            predicted: case_predictions
                .predicted_values
                .get(idx)
                .cloned()
                .unwrap_or(DataValue::Null),
            correct: case_predictions
                .correct_values
                .get(idx)
                .copied()
                .unwrap_or(None),
            probability_predicted_class: case_predictions
                .probabilities_predicted_class
                .get(idx)
                .copied()
                .unwrap_or(None),
            error: case_predictions.errors.get(idx).copied().unwrap_or(None),
            squared_error: case_predictions
                .squared_errors
                .get(idx)
                .copied()
                .unwrap_or(None),
        });
    }

    rows
}
