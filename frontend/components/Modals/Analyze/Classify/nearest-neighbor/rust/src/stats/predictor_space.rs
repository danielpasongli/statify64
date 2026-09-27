use std::collections::HashMap;

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData, VariableDefinition, VariableMeasure},
    result::{
        DataPoint, NeighborDetail, PredictorAxis, PredictorAxisTick, PredictorDimension,
        PredictorSpace,
    },
};

use super::{
    core::{determine_effective_k, find_k_nearest_neighbors, preprocess_knn_data},
    prediction::{calculate_predictions, CategoryTieBreaker},
};

pub fn calculate_predictor_space(
    data: &AnalysisData,
    config: &KnnConfig,
) -> Result<PredictorSpace, String> {
    let knn_data = preprocess_knn_data(data, config)?;

    if knn_data.features.is_empty() {
        return Err("No features available for predictor space visualization".to_string());
    }

    let k = determine_effective_k(&knn_data, config)?;
    let feature_space = build_original_feature_space(data, config, &knn_data)?;
    let displayed_feature_indices: Vec<usize> = (0..feature_space.features.len()).collect();

    if displayed_feature_indices.is_empty() {
        return Err("No selected features available for predictor space visualization".to_string());
    }

    let display_indices: Vec<usize> = displayed_feature_indices.iter().copied().take(3).collect();
    let dimension_name = display_indices
        .iter()
        .filter_map(|idx| feature_space.features.get(*idx))
        .cloned()
        .collect::<Vec<_>>()
        .join(" vs ");

    let points = build_points(
        &knn_data,
        &feature_space.display_matrix,
        &display_indices,
        k,
        config.neighbors.metric_eucli,
        config,
    );

    Ok(PredictorSpace {
        model_predictors: displayed_feature_indices.len(),
        actual_predictors: feature_space.actual_predictors,
        target_variable: config.main.target_var.clone().unwrap_or_default(),
        target_measure: target_measure_label(&knn_data.target_measure).to_string(),
        has_focal_case_identifier: config.main.focal_case_iden_var.is_some(),
        k_value: k,
        dimensions: vec![PredictorDimension {
            name: dimension_name,
            axes: feature_space.axes,
            points,
        }],
    })
}

fn build_points(
    knn_data: &KnnData,
    display_matrix: &[Vec<f64>],
    display_indices: &[usize],
    k: usize,
    use_euclidean: bool,
    config: &KnnConfig,
) -> Vec<DataPoint> {
    let tie_breaker =
        CategoryTieBreaker::from_training(&knn_data.target_values, &knn_data.training_indices);
    display_matrix
        .iter()
        .enumerate()
        .filter(|(idx, _)| {
            !knn_data.target_is_numeric_scale() || knn_data.training_indices.contains(idx)
        })
        .filter_map(|(idx, display_row)| {
            let model_row = knn_data.data_matrix.get(idx)?;
            let x = feature_value(display_row, display_indices, 0)?;
            let y = feature_value(display_row, display_indices, 1).unwrap_or(0.0);
            let z = feature_value(display_row, display_indices, 2).unwrap_or(0.0);

            let point_type = if knn_data.training_indices.contains(&idx) {
                "Training".to_string()
            } else if knn_data.holdout_indices.contains(&idx) {
                "Holdout".to_string()
            } else {
                "Unknown".to_string()
            };

            let target = knn_data.target_values.get(idx).unwrap_or(&DataValue::Null);
            let actual_label = data_value_label(target);
            let target_value = match target {
                DataValue::Number(n) => *n > 0.5,
                DataValue::Boolean(b) => *b,
                DataValue::Text(s) => s == "1" || s.to_lowercase() == "true",
                DataValue::Null => false,
            };

            let focal_record = knn_data.case_identifiers[idx];
            let candidate_indices: Vec<usize> = knn_data
                .training_indices
                .iter()
                .copied()
                .filter(|&candidate_idx| {
                    candidate_idx < knn_data.case_identifiers.len()
                        && knn_data.case_identifiers[candidate_idx] != focal_record
                })
                .collect();

            let neighbor_pairs = find_k_nearest_neighbors(
                model_row,
                &knn_data.data_matrix,
                &candidate_indices,
                k,
                use_euclidean,
                Some(&knn_data.processed_case_indices),
            );
            let predicted_value = calculate_predictions(
                &neighbor_pairs,
                &knn_data.target_values,
                config,
                !knn_data.target_is_numeric_scale(),
                &tie_breaker,
            );
            let predicted_label = data_value_label(&predicted_value);
            let (display_target_label, target_number) = if point_type == "Holdout" {
                (predicted_label.clone(), data_value_number(&predicted_value))
            } else {
                (actual_label.clone(), data_value_number(target))
            };

            let neighbors = neighbor_pairs
                .into_iter()
                .map(|(neighbor_idx, distance)| NeighborDetail {
                    id: knn_data.case_identifiers[neighbor_idx],
                    label: knn_data.case_labels.get(neighbor_idx).cloned(),
                    row_number: knn_data
                        .processed_case_indices
                        .get(neighbor_idx)
                        .map(|idx| idx + 1),
                    distance,
                })
                .collect();

            Some(DataPoint {
                id: focal_record,
                label: knn_data
                    .case_labels
                    .get(idx)
                    .cloned()
                    .unwrap_or_else(|| focal_record.to_string()),
                x,
                y,
                z,
                predictor_values: display_row.clone(),
                focal: knn_data.focal_indices.contains(&idx),
                target_value,
                target_number,
                target_label: display_target_label,
                actual_label,
                predicted_label,
                point_type,
                neighbors,
            })
        })
        .collect()
}

