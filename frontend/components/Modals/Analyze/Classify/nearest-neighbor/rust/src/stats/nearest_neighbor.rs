use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData},
    result::{FocalNeighborSet, NearestNeighbors, NeighborDetail},
};

use super::core::{
    calculate_mean_prediction, calculate_median_prediction, calculate_predictor_importance,
    determine_effective_k, find_k_nearest_neighbors_with_weights, preprocess_knn_data,
};
use super::prediction::{calculate_categorical_prediction, CategoryTieBreaker};

/// Calculates nearest neighbors for the whole dataset
pub fn calculate_nearest_neighbors(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<NearestNeighbors, String> {
    // Preprocess data
    let knn_data = preprocess_knn_data(data, config)?;

    // Get focal case info
    let focal_indices =
        if !knn_data.focal_indices.is_empty() && config.main.focal_case_iden_var.is_some() {
            // If focal_case_iden_var is provided, use the focal indices from knn_data
            knn_data.focal_indices.clone()
        } else {
            // Otherwise, use all indices (not just training indices)
            let mut all_indices = Vec::new();
            for i in 0..knn_data.data_matrix.len() {
                all_indices.push(i);
            }
            all_indices
        };

    if focal_indices.is_empty() {
        return Err("No focal cases found".to_string());
    }

    // Determine k value - use auto-selection if specified
    let k = determine_effective_k(&knn_data, config)?;
    let feature_weights = if config.neighbors.weight {
        Some(calculate_predictor_importance(data, config)?.expanded_feature_weights)
    } else {
        None
    };

    let use_euclidean = config.neighbors.metric_eucli;
    let distance_metric = if use_euclidean {
        "Euclidean".to_string()
    } else {
        "Manhattan".to_string()
    };

    let prediction_method = numeric_prediction_method(&knn_data, config);

    // Process each focal point and find their neighbors
    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &knn_data.training_indices);

    let focal_neighbor_sets = focal_indices
        .iter()
        .map(|&focal_idx| {
            let focal_record = knn_data.case_identifiers[focal_idx];

            let candidate_pool = &knn_data.training_indices;

            // Training cases use leave-one-out neighbors from training.
            // Holdout/focal cases are compared only to training cases.
            let candidate_indices: Vec<usize> = candidate_pool
                .iter()
                .filter(|&&idx| idx != focal_idx)
                .copied()
                .collect();

            // Find k nearest neighbors to this focal case
            let neighbors = find_k_nearest_neighbors_with_weights(
                &knn_data.data_matrix[focal_idx],
                &knn_data.data_matrix,
                &candidate_indices,
                k,
                use_euclidean,
                Some(&knn_data.processed_case_indices),
                feature_weights.as_deref(),
            );

            // Create neighbor details
            let mut neighbor_details = Vec::with_capacity(neighbors.len());
            let mut distances = Vec::with_capacity(neighbors.len());

            let predicted_value = calculate_neighbor_prediction(&neighbors, &knn_data, config, &tie_breaker);

            for (idx, distance) in neighbors {
                let neighbor_id = knn_data.case_identifiers[idx];

                neighbor_details.push(NeighborDetail {
                    id: neighbor_id,
                    label: knn_data.case_labels.get(idx).cloned(),
                    row_number: Some(row_number(&knn_data, idx)),
                    distance,
                });
                distances.push(distance);
            }

            FocalNeighborSet {
                focal_record,
                focal_label: knn_data.case_labels.get(focal_idx).cloned(),
                focal_row_number: Some(row_number(&knn_data, focal_idx)),
                neighbors: neighbor_details,
                distances,
                predicted_value,
            }
        })
        .collect();

    Ok(NearestNeighbors {
        k_value: k,
        distance_metric,
        weighting_enabled: feature_weights.is_some(),
        prediction_method,
        focal_neighbor_sets,
    })
}

fn row_number(knn_data: &KnnData, idx: usize) -> usize {
    knn_data
        .processed_case_indices
        .get(idx)
        .copied()
        .unwrap_or(idx)
        + 1
}

fn numeric_prediction_method(
    knn_data: &crate::models::data::KnnData,
    config: &KnnConfig,
) -> Option<String> {
    if !knn_data.target_is_numeric_scale() {
        return None;
    }

    if config.neighbors.predictions_median {
        Some("Median".to_string())
    } else {
        Some("Mean".to_string())
    }
}

