// Scorer Naive Bayes — parsing & validasi model (AGENTS.md §4.3, §5.2).
//
// PLAN.md Fase 7: `NaiveBayesScorer::from_json` = validasi LAPIS KEDUA
// (P3). Port Rust dari `adapters/naive-bayes-adapter.ts` (TS, Fase 2) —
// langkah 1–11 §4.3 dengan kode error yang sama, tetapi pesan berbentuk
// `"AM_E_XXX: detail"`. Bila ada beberapa error, semuanya dikumpulkan
// (langkah 1–2 menghentikan validasi) dan digabung dengan `" | "`; pesan
// SELALU diawali kode error pertama.
//
// `score_row` diisi di Fase 8 (§5.4); posterior/argmax di Fase 9.
//
// Revisi v2 (Fase A2, AGENTS_V2.md §10): schema `2.0` diterima. Langkah 12
// (likelihood fitur) dan 13 (blok `text`) ada di `scoring/text.rs`; skor Text
// memakai `statify-text-core` (V13), BUKAN salinan NB. Perilaku v1 (schema
// 1.0/1.1) tidak berubah: `score_row` v1 identik, hanya dibungkus
// `score_row_inner` yang menerima kontribusi Text opsional.
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;

use serde_json::{Map, Value};

use crate::models::data::DataValue;
use crate::scoring::text::TextModel;
use crate::scoring::{ClassifierScorer, FeatureRole, FeatureSpec, RowScore, TextRowInput};
use crate::stats::value_label::{
    data_value_to_label, is_missing_value, numeric_value, MISSING_CATEGORY_LABEL,
};

const MODEL_TYPE: &str = "naive_bayes";
const SUPPORTED_SCHEMA_VERSIONS: [&str; 3] = ["1.0", "1.1", "2.0"];
const LEGACY_SCHEMA_VERSION: &str = "1.0";
const SCHEMA_VERSION_WITH_COUNTS: &str = "1.1";
/// Revisi v2: schema 2.0 membawa `class_counts`/`class_totals` seperti 1.1.
const SCHEMA_VERSION_V2: &str = "2.0";

/// Schema yang wajib membawa `target.class_counts` dan `class_totals` (1.1 dan 2.0).
fn schema_has_counts(version: &str) -> bool {
    version == SCHEMA_VERSION_WITH_COUNTS || version == SCHEMA_VERSION_V2
}
/// Toleransi konsistensi internal (AGENTS.md K8).
const TOLERANCE: f64 = 1e-6;

/// Field wajib di kedua versi (§3.1). `target.class_counts` dan
/// `class_totals` (1.1) diperiksa di langkah 11, bukan di langkah 2.
const REQUIRED_TOP_LEVEL_FIELDS: [&str; 12] = [
    "schema_version",
    "model_type",
    "trained_at",
    "target",
    "features",
    "smoothing_alpha",
    "variance_floor",
    "feature_order",
    "label_mapping",
    "validation_config",
    "missing_value_policy",
    "unseen_category_policy",
];
const REQUIRED_TARGET_FIELDS: [&str; 3] = ["name", "classes", "class_priors"];

type JsonObject = Map<String, Value>;

/// Parameter per fitur, sejajar `NaiveBayesScorer::features`. Semua array
/// per kelas disusun menurut urutan `classes` model (bukan urutan HashMap).
#[derive(Debug, Clone, PartialEq)]
pub enum NbFeatureParams {
    Categorical {
        categories: Vec<String>,
        /// kategori -> index di `categories` (hanya untuk pencarian).
        category_index: HashMap<String, usize>,
        /// `distribution[class_idx][category_idx]`.
        distribution: Vec<Vec<f64>>,
        /// `class_totals[class_idx]`; `None` untuk schema 1.0.
        class_totals: Option<Vec<u64>>,
    },
    Numerical {
        /// `mean[class_idx]`.
        mean: Vec<f64>,
        /// `variance[class_idx]` (sudah melalui variance floor saat training).
        variance: Vec<f64>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct NaiveBayesScorer {
    pub schema_version: String,
    /// Urutan dari model.
    pub classes: Vec<String>,
    /// Sejajar `classes`.
    pub class_priors: Vec<f64>,
    /// Sejajar `classes`; `None` untuk schema 1.0.
    pub class_counts: Option<Vec<u64>>,
    pub smoothing_alpha: f64,
    pub variance_floor: f64,
    /// Urutan = `feature_order` model.
    pub features: Vec<FeatureSpec>,
    /// Sejajar `features`.
    pub feature_params: Vec<NbFeatureParams>,
    /// Revisi v2: parameter fitur Text (schema 2.0); `None` untuk model v1 / tanpa Text.
    pub text: Option<TextModel>,
    validation_summary: String,
}

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------

fn err(code: &str, detail: &str) -> String {
    format!("{}: {}", code, detail)
}

fn type_err(path: &str) -> String {
    err("AM_E_FIELD_TYPE", path)
}

/// Nilai ada dan bukan `null` (setara `!== undefined && !== null` di TS).
fn present<'a>(obj: &'a JsonObject, key: &str) -> Option<&'a Value> {
    obj.get(key).filter(|v| !v.is_null())
}

fn is_finite_number(value: &Value) -> bool {
    value.as_f64().map_or(false, f64::is_finite)
}

fn is_non_negative_integer(value: &Value) -> bool {
    value
        .as_f64()
        .map_or(false, |x| x.is_finite() && x.fract() == 0.0 && x >= 0.0)
}

fn is_non_empty_string(value: &Value) -> bool {
    value.as_str().map_or(false, |s| !s.is_empty())
}

fn as_string_vec(value: &Value) -> Option<Vec<String>> {
    let array = value.as_array()?;
    array
        .iter()
        .map(|item| item.as_str().map(str::to_string))
        .collect()
}

fn is_string_array(value: &Value) -> bool {
    as_string_vec(value).is_some()
}

fn has_duplicates(values: &[String]) -> bool {
    let unique: HashSet<&String> = values.iter().collect();
    unique.len() != values.len()
}