struct OriginalFeatureSpace {
    actual_predictors: usize,
    features: Vec<String>,
    axes: Vec<PredictorAxis>,
    display_matrix: Vec<Vec<f64>>,
}

struct OriginalFeatureLayout {
    name: String,
    measure: VariableMeasure,
    original_index: usize,
}

fn build_original_feature_space(
    data: &AnalysisData,
    config: &KnnConfig,
    knn_data: &KnnData,
) -> Result<OriginalFeatureSpace, String> {
    let original_features = config
        .main
        .feature_var
        .clone()
        .unwrap_or_else(|| infer_original_features(data));

    if original_features.is_empty() {
        return Err("No features available for predictor space visualization".to_string());
    }

    let feature_defs: Vec<VariableDefinition> = data
        .features_data_defs
        .iter()
        .flat_map(|defs| defs.clone())
        .collect();
    let feature_measures = original_features
        .iter()
        .map(|feature| derive_variable_measure(feature, &feature_defs))
        .collect::<Vec<_>>();
    let category_maps = build_category_maps(
        data,
        &original_features,
        &feature_measures,
        &knn_data.processed_case_indices,
    );
    let selected_layout = build_original_feature_layout(&original_features, &feature_measures);

    let features = selected_layout
        .iter()
        .map(|feature| feature.name.clone())
        .collect::<Vec<_>>();
    let axes = selected_layout
        .iter()
        .map(|feature| PredictorAxis {
            name: feature.name.clone(),
            measure: target_measure_label(&feature.measure).to_string(),
            categories: feature_categories(feature, &category_maps),
            ticks: feature_ticks(
                feature,
                &category_maps,
                data,
                &knn_data.processed_case_indices,
            ),
        })
        .collect::<Vec<_>>();
    let display_matrix = knn_data
        .processed_case_indices
        .iter()
        .filter_map(|case_idx| {
            selected_layout
                .iter()
                .map(|feature| {
                    original_feature_display_value(*case_idx, feature, &category_maps, data)
                })
                .collect::<Option<Vec<_>>>()
        })
        .collect::<Vec<_>>();

    Ok(OriginalFeatureSpace {
        actual_predictors: original_features.len(),
        features,
        axes,
        display_matrix,
    })
}

fn infer_original_features(data: &AnalysisData) -> Vec<String> {
    let mut features = Vec::new();

    for dataset in &data.features_data {
        for record in dataset {
            for key in record.values.keys() {
                if !features.contains(key) {
                    features.push(key.clone());
                }
            }
        }
    }

    features
}

fn derive_variable_measure(variable: &str, defs: &[VariableDefinition]) -> VariableMeasure {
    defs.iter()
        .find(|def| def.name == variable)
        .map(|def| def.measure.clone())
        .unwrap_or(VariableMeasure::Unknown)
}

fn build_category_maps(
    data: &AnalysisData,
    features: &[String],
    feature_measures: &[VariableMeasure],
    case_indices: &[usize],
) -> Vec<HashMap<String, usize>> {
    let mut category_maps: Vec<HashMap<String, usize>> = vec![HashMap::new(); features.len()];

    for &case_idx in case_indices {
        for (feature_idx, feature) in features.iter().enumerate() {
            let measure = feature_measures
                .get(feature_idx)
                .unwrap_or(&VariableMeasure::Unknown);

            if !is_categorical(measure) {
                continue;
            }

            if let Some(category) = category_key(find_feature_value(case_idx, feature, data)) {
                if !category_maps[feature_idx].contains_key(&category) {
                    let next_idx = category_maps[feature_idx].len();
                    category_maps[feature_idx].insert(category, next_idx);
                }
            }
        }
    }

    category_maps
}

