//! Test Fase A2 — scorer Apply Model 2.0 (fitur Text) memakai `statify-text-core`.
//!
//! Angka golden diambil persis dari `naive-bayes/AGENTS_V2.md` §6.7 (kelas `[neg, pos]`, kosakata
//! `[makan, nasi, saya, suka, tidak]`, alpha 1, dokumen uji `"makan nasi enak"` -> x = [1,1,0,0,0]).
//!
//! Toleransi:
//! - fixture `nb-model-v2_0-*.json` (log_weights dibulatkan 6 desimal) -> 1e-6;
//! - model yang DILATIH di test (bobot presisi penuh) vs komposisi `ln prior + CORE::nb_text` -> 1e-9
//!   (padanan NB <-> AM, P-V3).
//!
//! Aturan NotScored/K5/V11 mengikuti `plan-reports-v2/CATATAN_TAHAP2_negatif_dan_notscored.md` §2.

use std::collections::HashMap;

use serde_json::{json, Value};
use statify_text_core::nb_text::{score_rows, train, TextLikelihood, TextNbParams};
use statify_text_core::{fit_transform, CsrMatrix, TextVectorizerConfig, TextVectorizerModel};

use wasm::models::data::{
    DataRecord, DataValue, VariableAlign, VariableDefinition, VariableMeasure, VariableRole,
    VariableType,
};
use wasm::models::payload::{MappingEntry, TextPayload, TextValues};
use wasm::models::result::ApplyModelRawResult;
use wasm::scoring::{build_scorer, RowScore};
use wasm::stats::posterior::normalize_log_scores;
use wasm::wasm::function::{run_apply_model, run_apply_model_with_text};

const TOL_FIXTURE: f64 = 1e-6;
const TOL_NB_AM: f64 = 1e-9;

const FIXTURE_VECTOR: &str = include_str!("../../services/__fixtures__/nb-model-v2_0-vector.json");
const FIXTURE_RAW: &str = include_str!("../../services/__fixtures__/nb-model-v2_0-raw.json");

// ---------------------------------------------------------------------------
// Helper umum
// ---------------------------------------------------------------------------

fn classes() -> Vec<String> {
    vec!["neg".to_string(), "pos".to_string()]
}