fn feature_label(feature: &JsonObject, index: usize) -> String {
    feature
        .get("name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("features[{}]", index))
}

// ---------------------------------------------------------------------------
// Validasi §4.3 (langkah 1–11)
// ---------------------------------------------------------------------------

/// Langkah 1 (stop): `schema_version` harus salah satu versi yang didukung.
fn validate_step1_schema_version(root: &JsonObject, errors: &mut Vec<String>) -> bool {
    match root.get("schema_version") {
        Some(Value::String(version)) if SUPPORTED_SCHEMA_VERSIONS.contains(&version.as_str()) => {
            true
        }
        Some(Value::String(version)) => {
            errors.push(err("AM_E_SCHEMA_VERSION_UNSUPPORTED", version));
            false
        }
        Some(Value::Null) | None => {
            errors.push(err("AM_E_SCHEMA_VERSION_UNSUPPORTED", "(missing)"));
            false
        }
        Some(other) => {
            errors.push(err("AM_E_SCHEMA_VERSION_UNSUPPORTED", &other.to_string()));
            false
        }
    }
}

/// Langkah 2 (stop): field wajib ada (tidak undefined/null).
fn validate_step2_required_fields(root: &JsonObject, errors: &mut Vec<String>) -> bool {
    let mut missing: Vec<String> = Vec::new();

    for key in REQUIRED_TOP_LEVEL_FIELDS {
        if present(root, key).is_none() {
            missing.push(key.to_string());
        }
    }
    if let Some(target) = root.get("target").and_then(Value::as_object) {
        for key in REQUIRED_TARGET_FIELDS {
            if present(target, key).is_none() {
                missing.push(format!("target.{}", key));
            }
        }
    }

    for field in &missing {
        errors.push(err("AM_E_FIELD_MISSING", field));
    }
    missing.is_empty()
}

/// Langkah 3: tipe field.
fn validate_step3_field_types(root: &JsonObject, errors: &mut Vec<String>) {
    let mut fail = |detail: &str| errors.push(type_err(detail));

    if !root.get("model_type").map_or(false, is_non_empty_string) {
        fail("model_type");
    }
    if !root.get("trained_at").map_or(false, Value::is_string) {
        fail("trained_at");
    }
    let target = root.get("target").and_then(Value::as_object);
    if target.is_none() {
        fail("target");
    }
    if !root.get("features").map_or(false, Value::is_array) {
        fail("features");
    }
    if !root.get("smoothing_alpha").map_or(false, Value::is_number) {
        fail("smoothing_alpha");
    }
    if !root.get("variance_floor").map_or(false, Value::is_number) {
        fail("variance_floor");
    }
    if !root.get("feature_order").map_or(false, is_string_array) {
        fail("feature_order");
    }
    if !root.get("label_mapping").map_or(false, Value::is_object) {
        fail("label_mapping");
    }
    if !root.get("validation_config").map_or(false, Value::is_object) {
        fail("validation_config");
    }
    if !root.get("missing_value_policy").map_or(false, Value::is_string) {
        fail("missing_value_policy");
    }
    if !root.get("unseen_category_policy").map_or(false, Value::is_string) {
        fail("unseen_category_policy");
    }

    if let Some(target) = target {
        if !target.get("name").map_or(false, is_non_empty_string) {
            fail("target.name");
        }
        if !target.get("classes").map_or(false, is_string_array) {
            fail("target.classes");
        }
        if !target.get("class_priors").map_or(false, Value::is_array) {
            fail("target.class_priors");
        }
    }

    if let Some(features) = root.get("features").and_then(Value::as_array) {
        for (i, item) in features.iter().enumerate() {
            let feature = match item.as_object() {
                Some(feature) => feature,
                None => {
                    fail(&format!("features[{}]", i));
                    continue;
                }
            };
            let label = feature_label(feature, i);
            if !feature.get("name").map_or(false, is_non_empty_string) {
                fail(&format!("features[{}].name", i));
            }

            match feature.get("role").and_then(Value::as_str) {
                Some("categorical") => {
                    if !feature.get("categories").map_or(false, is_string_array) {
                        fail(&format!("{}.categories", label));
                    }
                    match feature.get("distribution").and_then(Value::as_object) {
                        Some(distribution) => {
                            for (class_name, vector) in distribution {
                                if !vector.is_array() {
                                    fail(&format!("{}.distribution.{}", label, class_name));
                                }
                            }
                        }
                        None => fail(&format!("{}.distribution", label)),
                    }
                }
                Some("numerical") => {
                    if !feature.get("mean").map_or(false, Value::is_object) {
                        fail(&format!("{}.mean", label));
                    }
                    if !feature.get("variance").map_or(false, Value::is_object) {
                        fail(&format!("{}.variance", label));
                    }
                }
                // Role lain -> AM_E_ROLE_INVALID di langkah 8.
                _ => {}
            }
        }
    }
}

/// Langkah 4: `classes` tidak kosong & tanpa duplikat.
fn validate_step4_classes(classes: Option<&[String]>, errors: &mut Vec<String>) {
    let classes = match classes {
        Some(classes) => classes,
        None => return, // tipe salah sudah dilaporkan di langkah 3
    };
    if classes.is_empty() {
        errors.push(err("AM_E_CLASSES_EMPTY", "classes is empty"));
        return;
    }
    if has_duplicates(classes) {
        errors.push(err("AM_E_CLASSES_DUPLICATE", "classes contains duplicates"));
    }
}

/// Langkah 5: `class_priors` (panjang, rentang [0,1], jumlah ~ 1).
fn validate_step5_priors(target: Option<&JsonObject>, errors: &mut Vec<String>) {
    let target = match target {
        Some(target) => target,
        None => return,
    };
    let (classes, priors) = match (
        target.get("classes").and_then(Value::as_array),
        target.get("class_priors").and_then(Value::as_array),
    ) {
        (Some(classes), Some(priors)) => (classes, priors),
        _ => return,
    };

    if priors.len() != classes.len() {
        errors.push(err(
            "AM_E_PRIORS_LENGTH",
            &format!("class_priors={}, classes={}", priors.len(), classes.len()),
        ));
        return;
    }
    let all_in_range = priors
        .iter()
        .all(|p| p.as_f64().map_or(false, |x| x.is_finite() && (0.0..=1.0).contains(&x)));
    if !all_in_range {
        errors.push(err("AM_E_PRIORS_INVALID", "range"));
        return;
    }
    let sum: f64 = priors.iter().filter_map(Value::as_f64).sum();
    if (sum - 1.0).abs() > TOLERANCE {
        errors.push(err("AM_E_PRIORS_INVALID", "sum"));
    }
}

/// Langkah 6: `smoothing_alpha` & `variance_floor` finite dan > 0.
fn validate_step6_params(root: &JsonObject, errors: &mut Vec<String>) {
    // Tipe non-numerik sudah dilaporkan di langkah 3 (AM_E_FIELD_TYPE).
    for key in ["smoothing_alpha", "variance_floor"] {
        if let Some(value) = root.get(key) {
            if value.is_number()
                && !(is_finite_number(value) && value.as_f64().map_or(false, |x| x > 0.0))
            {
                errors.push(err("AM_E_PARAM_INVALID", key));
            }
        }
    }
}

/// Langkah 7: `feature_order` tidak kosong, tanpa duplikat, dan sama
/// (himpunan & panjang) dengan `features[].name`.
fn validate_step7_feature_order(root: &JsonObject, errors: &mut Vec<String>) {
    let order = match root.get("feature_order").and_then(as_string_vec) {
        Some(order) => order,
        None => return,
    };
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };
    let names: Vec<String> = features
        .iter()
        .filter_map(Value::as_object)
        .filter_map(|f| f.get("name"))
        .filter(|n| is_non_empty_string(n))
        .filter_map(|n| n.as_str().map(str::to_string))
        .collect();

    // Revisi v2: model hanya-Text (blok `text` ada, tanpa fitur Numeric/Categorical)
    // memiliki `feature_order` kosong.
    let text_only = crate::scoring::text::has_text_block(root) && features.is_empty();
    if order.is_empty() && !text_only {
        errors.push(err("AM_E_FEATURE_ORDER_MISMATCH", "feature_order is empty"));
        return;
    }
    if has_duplicates(&order) {
        errors.push(err("AM_E_FEATURE_ORDER_MISMATCH", "feature_order contains duplicates"));
        return;
    }
    let name_set: HashSet<&String> = names.iter().collect();
    let order_set: HashSet<&String> = order.iter().collect();
    let same_set = order.len() == features.len()
        && names.len() == features.len()
        && order_set.len() == name_set.len()
        && order.iter().all(|n| name_set.contains(n));
    if !same_set {
        errors.push(err(
            "AM_E_FEATURE_ORDER_MISMATCH",
            "does not match features[].name",
        ));
    }
}

/// Langkah 8: `features[].role` harus `categorical` / `numerical`.
fn validate_step8_roles(root: &JsonObject, errors: &mut Vec<String>) {
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };
    for (i, item) in features.iter().enumerate() {
        let feature = match item.as_object() {
            Some(feature) => feature,
            None => continue,
        };
        let role = feature.get("role").and_then(Value::as_str);
        if role != Some("categorical") && role != Some("numerical") {
            errors.push(err("AM_E_ROLE_INVALID", &feature_label(feature, i)));
        }
    }
}

