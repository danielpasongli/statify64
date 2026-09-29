// naive-bayes/rust/src/stats/preprocess_data.rs
//
// PLAN.md Fase 9 — "Preprocessing data di Rust (parsing, pemisahan
// factor/covariate, missing value)".
//
// Kebijakan missing-value SUDAH FINAL di AGENTS.md §5.4 — diimplementasikan
// persis di sini, tanpa improvisasi kebijakan lain:
//   - Target missing            -> baris dibuang sepenuhnya (listwise deletion).
//   - Predictor kategorik missing -> kategori tersendiri `"(Missing)"`, baris
//                                    TIDAK dibuang.
//   - Predictor numerik missing   -> dikecualikan hanya dari atribut itu
//                                    (baris TIDAK dibuang, atribut lain pada
//                                    baris yang sama tetap dipakai).
//
// Factor vs covariate ditentukan murni dari `measure` tiap
// `VariableDefinition` (AGENTS.md §3.1/§3.3 — measure adalah satu-satunya
// sumber kebenaran, bukan sesuatu yang dikirim manual dari TS). Predictor
// dengan `measure: Unknown` seharusnya sudah dicegah di UI (§3.2), tapi
// tetap ditolak eksplisit di sini sebagai pengaman lapis kedua.
use std::collections::{BTreeSet, HashMap};

use crate::models::config::NaiveBayesConfig;
use crate::models::data::{
    AnalysisData, DataRecord, DataValue, PredictorRole, PreprocessedCase, PreprocessedData,
    VariableMeasure,
};

const MISSING_CATEGORY_LABEL: &str = "(Missing)";

/// Satu predictor yang sudah diresolusi: nama, posisi kolomnya di
/// `predictors_data`/`predictors_data_defs` (payload adalah SATU daftar
/// gabungan, AGENTS.md §3.5 & PLAN.md §1), dan peran factor/covariate-nya.
struct ResolvedPredictor {
    index: usize,
    name: String,
    role: PredictorRole,
}

/// Terapkan kebijakan missing-value AGENTS.md §5.4 dan pisahkan predictor
/// menjadi factor/covariate berdasarkan `measure`.
pub fn preprocess_naive_bayes_data(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
) -> Result<PreprocessedData, String> {
    let target_variable = config
        .main
        .target_var
        .clone()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            "A target variable is required for Naive Bayes preprocessing".to_string()
        })?;

    if data.predictors_data_defs.is_empty() {
        return Err("At least one predictor variable is required".to_string());
    }

    let resolved_predictors = resolve_predictors(&data.predictors_data_defs)?;

    let factor_names: Vec<String> = resolved_predictors
        .iter()
        .filter(|p| p.role == PredictorRole::Factor)
        .map(|p| p.name.clone())
        .collect();
    let covariate_names: Vec<String> = resolved_predictors
        .iter()
        .filter(|p| p.role == PredictorRole::Covariate)
        .map(|p| p.name.clone())
        .collect();
    let predictor_order: Vec<(String, PredictorRole)> = resolved_predictors
        .iter()
        .map(|p| (p.name.clone(), p.role))
        .collect();

    let total_instances = count_cases(data);
    let mut excluded_target_missing = 0usize;
    let mut classes: BTreeSet<String> = BTreeSet::new();
    let mut cases: Vec<PreprocessedCase> = Vec::with_capacity(total_instances);

    for case_idx in 0..total_instances {
        let target_value = extract_value(&data.target_data, 0, &target_variable, case_idx);

        // Target missing -> listwise deletion (AGENTS.md §5.4). Baris ini
        // tidak ikut training maupun evaluasi sama sekali.
        if is_missing_value(&target_value) {
            excluded_target_missing += 1;
            continue;
        }

        let target_class = data_value_to_label(&target_value);
        classes.insert(target_class.clone());

        let mut factors: HashMap<String, String> = HashMap::with_capacity(factor_names.len());
        let mut covariates: HashMap<String, Option<f64>> =
            HashMap::with_capacity(covariate_names.len());

        for predictor in &resolved_predictors {
            let value = extract_value(
                &data.predictors_data,
                predictor.index,
                &predictor.name,
                case_idx,
            );

            match predictor.role {
                PredictorRole::Factor => {
                    // Kategorik missing -> kategori tersendiri, baris tetap
                    // dipakai (AGENTS.md §5.4).
                    let category = if is_missing_value(&value) {
                        MISSING_CATEGORY_LABEL.to_string()
                    } else {
                        data_value_to_label(&value)
                    };
                    factors.insert(predictor.name.clone(), category);
                }
                PredictorRole::Covariate => {
                    // Numerik missing (atau nilai tak terduga non-numerik
                    // pada kolom scale) -> None, dikecualikan hanya dari
                    // mean/variance atribut ini untuk baris ini; baris tetap
                    // dipakai untuk atribut lain (AGENTS.md §5.4).
                    let numeric = match &value {
                        DataValue::Number(n) if n.is_finite() => Some(*n),
                        _ => None,
                    };
                    covariates.insert(predictor.name.clone(), numeric);
                }
            }
        }

        cases.push(PreprocessedCase {
            target_class,
            factors,
            covariates,
        });
    }

    Ok(PreprocessedData {
        total_instances,
        excluded_target_missing,
        target_variable,
        predictor_order,
        factor_names,
        covariate_names,
        classes: classes.into_iter().collect(),
        cases,
    })
}