fn terms() -> Vec<String> {
    ["makan", "nasi", "saya", "suka", "tidak"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn vector_columns() -> Vec<String> {
    ["VEC_makan", "VEC_nasi", "VEC_saya", "VEC_suka", "VEC_tidak"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

fn csr_from_dense(rows: &[Vec<f64>]) -> CsrMatrix {
    let n_cols = rows.first().map_or(0, |r| r.len());
    let mut indptr = vec![0usize];
    let mut indices = Vec::new();
    let mut data = Vec::new();
    for row in rows {
        for (c, &v) in row.iter().enumerate() {
            if v != 0.0 {
                indices.push(c as u32);
                data.push(v);
            }
        }
        indptr.push(indices.len());
    }
    CsrMatrix {
        n_rows: rows.len(),
        n_cols,
        indptr,
        indices,
        data,
    }
}

fn golden_train_matrix() -> CsrMatrix {
    csr_from_dense(&[
        vec![1.0, 1.0, 1.0, 1.0, 0.0],
        vec![0.0, 1.0, 1.0, 1.0, 1.0],
        vec![3.0, 0.0, 0.0, 0.0, 0.0],
    ])
}

/// Dokumen uji "makan nasi enak" -> x = [1,1,0,0,0].
fn golden_test_matrix() -> CsrMatrix {
    csr_from_dense(&[vec![1.0, 1.0, 0.0, 0.0, 0.0]])
}

/// Model teks terlatih pada data golden (label pos, neg, pos -> y = [1, 0, 1]), presisi penuh.
fn golden_params(likelihood: TextLikelihood) -> TextNbParams {
    train(&golden_train_matrix(), &[1, 0, 1], 2, &classes(), likelihood, 1.0)
}

struct Golden {
    likelihood: TextLikelihood,
    name: &'static str,
    scores: [f64; 2],
    p_pos: f64,
}

fn goldens() -> Vec<Golden> {
    vec![
        Golden {
            likelihood: TextLikelihood::Multinomial,
            name: "multinomial",
            scores: [-4.799914, -3.072693],
            p_pos: 0.849057,
        },
        Golden {
            likelihood: TextLikelihood::Bernoulli,
            name: "bernoulli",
            scores: [-5.898527, -3.060271],
            p_pos: 0.944708,
        },
        Golden {
            likelihood: TextLikelihood::Complement,
            name: "complement",
            scores: [2.667228, 3.701302],
            p_pos: 0.737705,
        },
    ]
}

fn assert_close(actual: f64, expected: f64, tol: f64, ctx: &str) {
    assert!(
        (actual - expected).abs() < tol,
        "{ctx}: diperoleh {actual}, diharapkan {expected} (toleransi {tol})"
    );
}

fn weights_json(matrix: &[Vec<f64>]) -> Value {
    json!({ "neg": matrix[0], "pos": matrix[1] })
}

/// Blok `text` schema 2.0 dari parameter terlatih.
fn text_block(params: &TextNbParams, source: &str, recipe: Option<Value>) -> Value {
    let raw = source == "raw";
    let absent = match &params.log_weights_absent {
        Some(matrix) => weights_json(matrix),
        None => Value::Null,
    };
    json!({
        "source": source,
        "likelihood": serde_json::to_value(params.likelihood).unwrap(),
        "alpha": params.alpha,
        "terms": if raw { terms() } else { vector_columns() },
        "raw_variable": if raw { json!("Teks") } else { Value::Null },
        "columns": if raw { Value::Null } else { json!(vector_columns()) },
        "log_weights": weights_json(&params.log_weights),
        "log_weights_absent": absent,
        "class_term_counts": weights_json(&params.class_term_counts),
        "uses_class_prior": params.uses_class_prior,
        "recipe": recipe.unwrap_or(Value::Null),
    })
}

/// Model schema 2.0. Prior = proporsi kelas data golden (1/3, 2/3).
fn model_json(text: Option<Value>, features: Vec<Value>, order: &[&str]) -> Value {
    let prior_neg = 1.0_f64 / 3.0;
    let prior_pos = 2.0_f64 / 3.0;
    json!({
        "schema_version": "2.0",
        "model_type": "naive_bayes",
        "trained_at": "2026-10-01T00:00:00.000Z",
        "target": { "name": "Sentimen", "classes": ["neg", "pos"],
                    "class_priors": [prior_neg, prior_pos], "class_counts": [1, 2] },
        "features": features,
        "smoothing_alpha": 1.0,
        "variance_floor": 1e-9,
        "feature_order": order,
        "label_mapping": { "neg": 0, "pos": 1 },
        "validation_config": { "method": "holdout", "training_percentage": 70,
                               "holdout_percentage": 30, "folds": null, "seed": 42 },
        "missing_value_policy": "x",
        "unseen_category_policy": "x",
        "text": text.unwrap_or(Value::Null),
    })
}

fn vector_model(likelihood: TextLikelihood) -> Value {
    let params = golden_params(likelihood);
    model_json(Some(text_block(&params, "vector", None)), vec![], &[])
}

/// Resep CORE hasil `fit` pada 3 dokumen PLAN_FIX §3.6 + parameter Text terlatih dari matriks fit.
fn raw_recipe_and_params(likelihood: TextLikelihood) -> (TextVectorizerModel, TextNbParams) {
    let cfg: TextVectorizerConfig = serde_json::from_value(json!({
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
        "min_term_freq": 1,
    }))
    .expect("config valid");
    let docs: Vec<String> = ["Saya suka makan nasi", "Saya tidak suka nasi!", "Makan, makan, makan"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let (recipe, matrix) = fit_transform(&docs, &cfg).expect("fit_transform");
    assert_eq!(recipe.vocabulary, terms());
    let params = train(&matrix, &[1, 0, 1], 2, &classes(), likelihood, 1.0);
    (recipe, params)
}

fn raw_model(likelihood: TextLikelihood) -> Value {
    let (recipe, params) = raw_recipe_and_params(likelihood);
    model_json(
        Some(text_block(&params, "raw", Some(serde_json::to_value(&recipe).unwrap()))),
        vec![],
        &[],
    )
}

fn raw_payload(values: &[Option<&str>]) -> TextPayload {
    TextPayload {
        source: "raw".to_string(),
        mapped_columns: None,
        values: TextValues::Raw(values.iter().map(|v| v.map(|s| s.to_string())).collect()),
    }
}

fn vector_payload(mapped: &[usize], rows: &[Vec<Option<f64>>]) -> TextPayload {
    TextPayload {
        source: "vector".to_string(),
        mapped_columns: Some(mapped.to_vec()),
        values: TextValues::Vector(rows.to_vec()),
    }
}

fn some_row(values: &[f64]) -> Vec<Option<f64>> {
    values.iter().map(|v| Some(*v)).collect()
}

/// Skor log per baris lewat scorer (`None` = NotScored).
fn log_scores(model: &Value, payload: &TextPayload, rows: usize) -> Vec<Option<Vec<f64>>> {
    let scorer = build_scorer(model).expect("model valid");
    let text_model = scorer.text_model().expect("model punya Text");
    let scores = text_model.prepare(payload, rows).expect("prepare");
    (0..rows)
        .map(|row| match scorer.score_row_with_text(&[], scores.row(row)) {
            RowScore::Scored { log_scores, .. } => Some(log_scores),
            RowScore::NotScored => None,
        })
        .collect()
}

/// `ln prior + kontribusi CORE::nb_text` (tanpa prior bila `uses_class_prior = false`) — cara NB menggabungkan skor.
fn composed_scores(params: &TextNbParams, matrix: &CsrMatrix) -> Vec<f64> {
    let priors = [1.0_f64 / 3.0, 2.0_f64 / 3.0];
    let contribution = score_rows(params, matrix);
    (0..2)
        .map(|c| {
            let prior = if params.uses_class_prior { priors[c].ln() } else { 0.0 };
            prior + contribution[0][c]
        })
        .collect()
}

fn build_err(model: &Value) -> String {
    match build_scorer(model) {
        Ok(_) => panic!("seharusnya Err"),
        Err(e) => e,
    }
}

fn run_text(model: &Value, payload: &TextPayload) -> Result<ApplyModelRawResult, String> {
    run_apply_model_with_text(&[], &[], &[], &[], &[], model, Some(payload))
}

fn parameter<'a>(result: &'a ApplyModelRawResult, label: &str) -> Option<&'a str> {
    result
        .model_summary
        .parameters
        .iter()
        .find(|p| p.label == label)
        .map(|p| p.value.as_str())
}

// ---------------------------------------------------------------------------
// Golden §6.7 — jalur vector
// ---------------------------------------------------------------------------

#[test]
fn golden_vector_ketiga_likelihood_cocok_dengan_tabel_dan_komposisi_nb() {
    for golden in goldens() {
        let model = vector_model(golden.likelihood);
        let payload = vector_payload(&[0, 1, 2, 3, 4], &[some_row(&[1.0, 1.0, 0.0, 0.0, 0.0])]);
        let scores = log_scores(&model, &payload, 1).remove(0).expect("diskor");

        // Angka acuan dokumen (1e-6).
        for c in 0..2 {
            assert_close(scores[c], golden.scores[c], TOL_FIXTURE, &format!("{} skor[{}]", golden.name, c));
        }
        let p_pos = normalize_log_scores(&scores)[1];
        assert_close(p_pos, golden.p_pos, TOL_FIXTURE, &format!("{} P(pos)", golden.name));

        // NB <-> AM pada model yang dilatih (1e-9).
        let params = golden_params(golden.likelihood);
        let composed = composed_scores(&params, &golden_test_matrix());
        for c in 0..2 {
            assert_close(scores[c], composed[c], TOL_NB_AM, &format!("{} NB<->AM[{}]", golden.name, c));
        }
    }
}

#[test]
fn golden_vector_lewat_pipeline_penuh_menghasilkan_prediksi_dan_ringkasan() {
    let model = vector_model(TextLikelihood::Multinomial);
    let payload = vector_payload(&[0, 1, 2, 3, 4], &[some_row(&[1.0, 1.0, 0.0, 0.0, 0.0])]);
    let result = run_text(&model, &payload).expect("hasil");

    assert_eq!(result.predictions.predicted, vec![Some("pos".to_string())]);
    assert_eq!(result.predictions.class_probabilities[1][0], Some(0.8491));
    assert_eq!(result.case_processing_summary.total_rows, 1);
    assert_eq!(result.case_processing_summary.scored_rows, 1);
    assert_eq!(parameter(&result, "Text source"), Some("vector"));
    assert_eq!(parameter(&result, "Text likelihood"), Some("multinomial"));
    assert_eq!(parameter(&result, "Text features zero-filled"), Some("0"));
    assert_eq!(parameter(&result, "Rows with empty text"), None);
}

// ---------------------------------------------------------------------------
// Golden §6.7 — jalur raw (resep dari CORE::fit pada 3 dokumen PLAN_FIX §3.6)
// ---------------------------------------------------------------------------

#[test]
fn golden_raw_ketiga_likelihood_cocok_dengan_tabel_dan_komposisi_nb() {
    for golden in goldens() {
        let model = raw_model(golden.likelihood);
        let payload = raw_payload(&[Some("makan nasi enak")]);
        let scores = log_scores(&model, &payload, 1).remove(0).expect("diskor");

        for c in 0..2 {
            assert_close(scores[c], golden.scores[c], TOL_FIXTURE, &format!("{} skor[{}]", golden.name, c));
        }
        let p_pos = normalize_log_scores(&scores)[1];
        assert_close(p_pos, golden.p_pos, TOL_FIXTURE, &format!("{} P(pos)", golden.name));

        let (_, params) = raw_recipe_and_params(golden.likelihood);
        let composed = composed_scores(&params, &golden_test_matrix());
        for c in 0..2 {
            assert_close(scores[c], composed[c], TOL_NB_AM, &format!("{} NB<->AM[{}]", golden.name, c));
        }
    }
}

#[test]
fn golden_raw_multinomial_p_pos_dokumen_makan_nasi_enak_0_849057() {
    let model = raw_model(TextLikelihood::Multinomial);
    let payload = raw_payload(&[Some("makan nasi enak")]);
    let result = run_text(&model, &payload).expect("hasil");

    assert_eq!(result.predictions.predicted, vec![Some("pos".to_string())]);
    // 0.849057 dibulatkan 4 desimal oleh `round4`.
    assert_eq!(result.predictions.class_probabilities[1][0], Some(0.8491));
    assert_eq!(result.predictions.class_probabilities[0][0], Some(0.1509));
    assert_eq!(parameter(&result, "Text source"), Some("raw"));
    assert_eq!(parameter(&result, "Rows with empty text"), Some("0"));
    assert_eq!(parameter(&result, "Text features zero-filled"), None);
}

// ---------------------------------------------------------------------------
// Fixture A1 (log_weights dibulatkan 6 desimal -> toleransi 1e-6)
// ---------------------------------------------------------------------------

#[test]
fn fixture_vector_a1_skor_cocok_golden_dalam_1e_6() {
    let model: Value = serde_json::from_str(FIXTURE_VECTOR).expect("fixture JSON");
    let payload = vector_payload(&[0, 1, 2, 3, 4], &[some_row(&[1.0, 1.0, 0.0, 0.0, 0.0])]);
    let scores = log_scores(&model, &payload, 1).remove(0).expect("diskor");
    assert_close(scores[0], -4.799914, TOL_FIXTURE, "neg");
    assert_close(scores[1], -3.072693, TOL_FIXTURE, "pos");
    assert_close(normalize_log_scores(&scores)[1], 0.849057, TOL_FIXTURE, "P(pos)");
}

#[test]
fn fixture_raw_a1_skor_cocok_golden_dalam_1e_6() {
    let model: Value = serde_json::from_str(FIXTURE_RAW).expect("fixture JSON");
    let payload = raw_payload(&[Some("makan nasi enak")]);
    let scores = log_scores(&model, &payload, 1).remove(0).expect("diskor");
    assert_close(scores[0], -4.799914, TOL_FIXTURE, "neg");
    assert_close(scores[1], -3.072693, TOL_FIXTURE, "pos");
    assert_close(normalize_log_scores(&scores)[1], 0.849057, TOL_FIXTURE, "P(pos)");
}

#[test]
fn fixture_vector_tiga_dari_lima_kolom_terpetakan_sisanya_nol() {
    // Hanya VEC_makan dan VEC_nasi terpetakan; 3 kolom lain di-zero-fill.
    let model: Value = serde_json::from_str(FIXTURE_VECTOR).expect("fixture JSON");
    let payload = vector_payload(&[0, 1], &[some_row(&[1.0, 1.0])]);
    let result = run_text(&model, &payload).expect("hasil");
    assert_eq!(result.predictions.predicted, vec![Some("pos".to_string())]);
    assert_eq!(parameter(&result, "Text features zero-filled"), Some("3"));
}

#[test]
fn urutan_mapped_columns_tidak_mempengaruhi_skor() {
    let model = vector_model(TextLikelihood::Multinomial);
    let ordered = vector_payload(&[0, 1], &[some_row(&[1.0, 1.0])]);
    let shuffled = vector_payload(&[1, 0], &[some_row(&[1.0, 1.0])]);
    let a = log_scores(&model, &ordered, 1).remove(0).unwrap();
    let b = log_scores(&model, &shuffled, 1).remove(0).unwrap();
    for c in 0..2 {
        assert_close(a[c], b[c], TOL_NB_AM, "urutan kolom");
    }
}

#[test]
fn resep_dengan_bilangan_bulat_bertipe_float_tetap_terbaca() {
    // Nilai `doc_freq`/`n_docs`/`ngram_*` bisa tiba dari JS sebagai float bernilai bulat (2.0).
    let mut model = raw_model(TextLikelihood::Multinomial);
    {
        let recipe = &mut model["text"]["recipe"];
        recipe["n_docs"] = json!(3.0);
        recipe["doc_freq"] = json!([2.0, 2.0, 2.0, 2.0, 1.0]);
        recipe["config"]["ngram_min"] = json!(1.0);
        recipe["config"]["ngram_max"] = json!(1.0);
        recipe["config"]["words_to_keep"] = json!(1000.0);
        recipe["config"]["min_term_freq"] = json!(1.0);
    }
    let payload = raw_payload(&[Some("makan nasi enak")]);
    let scores = log_scores(&model, &payload, 1).remove(0).expect("diskor");
    assert_close(scores[1], -3.072693, TOL_FIXTURE, "pos");
}

// ---------------------------------------------------------------------------
// K5 / V11 — baris missing & NotScored (CATATAN_TAHAP2 §2)
// ---------------------------------------------------------------------------

fn temp_feature() -> Value {
    json!({ "name": "Temp", "role": "numerical", "likelihood": "gaussian", "min_variance": null,
            "mean": { "neg": 60.0, "pos": 80.0 }, "variance": { "neg": 25.0, "pos": 25.0 } })
}

fn make_def(name: &str, column_index: usize) -> VariableDefinition {
    VariableDefinition {
        id: None,
        column_index,
        name: name.to_string(),
        r#type: VariableType::Numeric,
        width: 8,
        decimals: 0,
        label: None,
        values: Vec::new(),
        missing: Vec::new(),
        columns: 64,
        align: VariableAlign::Right,
        measure: VariableMeasure::Scale,
        role: VariableRole::Input,
    }
}

fn temp_slice(
    values: &[Option<f64>],
) -> (
    Vec<Vec<DataRecord>>,
    Vec<Vec<VariableDefinition>>,
    Vec<MappingEntry>,
) {
    let records: Vec<DataRecord> = values
        .iter()
        .map(|v| {
            let mut map = HashMap::new();
            map.insert(
                "Temp".to_string(),
                v.map_or(DataValue::Null, DataValue::Number),
            );
            DataRecord { values: map }
        })
        .collect();
    (
        vec![records],
        vec![vec![make_def("Temp", 0)]],
        vec![MappingEntry {
            feature: "Temp".to_string(),
            variable: "Temp".to_string(),
        }],
    )
}

fn mixed_raw_model(likelihood: TextLikelihood) -> Value {
    let (recipe, params) = raw_recipe_and_params(likelihood);
    model_json(
        Some(text_block(&params, "raw", Some(serde_json::to_value(&recipe).unwrap()))),
        vec![temp_feature()],
        &["Temp"],
    )
}

#[test]
fn raw_kosong_dengan_prediktor_lain_tetap_diprediksi_dan_semua_missing_notscored() {
    let model = mixed_raw_model(TextLikelihood::Multinomial);
    let temps = [Some(75.0), Some(75.0), None, None, None];
    let texts = [
        Some("makan nasi"), // ada teks + Temp
        Some(""),           // teks kosong + Temp -> diprediksi (vektor nol)
        None,               // semua missing -> NotScored
        Some("   "),        // whitespace = missing -> NotScored
        Some("makan"),      // hanya teks ada -> diprediksi
    ];
    let (predictors, defs, mapping) = temp_slice(&temps);
    let payload = raw_payload(&texts);
    let result =
        run_apply_model_with_text(&predictors, &defs, &mapping, &[], &[], &model, Some(&payload))
            .expect("hasil");

    let predicted = &result.predictions.predicted;
    assert!(predicted[0].is_some(), "baris 0");
    assert!(predicted[1].is_some(), "baris 1: teks kosong + Temp harus diprediksi");
    assert!(predicted[2].is_none(), "baris 2: semua missing");
    assert!(predicted[3].is_none(), "baris 3: whitespace + Temp null");
    assert!(predicted[4].is_some(), "baris 4: hanya teks");

    let cps = &result.case_processing_summary;
    assert_eq!(cps.total_rows, 5);
    assert_eq!(cps.scored_rows, 3);
    assert_eq!(cps.not_scored_all_missing, 2);
    // Baris 1 (teks missing) dan baris 4 (Temp missing) diskor dengan prediktor missing.
    assert_eq!(cps.rows_with_missing_predictor, 2);
    assert_eq!(parameter(&result, "Rows with empty text"), Some("3"));

    // Baris 1: teks kosong Multinomial = kontribusi 0 -> skor sama dengan hanya prior + Temp.
    let scorer = build_scorer(&model).unwrap();
    let baseline = match scorer.score_row(&[DataValue::Number(75.0)]) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("baseline NotScored"),
    };
    let text_model = scorer.text_model().unwrap();
    let scores = text_model.prepare(&payload, 5).unwrap();
    let with_empty = match scorer.score_row_with_text(&[DataValue::Number(75.0)], scores.row(1)) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("NotScored"),
    };
    for c in 0..2 {
        assert_close(with_empty[c], baseline[c], TOL_NB_AM, "teks kosong Multinomial = nol");
    }
}

#[test]
fn bernoulli_teks_kosong_dengan_prediktor_lain_tetap_menambah_sum_a_ct() {
    // Bernoulli: vektor nol TETAP informatif (Σ_t A_ct) — tidak boleh diseragamkan dengan Multinomial.
    let model = mixed_raw_model(TextLikelihood::Bernoulli);
    let (_, params) = raw_recipe_and_params(TextLikelihood::Bernoulli);
    let absent = params.log_weights_absent.clone().expect("A_ct");
    let sum_absent: Vec<f64> = absent.iter().map(|row| row.iter().sum()).collect();

    let payload = raw_payload(&[Some("")]);
    let scorer = build_scorer(&model).unwrap();
    let scores = scorer
        .text_model()
        .unwrap()
        .prepare(&payload, 1)
        .unwrap();
    let baseline = match scorer.score_row(&[DataValue::Number(75.0)]) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("baseline NotScored"),
    };
    let with_empty = match scorer.score_row_with_text(&[DataValue::Number(75.0)], scores.row(0)) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("NotScored"),
    };
    for c in 0..2 {
        assert_close(with_empty[c], baseline[c] + sum_absent[c], TOL_NB_AM, "Bernoulli teks kosong");
    }
}

