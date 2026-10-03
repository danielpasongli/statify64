// SALINAN UTUH dari `naive-bayes/rust/src/stats/classification_table.rs`
// (baris 1-715, termasuk seluruh test-nya). Tanggal salin: 2026-10-03.
// PLAN.md Fase 10 / AGENTS.md P6 & §5.7: crate Apply Model berdiri sendiri,
// kode NB disalin (bukan di-import lintas crate). Isi di bawah baris ini
// identik dengan sumber; jangan "diperbaiki" di sini. Komentar kepala asli
// NB (yang menyebut "Fase 14" milik NB) dipertahankan apa adanya.
//
// naive-bayes/rust/src/stats/classification_table.rs
//
// PLAN.md Fase 14 — "Metrik evaluasi & Confusion Matrix" (AGENTS.md
// §5.6-§5.7).
//
// Modul ini MURNI menghitung metrik dari sepasang label (actual/predicted)
// yang sudah dihasilkan pemanggil — tidak tahu (dan tidak perlu tahu)
// apakah label itu berasal dari evaluasi holdout atau gabungan prediksi
// k-fold (AGENTS.md §5.5: "metrik evaluasi berasal dari prediksi
// holdout/prediksi gabungan k-fold"). Pemanggilan `stats::prediction::
// predict_cases` (Fase 13) untuk menghasilkan `predicted` adalah tanggung
// jawab pemanggil (Fase 17, saat wiring wasm/service asli) — DI LUAR
// cakupan Fase 14 ini, sesuai batasan tugas ("jangan mengerjakan sebagian
// fase berikutnya").
//
// `classes` diasumsikan sudah berisi daftar kelas target LENGKAP dan
// terurut (mengikuti `PreprocessedData::classes`, lihat `models/data.rs`:
// "Kelas target unik, terurut alfabetis") — sama seperti konvensi yang
// sudah dipakai `class_prior.rs`/`numerical_distribution.rs`/
// `categorical_distribution.rs` (parameter `classes: &[String]` dipercaya
// apa adanya, tidak di-sort ulang di sini).
//
// --- AGENTS.md §5.7 (Confusion Matrix) — keputusan basis persentase ------
//
// Kontrak hanya menyebut "tampilkan count, total (per baris/kolom dan
// grand total), dan persentase" tanpa menetapkan basis persentase secara
// eksplisit. Diputuskan EKSPLISIT di sini (bukan ditebak diam-diam):
// persentase per SEL dihitung terhadap GRAND TOTAL (`count / grand_total *
// 100`), BUKAN persentase per-baris (yang secara matematis identik dengan
// Recall per kelas, sudah dihitung terpisah di `ClassMetrics::recall` di
// bawah — memakai basis yang sama di kedua tempat akan jadi duplikasi
// definisi, bukan informasi baru). Ini didokumentasikan di sini sebagai
// keputusan terbuka untuk pemilik produk, BUKAN penyimpangan dari kontrak
// (kontrak memang tidak menetapkan basis pasti) — lihat laporan
// implementasi Fase 14 untuk detail.
//
// --- AGENTS.md §5.6 (Model Evaluation Metrics) — Cohen's Kappa -----------
//
// Instruksi tugas Fase 14 secara eksplisit mengoreksi ambiguitas draft
// awal: "Kappa HANYA overall, bukan per kelas". Modul ini SENGAJA hanya
// menyediakan `EvaluationMetrics::cohens_kappa: f64` (satu angka), TIDAK
// ADA kappa per kelas di `ClassMetrics` maupun struct lain di modul ini.
use std::collections::HashMap;

