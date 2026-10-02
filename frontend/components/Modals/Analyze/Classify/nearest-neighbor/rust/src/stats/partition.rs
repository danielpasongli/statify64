use std::collections::HashMap;

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue},
};

use super::{
    common::{split_training_holdout, split_training_holdout_with_rng},
    numpy_random::{
        seeded_mt19937, shuffle_indices_numpy_compatible, shuffle_indices_numpy_compatible_with_rng,
    },
};

pub const EXCLUDED_FOLD: usize = usize::MAX;
type PartitionSplit = (Vec<usize>, Vec<usize>, Vec<usize>);
type PartitionAndFoldSplit = (Vec<usize>, Vec<usize>, Vec<usize>, Vec<usize>);

pub fn split_training_holdout_by_partition_config(
    data: &AnalysisData,
    config: &KnnConfig,
    processed_case_count: usize,
    processed_case_indices: &[usize],
) -> Result<(Vec<usize>, Vec<usize>), String> {
    let (training_indices, holdout_indices, _) =
        split_training_holdout_by_partition_config_detailed(
            data,
            config,
            processed_case_count,
            processed_case_indices,
        )?;

    Ok((training_indices, holdout_indices))
}

pub fn split_training_holdout_by_partition_config_detailed(
    data: &AnalysisData,
    config: &KnnConfig,
    processed_case_count: usize,
    processed_case_indices: &[usize],
) -> Result<PartitionSplit, String> {
    if config.partition.use_variable {
        if let Some(ref partition_var) = config.partition.partitioning_variable {
            return split_by_partition_variable(data, partition_var, processed_case_indices);
        }

        return Err("No partition variable specified".to_string());
    }

    if config.partition.use_randomly {
        let (training_indices, holdout_indices) =
            split_training_holdout_randomly(config, processed_case_count);
        return Ok((training_indices, holdout_indices, Vec::new()));
    }

    let indices: Vec<usize> = (0..processed_case_count).collect();
    Ok((indices, Vec::new(), Vec::new()))
}

pub fn split_partition_and_cross_validation_by_config(
    data: &AnalysisData,
    config: &KnnConfig,
    processed_case_count: usize,
    processed_case_indices: &[usize],
) -> Result<PartitionAndFoldSplit, String> {
    let effective_seed = if config.partition.set_seed {
        config.partition.seed
    } else {
        config.run.partition_seed
    };
    let mut rng = seeded_mt19937(effective_seed);

    let (training_indices, holdout_indices, excluded_indices) = if config.partition.use_variable {
        if let Some(ref partition_var) = config.partition.partitioning_variable {
            split_by_partition_variable(data, partition_var, processed_case_indices)?
        } else {
            return Err("No partition variable specified".to_string());
        }
    } else if config.partition.use_randomly {
        let (training_indices, holdout_indices) = split_training_holdout_with_rng(
            processed_case_count,
            config.partition.training_number,
            &mut rng,
        );
        (training_indices, holdout_indices, Vec::new())
    } else {
        ((0..processed_case_count).collect(), Vec::new(), Vec::new())
    };

    let cross_validation_folds = split_cross_validation_by_partition_config_for_training(
        data,
        config,
        processed_case_indices,
        &training_indices,
        &mut rng,
    )?;

    Ok((
        training_indices,
        holdout_indices,
        excluded_indices,
        cross_validation_folds,
    ))
}

pub fn split_cross_validation_by_partition_config(
    data: &AnalysisData,
    config: &KnnConfig,
    processed_case_indices: &[usize],
) -> Result<Vec<usize>, String> {
    if !is_cross_validation_enabled(config) {
        return Ok(vec![0; processed_case_indices.len()]);
    }

    if config.partition.v_fold_use_partitioning_var {
        if let Some(ref fold_var) = config.partition.v_fold_partitioning_variable {
            return split_cross_validation_by_variable(data, fold_var, processed_case_indices);
        }

        return Err("No cross-validation fold variable specified".to_string());
    }

    if config.partition.v_fold_use_randomly {
        return create_random_folds(
            processed_case_indices.len(),
            config.partition.num_partition,
            config.partition.set_seed,
            config.partition.seed,
        );
    }

    if processed_case_indices.len() < 2 {
        return Ok(vec![0; processed_case_indices.len()]);
    }

    let default_folds = 10.min(processed_case_indices.len()) as i32;
    create_k_fold_assignments(
        processed_case_indices.len(),
        default_folds,
        false,
        false,
        None,
    )
}