/// Langkah 9: fitur categorical.
fn validate_step9_categorical(
    root: &JsonObject,
    classes: Option<&[String]>,
    errors: &mut Vec<String>,
) {
    let classes = match classes {
        Some(classes) => classes,
        None => return,
    };
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };

    for (i, item) in features.iter().enumerate() {
        let feature = match item.as_object() {
            Some(feature) => feature,
            None => continue,
        };
        if feature.get("role").and_then(Value::as_str) != Some("categorical") {
            continue;
        }
        let label = feature_label(feature, i);
        // Tipe salah (categories/distribution) sudah dilaporkan di langkah 3.
        let categories = match feature.get("categories").and_then(as_string_vec) {
            Some(categories) => categories,
            None => continue,
        };
        let distribution = match feature.get("distribution").and_then(Value::as_object) {
            Some(distribution) => distribution,
            None => continue,
        };

        if categories.is_empty() || has_duplicates(&categories) {
            errors.push(err("AM_E_CATEGORIES_INVALID", &label));
            continue;
        }
        if classes.iter().any(|c| !distribution.contains_key(c)) {
            errors.push(err("AM_E_DISTRIBUTION_CLASS_MISSING", &label));
            continue;
        }

        let vectors: Vec<Option<&Vec<Value>>> = classes
            .iter()
            .map(|c| distribution.get(c).and_then(Value::as_array))
            .collect();
        if vectors.iter().any(Option::is_none) {
            continue; // langkah 3
        }
        let arrays: Vec<&Vec<Value>> = vectors.into_iter().flatten().collect();

        if arrays.iter().any(|v| v.len() != categories.len()) {
            errors.push(err("AM_E_DISTRIBUTION_LENGTH", &label));
            continue;
        }

        let sum_invalid = arrays.iter().any(|v| {
            let all_valid = v.iter().all(|x| {
                x.as_f64()
                    .map_or(false, |n| n.is_finite() && n > 0.0 && n <= 1.0)
            });
            if !all_valid {
                return true;
            }
            let sum: f64 = v.iter().filter_map(Value::as_f64).sum();
            (sum - 1.0).abs() > TOLERANCE
        });
        if sum_invalid {
            errors.push(err("AM_E_DISTRIBUTION_SUM", &label));
        }
    }
}

/// Langkah 10: fitur numerical.
fn validate_step10_numerical(
    root: &JsonObject,
    classes: Option<&[String]>,
    errors: &mut Vec<String>,
) {
    let classes = match classes {
        Some(classes) => classes,
        None => return,
    };
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };

    for (i, item) in features.iter().enumerate() {
        let feature = match item.as_object() {
            Some(feature) => feature,
            None => continue,
        };
        if feature.get("role").and_then(Value::as_str) != Some("numerical") {
            continue;
        }
        let label = feature_label(feature, i);
        // Tipe salah (mean/variance) sudah dilaporkan di langkah 3.
        let (mean, variance) = match (
            feature.get("mean").and_then(Value::as_object),
            feature.get("variance").and_then(Value::as_object),
        ) {
            (Some(mean), Some(variance)) => (mean, variance),
            _ => continue,
        };

        if classes
            .iter()
            .any(|c| !mean.contains_key(c) || !variance.contains_key(c))
        {
            errors.push(err("AM_E_GAUSSIAN_CLASS_MISSING", &label));
            continue;
        }

        let invalid = classes.iter().any(|c| {
            let mean_ok = mean.get(c).map_or(false, is_finite_number);
            let variance_ok = variance
                .get(c)
                .and_then(Value::as_f64)
                .map_or(false, |v| v.is_finite() && v > 0.0);
            !mean_ok || !variance_ok
        });
        if invalid {
            errors.push(err("AM_E_GAUSSIAN_INVALID", &label));
        }
    }
}

/// Langkah 11 (khusus 1.1 dan 2.0): `class_counts` & `class_totals`.
fn validate_step11_counts(
    root: &JsonObject,
    target: Option<&JsonObject>,
    classes: Option<&[String]>,
    errors: &mut Vec<String>,
) {
    let version = root.get("schema_version").and_then(Value::as_str);
    if !version.map_or(false, schema_has_counts) {
        return;
    }

    // --- target.class_counts ---
    if let Some(target) = target {
        if let Some(target_classes) = target.get("classes").and_then(Value::as_array) {
            let class_count = target_classes.len();
            let mut counts_valid = false;
            let counts = target.get("class_counts").and_then(Value::as_array);
            match counts {
                None => errors.push(err("AM_E_COUNTS_INVALID", "target.class_counts")),
                Some(counts) if counts.len() != class_count => {
                    errors.push(err("AM_E_COUNTS_INVALID", "target.class_counts: wrong length"));
                }
                Some(counts) if !counts.iter().all(is_non_negative_integer) => {
                    errors.push(err("AM_E_COUNTS_INVALID", "target.class_counts: invalid values"));
                }
                Some(counts) if counts.iter().filter_map(Value::as_f64).sum::<f64>() == 0.0 => {
                    errors.push(err("AM_E_COUNTS_INVALID", "target.class_counts: total is 0"));
                }
                Some(_) => counts_valid = true,
            }

            // Konsistensi dengan class_priors (hanya bila keduanya valid agar
            // tidak menimbulkan error berantai).
            if counts_valid {
                if let (Some(counts), Some(priors)) =
                    (counts, target.get("class_priors").and_then(Value::as_array))
                {
                    if priors.len() == class_count && priors.iter().all(is_finite_number) {
                        let count_list: Vec<f64> =
                            counts.iter().filter_map(Value::as_f64).collect();
                        let prior_list: Vec<f64> =
                            priors.iter().filter_map(Value::as_f64).collect();
                        let total: f64 = count_list.iter().sum();
                        let bad_index = count_list
                            .iter()
                            .zip(prior_list.iter())
                            .position(|(c, p)| (p - c / total).abs() > TOLERANCE);
                        if let Some(index) = bad_index {
                            let detail = target_classes
                                .get(index)
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .unwrap_or_else(|| index.to_string());
                            errors.push(err("AM_E_COUNTS_INCONSISTENT", &detail));
                        }
                    }
                }
            }
        }
    }

    // --- class_totals per fitur categorical ---
    let classes = match classes {
        Some(classes) => classes,
        None => return,
    };
    let features = match root.get("features").and_then(Value::as_array) {
        Some(features) => features,
        None => return,
    };
    for (i, item) in features.iter().enumerate() {
        let feature = match item.as_object() {
            Some(feature) => feature,
            None => continue,
        };
        if feature.get("role").and_then(Value::as_str) != Some("categorical") {
            continue;
        }
        let valid = match feature.get("class_totals").and_then(Value::as_object) {
            Some(totals) => classes
                .iter()
                .all(|c| totals.get(c).map_or(false, is_non_negative_integer)),
            None => false,
        };
        if !valid {
            errors.push(err("AM_E_CLASS_TOTALS_INVALID", &feature_label(feature, i)));
        }
    }
}