/// Confusion matrix multiclass: baris = actual (kelas sebenarnya), kolom =
/// predicted (kelas prediksi) — konvensi standar (AGENTS.md §5.7).
#[derive(Debug, Clone, PartialEq)]
pub struct ConfusionMatrix {
    /// Daftar kelas, urutan ini yang dipakai sebagai urutan baris & kolom
    /// matrix (index yang sama untuk baris dan kolom kelas yang sama).
    pub classes: Vec<String>,
    /// `matrix[actual_idx][predicted_idx]` = jumlah kasus.
    pub matrix: Vec<Vec<usize>>,
    /// Total per baris (jumlah kasus dengan actual = kelas ini).
    pub row_totals: Vec<usize>,
    /// Total per kolom (jumlah kasus dengan predicted = kelas ini).
    pub col_totals: Vec<usize>,
    /// Total keseluruhan kasus yang diikutkan dalam matrix ini.
    pub grand_total: usize,
    /// Persentase tiap sel terhadap `grand_total` (`matrix[i][j] /
    /// grand_total * 100`), sejajar bentuknya dengan `matrix`. `0.0` di
    /// setiap sel bila `grand_total == 0` (bukan NaN dari pembagian nol) —
    /// lihat catatan basis persentase di kepala file.
    pub percentages: Vec<Vec<f64>>,
}

/// Hitung confusion matrix dari sepasang label actual/predicted yang
/// sejajar index-nya (`actual[i]` berpasangan dengan `predicted[i]`).
/// Label yang tidak ada di `classes` (seharusnya tidak pernah terjadi pada
/// jalur normal — `predicted` selalu berasal dari `classes` yang sama,
/// AGENTS.md §3.2) diabaikan (tidak dihitung, tidak panic) sebagai
/// pengaman lapis kedua, konsisten dengan gaya defensif modul Fase 12/13.
pub fn compute_confusion_matrix(
    actual: &[String],
    predicted: &[String],
    classes: &[String],
) -> ConfusionMatrix {
    let n = classes.len();
    let index_of: HashMap<&str, usize> = classes
        .iter()
        .enumerate()
        .map(|(idx, class)| (class.as_str(), idx))
        .collect();

    let mut matrix = vec![vec![0usize; n]; n];

    for (actual_label, predicted_label) in actual.iter().zip(predicted.iter()) {
        if let (Some(&actual_idx), Some(&predicted_idx)) = (
            index_of.get(actual_label.as_str()),
            index_of.get(predicted_label.as_str()),
        ) {
            matrix[actual_idx][predicted_idx] += 1;
        }
    }

    let row_totals: Vec<usize> = matrix.iter().map(|row| row.iter().sum()).collect();
    let col_totals: Vec<usize> = (0..n)
        .map(|col| matrix.iter().map(|row| row[col]).sum())
        .collect();
    let grand_total: usize = row_totals.iter().sum();

    let percentages: Vec<Vec<f64>> = matrix
        .iter()
        .map(|row| {
            row.iter()
                .map(|&count| {
                    if grand_total > 0 {
                        100.0 * (count as f64) / (grand_total as f64)
                    } else {
                        0.0
                    }
                })
                .collect()
        })
        .collect();

    ConfusionMatrix {
        classes: classes.to_vec(),
        matrix,
        row_totals,
        col_totals,
        grand_total,
        percentages,
    }
}

/// Metrik evaluasi satu kelas (AGENTS.md §5.6), dihitung one-vs-rest dari
/// confusion matrix multiclass: kelas ini dianggap "positive", semua kelas
/// lain digabung jadi "negative".
#[derive(Debug, Clone, PartialEq)]
pub struct ClassMetrics {
    pub class: String,
    /// `(TP + TN) / grand_total` — accuracy dalam konteks one-vs-rest
    /// (AGENTS.md §5.6: "Accuracy (dalam konteks one-vs-rest jika
    /// relevan)"). `0.0` bila `grand_total == 0`.
    pub accuracy: f64,
    /// `TP / (TP + FP)`. `0.0` bila `TP + FP == 0` (kelas ini tidak pernah
    /// diprediksi sama sekali) — bukan NaN.
    pub precision: f64,
    /// `TP / (TP + FN)`, sama dengan `matrix[i][i] / row_totals[i]`. `0.0`
    /// bila `TP + FN == 0` (kelas ini tidak pernah muncul sebagai actual
    /// sama sekali).
    pub recall: f64,
    /// Harmonic mean precision & recall. `0.0` bila `precision + recall ==
    /// 0.0` (bukan NaN dari pembagian nol).
    pub f1: f64,
    /// Jumlah kasus actual berkelas ini (`row_totals[i]`) — dipakai sebagai
    /// bobot pada weighted average di bawah.
    pub support: usize,
}

