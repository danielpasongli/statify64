// Posterior, kelas prediksi, dan pembulatan — modul GENERIK (AGENTS.md §5.5,
// PLAN.md Fase 9 langkah 1). Modul ini tidak tahu algoritma apa pun: ia hanya
// menerima skor log per kelas dari `ClassifierScorer::score_row` (P2).
//
// Tie-break argmax mengikuti `naive-bayes/rust/src/stats/prediction.rs:184-237`
// (`predict_case`): kelas diiterasi dalam urutan byte-wise ascending dan
// pemenang hanya diganti bila skor BENAR-BENAR lebih besar (`>`, bukan `>=`),
// sehingga seri selalu dimenangkan kelas pertama menurut urutan alfabetis.

/// Probabilitas posterior dari skor log (log-sum-exp, AGENTS.md §5.5):
/// `m = max s_c`, `p_c = exp(s_c - m) / sum_j exp(s_j - m)`.
///
/// Urutan hasil sejajar `log_scores`. Input kosong menghasilkan vektor kosong.
/// Pengaman: bila hasil penjumlahan tidak valid (mis. semua skor non-finite)
/// dikembalikan distribusi seragam supaya tidak ada NaN di output.
pub fn normalize_log_scores(log_scores: &[f64]) -> Vec<f64> {
    if log_scores.is_empty() {
        return Vec::new();
    }

    let max_score = log_scores
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);

    let exps: Vec<f64> = log_scores.iter().map(|s| (s - max_score).exp()).collect();
    let sum: f64 = exps.iter().sum();

    if !max_score.is_finite() || !sum.is_finite() || sum <= 0.0 {
        let uniform = 1.0 / log_scores.len() as f64;
        return vec![uniform; log_scores.len()];
    }

    exps.iter().map(|e| e / sum).collect()
}

/// Index (pada `classes` / `scores` yang sejajar) kelas pemenang.
///
/// Iterasi dalam urutan byte-wise ascending nama kelas (`Vec<String>::sort()`
/// pada salinan); pemenang diperbarui hanya bila `s_c > best` (strictly
/// greater). Bila tidak ada skor yang valid dikembalikan `0`; pemanggil
/// menjamin `classes` tidak kosong dan sejajar dengan `scores`.
pub fn argmax_with_tie_break(classes: &[String], scores: &[f64]) -> usize {
    let mut order: Vec<usize> = (0..classes.len()).collect();
    // `sort_by` stabil; `String` membandingkan secara byte-wise.
    order.sort_by(|a, b| classes[*a].cmp(&classes[*b]));

    let mut best_score = f64::NEG_INFINITY;
    let mut winner: usize = 0;

    for idx in order {
        if let Some(score) = scores.get(idx) {
            if *score > best_score {
                best_score = *score;
                winner = idx;
            }
        }
    }

    winner
}

/// Pembulatan 4 desimal untuk probabilitas output (AGENTS.md §5.5):
/// `round4(x) = (x * 10000.0).round() / 10000.0`.
pub fn round4(x: f64) -> f64 {
    (x * 10000.0).round() / 10000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    // --- normalize_log_scores (PLAN.md Fase 9, kriteria selesai) -----------

    #[test]
    fn normalize_matches_reference_scores_t2() {
        let p = normalize_log_scores(&[-8.700853417751961, -2.9831475208304266]);
        assert_eq!(p.len(), 2);
        assert!((p[0] - 0.003276472969649914).abs() < 1e-12, "{}", p[0]);
        assert!((p[1] - 0.9967235270303499).abs() < 1e-12, "{}", p[1]);
    }

    #[test]
    fn normalize_equal_scores_is_uniform() {
        let p = normalize_log_scores(&[0.0, 0.0]);
        assert_eq!(p, vec![0.5, 0.5]);
    }

    #[test]
    fn normalize_large_negative_scores_has_no_nan() {
        let p = normalize_log_scores(&[-1000.0, -1001.0]);
        assert_eq!(p.len(), 2);
        assert!(p.iter().all(|x| x.is_finite()));
        assert!((p.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        // exp(0) / (exp(0) + exp(-1)) dan exp(-1) / (exp(0) + exp(-1)).
        assert!((p[0] - 0.7310585786300049).abs() < 1e-12, "{}", p[0]);
        assert!((p[1] - 0.2689414213699951).abs() < 1e-12, "{}", p[1]);
    }

    #[test]
    fn normalize_empty_input_is_empty() {
        assert!(normalize_log_scores(&[]).is_empty());
    }

    #[test]
    fn normalize_non_finite_input_falls_back_to_uniform_without_nan() {
        let p = normalize_log_scores(&[f64::NEG_INFINITY, f64::NEG_INFINITY]);
        assert_eq!(p, vec![0.5, 0.5]);
    }

    // --- argmax_with_tie_break ---------------------------------------------

    #[test]
    fn argmax_tie_goes_to_alphabetically_first_class() {
        let classes = names(&["b", "a"]);
        let winner = argmax_with_tie_break(&classes, &[-1.0, -1.0]);
        assert_eq!(classes[winner], "a");
        assert_eq!(winner, 1);
    }

    #[test]
    fn argmax_picks_strictly_highest_score() {
        let classes = names(&["No", "Yes"]);
        assert_eq!(argmax_with_tie_break(&classes, &[-8.7, -2.98]), 1);
        assert_eq!(argmax_with_tie_break(&classes, &[-3.79, -35.58]), 0);
    }

    #[test]
    fn argmax_higher_score_beats_alphabetical_order() {
        let classes = names(&["a", "b"]);
        assert_eq!(argmax_with_tie_break(&classes, &[-5.0, -1.0]), 1);
    }

    #[test]
    fn argmax_orders_byte_wise_so_uppercase_precedes_lowercase() {
        // Byte-wise: "B" (0x42) < "a" (0x61).
        let classes = names(&["a", "B"]);
        let winner = argmax_with_tie_break(&classes, &[-2.0, -2.0]);
        assert_eq!(classes[winner], "B");
    }

    // --- round4 ------------------------------------------------------------

    #[test]
    fn round4_rounds_to_four_decimals() {
        assert_eq!(round4(0.9967235270303499), 0.9967);
        assert_eq!(round4(0.003276472969649914), 0.0033);
        assert_eq!(round4(0.9920775276270758), 0.9921);
        assert_eq!(round4(0.007922472372924202), 0.0079);
        assert_eq!(round4(0.6000000000000001), 0.6);
        assert_eq!(round4(0.9999999999999842), 1.0);
        assert_eq!(round4(1.5680296043290603e-14), 0.0);
    }
}