/// Jalankan langkah 1–13 (12–13 khusus schema 2.0); hasil kosong = valid.
fn validate_model(root: &JsonObject) -> Vec<String> {
    let mut errors: Vec<String> = Vec::new();

    // Langkah 1–2 menghentikan validasi.
    if !validate_step1_schema_version(root, &mut errors) {
        return errors;
    }
    if !validate_step2_required_fields(root, &mut errors) {
        return errors;
    }

    let target = root.get("target").and_then(Value::as_object);
    let classes: Option<Vec<String>> = target
        .and_then(|t| t.get("classes"))
        .and_then(as_string_vec);
    let classes_ref = classes.as_deref();

    validate_step3_field_types(root, &mut errors);
    validate_step4_classes(classes_ref, &mut errors);
    validate_step5_priors(target, &mut errors);
    validate_step6_params(root, &mut errors);
    validate_step7_feature_order(root, &mut errors);
    validate_step8_roles(root, &mut errors);
    validate_step9_categorical(root, classes_ref, &mut errors);
    validate_step10_numerical(root, classes_ref, &mut errors);
    validate_step11_counts(root, target, classes_ref, &mut errors);
    // Revisi v2 (§10.1): langkah 12 (likelihood fitur) dan 13 (blok `text`).
    crate::scoring::text::validate_feature_likelihoods(root, &mut errors);
    crate::scoring::text::validate_text_block(root, classes_ref, &mut errors);

    errors
}

// ---------------------------------------------------------------------------
// Ekstraksi (hanya setelah validasi lolos)
// ---------------------------------------------------------------------------

fn per_class_f64(object: &JsonObject, classes: &[String], path: &str) -> Result<Vec<f64>, String> {
    classes
        .iter()
        .map(|c| {
            object
                .get(c)
                .and_then(Value::as_f64)
                .ok_or_else(|| type_err(&format!("{}.{}", path, c)))
        })
        .collect()
}

fn per_class_u64(object: &JsonObject, classes: &[String], path: &str) -> Result<Vec<u64>, String> {
    Ok(per_class_f64(object, classes, path)?
        .into_iter()
        .map(|x| x as u64)
        .collect())
}

fn format_training_validation(config: Option<&Value>) -> String {
    let config = match config.and_then(Value::as_object) {
        Some(config) => config,
        None => return "-".to_string(),
    };
    let seed = match config.get("seed").and_then(Value::as_f64) {
        Some(s) if s.is_finite() => format!("seed {}", s),
        _ => "no seed".to_string(),
    };
    let num = |key: &str| -> String {
        match config.get(key).and_then(Value::as_f64) {
            Some(v) if v.is_finite() => v.to_string(),
            _ => "?".to_string(),
        }
    };
    match config.get("method").and_then(Value::as_str) {
        Some("holdout") => format!(
            "Holdout {}% / {}%, {}",
            num("training_percentage"),
            num("holdout_percentage"),
            seed
        ),
        Some("kfold") => format!("{}-fold, {}", num("folds"), seed),
        Some(other) => format!("{}, {}", other, seed),
        None => "-".to_string(),
    }
}

impl NaiveBayesScorer {
    /// Deserialisasi + validasi AGENTS.md §4.3 langkah 1–11. Error:
    /// `"AM_E_XXX: detail"` (beberapa error digabung `" | "`).
    pub fn from_json(model: &Value) -> Result<NaiveBayesScorer, String> {
        let root = model
            .as_object()
            .ok_or_else(|| err("AM_E_NOT_OBJECT", "The model file must contain a JSON object."))?;

        let errors = validate_model(root);
        if !errors.is_empty() {
            return Err(errors.join(" | "));
        }
        Self::extract(root)
    }

    fn extract(root: &JsonObject) -> Result<NaiveBayesScorer, String> {
        let schema_version = root
            .get("schema_version")
            .and_then(Value::as_str)
            .ok_or_else(|| type_err("schema_version"))?
            .to_string();
        let has_counts = schema_has_counts(&schema_version);

        let target = root
            .get("target")
            .and_then(Value::as_object)
            .ok_or_else(|| type_err("target"))?;
        let classes = target
            .get("classes")
            .and_then(as_string_vec)
            .ok_or_else(|| type_err("target.classes"))?;
        let class_priors: Vec<f64> = target
            .get("class_priors")
            .and_then(Value::as_array)
            .ok_or_else(|| type_err("target.class_priors"))?
            .iter()
            .map(|v| {
                v.as_f64()
                    .ok_or_else(|| type_err("target.class_priors"))
            })
            .collect::<Result<_, _>>()?;
        let class_counts: Option<Vec<u64>> = if has_counts {
            let counts = target
                .get("class_counts")
                .and_then(Value::as_array)
                .ok_or_else(|| err("AM_E_COUNTS_INVALID", "target.class_counts"))?
                .iter()
                .map(|v| {
                    v.as_f64()
                        .map(|x| x as u64)
                        .ok_or_else(|| err("AM_E_COUNTS_INVALID", "target.class_counts"))
                })
                .collect::<Result<Vec<u64>, String>>()?;
            Some(counts)
        } else {
            None
        };

        let smoothing_alpha = root
            .get("smoothing_alpha")
            .and_then(Value::as_f64)
            .ok_or_else(|| type_err("smoothing_alpha"))?;
        let variance_floor = root
            .get("variance_floor")
            .and_then(Value::as_f64)
            .ok_or_else(|| type_err("variance_floor"))?;

        let feature_order = root
            .get("feature_order")
            .and_then(as_string_vec)
            .ok_or_else(|| type_err("feature_order"))?;
        let feature_list = root
            .get("features")
            .and_then(Value::as_array)
            .ok_or_else(|| type_err("features"))?;
        let mut by_name: HashMap<&str, &JsonObject> = HashMap::new();
        for item in feature_list {
            if let Some(feature) = item.as_object() {
                if let Some(name) = feature.get("name").and_then(Value::as_str) {
                    by_name.insert(name, feature);
                }
            }
        }

        let mut features: Vec<FeatureSpec> = Vec::with_capacity(feature_order.len());
        let mut feature_params: Vec<NbFeatureParams> = Vec::with_capacity(feature_order.len());
        for name in &feature_order {
            let feature = by_name
                .get(name.as_str())
                .ok_or_else(|| err("AM_E_FEATURE_ORDER_MISMATCH", name))?;
            let role = feature.get("role").and_then(Value::as_str);

            match role {
                Some("categorical") => {
                    let categories = feature
                        .get("categories")
                        .and_then(as_string_vec)
                        .ok_or_else(|| type_err(&format!("{}.categories", name)))?;
                    let distribution_obj = feature
                        .get("distribution")
                        .and_then(Value::as_object)
                        .ok_or_else(|| type_err(&format!("{}.distribution", name)))?;
                    let mut distribution: Vec<Vec<f64>> = Vec::with_capacity(classes.len());
                    for class_name in &classes {
                        let vector: Vec<f64> = distribution_obj
                            .get(class_name)
                            .and_then(Value::as_array)
                            .ok_or_else(|| {
                                err(
                                    "AM_E_DISTRIBUTION_CLASS_MISSING",
                                    &format!("{}.{}", name, class_name),
                                )
                            })?
                            .iter()
                            .map(|v| {
                                v.as_f64().ok_or_else(|| {
                                    type_err(&format!("{}.distribution.{}", name, class_name))
                                })
                            })
                            .collect::<Result<_, _>>()?;
                        distribution.push(vector);
                    }
                    let class_totals = if has_counts {
                        let totals_obj = feature
                            .get("class_totals")
                            .and_then(Value::as_object)
                            .ok_or_else(|| err("AM_E_CLASS_TOTALS_INVALID", name))?;
                        Some(per_class_u64(
                            totals_obj,
                            &classes,
                            &format!("{}.class_totals", name),
                        )?)
                    } else {
                        None
                    };
                    let category_index: HashMap<String, usize> = categories
                        .iter()
                        .enumerate()
                        .map(|(idx, c)| (c.clone(), idx))
                        .collect();

                    features.push(FeatureSpec {
                        name: name.clone(),
                        role: FeatureRole::Categorical,
                    });
                    feature_params.push(NbFeatureParams::Categorical {
                        categories,
                        category_index,
                        distribution,
                        class_totals,
                    });
                }
                Some("numerical") => {
                    let mean_obj = feature
                        .get("mean")
                        .and_then(Value::as_object)
                        .ok_or_else(|| type_err(&format!("{}.mean", name)))?;
                    let variance_obj = feature
                        .get("variance")
                        .and_then(Value::as_object)
                        .ok_or_else(|| type_err(&format!("{}.variance", name)))?;
                    let mean = per_class_f64(mean_obj, &classes, &format!("{}.mean", name))?;
                    let variance =
                        per_class_f64(variance_obj, &classes, &format!("{}.variance", name))?;

                    features.push(FeatureSpec {
                        name: name.clone(),
                        role: FeatureRole::Numerical,
                    });
                    feature_params.push(NbFeatureParams::Numerical { mean, variance });
                }
                _ => return Err(err("AM_E_ROLE_INVALID", name)),
            }
        }

        // Revisi v2: blok `text` (hanya schema 2.0; `None` bila tidak ada / `null`).
        let text = crate::scoring::text::extract_text_model(root, &classes)?;

        Ok(NaiveBayesScorer {
            schema_version,
            classes,
            class_priors,
            class_counts,
            smoothing_alpha,
            variance_floor,
            features,
            feature_params,
            text,
            validation_summary: format_training_validation(root.get("validation_config")),
        })
    }
}

