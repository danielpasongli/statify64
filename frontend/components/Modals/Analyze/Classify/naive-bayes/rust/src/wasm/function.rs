// naive-bayes/rust/src/wasm/function.rs
//
// PLAN.md Fase 16 item 2 ("binding WASM lengkap") — MENGGANTIKAN dummy
// Fase 8 (`get_formatted_results_dummy`, DIHAPUS di fase ini). `run_analysis`
// di bawah mengorkestrasi seluruh pipeline Fase 9-16 (preprocessing ->
// evaluasi holdout/k-fold -> retrain final -> Attribute Distribution Table
// -> Case Processing Summary -> export model) — dipanggil SEKALI dari
// constructor (`wasm::constructor::NaiveBayesAnalysis::new`), hasilnya
// disimpan, `get_formatted_results()` tinggal memformat hasil yang sudah
// dihitung. Pola ini identik `nearest-neighbor/rust/src/wasm/function.rs`
// (`run_analysis` dipanggil sekali dari constructor KNN, hasil disimpan di
// struct, `get_formatted_results` murni format).
//
// === AGENTS.md §5.5 (titik paling gampang salah) ===
//
// Model Evaluation Metrics & Confusion Matrix berasal dari prediksi
// holdout/gabungan k-fold (dihitung di dalam cabang `match` evaluasi di
// bawah, satu model per fold/holdout — dibuang setelah dipakai untuk
// prediksi test-nya). Attribute Distribution Table dan model yang
// diekspor (Export Model) berasal dari MODEL TERPISAH yang di-retrain di
// SELURUH dataset SETELAH evaluasi selesai
// (`stats::save::retrain_final_model`) — dua model yang sengaja berbeda,
// dibangun dari dua pemanggilan `train_naive_bayes_model` yang terpisah,
// BUKAN model yang sama dipakai dobel untuk kedua keperluan.
//
// === Kenapa DTO JSON lokal, bukan `derive(Serialize)` di struct stats::* ===
//
// Seluruh struct `*Json` di bawah adalah "cermin" manual dari struct hasil
// modul `stats::*` (Fase 12-15), field-demi-field mengikuti bentuk yang
// SUDAH disepakati sisi TypeScript sejak Fase 7/8 (lihat
// `NaiveBayesRawResult` di `naive-bayes-analysis-formatter.ts` dan stub
// `services/__fixtures__/naive-bayes-stub-result.json`). Didefinisikan
// terpisah di sini (BUKAN dengan menambah `#[derive(Serialize)]` langsung
// pada struct-struct di `case_summary.rs`/`attribute_distribution.rs`/
// `classification_table.rs`) supaya file-file Fase 12-15 — sudah selesai
// dan lulus `cargo test` — TIDAK perlu disentuh sama sekali oleh Fase 16
// ini (batasan tugas: "Hanya sentuh file yang disebutkan di step-step fase
// ini pada PLAN.md"). Trade-off-nya sedikit boilerplate konversi manual,
// dicatat eksplisit di laporan implementasi Fase 16.
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::models::config::NaiveBayesConfig;
use crate::models::data::{AnalysisData, PreprocessedCase};
use crate::stats::attribute_distribution::{compute_attribute_distribution_table, AttributeRole};
use crate::stats::case_summary::{compute_case_processing_summary, ValidationScenario};
use crate::stats::classification_table::{
    compute_evaluation_metrics, ConfusionMatrix, EvaluationMetrics,
};
use crate::stats::partition::{
    stratified_k_fold, stratified_train_holdout_split, training_test_split_for_fold,
};
use crate::stats::prediction::predict_case;
use crate::stats::preprocess_data::preprocess_naive_bayes_data;
use crate::stats::save::{build_exported_model, retrain_final_model, ExportedModel};
use crate::stats::training::train_naive_bayes_model;
use crate::utils::error::ErrorCollector;

/* ============================ JSON DTOs ============================ */

#[derive(Debug, Clone, Serialize)]
struct ValidationScenarioJson {
    method: String,
    training_percentage: Option<f64>,
    holdout_percentage: Option<f64>,
    folds: Option<i32>,
    seed: Option<i64>,
}

