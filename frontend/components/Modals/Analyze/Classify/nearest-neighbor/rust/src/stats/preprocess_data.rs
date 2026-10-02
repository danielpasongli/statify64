use std::collections::{HashMap, HashSet};

use crate::models::{
    config::KnnConfig,
    data::{AnalysisData, DataValue, KnnData, VariableDefinition, VariableMeasure},
};

use super::partition::{
    has_valid_partitioning_values, split_partition_and_cross_validation_by_config,
};

pub fn preprocess_knn_data(data: &AnalysisData, config: &KnnConfig) -> Result<KnnData, String> {
    // Extract feature variables
    let features = match &config.main.feature_var {
        Some(vars) => vars.clone(),
        None => {
            // Auto-detect all feature names from features_data, regardless of null values
            if data.features_data.is_empty() {
                return Err("No features data provided".to_string());
            }

            // Collect all unique feature names across all records
            let mut feature_set = HashSet::new();
            for dataset in &data.features_data {
                for record in dataset {
                    for key in record.values.keys() {
                        feature_set.insert(key.clone());
                    }
                }
            }

            // Also check target_data for numeric features
            for dataset in &data.target_data {
                for record in dataset {
                    for (key, value) in &record.values {
                        if matches!(value, DataValue::Number(_)) {
                            feature_set.insert(key.clone());
                        }
                    }
                }
            }

            feature_set.into_iter().collect()
        }
    };

    if features.is_empty() {
        return Err("No valid features found".to_string());
    }

    let feature_defs: Vec<VariableDefinition> = data
        .features_data_defs
        .iter()
        .flat_map(|defs| defs.clone())
        .collect();
    let feature_measures = derive_feature_measures(&features, &feature_defs);

    // Get target variable
    let target_var = match &config.main.target_var {
        Some(var) => var.clone(),
        None => return Err("Target variable must be specified for KNN".to_string()),
    };
    let target_defs: Vec<VariableDefinition> = data
        .target_data_defs
        .iter()
        .flat_map(|defs| defs.clone())
        .collect();
    let target_measure = derive_variable_measure(&target_var, &target_defs);

    // Get number of cases - use maximum length across all datasets
    let num_cases = data
        .features_data
        .iter()
        .map(|ds| ds.len())
        .chain(data.target_data.iter().map(|ds| ds.len()))
        .chain(
            data.case_data
                .as_ref()
                .into_iter()
                .flat_map(|datasets| datasets.iter().map(|ds| ds.len())),
        )
        .max()
        .unwrap_or(0);

    if num_cases == 0 {
        return Err("No cases found in data".to_string());
    }

    // Create data matrix and extract target values
    let mut data_matrix = Vec::with_capacity(num_cases);
    let mut display_matrix = Vec::with_capacity(num_cases);
    let mut target_values = Vec::with_capacity(num_cases);
    let mut case_identifiers = Vec::with_capacity(num_cases);
    let mut case_labels = Vec::with_capacity(num_cases);
    let mut processed_case_indices = Vec::with_capacity(num_cases);

    // Get case identifier variable
    let case_ident_var = &config.main.case_iden_var;

    // Listwise deletion runs over every candidate feature of the analysis, not
    // only the current subset, so feature selection evaluates every subset on
    // the same cases and the same training/holdout split.
    let mut case_filter_features = config.run.case_filter_features.clone().unwrap_or_default();
    for feature in &features {
        if !case_filter_features.contains(feature) {
            case_filter_features.push(feature.clone());
        }
    }
    let case_filter_measures = derive_feature_measures(&case_filter_features, &feature_defs);

    let valid_case_indices = collect_valid_case_indices(
        data,
        &case_filter_features,
        &case_filter_measures,
        Some(target_var.as_str()),
    );
    let analysis_case_indices: Vec<usize> = valid_case_indices
        .into_iter()
        .filter(|&case_idx| has_valid_partitioning_values(data, config, case_idx))
        .collect();

    if analysis_case_indices.is_empty() {
        return Err("No valid data records after preprocessing".to_string());
    }

    let (training_indices, holdout_indices, excluded_indices, cross_validation_folds) =
        split_partition_and_cross_validation_by_config(
            data,
            config,
            analysis_case_indices.len(),
            &analysis_case_indices,
        )?;

    let training_case_indices = training_indices
        .iter()
        .filter_map(|processed_idx| analysis_case_indices.get(*processed_idx).copied())
        .collect::<Vec<_>>();

    let category_maps =
        build_category_maps(data, &features, &feature_measures, &training_case_indices);

    let expanded_feature_measures =
        build_expanded_feature_measures(&feature_measures, &category_maps);

    let mut old_to_new_processed_idx = vec![None; analysis_case_indices.len()];

    // Process each valid case
    for (old_processed_idx, &case_idx) in analysis_case_indices.iter().enumerate() {
        // Extract feature values for current case
        let row = match extract_feature_values_one_hot(
            case_idx,
            &features,
            &feature_measures,
            &category_maps,
            data,
        ) {
            Some(row) => row,
            None => continue, // Skip case if feature extraction failed
        };

        // Get target value if a target variable is specified
        let target_value = extract_target_value(case_idx, &target_var, data);

        if is_missing_target_value(&target_value) {
            continue;
        }

        // Get case identifier
        let case_id = extract_case_identifier(case_idx, case_ident_var, data);
        let case_label = extract_case_label(case_idx, case_ident_var, data);

        // Add the case to the data matrix
        old_to_new_processed_idx[old_processed_idx] = Some(data_matrix.len());
        data_matrix.push(row.clone());
        display_matrix.push(row);
        target_values.push(target_value);
        case_identifiers.push(case_id);
        case_labels.push(case_label);
        processed_case_indices.push(case_idx);
    }

    if data_matrix.is_empty() {
        return Err("No valid data records after preprocessing".to_string());
    }

    let (training_indices, holdout_indices, excluded_indices, cross_validation_folds) =
        remap_partition_outputs(
            &old_to_new_processed_idx,
            &training_indices,
            &holdout_indices,
            &excluded_indices,
            &cross_validation_folds,
        );

    // Normalize model features for distance calculations only when requested.
    if config.main.norm_covar {
        apply_training_based_normalization(
            &mut data_matrix,
            &expanded_feature_measures,
            &training_indices,
        );
    }

    // Identify focal cases
    let focal_indices = identify_focal_cases(
        &processed_case_indices,
        data,
        &config.main.focal_case_iden_var,
    );

    let expanded_features =
        build_expanded_feature_names(&features, &feature_measures, &category_maps);

    Ok(KnnData {
        features: expanded_features,
        data_matrix,
        display_matrix,
        target_values,
        target_measure,
        case_identifiers,
        case_labels,
        processed_case_indices,
        training_indices,
        holdout_indices,
        excluded_indices,
        cross_validation_folds,
        focal_indices,
    })
}