fn build_original_feature_layout(
    features: &[String],
    feature_measures: &[VariableMeasure],
) -> Vec<OriginalFeatureLayout> {
    features
        .iter()
        .enumerate()
        .map(|(feature_idx, name)| {
            let measure = feature_measures
                .get(feature_idx)
                .cloned()
                .unwrap_or(VariableMeasure::Unknown);
            OriginalFeatureLayout {
                name: name.clone(),
                measure,
                original_index: feature_idx,
            }
        })
        .collect()
}

fn original_feature_display_value(
    case_idx: usize,
    feature: &OriginalFeatureLayout,
    category_maps: &[HashMap<String, usize>],
    data: &AnalysisData,
) -> Option<f64> {
    match feature.measure {
        VariableMeasure::Nominal => category_index(case_idx, feature, category_maps, data),
        VariableMeasure::Ordinal => match find_feature_value(case_idx, &feature.name, data) {
            Some(DataValue::Number(value)) if value.is_finite() => Some(*value),
            Some(DataValue::Text(_)) | Some(DataValue::Boolean(_)) => {
                category_index(case_idx, feature, category_maps, data)
            }
            _ => None,
        },
        _ => match find_feature_value(case_idx, &feature.name, data) {
            Some(DataValue::Number(value)) if value.is_finite() => Some(*value),
            _ => None,
        },
    }
}

fn category_index(
    case_idx: usize,
    feature: &OriginalFeatureLayout,
    category_maps: &[HashMap<String, usize>],
    data: &AnalysisData,
) -> Option<f64> {
    let category = category_key(find_feature_value(case_idx, &feature.name, data))?;
    category_maps
        .get(feature.original_index)
        .and_then(|category_map| category_map.get(&category).copied())
        .map(|idx| idx as f64 + 1.0)
}

fn feature_categories(
    feature: &OriginalFeatureLayout,
    category_maps: &[HashMap<String, usize>],
) -> Vec<String> {
    if !is_categorical(&feature.measure) {
        return Vec::new();
    }

    category_labels(feature, category_maps)
}

fn feature_ticks(
    feature: &OriginalFeatureLayout,
    category_maps: &[HashMap<String, usize>],
    data: &AnalysisData,
    case_indices: &[usize],
) -> Vec<PredictorAxisTick> {
    if feature.measure == VariableMeasure::Ordinal
        && ordinal_uses_numeric_display(feature, data, case_indices)
    {
        return numeric_ordinal_ticks(feature, data, case_indices);
    }

    if !is_categorical(&feature.measure) {
        return Vec::new();
    }

    category_labels(feature, category_maps)
        .into_iter()
        .enumerate()
        .map(|(idx, label)| PredictorAxisTick {
            value: idx as f64 + 1.0,
            label,
        })
        .collect()
}

fn category_labels(
    feature: &OriginalFeatureLayout,
    category_maps: &[HashMap<String, usize>],
) -> Vec<String> {
    let mut categories = category_maps
        .get(feature.original_index)
        .map(|category_map| category_map.iter().collect::<Vec<_>>())
        .unwrap_or_default();
    categories.sort_by_key(|(_, idx)| **idx);
    categories
        .into_iter()
        .map(|(category, _)| category.clone())
        .collect()
}

fn numeric_ordinal_ticks(
    feature: &OriginalFeatureLayout,
    data: &AnalysisData,
    case_indices: &[usize],
) -> Vec<PredictorAxisTick> {
    let mut values = case_indices
        .iter()
        .filter_map(
            |case_idx| match find_feature_value(*case_idx, &feature.name, data) {
                Some(DataValue::Number(value)) if value.is_finite() => Some(*value),
                _ => None,
            },
        )
        .collect::<Vec<_>>();

    values.sort_by(|left, right| left.total_cmp(right));
    values.dedup_by(|left, right| (*left - *right).abs() <= f64::EPSILON);
    values
        .into_iter()
        .map(|value| PredictorAxisTick {
            value,
            label: data_value_label(&DataValue::Number(value)),
        })
        .collect()
}