impl From<&ValidationScenario> for ValidationScenarioJson {
    fn from(scenario: &ValidationScenario) -> Self {
        ValidationScenarioJson {
            method: scenario.method.clone(),
            training_percentage: scenario.training_percentage,
            holdout_percentage: scenario.holdout_percentage,
            folds: scenario.folds,
            seed: scenario.seed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct CaseProcessingSummaryJson {
    total_instances: usize,
    valid_instances: usize,
    excluded_target_missing: usize,
    target_variable: String,
    attribute_variables: Vec<String>,
    validation_scenario: ValidationScenarioJson,
}

#[derive(Debug, Clone, Serialize)]
struct CategoryClassStatJson {
    class: String,
    raw_count: usize,
    smoothed_count: f64,
    probability: f64,
    total: usize,
}

#[derive(Debug, Clone, Serialize)]
struct CategoricalCategoryJson {
    category: String,
    per_class: Vec<CategoryClassStatJson>,
}

#[derive(Debug, Clone, Serialize)]
struct NumericClassStatJson {
    class: String,
    mean: f64,
    std_dev: f64,
}

#[derive(Debug, Clone, Serialize)]
struct NumericWrapperJson {
    per_class: Vec<NumericClassStatJson>,
}

/// Cermin `NaiveBayesCategoricalAttribute | NaiveBayesNumericalAttribute`
/// (union TS) — `#[serde(untagged)]` supaya tiap varian serialize sebagai
/// object JSON polos, bukan `{ "Categorical": {...} }`.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum AttributeDistributionJson {
    Categorical {
        name: String,
        role: &'static str,
        classes: Vec<String>,
        categories: Vec<CategoricalCategoryJson>,
    },
    Numerical {
        name: String,
        role: &'static str,
        classes: Vec<String>,
        numeric: NumericWrapperJson,
    },
}

#[derive(Debug, Clone, Serialize)]
struct ClassMetricJson {
    class: String,
    accuracy: f64,
    precision: f64,
    recall: f64,
    f1: f64,
}

#[derive(Debug, Clone, Serialize)]
struct AverageMetricsJson {
    precision: f64,
    recall: f64,
    f1: f64,
}

#[derive(Debug, Clone, Serialize)]
struct EvaluationMetricsJson {
    classes: Vec<String>,
    per_class: Vec<ClassMetricJson>,
    macro_avg: AverageMetricsJson,
    weighted_avg: AverageMetricsJson,
    micro_avg: AverageMetricsJson,
    overall_accuracy: f64,
    cohens_kappa: f64,
}

#[derive(Debug, Clone, Serialize)]
struct ConfusionMatrixJson {
    classes: Vec<String>,
    matrix: Vec<Vec<usize>>,
    row_totals: Vec<usize>,
    col_totals: Vec<usize>,
    grand_total: usize,
    percentages: Vec<Vec<f64>>,
}

/// Hasil analisis lengkap (dihitung sekali di constructor, lihat
/// `run_analysis` di bawah), bentuknya persis `NaiveBayesRawResult` sisi
/// TS: `case_processing_summary`, `attribute_distribution`,
/// `evaluation_metrics`, `confusion_matrix`, `trained_model` — SEMUANYA
/// selalu dihitung (tidak digerbang oleh checkbox tab Output di sisi Rust;
/// penyaringan tabel mana yang ditampilkan adalah tanggung jawab
/// `transformNaiveBayesResult` di sisi TS, sama seperti perilaku stub Fase
/// 7/8).
#[derive(Debug, Clone, Serialize)]
pub struct NaiveBayesAnalysisResult {
    case_processing_summary: CaseProcessingSummaryJson,
    attribute_distribution: Vec<AttributeDistributionJson>,
    evaluation_metrics: EvaluationMetricsJson,
    confusion_matrix: ConfusionMatrixJson,
    trained_model: ExportedModel,
}

fn attribute_row_to_json(
    row: &crate::stats::attribute_distribution::AttributeDistributionRow,
) -> AttributeDistributionJson {
    match row.role {
        AttributeRole::Categorical => AttributeDistributionJson::Categorical {
            name: row.name.clone(),
            role: "categorical",
            classes: row.classes.clone(),
            categories: row
                .categorical
                .as_ref()
                .map(|categories| {
                    categories
                        .iter()
                        .map(|category_row| CategoricalCategoryJson {
                            category: category_row.category.clone(),
                            per_class: category_row
                                .per_class
                                .iter()
                                .map(|stat| CategoryClassStatJson {
                                    class: stat.class.clone(),
                                    raw_count: stat.raw_count,
                                    smoothed_count: stat.smoothed_count,
                                    probability: stat.probability,
                                    total: stat.total,
                                })
                                .collect(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
        },
        AttributeRole::Numerical => AttributeDistributionJson::Numerical {
            name: row.name.clone(),
            role: "numerical",
            classes: row.classes.clone(),
            numeric: NumericWrapperJson {
                per_class: row
                    .numeric
                    .as_ref()
                    .map(|stats| {
                        stats
                            .iter()
                            .map(|stat| NumericClassStatJson {
                                class: stat.class.clone(),
                                mean: stat.mean,
                                std_dev: stat.std_dev,
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            },
        },
    }
}

fn evaluation_result_to_json(
    classes: &[String],
    confusion: &ConfusionMatrix,
    metrics: &EvaluationMetrics,
) -> (ConfusionMatrixJson, EvaluationMetricsJson) {
    let confusion_json = ConfusionMatrixJson {
        classes: confusion.classes.clone(),
        matrix: confusion.matrix.clone(),
        row_totals: confusion.row_totals.clone(),
        col_totals: confusion.col_totals.clone(),
        grand_total: confusion.grand_total,
        percentages: confusion.percentages.clone(),
    };

    let metrics_json = EvaluationMetricsJson {
        classes: classes.to_vec(),
        per_class: metrics
            .per_class
            .iter()
            .map(|class_metrics| ClassMetricJson {
                class: class_metrics.class.clone(),
                accuracy: class_metrics.accuracy,
                precision: class_metrics.precision,
                recall: class_metrics.recall,
                f1: class_metrics.f1,
            })
            .collect(),
        macro_avg: AverageMetricsJson {
            precision: metrics.macro_average.precision,
            recall: metrics.macro_average.recall,
            f1: metrics.macro_average.f1,
        },
        weighted_avg: AverageMetricsJson {
            precision: metrics.weighted_average.precision,
            recall: metrics.weighted_average.recall,
            f1: metrics.weighted_average.f1,
        },
        micro_avg: AverageMetricsJson {
            precision: metrics.micro_average.precision,
            recall: metrics.micro_average.recall,
            f1: metrics.micro_average.f1,
        },
        overall_accuracy: metrics.overall_accuracy,
        cohens_kappa: metrics.cohens_kappa,
    };

    (confusion_json, metrics_json)
}

/// Latih satu model di `train_cases` lalu prediksi seluruh `eval_indices`
/// (indeks ke `preprocessed_cases`), mengembalikan pasangan label
/// actual/predicted sejajar index (dipakai baik untuk holdout maupun tiap
/// fold k-fold, lihat `run_analysis`). Predictor efektif (`classes`,
/// `factor_names`, `covariate_names`) SELALU dari `PreprocessedData` yang
/// sama (predictor efektif tidak berubah antar fold/holdout — hanya
/// baris/case yang berbeda), konsisten dengan AGENTS.md §3.3 (predictor
/// efektif ditentukan sekali dari konfigurasi, bukan per-partisi.
#[allow(clippy::too_many_arguments)]
fn train_and_predict(
    preprocessed_cases: &[PreprocessedCase],
    train_indices: &[usize],
    eval_indices: &[usize],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
) -> (Vec<String>, Vec<String>) {
    let train_cases: Vec<PreprocessedCase> = train_indices
        .iter()
        .map(|&idx| preprocessed_cases[idx].clone())
        .collect();
    let fold_model = train_naive_bayes_model(
        &train_cases,
        classes,
        factor_names,
        covariate_names,
        alpha,
        variance_floor,
    );

    let mut actual = Vec::with_capacity(eval_indices.len());
    let mut predicted = Vec::with_capacity(eval_indices.len());
    for &idx in eval_indices {
        let case = &preprocessed_cases[idx];
        let prediction = predict_case(&fold_model, case, alpha);
        actual.push(case.target_class.clone());
        // `predicted_class` hanya `None` bila model sama sekali tidak
        // punya kelas (AGENTS.md/`prediction.rs`: kasus degenerate yang
        // seharusnya sudah dicegah lebih awal) — fallback ke label actual
        // supaya kasus ini tidak ikut mendistorsi confusion matrix sebagai
        // "kelas kosong", murni pengaman lapis kedua, bukan jalur normal.
        predicted.push(
            prediction
                .predicted_class
                .unwrap_or_else(|| case.target_class.clone()),
        );
    }

    (actual, predicted)
}

/// Orkestrasi penuh satu run analisis Naive Bayes (PLAN.md Fase 16 item 2).
/// Mengembalikan `None` (dengan error tercatat di `error_collector`) untuk
/// kondisi blokir-keras (preprocessing gagal, tidak ada kasus valid, jumlah
/// fold tidak mungkin dieksekusi — lihat `stats::partition::
/// validate_fold_count`); peringatan non-fatal (mis. fold melebihi anggota
/// kelas terkecil) tetap tercatat di `error_collector` TANPA menghentikan
/// analisis (AGENTS.md §5.5: "peringatan... tetap harus ada validasi yang
/// menahan submit bila nilai jelas tidak mungkin dieksekusi" — bedanya sudah
/// ditegakkan di `validate_fold_count`, di sini tinggal meneruskan hasilnya).
pub fn run_analysis(
    data: &AnalysisData,
    config: &NaiveBayesConfig,
    error_collector: &mut ErrorCollector,
) -> Option<NaiveBayesAnalysisResult> {
    let preprocessed = match preprocess_naive_bayes_data(data, config) {
        Ok(preprocessed) => preprocessed,
        Err(e) => {
            error_collector.add_error("preprocessing", &e);
            return None;
        }
    };

    if preprocessed.cases.is_empty() {
        error_collector.add_error(
            "preprocessing",
            "No valid instances remain after missing-value handling (rows with a missing target are excluded).",
        );
        return None;
    }

    let alpha = config.options.smoothing_alpha;
    let variance_floor = config.options.variance_floor;
    let seed = config.validation.random_seed;
    let class_labels: Vec<String> = preprocessed
        .cases
        .iter()
        .map(|case| case.target_class.clone())
        .collect();

    // --- Evaluasi (Model Evaluation Metrics & Confusion Matrix): prediksi
    // holdout ATAU prediksi gabungan k-fold (AGENTS.md §5.5) — model(-model)
    // di cabang ini SELALU terpisah dari model final di bawah.
    let (actual, predicted): (Vec<String>, Vec<String>) =
        match config.validation.validation_method.as_str() {
            "kfold" => match stratified_k_fold(&class_labels, config.validation.k_folds, seed) {
                Ok(kfold) => {
                    if let Some(warning) = &kfold.warning {
                        error_collector.add_error("validation.kfold", warning);
                    }

                    let mut all_actual = Vec::with_capacity(preprocessed.cases.len());
                    let mut all_predicted = Vec::with_capacity(preprocessed.cases.len());

                    for fold_idx in 0..kfold.folds.len() {
                        let (train_indices, test_indices) =
                            training_test_split_for_fold(&kfold.folds, fold_idx);
                        let (fold_actual, fold_predicted) = train_and_predict(
                            &preprocessed.cases,
                            &train_indices,
                            &test_indices,
                            &preprocessed.classes,
                            &preprocessed.factor_names,
                            &preprocessed.covariate_names,
                            alpha,
                            variance_floor,
                        );
                        all_actual.extend(fold_actual);
                        all_predicted.extend(fold_predicted);
                    }

                    (all_actual, all_predicted)
                }
                Err(e) => {
                    error_collector.add_error("validation.kfold", &e);
                    return None;
                }
            },
            // Default ke "holdout" untuk nilai method yang tidak dikenal —
            // pengaman lapis kedua yang sama dengan
            // `case_summary::compute_case_processing_summary` (seharusnya
            // sudah dibatasi ke "holdout" | "kfold" oleh tipe TS).
            _ => {
                // Diperbaiki Fase 18 (Temuan 1): field payload ini sekarang
                // benar-benar `TrainingPercentage`, bukan `HoldoutPercent` -
                // tidak perlu dibalik lagi dengan `100.0 - x`.
                let training_percent = config.validation.training_percentage.round() as i32;
                let split =
                    stratified_train_holdout_split(&class_labels, training_percent, seed);
                train_and_predict(
                    &preprocessed.cases,
                    &split.training_indices,
                    &split.holdout_indices,
                    &preprocessed.classes,
                    &preprocessed.factor_names,
                    &preprocessed.covariate_names,
                    alpha,
                    variance_floor,
                )
            }
        };

    let (confusion, metrics) =
        compute_evaluation_metrics(&actual, &predicted, &preprocessed.classes);
    let (confusion_matrix, evaluation_metrics) =
        evaluation_result_to_json(&preprocessed.classes, &confusion, &metrics);

    // --- Model final: retrain di SELURUH dataset (AGENTS.md §5.5),
    // TERPISAH dari model(-model) evaluasi di atas — dipakai untuk
    // Attribute Distribution Table dan Export Model.
    let final_model = retrain_final_model(&preprocessed, config);

    let attribute_distribution: Vec<AttributeDistributionJson> = compute_attribute_distribution_table(
        &final_model,
        &preprocessed.predictor_order,
        &preprocessed.classes,
    )
    .iter()
    .map(attribute_row_to_json)
    .collect();

    let case_processing_summary_raw =
        compute_case_processing_summary(&preprocessed, &config.validation);
    let case_processing_summary = CaseProcessingSummaryJson {
        total_instances: case_processing_summary_raw.total_instances,
        valid_instances: case_processing_summary_raw.valid_instances,
        excluded_target_missing: case_processing_summary_raw.excluded_target_missing,
        target_variable: case_processing_summary_raw.target_variable.clone(),
        attribute_variables: case_processing_summary_raw.attribute_variables.clone(),
        validation_scenario: ValidationScenarioJson::from(
            &case_processing_summary_raw.validation_scenario,
        ),
    };

    let trained_model = build_exported_model(&preprocessed, &final_model, config);

    Some(NaiveBayesAnalysisResult {
        case_processing_summary,
        attribute_distribution,
        evaluation_metrics,
        confusion_matrix,
        trained_model,
    })
}

/// Format hasil (sudah dihitung di constructor) menjadi `JsValue` untuk
/// dikonsumsi worker/formatter TS.
///
/// PENTING — JANGAN pakai `serde_wasm_bindgen::to_value` polos (dengan
/// `Serializer::new()` default) di sini, walau `NaiveBayesAnalysisResult`
/// adalah struct Rust konkret (`#[derive(Serialize)]`, bukan
/// `serde_json::Value` generik seperti dummy Fase 8 — beda kasus dari
/// catatan lama di `get_formatted_results_dummy` yang sudah dihapus).
/// Dicek eksplisit terhadap sumber `serde-wasm-bindgen` 0.6.5 (versi yang
/// dipakai crate ini, lihat `Cargo.toml`) saat implementasi Fase 16:
/// SERIALIZER DEFAULT `Serializer::new()` yang dipakai `to_value` MASIH
/// mengubah field ber-tipe `HashMap<K, V>` (dipakai di `stats::save`
/// untuk `label_mapping`, `distribution`, `mean`, `variance`) menjadi
/// JS `Map`, BUKAN object literal biasa `{...}` — field `option_maps_as_objects`
/// default `false`. Ini akan merusak dua hal di sisi TS: (1)
/// `ExportModelOutput.tsx` men-download model lewat `JSON.stringify(model)`
/// — `JSON.stringify` pada `Map` menghasilkan `{}` KOSONG (Map bukan
/// "own enumerable properties"), jadi file JSON model yang diunduh
/// pengguna akan kehilangan seluruh isi `label_mapping`/`distribution`/
/// `mean`/`variance` secara DIAM-DIAM (bukan error, angka-angka penting
/// itu cuma lenyap dari file). (2) `serde_wasm_bindgen::Serializer::new()`
/// juga men-serialize `Option::None` sebagai `JsValue::UNDEFINED` (bukan
/// `null`) kecuali `serialize_missing_as_null(true)` diaktifkan — padahal
/// formatter TS (`naive-bayes-analysis-formatter.ts`,
/// `describeValidationScenario`) membandingkan field seperti
/// `scenario.seed` dengan `!== null`, yang akan salah bernilai `true`
/// untuk `undefined` (beda tipe dari `null` di bawah `!==` strict),
/// membuat run TANPA seed ditampilkan seolah-olah punya seed.
///
/// Kedua masalah ini diperbaiki dengan Serializer kustom
/// (`serialize_maps_as_objects(true)`, `serialize_missing_as_null(true)`)
/// alih-alih `to_value` bawaan — pola yang sama dipakai
/// `nearest-neighbor/rust/src/utils/converter.rs::format_result` untuk
/// alasan serupa (menjaga bentuk JS object polos agar formatter TS bisa
/// mengakses field dengan notasi titik, bukan API `Map`).
pub fn get_formatted_results(
    result: &Option<NaiveBayesAnalysisResult>,
) -> Result<JsValue, JsValue> {
    match result {
        Some(result) => {
            let serializer = serde_wasm_bindgen::Serializer::new()
                .serialize_maps_as_objects(true)
                .serialize_missing_as_null(true);
            result
                .serialize(&serializer)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize results: {}", e)))
        }
        None => Err(JsValue::from_str("No analysis results available")),
    }
}

pub fn get_all_errors(error_collector: &ErrorCollector) -> JsValue {
    JsValue::from_str(&error_collector.get_error_summary())
}