fn split_cross_validation_by_partition_config_for_training(
    data: &AnalysisData,
    config: &KnnConfig,
    processed_case_indices: &[usize],
    training_indices: &[usize],
    rng: &mut rand_mt::Mt,
) -> Result<Vec<usize>, String> {
    if !is_cross_validation_enabled(config) {
        return Ok(vec![EXCLUDED_FOLD; processed_case_indices.len()]);
    }

    if config.partition.v_fold_use_partitioning_var {
        if let Some(ref fold_var) = config.partition.v_fold_partitioning_variable {
            return split_cross_validation_by_variable_for_training(
                data,
                fold_var,
                processed_case_indices,
                training_indices,
            );
        }

        return Err("No cross-validation fold variable specified".to_string());
    }

    if config.partition.v_fold_use_randomly
        && config.partition.set_seed
        && config.partition.seed.is_some()
    {
        return create_random_folds_for_training(
            processed_case_indices.len(),
            training_indices,
            config.partition.num_partition,
            rng,
        );
    }

    if training_indices.len() < 2 {
        return Ok(vec![EXCLUDED_FOLD; processed_case_indices.len()]);
    }

    create_round_robin_fold_assignments_for_training(
        processed_case_indices.len(),
        training_indices,
        config.partition.num_partition,
    )
}

fn is_cross_validation_enabled(config: &KnnConfig) -> bool {
    config.neighbors.auto_selection && !config.features.perform_selection
}

fn split_training_holdout_randomly(
    config: &KnnConfig,
    processed_case_count: usize,
) -> (Vec<usize>, Vec<usize>) {
    split_training_holdout(
        processed_case_count,
        config.partition.training_number,
        config.partition.set_seed,
        config.partition.seed,
    )
}

fn split_by_partition_variable(
    data: &AnalysisData,
    partition_var: &str,
    processed_case_indices: &[usize],
) -> Result<PartitionSplit, String> {
    let mut training_indices = Vec::new();
    let mut holdout_indices = Vec::new();
    let mut excluded_indices = Vec::new();

    for (processed_idx, &raw_case_idx) in processed_case_indices.iter().enumerate() {
        let Some(value) = numeric_partition_value(raw_case_idx, partition_var, data) else {
            excluded_indices.push(processed_idx);
            continue;
        };

        if value > 0.0 {
            training_indices.push(processed_idx);
        } else {
            holdout_indices.push(processed_idx);
        }
    }

    if training_indices.is_empty() {
        return Err("No training cases found using partition variable".to_string());
    }

    Ok((training_indices, holdout_indices, excluded_indices))
}

fn split_cross_validation_by_variable(
    data: &AnalysisData,
    fold_var: &str,
    processed_case_indices: &[usize],
) -> Result<Vec<usize>, String> {
    let mut raw_fold_values = Vec::with_capacity(processed_case_indices.len());
    let mut unique_values = Vec::new();

    for &raw_case_idx in processed_case_indices {
        let raw_value = fold_partition_value(raw_case_idx, fold_var, data);

        if let Some(value) = raw_value {
            if !unique_values.contains(&value) {
                unique_values.push(value);
            }
        }

        raw_fold_values.push(raw_value);
    }

    if unique_values.len() < 2 && processed_case_indices.len() > 1 {
        return Err(format!(
            "Cross-validation fold variable '{}' must contain at least two fold groups",
            fold_var
        ));
    }

    let fold_lookup: HashMap<i64, usize> = unique_values
        .into_iter()
        .enumerate()
        .map(|(fold_idx, raw_value)| (raw_value, fold_idx))
        .collect();

    Ok(raw_fold_values
        .into_iter()
        .map(|raw_value| {
            raw_value
                .and_then(|value| fold_lookup.get(&value).copied())
                .unwrap_or(EXCLUDED_FOLD)
        })
        .collect())
}