fn ordinal_uses_numeric_display(
    feature: &OriginalFeatureLayout,
    data: &AnalysisData,
    case_indices: &[usize],
) -> bool {
    if feature.measure != VariableMeasure::Ordinal {
        return false;
    }

    case_indices.iter().all(|case_idx| {
        matches!(
            find_feature_value(*case_idx, &feature.name, data),
            Some(DataValue::Number(value)) if value.is_finite()
        )
    })
}

fn find_feature_value<'a>(
    case_idx: usize,
    var: &str,
    data: &'a AnalysisData,
) -> Option<&'a DataValue> {
    for dataset in &data.features_data {
        if case_idx < dataset.len() {
            if let Some(value) = dataset[case_idx].values.get(var) {
                return Some(value);
            }
        }
    }

    for dataset in &data.target_data {
        if case_idx < dataset.len() {
            if let Some(value) = dataset[case_idx].values.get(var) {
                return Some(value);
            }
        }
    }

    if let Some(case_data) = &data.case_data {
        for dataset in case_data {
            if case_idx < dataset.len() {
                if let Some(value) = dataset[case_idx].values.get(var) {
                    return Some(value);
                }
            }
        }
    }

    None
}

fn category_key(value: Option<&DataValue>) -> Option<String> {
    match value {
        Some(DataValue::Text(text)) if !text.trim().is_empty() => Some(text.clone()),
        Some(DataValue::Boolean(value)) => Some(value.to_string()),
        Some(DataValue::Number(value)) if value.is_finite() => Some(value.to_string()),
        _ => None,
    }
}

fn is_categorical(measure: &VariableMeasure) -> bool {
    *measure == VariableMeasure::Nominal || *measure == VariableMeasure::Ordinal
}

fn feature_value(row: &[f64], display_indices: &[usize], position: usize) -> Option<f64> {
    display_indices
        .get(position)
        .and_then(|feature_idx| row.get(*feature_idx))
        .copied()
        .filter(|value| value.is_finite())
}

fn data_value_label(value: &DataValue) -> String {
    match value {
        DataValue::Number(value) if value.is_finite() => value.to_string(),
        DataValue::Text(value) => value.clone(),
        DataValue::Boolean(value) => value.to_string(),
        DataValue::Null => String::new(),
        DataValue::Number(_) => String::new(),
    }
}

fn data_value_number(value: &DataValue) -> Option<f64> {
    match value {
        DataValue::Number(value) if value.is_finite() => Some(*value),
        _ => None,
    }
}