fn derive_feature_measures(
    features: &[String],
    defs: &[VariableDefinition],
) -> Vec<VariableMeasure> {
    features
        .iter()
        .map(|feature| {
            defs.iter()
                .find(|def| def.name == *feature)
                .map(|def| def.measure.clone())
                .unwrap_or(VariableMeasure::Unknown)
        })
        .collect()
}

fn derive_variable_measure(variable: &str, defs: &[VariableDefinition]) -> VariableMeasure {
    defs.iter()
        .find(|def| def.name == variable)
        .map(|def| def.measure.clone())
        .unwrap_or(VariableMeasure::Unknown)
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

fn count_cases(data: &AnalysisData) -> usize {
    data.features_data
        .iter()
        .map(|ds| ds.len())
        .chain(data.target_data.iter().map(|ds| ds.len()))
        .chain(
            data.case_data
                .as_ref()
                .into_iter()
                .flat_map(|datasets| datasets.iter().map(|ds| ds.len())),
        )
        .max()
        .unwrap_or(0)
}

fn collect_valid_case_indices(
    data: &AnalysisData,
    features: &[String],
    feature_measures: &[VariableMeasure],
    target_var: Option<&str>,
) -> Vec<usize> {
    let mut valid_case_indices = Vec::new();

    for case_idx in 0..count_cases(data) {
        let has_valid_features = features.iter().enumerate().all(|(feature_idx, var)| {
            let measure = feature_measures
                .get(feature_idx)
                .unwrap_or(&VariableMeasure::Unknown);

            match find_feature_value(case_idx, var, data) {
                Some(DataValue::Text(_)) | Some(DataValue::Boolean(_))
                    if is_categorical(measure) =>
                {
                    true
                }
                Some(DataValue::Number(n)) if is_categorical(measure) && n.is_finite() => true,
                Some(DataValue::Number(n)) if !is_categorical(measure) && n.is_finite() => true,
                _ => false,
            }
        });

        if !has_valid_features {
            continue;
        }

        if let Some(target_var_name) = target_var {
            let target_value = extract_target_value(case_idx, target_var_name, data);
            if is_missing_target_value(&target_value) {
                continue;
            }
        }

        valid_case_indices.push(case_idx);
    }

    valid_case_indices
}

fn build_category_maps(
    data: &AnalysisData,
    features: &[String],
    feature_measures: &[VariableMeasure],
    valid_case_indices: &[usize],
) -> Vec<HashMap<String, usize>> {
    let mut category_maps: Vec<HashMap<String, usize>> = vec![HashMap::new(); features.len()];

    for &case_idx in valid_case_indices {
        for (feature_idx, var) in features.iter().enumerate() {
            let measure = feature_measures
                .get(feature_idx)
                .unwrap_or(&VariableMeasure::Unknown);

            if !is_categorical(measure) {
                continue;
            }

            let category_opt = category_key(find_feature_value(case_idx, var, data));

            if let Some(category) = category_opt {
                if !category_maps[feature_idx].contains_key(&category) {
                    let next_idx = category_maps[feature_idx].len();
                    category_maps[feature_idx].insert(category, next_idx);
                }
            }
        }
    }

    category_maps
}

fn extract_feature_values_one_hot(
    case_idx: usize,
    features: &[String],
    feature_measures: &[VariableMeasure],
    category_maps: &[HashMap<String, usize>],
    data: &AnalysisData,
) -> Option<Vec<f64>> {
    let mut row = Vec::new();

    for (feature_idx, var) in features.iter().enumerate() {
        let measure = feature_measures
            .get(feature_idx)
            .unwrap_or(&VariableMeasure::Unknown);

        if is_categorical(measure) {
            let category = category_key(find_feature_value(case_idx, var, data))?;

            let category_map = category_maps.get(feature_idx)?;
            let category_idx = category_map.get(&category)?;

            for i in 0..category_map.len() {
                row.push(if i == *category_idx { 1.0 } else { 0.0 });
            }
        } else {
            match find_feature_value(case_idx, var, data) {
                Some(DataValue::Number(n)) if n.is_finite() => row.push(*n),
                _ => return None,
            }
        }
    }

    Some(row)
}

fn remap_partition_outputs(
    old_to_new_processed_idx: &[Option<usize>],
    training_indices: &[usize],
    holdout_indices: &[usize],
    excluded_indices: &[usize],
    cross_validation_folds: &[usize],
) -> (Vec<usize>, Vec<usize>, Vec<usize>, Vec<usize>) {
    let remap_indices = |indices: &[usize]| -> Vec<usize> {
        indices
            .iter()
            .filter_map(|idx| {
                old_to_new_processed_idx
                    .get(*idx)
                    .and_then(|mapped| *mapped)
            })
            .collect()
    };

    let mut remapped_folds = vec![
        super::partition::EXCLUDED_FOLD;
        old_to_new_processed_idx
            .iter()
            .filter(|idx| idx.is_some())
            .count()
    ];

    for (old_idx, new_idx) in old_to_new_processed_idx.iter().enumerate() {
        let Some(new_idx) = new_idx else {
            continue;
        };

        if let Some(fold) = cross_validation_folds.get(old_idx) {
            remapped_folds[*new_idx] = *fold;
        }
    }

    (
        remap_indices(training_indices),
        remap_indices(holdout_indices),
        remap_indices(excluded_indices),
        remapped_folds,
    )
}

fn category_key(value: Option<&DataValue>) -> Option<String> {
    match value {
        Some(DataValue::Text(text)) if !text.trim().is_empty() => Some(text.clone()),
        Some(DataValue::Boolean(value)) => Some(value.to_string()),
        Some(DataValue::Number(value)) if value.is_finite() => Some(value.to_string()),
        _ => None,
    }
}

fn build_expanded_feature_measures(
    feature_measures: &[VariableMeasure],
    category_maps: &[HashMap<String, usize>],
) -> Vec<VariableMeasure> {
    let mut expanded = Vec::new();

    for (i, measure) in feature_measures.iter().enumerate() {
        if is_categorical(measure) {
            for _ in 0..category_maps[i].len() {
                expanded.push(measure.clone());
            }
        } else {
            expanded.push(measure.clone());
        }
    }

    expanded
}

fn build_expanded_feature_names(
    features: &[String],
    feature_measures: &[VariableMeasure],
    category_maps: &[HashMap<String, usize>],
) -> Vec<String> {
    let mut expanded = Vec::new();

    for (i, feature) in features.iter().enumerate() {
        let measure = feature_measures.get(i).unwrap_or(&VariableMeasure::Unknown);

        if is_categorical(measure) {
            let mut categories: Vec<(&String, &usize)> = category_maps[i].iter().collect();

            categories.sort_by_key(|(_, idx)| **idx);

            for (category, _) in categories {
                expanded.push(format!("{}={}", feature, category));
            }
        } else {
            expanded.push(feature.clone());
        }
    }

    expanded
}

#[derive(Clone, Debug, PartialEq)]
pub struct FeatureScaler {
    pub min: f64,
    pub max: f64,
}

fn apply_training_based_normalization(
    data_matrix: &mut [Vec<f64>],
    feature_measures: &[VariableMeasure],
    training_indices: &[usize],
) {
    let scalers = fit_feature_scalers(data_matrix, feature_measures, training_indices);
    transform_with_feature_scalers(data_matrix, feature_measures, &scalers);
}

fn fit_feature_scalers(
    data_matrix: &[Vec<f64>],
    feature_measures: &[VariableMeasure],
    training_indices: &[usize],
) -> Vec<Option<FeatureScaler>> {
    if data_matrix.is_empty() {
        return Vec::new();
    }

    let n_features = data_matrix[0].len();
    let mut scalers = Vec::with_capacity(n_features);
    let training_index_set: HashSet<usize> = training_indices.iter().copied().collect();

    for j in 0..n_features {
        let measure = feature_measures.get(j).unwrap_or(&VariableMeasure::Unknown);
        if is_categorical(measure) {
            scalers.push(None);
            continue;
        }

        let finite_values: Vec<f64> = data_matrix
            .iter()
            .enumerate()
            .filter(|(row_idx, _)| training_index_set.contains(row_idx))
            .map(|(_, row)| row)
            .filter_map(|row| row.get(j).copied())
            .filter(|value| value.is_finite())
            .collect();

        if finite_values.is_empty() {
            scalers.push(None);
            continue;
        }

        let min_val = finite_values.iter().copied().fold(f64::INFINITY, f64::min);
        let max_val = finite_values
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);

        scalers.push(Some(FeatureScaler {
            min: min_val,
            max: max_val,
        }));
    }

    scalers
}