/// Hitung `ClassMetrics` untuk setiap kelas di `confusion.classes`.
pub fn compute_per_class_metrics(confusion: &ConfusionMatrix) -> Vec<ClassMetrics> {
    let n = confusion.classes.len();
    let grand_total = confusion.grand_total as f64;

    (0..n)
        .map(|idx| {
            let tp = confusion.matrix[idx][idx] as f64;
            let fp = confusion.col_totals[idx] as f64 - tp;
            let fn_count = confusion.row_totals[idx] as f64 - tp;
            let tn = grand_total - tp - fp - fn_count;

            let accuracy = if grand_total > 0.0 {
                (tp + tn) / grand_total
            } else {
                0.0
            };
            let precision = if tp + fp > 0.0 { tp / (tp + fp) } else { 0.0 };
            let recall = if tp + fn_count > 0.0 {
                tp / (tp + fn_count)
            } else {
                0.0
            };
            let f1 = if precision + recall > 0.0 {
                2.0 * precision * recall / (precision + recall)
            } else {
                0.0
            };

            ClassMetrics {
                class: confusion.classes[idx].clone(),
                accuracy,
                precision,
                recall,
                f1,
                support: confusion.row_totals[idx],
            }
        })
        .collect()
}

/// Rata-rata precision/recall/F1 lintas kelas (macro, weighted, atau
/// micro — lihat fungsi masing-masing di bawah). AGENTS.md §5.6 tidak
/// meminta rata-rata accuracy terpisah (accuracy sudah direpresentasikan
/// sebagai "overall accuracy" tunggal, lihat `overall_accuracy`), jadi
/// struct ini sengaja tidak punya field accuracy.
#[derive(Debug, Clone, PartialEq)]
pub struct AverageMetrics {
    pub precision: f64,
    pub recall: f64,
    pub f1: f64,
}

/// Macro average: rata-rata TIDAK TERBOBOT dari precision/recall/F1 tiap
/// kelas (setiap kelas dihitung sama penting, terlepas dari jumlah
/// instance-nya).
pub fn macro_average(per_class: &[ClassMetrics]) -> AverageMetrics {
    let n = per_class.len() as f64;
    if n == 0.0 {
        return AverageMetrics {
            precision: 0.0,
            recall: 0.0,
            f1: 0.0,
        };
    }

    AverageMetrics {
        precision: per_class.iter().map(|c| c.precision).sum::<f64>() / n,
        recall: per_class.iter().map(|c| c.recall).sum::<f64>() / n,
        f1: per_class.iter().map(|c| c.f1).sum::<f64>() / n,
    }
}

/// Weighted average: rata-rata precision/recall/F1 tiap kelas, dibobot
/// dengan `support` (jumlah instance actual kelas itu) — kelas dengan
/// lebih banyak instance actual berkontribusi lebih besar.
pub fn weighted_average(per_class: &[ClassMetrics]) -> AverageMetrics {
    let total_support: usize = per_class.iter().map(|c| c.support).sum();
    if total_support == 0 {
        return AverageMetrics {
            precision: 0.0,
            recall: 0.0,
            f1: 0.0,
        };
    }

    let total_support = total_support as f64;
    AverageMetrics {
        precision: per_class
            .iter()
            .map(|c| c.precision * c.support as f64)
            .sum::<f64>()
            / total_support,
        recall: per_class
            .iter()
            .map(|c| c.recall * c.support as f64)
            .sum::<f64>()
            / total_support,
        f1: per_class
            .iter()
            .map(|c| c.f1 * c.support as f64)
            .sum::<f64>()
            / total_support,
    }
}

