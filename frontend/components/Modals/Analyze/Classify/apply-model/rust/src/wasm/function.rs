// Fungsi yang dipanggil dari binding WASM (`constructor.rs`).
//
// PLAN.md Fase 9: `run_apply_model` — pipeline GENERIK di atas
// `ClassifierScorer` (validasi payload §5.8 -> `build_scorer` -> `score_row`
// per baris -> posterior/argmax -> ringkasan -> warnings).
//
// PLAN.md Fase 10: `run_apply_model` ditambah parameter `actual` /
// `actual_defs` (§3.6) dan mengisi `evaluation` bila `actual` tidak kosong
// (`stats::evaluation`, §5.7) + warning `AM_W_ACTUAL_UNKNOWN_CLASS`. Dummy
// Fase 6 (`build_dummy_result`) DIHAPUS: `constructor.rs` sekarang memanggil
// `run_apply_model` sekali dan `get_formatted_results` hanya
// menserialisasi hasilnya (pola `NB/rust/src/wasm/function.rs`).
//
// Kontrak data `run_apply_model` mengikuti AGENTS.md §3.6: satu slice per
// fitur (`Vec<Vec<DataRecord>>`) dengan urutan = `mapping` = `features()`
// model, nilai sel dibaca lewat `record.values[mapping[i].variable]`, pola
// sama dengan `extract_value` di `naive-bayes/rust/src/stats/preprocess_data.rs`
// (sel hilang -> `DataValue::Null`). Actual: `[]` atau tepat satu slice;
// nama variabelnya dibaca dari `actual_defs[0][0].name`.
use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::JsValue;

use crate::models::data::{DataRecord, DataValue, VariableDefinition, VariableMeasure};
use crate::models::payload::MappingEntry;
use crate::models::result::{
    ApplyModelRawResult, ModelSummary, ModelSummaryFeature, ModelSummaryParameter,
};
use crate::scoring::{build_scorer, ClassifierScorer, FeatureRole, FeatureSpec};
use crate::stats::evaluation::{actual_unknown_class_warning, build_evaluation};
use crate::stats::summary::{build_warnings, resolve_row, summarize_rows, RowOutcome};
use crate::utils::error::ErrorCollector;

/// Serialisasi hasil ke JS. Serializer kustom (pola
/// `NB/rust/src/wasm/function.rs::get_formatted_results`):
/// `serialize_maps_as_objects(true)` supaya `serde_json::Value` objek
/// (confusion_matrix/evaluation_metrics) menjadi object JS polos, bukan `Map`;
/// `serialize_missing_as_null(true)` supaya `None` (predicted/evaluation)
/// menjadi `null`, bukan `undefined` (sisi TS membandingkan dengan `null`).
pub fn get_formatted_results(result: &Option<ApplyModelRawResult>) -> Result<JsValue, JsValue> {
    match result {
        Some(result) => {
            let serializer = serde_wasm_bindgen::Serializer::new()
                .serialize_maps_as_objects(true)
                .serialize_missing_as_null(true);
            result
                .serialize(&serializer)
                .map_err(|e| JsValue::from_str(&format!("AM_E_SERIALIZE: {}", e)))
        }
        None => Err(JsValue::from_str(
            "AM_E_PAYLOAD: hasil Apply Model tidak tersedia",
        )),
    }
}