fn transform_with_feature_scalers(
    data_matrix: &mut [Vec<f64>],
    feature_measures: &[VariableMeasure],
    scalers: &[Option<FeatureScaler>],
) {
    for (j, scaler) in scalers.iter().enumerate() {
        let measure = feature_measures.get(j).unwrap_or(&VariableMeasure::Unknown);
        if is_categorical(measure) {
            continue;
        }

        let Some(scaler) = scaler else {
            continue;
        };

        for row in data_matrix.iter_mut() {
            if let Some(value) = row.get_mut(j) {
                if value.is_finite() {
                    if (scaler.max - scaler.min).abs() < f64::EPSILON {
                        *value = 0.0;
                    } else {
                        *value = (2.0 * (*value - scaler.min)) / (scaler.max - scaler.min) - 1.0;
                    }
                }
            }
        }
    }
}

fn is_categorical(measure: &VariableMeasure) -> bool {
    *measure == VariableMeasure::Nominal || *measure == VariableMeasure::Ordinal
}

/// Helper function to extract target value for a case
fn extract_target_value(case_idx: usize, target_var_name: &str, data: &AnalysisData) -> DataValue {
    for dataset in &data.target_data {
        if case_idx < dataset.len() {
            if let Some(val) = dataset[case_idx].values.get(target_var_name) {
                return val.clone();
            }
        }
    }

    DataValue::Null
}