/// Micro average: precision/recall/F1 dihitung dari TP/FP/FN yang
/// DIJUMLAHKAN LEBIH DULU lintas seluruh kelas (bukan rata-rata dari
/// metrik per kelas yang sudah jadi). Catatan matematis: untuk confusion
/// matrix multiclass single-label seperti ini (setiap kasus punya TEPAT
/// SATU actual dan TEPAT SATU predicted), `sum(FP) == sum(FN) ==
/// grand_total - sum(TP)` secara aljabar, sehingga micro-precision ==
/// micro-recall == micro-F1 == overall accuracy — properti yang sudah
/// dikenal luas (bukan bug), diverifikasi lewat test di bawah.
pub fn micro_average(confusion: &ConfusionMatrix) -> AverageMetrics {
    let n = confusion.classes.len();

    let tp_sum: f64 = (0..n).map(|idx| confusion.matrix[idx][idx] as f64).sum();
    let fp_sum: f64 = (0..n)
        .map(|idx| confusion.col_totals[idx] as f64 - confusion.matrix[idx][idx] as f64)
        .sum();
    let fn_sum: f64 = (0..n)
        .map(|idx| confusion.row_totals[idx] as f64 - confusion.matrix[idx][idx] as f64)
        .sum();

    let precision = if tp_sum + fp_sum > 0.0 {
        tp_sum / (tp_sum + fp_sum)
    } else {
        0.0
    };
    let recall = if tp_sum + fn_sum > 0.0 {
        tp_sum / (tp_sum + fn_sum)
    } else {
        0.0
    };
    let f1 = if precision + recall > 0.0 {
        2.0 * precision * recall / (precision + recall)
    } else {
        0.0
    };

    AverageMetrics {
        precision,
        recall,
        f1,
    }
}

/// Overall accuracy: `sum(diagonal) / grand_total` — proporsi kasus yang
/// diprediksi tepat, lintas semua kelas (AGENTS.md §5.6). `0.0` bila
/// `grand_total == 0`.
pub fn overall_accuracy(confusion: &ConfusionMatrix) -> f64 {
    if confusion.grand_total == 0 {
        return 0.0;
    }

    let correct: usize = (0..confusion.classes.len())
        .map(|idx| confusion.matrix[idx][idx])
        .sum();

    correct as f64 / confusion.grand_total as f64
}

/// Cohen's Kappa — SATU angka overall (AGENTS.md §5.6, dikoreksi final
/// oleh instruksi tugas Fase 14: "Kappa HANYA overall, bukan per kelas").
/// Rumus standar: `kappa = (po - pe) / (1 - pe)`, dengan:
///   - `po` = observed agreement = overall accuracy.
///   - `pe` = expected agreement by chance = `sum_c (row_total_c *
///     col_total_c) / grand_total^2`.
/// Bila `pe == 1.0` (kasus degenerate, mis. hanya ada satu kelas efektif
/// di seluruh confusion matrix sehingga `po == pe == 1`), kappa tidak
/// terdefinisi secara matematis (`0/0`) — dikembalikan `0.0`, bukan NaN,
/// konsisten dengan gaya defensif modul lain di crate ini. Begitu pula
/// bila `grand_total == 0`.
pub fn cohens_kappa(confusion: &ConfusionMatrix) -> f64 {
    let n = confusion.grand_total as f64;
    if n == 0.0 {
        return 0.0;
    }

    let po = overall_accuracy(confusion);
    let pe: f64 = (0..confusion.classes.len())
        .map(|idx| {
            (confusion.row_totals[idx] as f64 / n) * (confusion.col_totals[idx] as f64 / n)
        })
        .sum();

    if (1.0 - pe).abs() < 1e-12 {
        return 0.0;
    }

    (po - pe) / (1.0 - pe)
}