/// Tentukan factor vs covariate dari `measure` tiap definisi predictor.
/// Posisi (`index`) dijaga sejajar dengan `predictors_data` (kedua array
/// dibentuk `getVarDefs`/`getSlicedData` dengan urutan yang sama di sisi
/// TS, lihat `AnalysisData` di `models/data.rs`).
fn resolve_predictors(
    predictors_data_defs: &[Vec<crate::models::data::VariableDefinition>],
) -> Result<Vec<ResolvedPredictor>, String> {
    let mut resolved = Vec::with_capacity(predictors_data_defs.len());

    for (index, defs) in predictors_data_defs.iter().enumerate() {
        let def = defs.first().ok_or_else(|| {
            format!(
                "Missing variable definition for predictor at position {}",
                index
            )
        })?;

        let role = match &def.measure {
            VariableMeasure::Nominal | VariableMeasure::Ordinal => PredictorRole::Factor,
            VariableMeasure::Scale => PredictorRole::Covariate,
            VariableMeasure::Unknown => {
                // Pengaman lapis kedua (AGENTS.md §3.2): UI seharusnya sudah
                // mencegah variabel "unknown" dipilih ke area manapun.
                return Err(format!(
                    "Predictor \"{}\" has an unknown measurement level. Fix its measure in Variable View before running Naive Bayes.",
                    def.name
                ));
            }
        };

        resolved.push(ResolvedPredictor {
            index,
            name: def.name.clone(),
            role,
        });
    }

    Ok(resolved)
}

/// Jumlah baris/instance: nilai terbesar dari panjang tiap slice
/// target/predictor (pola sama dengan `count_cases` KNN), supaya baris yang
/// datanya kosong di sebagian kolom tetap terhitung (bukan diam-diam
/// dipendekkan ke slice terpendek).
fn count_cases(data: &AnalysisData) -> usize {
    data.target_data
        .iter()
        .map(|slice| slice.len())
        .chain(data.predictors_data.iter().map(|slice| slice.len()))
        .max()
        .unwrap_or(0)
}

/// Ambil nilai satu variabel pada satu baris dari slice ke-`dataset_idx`.
/// Baris di luar jangkauan slice, atau key yang tidak ada, dianggap missing
/// (`DataValue::Null`) — konsisten dengan bagaimana `getSlicedData` mengisi
/// `null` untuk sel kosong di sisi TS.
fn extract_value(
    dataset: &[Vec<DataRecord>],
    dataset_idx: usize,
    var_name: &str,
    case_idx: usize,
) -> DataValue {
    dataset
        .get(dataset_idx)
        .and_then(|slice| slice.get(case_idx))
        .and_then(|record| record.values.get(var_name).cloned())
        .unwrap_or(DataValue::Null)
}

