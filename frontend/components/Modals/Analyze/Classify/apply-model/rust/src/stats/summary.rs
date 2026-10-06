// Ringkasan hasil scoring — modul GENERIK (AGENTS.md §5.5 & §5.7, PLAN.md
// Fase 9 langkah 2). Tidak tahu algoritmanya: hanya menerima `RowScore` dari
// `ClassifierScorer::score_row`, mengubahnya menjadi posterior + kelas
// prediksi, lalu mengakumulasi `case_processing_summary`,
// `prediction_distribution`, `predictions`, dan `warnings`.
//
// Evaluasi (confusion matrix & metrik) BUKAN di sini — Fase 10.
use crate::models::result::{
    ApplyModelWarning, CaseProcessingSummary, PredictionDistribution, Predictions,
};
use crate::scoring::RowScore;
use crate::stats::posterior::{argmax_with_tie_break, normalize_log_scores, round4};

/// Hasil scoring satu baris yang sudah melalui posterior & argmax.
#[derive(Debug, Clone, PartialEq)]
pub struct ScoredRow {
    /// Index kelas prediksi pada `classes` model (argmax dari skor mentah).
    pub predicted_index: usize,
    /// Posterior mentah (belum dibulatkan), sejajar `classes`.
    pub probabilities: Vec<f64>,
    pub had_missing: bool,
    pub had_unseen: bool,
    pub skipped_unseen: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RowOutcome {
    /// Seluruh prediktor missing (K5): tidak diprediksi.
    NotScored,
    Scored(ScoredRow),
}

/// Hasil akumulasi seluruh baris.
#[derive(Debug, Clone)]
pub struct RowsSummary {
    pub case_processing_summary: CaseProcessingSummary,
    pub prediction_distribution: PredictionDistribution,
    pub predictions: Predictions,
    /// Jumlah baris `Scored` dengan `skipped_unseen > 0` (hanya relevan untuk
    /// schema 1.0; dipakai warning `AM_W_UNSEEN_SKIPPED_LEGACY`).
    pub rows_with_skipped_unseen: u32,
}

/// Ubah `RowScore` menjadi `RowOutcome`: posterior lewat log-sum-exp dan kelas
/// prediksi lewat argmax dari SKOR MENTAH (bukan dari probabilitas yang
/// dibulatkan, AGENTS.md §5.5).
pub fn resolve_row(classes: &[String], row: RowScore) -> RowOutcome {
    match row {
        RowScore::NotScored => RowOutcome::NotScored,
        RowScore::Scored {
            log_scores,
            had_missing,
            had_unseen,
            skipped_unseen,
        } => {
            let probabilities = normalize_log_scores(&log_scores);
            let predicted_index = argmax_with_tie_break(classes, &log_scores);
            RowOutcome::Scored(ScoredRow {
                predicted_index,
                probabilities,
                had_missing,
                had_unseen,
                skipped_unseen,
            })
        }
    }
}

/// Akumulasi ringkasan (AGENTS.md §5.7). Urutan array hasil selalu mengikuti
/// `classes` model dan urutan baris input.
pub fn summarize_rows(classes: &[String], outcomes: &[RowOutcome]) -> RowsSummary {
    let total_rows = outcomes.len();

    let mut scored_rows: u32 = 0;
    let mut not_scored: u32 = 0;
    let mut rows_with_missing_predictor: u32 = 0;
    let mut rows_with_unseen_category: u32 = 0;
    let mut rows_with_skipped_unseen: u32 = 0;
    let mut counts: Vec<u32> = vec![0; classes.len()];

    let mut predicted: Vec<Option<String>> = Vec::with_capacity(total_rows);
    let mut max_probability: Vec<Option<f64>> = Vec::with_capacity(total_rows);
    let mut class_probabilities: Vec<Vec<Option<f64>>> =
        vec![Vec::with_capacity(total_rows); classes.len()];

    for outcome in outcomes {
        match outcome {
            RowOutcome::NotScored => {
                not_scored += 1;
                predicted.push(None);
                max_probability.push(None);
                for column in class_probabilities.iter_mut() {
                    column.push(None);
                }
            }
            RowOutcome::Scored(row) => {
                scored_rows += 1;
                if row.had_missing {
                    rows_with_missing_predictor += 1;
                }
                if row.had_unseen {
                    rows_with_unseen_category += 1;
                }
                if row.skipped_unseen > 0 {
                    rows_with_skipped_unseen += 1;
                }

                if let Some(count) = counts.get_mut(row.predicted_index) {
                    *count += 1;
                }
                predicted.push(classes.get(row.predicted_index).cloned());
                max_probability.push(
                    row.probabilities
                        .get(row.predicted_index)
                        .map(|p| round4(*p)),
                );
                for (class_idx, column) in class_probabilities.iter_mut().enumerate() {
                    column.push(row.probabilities.get(class_idx).map(|p| round4(*p)));
                }
            }
        }
    }

    let percentages: Vec<f64> = counts
        .iter()
        .map(|count| {
            if scored_rows == 0 {
                0.0
            } else {
                *count as f64 / scored_rows as f64 * 100.0
            }
        })
        .collect();

    RowsSummary {
        case_processing_summary: CaseProcessingSummary {
            total_rows: total_rows as u32,
            scored_rows,
            not_scored_all_missing: not_scored,
            rows_with_missing_predictor,
            rows_with_unseen_category,
        },
        prediction_distribution: PredictionDistribution {
            classes: classes.to_vec(),
            counts,
            percentages,
            not_scored,
        },
        predictions: Predictions {
            predicted,
            max_probability,
            class_probabilities,
        },
        rows_with_skipped_unseen,
    }
}

/// Satu entri per kode dengan `count > 0` (AGENTS.md §5.7), urutan tetap:
/// `AM_W_ROWS_NOT_SCORED`, `AM_W_UNSEEN_CATEGORY` (hanya schema non-legacy),
/// `AM_W_UNSEEN_SKIPPED_LEGACY` (hanya schema legacy 1.0). Teks pesan sama
/// dengan `APPLY_MODEL_MESSAGES` di sisi TS.
/// `AM_W_ACTUAL_UNKNOWN_CLASS` ditambahkan oleh evaluasi (Fase 10).
pub fn build_warnings(summary: &RowsSummary, legacy_unseen_handling: bool) -> Vec<ApplyModelWarning> {
    let mut warnings: Vec<ApplyModelWarning> = Vec::new();

    let not_scored = summary.case_processing_summary.not_scored_all_missing;
    if not_scored > 0 {
        warnings.push(ApplyModelWarning {
            code: "AM_W_ROWS_NOT_SCORED".to_string(),
            count: not_scored,
            message: "Some rows were not scored because all of their predictor variables are missing."
                .to_string(),
        });
    }

    if legacy_unseen_handling {
        let skipped = summary.rows_with_skipped_unseen;
        if skipped > 0 {
            warnings.push(ApplyModelWarning {
                code: "AM_W_UNSEEN_SKIPPED_LEGACY".to_string(),
                count: skipped,
                message: "Some rows contain categories unknown to the model (schema 1.0), so that feature was skipped when predicting."
                    .to_string(),
            });
        }
    } else {
        let unseen = summary.case_processing_summary.rows_with_unseen_category;
        if unseen > 0 {
            warnings.push(ApplyModelWarning {
                code: "AM_W_UNSEEN_CATEGORY".to_string(),
                count: unseen,
                message: "Some rows contain categories unknown to the model; they were handled with smoothing."
                    .to_string(),
            });
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn scored(
        log_scores: Vec<f64>,
        had_missing: bool,
        had_unseen: bool,
        skipped_unseen: usize,
    ) -> RowScore {
        RowScore::Scored {
            log_scores,
            had_missing,
            had_unseen,
            skipped_unseen,
        }
    }

    #[test]
    fn resolve_row_not_scored_stays_not_scored() {
        let classes = names(&["No", "Yes"]);
        assert_eq!(
            resolve_row(&classes, RowScore::NotScored),
            RowOutcome::NotScored
        );
    }

    #[test]
    fn resolve_row_uses_raw_scores_for_argmax_and_softmax_for_probabilities() {
        let classes = names(&["No", "Yes"]);
        let outcome = resolve_row(
            &classes,
            scored(
                vec![-8.700853417751961, -2.9831475208304266],
                false,
                false,
                0,
            ),
        );
        match outcome {
            RowOutcome::Scored(row) => {
                assert_eq!(row.predicted_index, 1);
                assert!((row.probabilities[0] - 0.003276472969649914).abs() < 1e-12);
                assert!((row.probabilities[1] - 0.9967235270303499).abs() < 1e-12);
                assert!(!row.had_missing && !row.had_unseen);
                assert_eq!(row.skipped_unseen, 0);
            }
            RowOutcome::NotScored => panic!("seharusnya Scored"),
        }
    }

    #[test]
    fn resolve_row_tie_goes_to_alphabetically_first_class() {
        let classes = names(&["b", "a"]);
        match resolve_row(&classes, scored(vec![-1.0, -1.0], false, false, 0)) {
            RowOutcome::Scored(row) => assert_eq!(classes[row.predicted_index], "a"),
            RowOutcome::NotScored => panic!("seharusnya Scored"),
        }
    }

    #[test]
    fn summarize_counts_flags_and_distribution_follow_class_order() {
        let classes = names(&["No", "Yes"]);
        let outcomes = vec![
            resolve_row(&classes, scored(vec![-1.0, -5.0], false, false, 0)), // No
            resolve_row(&classes, scored(vec![-5.0, -1.0], true, false, 0)),  // Yes, missing
            resolve_row(&classes, scored(vec![-5.0, -1.0], false, true, 0)),  // Yes, unseen
            RowOutcome::NotScored,
        ];
        let summary = summarize_rows(&classes, &outcomes);

        let cps = &summary.case_processing_summary;
        assert_eq!(cps.total_rows, 4);
        assert_eq!(cps.scored_rows, 3);
        assert_eq!(cps.not_scored_all_missing, 1);
        assert_eq!(cps.rows_with_missing_predictor, 1);
        assert_eq!(cps.rows_with_unseen_category, 1);

        let dist = &summary.prediction_distribution;
        assert_eq!(dist.classes, classes);
        assert_eq!(dist.counts, vec![1, 2]);
        assert_eq!(dist.not_scored, 1);
        assert!((dist.percentages[0] - 100.0 / 3.0).abs() < 1e-9);
        assert!((dist.percentages[1] - 200.0 / 3.0).abs() < 1e-9);

        let preds = &summary.predictions;
        assert_eq!(
            preds.predicted,
            vec![
                Some("No".to_string()),
                Some("Yes".to_string()),
                Some("Yes".to_string()),
                None
            ]
        );
        assert_eq!(preds.max_probability.len(), 4);
        assert_eq!(preds.max_probability[3], None);
        assert_eq!(preds.class_probabilities.len(), 2);
        assert_eq!(preds.class_probabilities[0].len(), 4);
        assert_eq!(preds.class_probabilities[1][3], None);
    }

    #[test]
    fn summarize_all_not_scored_has_zero_percentages_not_nan() {
        let classes = names(&["No", "Yes"]);
        let outcomes = vec![RowOutcome::NotScored, RowOutcome::NotScored];
        let summary = summarize_rows(&classes, &outcomes);

        assert_eq!(summary.case_processing_summary.scored_rows, 0);
        assert_eq!(summary.prediction_distribution.counts, vec![0, 0]);
        assert_eq!(summary.prediction_distribution.percentages, vec![0.0, 0.0]);
        assert_eq!(summary.prediction_distribution.not_scored, 2);
    }

    #[test]
    fn summarize_counts_rows_with_skipped_unseen_per_row_not_per_feature() {
        let classes = names(&["No", "Yes"]);
        let outcomes = vec![
            resolve_row(&classes, scored(vec![-1.0, -2.0], false, true, 2)),
            resolve_row(&classes, scored(vec![-1.0, -2.0], false, true, 1)),
            resolve_row(&classes, scored(vec![-1.0, -2.0], false, false, 0)),
        ];
        let summary = summarize_rows(&classes, &outcomes);
        assert_eq!(summary.rows_with_skipped_unseen, 2);
        assert_eq!(summary.case_processing_summary.rows_with_unseen_category, 2);
    }

    #[test]
    fn warnings_follow_schema_kind_and_skip_zero_counts() {
        let classes = names(&["No", "Yes"]);
        let outcomes = vec![
            resolve_row(&classes, scored(vec![-1.0, -2.0], false, true, 1)),
            RowOutcome::NotScored,
        ];
        let summary = summarize_rows(&classes, &outcomes);

        let current = build_warnings(&summary, false);
        let codes: Vec<&str> = current.iter().map(|w| w.code.as_str()).collect();
        assert_eq!(codes, vec!["AM_W_ROWS_NOT_SCORED", "AM_W_UNSEEN_CATEGORY"]);
        assert!(current.iter().all(|w| w.count == 1));

        let legacy = build_warnings(&summary, true);
        let codes: Vec<&str> = legacy.iter().map(|w| w.code.as_str()).collect();
        assert_eq!(
            codes,
            vec!["AM_W_ROWS_NOT_SCORED", "AM_W_UNSEEN_SKIPPED_LEGACY"]
        );

        let clean = summarize_rows(
            &classes,
            &[resolve_row(&classes, scored(vec![-1.0, -2.0], false, false, 0))],
        );
        assert!(build_warnings(&clean, false).is_empty());
        assert!(build_warnings(&clean, true).is_empty());
    }
}