#[test]
fn complement_hanya_text_dengan_teks_kosong_adalah_notscored_bukan_skor_nol() {
    let model = raw_model(TextLikelihood::Complement);
    let payload = raw_payload(&[Some("makan nasi enak"), None, Some("   ")]);
    let result = run_text(&model, &payload).expect("hasil");
    assert!(result.predictions.predicted[0].is_some());
    assert_eq!(result.predictions.predicted[1], None);
    assert_eq!(result.predictions.predicted[2], None);
    assert_eq!(result.case_processing_summary.not_scored_all_missing, 2);
    assert_eq!(parameter(&result, "Rows with empty text"), Some("2"));
}

#[test]
fn raw_model_hanya_text_semua_teks_kosong_semua_notscored_tanpa_error() {
    let model = raw_model(TextLikelihood::Multinomial);
    let payload = raw_payload(&[None, Some("")]);
    let result = run_text(&model, &payload).expect("hasil");
    assert_eq!(result.case_processing_summary.scored_rows, 0);
    assert_eq!(result.case_processing_summary.not_scored_all_missing, 2);
}

#[test]
fn vector_semua_kolom_terpetakan_null_dianggap_missing() {
    let model = vector_model(TextLikelihood::Multinomial);
    let rows = vec![
        some_row(&[1.0, 1.0]),    // ada nilai
        vec![None, None],         // semua null -> missing
        vec![Some(f64::NAN), None], // non-finite = tanpa nilai -> missing
        some_row(&[0.0, 0.0]),    // nol bukan missing: nilai ada (vektor nol sungguhan)
    ];
    let payload = vector_payload(&[0, 1], &rows);
    let result = run_text(&model, &payload).expect("hasil");
    let predicted = &result.predictions.predicted;
    assert!(predicted[0].is_some());
    assert!(predicted[1].is_none());
    assert!(predicted[2].is_none());
    assert!(predicted[3].is_some(), "angka 0 yang sungguh ada bukan missing");
    assert_eq!(result.case_processing_summary.not_scored_all_missing, 2);
    assert_eq!(parameter(&result, "Text features zero-filled"), Some("3"));
}