// ---------------------------------------------------------------------------
// Helper scoring (AGENTS.md §5.4) — PLAN.md Fase 8 langkah 2
// ---------------------------------------------------------------------------
//
// SALINAN dari `naive-bayes/rust/src/stats/prediction.rs`:
//   - baris 92-95   : `log_gaussian_density`
//   - baris 163-169 : `safe_ln`
// Tanggal salin: 2026-10-02. Logika identik; jangan "diperbaiki" di sini
// tanpa merevisi `../../../AGENTS.md` (prinsip P4: konsistensi dengan NB).

/// Log densitas Gaussian: `-0.5 * ln(2*pi*variance) - (x-mean)^2 / (2*variance)`.
/// `variance` dijaga `max(f64::MIN_POSITIVE)` agar tidak membagi dengan nol.
fn log_gaussian_density(x: f64, mean: f64, variance: f64) -> f64 {
    let variance = variance.max(f64::MIN_POSITIVE);
    -0.5 * (2.0 * PI * variance).ln() - (x - mean).powi(2) / (2.0 * variance)
}

/// Log dari probabilitas dengan lantai `f64::MIN_POSITIVE` untuk nilai 0.
fn safe_ln(probability: f64) -> f64 {
    if probability > 0.0 {
        probability.ln()
    } else {
        f64::MIN_POSITIVE.ln()
    }
}

impl ClassifierScorer for NaiveBayesScorer {
    fn model_type(&self) -> &str {
        MODEL_TYPE
    }

    fn schema_version(&self) -> &str {
        &self.schema_version
    }

    fn classes(&self) -> &[String] {
        &self.classes
    }

    fn features(&self) -> &[FeatureSpec] {
        &self.features
    }

    fn summary_parameters(&self) -> Vec<(String, String)> {
        let mut parameters = vec![
            (
                "Smoothing alpha".to_string(),
                self.smoothing_alpha.to_string(),
            ),
            (
                "Variance floor".to_string(),
                self.variance_floor.to_string(),
            ),
            (
                "Validation (training)".to_string(),
                self.validation_summary.clone(),
            ),
        ];
        // Revisi v2 (§10.4): baris statis fitur Text (hanya model dengan Text).
        // Baris dinamis (`Text features zero-filled` / `Rows with empty text`)
        // ditambahkan oleh `wasm::function` setelah payload Text diproses.
        if let Some(text) = &self.text {
            parameters.push((
                "Text source".to_string(),
                text.source.as_str().to_string(),
            ));
            parameters.push((
                "Text likelihood".to_string(),
                crate::scoring::text::likelihood_name(text.params.likelihood).to_string(),
            ));
        }
        parameters
    }

    fn is_legacy_unseen_handling(&self) -> bool {
        self.schema_version == LEGACY_SCHEMA_VERSION
    }

    /// Skor log per kelas untuk satu baris (AGENTS.md §5.4). Hasil `log_scores`
    /// sejajar `classes` model; belum dinormalisasi (posterior = Fase 9).
    /// Tanpa kontribusi Text (perilaku v1); lihat `score_row_with_text`.
    fn score_row(&self, values: &[DataValue]) -> RowScore {
        self.score_row_inner(values, None)
    }

    fn text_model(&self) -> Option<&TextModel> {
        self.text.as_ref()
    }

    /// Revisi v2 (AGENTS_V2.md §10.4): skor satu baris + kontribusi Text.
    fn score_row_with_text(&self, values: &[DataValue], text: Option<TextRowInput<'_>>) -> RowScore {
        self.score_row_inner(values, text)
    }
}

