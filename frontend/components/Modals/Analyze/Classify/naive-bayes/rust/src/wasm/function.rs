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

use crate::models::config::{NaiveBayesConfig, NaiveBayesConfigV2};
use crate::models::data::{AnalysisData, PreprocessedCase, TextPayload};
use crate::stats::attribute_distribution::{
    compute_attribute_distribution_table, numeric_likelihood_note, AttributeRole,
};
use crate::stats::case_summary::{
    compute_case_processing_summary, compute_text_features_summary, TextFeaturesSummary,
    ValidationScenario,
};
use crate::stats::classification_table::{
    compute_evaluation_metrics, ConfusionMatrix, EvaluationMetrics,
};
use crate::stats::partition::{
    stratified_k_fold, stratified_train_holdout_split, training_test_split_for_fold,
};
use crate::stats::prediction::predict_case;
use crate::stats::preprocess_data::preprocess_naive_bayes_data_v2;
use crate::stats::save::{build_export, retrain_final_model, ExportedModelAny};
use crate::stats::text_feature_table::{build_text_feature_table, likelihood_name, TextFeatureTable};
use crate::stats::training::TrainedModelParams;
use crate::stats::raw_text::SplitLabel;
use crate::stats::text_features::{
    build_v2_context, retrain_final_model_v2, train_and_predict_v2_split, V2Context,
};
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
    /// Fase N4: baris `Text features` (hanya model dengan fitur Text; kunci
    /// dihilangkan pada model v1 sehingga bentuk JSON v1 tidak berubah).
    #[serde(skip_serializing_if = "Option::is_none")]
    text_features: Option<TextFeaturesSummaryJson>,
    /// Fase N4: jumlah baris NotScored (V11) — hanya model dengan fitur Text.
    #[serde(skip_serializing_if = "Option::is_none")]
    not_scored_rows: Option<usize>,
}

/// Cermin JSON dari `TextFeaturesSummary` (AGENTS_V2 §9).
#[derive(Debug, Clone, Serialize)]
struct TextFeaturesSummaryJson {
    source: &'static str,
    description: String,
    variable: Option<String>,
    n_terms: usize,
    likelihood: String,
    alpha: f64,
    uses_class_prior: bool,
    leakage_note: Option<String>,
    class_prior_note: Option<String>,
}

impl From<TextFeaturesSummary> for TextFeaturesSummaryJson {
    fn from(summary: TextFeaturesSummary) -> Self {
        Self {
            source: summary.source,
            description: summary.description,
            variable: summary.variable,
            n_terms: summary.n_terms,
            likelihood: summary.likelihood,
            alpha: summary.alpha,
            uses_class_prior: summary.uses_class_prior,
            leakage_note: summary.leakage_note,
            class_prior_note: summary.class_prior_note,
        }
    }
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
        /// Fase N4: `"gaussian_minstd"` hanya untuk atribut Gaussian min-std
        /// (kunci dihilangkan untuk Gaussian biasa -> JSON v1 tidak berubah).
        #[serde(skip_serializing_if = "Option::is_none")]
        likelihood: Option<&'static str>,
        /// Fase N4: catatan min-std (mis. "Gaussian (Weka min. std), min. variance = ...").
        #[serde(skip_serializing_if = "Option::is_none")]
        likelihood_note: Option<String>,
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
    trained_model: ExportedModelAny,
    /// Fase N3a/N4: jumlah baris yang TIDAK diskor saat evaluasi karena semua
    /// prediktor missing (V11) — dihitung terpisah dari baris yang dibuang
    /// karena target missing. `Some` hanya pada model dengan fitur Text;
    /// kunci dihilangkan pada model v1 (bentuk JSON v1 tidak berubah).
    #[serde(skip_serializing_if = "Option::is_none")]
    not_scored_rows: Option<usize>,
    /// Fase N4: tabel Text Feature (Top-k per kelas + `full`); hanya bila ada
    /// fitur Text DAN `Output.TextFeatureTable` aktif.
    #[serde(skip_serializing_if = "Option::is_none")]
    text_feature_table: Option<TextFeatureTable>,
}