#[test]
fn vector_semua_kolom_tidak_terpetakan_adalah_missing_bukan_sekadar_nol() {
    let model = vector_model(TextLikelihood::Multinomial);
    let payload = vector_payload(&[], &[vec![], vec![]]);
    let result = run_text(&model, &payload).expect("hasil");
    assert_eq!(result.case_processing_summary.total_rows, 2);
    assert_eq!(result.case_processing_summary.not_scored_all_missing, 2);
    assert_eq!(result.predictions.predicted, vec![None, None]);
    assert_eq!(parameter(&result, "Text features zero-filled"), Some("5"));
}

#[test]
fn vector_tidak_terpetakan_dengan_prediktor_lain_tetap_diskor_dari_prediktor_itu() {
    let params = golden_params(TextLikelihood::Multinomial);
    let model = model_json(
        Some(text_block(&params, "vector", None)),
        vec![temp_feature()],
        &["Temp"],
    );
    let (predictors, defs, mapping) = temp_slice(&[Some(79.0), Some(61.0)]);
    let payload = vector_payload(&[], &[vec![], vec![]]);
    let result =
        run_apply_model_with_text(&predictors, &defs, &mapping, &[], &[], &model, Some(&payload))
            .expect("hasil");
    // Temp 79 dekat mean pos (80), Temp 61 dekat mean neg (60).
    assert_eq!(
        result.predictions.predicted,
        vec![Some("pos".to_string()), Some("neg".to_string())]
    );
    // Teks missing pada baris yang tetap diskor dihitung sebagai prediktor missing.
    assert_eq!(result.case_processing_summary.rows_with_missing_predictor, 2);
}