impl NaiveBayesScorer {
    /// Isi `score_row` v1 + kontribusi Text opsional (revisi v2). Dengan
    /// `text = None` hasilnya IDENTIK dengan v1 (regresi nol, P-V1).
    fn score_row_inner(&self, values: &[DataValue], text: Option<TextRowInput<'_>>) -> RowScore {
        // Pengaman: `values` harus sejajar `features`. Ketidaksejajaran
        // payload ditolak (`AM_E_PAYLOAD`) di Fase 9 sebelum scoring; di sini
        // cukup tidak panic.
        if values.len() != self.features.len() {
            return RowScore::NotScored;
        }

        // Langkah 1 (K5): seluruh prediktor missing -> tidak diprediksi.
        // Revisi v2 (V11): bila ada masukan Text, prediktor Text ikut dihitung —
        // baris NotScored hanya bila fitur lain DAN teks sama-sama missing.
        // (Model hanya-Text punya `values` kosong; `all` pada larik kosong = true.)
        let features_all_missing = values.iter().all(is_missing_value);
        let text_missing = text.as_ref().map_or(true, |input| input.missing);
        if features_all_missing && text_missing {
            return RowScore::NotScored;
        }

        // Langkah 2: log prior per kelas (urutan `classes` model).
        // Revisi v2 (§6.3): Complement dengan K >= 2 tanpa prior (`uses_class_prior = false`).
        let uses_class_prior = self
            .text
            .as_ref()
            .map_or(true, |model| model.params.uses_class_prior);
        let mut log_scores: Vec<f64> = if uses_class_prior {
            self.class_priors.iter().map(|p| safe_ln(*p)).collect()
        } else {
            vec![0.0; self.class_priors.len()]
        };
        let mut had_missing = false;
        let mut had_unseen = false;
        let mut skipped_unseen: usize = 0;

        for (value, params) in values.iter().zip(self.feature_params.iter()) {
            match params {
                // Langkah 3: fitur numerical (Gaussian).
                NbFeatureParams::Numerical { mean, variance } => match numeric_value(value) {
                    Some(x) => {
                        for (c, score) in log_scores.iter_mut().enumerate() {
                            if let (Some(m), Some(v)) = (mean.get(c), variance.get(c)) {
                                *score += log_gaussian_density(x, *m, *v);
                            }
                        }
                    }
                    None => {
                        // Missing: fitur dilewati.
                        had_missing = true;
                    }
                },
                // Langkah 4: fitur categorical.
                NbFeatureParams::Categorical {
                    categories,
                    category_index,
                    distribution,
                    class_totals,
                } => {
                    let missing = is_missing_value(value);
                    if missing {
                        had_missing = true;
                    }
                    let label = if missing {
                        MISSING_CATEGORY_LABEL.to_string()
                    } else {
                        data_value_to_label(value)
                    };

                    match category_index.get(&label) {
                        // Kategori dikenal: probabilitas dari `distribution`.
                        Some(&idx) => {
                            for (c, score) in log_scores.iter_mut().enumerate() {
                                let p = distribution
                                    .get(c)
                                    .and_then(|row| row.get(idx))
                                    .copied()
                                    .unwrap_or(0.0);
                                *score += safe_ln(p);
                            }
                        }
                        // Kategori tak dikenal (termasuk "(Missing)" bila tidak
                        // ada di `categories`).
                        None => {
                            had_unseen = true;
                            match class_totals {
                                // Schema 1.1: alpha / (class_totals[c] + alpha*K).
                                Some(totals) => {
                                    let k = categories.len() as f64;
                                    for (c, score) in log_scores.iter_mut().enumerate() {
                                        let total = totals.get(c).copied().unwrap_or(0) as f64;
                                        let denom = total + self.smoothing_alpha * k;
                                        let p = if denom > 0.0 {
                                            self.smoothing_alpha / denom
                                        } else {
                                            0.0
                                        };
                                        *score += safe_ln(p);
                                    }
                                }
                                // Schema 1.0: fitur dilewati untuk semua kelas.
                                None => {
                                    skipped_unseen += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Revisi v2: kontribusi Text (dihitung `CORE::nb_text::score_rows`, tanpa prior).
        // Teks missing + prediktor lain = vektor nol: kontribusi tetap ditambahkan apa
        // adanya (Multinomial/Complement 0; Bernoulli Σ A_ct), baris dihitung punya
        // prediktor missing.
        if let Some(input) = text {
            for (score, extra) in log_scores.iter_mut().zip(input.contribution.iter()) {
                *score += *extra;
            }
            if input.missing {
                had_missing = true;
            }
        }

        RowScore::Scored {
            log_scores,
            had_missing,
            had_unseen,
            skipped_unseen,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scoring::build_scorer;
    use serde_json::json;

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

    fn build_err(model: &Value) -> String {
        match build_scorer(model) {
            Ok(_) => panic!("seharusnya Err"),
            Err(e) => e,
        }
    }

    /// Pesan diawali `<code>:` dan hanya ada SATU error.
    fn assert_single_code(model: &Value, code: &str) {
        let e = build_err(model);
        assert!(
            e.starts_with(&format!("{}:", code)),
            "pesan tidak diawali {}: {}",
            code,
            e
        );
        assert!(!e.contains(" | "), "ada lebih dari satu error: {}", e);
    }

    fn assert_code(model: &Value, code: &str) {
        let e = build_err(model);
        assert!(
            e.starts_with(&format!("{}:", code)),
            "pesan tidak diawali {}: {}",
            code,
            e
        );
    }

    // --- model valid -------------------------------------------------------

    #[test]
    fn d1_parses_ok() {
        let scorer = build_scorer(&d1()).ok().unwrap();
        assert_eq!(scorer.model_type(), "naive_bayes");
        assert_eq!(scorer.schema_version(), "1.1");
        assert_eq!(scorer.classes(), &["No".to_string(), "Yes".to_string()]);
        assert_eq!(scorer.features().len(), 2);
        assert_eq!(scorer.features()[0].name, "Outlook");
        assert_eq!(scorer.features()[0].role, FeatureRole::Categorical);
        assert_eq!(scorer.features()[1].name, "Temp");
        assert_eq!(scorer.features()[1].role, FeatureRole::Numerical);
        assert!(!scorer.is_legacy_unseen_handling());
    }

    #[test]
    fn d2_parses_ok_and_is_legacy() {
        let scorer = build_scorer(&d2()).ok().unwrap();
        assert_eq!(scorer.schema_version(), "1.0");
        assert_eq!(scorer.classes(), &["No".to_string(), "Yes".to_string()]);
        assert_eq!(scorer.features().len(), 2);
        assert!(scorer.is_legacy_unseen_handling());
    }

    #[test]
    fn d1_extracts_parameters_in_class_order() {
        let scorer = NaiveBayesScorer::from_json(&d1()).unwrap();
        assert_eq!(scorer.class_priors, vec![0.5, 0.5]);
        assert_eq!(scorer.class_counts, Some(vec![3, 3]));
        assert_eq!(scorer.smoothing_alpha, 1.0);
        assert_eq!(scorer.variance_floor, 1e-9);

        match &scorer.feature_params[0] {
            NbFeatureParams::Categorical {
                categories,
                category_index,
                distribution,
                class_totals,
            } => {
                assert_eq!(
                    categories,
                    &vec![
                        "Overcast".to_string(),
                        "Rain".to_string(),
                        "Sunny".to_string()
                    ]
                );
                assert_eq!(category_index.get("Sunny"), Some(&2));
                assert_eq!(
                    distribution[0],
                    vec![0.5, 0.16666666666666666, 0.3333333333333333]
                );
                assert_eq!(
                    distribution[1],
                    vec![0.16666666666666666, 0.3333333333333333, 0.5]
                );
                assert_eq!(class_totals, &Some(vec![3, 3]));
            }
            other => panic!("fitur 0 seharusnya categorical: {:?}", other),
        }
        match &scorer.feature_params[1] {
            NbFeatureParams::Numerical { mean, variance } => {
                assert_eq!(mean, &vec![84.0, 72.0]);
                assert_eq!(variance, &vec![18.666666666666668, 2.6666666666666665]);
            }
            other => panic!("fitur 1 seharusnya numerical: {:?}", other),
        }
    }

    #[test]
    fn d2_has_no_counts_or_totals() {
        let scorer = NaiveBayesScorer::from_json(&d2()).unwrap();
        assert_eq!(scorer.class_counts, None);
        match &scorer.feature_params[0] {
            NbFeatureParams::Categorical { class_totals, .. } => {
                assert_eq!(class_totals, &None);
            }
            other => panic!("fitur 0 seharusnya categorical: {:?}", other),
        }
    }

    #[test]
    fn features_follow_feature_order_not_features_array() {
        let mut v = d1();
        v["feature_order"] = json!(["Temp", "Outlook"]);
        let scorer = NaiveBayesScorer::from_json(&v).unwrap();
        assert_eq!(scorer.features[0].name, "Temp");
        assert_eq!(scorer.features[0].role, FeatureRole::Numerical);
        assert_eq!(scorer.features[1].name, "Outlook");
        assert!(matches!(
            scorer.feature_params[0],
            NbFeatureParams::Numerical { .. }
        ));
        assert!(matches!(
            scorer.feature_params[1],
            NbFeatureParams::Categorical { .. }
        ));
    }

    #[test]
    fn integer_valued_floats_accepted_for_counts() {
        let mut v = d1();
        v["target"]["class_counts"] = json!([3.0, 3.0]);
        v["features"][0]["class_totals"] = json!({ "No": 3.0, "Yes": 3.0 });
        let scorer = NaiveBayesScorer::from_json(&v).unwrap();
        assert_eq!(scorer.class_counts, Some(vec![3, 3]));
    }

    #[test]
    fn unknown_extra_fields_are_ignored() {
        let mut v = d1();
        v["extra_field"] = json!({ "anything": 1 });
        assert!(build_scorer(&v).is_ok());
    }

    #[test]
    fn summary_parameters_match_contract_labels() {
        let scorer = build_scorer(&d1()).ok().unwrap();
        let params = scorer.summary_parameters();
        assert_eq!(params.len(), 3);
        assert_eq!(params[0], ("Smoothing alpha".to_string(), "1".to_string()));
        assert_eq!(
            params[1],
            ("Variance floor".to_string(), 1e-9_f64.to_string())
        );
        assert_eq!(
            params[2],
            (
                "Validation (training)".to_string(),
                "Holdout 70% / 30%, seed 42".to_string()
            )
        );
    }

    #[test]
    fn summary_parameters_kfold_and_no_seed() {
        let mut v = d1();
        v["validation_config"] =
            json!({ "method": "kfold", "training_percentage": null, "holdout_percentage": null, "folds": 5, "seed": null });
        let scorer = build_scorer(&v).ok().unwrap();
        assert_eq!(scorer.summary_parameters()[2].1, "5-fold, no seed");
    }

    // --- build_scorer: lapis registry (§4.2) -------------------------------

    #[test]
    fn error_not_object() {
        assert_code(&json!([1, 2]), "AM_E_NOT_OBJECT");
        assert_code(&json!(null), "AM_E_NOT_OBJECT");
        assert_code(&json!("naive_bayes"), "AM_E_NOT_OBJECT");
    }

    #[test]
    fn error_model_type_missing() {
        let mut v = d1();
        v.as_object_mut().unwrap().remove("model_type");
        assert_single_code(&v, "AM_E_MODEL_TYPE_MISSING");

        let mut v = d1();
        v["model_type"] = json!(42);
        assert_single_code(&v, "AM_E_MODEL_TYPE_MISSING");
    }

    #[test]
    fn error_model_type_unsupported() {
        let mut v = d1();
        v["model_type"] = json!("decision_tree");
        assert_single_code(&v, "AM_E_MODEL_TYPE_UNSUPPORTED");
        assert!(build_err(&v).contains("decision_tree"));
    }

    // --- validasi NB (§4.3) ------------------------------------------------

    #[test]
    fn error_schema_version_unsupported() {
        let mut v = d1();
        // Revisi v2 (Fase A2): "2.0" kini didukung, jadi contoh versi tak didukung dinaikkan ke "3.0".
        // Kode error yang diharapkan tidak berubah.
        v["schema_version"] = json!("3.0");
        assert_single_code(&v, "AM_E_SCHEMA_VERSION_UNSUPPORTED");
        assert!(build_err(&v).contains("3.0"));
    }

    #[test]
    fn error_field_missing_stops_validation() {
        let mut v = d1();
        v.as_object_mut().unwrap().remove("trained_at");
        let e = build_err(&v);
        assert!(e.starts_with("AM_E_FIELD_MISSING:"), "{}", e);
        assert!(e.contains("trained_at"));

        let mut v = d1();
        v["target"].as_object_mut().unwrap().remove("class_priors");
        let e = build_err(&v);
        assert!(e.starts_with("AM_E_FIELD_MISSING:"), "{}", e);
        assert!(e.contains("target.class_priors"));
    }

    #[test]
    fn error_field_type() {
        let mut v = d1();
        v["target"]["classes"] = json!("No");
        assert_single_code(&v, "AM_E_FIELD_TYPE");
    }

    #[test]
    fn error_classes_empty_and_duplicate() {
        let mut v = d1();
        v["target"]["classes"] = json!([]);
        assert_code(&v, "AM_E_CLASSES_EMPTY");

        let mut v = d1();
        v["target"]["classes"] = json!(["No", "No"]);
        assert_code(&v, "AM_E_CLASSES_DUPLICATE");
    }

    #[test]
    fn error_priors_length() {
        let mut v = d1();
        v["target"]["class_priors"] = json!([1.0]);
        assert_single_code(&v, "AM_E_PRIORS_LENGTH");
    }

    #[test]
    fn error_priors_invalid() {
        let mut v = d1();
        v["target"]["class_priors"] = json!([0.5, 0.6]);
        assert_code(&v, "AM_E_PRIORS_INVALID");

        let mut v = d1();
        v["target"]["class_priors"] = json!([-0.5, 1.5]);
        assert_code(&v, "AM_E_PRIORS_INVALID");
    }

    #[test]
    fn error_param_invalid() {
        let mut v = d1();
        v["smoothing_alpha"] = json!(0);
        assert_single_code(&v, "AM_E_PARAM_INVALID");

        let mut v = d1();
        v["variance_floor"] = json!(-1.0);
        assert_single_code(&v, "AM_E_PARAM_INVALID");
    }

    #[test]
    fn error_feature_order_mismatch() {
        let mut v = d1();
        v["feature_order"] = json!(["Outlook", "Foo"]);
        assert_single_code(&v, "AM_E_FEATURE_ORDER_MISMATCH");

        let mut v = d1();
        v["feature_order"] = json!(["Outlook", "Outlook"]);
        assert_code(&v, "AM_E_FEATURE_ORDER_MISMATCH");

        let mut v = d1();
        v["feature_order"] = json!(["Outlook"]);
        assert_code(&v, "AM_E_FEATURE_ORDER_MISMATCH");
    }

    #[test]
    fn error_role_invalid() {
        let mut v = d1();
        v["features"][1]["role"] = json!("ordinal");
        assert_single_code(&v, "AM_E_ROLE_INVALID");
    }

    #[test]
    fn error_categories_invalid() {
        let mut v = d1();
        v["features"][0]["categories"] = json!(["Overcast", "Overcast", "Sunny"]);
        assert_single_code(&v, "AM_E_CATEGORIES_INVALID");
    }

    #[test]
    fn error_distribution_class_missing() {
        let mut v = d1();
        v["features"][0]["distribution"]
            .as_object_mut()
            .unwrap()
            .remove("No");
        assert_single_code(&v, "AM_E_DISTRIBUTION_CLASS_MISSING");
    }

    #[test]
    fn error_distribution_length() {
        let mut v = d1();
        v["features"][0]["distribution"]["No"] = json!([0.5, 0.5]);
        assert_single_code(&v, "AM_E_DISTRIBUTION_LENGTH");
    }

    #[test]
    fn error_distribution_sum() {
        let mut v = d1();
        v["features"][0]["distribution"]["No"] = json!([0.4, 0.16666666666666666, 0.3333333333333333]);
        assert_single_code(&v, "AM_E_DISTRIBUTION_SUM");
    }

    #[test]
    fn error_gaussian_class_missing() {
        let mut v = d1();
        v["features"][1]["mean"]
            .as_object_mut()
            .unwrap()
            .remove("Yes");
        assert_single_code(&v, "AM_E_GAUSSIAN_CLASS_MISSING");
    }

    #[test]
    fn error_gaussian_invalid_variance_zero() {
        let mut v = d1();
        v["features"][1]["variance"]["No"] = json!(0.0);
        assert_single_code(&v, "AM_E_GAUSSIAN_INVALID");
    }

    #[test]
    fn error_counts_invalid_when_class_counts_missing_in_1_1() {
        let mut v = d1();
        v["target"].as_object_mut().unwrap().remove("class_counts");
        assert_single_code(&v, "AM_E_COUNTS_INVALID");
    }

    #[test]
    fn error_counts_invalid_variants() {
        let mut v = d1();
        v["target"]["class_counts"] = json!([3]);
        assert_single_code(&v, "AM_E_COUNTS_INVALID");

        let mut v = d1();
        v["target"]["class_counts"] = json!([1.5, 1.5]);
        assert_single_code(&v, "AM_E_COUNTS_INVALID");

        let mut v = d1();
        v["target"]["class_counts"] = json!([0, 0]);
        assert_single_code(&v, "AM_E_COUNTS_INVALID");
    }

    #[test]
    fn error_counts_inconsistent() {
        let mut v = d1();
        v["target"]["class_counts"] = json!([3, 1]);
        assert_single_code(&v, "AM_E_COUNTS_INCONSISTENT");
    }

    #[test]
    fn error_class_totals_class_missing() {
        let mut v = d1();
        v["features"][0]["class_totals"]
            .as_object_mut()
            .unwrap()
            .remove("Yes");
        assert_single_code(&v, "AM_E_CLASS_TOTALS_INVALID");
    }

    #[test]
    fn error_class_totals_missing_entirely() {
        let mut v = d1();
        v["features"][0]
            .as_object_mut()
            .unwrap()
            .remove("class_totals");
        assert_single_code(&v, "AM_E_CLASS_TOTALS_INVALID");
    }

    #[test]
    fn schema_1_0_does_not_require_counts() {
        // D2 valid walau tanpa class_counts/class_totals (langkah 11 hanya 1.1).
        assert!(build_scorer(&d2()).is_ok());
    }

    #[test]
    fn multiple_errors_are_collected_and_joined() {
        let mut v = d1();
        v["smoothing_alpha"] = json!(0);
        v["variance_floor"] = json!(-1.0);
        let e = build_err(&v);
        assert!(e.starts_with("AM_E_PARAM_INVALID: smoothing_alpha"), "{}", e);
        assert!(e.contains(" | AM_E_PARAM_INVALID: variance_floor"), "{}", e);
    }

    // --- score_row (Fase 8, AGENTS.md §5.4 & §5.6) ---------------------------

    fn text(s: &str) -> DataValue {
        DataValue::Text(s.to_string())
    }

    /// Assert baris `Scored` dengan skor (toleransi 1e-9) dan flag persis.
    fn assert_scored(
        row: RowScore,
        expected: [f64; 2],
        expected_missing: bool,
        expected_unseen: bool,
        expected_skipped: usize,
    ) {
        match row {
            RowScore::Scored {
                log_scores,
                had_missing,
                had_unseen,
                skipped_unseen,
            } => {
                assert_eq!(log_scores.len(), 2);
                assert!(
                    (log_scores[0] - expected[0]).abs() < 1e-9,
                    "s_No {} != {}",
                    log_scores[0],
                    expected[0]
                );
                assert!(
                    (log_scores[1] - expected[1]).abs() < 1e-9,
                    "s_Yes {} != {}",
                    log_scores[1],
                    expected[1]
                );
                assert_eq!(had_missing, expected_missing, "had_missing");
                assert_eq!(had_unseen, expected_unseen, "had_unseen");
                assert_eq!(skipped_unseen, expected_skipped, "skipped_unseen");
            }
            RowScore::NotScored => panic!("seharusnya Scored"),
        }
    }

    fn d1_scorer() -> NaiveBayesScorer {
        NaiveBayesScorer::from_json(&d1()).unwrap()
    }

    fn d2_scorer() -> NaiveBayesScorer {
        NaiveBayesScorer::from_json(&d2()).unwrap()
    }

    #[test]
    fn t1_overcast_85() {
        let row = d1_scorer().score_row(&[text("Overcast"), DataValue::Number(85.0)]);
        assert_scored(
            row,
            [-3.7953883096437977, -35.581759809498536],
            false,
            false,
            0,
        );
    }

    #[test]
    fn t2_sunny_71() {
        let row = d1_scorer().score_row(&[text("Sunny"), DataValue::Number(71.0)]);
        assert_scored(
            row,
            [-8.700853417751961, -2.9831475208304266],
            false,
            false,
            0,
        );
    }

    #[test]
    fn t3_foggy_unseen_schema_1_1() {
        let row = d1_scorer().score_row(&[text("Foggy"), DataValue::Number(72.0)]);
        assert_scored(
            row,
            [-8.72435774116905, -3.894259809498536],
            false,
            true,
            0,
        );
    }

    #[test]
    fn t4_sunny_temp_missing() {
        let row = d1_scorer().score_row(&[text("Sunny"), DataValue::Null]);
        assert_scored(
            row,
            [-1.791759469228055, -1.3862943611198906],
            true,
            false,
            0,
        );
    }

    #[test]
    fn t5_all_missing_is_not_scored() {
        let row = d1_scorer().score_row(&[DataValue::Null, DataValue::Null]);
        assert_eq!(row, RowScore::NotScored);
    }

    #[test]
    fn t6_missing_outlook_becomes_unseen_missing_category() {
        let row = d1_scorer().score_row(&[DataValue::Null, DataValue::Number(80.0)]);
        assert_scored(
            row,
            [-5.295786312597621, -15.894259809498536],
            true,
            true,
            0,
        );
    }

    #[test]
    fn t7_foggy_unseen_schema_1_0_is_skipped() {
        let row = d2_scorer().score_row(&[text("Foggy"), DataValue::Number(72.0)]);
        assert_scored(
            row,
            [-6.932598271940995, -2.102500340270481],
            false,
            true,
            1,
        );
    }

    #[test]
    fn schema_1_0_t6_missing_category_is_skipped_too() {
        // Pada 1.0, "(Missing)" yang tidak ada di `categories` juga dilewati.
        let row = d2_scorer().score_row(&[DataValue::Null, DataValue::Number(80.0)]);
        match row {
            RowScore::Scored {
                had_missing,
                had_unseen,
                skipped_unseen,
                ..
            } => {
                assert!(had_missing);
                assert!(had_unseen);
                assert_eq!(skipped_unseen, 1);
            }
            RowScore::NotScored => panic!("seharusnya Scored"),
        }
    }

    #[test]
    fn known_category_text_is_trimmed_and_case_sensitive() {
        let scorer = d1_scorer();
        let trimmed = scorer.score_row(&[text("  Sunny "), DataValue::Number(71.0)]);
        assert_scored(
            trimmed,
            [-8.700853417751961, -2.9831475208304266],
            false,
            false,
            0,
        );
        // Perbandingan kategori case-sensitive -> "sunny" tak dikenal.
        match scorer.score_row(&[text("sunny"), DataValue::Number(71.0)]) {
            RowScore::Scored { had_unseen, .. } => assert!(had_unseen),
            RowScore::NotScored => panic!("seharusnya Scored"),
        }
    }

    #[test]
    fn non_finite_numeric_is_treated_as_missing() {
        let row = d1_scorer().score_row(&[text("Sunny"), DataValue::Number(f64::NAN)]);
        assert_scored(
            row,
            [-1.791759469228055, -1.3862943611198906],
            true,
            false,
            0,
        );
    }

    #[test]
    fn values_length_mismatch_is_not_scored_without_panic() {
        let row = d1_scorer().score_row(&[text("Sunny")]);
        assert_eq!(row, RowScore::NotScored);
    }

    #[test]
    fn safe_ln_floors_zero_probability() {
        assert_eq!(safe_ln(0.0), f64::MIN_POSITIVE.ln());
        assert_eq!(safe_ln(-1.0), f64::MIN_POSITIVE.ln());
        assert!((safe_ln(0.5) - 0.5_f64.ln()).abs() < 1e-15);
    }

    #[test]
    fn log_gaussian_density_matches_formula_and_guards_variance() {
        // x = mean, variance 1 -> -0.5 * ln(2*pi)
        let v = log_gaussian_density(0.0, 0.0, 1.0);
        assert!((v - (-0.5 * (2.0 * PI).ln())).abs() < 1e-12);
        // variance 0 tidak menghasilkan NaN/Inf.
        assert!(log_gaussian_density(1.0, 1.0, 0.0).is_finite());
    }
}