/// Definisi missing yang dipakai konsisten untuk target maupun predictor:
/// `Null`, teks kosong (setelah di-trim), atau angka non-finite (NaN/Inf).
/// Pola sama dengan `is_missing_target_value` di
/// `nearest-neighbor/rust/src/stats/preprocess_data.rs`, hanya diberi nama
/// umum karena di Naive Bayes fungsi ini juga dipakai untuk predictor.
fn is_missing_value(value: &DataValue) -> bool {
    match value {
        DataValue::Null => true,
        DataValue::Text(s) => s.trim().is_empty(),
        DataValue::Number(n) => !n.is_finite(),
        DataValue::Boolean(_) => false,
    }
}

/// Stringify nilai jadi label kategori/kelas. Angka bulat dirender tanpa
/// desimal (`1.0` -> `"1"`) supaya variabel kategorik yang di-encode sebagai
/// angka (umum di data SPSS-style dengan value labels) tetap menghasilkan
/// kategori yang rapi.
fn data_value_to_label(value: &DataValue) -> String {
    match value {
        DataValue::Text(s) => s.trim().to_string(),
        DataValue::Number(n) => format_number_label(*n),
        DataValue::Boolean(b) => b.to_string(),
        DataValue::Null => MISSING_CATEGORY_LABEL.to_string(),
    }
}