/// Pipeline scoring penuh + evaluasi opsional (PLAN.md Fase 9 langkah 3,
/// Fase 10 langkah 2).
///
/// - `predictors`: satu slice per fitur, urutan = `mapping` = `features()`.
/// - `predictor_defs`: `VariableDefinition[]` per slice (hasil `getVarDefs`).
/// - `mapping`: pasangan fitur model -> variabel dataset, urutan sama.
/// - `actual` / `actual_defs`: `[]` (tanpa evaluasi) atau tepat satu slice /
///   satu defs untuk variabel target sebenarnya.
/// - `model`: isi file model apa adanya.
///
/// Semua error berbentuk `"AM_E_XXX: detail"` (AGENTS.md §4.5, P3).
pub fn run_apply_model(
    predictors: &[Vec<DataRecord>],
    predictor_defs: &[Vec<VariableDefinition>],
    mapping: &[MappingEntry],
    actual: &[Vec<DataRecord>],
    actual_defs: &[Vec<VariableDefinition>],
    model: &Value,
) -> Result<ApplyModelRawResult, String> {
    let scorer = build_scorer(model)?;

    validate_payload(scorer.features(), predictors, predictor_defs, mapping)?;
    let actual_variable = actual_variable_name(actual, actual_defs)?;

    // Jumlah baris = slice terpanjang (pola `count_cases` NB), supaya baris
    // yang kosong di sebagian slice tetap terhitung.
    let total_rows = predictors.iter().map(|slice| slice.len()).max().unwrap_or(0);
    if total_rows == 0 {
        return Err(
            "AM_E_NO_ROWS: dataset aktif tidak berisi baris data pada variabel yang dipetakan"
                .to_string(),
        );
    }

    let classes = scorer.classes();
    let outcomes: Vec<RowOutcome> = (0..total_rows)
        .map(|row| {
            let values = row_values(predictors, mapping, row);
            resolve_row(classes, scorer.score_row(&values))
        })
        .collect();

    let summary = summarize_rows(classes, &outcomes);
    let mut warnings = build_warnings(&summary, scorer.is_legacy_unseen_handling());

    // Evaluasi hanya bila `actual` tidak kosong (AGENTS.md §5.7).
    let evaluation = match (actual_variable, actual.first()) {
        (Some(variable), Some(slice)) => {
            let actual_values = actual_row_values(slice, &variable, total_rows);
            let evaluation = build_evaluation(classes, &outcomes, &actual_values);
            if let Some(warning) =
                actual_unknown_class_warning(evaluation.excluded_actual_unknown_class)
            {
                warnings.push(warning);
            }
            Some(evaluation)
        }
        _ => None,
    };

    Ok(ApplyModelRawResult {
        model_summary: build_model_summary(scorer.as_ref(), model, mapping),
        case_processing_summary: summary.case_processing_summary,
        prediction_distribution: summary.prediction_distribution,
        predictions: summary.predictions,
        evaluation,
        warnings,
    })
}

fn payload_error(detail: &str) -> String {
    format!("AM_E_PAYLOAD: {}", detail)
}

/// Validasi bagian actual payload (AGENTS.md §3.6): `actual` & `actualDefs`
/// keduanya `[]` (tanpa evaluasi -> `None`) atau keduanya tepat satu slice
/// dengan defs tidak kosong (-> nama variabel actual). Selain itu
/// `AM_E_PAYLOAD`.
fn actual_variable_name(
    actual: &[Vec<DataRecord>],
    actual_defs: &[Vec<VariableDefinition>],
) -> Result<Option<String>, String> {
    if actual.is_empty() && actual_defs.is_empty() {
        return Ok(None);
    }

    if actual.len() != 1 || actual_defs.len() != 1 {
        return Err(payload_error(&format!(
            "actual ({}) dan actualDefs ({}) harus kosong atau masing-masing berisi tepat satu slice",
            actual.len(),
            actual_defs.len()
        )));
    }

    match actual_defs[0].first() {
        Some(def) => Ok(Some(def.name.clone())),
        None => Err(payload_error("actualDefs[0] kosong")),
    }
}

/// Nilai sel actual per baris (0..total_rows). Sel yang tidak ada -> `Null`.
fn actual_row_values(slice: &[DataRecord], variable: &str, total_rows: usize) -> Vec<DataValue> {
    (0..total_rows)
        .map(|row| {
            slice
                .get(row)
                .and_then(|record| record.values.get(variable))
                .cloned()
                .unwrap_or(DataValue::Null)
        })
        .collect()
}

/// Validasi payload (AGENTS.md §5.8): panjang keempat larik sama dengan
/// jumlah fitur, `mapping[i].feature == features()[i].name`, dan measure
/// `predictorDefs[i]` cocok dengan peran fitur (lapis kedua `AM_E_MAP_ROLE_MISMATCH`).
fn validate_payload(
    features: &[FeatureSpec],
    predictors: &[Vec<DataRecord>],
    predictor_defs: &[Vec<VariableDefinition>],
    mapping: &[MappingEntry],
) -> Result<(), String> {
    let feature_count = features.len();
    if predictors.len() != feature_count
        || predictor_defs.len() != feature_count
        || mapping.len() != feature_count
    {
        return Err(payload_error(&format!(
            "jumlah predictors ({}), predictorDefs ({}), dan mapping ({}) harus sama dengan jumlah fitur model ({})",
            predictors.len(),
            predictor_defs.len(),
            mapping.len(),
            feature_count
        )));
    }

    for (index, ((feature, entry), defs)) in features
        .iter()
        .zip(mapping.iter())
        .zip(predictor_defs.iter())
        .enumerate()
    {
        if entry.feature != feature.name {
            return Err(payload_error(&format!(
                "mapping[{}].feature \"{}\" tidak sama dengan fitur model \"{}\"",
                index, entry.feature, feature.name
            )));
        }

        let def = match defs.first() {
            Some(def) => def,
            None => {
                return Err(payload_error(&format!(
                    "predictorDefs[{}] kosong untuk fitur \"{}\"",
                    index, feature.name
                )));
            }
        };

        // Pemetaan peran <-> measure (AGENTS.md §3.4): nominal/ordinal <->
        // categorical; scale <-> numerical. `unknown` tidak cocok dengan keduanya.
        let compatible = matches!(
            (feature.role, &def.measure),
            (
                FeatureRole::Categorical,
                VariableMeasure::Nominal | VariableMeasure::Ordinal
            ) | (FeatureRole::Numerical, VariableMeasure::Scale)
        );
        if !compatible {
            return Err(format!("AM_E_MAP_ROLE_MISMATCH: {}", feature.name));
        }
    }

    Ok(())
}