#[test]
fn baris_payload_text_lebih_pendek_dari_prediktor_dianggap_teks_missing() {
    let model = mixed_raw_model(TextLikelihood::Multinomial);
    let (predictors, defs, mapping) = temp_slice(&[Some(75.0), None]);
    let payload = raw_payload(&[Some("makan")]); // baris 1 tidak ada di payload
    let result =
        run_apply_model_with_text(&predictors, &defs, &mapping, &[], &[], &model, Some(&payload))
            .expect("hasil");
    assert_eq!(result.case_processing_summary.total_rows, 2);
    assert!(result.predictions.predicted[0].is_some());
    assert!(result.predictions.predicted[1].is_none());
}

// ---------------------------------------------------------------------------
// Nilai negatif (AM_E_TEXT_NEGATIVE) — CATATAN_TAHAP2 §1
// ---------------------------------------------------------------------------

#[test]
fn negatif_satu_kolom_menyebut_nama_kolom_model() {
    let model = vector_model(TextLikelihood::Multinomial);
    let rows = vec![some_row(&[1.0, -1.0, 0.0]), some_row(&[2.0, 0.0, 3.0])];
    let payload = vector_payload(&[0, 1, 2], &rows);
    let e = run_text(&model, &payload).expect_err("harus error");
    assert!(e.starts_with("AM_E_TEXT_NEGATIVE:"), "{}", e);
    assert!(e.contains("VEC_nasi"), "{}", e);
    assert!(!e.contains("columns affected"), "satu kolom saja tidak perlu jumlah: {}", e);
    assert!(e.ends_with("VEC_nasi"), "detail hanya nama kolom: {}", e);
}