fn is_missing_target_value(value: &DataValue) -> bool {
    match value {
        DataValue::Null => true,
        DataValue::Text(s) => s.trim().is_empty(),
        DataValue::Number(n) => !n.is_finite(),
        DataValue::Boolean(_) => false,
    }
}

/// Helper function to extract case identifier
fn extract_case_identifier(
    case_idx: usize,
    case_ident_var: &Option<String>,
    data: &AnalysisData,
) -> i32 {
    // Default to case index + 1 if no identifier is found
    let default_id = (case_idx + 1) as i32;

    if let Some(id_var) = case_ident_var {
        // Try features_data first
        for dataset in &data.features_data {
            if case_idx < dataset.len() {
                if let Some(id) = dataset[case_idx]
                    .values
                    .get(id_var)
                    .and_then(data_value_to_identifier)
                {
                    return id;
                }
            }
        }

        // Then try target_data
        for dataset in &data.target_data {
            if case_idx < dataset.len() {
                if let Some(id) = dataset[case_idx]
                    .values
                    .get(id_var)
                    .and_then(data_value_to_identifier)
                {
                    return id;
                }
            }
        }

        // Finally try case_data, which is where the frontend sends CaseIdenVar.
        if let Some(case_data) = &data.case_data {
            for dataset in case_data {
                if case_idx < dataset.len() {
                    if let Some(id) = dataset[case_idx]
                        .values
                        .get(id_var)
                        .and_then(data_value_to_identifier)
                    {
                        return id;
                    }
                }
            }
        }
    }

    default_id
}