fn split_cross_validation_by_variable_for_training(
    data: &AnalysisData,
    fold_var: &str,
    processed_case_indices: &[usize],
    training_indices: &[usize],
) -> Result<Vec<usize>, String> {
    let mut folds = vec![EXCLUDED_FOLD; processed_case_indices.len()];
    let mut raw_fold_values = Vec::with_capacity(training_indices.len());
    let mut unique_values = Vec::new();

    for &processed_idx in training_indices {
        let Some(&raw_case_idx) = processed_case_indices.get(processed_idx) else {
            continue;
        };
        let raw_value = fold_partition_value(raw_case_idx, fold_var, data);

        if let Some(value) = raw_value {
            if !unique_values.contains(&value) {
                unique_values.push(value);
            }
        }

        raw_fold_values.push((processed_idx, raw_value));
    }

    if unique_values.len() < 2 && training_indices.len() > 1 {
        return Err(format!(
            "Cross-validation fold variable '{}' must contain at least two fold groups among training cases",
            fold_var
        ));
    }

    let fold_lookup: HashMap<i64, usize> = unique_values
        .into_iter()
        .enumerate()
        .map(|(fold_idx, raw_value)| (raw_value, fold_idx))
        .collect();

    for (processed_idx, raw_value) in raw_fold_values {
        folds[processed_idx] = raw_value
            .and_then(|value| fold_lookup.get(&value).copied())
            .unwrap_or(EXCLUDED_FOLD);
    }

    Ok(folds)
}

fn create_random_folds(
    num_cases: usize,
    requested_num_folds: i32,
    use_seed: bool,
    seed: Option<i64>,
) -> Result<Vec<usize>, String> {
    create_k_fold_assignments(num_cases, requested_num_folds, true, use_seed, seed)
}

fn create_random_folds_for_training(
    num_cases: usize,
    training_indices: &[usize],
    requested_num_folds: i32,
    rng: &mut rand_mt::Mt,
) -> Result<Vec<usize>, String> {
    create_random_fold_assignments_for_training(
        num_cases,
        training_indices,
        requested_num_folds,
        rng,
    )
}

fn create_k_fold_assignments(
    num_cases: usize,
    requested_num_folds: i32,
    shuffle: bool,
    use_seed: bool,
    seed: Option<i64>,
) -> Result<Vec<usize>, String> {
    if requested_num_folds < 2 {
        return Err("Number of folds must be at least 2".to_string());
    }

    let num_folds = requested_num_folds as usize;
    if num_folds > num_cases {
        return Err("Number of folds cannot exceed the number of samples".to_string());
    }

    let mut indices: Vec<usize> = (0..num_cases).collect();

    if shuffle {
        let effective_seed = if use_seed { seed } else { None };
        shuffle_indices_numpy_compatible(&mut indices, effective_seed);
    }

    let base_size = num_cases / num_folds;
    let remainder = num_cases % num_folds;
    let mut folds = vec![EXCLUDED_FOLD; num_cases];
    let mut current = 0;

    for fold_idx in 0..num_folds {
        let fold_size = base_size + usize::from(fold_idx < remainder);
        let end = current + fold_size;

        for &sample_idx in &indices[current..end] {
            folds[sample_idx] = fold_idx;
        }

        current = end;
    }

    Ok(folds)
}

fn create_random_fold_assignments_for_training(
    num_cases: usize,
    training_indices: &[usize],
    requested_num_folds: i32,
    rng: &mut rand_mt::Mt,
) -> Result<Vec<usize>, String> {
    if requested_num_folds < 2 {
        return Err("Number of folds must be at least 2".to_string());
    }

    let num_folds = requested_num_folds as usize;
    if num_folds > training_indices.len() {
        return Err("Number of folds cannot exceed the number of training samples".to_string());
    }

    let mut shuffled_training_indices = training_indices.to_vec();
    shuffle_indices_numpy_compatible_with_rng(&mut shuffled_training_indices, rng);

    let mut folds = vec![EXCLUDED_FOLD; num_cases];
    for (position, sample_idx) in shuffled_training_indices.into_iter().enumerate() {
        if sample_idx < folds.len() {
            folds[sample_idx] = (position % num_folds) + 1;
        }
    }

    Ok(folds)
}

