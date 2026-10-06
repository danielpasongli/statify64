// Evaluasi opsional terhadap variabel target sebenarnya (actual) —
// AGENTS.md §5.7, PLAN.md Fase 10 langkah 1. Modul GENERIK: tidak tahu
// algoritmanya, hanya menerima `RowOutcome` hasil `summary::resolve_row` dan
// nilai sel actual per baris.
//
// Aturan pengecualian baris (urutan pemeriksaan = urutan di AGENTS.md §5.7;
// satu baris hanya dihitung di SATU kategori):
//   1. baris tidak diprediksi (`NotScored`)      -> `excluded_not_scored`
//   2. actual missing (`is_missing_value`)        -> `excluded_actual_missing`
//   3. label actual tidak ada di `classes` model  -> `excluded_actual_unknown_class`
// Sisa baris dipakai untuk `compute_confusion_matrix` +
// `compute_evaluation_metrics` (salinan NB, `classification_table.rs`).
//
// Label actual memakai `data_value_to_label` (AGENTS.md §5.3) dan dibandingkan
// case-sensitive persis dengan `classes` (sama dengan perilaku NB).
//
// Serialisasi `confusion_matrix` / `evaluation_metrics` ke JSON identik dengan
// `evaluation_result_to_json` di `naive-bayes/rust/src/wasm/function.rs`
// (baris 249-299) supaya cocok dengan `NaiveBayesConfusionMatrixRaw` /
// `NaiveBayesEvaluationMetricsRaw` di sisi TS (nama field snake_case,
// `macro_avg`/`weighted_avg`/`micro_avg`).
use serde_json::{json, Value};

use crate::models::data::DataValue;
use crate::models::result::{ApplyModelWarning, Evaluation};
use crate::stats::classification_table::{
    compute_evaluation_metrics, ConfusionMatrix, EvaluationMetrics,
};
use crate::stats::summary::RowOutcome;
use crate::stats::value_label::{data_value_to_label, is_missing_value};

/// Bangun `Evaluation` dari hasil scoring per baris dan nilai actual per baris.
///
/// `actual_values[row]` sejajar `outcomes[row]`; baris yang tidak punya sel
/// actual (slice lebih pendek) dianggap `Null` (= missing).
pub fn build_evaluation(
    classes: &[String],
    outcomes: &[RowOutcome],
    actual_values: &[DataValue],
) -> Evaluation {
    let mut excluded_not_scored: u32 = 0;
    let mut excluded_actual_missing: u32 = 0;
    let mut excluded_actual_unknown_class: u32 = 0;

    let mut actual_labels: Vec<String> = Vec::new();
    let mut predicted_labels: Vec<String> = Vec::new();
    let missing_cell = DataValue::Null;

    for (row, outcome) in outcomes.iter().enumerate() {
        let scored = match outcome {
            RowOutcome::NotScored => {
                excluded_not_scored += 1;
                continue;
            }
            RowOutcome::Scored(scored) => scored,
        };

        let actual_value = actual_values.get(row).unwrap_or(&missing_cell);
        if is_missing_value(actual_value) {
            excluded_actual_missing += 1;
            continue;
        }

        let actual_label = data_value_to_label(actual_value);
        if !classes.iter().any(|class| *class == actual_label) {
            excluded_actual_unknown_class += 1;
            continue;
        }

        // `predicted_index` selalu valid terhadap `classes` (berasal dari
        // `argmax_with_tie_break` atas skor sejajar `classes`); bila tidak,
        // baris dihitung sebagai tidak diprediksi alih-alih panic.
        let predicted_label = match classes.get(scored.predicted_index) {
            Some(class) => class.clone(),
            None => {
                excluded_not_scored += 1;
                continue;
            }
        };

        actual_labels.push(actual_label);
        predicted_labels.push(predicted_label);
    }

    let (confusion, metrics) = compute_evaluation_metrics(&actual_labels, &predicted_labels, classes);

    Evaluation {
        evaluated_rows: actual_labels.len() as u32,
        excluded_actual_missing,
        excluded_actual_unknown_class,
        excluded_not_scored,
        confusion_matrix: confusion_matrix_to_json(&confusion),
        evaluation_metrics: evaluation_metrics_to_json(classes, &metrics),
    }
}

/// Warning `AM_W_ACTUAL_UNKNOWN_CLASS` (AGENTS.md §5.7), `None` bila count = 0.
/// Teks sama dengan `APPLY_MODEL_MESSAGES` di sisi TS.
pub fn actual_unknown_class_warning(count: u32) -> Option<ApplyModelWarning> {
    if count == 0 {
        return None;
    }
    Some(ApplyModelWarning {
        code: "AM_W_ACTUAL_UNKNOWN_CLASS".to_string(),
        count,
        message: "Some rows were excluded from the evaluation because their actual class is not known to the model."
            .to_string(),
    })
}