fn data_value_to_identifier(value: &DataValue) -> Option<i32> {
    match value {
        DataValue::Number(id) if id.is_finite() => Some(*id as i32),
        DataValue::Text(id) => id.trim().parse::<i32>().ok(),
        _ => None,
    }
}

/// A case is focal when its focal-case variable holds a positive number.
/// Zero, negative, missing, or non-numeric values mark a non-focal case.
fn is_focal_case(case_idx: usize, focal_var: &str, data: &AnalysisData) -> bool {
    matches!(
        find_focal_identifier_value(case_idx, focal_var, data),
        Some(DataValue::Number(value)) if value.is_finite() && *value > 0.0
    )
}

fn find_focal_identifier_value<'a>(
    case_idx: usize,
    focal_var: &str,
    data: &'a AnalysisData,
) -> Option<&'a DataValue> {
    for dataset in &data.focal_case_data {
        if case_idx < dataset.len() {
            if let Some(value) = dataset[case_idx].values.get(focal_var) {
                return Some(value);
            }
        }
    }

    None
}

fn extract_case_label(
    case_idx: usize,
    case_ident_var: &Option<String>,
    data: &AnalysisData,
) -> String {
    let default_label = (case_idx + 1).to_string();

    let Some(id_var) = case_ident_var else {
        return default_label;
    };

    for dataset in &data.features_data {
        if case_idx < dataset.len() {
            if let Some(label) = dataset[case_idx]
                .values
                .get(id_var)
                .and_then(data_value_to_label)
            {
                return label;
            }
        }
    }

    for dataset in &data.target_data {
        if case_idx < dataset.len() {
            if let Some(label) = dataset[case_idx]
                .values
                .get(id_var)
                .and_then(data_value_to_label)
            {
                return label;
            }
        }
    }

    if let Some(case_data) = &data.case_data {
        for dataset in case_data {
            if case_idx < dataset.len() {
                if let Some(label) = dataset[case_idx]
                    .values
                    .get(id_var)
                    .and_then(data_value_to_label)
                {
                    return label;
                }
            }
        }
    }

    default_label
}

fn data_value_to_label(value: &DataValue) -> Option<String> {
    match value {
        DataValue::Number(value) if value.is_finite() => Some(value.to_string()),
        DataValue::Text(value) if !value.trim().is_empty() => Some(value.clone()),
        DataValue::Boolean(value) => Some(value.to_string()),
        _ => None,
    }
}