#[test]
fn negatif_beberapa_kolom_menyebut_kolom_pertama_dan_jumlah() {
    let model = vector_model(TextLikelihood::Bernoulli);
    let rows = vec![some_row(&[1.0, -1.0, 0.0]), some_row(&[-2.0, 0.0, -5.0])];
    let payload = vector_payload(&[0, 1, 2], &rows);
    let e = run_text(&model, &payload).expect_err("harus error");
    assert!(e.starts_with("AM_E_TEXT_NEGATIVE:"), "{}", e);
    assert!(e.contains("VEC_makan"), "kolom bermasalah pertama menurut urutan mapped_columns: {}", e);
    assert!(e.contains("(3 columns affected)"), "{}", e);
    assert!(e.ends_with("VEC_makan (3 columns affected)"), "format §3.2 persis: {}", e);
    assert!(!e.contains("kolom bermasalah"), "format lama tidak boleh muncul: {}", e);
}

#[test]
fn tanpa_negatif_tidak_error_dan_kolom_zero_filled_tidak_diperiksa() {
    let model = vector_model(TextLikelihood::Complement);
    // Hanya kolom 0 terpetakan; kolom lain tidak punya nilai sehingga tidak ada yang diperiksa.
    let payload = vector_payload(&[0], &[some_row(&[2.0])]);
    assert!(run_text(&model, &payload).is_ok());
}

#[test]
fn nilai_pecahan_tf_idf_diperbolehkan() {
    let model = vector_model(TextLikelihood::Multinomial);
    let payload = vector_payload(&[0, 1], &[some_row(&[0.25, 0.5])]);
    assert!(run_text(&model, &payload).is_ok());
}

// ---------------------------------------------------------------------------
// Payload & kecocokan sumber
// ---------------------------------------------------------------------------

#[test]
fn model_dengan_text_tanpa_payload_text_ditolak() {
    let model = vector_model(TextLikelihood::Multinomial);
    let e = run_apply_model(&[], &[], &[], &[], &[], &model).expect_err("harus error");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);
}

#[test]
fn sumber_payload_harus_sama_dengan_sumber_model() {
    let model = vector_model(TextLikelihood::Multinomial);
    let e = run_text(&model, &raw_payload(&[Some("makan")])).expect_err("harus error");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);

    let raw = raw_model(TextLikelihood::Multinomial);
    let e = run_text(&raw, &vector_payload(&[0], &[some_row(&[1.0])])).expect_err("harus error");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);
}

#[test]
fn mapped_columns_tidak_valid_atau_baris_tidak_sejajar_ditolak() {
    let model = vector_model(TextLikelihood::Multinomial);
    let e = run_text(&model, &vector_payload(&[9], &[some_row(&[1.0])])).expect_err("indeks");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);
    let e = run_text(&model, &vector_payload(&[0, 0], &[some_row(&[1.0, 1.0])])).expect_err("duplikat");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);
    let e = run_text(&model, &vector_payload(&[0, 1], &[some_row(&[1.0])])).expect_err("panjang baris");
    assert!(e.starts_with("AM_E_PAYLOAD:"), "{}", e);
}

#[test]
fn payload_text_diparse_dari_json_bentuk_ts() {
    let raw: TextPayload =
        serde_json::from_value(json!({ "source": "raw", "values": ["makan nasi", null, ""] }))
            .expect("raw");
    assert_eq!(raw.source, "raw");
    assert_eq!(raw.row_count(), 3);

    let vector: TextPayload = serde_json::from_value(json!({
        "source": "vector", "mapped_columns": [0, 2], "values": [[1, 0.5], [null, 2]]
    }))
    .expect("vector");
    assert_eq!(vector.mapped_columns, Some(vec![0, 2]));
    assert_eq!(vector.row_count(), 2);

    // Tanpa baris sama sekali tetap terparse (tidak ambigu karena `source` menentukan).
    let empty: TextPayload =
        serde_json::from_value(json!({ "source": "vector", "mapped_columns": [], "values": [] }))
            .expect("kosong");
    assert_eq!(empty.row_count(), 0);
}

#[test]
fn model_v1_mengabaikan_payload_text_berlebih() {
    // Keputusan konservatif: model tanpa Text tidak berubah perilakunya bila payload Text ikut dikirim.
    let mut model = model_json(None, vec![temp_feature()], &["Temp"]);
    model["schema_version"] = json!("1.1");
    let (predictors, defs, mapping) = temp_slice(&[Some(79.0), None]);
    let payload = raw_payload(&[Some("makan"), Some("nasi"), Some("tidak")]);

    let without =
        run_apply_model(&predictors, &defs, &mapping, &[], &[], &model).expect("tanpa text");
    let with_text =
        run_apply_model_with_text(&predictors, &defs, &mapping, &[], &[], &model, Some(&payload))
            .expect("dengan text");
    assert_eq!(without.predictions.predicted, with_text.predictions.predicted);
    assert_eq!(
        without.case_processing_summary.total_rows,
        with_text.case_processing_summary.total_rows
    );
    assert_eq!(without.model_summary.parameters.len(), with_text.model_summary.parameters.len());
}

