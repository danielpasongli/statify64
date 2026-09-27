use std::collections::HashSet;

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData},
    result::{KSelectionCandidate, KSelectionChart},
};

use super::{
    core::{
        error_rate_percent, find_k_nearest_neighbors, lowest_error_smallest_k,
        preprocess_knn_data,
    },
    partition::EXCLUDED_FOLD,
    prediction::{
        calculate_categorical_prediction, calculate_mean_prediction, calculate_median_prediction,
        category_key, CategoryTieBreaker,
    },
};

#[derive(Clone, Debug)]
pub struct KSelectionResult {
    pub chart: KSelectionChart,
    pub selected_k: usize,
}

pub fn calculate_k_selection_cross_validation(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<KSelectionResult, String> {
    if !config.neighbors.auto_selection {
        return Err("Automatic k selection is not enabled".to_string());
    }

    let knn_data = preprocess_knn_data(data, config)?;
    if knn_data.training_indices.len() < 2 {
        return Err("Automatic k selection requires at least two training cases".to_string());
    }

    let fold_ids = validation_fold_ids(&knn_data);
    if fold_ids.len() < 2 {
        return Err(
            "Automatic k selection requires at least two cross-validation folds".to_string(),
        );
    }

    let mut candidates = Vec::new();
    for k in candidate_k_values(config) {
        candidates.push(evaluate_candidate_k(&knn_data, config, k, &fold_ids)?);
    }

    let Some(best_index) = lowest_error_smallest_k(
        candidates
            .iter()
            .map(|candidate| (candidate.k, candidate.average_error)),
    ) else {
        return Err("No k candidates could be evaluated".to_string());
    };

    let selected_k = candidates[best_index].k;
    let best_error = candidates[best_index].average_error;
    for (index, candidate) in candidates.iter_mut().enumerate() {
        candidate.selected = index == best_index;
    }

    let metric_name = if knn_data.target_is_numeric_scale() {
        "cross_validation_sse"
    } else {
        "cross_validation_classification_error_rate"
    };

    Ok(KSelectionResult {
        chart: KSelectionChart {
            candidates,
            selected_k,
            best_error,
            metric_name: metric_name.to_string(),
        },
        selected_k,
    })
}

pub fn config_with_selected_k(config: &KnnConfig, selected_k: usize) -> KnnConfig {
    let mut selected_config = config.clone();
    selected_config.neighbors.specify = true;
    selected_config.neighbors.auto_selection = false;
    selected_config.neighbors.specify_k = selected_k as i32;
    selected_config
}

fn candidate_k_values(config: &KnnConfig) -> Vec<usize> {
    let min_k = config
        .neighbors
        .min_k
        .unwrap_or(config.neighbors.specify_k)
        .max(1);
    let max_k = config.neighbors.max_k.unwrap_or(min_k).max(1);
    let start = min_k.min(max_k) as usize;
    let end = min_k.max(max_k) as usize;

    (start..=end).collect()
}

fn validation_fold_ids(knn_data: &KnnData) -> Vec<usize> {
    let training_set: HashSet<usize> = knn_data.training_indices.iter().copied().collect();
    let mut fold_ids = Vec::new();

    for (idx, &fold) in knn_data.cross_validation_folds.iter().enumerate() {
        if fold == EXCLUDED_FOLD || !training_set.contains(&idx) {
            continue;
        }

        if !fold_ids.contains(&fold) {
            fold_ids.push(fold);
        }
    }

    fold_ids.sort_unstable();
    fold_ids
}

fn evaluate_candidate_k(
    knn_data: &KnnData,
    config: &KnnConfig,
    k: usize,
    fold_ids: &[usize],
) -> Result<KSelectionCandidate, String> {
    let mut fold_errors = Vec::with_capacity(fold_ids.len());
    let mut fold_n = Vec::with_capacity(fold_ids.len());
    let mut fold_total_errors = Vec::with_capacity(fold_ids.len());

    for &fold_id in fold_ids {
        let fold_result = evaluate_fold(knn_data, config, k, fold_id)?;
        fold_errors.push(fold_result.fold_error);
        fold_n.push(fold_result.validation_n);
        fold_total_errors.push(fold_result.total_error);
    }

    let average_error = if fold_errors.is_empty() {
        f64::INFINITY
    } else {
        fold_errors.iter().sum::<f64>() / fold_errors.len() as f64
    };

    Ok(KSelectionCandidate {
        k,
        average_error,
        fold_errors,
        fold_n,
        fold_total_errors,
        selected: false,
    })
}

struct FoldEvaluation {
    fold_error: f64,
    validation_n: usize,
    total_error: f64,
}

fn evaluate_fold(
    knn_data: &KnnData,
    config: &KnnConfig,
    k: usize,
    validation_fold_id: usize,
) -> Result<FoldEvaluation, String> {
    let validation_indices = knn_data
        .training_indices
        .iter()
        .copied()
        .filter(|&idx| knn_data.cross_validation_folds.get(idx) == Some(&validation_fold_id))
        .collect::<Vec<_>>();
    let cv_training_indices = knn_data
        .training_indices
        .iter()
        .copied()
        .filter(|&idx| {
            knn_data
                .cross_validation_folds
                .get(idx)
                .is_some_and(|fold| *fold != validation_fold_id && *fold != EXCLUDED_FOLD)
        })
        .collect::<Vec<_>>();

    if validation_indices.is_empty() {
        return Err(format!(
            "Cross-validation fold {} has no validation cases",
            validation_fold_id
        ));
    }

    if cv_training_indices.is_empty() {
        return Err(format!(
            "Cross-validation fold {} has no training cases",
            validation_fold_id
        ));
    }

    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &cv_training_indices);
    let mut correct = 0usize;
    let mut evaluated = 0usize;
    let mut sse = 0.0;
    for &validation_idx in &validation_indices {
        let effective_k = k.min(cv_training_indices.len()).max(1);
        let neighbors = find_k_nearest_neighbors(
            &knn_data.data_matrix[validation_idx],
            &knn_data.data_matrix,
            &cv_training_indices,
            effective_k,
            config.neighbors.metric_eucli,
            Some(&knn_data.processed_case_indices),
        );

        if knn_data.target_is_numeric_scale() {
            let predicted = if config.neighbors.predictions_median {
                calculate_median_prediction(&neighbors, &knn_data.target_values)
            } else {
                calculate_mean_prediction(&neighbors, &knn_data.target_values)
            };

            if let (DataValue::Number(actual), DataValue::Number(predicted)) =
                (&knn_data.target_values[validation_idx], predicted)
            {
                sse += (actual - predicted).powi(2);
                evaluated += 1;
            }
        } else {
            let predicted = calculate_categorical_prediction(&neighbors, &knn_data.target_values, &tie_breaker);
            if category_key(Some(&knn_data.target_values[validation_idx]))
                == category_key(Some(&predicted))
            {
                correct += 1;
            }
            evaluated += 1;
        }
    }

    let (fold_error, total_error) = if knn_data.target_is_numeric_scale() {
        (sse, sse)
    } else if evaluated == 0 {
        (100.0, 0.0)
    } else {
        let incorrect = evaluated.saturating_sub(correct);
        (
            error_rate_percent(incorrect, evaluated),
            incorrect as f64,
        )
    };

    Ok(FoldEvaluation {
        fold_error,
        validation_n: evaluated,
        total_error,
    })
}