fn create_round_robin_fold_assignments_for_training(
    num_cases: usize,
    training_indices: &[usize],
    requested_num_folds: i32,
) -> Result<Vec<usize>, String> {
    if requested_num_folds < 2 {
        return Err("Number of folds must be at least 2".to_string());
    }

    let num_folds = requested_num_folds as usize;
    if num_folds > training_indices.len() {
        return Err("Number of folds cannot exceed the number of training samples".to_string());
    }

    let mut folds = vec![EXCLUDED_FOLD; num_cases];
    for (position, &sample_idx) in training_indices.iter().enumerate() {
        if sample_idx < folds.len() {
            folds[sample_idx] = (position % num_folds) + 1;
        }
    }

    Ok(folds)
}

pub fn has_valid_partitioning_values(
    data: &AnalysisData,
    config: &KnnConfig,
    raw_case_idx: usize,
) -> bool {
    if config.partition.use_variable {
        if let Some(ref partition_var) = config.partition.partitioning_variable {
            if numeric_partition_value(raw_case_idx, partition_var, data).is_none() {
                return false;
            }
        }
    }

    true
}

#[cfg(test)]
fn create_fold_variable_splits(folds: &[usize]) -> Vec<(Vec<usize>, Vec<usize>)> {
    let mut unique_folds = Vec::new();

    for &fold in folds {
        if fold != EXCLUDED_FOLD && !unique_folds.contains(&fold) {
            unique_folds.push(fold);
        }
    }

    unique_folds
        .into_iter()
        .map(|fold| {
            let mut train_index = Vec::new();
            let mut test_index = Vec::new();

            for (idx, &value) in folds.iter().enumerate() {
                if value == EXCLUDED_FOLD {
                    continue;
                }

                if value == fold {
                    test_index.push(idx);
                } else {
                    train_index.push(idx);
                }
            }

            (train_index, test_index)
        })
        .collect()
}

fn numeric_partition_value(case_idx: usize, var: &str, data: &AnalysisData) -> Option<f64> {
    match find_partition_value(case_idx, var, data) {
        Some(DataValue::Number(value)) if value.is_finite() => Some(*value),
        Some(DataValue::Text(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed
                    .parse::<f64>()
                    .ok()
                    .filter(|value| value.is_finite())
            }
        }
        _ => None,
    }
}

fn fold_partition_value(case_idx: usize, var: &str, data: &AnalysisData) -> Option<i64> {
    numeric_partition_value(case_idx, var, data).and_then(|value| {
        if value > 0.0 && value.fract().abs() < f64::EPSILON {
            Some(value as i64)
        } else {
            None
        }
    })
}

