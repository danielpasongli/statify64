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

use crate::models::data::TextPayload;

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
    preprocess_naive_bayes_data_inner(data, config, true)
}

/// Fase N3a (AGENTS_V2 §3.3): sama dengan `preprocess_naive_bayes_data`, tetapi
/// bila fitur Text terisi (`text_active`) daftar predictor Numeric/Categorical
/// BOLEH kosong (model hanya-Text) — resolusi predictor dilewati. Untuk
/// `text_active = false` perilakunya identik v1 (daftar kosong ditolak).
pub fn preprocess_naive_bayes_data_v2(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
    text_active: bool,
) -> Result<PreprocessedData, String> {
    preprocess_naive_bayes_data_inner(data, config, !text_active)
}

fn preprocess_naive_bayes_data_inner(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
    require_predictors: bool,
) -> Result<PreprocessedData, String> {
    let target_variable = config
        .main
        .target_var
        .clone()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            "A target variable is required for Naive Bayes preprocessing".to_string()
        })?;

    if require_predictors && data.predictors_data_defs.is_empty() {
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

// --- Fase N1 (PLAN_V2 / AGENTS_V2 §5.2) — penyelarasan baris Text ----------
//
// TAMBAHAN SAJA: `preprocess_naive_bayes_data` dan fungsi yang dikunci P-V4
// (`data_value_to_label`, `is_missing_value`) TIDAK diubah. Payload Text
// sejajar dengan baris target yang dikirim; fungsi di bawah menentukan baris
// mana yang lolos filter target-missing (aturan yang sama persis dengan
// `preprocess_naive_bayes_data`) lalu menyaring payload Text dengan indeks
// yang sama, sehingga `cases[i]` sejajar dengan baris Text ke-`i`.

/// Indeks (di payload asli) baris yang lolos filter target-missing, urut naik.
/// Panjangnya selalu sama dengan `PreprocessedData::cases.len()` untuk
/// data & config yang sama.
pub fn kept_row_indices(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
) -> Result<Vec<usize>, String> {
    let target_variable = config
        .main
        .target_var
        .clone()
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| {
            "A target variable is required for Naive Bayes preprocessing".to_string()
        })?;

    let total_instances = count_cases(data);
    let mut kept = Vec::with_capacity(total_instances);
    for case_idx in 0..total_instances {
        let target_value = extract_value(&data.target_data, 0, &target_variable, case_idx);
        if !is_missing_value(&target_value) {
            kept.push(case_idx);
        }
    }
    Ok(kept)
}

/// Saring payload Text mengikuti `kept` (hasil `kept_row_indices`): baris
/// dengan target missing ikut dibuang. `TextPayload::None` dikembalikan apa
/// adanya. Jumlah baris payload harus sama dengan jumlah baris data
/// (`total_instances`), selain itu galat berbahasa Indonesia.
pub fn align_text_payload(
    text: &TextPayload,
    kept: &[usize],
    total_instances: usize,
) -> Result<TextPayload, String> {
    if matches!(text, TextPayload::None) {
        return Ok(TextPayload::None);
    }

    if text.n_rows() != total_instances {
        return Err(format!(
            "NB_E_TEXT_SHAPE: The text data has {} rows, but the dataset has {} rows.",
            text.n_rows(),
            total_instances
        ));
    }

    // `kept` berisi indeks < total_instances == n_rows, sehingga akses aman;
    // tetap memakai `get` agar tidak ada panic pada input tak terduga.
    match text {
        TextPayload::None => Ok(TextPayload::None),
        TextPayload::Raw { variable, values } => Ok(TextPayload::Raw {
            variable: variable.clone(),
            values: kept
                .iter()
                .map(|&i| values.get(i).cloned().unwrap_or(None))
                .collect(),
        }),
        TextPayload::Vector { columns, values } => Ok(TextPayload::Vector {
            columns: columns.clone(),
            values: kept
                .iter()
                .map(|&i| values.get(i).cloned().unwrap_or_default())
                .collect(),
        }),
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

    // --- Fase N1: penyelarasan baris Text ---------------------------------

    #[test]
    fn kept_row_indices_matches_preprocess_cases_and_drops_missing_target() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");

        let kept = kept_row_indices(&data, &config).expect("kept indices");
        let pre = preprocess_naive_bayes_data(&data, &config).expect("preprocess");

        // Target missing ada di indeks 5 (komentar "row 5" pada dataset adalah 0-based).
        assert_eq!(kept, vec![0, 1, 2, 3, 4, 6, 7, 8, 9]);
        assert_eq!(kept.len(), pre.cases.len());
    }

    #[test]
    fn align_text_payload_raw_drops_rows_with_missing_target() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");
        let kept = kept_row_indices(&data, &config).unwrap();

        let values: Vec<Option<String>> = (0..10)
            .map(|i| if i == 2 { None } else { Some(format!("dok{}", i)) })
            .collect();
        let payload = TextPayload::Raw {
            variable: "Tweet".to_string(),
            values,
        };

        let aligned = align_text_payload(&payload, &kept, 10).expect("aligned");
        match aligned {
            TextPayload::Raw { variable, values } => {
                assert_eq!(variable, "Tweet");
                assert_eq!(values.len(), 9);
                // Baris indeks 5 (target missing) hilang: "dok5" tidak ada.
                assert!(!values.contains(&Some("dok5".to_string())));
                assert_eq!(values[0], Some("dok0".to_string()));
                assert_eq!(values[2], None); // sel null tetap null (diubah ke "" saat fit)
                assert_eq!(values[4], Some("dok4".to_string()));
                assert_eq!(values[5], Some("dok6".to_string()));
            }
            other => panic!("diharapkan Raw, dapat {:?}", other),
        }
    }

    #[test]
    fn align_text_payload_vector_drops_rows_with_missing_target() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");
        let kept = kept_row_indices(&data, &config).unwrap();

        let values: Vec<Vec<Option<f64>>> =
            (0..10).map(|i| vec![Some(i as f64), Some(0.0)]).collect();
        let payload = TextPayload::Vector {
            columns: vec!["VEC_a".to_string(), "VEC_b".to_string()],
            values,
        };

        let aligned = align_text_payload(&payload, &kept, 10).expect("aligned");
        match aligned {
            TextPayload::Vector { columns, values } => {
                assert_eq!(columns.len(), 2);
                assert_eq!(values.len(), 9);
                let firsts: Vec<f64> = values.iter().map(|r| r[0].unwrap()).collect();
                assert_eq!(firsts, vec![0.0, 1.0, 2.0, 3.0, 4.0, 6.0, 7.0, 8.0, 9.0]);
            }
            other => panic!("diharapkan Vector, dapat {:?}", other),
        }
    }

    #[test]
    fn align_text_payload_none_is_passthrough_and_row_mismatch_is_error() {
        let data = ten_row_dataset();
        let config = config_with_target("Class");
        let kept = kept_row_indices(&data, &config).unwrap();

        assert_eq!(
            align_text_payload(&TextPayload::None, &kept, 10).unwrap(),
            TextPayload::None
        );

        let short = TextPayload::Raw {
            variable: "Tweet".to_string(),
            values: vec![Some("a".to_string()); 3],
        };
        let err = align_text_payload(&short, &kept, 10).unwrap_err();
        assert!(err.contains("NB_E_TEXT_SHAPE"));
    }
}