/// Seluruh Model Evaluation Metrics (AGENTS.md §5.6) untuk satu confusion
/// matrix: metrik per kelas, tiga jenis rata-rata, overall accuracy, dan
/// Cohen's Kappa overall (HANYA satu angka, lihat catatan di kepala file).
#[derive(Debug, Clone, PartialEq)]
pub struct EvaluationMetrics {
    pub per_class: Vec<ClassMetrics>,
    pub macro_average: AverageMetrics,
    pub weighted_average: AverageMetrics,
    pub micro_average: AverageMetrics,
    pub overall_accuracy: f64,
    /// Cohen's Kappa overall — TIDAK ADA varian per kelas di mana pun
    /// dalam struct ini (koreksi final AGENTS.md §5.6 via instruksi tugas
    /// Fase 14).
    pub cohens_kappa: f64,
}

/// Titik masuk utama Fase 14: dari sepasang label actual/predicted (hasil
/// evaluasi holdout/k-fold, disiapkan pemanggil — lihat catatan di kepala
/// file) dan daftar kelas lengkap, hitung confusion matrix sekaligus
/// seluruh Model Evaluation Metrics dalam satu pemanggilan.
pub fn compute_evaluation_metrics(
    actual: &[String],
    predicted: &[String],
    classes: &[String],
) -> (ConfusionMatrix, EvaluationMetrics) {
    let confusion = compute_confusion_matrix(actual, predicted, classes);
    let per_class = compute_per_class_metrics(&confusion);
    let macro_avg = macro_average(&per_class);
    let weighted_avg = weighted_average(&per_class);
    let micro_avg = micro_average(&confusion);
    let accuracy = overall_accuracy(&confusion);
    let kappa = cohens_kappa(&confusion);

    (
        confusion,
        EvaluationMetrics {
            per_class,
            macro_average: macro_avg,
            weighted_average: weighted_avg,
            micro_average: micro_avg,
            overall_accuracy: accuracy,
            cohens_kappa: kappa,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    /// Dataset confusion matrix buatan tangan, 3 kelas seimbang (10
    /// instance/kelas, 30 total), dipilih supaya angka precision/recall/F1
    /// /kappa gampang dihitung tangan (PLAN.md Fase 14, "angka dibuat
    /// supaya ... gampang dihitung tangan"):
    ///
    ///            predicted A  B  C | actual total
    ///   actual A            10  0  0 | 10   (A selalu benar)
    ///   actual B             0  8  2 | 10   (2 salah ke C)
    ///   actual C             0  2  8 | 10   (2 salah ke B)
    ///
    /// Perhitungan manual (dicek lagi dengan Python `fractions.Fraction`
    /// murni, lihat laporan implementasi Fase 14):
    ///   col totals: A=10, B=10, C=10. grand_total=30.
    ///   Kelas A: TP=10 FP=0 FN=0 TN=20 -> precision=recall=f1=accuracy=1.0
    ///   Kelas B: TP=8  FP=2 FN=2 TN=18 -> precision=recall=f1=0.8,
    ///            accuracy=26/30=0.8666666666666667
    ///   Kelas C: sama seperti B (simetris).
    ///   macro/weighted average (support sama rata) = (1.0+0.8+0.8)/3
    ///            = 0.8666666666666667 untuk precision/recall/f1.
    ///   overall_accuracy = (10+8+8)/30 = 26/30 = 0.8666666666666667.
    ///   micro average == overall_accuracy (properti matematis, lihat
    ///            komentar `micro_average`).
    ///   Cohen's Kappa: po=26/30, pe = 3*(10/30)*(10/30) = 1/3.
    ///            kappa = (26/30 - 1/3) / (1 - 1/3) = (8/15)/(10/15) = 0.8.
    fn three_class_confusion() -> ConfusionMatrix {
        let mut actual = Vec::new();
        let mut predicted = Vec::new();

        // Kelas A: 10 benar.
        for _ in 0..10 {
            actual.push("A".to_string());
            predicted.push("A".to_string());
        }
        // Kelas B: 8 benar, 2 salah diprediksi C.
        for _ in 0..8 {
            actual.push("B".to_string());
            predicted.push("B".to_string());
        }
        for _ in 0..2 {
            actual.push("B".to_string());
            predicted.push("C".to_string());
        }
        // Kelas C: 8 benar, 2 salah diprediksi B.
        for _ in 0..8 {
            actual.push("C".to_string());
            predicted.push("C".to_string());
        }
        for _ in 0..2 {
            actual.push("C".to_string());
            predicted.push("B".to_string());
        }

        let classes = strings(&["A", "B", "C"]);
        compute_confusion_matrix(&actual, &predicted, &classes)
    }

    #[test]
    fn confusion_matrix_counts_totals_and_percentages_match_hand_calculation() {
        let cm = three_class_confusion();

        assert_eq!(cm.classes, strings(&["A", "B", "C"]));
        assert_eq!(cm.matrix, vec![vec![10, 0, 0], vec![0, 8, 2], vec![0, 2, 8]]);
        assert_eq!(cm.row_totals, vec![10, 10, 10]);
        assert_eq!(cm.col_totals, vec![10, 10, 10]);
        assert_eq!(cm.grand_total, 30);

        // Persentase per sel terhadap grand_total (keputusan basis di
        // kepala file): 10/30*100 = 33.333..., 8/30*100 = 26.666..., dst.
        assert!((cm.percentages[0][0] - (100.0 * 10.0 / 30.0)).abs() < 1e-9);
        assert!((cm.percentages[1][1] - (100.0 * 8.0 / 30.0)).abs() < 1e-9);
        assert!((cm.percentages[1][2] - (100.0 * 2.0 / 30.0)).abs() < 1e-9);
        assert!((cm.percentages[0][1] - 0.0).abs() < 1e-9);
    }

    #[test]
    fn per_class_metrics_match_hand_calculation() {
        let cm = three_class_confusion();
        let per_class = compute_per_class_metrics(&cm);

        let a = per_class.iter().find(|c| c.class == "A").unwrap();
        assert!((a.precision - 1.0).abs() < 1e-12);
        assert!((a.recall - 1.0).abs() < 1e-12);
        assert!((a.f1 - 1.0).abs() < 1e-12);
        assert!((a.accuracy - 1.0).abs() < 1e-12);
        assert_eq!(a.support, 10);

        let b = per_class.iter().find(|c| c.class == "B").unwrap();
        assert!((b.precision - 0.8).abs() < 1e-12);
        assert!((b.recall - 0.8).abs() < 1e-12);
        assert!((b.f1 - 0.8).abs() < 1e-12);
        assert!((b.accuracy - (26.0 / 30.0)).abs() < 1e-9);
        assert_eq!(b.support, 10);

        let c = per_class.iter().find(|c| c.class == "C").unwrap();
        assert!((c.precision - 0.8).abs() < 1e-12);
        assert!((c.recall - 0.8).abs() < 1e-12);
        assert!((c.f1 - 0.8).abs() < 1e-12);
    }

    #[test]
    fn macro_and_weighted_average_match_hand_calculation_when_support_is_balanced() {
        let cm = three_class_confusion();
        let per_class = compute_per_class_metrics(&cm);

        let macro_avg = macro_average(&per_class);
        let expected = (1.0 + 0.8 + 0.8) / 3.0;
        assert!((macro_avg.precision - expected).abs() < 1e-9);
        assert!((macro_avg.recall - expected).abs() < 1e-9);
        assert!((macro_avg.f1 - expected).abs() < 1e-9);

        // Support seimbang (10/10/10) -> weighted average harus identik
        // dengan macro average di kasus khusus ini.
        let weighted_avg = weighted_average(&per_class);
        assert!((weighted_avg.precision - macro_avg.precision).abs() < 1e-9);
        assert!((weighted_avg.recall - macro_avg.recall).abs() < 1e-9);
        assert!((weighted_avg.f1 - macro_avg.f1).abs() < 1e-9);
    }

    #[test]
    fn weighted_average_differs_from_macro_when_support_is_imbalanced() {
        // Kelas A dominan (support besar, precision/recall sempurna),
        // kelas B kecil (support kecil, precision/recall buruk) ->
        // weighted average harus condong ke performa kelas A, BEDA dari
        // macro average yang menganggap kedua kelas sama penting.
        let mut actual = Vec::new();
        let mut predicted = Vec::new();
        for _ in 0..90 {
            actual.push("A".to_string());
            predicted.push("A".to_string());
        }
        for _ in 0..10 {
            actual.push("B".to_string());
            predicted.push("A".to_string()); // seluruh B salah diprediksi A
        }

        let classes = strings(&["A", "B"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);
        let per_class = compute_per_class_metrics(&cm);

        let macro_avg = macro_average(&per_class);
        let weighted_avg = weighted_average(&per_class);

        assert!(weighted_avg.recall > macro_avg.recall);
        assert!(weighted_avg.precision > macro_avg.precision);
    }

    #[test]
    fn micro_average_equals_overall_accuracy_for_multiclass_single_label() {
        let cm = three_class_confusion();
        let micro_avg = micro_average(&cm);
        let accuracy = overall_accuracy(&cm);

        assert!((micro_avg.precision - accuracy).abs() < 1e-9);
        assert!((micro_avg.recall - accuracy).abs() < 1e-9);
        assert!((micro_avg.f1 - accuracy).abs() < 1e-9);
        assert!((accuracy - (26.0 / 30.0)).abs() < 1e-9);
    }

    #[test]
    fn cohens_kappa_matches_hand_calculation() {
        let cm = three_class_confusion();
        let kappa = cohens_kappa(&cm);

        // po=26/30, pe=1/3 -> kappa=(26/30 - 1/3)/(1 - 1/3) = 0.8 persis.
        assert!((kappa - 0.8).abs() < 1e-9);
    }

    #[test]
    fn cohens_kappa_is_one_for_perfect_agreement() {
        let mut actual = Vec::new();
        let mut predicted = Vec::new();
        for label in ["A", "B", "C"] {
            for _ in 0..5 {
                actual.push(label.to_string());
                predicted.push(label.to_string());
            }
        }
        let classes = strings(&["A", "B", "C"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);

        assert!((cohens_kappa(&cm) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn cohens_kappa_is_zero_when_predictions_match_only_by_chance_level() {
        // Prediksi selalu "A" untuk semua kasus, distribusi actual 50/50
        // A/B -> agreement observed = 0.5, TAPI expected agreement (pe)
        // untuk kasus degenerate ini (predicted_col_totals = [10, 0]) juga
        // 0.5, jadi kappa = (0.5-0.5)/(1-0.5) = 0.0 (bukan negatif),
        // menunjukkan model ini tidak lebih baik dari tebakan berbasis
        // distribusi actual/predicted yang terjadi.
        let mut actual = Vec::new();
        let mut predicted = Vec::new();
        for _ in 0..5 {
            actual.push("A".to_string());
            predicted.push("A".to_string());
        }
        for _ in 0..5 {
            actual.push("B".to_string());
            predicted.push("A".to_string());
        }
        let classes = strings(&["A", "B"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);

        assert!((cohens_kappa(&cm) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn cohens_kappa_is_zero_not_nan_when_only_one_effective_class() {
        // Semua kasus actual & predicted kelas yang sama -> pe = 1.0,
        // po = 1.0 -> kappa seharusnya 0/0 (tidak terdefinisi); modul ini
        // mengembalikan 0.0, bukan NaN.
        let actual = strings(&["A", "A", "A"]);
        let predicted = strings(&["A", "A", "A"]);
        let classes = strings(&["A"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);

        let kappa = cohens_kappa(&cm);
        assert!(!kappa.is_nan());
        assert_eq!(kappa, 0.0);
    }

    #[test]
    fn empty_input_produces_all_zero_metrics_without_panicking_or_nan() {
        let classes = strings(&["A", "B"]);
        let cm = compute_confusion_matrix(&[], &[], &classes);

        assert_eq!(cm.grand_total, 0);
        assert_eq!(cm.matrix, vec![vec![0, 0], vec![0, 0]]);

        let per_class = compute_per_class_metrics(&cm);
        for metrics in &per_class {
            assert_eq!(metrics.accuracy, 0.0);
            assert_eq!(metrics.precision, 0.0);
            assert_eq!(metrics.recall, 0.0);
            assert_eq!(metrics.f1, 0.0);
        }

        assert_eq!(overall_accuracy(&cm), 0.0);
        let kappa = cohens_kappa(&cm);
        assert!(!kappa.is_nan());
        assert_eq!(kappa, 0.0);

        let macro_avg = macro_average(&per_class);
        assert_eq!(macro_avg.precision, 0.0);
        let weighted_avg = weighted_average(&per_class);
        assert_eq!(weighted_avg.precision, 0.0);
        let micro_avg = micro_average(&cm);
        assert_eq!(micro_avg.precision, 0.0);
    }

    #[test]
    fn class_with_zero_support_does_not_panic_and_has_zero_recall() {
        // Kelas "C" ada di daftar `classes` tapi tidak pernah muncul
        // sebagai actual maupun predicted sama sekali (kasus valid: mis.
        // kelas langka yang kebetulan tidak terwakili di satu
        // holdout/fold tertentu, AGENTS.md §5.9 relevan untuk konteks
        // serupa di sisi prediksi).
        let actual = strings(&["A", "B"]);
        let predicted = strings(&["A", "B"]);
        let classes = strings(&["A", "B", "C"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);

        let per_class = compute_per_class_metrics(&cm);
        let c = per_class.iter().find(|m| m.class == "C").unwrap();
        assert_eq!(c.support, 0);
        assert_eq!(c.recall, 0.0);
        assert_eq!(c.precision, 0.0);
        assert_eq!(c.f1, 0.0);
        // TN=grand_total (2) untuk kelas C karena TP=FP=FN=0 -> accuracy=1.0
        assert!((c.accuracy - 1.0).abs() < 1e-12);

        // weighted_average tidak boleh panic walau kelas ini support=0
        // (tidak berkontribusi ke pembilang maupun penyebut).
        let weighted_avg = weighted_average(&per_class);
        assert!(!weighted_avg.precision.is_nan());
    }

    #[test]
    fn labels_outside_classes_list_are_ignored_without_panicking() {
        // Pengaman lapis kedua (seharusnya tidak terjadi pada jalur
        // normal): label yang tidak ada di `classes` diabaikan, bukan
        // panic karena index tidak ditemukan.
        let actual = strings(&["A", "UNKNOWN_CLASS"]);
        let predicted = strings(&["A", "A"]);
        let classes = strings(&["A", "B"]);
        let cm = compute_confusion_matrix(&actual, &predicted, &classes);

        // Hanya baris pertama ("A" -> "A") yang tercatat.
        assert_eq!(cm.grand_total, 1);
        assert_eq!(cm.matrix[0][0], 1);
    }

    #[test]
    fn compute_evaluation_metrics_wires_confusion_matrix_and_metrics_together() {
        let actual = strings(&[
            "A", "A", "A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B", "B",
            "B", "C", "C", "C", "C", "C", "C", "C", "C", "B", "B", "C", "C",
        ]);
        let predicted = strings(&[
            "A", "A", "A", "A", "A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B", "B",
            "B", "C", "C", "C", "C", "C", "C", "C", "C", "C", "C", "B", "B",
        ]);
        let classes = strings(&["A", "B", "C"]);

        let (confusion, metrics) = compute_evaluation_metrics(&actual, &predicted, &classes);

        assert_eq!(confusion.grand_total, 30);
        assert_eq!(metrics.per_class.len(), 3);
        assert!((metrics.overall_accuracy - (26.0 / 30.0)).abs() < 1e-9);
        assert!((metrics.cohens_kappa - 0.8).abs() < 1e-9);
        assert!(
            (metrics.micro_average.precision - metrics.overall_accuracy).abs() < 1e-9
        );
    }
}