fn find_partition_value<'a>(
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::data::{AnalysisData, DataRecord, DataValue};

    use super::{
        create_fold_variable_splits, create_k_fold_assignments, split_by_partition_variable,
        split_cross_validation_by_variable, split_partition_and_cross_validation_by_config,
        EXCLUDED_FOLD,
    };

    fn record(name: &str, value: DataValue) -> DataRecord {
        let mut values = HashMap::new();
        values.insert(name.to_string(), value);
        DataRecord { values }
    }

    fn data_with_feature(name: &str, values: Vec<DataValue>) -> AnalysisData {
        AnalysisData {
            target_data: Vec::new(),
            features_data: vec![values
                .into_iter()
                .map(|value| record(name, value))
                .collect()],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        }
    }

    #[test]
    fn partition_variable_positive_train_non_positive_holdout_missing_excluded() {
        let data = data_with_feature(
            "partition",
            vec![
                DataValue::Number(1.0),
                DataValue::Number(0.0),
                DataValue::Number(-1.0),
                DataValue::Null,
                DataValue::Text("".to_string()),
                DataValue::Text("abc".to_string()),
                DataValue::Text("2".to_string()),
            ],
        );
        let processed_case_indices = vec![0, 1, 2, 3, 4, 5, 6];

        let (train, holdout, excluded) =
            split_by_partition_variable(&data, "partition", &processed_case_indices).unwrap();

        assert_eq!(train, vec![0, 6]);
        assert_eq!(holdout, vec![1, 2]);
        assert_eq!(excluded, vec![3, 4, 5]);
    }

    #[test]
    fn k_fold_balances_remainder_on_earliest_folds() {
        let folds = create_k_fold_assignments(10, 3, false, false, None).unwrap();
        let mut counts = vec![0; 3];

        for fold in folds {
            counts[fold] += 1;
        }

        assert_eq!(counts, vec![4, 3, 3]);
    }

    #[test]
    fn shuffled_k_fold_matches_sklearn_kfold_test_indices() {
        let folds = create_k_fold_assignments(10, 3, true, true, Some(1234)).unwrap();
        let test_indices_by_fold: Vec<Vec<usize>> = (0..3)
            .map(|fold| {
                folds
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, &value)| if value == fold { Some(idx) } else { None })
                    .collect()
            })
            .collect();

        assert_eq!(
            test_indices_by_fold,
            vec![vec![1, 2, 7, 9], vec![0, 4, 8], vec![3, 5, 6]]
        );
    }

    #[test]
    fn fold_variable_uses_unique_values_in_first_seen_order_and_excludes_missing_or_invalid() {
        let data = data_with_feature(
            "fold",
            vec![
                DataValue::Number(2.0),
                DataValue::Number(5.0),
                DataValue::Number(2.0),
                DataValue::Number(7.0),
                DataValue::Number(5.0),
                DataValue::Null,
                DataValue::Number(0.0),
                DataValue::Number(-1.0),
                DataValue::Number(3.5),
                DataValue::Text("abc".to_string()),
            ],
        );
        let processed_case_indices = vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        let folds =
            split_cross_validation_by_variable(&data, "fold", &processed_case_indices).unwrap();
        assert_eq!(
            folds,
            vec![
                0,
                1,
                0,
                2,
                1,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
            ]
        );

        let splits = create_fold_variable_splits(&folds);
        assert_eq!(splits[0], (vec![1, 3, 4], vec![0, 2]));
        assert_eq!(splits[1], (vec![0, 2, 3], vec![1, 4]));
        assert_eq!(splits[2], (vec![0, 1, 2, 4], vec![3]));
    }

    #[test]
    fn fold_variable_is_training_only_zero_is_missing_and_seed_is_ignored() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: vec![vec![
                record("x", DataValue::Number(10.0)),
                record("x", DataValue::Number(20.0)),
                record("x", DataValue::Number(30.0)),
                record("x", DataValue::Number(40.0)),
                record("x", DataValue::Number(50.0)),
            ]],
            focal_case_data: Vec::new(),
            case_data: Some(vec![vec![
                {
                    let mut values = HashMap::new();
                    values.insert("partition".to_string(), DataValue::Number(1.0));
                    values.insert("fold".to_string(), DataValue::Number(1.0));
                    DataRecord { values }
                },
                {
                    let mut values = HashMap::new();
                    values.insert("partition".to_string(), DataValue::Number(1.0));
                    values.insert("fold".to_string(), DataValue::Number(0.0));
                    DataRecord { values }
                },
                {
                    let mut values = HashMap::new();
                    values.insert("partition".to_string(), DataValue::Number(1.0));
                    values.insert("fold".to_string(), DataValue::Number(2.0));
                    DataRecord { values }
                },
                {
                    let mut values = HashMap::new();
                    values.insert("partition".to_string(), DataValue::Number(0.0));
                    values.insert("fold".to_string(), DataValue::Number(1.0));
                    DataRecord { values }
                },
                {
                    let mut values = HashMap::new();
                    values.insert("partition".to_string(), DataValue::Number(0.0));
                    values.insert("fold".to_string(), DataValue::Number(2.0));
                    DataRecord { values }
                },
            ]]),
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let processed_case_indices: Vec<usize> = (0..5).collect();
        let mut config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: false,
                auto_selection: true,
                specify_k: 1,
                min_k: Some(1),
                max_k: Some(3),
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
                partitioning_variable: Some("partition".to_string()),
                use_randomly: false,
                use_variable: true,
                v_fold_partitioning_variable: Some("fold".to_string()),
                v_fold_use_randomly: false,
                v_fold_use_partitioning_var: true,
                training_number: 70,
                num_partition: 2,
                set_seed: true,
                seed: Some(1234),
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

        let (train, holdout, _, seeded_folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            5,
            &processed_case_indices,
        )
        .unwrap();

        config.partition.seed = Some(9999);
        let (_, _, _, other_seed_folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            5,
            &processed_case_indices,
        )
        .unwrap();

        assert_eq!(train, vec![0, 1, 2]);
        assert_eq!(holdout, vec![3, 4]);
        assert_eq!(seeded_folds, other_seed_folds);
        assert_eq!(
            seeded_folds,
            vec![0, EXCLUDED_FOLD, 1, EXCLUDED_FOLD, EXCLUDED_FOLD]
        );
    }

    #[test]
    fn random_partition_then_random_folds_use_single_rng_sequence_and_training_only() {
        let data = data_with_feature(
            "x",
            (0..10)
                .map(|value| DataValue::Number(value as f64))
                .collect(),
        );
        let processed_case_indices: Vec<usize> = (0..10).collect();
        let config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: false,
                auto_selection: true,
                specify_k: 1,
                min_k: Some(1),
                max_k: Some(3),
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
                use_randomly: true,
                use_variable: false,
                v_fold_partitioning_variable: None,
                v_fold_use_randomly: true,
                v_fold_use_partitioning_var: false,
                training_number: 60,
                num_partition: 2,
                set_seed: true,
                seed: Some(1234),
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

        let (train, holdout, excluded, folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            10,
            &processed_case_indices,
        )
        .unwrap();

        assert_eq!(train, vec![0, 2, 5, 6]);
        assert_eq!(holdout, vec![1, 3, 4, 7, 8, 9]);
        assert!(excluded.is_empty());
        assert_eq!(
            folds,
            vec![
                1,
                EXCLUDED_FOLD,
                1,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
                2,
                2,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
                EXCLUDED_FOLD,
            ]
        );
    }

    #[test]
    fn random_fold_shuffles_training_cases_then_assigns_balanced_round_robin_folds() {
        let data = data_with_feature(
            "x",
            (0..10)
                .map(|value| DataValue::Number(value as f64))
                .collect(),
        );
        let processed_case_indices: Vec<usize> = (0..10).collect();
        let config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: false,
                auto_selection: true,
                specify_k: 1,
                min_k: Some(1),
                max_k: Some(3),
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
                v_fold_use_randomly: true,
                v_fold_use_partitioning_var: false,
                training_number: 70,
                num_partition: 3,
                set_seed: true,
                seed: Some(1234),
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

        let (_, holdout, _, folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            10,
            &processed_case_indices,
        )
        .unwrap();

        assert!(holdout.is_empty());
        assert_eq!(folds, vec![2, 1, 2, 1, 1, 2, 3, 1, 3, 3]);

        let mut counts = vec![0; 3];
        for fold in folds {
            counts[fold - 1] += 1;
        }
        assert_eq!(counts, vec![4, 3, 3]);
    }

    #[test]
    fn automatic_k_default_folds_are_training_only_round_robin() {
        let data = data_with_feature(
            "x",
            (0..10)
                .map(|value| DataValue::Number(value as f64))
                .collect(),
        );
        let processed_case_indices: Vec<usize> = (0..10).collect();
        let config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: false,
                auto_selection: true,
                specify_k: 1,
                min_k: Some(1),
                max_k: Some(3),
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
                num_partition: 5,
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

        let (_, _, _, folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            10,
            &processed_case_indices,
        )
        .unwrap();

        assert_eq!(folds, vec![1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn random_fold_without_seed_falls_back_to_round_robin() {
        let data = data_with_feature(
            "x",
            (0..6)
                .map(|value| DataValue::Number(value as f64))
                .collect(),
        );
        let processed_case_indices: Vec<usize> = (0..6).collect();
        let config = crate::models::config::KnnConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec!["x".to_string()]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: false,
            },
            neighbors: crate::models::config::NeighborsConfig {
                specify: false,
                auto_selection: true,
                specify_k: 1,
                min_k: Some(1),
                max_k: Some(3),
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
                v_fold_use_randomly: true,
                v_fold_use_partitioning_var: false,
                training_number: 70,
                num_partition: 3,
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

        let (_, _, _, folds) = split_partition_and_cross_validation_by_config(
            &data,
            &config,
            6,
            &processed_case_indices,
        )
        .unwrap();

        assert_eq!(folds, vec![1, 2, 3, 1, 2, 3]);
    }
}