fn confusion_matrix_to_json(confusion: &ConfusionMatrix) -> Value {
    json!({
        "classes": confusion.classes,
        "matrix": confusion.matrix,
        "row_totals": confusion.row_totals,
        "col_totals": confusion.col_totals,
        "grand_total": confusion.grand_total,
        "percentages": confusion.percentages,
    })
}

fn evaluation_metrics_to_json(classes: &[String], metrics: &EvaluationMetrics) -> Value {
    let per_class: Vec<Value> = metrics
        .per_class
        .iter()
        .map(|class_metrics| {
            json!({
                "class": class_metrics.class,
                "accuracy": class_metrics.accuracy,
                "precision": class_metrics.precision,
                "recall": class_metrics.recall,
                "f1": class_metrics.f1,
            })
        })
        .collect();

    json!({
        "classes": classes,
        "per_class": per_class,
        "macro_avg": {
            "precision": metrics.macro_average.precision,
            "recall": metrics.macro_average.recall,
            "f1": metrics.macro_average.f1,
        },
        "weighted_avg": {
            "precision": metrics.weighted_average.precision,
            "recall": metrics.weighted_average.recall,
            "f1": metrics.weighted_average.f1,
        },
        "micro_avg": {
            "precision": metrics.micro_average.precision,
            "recall": metrics.micro_average.recall,
            "f1": metrics.micro_average.f1,
        },
        "overall_accuracy": metrics.overall_accuracy,
        "cohens_kappa": metrics.cohens_kappa,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::summary::ScoredRow;

    fn classes() -> Vec<String> {
        vec!["No".to_string(), "Yes".to_string()]
    }

    fn scored(predicted_index: usize) -> RowOutcome {
        RowOutcome::Scored(ScoredRow {
            predicted_index,
            probabilities: vec![0.5, 0.5],
            had_missing: false,
            had_unseen: false,
            skipped_unseen: 0,
        })
    }

    fn text(s: &str) -> DataValue {
        DataValue::Text(s.to_string())
    }

    /// Prediksi D1 + D3 (PLAN.md §1): No, Yes, Yes, Yes, (tidak diprediksi), No.
    fn d3_outcomes() -> Vec<RowOutcome> {
        vec![
            scored(0),
            scored(1),
            scored(1),
            scored(1),
            RowOutcome::NotScored,
            scored(0),
        ]
    }

    /// Kolom `Play` D3: No, Yes, Yes, No, Yes, Maybe.
    fn d3_actual() -> Vec<DataValue> {
        vec![
            text("No"),
            text("Yes"),
            text("Yes"),
            text("No"),
            text("Yes"),
            text("Maybe"),
        ]
    }

    #[test]
    fn d3_evaluation_counts_exclusions_and_matrix() {
        let evaluation = build_evaluation(&classes(), &d3_outcomes(), &d3_actual());

        assert_eq!(evaluation.evaluated_rows, 4);
        assert_eq!(evaluation.excluded_not_scored, 1);
        assert_eq!(evaluation.excluded_actual_unknown_class, 1);
        assert_eq!(evaluation.excluded_actual_missing, 0);

        assert_eq!(
            evaluation.confusion_matrix["matrix"],
            json!([[1, 1], [0, 2]])
        );
        assert_eq!(evaluation.confusion_matrix["grand_total"], json!(4));
        assert_eq!(evaluation.confusion_matrix["row_totals"], json!([2, 2]));
        assert_eq!(evaluation.confusion_matrix["col_totals"], json!([1, 3]));
        assert_eq!(evaluation.confusion_matrix["classes"], json!(["No", "Yes"]));
        assert_eq!(
            evaluation.evaluation_metrics["overall_accuracy"].as_f64(),
            Some(0.75)
        );
    }

    #[test]
    fn evaluation_json_has_the_shape_of_nb_raw_types() {
        let evaluation = build_evaluation(&classes(), &d3_outcomes(), &d3_actual());

        let cm = &evaluation.confusion_matrix;
        for key in [
            "classes",
            "matrix",
            "row_totals",
            "col_totals",
            "grand_total",
            "percentages",
        ] {
            assert!(cm.get(key).is_some(), "confusion_matrix.{} hilang", key);
        }

        let metrics = &evaluation.evaluation_metrics;
        for key in [
            "classes",
            "per_class",
            "macro_avg",
            "weighted_avg",
            "micro_avg",
            "overall_accuracy",
            "cohens_kappa",
        ] {
            assert!(metrics.get(key).is_some(), "evaluation_metrics.{} hilang", key);
        }
        for key in ["macro_avg", "weighted_avg", "micro_avg"] {
            for field in ["precision", "recall", "f1"] {
                assert!(metrics[key].get(field).is_some(), "{}.{} hilang", key, field);
            }
        }
        let per_class = metrics["per_class"].as_array().map(|a| a.len());
        assert_eq!(per_class, Some(2));
        for field in ["class", "accuracy", "precision", "recall", "f1"] {
            assert!(
                metrics["per_class"][0].get(field).is_some(),
                "per_class[0].{} hilang",
                field
            );
        }
        // Kappa HANYA overall (tidak ada kappa per kelas).
        assert!(metrics["per_class"][0].get("cohens_kappa").is_none());
    }

    #[test]
    fn missing_actual_values_are_excluded() {
        let outcomes = vec![scored(0), scored(1), scored(1), scored(0)];
        let actual = vec![
            DataValue::Null,
            text("   "),
            DataValue::Number(f64::NAN),
            text("No"),
        ];
        let evaluation = build_evaluation(&classes(), &outcomes, &actual);

        assert_eq!(evaluation.excluded_actual_missing, 3);
        assert_eq!(evaluation.evaluated_rows, 1);
        assert_eq!(evaluation.confusion_matrix["matrix"], json!([[1, 0], [0, 0]]));
    }

    #[test]
    fn actual_slice_shorter_than_rows_counts_missing() {
        let outcomes = vec![scored(0), scored(1)];
        let actual = vec![text("No")];
        let evaluation = build_evaluation(&classes(), &outcomes, &actual);

        assert_eq!(evaluation.evaluated_rows, 1);
        assert_eq!(evaluation.excluded_actual_missing, 1);
    }

    #[test]
    fn not_scored_takes_precedence_over_other_exclusions() {
        // Baris tidak diprediksi dengan actual missing / tak dikenal tetap
        // dihitung sebagai `excluded_not_scored` (urutan §5.7).
        let outcomes = vec![RowOutcome::NotScored, RowOutcome::NotScored];
        let actual = vec![DataValue::Null, text("Maybe")];
        let evaluation = build_evaluation(&classes(), &outcomes, &actual);

        assert_eq!(evaluation.excluded_not_scored, 2);
        assert_eq!(evaluation.excluded_actual_missing, 0);
        assert_eq!(evaluation.excluded_actual_unknown_class, 0);
        assert_eq!(evaluation.evaluated_rows, 0);
    }

    #[test]
    fn unknown_class_comparison_is_case_sensitive_and_trimmed() {
        let outcomes = vec![scored(0), scored(0)];
        let actual = vec![text("no"), text(" No ")];
        let evaluation = build_evaluation(&classes(), &outcomes, &actual);

        assert_eq!(evaluation.excluded_actual_unknown_class, 1);
        assert_eq!(evaluation.evaluated_rows, 1);
    }

    #[test]
    fn numeric_actual_uses_same_label_normalisation_as_classes() {
        let classes = vec!["1".to_string(), "2".to_string()];
        let outcomes = vec![scored(0), scored(1)];
        let actual = vec![DataValue::Number(1.0), DataValue::Number(2.0)];
        let evaluation = build_evaluation(&classes, &outcomes, &actual);

        assert_eq!(evaluation.evaluated_rows, 2);
        assert_eq!(evaluation.excluded_actual_unknown_class, 0);
        assert_eq!(evaluation.confusion_matrix["matrix"], json!([[1, 0], [0, 1]]));
    }

    #[test]
    fn zero_evaluated_rows_gives_zero_matrix_not_error() {
        let outcomes = vec![scored(0)];
        let actual = vec![text("Maybe")];
        let evaluation = build_evaluation(&classes(), &outcomes, &actual);

        assert_eq!(evaluation.evaluated_rows, 0);
        assert_eq!(evaluation.confusion_matrix["matrix"], json!([[0, 0], [0, 0]]));
        assert_eq!(evaluation.confusion_matrix["grand_total"], json!(0));
        assert_eq!(
            evaluation.evaluation_metrics["overall_accuracy"].as_f64(),
            Some(0.0)
        );
        assert_eq!(
            evaluation.evaluation_metrics["cohens_kappa"].as_f64(),
            Some(0.0)
        );
    }

    #[test]
    fn unknown_class_warning_only_when_count_positive() {
        assert!(actual_unknown_class_warning(0).is_none());
        let warning = actual_unknown_class_warning(1);
        assert_eq!(warning.as_ref().map(|w| w.code.as_str()), Some("AM_W_ACTUAL_UNKNOWN_CLASS"));
        assert_eq!(warning.as_ref().map(|w| w.count), Some(1));
    }
}