fn attribute_row_to_json(
    row: &crate::stats::attribute_distribution::AttributeDistributionRow,
    model: &TrainedModelParams,
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
        AttributeRole::Numerical => {
            let minstd_note = numeric_likelihood_note(model, &row.name);
            AttributeDistributionJson::Numerical {
            name: row.name.clone(),
            role: "numerical",
            classes: row.classes.clone(),
            likelihood: minstd_note.as_ref().map(|n| n.likelihood),
            likelihood_note: minstd_note.map(|n| n.note),
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
            }
        }
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

/// Fase N3a: satu evaluasi (holdout atau satu fold). Konfigurasi setara v1
/// (tanpa Text, semua covariate Gaussian biasa) memakai `train_and_predict`
/// v1 APA ADANYA; selain itu memakai `text_features::train_and_predict_v2`
/// dengan baris yang sama untuk fitur Text. Nilai ketiga = jumlah baris
/// NotScored (selalu 0 pada jalur v1).
///
/// Fase N3b: `split` (holdout / nomor fold 1-based) diteruskan agar jalur Raw
/// Text men-fit vektorisasi HANYA pada data latih evaluasi ini (V7) dan agar
/// galat `NB_E_TEXT_EMPTY_VOCAB_FOLD` menyebut fold yang bermasalah.
#[allow(clippy::too_many_arguments)]
fn evaluate_split(
    preprocessed_cases: &[PreprocessedCase],
    train_indices: &[usize],
    eval_indices: &[usize],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
    v2: &V2Context,
    split: &SplitLabel,
) -> Result<(Vec<String>, Vec<String>, usize), String> {
    if v2.is_v1_equivalent(covariate_names) {
        let (actual, predicted) = train_and_predict(
            preprocessed_cases,
            train_indices,
            eval_indices,
            classes,
            factor_names,
            covariate_names,
            alpha,
            variance_floor,
        );
        Ok((actual, predicted, 0))
    } else {
        train_and_predict_v2_split(
            preprocessed_cases,
            train_indices,
            eval_indices,
            classes,
            factor_names,
            covariate_names,
            alpha,
            variance_floor,
            v2,
            split,
        )
    }
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
    config_v2: &NaiveBayesConfigV2,
    text: &TextPayload,
    error_collector: &mut ErrorCollector,
) -> Option<NaiveBayesAnalysisResult> {
    // Fase N3a: model hanya-Text (tanpa predictor Numeric/Categorical) sah
    // bila payload Text terisi. SUMBER teks diambil dari payload (`text`),
    // bukan dari `config_v2.main.text_source`.
    let text_active = !matches!(text, TextPayload::None);
    let preprocessed = match preprocess_naive_bayes_data_v2(data, config, text_active) {
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

    // Fase N3a: pilihan v2 (likelihood Numeric per atribut + fitur Text jalur
    // `vector`). Urutan di dalamnya: align_text_payload -> NotScored dari
    // payload mentah -> vector_to_csr (lihat `stats::text_features`).
    let v2 = match build_v2_context(data, config, config_v2, text, &preprocessed) {
        Ok(context) => context,
        Err(e) => {
            error_collector.add_error("text_features", &e);
            return None;
        }
    };
    let v1_equivalent = v2.is_v1_equivalent(&preprocessed.covariate_names);
    let mut not_scored_rows = 0usize;

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
                        let (fold_actual, fold_predicted, fold_not_scored) = match evaluate_split(
                            &preprocessed.cases,
                            &train_indices,
                            &test_indices,
                            &preprocessed.classes,
                            &preprocessed.factor_names,
                            &preprocessed.covariate_names,
                            alpha,
                            variance_floor,
                            &v2,
                            &SplitLabel::Fold(fold_idx + 1),
                        ) {
                            Ok(evaluation) => evaluation,
                            Err(e) => {
                                error_collector.add_error("evaluation.text", &e);
                                return None;
                            }
                        };
                        not_scored_rows += fold_not_scored;
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
                match evaluate_split(
                    &preprocessed.cases,
                    &split.training_indices,
                    &split.holdout_indices,
                    &preprocessed.classes,
                    &preprocessed.factor_names,
                    &preprocessed.covariate_names,
                    alpha,
                    variance_floor,
                    &v2,
                    &SplitLabel::Holdout,
                ) {
                    Ok((holdout_actual, holdout_predicted, holdout_not_scored)) => {
                        not_scored_rows += holdout_not_scored;
                        (holdout_actual, holdout_predicted)
                    }
                    Err(e) => {
                        error_collector.add_error("evaluation.text", &e);
                        return None;
                    }
                }
            }
        };

    let (confusion, metrics) =
        compute_evaluation_metrics(&actual, &predicted, &preprocessed.classes);
    let (confusion_matrix, evaluation_metrics) =
        evaluation_result_to_json(&preprocessed.classes, &confusion, &metrics);

    // --- Model final: retrain di SELURUH dataset (AGENTS.md §5.5),
    // TERPISAH dari model(-model) evaluasi di atas — dipakai untuk
    // Attribute Distribution Table dan Export Model.
    let final_model = if v1_equivalent {
        retrain_final_model(&preprocessed, config)
    } else {
        // Konfigurasi v2 (Gaussian min-std dan/atau fitur Text): retrain di
        // SELURUH baris valid lewat `text_features::retrain_final_model_v2`.
        match retrain_final_model_v2(&preprocessed, config, &v2) {
            Ok(model) => model,
            Err(e) => {
                error_collector.add_error("final_model.text", &e);
                return None;
            }
        }
    };

    let attribute_distribution: Vec<AttributeDistributionJson> = compute_attribute_distribution_table(
        &final_model,
        &preprocessed.predictor_order,
        &preprocessed.classes,
    )
    .iter()
    .map(|row| attribute_row_to_json(row, &final_model))
    .collect();

    // Fase N4: nama Raw Text Variable (hanya jalur raw) untuk export
    // `raw_variable` dan baris `Text features` di Case Processing Summary.
    let raw_variable: Option<&str> = v2
        .text
        .as_ref()
        .and_then(|t| t.raw.as_ref())
        .map(|r| r.variable.as_str());
    // Ringkasan Text memakai model FINAL (jumlah term = `text.terms.len()`).
    let text_features_summary: Option<TextFeaturesSummary> = final_model.text.as_ref().map(|t| {
        compute_text_features_summary(
            raw_variable,
            t.terms.len(),
            likelihood_name(t.params.likelihood),
            t.params.alpha,
            t.params.uses_class_prior,
        )
    });
    // NotScored hanya relevan (dan hanya ditampilkan) pada model dengan Text.
    let output_not_scored_rows: Option<usize> = v2.text.as_ref().map(|_| not_scored_rows);
    // Tabel Text Feature: model final saja (bukan per-fold); diabaikan bila
    // tidak ada fitur Text atau flag output dimatikan.
    let text_feature_table: Option<TextFeatureTable> = match final_model.text.as_ref() {
        Some(t) if config_v2.output.text_feature_table => Some(build_text_feature_table(
            &t.params,
            &t.terms,
            config_v2.output.text_top_k,
        )),
        _ => None,
    };

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
        text_features: text_features_summary.map(TextFeaturesSummaryJson::from),
        not_scored_rows: output_not_scored_rows,
    };

    // Fase N3a/N4: baris NotScored dilaporkan terpisah dari baris target-missing
    // (CATATAN_TAHAP2 §2 butir 5) lewat `not_scored_rows` terstruktur di hasil
    // (tampil di Case Processing Summary), BUKAN lewat `error_collector` —
    // itu bukan galat, hanya informasi.
    let _ = not_scored_rows;

    // Fase N4: schema 1.1 (v1, identik) atau 2.0 (Text / gaussian_minstd).
    // Export yang tidak konsisten tidak boleh lolos diam-diam.
    let trained_model = match build_export(&preprocessed, &final_model, config, raw_variable) {
        Ok(model) => model,
        Err(e) => {
            error_collector.add_error("export.model", &e);
            return None;
        }
    };

    Some(NaiveBayesAnalysisResult {
        case_processing_summary,
        attribute_distribution,
        evaluation_metrics,
        confusion_matrix,
        trained_model,
        not_scored_rows: output_not_scored_rows,
        text_feature_table,
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

// ---------------------------------------------------------------------------
// Fase N4 — tes end-to-end `run_analysis`: bentuk JSON hasil (export 2.0,
// tabel Text Feature, ringkasan Text, NotScored).
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests_n4 {
    use super::*;
    use std::collections::HashMap;

    use crate::models::config::{
        MainConfig, NaiveBayesConfig, NaiveBayesConfigV2, OptionsConfig, OutputConfig,
        TextLikelihood, ValidationConfig,
    };
    use crate::models::data::{AnalysisData, DataRecord, DataValue, TextPayload};
    use crate::utils::error::ErrorCollector;
    use statify_text_core::TextVectorizerConfig;

    fn weka_cfg() -> TextVectorizerConfig {
        TextVectorizerConfig::from_json_value(serde_json::json!({
            "lowercase": true,
            "stemming_method": "none",
            "stopwords_method": "none",
            "custom_stopwords": null,
            "delimiters": r#"[\s.,;:'"()?!]+"#,
            "ngram_min": 1,
            "ngram_max": 1,
            "formula_standard": "weka",
            "tf_method": "raw",
            "idf_method": "none",
            "normalization": "none",
            "words_to_keep": 1000,
            "min_term_freq": 1
        }))
        .expect("config Weka default valid")
    }

    fn nb_config() -> NaiveBayesConfig {
        NaiveBayesConfig {
            main: MainConfig {
                target_var: Some("Class".to_string()),
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
                validation_method: "kfold".to_string(),
                training_percentage: 70.0,
                k_folds: 5,
                random_seed: Some(7),
            },
            output: OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        }
    }

    fn target_only_data(labels: &[String]) -> AnalysisData {
        let slice: Vec<DataRecord> = labels
            .iter()
            .map(|label| DataRecord {
                values: HashMap::from([("Class".to_string(), DataValue::Text(label.clone()))]),
            })
            .collect();
        AnalysisData {
            target_data: vec![slice],
            predictors_data: vec![],
            target_data_defs: vec![],
            predictors_data_defs: vec![],
        }
    }

    /// 20 dokumen (10 pos, 10 neg), tiap dokumen punya satu kata unik.
    fn twenty_docs() -> (Vec<String>, Vec<String>) {
        let mut labels = Vec::new();
        let mut docs = Vec::new();
        for i in 0..10 {
            labels.push("pos".to_string());
            docs.push(format!("bagus mantap senang puas unik{}", i));
            labels.push("neg".to_string());
            docs.push(format!("buruk jelek sedih kecewa unik{}", i + 100));
        }
        (labels, docs)
    }

    fn raw_payload(docs: &[String]) -> TextPayload {
        TextPayload::Raw {
            variable: "Teks".to_string(),
            values: docs.iter().map(|d| Some(d.clone())).collect(),
        }
    }

    fn run_json(
        config_v2: &NaiveBayesConfigV2,
        payload: &TextPayload,
        labels: &[String],
    ) -> serde_json::Value {
        let data = target_only_data(labels);
        let mut errors = ErrorCollector::default();
        let result = run_analysis(&data, &nb_config(), config_v2, payload, &mut errors)
            .unwrap_or_else(|| panic!("analisis harus berhasil: {}", errors.get_error_summary()));
        serde_json::to_value(&result).expect("serialisasi hasil")
    }

    fn raw_config_v2() -> NaiveBayesConfigV2 {
        let mut config_v2 = NaiveBayesConfigV2::default();
        config_v2.text = Some(weka_cfg());
        config_v2
    }

    #[test]
    fn raw_multinomial_menghasilkan_export_2_0_tabel_text_dan_ringkasan() {
        let (labels, docs) = twenty_docs();
        let json = run_json(&raw_config_v2(), &raw_payload(&docs), &labels);

        let model = &json["trained_model"];
        assert_eq!(model["schema_version"], "2.0");
        assert_eq!(model["text"]["source"], "raw");
        assert_eq!(model["text"]["raw_variable"], "Teks");
        assert!(model["text"]["recipe"].is_object(), "export raw memuat recipe");

        let n_terms = model["text"]["terms"].as_array().expect("terms").len();
        let summary = &json["case_processing_summary"]["text_features"];
        assert_eq!(summary["source"], "raw");
        assert_eq!(
            summary["description"],
            format!("Raw text: 'Teks' ({} terms)", n_terms)
        );
        assert_eq!(summary["n_terms"], n_terms);
        assert_eq!(summary["uses_class_prior"], true);
        assert!(summary["leakage_note"].is_null());
        assert!(summary["class_prior_note"].is_null());

        // Semua baris punya dokumen -> tidak ada yang NotScored.
        assert_eq!(json["not_scored_rows"], 0);
        assert_eq!(json["case_processing_summary"]["not_scored_rows"], 0);

        let table = &json["text_feature_table"];
        assert_eq!(table["likelihood"], "multinomial");
        assert_eq!(table["classes"], serde_json::json!(["neg", "pos"]));
        // Top-k default 100 > jumlah term -> semua term masuk daftar tiap kelas.
        assert_eq!(table["top"]["pos"].as_array().expect("top pos").len(), n_terms);
        assert_eq!(table["full"].as_array().expect("full").len(), n_terms * 2);
    }

    #[test]
    fn flag_text_feature_table_mati_menghilangkan_tabel() {
        let (labels, docs) = twenty_docs();
        let mut config_v2 = raw_config_v2();
        config_v2.output.text_feature_table = false;
        let json = run_json(&config_v2, &raw_payload(&docs), &labels);
        assert!(json.get("text_feature_table").is_none());
        // Export tidak terpengaruh flag tampilan.
        assert_eq!(json["trained_model"]["schema_version"], "2.0");
    }

    #[test]
    fn text_top_k_membatasi_daftar_per_kelas_tetapi_full_tetap_lengkap() {
        let (labels, docs) = twenty_docs();
        let mut config_v2 = raw_config_v2();
        config_v2.output.text_top_k = 3;
        let json = run_json(&config_v2, &raw_payload(&docs), &labels);
        let table = &json["text_feature_table"];
        assert_eq!(table["k"], 3);
        assert_eq!(table["top"]["neg"].as_array().expect("top neg").len(), 3);
        assert_eq!(table["top"]["pos"].as_array().expect("top pos").len(), 3);
        let n_terms = json["trained_model"]["text"]["terms"].as_array().expect("terms").len();
        assert_eq!(table["full"].as_array().expect("full").len(), n_terms * 2);
    }

    #[test]
    fn complement_tanpa_prior_menampilkan_catatan_dan_flag_di_export() {
        let (labels, docs) = twenty_docs();
        let mut config_v2 = raw_config_v2();
        config_v2.options.text_likelihood = TextLikelihood::Complement;
        let json = run_json(&config_v2, &raw_payload(&docs), &labels);
        assert_eq!(json["trained_model"]["text"]["uses_class_prior"], false);
        let summary = &json["case_processing_summary"]["text_features"];
        assert_eq!(summary["uses_class_prior"], false);
        assert!(summary["class_prior_note"].is_string());
        assert_eq!(json["text_feature_table"]["likelihood"], "complement");
    }

    #[test]
    fn vector_menghasilkan_columns_tanpa_recipe_dan_catatan_leakage() {
        let (labels, docs) = twenty_docs();
        // Vektor kata sederhana: hitung kemunculan 4 kata sentimen per dokumen.
        let columns = ["bagus", "senang", "buruk", "sedih"];
        let values: Vec<Vec<Option<f64>>> = docs
            .iter()
            .map(|doc| {
                columns
                    .iter()
                    .map(|col| Some(doc.split_whitespace().filter(|w| w == col).count() as f64))
                    .collect()
            })
            .collect();
        let payload = TextPayload::Vector {
            columns: columns.iter().map(|c| c.to_string()).collect(),
            values,
        };
        let json = run_json(&NaiveBayesConfigV2::default(), &payload, &labels);

        let model = &json["trained_model"];
        assert_eq!(model["schema_version"], "2.0");
        assert_eq!(model["text"]["source"], "vector");
        assert_eq!(
            model["text"]["columns"],
            serde_json::json!(["bagus", "senang", "buruk", "sedih"])
        );
        assert!(model["text"].get("recipe").map_or(true, |v| v.is_null()));
        assert!(model["text"].get("raw_variable").map_or(true, |v| v.is_null()));

        let summary = &json["case_processing_summary"]["text_features"];
        assert_eq!(summary["source"], "vector");
        assert_eq!(summary["description"], "Word vectors: 4 columns");
        assert!(summary["leakage_note"].is_string());
    }

    // ------------------------------------------------------------------
    // Tambahan N4 (tindak lanjut review): v1 numerik, min-std, NotScored.
    // ------------------------------------------------------------------

    fn numeric_data(labels: &[String]) -> AnalysisData {
        use crate::models::data::{
            VariableAlign, VariableDefinition, VariableMeasure, VariableRole, VariableType,
        };
        let target: Vec<DataRecord> = labels
            .iter()
            .map(|label| DataRecord {
                values: HashMap::from([("Class".to_string(), DataValue::Text(label.clone()))]),
            })
            .collect();
        let predictors: Vec<DataRecord> = labels
            .iter()
            .enumerate()
            .map(|(i, label)| {
                let base = if label == "pos" { 20.0 } else { 10.0 };
                DataRecord {
                    values: HashMap::from([(
                        "Temp".to_string(),
                        DataValue::Number(base + (i as f64) * 0.5),
                    )]),
                }
            })
            .collect();
        let def = VariableDefinition {
            id: None,
            column_index: 0,
            name: "Temp".to_string(),
            r#type: VariableType::Numeric,
            width: 8,
            decimals: 1,
            label: None,
            values: vec![],
            missing: vec![],
            columns: 8,
            align: VariableAlign::Right,
            measure: VariableMeasure::Scale,
            role: VariableRole::Input,
        };
        AnalysisData {
            target_data: vec![target],
            predictors_data: vec![predictors],
            target_data_defs: vec![],
            predictors_data_defs: vec![vec![def]],
        }
    }

    fn run_numeric_json(config_v2: &NaiveBayesConfigV2) -> serde_json::Value {
        let (labels, _) = twenty_docs();
        let data = numeric_data(&labels);
        let mut errors = ErrorCollector::default();
        let result = run_analysis(&data, &nb_config(), config_v2, &TextPayload::None, &mut errors)
            .unwrap_or_else(|| panic!("analisis harus berhasil: {}", errors.get_error_summary()));
        serde_json::to_value(&result).expect("serialisasi hasil")
    }

    #[test]
    fn run_v1_numerik_tidak_memuat_kunci_baru_dan_tetap_schema_1_1() {
        let json = run_numeric_json(&NaiveBayesConfigV2::default());
        assert_eq!(json["trained_model"]["schema_version"], "1.1");
        assert!(json["trained_model"].get("text").is_none());
        assert!(json.get("text_feature_table").is_none());
        assert!(json.get("not_scored_rows").is_none());
        let cps = &json["case_processing_summary"];
        assert!(cps.get("text_features").is_none());
        assert!(cps.get("not_scored_rows").is_none());
        let attr = &json["attribute_distribution"][0];
        assert_eq!(attr["role"], "numerical");
        assert!(attr.get("likelihood").is_none());
        assert!(attr.get("likelihood_note").is_none());
    }

    #[test]
    fn run_gaussian_minstd_memaksa_schema_2_0_dan_memberi_catatan_atribut() {
        use crate::models::config::NumericLikelihood;
        let mut config_v2 = NaiveBayesConfigV2::default();
        config_v2.options.numeric_likelihood = NumericLikelihood::GaussianMinstd;
        let json = run_numeric_json(&config_v2);
        assert_eq!(json["trained_model"]["schema_version"], "2.0");
        assert!(json["trained_model"]["text"].is_null());
        let attr = &json["attribute_distribution"][0];
        assert_eq!(attr["likelihood"], "gaussian_minstd");
        assert!(attr["likelihood_note"].is_string());
        // Tanpa Text: tidak ada tabel Text, ringkasan Text, maupun NotScored.
        assert!(json.get("text_feature_table").is_none());
        assert!(json.get("not_scored_rows").is_none());
        assert!(json["case_processing_summary"].get("text_features").is_none());
    }

    #[test]
    fn not_scored_terstruktur_di_hasil_dan_tidak_masuk_error_collector() {
        let (labels, mut docs) = twenty_docs();
        docs[0] = "   ".to_string(); // whitespace = missing (V11)
        docs[1] = String::new();
        let data = target_only_data(&labels);
        let mut errors = ErrorCollector::default();
        let result = run_analysis(
            &data,
            &nb_config(),
            &raw_config_v2(),
            &raw_payload(&docs),
            &mut errors,
        )
        .unwrap_or_else(|| panic!("analisis harus berhasil: {}", errors.get_error_summary()));
        let json = serde_json::to_value(&result).expect("serialisasi hasil");
        assert_eq!(json["not_scored_rows"], 2);
        assert_eq!(json["case_processing_summary"]["not_scored_rows"], 2);
        assert!(!errors.has_errors(), "{}", errors.get_error_summary());
    }
}
