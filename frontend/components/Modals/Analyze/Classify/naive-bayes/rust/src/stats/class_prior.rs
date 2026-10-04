// naive-bayes/rust/src/stats/class_prior.rs
//
// PLAN.md Fase 12 — "Training model: prior kelas, parameter Gaussian
// (covariate), frekuensi + smoothing (factor)".
//
// Prior kelas = proporsi baris dalam SET CASES YANG DIBERIKAN yang berlabel
// kelas tsb, `P(class) = count(class) / n` — definisi standar Naive Bayes
// (AGENTS.md §5.1 menyebut "log class prior" tanpa menuliskan rumus
// eksplisit, ini rumus baku yang dipakai).
//
// Fungsi ini murni menghitung dari `cases` yang diberikan oleh pemanggil —
// TIDAK tahu (dan tidak perlu tahu) apakah itu seluruh dataset (retrain
// final, AGENTS.md §5.5) atau subset training pada satu holdout/fold
// tertentu. Pemisahan tanggung jawab ini sengaja supaya modul ini bisa
// dipakai ulang persis sama di kedua skenario (Fase 15/16).
use std::collections::HashMap;

use crate::models::data::PreprocessedCase;

#[derive(Debug, Clone, PartialEq)]
pub struct ClassPriors {
    /// Jumlah baris `cases` per kelas. Setiap kelas di `classes` (parameter
    /// input) dijamin punya entri di sini, termasuk yang hitungannya 0 —
    /// supaya kelas yang kebetulan tidak muncul di subset training kecil
    /// tidak hilang diam-diam dari hasil (penting untuk Fase 13 prediksi &
    /// Fase 15 Attribute Distribution Table, yang butuh daftar kelas
    /// lengkap dan konsisten).
    pub class_counts: HashMap<String, usize>,
    /// `count(class) / total_cases`. Bila `cases` kosong, seluruh prior
    /// 0.0 (bukan NaN dari pembagian oleh nol).
    pub priors: HashMap<String, f64>,
}

pub fn compute_class_priors(cases: &[PreprocessedCase], classes: &[String]) -> ClassPriors {
    let mut class_counts: HashMap<String, usize> =
        classes.iter().map(|c| (c.clone(), 0usize)).collect();

    for case in cases {
        *class_counts.entry(case.target_class.clone()).or_insert(0) += 1;
    }

    let total = cases.len() as f64;
    let priors: HashMap<String, f64> = class_counts
        .iter()
        .map(|(class, &count)| {
            let prior = if total > 0.0 { count as f64 / total } else { 0.0 };
            (class.clone(), prior)
        })
        .collect();

    ClassPriors {
        class_counts,
        priors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case(target_class: &str) -> PreprocessedCase {
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors: HashMap::new(),
            covariates: HashMap::new(),
        }
    }

    /// Dataset kecil buatan tangan (6 baris, 2 kelas seimbang), dipakai
    /// juga oleh `numerical_distribution` dan `categorical_distribution`
    /// (lihat komentar di file-file itu) supaya satu dataset yang sama bisa
    /// dicek ulang dari beberapa sudut. Perhitungan pembanding dijalankan
    /// terpisah dengan Python (`python3` biasa, tanpa dependency eksternal)
    /// dan hasilnya cocok persis dengan assert di bawah — lihat laporan
    /// implementasi Fase 12.
    fn six_row_dataset_classes_only() -> Vec<PreprocessedCase> {
        vec![
            case("Yes"),
            case("Yes"),
            case("Yes"),
            case("No"),
            case("No"),
            case("No"),
        ]
    }

    #[test]
    fn priors_match_manual_calculation_for_balanced_dataset() {
        let cases = six_row_dataset_classes_only();
        let classes = vec!["No".to_string(), "Yes".to_string()];

        let result = compute_class_priors(&cases, &classes);

        // Perhitungan manual (Python): No: count=3, prior=0.5; Yes:
        // count=3, prior=0.5.
        assert_eq!(result.class_counts.get("Yes"), Some(&3));
        assert_eq!(result.class_counts.get("No"), Some(&3));
        assert!((result.priors["Yes"] - 0.5).abs() < 1e-12);
        assert!((result.priors["No"] - 0.5).abs() < 1e-12);
    }

    #[test]
    fn class_absent_from_cases_still_appears_with_zero_prior() {
        let cases = vec![case("Yes"), case("Yes")];
        let classes = vec!["No".to_string(), "Yes".to_string()];

        let result = compute_class_priors(&cases, &classes);

        assert_eq!(result.class_counts.get("No"), Some(&0));
        assert_eq!(result.priors.get("No"), Some(&0.0));
        assert!((result.priors["Yes"] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn empty_cases_gives_zero_priors_without_panicking() {
        let cases: Vec<PreprocessedCase> = vec![];
        let classes = vec!["A".to_string(), "B".to_string()];

        let result = compute_class_priors(&cases, &classes);

        assert_eq!(result.priors["A"], 0.0);
        assert_eq!(result.priors["B"], 0.0);
    }
}