fn target_measure_label(measure: &VariableMeasure) -> &'static str {
    match measure {
        VariableMeasure::Scale => "scale",
        VariableMeasure::Ordinal => "ordinal",
        VariableMeasure::Nominal => "nominal",
        VariableMeasure::Unknown => "unknown",
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

    use super::calculate_predictor_space;

    #[test]
    fn categorical_predictor_is_collapsed_to_one_chart_dimension() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("class", DataValue::Text("A".to_string())),
                record("class", DataValue::Text("B".to_string())),
                record("class", DataValue::Text("A".to_string())),
            ]],
            features_data: vec![vec![
                record_many(vec![
                    ("x", DataValue::Number(1.0)),
                    ("group", DataValue::Text("red".to_string())),
                    ("y", DataValue::Number(10.0)),
                ]),
                record_many(vec![
                    ("x", DataValue::Number(2.0)),
                    ("group", DataValue::Text("blue".to_string())),
                    ("y", DataValue::Number(20.0)),
                ]),
                record_many(vec![
                    ("x", DataValue::Number(3.0)),
                    ("group", DataValue::Text("red".to_string())),
                    ("y", DataValue::Number(30.0)),
                ]),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("class", VariableMeasure::Nominal)]],
            features_data_defs: vec![vec![
                variable_def("x", VariableMeasure::Scale),
                variable_def("group", VariableMeasure::Nominal),
                variable_def("y", VariableMeasure::Scale),
            ]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        let space = calculate_predictor_space(&data, &config()).unwrap();
        let dimension = &space.dimensions[0];

        assert_eq!(space.model_predictors, 3);
        assert_eq!(space.actual_predictors, 3);
        assert_eq!(dimension.name, "x vs group vs y");
        assert_eq!(dimension.points[0].x, 1.0);
        assert_eq!(dimension.points[0].y, 1.0);
        assert_eq!(dimension.points[0].z, 10.0);
        assert_eq!(dimension.points[1].y, 2.0);
        assert_eq!(dimension.axes[1].name, "group");
        assert_eq!(dimension.axes[1].categories, vec!["red", "blue"]);
    }

    #[test]
    fn numeric_ordinal_predictor_keeps_numeric_ticks() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("class", DataValue::Text("A".to_string())),
                record("class", DataValue::Text("B".to_string())),
                record("class", DataValue::Text("A".to_string())),
            ]],
            features_data: vec![vec![
                record_many(vec![
                    ("rank", DataValue::Number(1.0)),
                    ("score", DataValue::Number(10.0)),
                ]),
                record_many(vec![
                    ("rank", DataValue::Number(2.0)),
                    ("score", DataValue::Number(20.0)),
                ]),
                record_many(vec![
                    ("rank", DataValue::Number(3.0)),
                    ("score", DataValue::Number(30.0)),
                ]),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("class", VariableMeasure::Nominal)]],
            features_data_defs: vec![vec![
                variable_def("rank", VariableMeasure::Ordinal),
                variable_def("score", VariableMeasure::Scale),
            ]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        let mut config = config();
        config.main.feature_var = Some(vec!["rank".to_string(), "score".to_string()]);

        let space = calculate_predictor_space(&data, &config).unwrap();
        let dimension = &space.dimensions[0];

        assert_eq!(dimension.axes[0].measure, "ordinal");
        assert_eq!(dimension.axes[0].categories, vec!["1", "2", "3"]);
        assert_eq!(
            dimension.axes[0]
                .ticks
                .iter()
                .map(|tick| (tick.value, tick.label.clone()))
                .collect::<Vec<_>>(),
            vec![
                (1.0, "1".to_string()),
                (2.0, "2".to_string()),
                (3.0, "3".to_string()),
            ]
        );
        assert_eq!(dimension.points[0].x, 1.0);
        assert_eq!(dimension.points[2].x, 3.0);
    }

    #[test]
    fn predictor_space_uses_first_three_features_in_input_order() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("class", DataValue::Text("A".to_string())),
                record("class", DataValue::Text("B".to_string())),
                record("class", DataValue::Text("A".to_string())),
            ]],
            features_data: vec![vec![
                record_many(vec![
                    ("first", DataValue::Number(1.0)),
                    ("second", DataValue::Number(10.0)),
                    ("third", DataValue::Number(100.0)),
                    ("fourth", DataValue::Number(1000.0)),
                ]),
                record_many(vec![
                    ("first", DataValue::Number(2.0)),
                    ("second", DataValue::Number(20.0)),
                    ("third", DataValue::Number(200.0)),
                    ("fourth", DataValue::Number(2000.0)),
                ]),
                record_many(vec![
                    ("first", DataValue::Number(3.0)),
                    ("second", DataValue::Number(30.0)),
                    ("third", DataValue::Number(300.0)),
                    ("fourth", DataValue::Number(3000.0)),
                ]),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("class", VariableMeasure::Nominal)]],
            features_data_defs: vec![vec![
                variable_def("first", VariableMeasure::Scale),
                variable_def("second", VariableMeasure::Scale),
                variable_def("third", VariableMeasure::Scale),
                variable_def("fourth", VariableMeasure::Scale),
            ]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        let mut config = config();
        config.main.feature_var = Some(vec![
            "first".to_string(),
            "second".to_string(),
            "third".to_string(),
            "fourth".to_string(),
        ]);

        let space = calculate_predictor_space(&data, &config).unwrap();
        let dimension = &space.dimensions[0];

        assert_eq!(space.model_predictors, 4);
        assert_eq!(space.actual_predictors, 4);
        assert_eq!(dimension.name, "first vs second vs third");
        assert_eq!(
            dimension
                .axes
                .iter()
                .map(|axis| axis.name.clone())
                .collect::<Vec<_>>(),
            vec!["first", "second", "third", "fourth"]
        );
        assert_eq!(dimension.points[0].x, 1.0);
        assert_eq!(dimension.points[0].y, 10.0);
        assert_eq!(dimension.points[0].z, 100.0);
        assert_eq!(
            dimension.points[0].predictor_values,
            vec![1.0, 10.0, 100.0, 1000.0]
        );
    }

    fn config() -> KnnConfig {
        KnnConfig {
            main: MainConfig {
                target_var: Some("class".to_string()),
                feature_var: Some(vec!["x".to_string(), "group".to_string(), "y".to_string()]),
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

    fn record(name: &str, value: DataValue) -> DataRecord {
        record_many(vec![(name, value)])
    }

    fn record_many(values: Vec<(&str, DataValue)>) -> DataRecord {
        DataRecord {
            values: values
                .into_iter()
                .map(|(name, value)| (name.to_string(), value))
                .collect::<HashMap<_, _>>(),
        }
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
}