#[cfg(test)]
mod tests_n3a {
    use super::*;
    use crate::models::config::{MainConfig, OptionsConfig, OutputConfig, ValidationConfig};

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

    /// Dataset tanpa predictor Numeric/Categorical: hanya kolom target (4 baris,
    /// baris ke-2 target missing).
    fn target_only_dataset() -> AnalysisData {
        let labels = [Some("A"), None, Some("B"), Some("A")];
        let target_slice: Vec<DataRecord> = labels
            .iter()
            .map(|label| DataRecord {
                values: HashMap::from([(
                    "Class".to_string(),
                    match label {
                        Some(text) => DataValue::Text((*text).to_string()),
                        None => DataValue::Null,
                    },
                )]),
            })
            .collect();
        AnalysisData {
            target_data: vec![target_slice],
            predictors_data: vec![],
            target_data_defs: vec![],
            predictors_data_defs: vec![],
        }
    }

    #[test]
    fn v1_tetap_menolak_daftar_predictor_kosong() {
        let error = preprocess_naive_bayes_data(&target_only_dataset(), &config_with_target("Class"))
            .unwrap_err();
        assert_eq!(error, "At least one predictor variable is required");

        // `text_active = false` identik v1.
        let error_v2 = preprocess_naive_bayes_data_v2(
            &target_only_dataset(),
            &config_with_target("Class"),
            false,
        )
        .unwrap_err();
        assert_eq!(error_v2, "At least one predictor variable is required");
    }

    #[test]
    fn model_hanya_text_melewati_resolusi_predictor() {
        let preprocessed = preprocess_naive_bayes_data_v2(
            &target_only_dataset(),
            &config_with_target("Class"),
            true,
        )
        .expect("model hanya-Text harus lolos preprocessing");
        assert_eq!(preprocessed.total_instances, 4);
        assert_eq!(preprocessed.excluded_target_missing, 1);
        assert_eq!(preprocessed.cases.len(), 3);
        assert!(preprocessed.factor_names.is_empty());
        assert!(preprocessed.covariate_names.is_empty());
        assert!(preprocessed.predictor_order.is_empty());
        assert_eq!(preprocessed.classes, vec!["A".to_string(), "B".to_string()]);

        // Baris Text tetap sejajar dengan `cases` lewat kept_row_indices.
        let kept = kept_row_indices(&target_only_dataset(), &config_with_target("Class"))
            .expect("kept");
        assert_eq!(kept, vec![0, 2, 3]);
        assert_eq!(kept.len(), preprocessed.cases.len());
    }
}