/// Helper function to identify focal cases.
/// `processed_case_indices` maps each processed row to its original data row.
fn identify_focal_cases(
    processed_case_indices: &[usize],
    data: &AnalysisData,
    focal_var: &Option<String>,
) -> Vec<usize> {
    let mut focal_indices = Vec::new();

    if let Some(focal_var) = focal_var {
        focal_indices = processed_case_indices
            .iter()
            .enumerate()
            .filter(|(_, &case_idx)| is_focal_case(case_idx, focal_var, data))
            .map(|(processed_idx, _)| processed_idx)
            .collect();
    }

    // Default to first case if no focal cases found
    if focal_indices.is_empty() && !processed_case_indices.is_empty() {
        focal_indices.push(0);
    }

    focal_indices
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

    use super::{
        apply_training_based_normalization, build_category_maps, collect_valid_case_indices,
        extract_case_identifier, extract_feature_values_one_hot, fit_feature_scalers,
        identify_focal_cases, preprocess_knn_data,
        transform_with_feature_scalers, FeatureScaler,
    };

    #[test]
    fn adjusted_normalization_scales_continuous_columns_and_skips_one_hot() {
        let mut matrix = vec![vec![10.0, 1.0], vec![20.0, 0.0], vec![30.0, 1.0]];
        let measures = vec![VariableMeasure::Scale, VariableMeasure::Nominal];
        let training_indices = vec![0, 1, 2];

        apply_training_based_normalization(&mut matrix, &measures, &training_indices);

        assert_eq!(matrix[0], vec![-1.0, 1.0]);
        assert_eq!(matrix[1], vec![0.0, 0.0]);
        assert_eq!(matrix[2], vec![1.0, 1.0]);
    }

    #[test]
    fn adjusted_normalization_constant_continuous_column_becomes_zero() {
        let mut matrix = vec![vec![5.0], vec![5.0], vec![5.0]];
        let measures = vec![VariableMeasure::Scale];
        let training_indices = vec![0, 1, 2];

        apply_training_based_normalization(&mut matrix, &measures, &training_indices);

        assert_eq!(matrix, vec![vec![0.0], vec![0.0], vec![0.0]]);
    }

    #[test]
    fn feature_scalers_are_fit_from_training_rows_only() {
        let matrix = vec![vec![10.0], vec![11.0], vec![15.0], vec![19.0]];
        let measures = vec![VariableMeasure::Scale];
        let training_indices = vec![1, 2, 3];

        let scalers = fit_feature_scalers(&matrix, &measures, &training_indices);

        assert_eq!(
            scalers,
            vec![Some(FeatureScaler {
                min: 11.0,
                max: 19.0
            })]
        );
    }

    #[test]
    fn training_fitted_scalers_transform_training_and_holdout_rows() {
        let mut matrix = vec![vec![10.0], vec![11.0], vec![15.0], vec![19.0]];
        let measures = vec![VariableMeasure::Scale];
        let scalers = vec![Some(FeatureScaler {
            min: 11.0,
            max: 19.0,
        })];

        transform_with_feature_scalers(&mut matrix, &measures, &scalers);

        assert_eq!(matrix[0], vec![-1.25]);
        assert_eq!(matrix[1], vec![-1.0]);
        assert_eq!(matrix[2], vec![0.0]);
        assert_eq!(matrix[3], vec![1.0]);
    }

    #[test]
    fn adjusted_normalized_difference_uses_training_range() {
        let mut matrix = vec![vec![10.0], vec![11.0], vec![14.0], vec![15.0], vec![19.0]];
        let measures = vec![VariableMeasure::Scale];
        let training_indices = vec![1, 2, 3, 4];
        let scalers = fit_feature_scalers(&matrix, &measures, &training_indices);

        transform_with_feature_scalers(&mut matrix, &measures, &scalers);

        let diff = (matrix[3][0] - matrix[2][0]).abs();
        assert!((diff - 0.25).abs() <= f64::EPSILON);
    }

    #[test]
    fn numeric_categorical_features_are_one_hot_encoded() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: vec![vec![
                record("group", DataValue::Number(1.0)),
                record("group", DataValue::Number(2.0)),
                record("group", DataValue::Number(1.0)),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let features = vec!["group".to_string()];
        let measures = vec![VariableMeasure::Nominal];
        let valid_indices = collect_valid_case_indices(&data, &features, &measures, None);
        let category_maps = build_category_maps(&data, &features, &measures, &valid_indices);

        assert_eq!(valid_indices, vec![0, 1, 2]);
        assert_eq!(
            extract_feature_values_one_hot(0, &features, &measures, &category_maps, &data),
            Some(vec![1.0, 0.0])
        );
        assert_eq!(
            extract_feature_values_one_hot(1, &features, &measures, &category_maps, &data),
            Some(vec![0.0, 1.0])
        );
    }

    #[test]
    fn text_ordinal_features_are_full_one_hot_encoded() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: vec![vec![
                record("education", DataValue::Text("SD".to_string())),
                record("education", DataValue::Text("SMP".to_string())),
                record("education", DataValue::Text("SMA".to_string())),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let features = vec!["education".to_string()];
        let measures = vec![VariableMeasure::Ordinal];
        let valid_indices = collect_valid_case_indices(&data, &features, &measures, None);
        let category_maps = build_category_maps(&data, &features, &measures, &valid_indices);

        assert_eq!(
            extract_feature_values_one_hot(0, &features, &measures, &category_maps, &data),
            Some(vec![1.0, 0.0, 0.0])
        );
        assert_eq!(
            extract_feature_values_one_hot(1, &features, &measures, &category_maps, &data),
            Some(vec![0.0, 1.0, 0.0])
        );
        assert_eq!(
            extract_feature_values_one_hot(2, &features, &measures, &category_maps, &data),
            Some(vec![0.0, 0.0, 1.0])
        );
    }

    #[test]
    fn numeric_ordinal_features_are_full_one_hot_encoded() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: vec![vec![
                record("rank", DataValue::Number(1.0)),
                record("rank", DataValue::Number(2.0)),
                record("rank", DataValue::Number(3.0)),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let features = vec!["rank".to_string()];
        let measures = vec![VariableMeasure::Ordinal];
        let valid_indices = collect_valid_case_indices(&data, &features, &measures, None);
        let category_maps = build_category_maps(&data, &features, &measures, &valid_indices);

        assert_eq!(
            extract_feature_values_one_hot(0, &features, &measures, &category_maps, &data),
            Some(vec![1.0, 0.0, 0.0])
        );
        assert_eq!(
            extract_feature_values_one_hot(2, &features, &measures, &category_maps, &data),
            Some(vec![0.0, 0.0, 1.0])
        );
    }

    #[test]
    fn preprocessing_builds_final_distance_vector_for_spss_style_knn_when_normalized() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("target", DataValue::Number(1.0)),
                record("target", DataValue::Number(2.0)),
                record("target", DataValue::Number(3.0)),
            ]],
            features_data: vec![vec![
                record_many(vec![
                    ("score", DataValue::Number(10.0)),
                    ("rank", DataValue::Text("low".to_string())),
                    ("device", DataValue::Text("Android".to_string())),
                ]),
                record_many(vec![
                    ("score", DataValue::Number(20.0)),
                    ("rank", DataValue::Text("medium".to_string())),
                    ("device", DataValue::Text("iOS".to_string())),
                ]),
                record_many(vec![
                    ("score", DataValue::Number(30.0)),
                    ("rank", DataValue::Text("high".to_string())),
                    ("device", DataValue::Text("Desktop".to_string())),
                ]),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("target", VariableMeasure::Scale)]],
            features_data_defs: vec![vec![
                variable_def("score", VariableMeasure::Scale),
                variable_def("rank", VariableMeasure::Ordinal),
                variable_def("device", VariableMeasure::Nominal),
            ]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let config = config();

        let knn_data = preprocess_knn_data(&data, &config).unwrap();

        assert_eq!(
            knn_data.features,
            vec![
                "score",
                "rank=low",
                "rank=medium",
                "rank=high",
                "device=Android",
                "device=iOS",
                "device=Desktop"
            ]
        );
        assert_eq!(
            knn_data.data_matrix,
            vec![
                vec![-1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0],
                vec![1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            ]
        );
    }

    #[test]
    fn preprocessing_keeps_scale_raw_and_ordinal_one_hot_when_normalization_is_off() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("target", DataValue::Number(1.0)),
                record("target", DataValue::Number(2.0)),
                record("target", DataValue::Number(3.0)),
            ]],
            features_data: vec![vec![
                record_many(vec![
                    ("score", DataValue::Number(10.0)),
                    ("rank", DataValue::Text("low".to_string())),
                    ("device", DataValue::Text("Android".to_string())),
                ]),
                record_many(vec![
                    ("score", DataValue::Number(20.0)),
                    ("rank", DataValue::Text("medium".to_string())),
                    ("device", DataValue::Text("iOS".to_string())),
                ]),
                record_many(vec![
                    ("score", DataValue::Number(30.0)),
                    ("rank", DataValue::Text("high".to_string())),
                    ("device", DataValue::Text("Desktop".to_string())),
                ]),
            ]],
            focal_case_data: Vec::new(),
            case_data: None,
            target_data_defs: vec![vec![variable_def("target", VariableMeasure::Scale)]],
            features_data_defs: vec![vec![
                variable_def("score", VariableMeasure::Scale),
                variable_def("rank", VariableMeasure::Ordinal),
                variable_def("device", VariableMeasure::Nominal),
            ]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let mut config = config();
        config.main.norm_covar = false;

        let knn_data = preprocess_knn_data(&data, &config).unwrap();

        assert_eq!(
            knn_data.data_matrix,
            vec![
                vec![10.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                vec![20.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0],
                vec![30.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            ]
        );
    }

    #[test]
    fn nominal_one_hot_categories_are_fit_from_training_cases_only_and_unknown_holdout_excluded() {
        let data = AnalysisData {
            target_data: vec![vec![
                record("target", DataValue::Number(1.0)),
                record("target", DataValue::Number(2.0)),
                record("target", DataValue::Number(3.0)),
            ]],
            features_data: vec![vec![
                record("device", DataValue::Text("Android".to_string())),
                record("device", DataValue::Text("Desktop".to_string())),
                record("device", DataValue::Text("iPhone".to_string())),
            ]],
            focal_case_data: Vec::new(),
            case_data: Some(vec![vec![
                record("partition", DataValue::Number(1.0)),
                record("partition", DataValue::Number(1.0)),
                record("partition", DataValue::Number(0.0)),
            ]]),
            target_data_defs: vec![vec![variable_def("target", VariableMeasure::Scale)]],
            features_data_defs: vec![vec![variable_def("device", VariableMeasure::Nominal)]],
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };
        let mut config = config();
        config.main.feature_var = Some(vec!["device".to_string()]);
        config.partition.use_variable = true;
        config.partition.partitioning_variable = Some("partition".to_string());

        let knn_data = preprocess_knn_data(&data, &config).unwrap();

        assert_eq!(knn_data.features, vec!["device=Android", "device=Desktop"]);
        assert_eq!(knn_data.processed_case_indices, vec![0, 1]);
        assert_eq!(knn_data.training_indices, vec![0, 1]);
        assert!(knn_data.holdout_indices.is_empty());
        assert_eq!(knn_data.data_matrix, vec![vec![1.0, 0.0], vec![0.0, 1.0]]);
    }

    #[test]
    fn case_identifier_is_read_from_case_data() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: vec![vec![
                record("feature", DataValue::Number(10.0)),
                record("feature", DataValue::Number(20.0)),
            ]],
            focal_case_data: Vec::new(),
            case_data: Some(vec![vec![
                record("case_id", DataValue::Number(101.0)),
                record("case_id", DataValue::Number(202.0)),
            ]]),
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        assert_eq!(
            extract_case_identifier(1, &Some("case_id".to_string()), &data),
            202
        );
    }

    #[test]
    fn focal_cases_are_rows_with_positive_focal_values() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: Vec::new(),
            focal_case_data: vec![vec![
                record("focal", DataValue::Number(0.0)),
                record("focal", DataValue::Number(1.0)),
                record("focal", DataValue::Null),
                record("focal", DataValue::Number(-2.0)),
                record("focal", DataValue::Text("1".to_string())),
                record("focal", DataValue::Number(7.0)),
            ]],
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        // Processed rows map to original rows 0..=5, focal ones are rows 1 and 5.
        assert_eq!(
            identify_focal_cases(&[0, 1, 2, 3, 4, 5], &data, &Some("focal".to_string())),
            vec![1, 5]
        );

        // Processed indices are returned even when some original rows were dropped.
        assert_eq!(
            identify_focal_cases(&[0, 3, 5], &data, &Some("focal".to_string())),
            vec![2]
        );
    }

    #[test]
    fn focal_cases_default_to_first_case_when_none_marked() {
        let data = AnalysisData {
            target_data: Vec::new(),
            features_data: Vec::new(),
            focal_case_data: vec![vec![
                record("focal", DataValue::Number(0.0)),
                record("focal", DataValue::Null),
            ]],
            case_data: None,
            target_data_defs: Vec::new(),
            features_data_defs: Vec::new(),
            focal_case_data_defs: Vec::new(),
            case_data_defs: None,
        };

        assert_eq!(
            identify_focal_cases(&[0, 1], &data, &Some("focal".to_string())),
            vec![0]
        );
    }

    fn record(name: &str, value: DataValue) -> DataRecord {
        record_many(vec![(name, value)])
    }

    fn record_many(values: Vec<(&str, DataValue)>) -> DataRecord {
        let mut record_values = HashMap::new();
        for (name, value) in values {
            record_values.insert(name.to_string(), value);
        }
        DataRecord {
            values: record_values,
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

    fn config() -> KnnConfig {
        KnnConfig {
            main: MainConfig {
                target_var: Some("target".to_string()),
                feature_var: Some(vec![
                    "score".to_string(),
                    "rank".to_string(),
                    "device".to_string(),
                ]),
                case_iden_var: None,
                focal_case_iden_var: None,
                norm_covar: true,
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
                is_cate_target_var: false,
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