// ---------------------------------------------------------------------------
// Validasi lapis kedua (AM_E_NB2_*, AGENTS_V2 §10.1)
// ---------------------------------------------------------------------------

#[test]
fn fixture_v2_valid_dan_text_null_tanpa_text_tetap_valid() {
    assert!(build_scorer(&serde_json::from_str::<Value>(FIXTURE_VECTOR).unwrap()).is_ok());
    assert!(build_scorer(&serde_json::from_str::<Value>(FIXTURE_RAW).unwrap()).is_ok());
    // 2.0 tanpa blok text (text: null) dengan fitur numerik = model numerik biasa.
    assert!(build_scorer(&model_json(None, vec![temp_feature()], &["Temp"])).is_ok());
}

#[test]
fn uses_class_prior_harus_konsisten_dengan_likelihood_dan_k() {
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["uses_class_prior"] = json!(false);
    assert!(build_err(&model).contains("AM_E_NB2_LIKELIHOOD"));

    let mut model = vector_model(TextLikelihood::Complement);
    model["text"]["uses_class_prior"] = json!(true);
    assert!(build_err(&model).contains("AM_E_NB2_LIKELIHOOD"));

    let mut model = vector_model(TextLikelihood::Bernoulli);
    model["text"]["uses_class_prior"] = json!(false);
    assert!(build_err(&model).contains("AM_E_NB2_LIKELIHOOD"));
}

#[test]
fn alpha_harus_positif_dan_finite() {
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["alpha"] = json!(0.0);
    assert!(build_err(&model).contains("AM_E_PARAM_INVALID"));
    model["text"]["alpha"] = json!(-1.0);
    assert!(build_err(&model).contains("AM_E_PARAM_INVALID"));
    model["text"]["alpha"] = json!("x");
    assert!(build_err(&model).contains("AM_E_PARAM_INVALID"));
}

#[test]
fn log_weights_harus_finite_dan_bertanda_sesuai_likelihood() {
    // Bukan angka (JSON tidak punya NaN/Inf) -> AM_E_FIELD_TYPE.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["log_weights"]["neg"][2] = json!("NaN");
    assert!(build_err(&model).contains("AM_E_FIELD_TYPE"));

    // Multinomial: ln θ harus <= 0.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["log_weights"]["pos"][0] = json!(0.5);
    assert!(build_err(&model).contains("AM_E_FIELD_TYPE"));

    // Complement: -ln θ̃ harus >= 0.
    let mut model = vector_model(TextLikelihood::Complement);
    model["text"]["log_weights"]["pos"][0] = json!(-0.5);
    assert!(build_err(&model).contains("AM_E_FIELD_TYPE"));

    // class_term_counts tidak boleh negatif.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["class_term_counts"]["neg"][0] = json!(-1.0);
    assert!(build_err(&model).contains("AM_E_FIELD_TYPE"));
}

#[test]
fn bentuk_text_harus_konsisten() {
    // Panjang log_weights != panjang terms.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["log_weights"]["neg"] = json!([-1.0, -2.0]);
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SHAPE"));

    // columns berbeda dari terms.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["columns"] = json!(["a", "b", "c", "d", "e"]);
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SHAPE"));

    // Bernoulli wajib log_weights_absent.
    let mut model = vector_model(TextLikelihood::Bernoulli);
    model["text"]["log_weights_absent"] = Value::Null;
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SHAPE"));

    // terms duplikat.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["terms"] = json!(["VEC_makan", "VEC_makan", "VEC_saya", "VEC_suka", "VEC_tidak"]);
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SHAPE"));
}

#[test]
fn sumber_dan_likelihood_tidak_dikenal_ditolak() {
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["source"] = json!("hybrid");
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SOURCE"));

    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["likelihood"] = json!("poisson");
    assert!(build_err(&model).contains("AM_E_NB2_LIKELIHOOD"));

    // vector tanpa columns.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["text"]["columns"] = Value::Null;
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SOURCE"));
}

#[test]
fn raw_tanpa_recipe_atau_raw_variable_ditolak() {
    let mut model = raw_model(TextLikelihood::Multinomial);
    model["text"]["recipe"] = Value::Null;
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SOURCE"));

    let mut model = raw_model(TextLikelihood::Multinomial);
    model["text"]["raw_variable"] = Value::Null;
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SOURCE"));

    // Resep tidak utuh (bukan TextVectorizerModel).
    let mut model = raw_model(TextLikelihood::Multinomial);
    model["text"]["recipe"] = json!({ "recipe_version": "1.0" });
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SOURCE"));

    // vocabulary resep != terms.
    let mut model = raw_model(TextLikelihood::Multinomial);
    model["text"]["recipe"]["vocabulary"] = json!(["a", "b", "c", "d", "e"]);
    assert!(build_err(&model).contains("AM_E_NB2_TEXT_SHAPE"));
}

#[test]
fn complement_dengan_fitur_numerik_ditolak() {
    let (recipe, params) = raw_recipe_and_params(TextLikelihood::Complement);
    let model = model_json(
        Some(text_block(&params, "raw", Some(serde_json::to_value(&recipe).unwrap()))),
        vec![temp_feature()],
        &["Temp"],
    );
    assert!(build_err(&model).contains("AM_E_NB2_COMPLEMENT_MIXED"));
}

#[test]
fn feature_order_kosong_hanya_boleh_untuk_model_hanya_text_v2() {
    // 2.0 + Text + tanpa fitur -> valid (sudah diuji lewat fixture). Tanpa Text -> tetap error v1.
    let model = model_json(None, vec![], &[]);
    assert!(build_err(&model).contains("AM_E_FEATURE_ORDER_MISMATCH"));

    // Schema 1.1 dengan blok `text` DIABAIKAN (sama dengan adapter TS) -> feature_order kosong tetap error.
    let mut model = vector_model(TextLikelihood::Multinomial);
    model["schema_version"] = json!("1.1");
    assert!(build_err(&model).contains("AM_E_FEATURE_ORDER_MISMATCH"));
}