fn calculate_neighbor_prediction(
    neighbors: &[(usize, f64)],
    knn_data: &crate::models::data::KnnData,
    config: &KnnConfig,
    tie_breaker: &CategoryTieBreaker,
) -> Option<DataValue> {
    let prediction = if knn_data.target_is_numeric_scale() {
        if config.neighbors.predictions_median {
            calculate_median_prediction(neighbors, &knn_data.target_values)
        } else {
            calculate_mean_prediction(neighbors, &knn_data.target_values)
        }
    } else {
        calculate_categorical_prediction(neighbors, &knn_data.target_values, tie_breaker)
    };

    match prediction {
        DataValue::Null => None,
        value => Some(value),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::{
        config::{
            FeaturesConfig, KnnConfig, MainConfig, NeighborsConfig, OutputConfig, PartitionConfig,
            SaveConfig,
        },
        data::{
            AnalysisData, DataRecord, DataValue, VariableAlign, VariableDefinition,
            VariableMeasure, VariableRole, VariableType,
        },
    };

    use super::calculate_nearest_neighbors;

    #[test]
    fn categorical_neighbors_use_training_pool_for_training_and_holdout_cases() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("target", DataValue::Text("A".to_string())),
                record("target", DataValue::Text("B".to_string())),
                record("target", DataValue::Text("A".to_string())),
                record("target", DataValue::Text("A".to_string())),
            ]],
            features_data: vec![vec![
                record("x", DataValue::Number(0.0)),
                record("x", DataValue::Number(10.0)),
                record("x", DataValue::Number(0.1)),
                record("x", DataValue::Number(0.2)),
            ]],
            focal_case_data: Vec::new(),
            case_data: Some(vec![vec![
                record("partition", DataValue::Number(1.0)),
                record("partition", DataValue::Number(1.0)),
                record("partition", DataValue::Number(0.0)),
                record("partition", DataValue::Number(0.0)),
            ]]),
            target_data_defs: vec![vec![variable_def("target", VariableMeasure::Nominal)]],
            features_data_defs: vec![vec![variable_def("x", VariableMeasure::Scale)]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        let result = calculate_nearest_neighbors(&data, &config()).unwrap();
        let nearest_ids = result
            .focal_neighbor_sets
            .iter()
            .map(|set| (set.focal_record, set.neighbors[0].id))
            .collect::<Vec<_>>();

        assert_eq!(nearest_ids, vec![(1, 2), (2, 1), (3, 1), (4, 1)]);

        assert_eq!(result.focal_neighbor_sets[2].focal_row_number, Some(3));
        assert_eq!(
            result.focal_neighbor_sets[2]
                .neighbors
                .iter()
                .filter_map(|case| case.row_number)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn leave_one_out_excludes_only_the_focal_row_when_case_ids_are_duplicated() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("target", DataValue::Text("A".to_string())),
                record("target", DataValue::Text("B".to_string())),
                record("target", DataValue::Text("A".to_string())),
            ]],
            features_data: vec![vec![
                record("x", DataValue::Number(0.0)),
                record("x", DataValue::Number(1.0)),
                record("x", DataValue::Number(5.0)),
            ]],
            focal_case_data: Vec::new(),
            case_data: Some(vec![
                vec![
                    record("partition", DataValue::Number(1.0)),
                    record("partition", DataValue::Number(1.0)),
                    record("partition", DataValue::Number(1.0)),
                ],
                vec![
                    record("id", DataValue::Number(7.0)),
                    record("id", DataValue::Number(7.0)),
                    record("id", DataValue::Number(7.0)),
                ],
            ]),
            target_data_defs: vec![vec![variable_def("target", VariableMeasure::Nominal)]],
            features_data_defs: vec![vec![variable_def("x", VariableMeasure::Scale)]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let mut config = config();
        config.main.case_iden_var = Some("id".to_string());

        let result = calculate_nearest_neighbors(&data, &config).unwrap();
        let nearest_rows = result
            .focal_neighbor_sets
            .iter()
            .map(|set| {
                (
                    set.focal_row_number.unwrap(),
                    set.neighbors
                        .iter()
                        .filter_map(|case| case.row_number)
                        .collect::<Vec<_>>(),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            nearest_rows,
            vec![(1, vec![2]), (2, vec![1]), (3, vec![2])]
        );
    }

    fn record(name: &str, value: DataValue) -> DataRecord {
        let mut values = HashMap::new();
        values.insert(name.to_string(), value);
        DataRecord { values }
    }

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

    fn config() -> KnnConfig {
        KnnConfig {
            main: MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: NeighborsConfig {
                specify: true,
                auto_selection: false,
                specify_k: 1,
                min_k: None,
                max_k: None,
                metric_eucli: true,
                metric_manhattan: false,
                weight: false,
                predictions_mean: false,
                predictions_median: false,
            },
            features: FeaturesConfig {
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
            partition: PartitionConfig {
                src_var: None,
                partitioning_variable: Some("partition".to_string()),
                use_randomly: false,
                use_variable: true,
                v_fold_partitioning_variable: None,
                v_fold_use_randomly: false,
                v_fold_use_partitioning_var: false,
                training_number: 70,
                num_partition: 2,
                set_seed: false,
                seed: None,
            },
            save: SaveConfig {
                auto_name: true,
                custom_name: false,
                max_cats_to_save: None,
                has_target_var: false,
                is_cate_target_var: true,
                random_assign_to_partition: false,
                random_assign_to_fold: false,
                predicted_value_name: None,
                probability_name: None,
                partition_name: None,
                fold_name: None,
            },
            run: Default::default(),
            output: OutputConfig {
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
        }
    }
}
