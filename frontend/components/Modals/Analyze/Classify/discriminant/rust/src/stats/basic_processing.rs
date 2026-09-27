use crate::models::{ result::ProcessingSummary, AnalysisData, DiscriminantConfig };
use crate::models::data::{ DataRecord, DataValue };

use super::common::EPSILON;

/// Analysis Case Processing Summary and Classification Processing Summary: valid
/// cases, and cases excluded for a missing or out-of-range group code, a missing
/// predictor, both, or the selection variable, each with its percentage of the total.
pub fn basic_processing_summary(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<ProcessingSummary, String> {
    crate::debug_log!("Executing basic_processing_summary");

    let total_cases: usize = data.group_data
        .iter()
        .map(|group| group.len())
        .sum();
    let min_range = config.define_range.min_range;
    let max_range = config.define_range.max_range;
    let group_var = &config.main.grouping_variable;

    // Each predictor lives in its own column of `independent_data`, whose records are
    // keyed by that predictor only, so a case is checked row by row in each
    // predictor's own column.
    let predictor_columns: Vec<(&String, Option<&Vec<DataRecord>>)> = config.main.independent_variables
        .iter()
        .filter(|v| *v != group_var)
        .map(|var| {
            let column = data.independent_data
                .iter()
                .find(|records| records.iter().any(|r| r.values.contains_key(var)));
            (var, column)
        })
        .collect();

    // Selection variable, with the rule of filter_valid_cases: applied only when both
    // a selection variable and a value are set; a numeric cell matches within
    // EPSILON, a text cell matches the value's string form, anything else does not.
    // Only selected cases enter the analysis, so the rest are counted as Unselected
    // (and not as valid), keeping Valid equal to the analysis N.
    let selection = match
        (&data.selection_data, &config.main.selection_variable, &config.set_value.value)
    {
        (Some(selection_data), Some(selection_var), Some(set_value)) => {
            let rows: Vec<&DataRecord> = selection_data.iter().flatten().collect();
            Some((rows, selection_var, *set_value))
        }
        _ => None,
    };
    let is_selected = |row: usize| -> bool {
        match &selection {
            None => true,
            Some((rows, selection_var, set_value)) =>
                match rows.get(row).and_then(|r| r.values.get(*selection_var)) {
                    Some(DataValue::Number(val)) => (val - set_value).abs() < EPSILON,
                    Some(DataValue::Text(s)) => s == &set_value.to_string(),
                    _ => false,
                }
        }
    };

    let mut unselected = 0;
    let mut missing_group_codes = 0;
    let mut missing_disc_vars = 0;
    let mut both_missing = 0;
    // The same three categories among the unselected cases. They stay out of the
    // analysis (counted as Unselected above), but they are classified, so they
    // enter the Classification Processing Summary.
    let mut unselected_missing_group = 0;
    let mut unselected_missing_disc = 0;
    let mut unselected_both = 0;

    for (row, record) in data.group_data.iter().flatten().enumerate() {
        let selected = is_selected(row);
        if !selected {
            unselected += 1;
        }

        let has_missing_group = match record.values.get(group_var) {
            Some(DataValue::Number(val)) =>
                val.is_nan() ||
                    min_range.map_or(false, |min| *val < min) ||
                    max_range.map_or(false, |max| *val > max),
            Some(DataValue::Null) => true,
            Some(DataValue::Text(s)) if s.trim().is_empty() => true,
            None => true,
            _ => false,
        };

        let has_missing_disc = predictor_columns.iter().any(|(var, column)| {
            match column.and_then(|c| c.get(row)).and_then(|r| r.values.get(*var)) {
                Some(DataValue::Number(val)) => val.is_nan(),
                Some(DataValue::Text(s)) => s.trim().is_empty(),
                Some(DataValue::Null) => true,
                None => true,
                _ => false,
            }
        });

        let (both, group_only, disc_only) = if selected {
            (&mut both_missing, &mut missing_group_codes, &mut missing_disc_vars)
        } else {
            (&mut unselected_both, &mut unselected_missing_group, &mut unselected_missing_disc)
        };
        if has_missing_group && has_missing_disc {
            *both += 1;
        } else if has_missing_group {
            *group_only += 1;
        } else if has_missing_disc {
            *disc_only += 1;
        }
    }

    let excluded_cases = unselected + missing_group_codes + missing_disc_vars + both_missing;
    let valid_cases = total_cases - excluded_cases;

    // Classification Processing Summary. Every case is processed: the selected ones
    // and, with a selection variable, the unselected ones (classified as the testing
    // part of a split). A missing or out-of-range group code does not exclude a case
    // from classification: SPSS (GROUPS subcommand) classifies it as an ungrouped
    // case, so that count stays 0. A missing predictor does exclude it, also when the
    // group code is missing too, unless "Replace missing values with mean" is on.
    let classification_processed = total_cases;
    let classification_missing_group_codes = 0;
    let classification_missing_disc_vars = if config.classify.replace {
        0
    } else {
        missing_disc_vars + both_missing + unselected_missing_disc + unselected_both
    };
    let classification_used_cases =
        classification_processed - classification_missing_group_codes - classification_missing_disc_vars;

    let calc_percent = |value: usize| -> f64 {
        if total_cases == 0 { 0.0 } else { ((value as f64) * 100.0) / (total_cases as f64) }
    };

    Ok(ProcessingSummary {
        valid_cases,
        excluded_cases,
        total_cases,
        valid_percent: Some(calc_percent(valid_cases)),
        missing_group_codes: Some(missing_group_codes),
        missing_group_percent: Some(calc_percent(missing_group_codes)),
        missing_disc_vars: Some(missing_disc_vars),
        missing_disc_percent: Some(calc_percent(missing_disc_vars)),
        both_missing: Some(both_missing),
        both_missing_percent: Some(calc_percent(both_missing)),
        total_excluded_percent: Some(calc_percent(excluded_cases)),
        unselected: Some(unselected),
        unselected_percent: Some(calc_percent(unselected)),
        classification_processed: Some(classification_processed),
        classification_missing_group_codes: Some(classification_missing_group_codes),
        classification_missing_disc_vars: Some(classification_missing_disc_vars),
        classification_used_cases: Some(classification_used_cases),
    })
}