fn format_number_label(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::config::{MainConfig, OptionsConfig, OutputConfig, ValidationConfig};
    use crate::models::data::{VariableAlign, VariableRole, VariableType};

    fn def(name: &str, measure: VariableMeasure) -> crate::models::data::VariableDefinition {
        crate::models::data::VariableDefinition {
            id: None,
            column_index: 0,
            name: name.to_string(),
            r#type: VariableType::Numeric,
            width: 8,
            decimals: 0,
            label: None,
            values: vec![],
            missing: vec![],
            columns: 8,
            align: VariableAlign::Right,
            measure,
            role: VariableRole::Input,
        }
    }

    fn record(name: &str, value: DataValue) -> DataRecord {
        DataRecord {
            values: HashMap::from([(name.to_string(), value)]),
        }
    }

    fn text(s: &str) -> DataValue {
        DataValue::Text(s.to_string())
    }

    fn num(n: f64) -> DataValue {
        DataValue::Number(n)
    }

    fn config_with_target(target: &str) -> NaiveBayesConfig {
        NaiveBayesConfig {
            main: MainConfig {
                target_var: Some(target.to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: OptionsConfig {
                missing_value_policy: String::new(),
                unseen_category_policy: String::new(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: None,
            },
            output: OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        }
    }

    /// Dataset buatan tangan (10 baris):
    /// - Class (target, row 5 missing)
    /// - Color (factor, row 2 & 7 missing)
    /// - Temp  (covariate, row 1, 4 & 8 missing)
    fn ten_row_dataset() -> AnalysisData {
        let class_values = [
            Some("A"),
            Some("A"),
            Some("B"),
            Some("B"),
            Some("A"),
            None, // row 5: target missing
            Some("B"),
            Some("A"),
            Some("B"),
            Some("A"),
        ];
        let color_values = [
            Some("red"),
            Some("blue"),
            None, // row 2: factor missing
            Some("red"),
            Some("blue"),
            Some("blue"),
            Some("red"),
            None, // row 7: factor missing
            Some("blue"),
            Some("red"),
        ];
        let temp_values = [
            Some(20.0),
            None, // row 1: covariate missing
            Some(22.0),
            Some(19.5),
            None, // row 4: covariate missing
            Some(21.0),
            Some(23.0),
            Some(18.0),
            None, // row 8: covariate missing
            Some(20.5),
        ];

        let target_slice: Vec<DataRecord> = class_values
            .iter()
            .map(|v| record("Class", v.map(text).unwrap_or(DataValue::Null)))
            .collect();
        let color_slice: Vec<DataRecord> = color_values
            .iter()
            .map(|v| record("Color", v.map(text).unwrap_or(DataValue::Null)))
            .collect();
        let temp_slice: Vec<DataRecord> = temp_values
            .iter()
            .map(|v| record("Temp", v.map(num).unwrap_or(DataValue::Null)))
            .collect();

        AnalysisData {
            target_data: vec![target_slice],
            predictors_data: vec![color_slice, temp_slice],
            target_data_defs: vec![vec![def("Class", VariableMeasure::Nominal)]],
            predictors_data_defs: vec![
                vec![def("Color", VariableMeasure::Nominal)],
                vec![def("Temp", VariableMeasure::Scale)],
            ],
        }
    }

    #[test]
    fn drops_rows_with_missing_target_listwise() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config).expect("preprocess should succeed");

        assert_eq!(result.total_instances, 10);
        assert_eq!(result.excluded_target_missing, 1);
        assert_eq!(result.cases.len(), 9);
        assert_eq!(result.classes, vec!["A".to_string(), "B".to_string()]);
    }

    #[test]
    fn splits_factor_and_covariate_from_measure() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config).expect("preprocess should succeed");

        assert_eq!(result.factor_names, vec!["Color".to_string()]);
        assert_eq!(result.covariate_names, vec!["Temp".to_string()]);
        assert_eq!(
            result.predictor_order,
            vec![
                ("Color".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ]
        );
    }

    #[test]
    fn categorical_missing_becomes_missing_category_without_dropping_row() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config).expect("preprocess should succeed");

        // Baris asli 2 & 7 (Color missing) harus tetap ada (target-nya valid),
        // dengan Color == "(Missing)".
        let missing_color_count = result
            .cases
            .iter()
            .filter(|c| c.factors.get("Color").map(String::as_str) == Some(MISSING_CATEGORY_LABEL))
            .count();
        assert_eq!(missing_color_count, 2);
        assert_eq!(result.cases.len(), 9);
    }

    #[test]
    fn numeric_missing_is_excluded_per_attribute_without_dropping_row() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config).expect("preprocess should succeed");

        let missing_temp_count = result
            .cases
            .iter()
            .filter(|c| c.covariates.get("Temp") == Some(&None))
            .count();
        // Baris asli 1, 4, 8 punya Temp missing; ketiganya punya target valid
        // jadi tetap ada di `cases` (baris TIDAK dibuang, hanya Temp yang
        // dikecualikan untuk baris itu).
        assert_eq!(missing_temp_count, 3);
        assert_eq!(result.cases.len(), 9);

        // Baris dengan Temp terisi tetap membawa nilai aslinya.
        let has_valid_temp = result
            .cases
            .iter()
            .any(|c| c.covariates.get("Temp") == Some(&Some(20.0)));
        assert!(has_valid_temp);
    }

    #[test]
    fn unknown_measure_predictor_is_rejected_as_second_safety_layer() {
        let mut data = ten_row_dataset();
        data.predictors_data_defs[0] = vec![def("Color", VariableMeasure::Unknown)];
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown measurement level"));
    }

    #[test]
    fn missing_target_variable_name_is_rejected() {
        let data = ten_row_dataset();
        let config = config_with_target("");

        let result = preprocess_naive_bayes_data(&data, &config);
        assert!(result.is_err());
    }

    #[test]
    fn no_predictors_is_rejected() {
        let mut data = ten_row_dataset();
        data.predictors_data_defs.clear();
        data.predictors_data.clear();
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config);
        assert!(result.is_err());
    }

    #[test]
    fn numeric_category_values_are_formatted_without_trailing_decimal() {
        // Factor yang di-encode sebagai angka (mis. 1/2/3 dengan value
        // labels) harus tetap menghasilkan kategori yang rapi ("1", bukan
        // "1.0").
        let mut data = ten_row_dataset();
        data.predictors_data[0] = vec![
            record("Color", num(1.0)),
            record("Color", num(2.0)),
            record("Color", num(1.0)),
            record("Color", num(1.0)),
            record("Color", num(2.0)),
            record("Color", num(2.0)),
            record("Color", num(1.0)),
            record("Color", num(2.0)),
            record("Color", num(2.0)),
            record("Color", num(1.0)),
        ];
        let config = config_with_target("Class");

        let result = preprocess_naive_bayes_data(&data, &config).expect("preprocess should succeed");
        let categories: BTreeSet<String> = result
            .cases
            .iter()
            .map(|c| c.factors.get("Color").cloned().unwrap())
            .collect();
        assert_eq!(
            categories,
            BTreeSet::from(["1".to_string(), "2".to_string()])
        );
    }
}
