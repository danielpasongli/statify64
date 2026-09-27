use std::collections::HashSet;

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData},
    result::{FeatureSelectionStep, FeatureSelectionSummary, KFeatureSelectionSummary},
};

use super::{
    core::{
        determine_effective_k, error_rate_percent, errors_equal, find_k_nearest_neighbors,
        lowest_error_smallest_k, preprocess_knn_data, ERROR_TOLERANCE,
    },
    prediction::{
        calculate_categorical_prediction, calculate_mean_prediction, calculate_median_prediction,
        category_key, CategoryTieBreaker,
    },
};

#[derive(Clone, Debug)]
pub struct FeatureSelectionResult {
    pub summary: FeatureSelectionSummary,
    pub steps: Vec<FeatureSelectionStep>,
    pub selected_features: Vec<String>,
    pub selected_k: Option<usize>,
    pub k_summary: Vec<KFeatureSelectionSummary>,
}

#[derive(Clone, Debug)]
struct TrialResult {
    feature: String,
    error: f64,
}

pub fn calculate_feature_selection(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<FeatureSelectionResult, String> {
    if config.neighbors.auto_selection {
        return calculate_feature_selection_with_auto_k(data, config);
    }

    let mut result = calculate_forward_feature_selection(data, config)?;
    let k = evaluate_k(data, config, &result.selected_features).unwrap_or(0);
    result.selected_k = (k > 0).then_some(k);
    if k > 0 {
        result.k_summary = vec![KFeatureSelectionSummary {
            k,
            selected_features: result.selected_features.clone(),
            error: result.summary.final_error,
            stopping_reason: result.summary.stopping_reason.clone(),
            selected: true,
        }];
    }

    Ok(result)
}

fn calculate_feature_selection_with_auto_k(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<FeatureSelectionResult, String> {
    let mut trials = Vec::new();

    for k in candidate_k_values(config) {
        let trial_config = config_with_k(config, k);
        let trial = calculate_forward_feature_selection(data, &trial_config)?;
        trials.push((k, trial));
    }

    let Some(best_index) = lowest_error_smallest_k(
        trials
            .iter()
            .map(|(k, trial)| (*k, trial.summary.final_error)),
    ) else {
        return Err("No k candidates could be evaluated for feature selection".to_string());
    };

    let mut k_summary = Vec::with_capacity(trials.len());
    for (index, (k, trial)) in trials.iter().enumerate() {
        k_summary.push(KFeatureSelectionSummary {
            k: *k,
            selected_features: trial.selected_features.clone(),
            error: trial.summary.final_error,
            stopping_reason: trial.summary.stopping_reason.clone(),
            selected: index == best_index,
        });
    }

    let (selected_k, mut best_result) = trials.swap_remove(best_index);
    best_result.selected_k = Some(selected_k);
    best_result.k_summary = k_summary;

    Ok(best_result)
}

fn calculate_forward_feature_selection(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<FeatureSelectionResult, String> {
    if !config.features.perform_selection {
        return Err("Feature selection is not enabled".to_string());
    }

    let all_features = feature_universe(config);
    if all_features.is_empty() {
        return Err("No candidate features are available for feature selection".to_string());
    }

    let forced_features = sanitize_feature_list(
        config.features.forced_entry_var.as_deref().unwrap_or(&[]),
        &all_features,
    );
    let mut selected_features = forced_features.clone();
    let original_candidate_features = sanitize_feature_list(
        config
            .features
            .forward_selection
            .as_deref()
            .unwrap_or(&all_features),
        &all_features,
    )
    .into_iter()
    .filter(|feature| !selected_features.contains(feature))
    .collect::<Vec<_>>();
    let mut candidate_features = original_candidate_features.clone();

    let uses_minimum_change = config.features.below_min;
    let uses_fixed_number = !uses_minimum_change;

    let stopping_method = if uses_minimum_change {
        "minimum_change"
    } else {
        "fixed_number"
    };

    let mut steps = Vec::new();
    let mut previous_error = if selected_features.is_empty() {
        None
    } else {
        Some(evaluate_subset(data, config, &selected_features)?)
    };

    // SPSS: with the minimum-change criterion, a zero error for the forced
    // features means no features are added. The fixed-number criterion still
    // adds J_add features.
    if let (true, Some(error)) = (uses_minimum_change, previous_error) {
        if error <= f64::EPSILON {
            let removed_features = removed_features(&all_features, &selected_features);
            return Ok(FeatureSelectionResult {
                summary: FeatureSelectionSummary {
                    enabled: true,
                    method: "forward_selection".to_string(),
                    forced_features,
                    candidate_features: original_candidate_features,
                    selected_features: selected_features.clone(),
                    removed_features,
                    final_error: 0.0,
                    stopping_method: stopping_method.to_string(),
                    stopping_reason: "zero_error".to_string(),
                    evaluation_strategy: "training_set".to_string(),
                },
                steps,
                selected_features,
                selected_k: None,
                k_summary: Vec::new(),
            });
        }
    }

    let max_additional = if uses_minimum_change {
        candidate_features.len()
    } else if uses_fixed_number {
        fixed_additional_count(config, all_features.len(), forced_features.len())
            .min(candidate_features.len())
    } else {
        0
    };

    if max_additional == 0 {
        let final_error = previous_error
            .unwrap_or_else(|| evaluate_subset(data, config, &all_features).unwrap_or(0.0));
        let removed_features = removed_features(&all_features, &selected_features);
        return Ok(FeatureSelectionResult {
            summary: FeatureSelectionSummary {
                enabled: true,
                method: "forward_selection".to_string(),
                forced_features,
                candidate_features: original_candidate_features,
                selected_features: selected_features.clone(),
                removed_features,
                final_error,
                stopping_method: stopping_method.to_string(),
                stopping_reason: "max_features_reached".to_string(),
                evaluation_strategy: "training_set".to_string(),
            },
            steps,
            selected_features,
            selected_k: None,
            k_summary: Vec::new(),
        });
    }

    let mut stopping_reason = "candidate_features_exhausted".to_string();
    let mut final_error = previous_error.unwrap_or(f64::INFINITY);

    while !candidate_features.is_empty() && steps.len() < max_additional {
        let best_trial = best_candidate(data, config, &selected_features, &candidate_features)?;
        let next_features = with_feature(&selected_features, &best_trial.feature);
        let improvement = previous_error.map(|error| error - best_trial.error);

        steps.push(FeatureSelectionStep {
            step_number: steps.len() + 1,
            selected_feature: best_trial.feature.clone(),
            trial_error: best_trial.error,
            improvement,
            selected_features_after_step: next_features.clone(),
        });

        let should_stop = if uses_minimum_change {
            minimum_change_stop_reason(previous_error, best_trial.error, config.features.min_change)
        } else {
            None
        };

        candidate_features.retain(|feature| feature != &best_trial.feature);

        if should_stop.as_deref() == Some("error_deteriorated") {
            stopping_reason = should_stop.unwrap();
            final_error = previous_error.unwrap_or(best_trial.error);
            break;
        }

        selected_features = next_features;
        final_error = best_trial.error;
        previous_error = Some(best_trial.error);

        if let Some(reason) = should_stop {
            stopping_reason = reason;
            break;
        }

        if steps.len() >= max_additional && uses_fixed_number {
            stopping_reason = "max_features_reached".to_string();
            break;
        }

        if candidate_features.is_empty() {
            stopping_reason = "candidate_features_exhausted".to_string();
        }
    }

    let removed_features = removed_features(&all_features, &selected_features);

    Ok(FeatureSelectionResult {
        summary: FeatureSelectionSummary {
            enabled: true,
            method: "forward_selection".to_string(),
            forced_features,
            candidate_features: original_candidate_features,
            selected_features: selected_features.clone(),
            removed_features,
            final_error,
            stopping_method: stopping_method.to_string(),
            stopping_reason,
            evaluation_strategy: "training_set".to_string(),
        },
        steps,
        selected_features,
        selected_k: None,
        k_summary: Vec::new(),
    })
}

pub fn config_with_selected_features(
    config: &KnnConfig,
    selected_features: &[String],
) -> KnnConfig {
    let mut selected_config = config.clone();
    if !selected_features.is_empty() {
        selected_config.main.feature_var = Some(selected_features.to_vec());
    }
    selected_config
}

pub fn config_with_selected_features_and_k(
    config: &KnnConfig,
    selected_features: &[String],
    selected_k: Option<usize>,
) -> KnnConfig {
    let mut selected_config = config_with_selected_features(config, selected_features);
    if let Some(k) = selected_k {
        selected_config.neighbors.specify_k = k as i32;
    }
    selected_config
}

fn config_with_k(config: &KnnConfig, k: usize) -> KnnConfig {
    let mut selected_config = config.clone();
    selected_config.neighbors.specify_k = k as i32;
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

pub(crate) fn feature_universe(config: &KnnConfig) -> Vec<String> {
    let mut features = Vec::new();

    for feature in config.main.feature_var.as_deref().unwrap_or(&[]) {
        push_unique(&mut features, feature);
    }

    for feature in config.features.forward_selection.as_deref().unwrap_or(&[]) {
        push_unique(&mut features, feature);
    }

    for feature in config.features.forced_entry_var.as_deref().unwrap_or(&[]) {
        push_unique(&mut features, feature);
    }

    features
}

fn sanitize_feature_list(features: &[String], universe: &[String]) -> Vec<String> {
    let universe_set = universe.iter().collect::<HashSet<_>>();
    let mut sanitized = Vec::new();

    for feature in features {
        if universe_set.contains(feature) {
            push_unique(&mut sanitized, feature);
        }
    }

    sanitized
}

fn push_unique(features: &mut Vec<String>, feature: &str) {
    if !features.iter().any(|existing| existing == feature) {
        features.push(feature.to_string());
    }
}

fn fixed_additional_count(config: &KnnConfig, feature_count: usize, forced_count: usize) -> usize {
    if let Some(max_to_select) = config.features.max_to_select {
        return max_to_select.max(0) as usize;
    }

    feature_count.min(20).saturating_sub(forced_count)
}

fn best_candidate(
    data: &AnalysisData,
    config: &KnnConfig,
    selected_features: &[String],
    candidate_features: &[String],
) -> Result<TrialResult, String> {
    let mut best: Option<TrialResult> = None;

    for candidate in candidate_features {
        let trial_features = with_feature(selected_features, candidate);
        let error = evaluate_subset(data, config, &trial_features)?;
        let trial = TrialResult {
            feature: candidate.clone(),
            error,
        };

        best = match best {
            // Ties (up to rounding) keep the earlier candidate.
            Some(current)
                if current.error <= trial.error || errors_equal(current.error, trial.error) =>
            {
                Some(current)
            }
            _ => Some(trial),
        };
    }

    best.ok_or_else(|| "No feature selection candidates could be evaluated".to_string())
}

fn with_feature(selected_features: &[String], feature: &str) -> Vec<String> {
    let mut features = selected_features.to_vec();
    push_unique(&mut features, feature);
    features
}

fn minimum_change_stop_reason(
    previous_error: Option<f64>,
    next_error: f64,
    min_change: f64,
) -> Option<String> {
    if next_error <= f64::EPSILON {
        return Some("zero_error".to_string());
    }

    let previous_error = previous_error?;

    if previous_error <= f64::EPSILON {
        return Some("zero_error".to_string());
    }

    if errors_equal(previous_error, next_error) {
        return Some("no_error_change".to_string());
    }

    // The tolerance makes a change of exactly Δmin (or 2Δmin) follow the
    // formula instead of the rounding in the computed errors: 10 -> 9
    // misclassified cases out of 70 is a change of exactly 0.1, but computes
    // as 0.10000000000000037.
    let relative_change = ((previous_error - next_error).abs()) / previous_error;
    if previous_error > next_error && relative_change <= min_change + ERROR_TOLERANCE {
        return Some("minimum_change_reached".to_string());
    }

    if previous_error < next_error && relative_change > 2.0 * min_change + ERROR_TOLERANCE {
        return Some("error_deteriorated".to_string());
    }

    None
}

pub(crate) fn evaluate_subset(
    data: &AnalysisData,
    config: &KnnConfig,
    selected_features: &[String],
) -> Result<f64, String> {
    if selected_features.is_empty() {
        return Err("At least one feature is required to evaluate KNN".to_string());
    }

    let selected_config = config_with_selected_features(config, selected_features);
    let knn_data = preprocess_knn_data(data, &selected_config)?;
    let k = determine_effective_k(&knn_data, &selected_config)?;

    if knn_data.training_indices.is_empty() {
        return Err("Feature selection requires at least one training case".to_string());
    }

    if knn_data.target_is_numeric_scale() {
        Ok(training_sse(&knn_data, &selected_config, k))
    } else {
        Ok(training_error_rate(&knn_data, &selected_config, k))
    }
}

fn evaluate_k(
    data: &AnalysisData,
    config: &KnnConfig,
    selected_features: &[String],
) -> Result<usize, String> {
    let selected_config = config_with_selected_features(config, selected_features);
    let knn_data = preprocess_knn_data(data, &selected_config)?;
    determine_effective_k(&knn_data, &selected_config)
}

fn training_error_rate(knn_data: &KnnData, config: &KnnConfig, k: usize) -> f64 {
    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &knn_data.training_indices);
    let mut total = 0usize;
    let mut correct = 0usize;

    for &idx in &knn_data.training_indices {
        let candidate_indices = training_candidates(knn_data, idx);
        if candidate_indices.is_empty() {
            continue;
        }

        let neighbors = find_k_nearest_neighbors(
            &knn_data.data_matrix[idx],
            &knn_data.data_matrix,
            &candidate_indices,
            k,
            config.neighbors.metric_eucli,
            Some(&knn_data.processed_case_indices),
        );
        let predicted = calculate_categorical_prediction(&neighbors, &knn_data.target_values, &tie_breaker);

        if category_key(Some(&knn_data.target_values[idx])) == category_key(Some(&predicted)) {
            correct += 1;
        }
        total += 1;
    }

    if total == 0 {
        100.0
    } else {
        error_rate_percent(total - correct, total)
    }
}

fn training_sse(knn_data: &KnnData, config: &KnnConfig, k: usize) -> f64 {
    let mut sse = 0.0;

    for &idx in &knn_data.training_indices {
        let candidate_indices = training_candidates(knn_data, idx);
        if candidate_indices.is_empty() {
            continue;
        }

        let neighbors = find_k_nearest_neighbors(
            &knn_data.data_matrix[idx],
            &knn_data.data_matrix,
            &candidate_indices,
            k,
            config.neighbors.metric_eucli,
            Some(&knn_data.processed_case_indices),
        );
        let predicted = if config.neighbors.predictions_median {
            calculate_median_prediction(&neighbors, &knn_data.target_values)
        } else {
            calculate_mean_prediction(&neighbors, &knn_data.target_values)
        };

        if let (DataValue::Number(actual), DataValue::Number(predicted)) =
            (&knn_data.target_values[idx], predicted)
        {
            sse += (actual - predicted).powi(2);
        }
    }

    sse
}

fn training_candidates(knn_data: &KnnData, idx: usize) -> Vec<usize> {
    knn_data
        .training_indices
        .iter()
        .copied()
        .filter(|&candidate_idx| candidate_idx != idx)
        .collect()
}

fn removed_features(all_features: &[String], selected_features: &[String]) -> Vec<String> {
    all_features
        .iter()
        .filter(|feature| !selected_features.contains(feature))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::{
        config::KnnConfig,
        data::{
            AnalysisData, DataRecord, DataValue, VariableAlign, VariableDefinition,
            VariableMeasure, VariableRole, VariableType,
        },
    };
    use crate::stats::{common::prepare_run_config, preprocess_data::preprocess_knn_data};

    use super::{calculate_feature_selection, evaluate_subset, minimum_change_stop_reason};

    const CASES: usize = 60;

    fn variable_def(name: &str, measure: VariableMeasure) -> VariableDefinition {
        VariableDefinition {
            id: None,
            column_index: 0,
            name: name.to_string(),
            r#type: VariableType::Numeric,
            width: 8,
            decimals: 0,
            label: None,
            values: Vec::new(),
            missing: Vec::new(),
            columns: 8,
            align: VariableAlign::Right,
            measure,
            role: VariableRole::Input,
        }
    }

    fn column(name: &str, values: impl Iterator<Item = DataValue>) -> Vec<DataRecord> {
        values
            .map(|value| DataRecord {
                values: HashMap::from([(name.to_string(), value)]),
            })
            .collect()
    }

    /// x1 separates the classes, x2 and x3 are noise; x3 is missing on some cases.
    fn data() -> AnalysisData {
        let number = |value: usize| DataValue::Number(value as f64);
        AnalysisData {
            target_data: vec![column(
                "y",
                (0..CASES).map(|i| DataValue::Number(if i < CASES / 2 { 1.0 } else { 2.0 })),
            )],
            features_data: vec![
                column("x1", (0..CASES).map(number)),
                column("x2", (0..CASES).map(|i| number(i * 7 % 13))),
                column(
                    "x3",
                    (0..CASES).map(|i| if i % 9 == 4 { DataValue::Null } else { number(i * 3 % 5) }),
                ),
            ],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("y", VariableMeasure::Nominal)]],
            features_data_defs: vec![
                vec![variable_def("x1", VariableMeasure::Scale)],
                vec![variable_def("x2", VariableMeasure::Scale)],
                vec![variable_def("x3", VariableMeasure::Scale)],
            ],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        }
    }

    /// Default dialog settings: random partition without a user seed.
    fn unseeded_selection_config() -> KnnConfig {
        serde_json::from_value(serde_json::json!({
            "main": {"TargetVar": "y", "FeatureVar": ["x1", "x2", "x3"], "CaseIdenVar": null,
                     "FocalCaseIdenVar": null, "NormCovar": true},
            "neighbors": {"Specify": true, "AutoSelection": false, "SpecifyK": 3, "MinK": null,
                          "MaxK": null, "MetricEucli": true, "MetricManhattan": false,
                          "Weight": false, "PredictionsMean": true, "PredictionsMedian": false},
            "features": {"ForwardSelection": ["x1", "x2", "x3"], "ForcedEntryVar": null,
                         "FeaturesToEvaluate": 0, "ForcedFeatures": 0, "PerformSelection": true,
                         "MaxReached": true, "BelowMin": false, "MaxToSelect": 2,
                         "MinChange": 0.01},
            "partition": {"SrcVar": null, "PartitioningVariable": null, "UseRandomly": true,
                          "UseVariable": false, "VFoldPartitioningVariable": null,
                          "VFoldUseRandomly": true, "VFoldUsePartitioningVar": false,
                          "TrainingNumber": 70, "NumPartition": 10, "SetSeed": false,
                          "Seed": null},
            "save": {"AutoName": true, "CustomName": false, "MaxCatsToSave": null,
                     "HasTargetVar": false, "IsCateTargetVar": false,
                     "RandomAssignToPartition": false, "RandomAssignToFold": false},
            "output": {"CaseSummary": true, "ChartAndTable": true}
        }))
        .unwrap()
    }

    fn raw_indices(features: &[&str], config: &KnnConfig) -> (Vec<usize>, Vec<usize>) {
        raw_indices_for(&data(), features, config)
    }

    fn raw_indices_for(
        data: &AnalysisData,
        features: &[&str],
        config: &KnnConfig,
    ) -> (Vec<usize>, Vec<usize>) {
        let mut subset_config = config.clone();
        subset_config.main.feature_var = Some(features.iter().map(|f| f.to_string()).collect());
        let knn_data = preprocess_knn_data(data, &subset_config).unwrap();
        let raw = |indices: &[usize]| {
            indices
                .iter()
                .map(|&idx| knn_data.processed_case_indices[idx])
                .collect::<Vec<_>>()
        };
        (raw(&knn_data.training_indices), raw(&knn_data.holdout_indices))
    }

    #[test]
    fn unseeded_run_keeps_one_training_holdout_split_for_every_feature_subset() {
        let config = prepare_run_config(&unseeded_selection_config());
        let reference = raw_indices(&["x1", "x2", "x3"], &config);

        assert!(!reference.0.is_empty() && !reference.1.is_empty());
        for subset in [&["x1"][..], &["x2"], &["x3"], &["x1", "x2"], &["x2", "x3"]] {
            assert_eq!(raw_indices(subset, &config), reference, "subset {subset:?}");
        }
        // Listwise deletion covers x3 even for subsets that do not use it.
        assert!(!reference.0.contains(&4) && !reference.1.contains(&4));
    }

    #[test]
    fn feature_selection_with_partition_variable_uses_training_cases_only() {
        // Partition variable: 1 = training, 0 = holdout (every third case).
        let with_partition = |mut data: AnalysisData| {
            data.case_data = Some(vec![column(
                "part",
                (0..CASES).map(|i| DataValue::Number(if i % 3 == 0 { 0.0 } else { 1.0 })),
            )]);
            data
        };
        let mut config = unseeded_selection_config();
        config.partition.use_randomly = false;
        config.partition.use_variable = true;
        config.partition.partitioning_variable = Some("part".to_string());
        let config = prepare_run_config(&config);

        let (training, holdout) = raw_indices_for(&with_partition(data()), &["x1"], &config);
        assert!(training.iter().all(|case_idx| case_idx % 3 != 0));
        assert!(holdout.iter().all(|case_idx| case_idx % 3 == 0));

        // Scramble every holdout target and feature value.
        let mut tampered = with_partition(data());
        for &case_idx in &holdout {
            tampered.target_data[0][case_idx]
                .values
                .insert("y".to_string(), DataValue::Number(3.0));
            for (dataset, name) in tampered.features_data.iter_mut().zip(["x1", "x2", "x3"]) {
                dataset[case_idx]
                    .values
                    .insert(name.to_string(), DataValue::Number(-500.0 - case_idx as f64));
            }
        }

        let original = calculate_feature_selection(&with_partition(data()), &config).unwrap();
        let with_tampered_holdout = calculate_feature_selection(&tampered, &config).unwrap();
        assert_eq!(original.selected_features, with_tampered_holdout.selected_features);
        assert_eq!(
            original.steps.iter().map(|step| step.trial_error).collect::<Vec<_>>(),
            with_tampered_holdout
                .steps
                .iter()
                .map(|step| step.trial_error)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn feature_selection_is_unaffected_by_holdout_values() {
        let config = prepare_run_config(&unseeded_selection_config());
        let (_, holdout) = raw_indices(&["x1", "x2", "x3"], &config);

        // Scramble every holdout target and feature value.
        let mut tampered = data();
        for &case_idx in &holdout {
            tampered.target_data[0][case_idx]
                .values
                .insert("y".to_string(), DataValue::Number(3.0));
            for (dataset, name) in tampered.features_data.iter_mut().zip(["x1", "x2", "x3"]) {
                dataset[case_idx]
                    .values
                    .insert(name.to_string(), DataValue::Number(1000.0 + case_idx as f64));
            }
        }

        for subset in [vec!["x1".to_string()], vec!["x2".to_string(), "x3".to_string()]] {
            assert_eq!(
                evaluate_subset(&data(), &config, &subset).unwrap(),
                evaluate_subset(&tampered, &config, &subset).unwrap(),
                "subset {subset:?}"
            );
        }

        let original = calculate_feature_selection(&data(), &config).unwrap();
        let with_tampered_holdout = calculate_feature_selection(&tampered, &config).unwrap();
        assert_eq!(original.selected_features, with_tampered_holdout.selected_features);
        assert_eq!(
            original.steps.iter().map(|step| step.trial_error).collect::<Vec<_>>(),
            with_tampered_holdout
                .steps
                .iter()
                .map(|step| step.trial_error)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn minimum_change_stops_when_next_error_is_zero() {
        assert_eq!(
            minimum_change_stop_reason(Some(10.0), 0.0, 0.05),
            Some("zero_error".to_string())
        );
        assert_eq!(
            minimum_change_stop_reason(None, 0.0, 0.05),
            Some("zero_error".to_string())
        );
    }

    #[test]
    fn minimum_change_stops_and_keeps_feature_for_small_improvement() {
        assert_eq!(
            minimum_change_stop_reason(Some(0.200), 0.198, 0.05),
            Some("minimum_change_reached".to_string())
        );
    }

    #[test]
    fn minimum_change_reverts_feature_for_large_deterioration() {
        assert_eq!(
            minimum_change_stop_reason(Some(0.10), 0.20, 0.05),
            Some("error_deteriorated".to_string())
        );
    }

    #[test]
    fn minimum_change_stops_and_keeps_feature_when_error_does_not_change() {
        assert_eq!(
            minimum_change_stop_reason(Some(0.10), 0.10, 0.05),
            Some("no_error_change".to_string())
        );
    }

    #[test]
    fn minimum_change_continues_for_meaningful_improvement() {
        assert_eq!(minimum_change_stop_reason(Some(0.20), 0.10, 0.05), None);
    }

    #[test]
    fn minimum_change_decides_exact_boundaries_by_formula_not_rounding() {
        use crate::stats::common::error_rate_percent;

        // 70 training cases, Δmin = 0.1: 10 -> 9 misclassified is a change of
        // exactly 0.1 (stop, keep feature); 5 -> 6 is an increase of exactly
        // 0.2 = 2Δmin (continue).
        assert_eq!(
            minimum_change_stop_reason(
                Some(error_rate_percent(10, 70)),
                error_rate_percent(9, 70),
                0.1
            ),
            Some("minimum_change_reached".to_string())
        );
        assert_eq!(
            minimum_change_stop_reason(
                Some(error_rate_percent(5, 70)),
                error_rate_percent(6, 70),
                0.1
            ),
            None
        );

        // Every training size and misclassification count whose change sits
        // exactly on Δmin or 2Δmin, for common Δmin values (num / den).
        for (min_change, num, den) in [(0.01, 1, 100), (0.05, 1, 20), (0.1, 1, 10), (0.2, 1, 5)] {
            for n in 10..=300usize {
                for before in 1..=n {
                    for after in 1..=n {
                        let previous = error_rate_percent(before, n);
                        let next = error_rate_percent(after, n);
                        let reason = minimum_change_stop_reason(Some(previous), next, min_change);

                        if after < before && (before - after) * den == before * num {
                            assert_eq!(
                                reason.as_deref(),
                                Some("minimum_change_reached"),
                                "Δmin={min_change} n={n} {before}->{after}"
                            );
                        }
                        if after > before && (after - before) * den == 2 * before * num {
                            assert_eq!(
                                reason, None,
                                "2Δmin={min_change} n={n} {before}->{after}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn minimum_change_treats_rounding_level_differences_as_no_change() {
        assert_eq!(
            minimum_change_stop_reason(Some(1234.5678), 1234.5678 + 1e-10, 0.01),
            Some("no_error_change".to_string())
        );
    }
}