#[test]
fn likelihood_fitur_numerik_v2_divalidasi() {
    // gaussian_minstd wajib min_variance > 0.
    let mut feature = temp_feature();
    feature["likelihood"] = json!("gaussian_minstd");
    let model = model_json(None, vec![feature.clone()], &["Temp"]);
    assert!(build_err(&model).contains("AM_E_GAUSSIAN_INVALID"));

    feature["min_variance"] = json!(0.111111);
    assert!(build_scorer(&model_json(None, vec![feature.clone()], &["Temp"])).is_ok());

    // Likelihood tak dikenal.
    feature["likelihood"] = json!("kde");
    let model = model_json(None, vec![feature], &["Temp"]);
    assert!(build_err(&model).contains("AM_E_NB2_LIKELIHOOD"));
}

#[test]
fn gaussian_minstd_dipakai_apa_adanya_variance_sudah_setelah_min_std() {
    // §8: `variance` yang diekspor sudah melalui min-std & floor, jadi scoring identik dengan gaussian.
    let (predictors, defs, mapping) = temp_slice(&[Some(70.0), Some(55.0)]);
    let plain = model_json(None, vec![temp_feature()], &["Temp"]);
    let mut feature = temp_feature();
    feature["likelihood"] = json!("gaussian_minstd");
    feature["min_variance"] = json!(0.111111);
    let minstd = model_json(None, vec![feature], &["Temp"]);

    let a = run_apply_model(&predictors, &defs, &mapping, &[], &[], &plain).unwrap();
    let b = run_apply_model(&predictors, &defs, &mapping, &[], &[], &minstd).unwrap();
    assert_eq!(a.predictions.class_probabilities, b.predictions.class_probabilities);
    assert_eq!(a.predictions.predicted, b.predictions.predicted);
}

// ---------------------------------------------------------------------------
// Contoh numerik v1 AM AGENTS.md §5.6 tetap identik pada schema 2.0 tanpa Text
// ---------------------------------------------------------------------------

#[test]
fn contoh_numerik_v1_t1_t2_identik_pada_schema_2_0_tanpa_text() {
    let model = json!({
        "schema_version": "2.0", "model_type": "naive_bayes", "trained_at": "2026-10-01T00:00:00.000Z",
        "target": { "name": "Play", "classes": ["No", "Yes"], "class_priors": [0.5, 0.5], "class_counts": [3, 3] },
        "features": [
            { "name": "Outlook", "role": "categorical", "likelihood": "categorical",
              "categories": ["Overcast", "Rain", "Sunny"],
              "distribution": { "No": [0.5, 0.16666666666666666, 0.3333333333333333],
                                "Yes": [0.16666666666666666, 0.3333333333333333, 0.5] },
              "class_totals": { "No": 3, "Yes": 3 } },
            { "name": "Temp", "role": "numerical", "likelihood": "gaussian", "min_variance": null,
              "mean": { "No": 84.0, "Yes": 72.0 },
              "variance": { "No": 18.666666666666668, "Yes": 2.6666666666666665 } }
        ],
        "smoothing_alpha": 1.0, "variance_floor": 1e-9,
        "feature_order": ["Outlook", "Temp"],
        "label_mapping": { "No": 0, "Yes": 1 },
        "validation_config": { "method": "holdout", "training_percentage": 70, "holdout_percentage": 30, "folds": null, "seed": 42 },
        "missing_value_policy": "x", "unseen_category_policy": "x",
        "text": null
    });
    let scorer = build_scorer(&model).expect("model valid");
    let t1 = scorer.score_row(&[DataValue::Text("Overcast".to_string()), DataValue::Number(85.0)]);
    let t2 = scorer.score_row(&[DataValue::Text("Sunny".to_string()), DataValue::Number(71.0)]);
    match (t1, t2) {
        (RowScore::Scored { log_scores: a, .. }, RowScore::Scored { log_scores: b, .. }) => {
            assert_close(a[0], -3.7953883096437977, TOL_NB_AM, "T1 No");
            assert_close(a[1], -35.581759809498536, TOL_NB_AM, "T1 Yes");
            assert_close(b[0], -8.700853417751961, TOL_NB_AM, "T2 No");
            assert_close(b[1], -2.9831475208304266, TOL_NB_AM, "T2 Yes");
        }
        _ => panic!("T1/T2 harus diskor"),
    }
    // Tanpa Text: kolom ringkasan Text tidak muncul.
    assert!(scorer.text_model().is_none());
    assert_eq!(scorer.summary_parameters().len(), 3);
}

// ---------------------------------------------------------------------------
// Model campuran: skor = jumlah kontribusi (prior + numerik + Text)
// ---------------------------------------------------------------------------

#[test]
fn model_campuran_skor_adalah_jumlah_kontribusi_numerik_dan_text() {
    let model = mixed_raw_model(TextLikelihood::Multinomial);
    let scorer = build_scorer(&model).unwrap();

    let payload = raw_payload(&[Some("makan nasi enak")]);
    let text_scores = scorer.text_model().unwrap().prepare(&payload, 1).unwrap();
    let mixed = match scorer.score_row_with_text(&[DataValue::Number(75.0)], text_scores.row(0)) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("NotScored"),
    };
    let numeric_only = match scorer.score_row(&[DataValue::Number(75.0)]) {
        RowScore::Scored { log_scores, .. } => log_scores,
        RowScore::NotScored => panic!("NotScored"),
    };
    let (_, params) = raw_recipe_and_params(TextLikelihood::Multinomial);
    let text_only = score_rows(&params, &golden_test_matrix());
    for c in 0..2 {
        assert_close(mixed[c], numeric_only[c] + text_only[0][c], TOL_NB_AM, "campuran");
    }
}