/// Nilai sel satu baris, urutan = `mapping`. Sel yang tidak ada -> `Null`.
fn row_values(
    predictors: &[Vec<DataRecord>],
    mapping: &[MappingEntry],
    row: usize,
) -> Vec<DataValue> {
    predictors
        .iter()
        .zip(mapping.iter())
        .map(|(slice, entry)| {
            slice
                .get(row)
                .and_then(|record| record.values.get(&entry.variable))
                .cloned()
                .unwrap_or(DataValue::Null)
        })
        .collect()
}

/// `model_summary` dari scorer + mapping. `trained_at` dan `target.name`
/// dibaca dari JSON model (kontrak file ekspor, AGENTS.md P1) karena trait
/// `ClassifierScorer` tidak menyediakannya.
fn build_model_summary(
    scorer: &dyn ClassifierScorer,
    model: &Value,
    mapping: &[MappingEntry],
) -> ModelSummary {
    let trained_at = model
        .get("trained_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let target_name = model
        .get("target")
        .and_then(|t| t.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let features: Vec<ModelSummaryFeature> = scorer
        .features()
        .iter()
        .zip(mapping.iter())
        .map(|(feature, entry)| ModelSummaryFeature {
            name: feature.name.clone(),
            role: feature.role.as_str().to_string(),
            mapped_variable: entry.variable.clone(),
        })
        .collect();

    let parameters: Vec<ModelSummaryParameter> = scorer
        .summary_parameters()
        .into_iter()
        .map(|(label, value)| ModelSummaryParameter { label, value })
        .collect();

    ModelSummary {
        model_type: scorer.model_type().to_string(),
        schema_version: scorer.schema_version().to_string(),
        trained_at,
        target_name,
        classes: scorer.classes().to_vec(),
        features,
        parameters,
        legacy_unseen_handling: scorer.is_legacy_unseen_handling(),
    }
}

pub fn get_all_errors(error_collector: &ErrorCollector) -> JsValue {
    JsValue::from_str(&error_collector.get_error_summary())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data::{VariableAlign, VariableRole, VariableType};
    use serde_json::json;
    use std::collections::HashMap;

    /// D1 — fixture model schema 1.1 (PLAN.md §1), nilai persis.
    const D1_JSON: &str = r#"{
  "schema_version": "1.1",
  "model_type": "naive_bayes",
  "trained_at": "2026-10-01T00:00:00.000Z",
  "target": { "name": "Play", "classes": ["No", "Yes"], "class_priors": [0.5, 0.5], "class_counts": [3, 3] },
  "features": [
    { "name": "Outlook", "role": "categorical", "categories": ["Overcast", "Rain", "Sunny"],
      "distribution": { "No": [0.5, 0.16666666666666666, 0.3333333333333333],
                        "Yes": [0.16666666666666666, 0.3333333333333333, 0.5] },
      "class_totals": { "No": 3, "Yes": 3 } },
    { "name": "Temp", "role": "numerical",
      "mean": { "No": 84.0, "Yes": 72.0 },
      "variance": { "No": 18.666666666666668, "Yes": 2.6666666666666665 } }
  ],
  "smoothing_alpha": 1.0,
  "variance_floor": 1e-9,
  "feature_order": ["Outlook", "Temp"],
  "label_mapping": { "No": 0, "Yes": 1 },
  "validation_config": { "method": "holdout", "training_percentage": 70, "holdout_percentage": 30, "folds": null, "seed": 42 },
  "missing_value_policy": "x",
  "unseen_category_policy": "x"
}"#;

    fn d1() -> Value {
        serde_json::from_str(D1_JSON).unwrap()
    }

    /// D2 — sama dengan D1, schema 1.0, tanpa `class_counts` & `class_totals`.
    fn d2() -> Value {
        let mut v = d1();
        v["schema_version"] = json!("1.0");
        v["target"].as_object_mut().unwrap().remove("class_counts");
        v["features"][0]
            .as_object_mut()
            .unwrap()
            .remove("class_totals");
        v
    }

    fn record(name: &str, value: DataValue) -> DataRecord {
        let mut values = HashMap::new();
        values.insert(name.to_string(), value);
        DataRecord { values }
    }

    fn make_def(
        name: &str,
        column_index: usize,
        measure: VariableMeasure,
        var_type: VariableType,
    ) -> VariableDefinition {
        VariableDefinition {
            id: None,
            column_index,
            name: name.to_string(),
            r#type: var_type,
            width: 8,
            decimals: 0,
            label: None,
            values: Vec::new(),
            missing: Vec::new(),
            columns: 64,
            align: VariableAlign::Right,
            measure,
            role: VariableRole::Input,
        }
    }

    fn text(s: &str) -> DataValue {
        DataValue::Text(s.to_string())
    }

    /// Dataset uji D3 (PLAN.md §1) tanpa kolom `Play`:
    /// baris 5 = Outlook teks kosong + Temp null; baris 6 = Outlook null.
    fn d3_payload() -> (
        Vec<Vec<DataRecord>>,
        Vec<Vec<VariableDefinition>>,
        Vec<MappingEntry>,
    ) {
        let outlook = vec![
            text("Overcast"),
            text("Sunny"),
            text("Foggy"),
            text("Sunny"),
            text(""),
            DataValue::Null,
        ];
        let temp = vec![
            DataValue::Number(85.0),
            DataValue::Number(71.0),
            DataValue::Number(72.0),
            DataValue::Null,
            DataValue::Null,
            DataValue::Number(80.0),
        ];

        let predictors = vec![
            outlook.into_iter().map(|v| record("Outlook", v)).collect(),
            temp.into_iter().map(|v| record("Temp", v)).collect(),
        ];
        let defs = vec![
            vec![make_def(
                "Outlook",
                0,
                VariableMeasure::Nominal,
                VariableType::String,
            )],
            vec![make_def(
                "Temp",
                1,
                VariableMeasure::Scale,
                VariableType::Numeric,
            )],
        ];
        let mapping = vec![
            MappingEntry {
                feature: "Outlook".to_string(),
                variable: "Outlook".to_string(),
            },
            MappingEntry {
                feature: "Temp".to_string(),
                variable: "Temp".to_string(),
            },
        ];
        (predictors, defs, mapping)
    }

    fn run(model: &Value) -> Result<ApplyModelRawResult, String> {
        let (predictors, defs, mapping) = d3_payload();
        run_apply_model(&predictors, &defs, &mapping, &[], &[], model)
    }

    fn assert_row(
        result: &ApplyModelRawResult,
        row: usize,
        predicted: Option<&str>,
        max_probability: Option<f64>,
        probabilities: [Option<f64>; 2],
    ) {
        let preds = &result.predictions;
        assert_eq!(
            preds.predicted[row].as_deref(),
            predicted,
            "predicted baris {}",
            row + 1
        );
        assert_eq!(
            preds.max_probability[row],
            max_probability,
            "max_probability baris {}",
            row + 1
        );
        assert_eq!(
            preds.class_probabilities[0][row],
            probabilities[0],
            "P(No) baris {}",
            row + 1
        );
        assert_eq!(
            preds.class_probabilities[1][row],
            probabilities[1],
            "P(Yes) baris {}",
            row + 1
        );
    }

    fn warning_pairs(result: &ApplyModelRawResult) -> Vec<(String, u32)> {
        result
            .warnings
            .iter()
            .map(|w| (w.code.clone(), w.count))
            .collect()
    }

    // --- D1 + D3 (PLAN.md §1, tabel hasil yang diharapkan) -----------------

    #[test]
    fn d1_d3_predictions_match_expected_table() {
        let result = run(&d1()).unwrap();

        assert_eq!(result.predictions.predicted.len(), 6);
        assert_eq!(result.predictions.max_probability.len(), 6);
        assert_eq!(result.predictions.class_probabilities.len(), 2);
        assert_eq!(result.predictions.class_probabilities[0].len(), 6);

        assert_row(&result, 0, Some("No"), Some(1.0), [Some(1.0), Some(0.0)]);
        assert_row(
            &result,
            1,
            Some("Yes"),
            Some(0.9967),
            [Some(0.0033), Some(0.9967)],
        );
        assert_row(
            &result,
            2,
            Some("Yes"),
            Some(0.9921),
            [Some(0.0079), Some(0.9921)],
        );
        assert_row(&result, 3, Some("Yes"), Some(0.6), [Some(0.4), Some(0.6)]);
        assert_row(&result, 4, None, None, [None, None]);
        assert_row(&result, 5, Some("No"), Some(1.0), [Some(1.0), Some(0.0)]);
    }

    #[test]
    fn d1_d3_case_processing_summary_and_distribution() {
        let result = run(&d1()).unwrap();

        let cps = &result.case_processing_summary;
        assert_eq!(cps.total_rows, 6);
        assert_eq!(cps.scored_rows, 5);
        assert_eq!(cps.not_scored_all_missing, 1);
        assert_eq!(cps.rows_with_missing_predictor, 2);
        assert_eq!(cps.rows_with_unseen_category, 2);

        let dist = &result.prediction_distribution;
        assert_eq!(dist.classes, vec!["No".to_string(), "Yes".to_string()]);
        assert_eq!(dist.counts, vec![2, 3]);
        assert_eq!(dist.percentages, vec![40.0, 60.0]);
        assert_eq!(dist.not_scored, 1);

        assert!(result.evaluation.is_none());
    }

    #[test]
    fn d1_d3_warnings_not_scored_and_unseen_category() {
        let result = run(&d1()).unwrap();
        assert_eq!(
            warning_pairs(&result),
            vec![
                ("AM_W_ROWS_NOT_SCORED".to_string(), 1),
                ("AM_W_UNSEEN_CATEGORY".to_string(), 2),
            ]
        );
    }

    #[test]
    fn d1_d3_model_summary_comes_from_scorer_and_mapping() {
        let result = run(&d1()).unwrap();
        let summary = &result.model_summary;

        assert_eq!(summary.model_type, "naive_bayes");
        assert_eq!(summary.schema_version, "1.1");
        assert_eq!(summary.trained_at.as_deref(), Some("2026-10-01T00:00:00.000Z"));
        assert_eq!(summary.target_name, "Play");
        assert_eq!(summary.classes, vec!["No".to_string(), "Yes".to_string()]);
        assert!(!summary.legacy_unseen_handling);

        assert_eq!(summary.features.len(), 2);
        assert_eq!(summary.features[0].name, "Outlook");
        assert_eq!(summary.features[0].role, "categorical");
        assert_eq!(summary.features[0].mapped_variable, "Outlook");
        assert_eq!(summary.features[1].name, "Temp");
        assert_eq!(summary.features[1].role, "numerical");
        assert_eq!(summary.features[1].mapped_variable, "Temp");

        let labels: Vec<&str> = summary.parameters.iter().map(|p| p.label.as_str()).collect();
        assert_eq!(
            labels,
            vec!["Smoothing alpha", "Variance floor", "Validation (training)"]
        );
    }

    #[test]
    fn mapped_variable_uses_dataset_variable_name_not_feature_name() {
        let (_, defs, _) = d3_payload();
        let predictors = vec![
            vec![record("Cuaca", text("Overcast"))],
            vec![record("Suhu", DataValue::Number(85.0))],
        ];
        let mapping = vec![
            MappingEntry {
                feature: "Outlook".to_string(),
                variable: "Cuaca".to_string(),
            },
            MappingEntry {
                feature: "Temp".to_string(),
                variable: "Suhu".to_string(),
            },
        ];
        let result = run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()).unwrap();

        assert_row(&result, 0, Some("No"), Some(1.0), [Some(1.0), Some(0.0)]);
        assert_eq!(result.model_summary.features[0].mapped_variable, "Cuaca");
        assert_eq!(result.model_summary.features[1].mapped_variable, "Suhu");
    }

    // --- D2 (schema 1.0) ----------------------------------------------------

    #[test]
    fn d2_d3_unseen_rows_are_skipped_with_legacy_warning() {
        let result = run(&d2()).unwrap();

        assert!(result.model_summary.legacy_unseen_handling);
        assert_eq!(result.model_summary.schema_version, "1.0");

        // Baris 3 = T7: Foggy dilewati -> 0.9921 (bukan hitung smoothing).
        assert_row(
            &result,
            2,
            Some("Yes"),
            Some(0.9921),
            [Some(0.0079), Some(0.9921)],
        );
        // Baris 6: kategori "(Missing)" juga dilewati; hanya Temp = 80 yang menentukan.
        assert_row(&result, 5, Some("No"), Some(1.0), [Some(1.0), Some(0.0)]);
        // Baris yang tidak punya kategori tak dikenal tidak berubah.
        assert_row(&result, 0, Some("No"), Some(1.0), [Some(1.0), Some(0.0)]);
        assert_row(
            &result,
            1,
            Some("Yes"),
            Some(0.9967),
            [Some(0.0033), Some(0.9967)],
        );
        assert_row(&result, 3, Some("Yes"), Some(0.6), [Some(0.4), Some(0.6)]);
        assert_row(&result, 4, None, None, [None, None]);

        assert_eq!(
            warning_pairs(&result),
            vec![
                ("AM_W_ROWS_NOT_SCORED".to_string(), 1),
                ("AM_W_UNSEEN_SKIPPED_LEGACY".to_string(), 2),
            ]
        );
    }

    // --- Validasi payload (§5.8) & error model -----------------------------

    fn assert_err_code(result: Result<ApplyModelRawResult, String>, code: &str) {
        match result {
            Ok(_) => panic!("seharusnya Err {}", code),
            Err(e) => assert!(
                e.starts_with(&format!("{}:", code)),
                "pesan tidak diawali {}: {}",
                code,
                e
            ),
        }
    }

    #[test]
    fn payload_mapping_with_wrong_length_is_rejected() {
        let (predictors, defs, mut mapping) = d3_payload();
        mapping.pop();
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_PAYLOAD",
        );
    }

    #[test]
    fn payload_predictors_with_wrong_length_is_rejected() {
        let (mut predictors, defs, mapping) = d3_payload();
        predictors.pop();
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_PAYLOAD",
        );
    }

    #[test]
    fn payload_defs_with_wrong_length_is_rejected() {
        let (predictors, mut defs, mapping) = d3_payload();
        defs.pop();
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_PAYLOAD",
        );
    }

    #[test]
    fn payload_mapping_not_aligned_with_model_feature_order_is_rejected() {
        let (predictors, defs, mut mapping) = d3_payload();
        mapping.swap(0, 1);
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_PAYLOAD",
        );
    }

    #[test]
    fn payload_empty_defs_for_a_feature_is_rejected() {
        let (predictors, mut defs, mapping) = d3_payload();
        defs[1] = Vec::new();
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_PAYLOAD",
        );
    }

    #[test]
    fn zero_rows_is_rejected_with_no_rows() {
        let (_, defs, mapping) = d3_payload();
        let predictors: Vec<Vec<DataRecord>> = vec![Vec::new(), Vec::new()];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_NO_ROWS",
        );
    }

    #[test]
    fn measure_not_matching_feature_role_is_rejected() {
        // Temp (numerical) dipetakan ke variabel nominal.
        let (predictors, mut defs, mapping) = d3_payload();
        defs[1] = vec![make_def(
            "Temp",
            1,
            VariableMeasure::Nominal,
            VariableType::Numeric,
        )];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_MAP_ROLE_MISMATCH",
        );

        // Outlook (categorical) dipetakan ke variabel scale.
        let (predictors, mut defs, mapping) = d3_payload();
        defs[0] = vec![make_def(
            "Outlook",
            0,
            VariableMeasure::Scale,
            VariableType::String,
        )];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_MAP_ROLE_MISMATCH",
        );

        // measure unknown tidak cocok dengan peran mana pun.
        let (predictors, mut defs, mapping) = d3_payload();
        defs[0] = vec![make_def(
            "Outlook",
            0,
            VariableMeasure::Unknown,
            VariableType::String,
        )];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()),
            "AM_E_MAP_ROLE_MISMATCH",
        );
    }

    #[test]
    fn ordinal_measure_is_accepted_for_categorical_feature() {
        let (predictors, mut defs, mapping) = d3_payload();
        defs[0] = vec![make_def(
            "Outlook",
            0,
            VariableMeasure::Ordinal,
            VariableType::String,
        )];
        assert!(run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()).is_ok());
    }

    #[test]
    fn model_errors_are_propagated_with_their_code() {
        let mut unsupported = d1();
        unsupported["model_type"] = json!("decision_tree");
        assert_err_code(run(&unsupported), "AM_E_MODEL_TYPE_UNSUPPORTED");

        let mut bad_schema = d1();
        bad_schema["schema_version"] = json!("2.0");
        assert_err_code(run(&bad_schema), "AM_E_SCHEMA_VERSION_UNSUPPORTED");

        assert_err_code(run(&json!([1, 2])), "AM_E_NOT_OBJECT");
    }

    #[test]
    fn shorter_slice_is_padded_with_missing_values() {
        // Temp hanya punya 1 baris; Outlook 2 baris -> baris ke-2 Temp = Null
        // (Outlook "Sunny" tetap diprediksi, bukan error).
        let (_, defs, mapping) = d3_payload();
        let predictors = vec![
            vec![
                record("Outlook", text("Overcast")),
                record("Outlook", text("Sunny")),
            ],
            vec![record("Temp", DataValue::Number(85.0))],
        ];
        let result = run_apply_model(&predictors, &defs, &mapping, &[], &[], &d1()).unwrap();

        assert_eq!(result.case_processing_summary.total_rows, 2);
        assert_eq!(result.case_processing_summary.scored_rows, 2);
        assert_eq!(result.case_processing_summary.rows_with_missing_predictor, 1);
        assert_row(&result, 1, Some("Yes"), Some(0.6), [Some(0.4), Some(0.6)]);
    }

    // --- Evaluasi (Fase 10, AGENTS.md §5.7) --------------------------------

    /// Kolom `Play` D3 (PLAN.md §1): No, Yes, Yes, No, Yes, Maybe.
    fn d3_actual_payload(
        variable: &str,
    ) -> (Vec<Vec<DataRecord>>, Vec<Vec<VariableDefinition>>) {
        let play = ["No", "Yes", "Yes", "No", "Yes", "Maybe"];
        let actual = vec![play.iter().map(|v| record(variable, text(v))).collect()];
        let defs = vec![vec![make_def(
            variable,
            2,
            VariableMeasure::Nominal,
            VariableType::String,
        )]];
        (actual, defs)
    }

    fn run_with_actual(model: &Value) -> Result<ApplyModelRawResult, String> {
        let (predictors, defs, mapping) = d3_payload();
        let (actual, actual_defs) = d3_actual_payload("Play");
        run_apply_model(&predictors, &defs, &mapping, &actual, &actual_defs, model)
    }

    #[test]
    fn d1_d3_with_actual_play_fills_evaluation() {
        let result = run_with_actual(&d1()).unwrap();
        let evaluation = result.evaluation.as_ref().expect("evaluation harus terisi");

        assert_eq!(evaluation.evaluated_rows, 4);
        assert_eq!(evaluation.excluded_not_scored, 1);
        assert_eq!(evaluation.excluded_actual_unknown_class, 1);
        assert_eq!(evaluation.excluded_actual_missing, 0);

        assert_eq!(
            evaluation.confusion_matrix["matrix"],
            json!([[1, 1], [0, 2]])
        );
        assert_eq!(evaluation.confusion_matrix["grand_total"], json!(4));
        assert_eq!(
            evaluation.evaluation_metrics["overall_accuracy"].as_f64(),
            Some(0.75)
        );
    }

    #[test]
    fn d1_d3_with_actual_adds_actual_unknown_class_warning_last() {
        let result = run_with_actual(&d1()).unwrap();
        assert_eq!(
            warning_pairs(&result),
            vec![
                ("AM_W_ROWS_NOT_SCORED".to_string(), 1),
                ("AM_W_UNSEEN_CATEGORY".to_string(), 2),
                ("AM_W_ACTUAL_UNKNOWN_CLASS".to_string(), 1),
            ]
        );
    }

    #[test]
    fn d1_d3_with_actual_keeps_predictions_identical_to_run_without_actual() {
        let without = run(&d1()).unwrap();
        let with = run_with_actual(&d1()).unwrap();

        assert_eq!(with.predictions.predicted, without.predictions.predicted);
        assert_eq!(
            with.predictions.max_probability,
            without.predictions.max_probability
        );
        assert_eq!(
            with.case_processing_summary.scored_rows,
            without.case_processing_summary.scored_rows
        );
    }

    #[test]
    fn d2_d3_with_actual_gives_same_evaluation_counts() {
        let result = run_with_actual(&d2()).unwrap();
        let evaluation = result.evaluation.as_ref().expect("evaluation harus terisi");

        assert_eq!(evaluation.evaluated_rows, 4);
        assert_eq!(evaluation.excluded_actual_unknown_class, 1);
        assert_eq!(
            evaluation.confusion_matrix["matrix"],
            json!([[1, 1], [0, 2]])
        );
        assert_eq!(
            warning_pairs(&result),
            vec![
                ("AM_W_ROWS_NOT_SCORED".to_string(), 1),
                ("AM_W_UNSEEN_SKIPPED_LEGACY".to_string(), 2),
                ("AM_W_ACTUAL_UNKNOWN_CLASS".to_string(), 1),
            ]
        );
    }

    #[test]
    fn actual_variable_is_looked_up_by_actual_def_name() {
        let (predictors, defs, mapping) = d3_payload();
        let (actual, actual_defs) = d3_actual_payload("Hasil");
        let result =
            run_apply_model(&predictors, &defs, &mapping, &actual, &actual_defs, &d1()).unwrap();

        let evaluation = result.evaluation.as_ref().expect("evaluation harus terisi");
        assert_eq!(evaluation.evaluated_rows, 4);
    }

    #[test]
    fn actual_missing_cells_are_counted_as_excluded_actual_missing() {
        let (predictors, defs, mapping) = d3_payload();
        // Baris 1 actual kosong, baris 2 teks spasi; sisanya sama dengan D3.
        let play = [
            DataValue::Null,
            text("  "),
            text("Yes"),
            text("No"),
            text("Yes"),
            text("Maybe"),
        ];
        let actual: Vec<Vec<DataRecord>> =
            vec![play.iter().map(|v| record("Play", v.clone())).collect()];
        let actual_defs = vec![vec![make_def(
            "Play",
            2,
            VariableMeasure::Nominal,
            VariableType::String,
        )]];
        let result =
            run_apply_model(&predictors, &defs, &mapping, &actual, &actual_defs, &d1()).unwrap();

        let evaluation = result.evaluation.as_ref().expect("evaluation harus terisi");
        assert_eq!(evaluation.excluded_actual_missing, 2);
        assert_eq!(evaluation.excluded_not_scored, 1);
        assert_eq!(evaluation.excluded_actual_unknown_class, 1);
        assert_eq!(evaluation.evaluated_rows, 2);
    }

    #[test]
    fn evaluation_with_zero_evaluated_rows_is_filled_not_error() {
        let (predictors, defs, mapping) = d3_payload();
        let actual: Vec<Vec<DataRecord>> =
            vec![(0..6).map(|_| record("Play", text("Maybe"))).collect()];
        let actual_defs = vec![vec![make_def(
            "Play",
            2,
            VariableMeasure::Nominal,
            VariableType::String,
        )]];
        let result =
            run_apply_model(&predictors, &defs, &mapping, &actual, &actual_defs, &d1()).unwrap();

        let evaluation = result.evaluation.as_ref().expect("evaluation harus terisi");
        assert_eq!(evaluation.evaluated_rows, 0);
        assert_eq!(evaluation.excluded_not_scored, 1);
        assert_eq!(evaluation.excluded_actual_unknown_class, 5);
        assert_eq!(
            evaluation.confusion_matrix["matrix"],
            json!([[0, 0], [0, 0]])
        );
    }

    #[test]
    fn evaluation_is_none_when_actual_is_empty() {
        let result = run(&d1()).unwrap();
        assert!(result.evaluation.is_none());
        assert!(!warning_pairs(&result)
            .iter()
            .any(|(code, _)| code == "AM_W_ACTUAL_UNKNOWN_CLASS"));
    }

    #[test]
    fn actual_payload_with_inconsistent_shape_is_rejected() {
        let (predictors, defs, mapping) = d3_payload();
        let (actual, actual_defs) = d3_actual_payload("Play");

        // actual ada, actualDefs kosong.
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &actual, &[], &d1()),
            "AM_E_PAYLOAD",
        );
        // actual kosong, actualDefs ada.
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &[], &actual_defs, &d1()),
            "AM_E_PAYLOAD",
        );
        // dua slice actual.
        let two_slices = vec![actual[0].clone(), actual[0].clone()];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &two_slices, &actual_defs, &d1()),
            "AM_E_PAYLOAD",
        );
        // actualDefs[0] kosong.
        let empty_defs: Vec<Vec<VariableDefinition>> = vec![Vec::new()];
        assert_err_code(
            run_apply_model(&predictors, &defs, &mapping, &actual, &empty_defs, &d1()),
            "AM_E_PAYLOAD",
        );
    }
}
