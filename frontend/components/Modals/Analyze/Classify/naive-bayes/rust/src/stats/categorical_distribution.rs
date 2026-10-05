// naive-bayes/rust/src/stats/categorical_distribution.rs
//
// PLAN.md Fase 12 — frekuensi kategori per kelas + Laplace smoothing untuk
// atribut kategorik (factor), AGENTS.md §5.2, §5.8, §5.9.
//
// Rumus (AGENTS.md §5.2/§5.8, dikutip persis):
//   probability = (count + alpha) / (class_total + alpha * jumlah_kategori)
//
// Definisi tiap suku, diputuskan eksplisit di sini karena AGENTS.md
// menuliskan rumusnya tapi tidak merinci "class_total" dan "jumlah_kategori"
// dihitung dari populasi mana persis:
//   - `class_total` = jumlah baris berkelas tsb dalam `cases` yang
//     diberikan. Berbeda dengan covariate (yang bisa mengecualikan baris
//     ber-missing per atribut, AGENTS.md §5.4), factor TIDAK PERNAH
//     mengecualikan baris: nilai missing sudah diberi kategori "(Missing)"
//     sejak preprocessing (Fase 9), jadi setiap baris kelas tsb PASTI
//     tercatat pada TEPAT SATU kategori atribut ini. Karena itu
//     `class_total` di sini selalu sama dengan jumlah baris kelas tsb di
//     `cases`, tanpa pengecualian.
//   - `jumlah_kategori` = banyak kategori UNIK yang dikenal untuk atribut
//     ini dari SELURUH `cases` yang diberikan (lintas kelas, bukan hanya
//     kategori yang muncul di kelas tsb). KEPUTUSAN INI SUDAH FINAL,
//     mengikuti konvensi umum Laplace/Categorical smoothing (persis
//     seperti `scikit-learn CategoricalNB`, yang juga memakai jumlah
//     kategori GLOBAL per fitur, bukan per kelas) — penting juga untuk
//     konsistensi dengan AGENTS.md §5.9 (kategori tak dikenal pada
//     evaluasi tetap dapat probabilitas kecil lewat smoothing memakai
//     `jumlah_kategori` yang SAMA dari training). Kalau dihitung per-kelas,
//     penyebutnya akan beda-beda antar kelas dan tidak konsisten dipakai
//     lagi saat scoring kategori yang tidak muncul di suatu kelas tertentu
//     (padahal dikenal di kelas lain).
use std::collections::{BTreeSet, HashMap};

use crate::models::data::PreprocessedCase;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CategoryStat {
    pub raw_count: usize,
    /// `raw_count + alpha`.
    pub smoothed_count: f64,
    /// `smoothed_count / (class_total + alpha * jumlah_kategori)`.
    pub probability: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CategoricalDistribution {
    /// Kategori unik untuk atribut ini, terurut alfabetis (determinisme
    /// tabel — sama pola dengan `PreprocessedData::classes`). Termasuk
    /// `"(Missing)"` bila kategori itu muncul di `cases`.
    pub categories: Vec<String>,
    /// class -> category -> stat. Setiap kelas di `classes` (parameter
    /// input) dan setiap kategori di `categories` dijamin punya entri,
    /// termasuk kombinasi yang raw_count-nya 0 (AGENTS.md §5.9: kategori
    /// tak dikenal/tidak pernah muncul di kelas tsb tetap dapat probability
    /// kecil lewat smoothing, bukan hilang dari tabel).
    pub per_class: HashMap<String, HashMap<String, CategoryStat>>,
}

pub fn compute_categorical_distribution(
    cases: &[PreprocessedCase],
    classes: &[String],
    factor_name: &str,
    alpha: f64,
) -> CategoricalDistribution {
    let categories: Vec<String> = cases
        .iter()
        .filter_map(|c| c.factors.get(factor_name).cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let num_categories = categories.len() as f64;

    let mut class_totals: HashMap<&str, usize> =
        classes.iter().map(|c| (c.as_str(), 0usize)).collect();
    let mut raw_counts: HashMap<(&str, &str), usize> = HashMap::new();

    for case in cases {
        if let Some(category) = case.factors.get(factor_name) {
            *class_totals.entry(case.target_class.as_str()).or_insert(0) += 1;
            *raw_counts
                .entry((case.target_class.as_str(), category.as_str()))
                .or_insert(0) += 1;
        }
    }

    let mut per_class: HashMap<String, HashMap<String, CategoryStat>> = HashMap::new();
    for class in classes {
        let class_total = *class_totals.get(class.as_str()).unwrap_or(&0) as f64;
        let denom = class_total + alpha * num_categories;

        let mut stats: HashMap<String, CategoryStat> = HashMap::new();
        for category in &categories {
            let raw_count = *raw_counts
                .get(&(class.as_str(), category.as_str()))
                .unwrap_or(&0);
            let smoothed_count = raw_count as f64 + alpha;
            // `denom` hanya 0 bila `class_total == 0` DAN `num_categories == 0`
            // (tidak ada kategori sama sekali di training) — kasus degenerate
            // yang seharusnya sudah dicegah di lapisan validasi form (predictor
            // efektif tidak boleh kosong). Dijaga di sini juga supaya tidak
            // menghasilkan NaN/Inf kalau tetap terjadi.
            let probability = if denom > 0.0 {
                smoothed_count / denom
            } else {
                0.0
            };
            stats.insert(
                category.clone(),
                CategoryStat {
                    raw_count,
                    smoothed_count,
                    probability,
                },
            );
        }
        per_class.insert(class.clone(), stats);
    }

    CategoricalDistribution {
        categories,
        per_class,
    }
}

/// Hitung distribusi kategorik untuk SEMUA factor sekaligus — dipakai oleh
/// `stats::training::train_naive_bayes_model`.
pub fn compute_all_categorical_distributions(
    cases: &[PreprocessedCase],
    classes: &[String],
    factor_names: &[String],
    alpha: f64,
) -> HashMap<String, CategoricalDistribution> {
    factor_names
        .iter()
        .map(|name| {
            (
                name.clone(),
                compute_categorical_distribution(cases, classes, name, alpha),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case_with_outlook(target_class: &str, outlook: &str) -> PreprocessedCase {
        let mut factors = HashMap::new();
        factors.insert("Outlook".to_string(), outlook.to_string());
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors,
            covariates: HashMap::new(),
        }
    }

    /// Dataset kecil buatan tangan (6 baris, 2 kelas), sama dengan yang
    /// dipakai `class_prior` dan `numerical_distribution`. Pembanding
    /// dihitung terpisah dengan Python, alpha = 1:
    ///
    /// categories = ["Overcast", "Rain", "Sunny"], num_categories = 3.
    /// Class Yes (class_total=3): Sunny raw=2 prob=0.5; Rain raw=1
    ///   prob=0.3333333333333333; Overcast raw=0 prob=0.16666666666666666.
    /// Class No (class_total=3): Sunny raw=1 prob=0.3333333333333333;
    ///   Overcast raw=2 prob=0.5; Rain raw=0 prob=0.16666666666666666.
    fn six_row_dataset() -> Vec<PreprocessedCase> {
        vec![
            case_with_outlook("Yes", "Sunny"),
            case_with_outlook("Yes", "Sunny"),
            case_with_outlook("Yes", "Rain"),
            case_with_outlook("No", "Sunny"),
            case_with_outlook("No", "Overcast"),
            case_with_outlook("No", "Overcast"),
        ]
    }

    #[test]
    fn smoothed_probabilities_match_manual_calculation() {
        let cases = six_row_dataset();
        let classes = vec!["No".to_string(), "Yes".to_string()];

        let result = compute_categorical_distribution(&cases, &classes, "Outlook", 1.0);

        assert_eq!(
            result.categories,
            vec![
                "Overcast".to_string(),
                "Rain".to_string(),
                "Sunny".to_string()
            ]
        );

        let yes = &result.per_class["Yes"];
        assert_eq!(yes["Sunny"].raw_count, 2);
        assert_eq!(yes["Sunny"].smoothed_count, 3.0);
        assert!((yes["Sunny"].probability - 0.5).abs() < 1e-12);

        assert_eq!(yes["Rain"].raw_count, 1);
        assert!((yes["Rain"].probability - 0.3333333333333333).abs() < 1e-12);

        // Kategori dengan raw_count 0 di kelas ini tetap dapat probabilitas
        // kecil lewat smoothing (AGENTS.md §5.9), bukan 0 atau hilang.
        assert_eq!(yes["Overcast"].raw_count, 0);
        assert_eq!(yes["Overcast"].smoothed_count, 1.0);
        assert!((yes["Overcast"].probability - 0.16666666666666666).abs() < 1e-12);

        let no = &result.per_class["No"];
        assert_eq!(no["Sunny"].raw_count, 1);
        assert!((no["Sunny"].probability - 0.3333333333333333).abs() < 1e-12);
        assert_eq!(no["Overcast"].raw_count, 2);
        assert!((no["Overcast"].probability - 0.5).abs() < 1e-12);
        assert_eq!(no["Rain"].raw_count, 0);
        assert!((no["Rain"].probability - 0.16666666666666666).abs() < 1e-12);

        // Setiap probability per kelas harus berjumlah 1 (properti dasar
        // distribusi kategorik dengan smoothing yang benar).
        let sum_yes: f64 = yes.values().map(|s| s.probability).sum();
        let sum_no: f64 = no.values().map(|s| s.probability).sum();
        assert!((sum_yes - 1.0).abs() < 1e-9);
        assert!((sum_no - 1.0).abs() < 1e-9);
    }

    #[test]
    fn missing_category_is_treated_as_an_ordinary_category() {
        // Pembanding manual (Python): categories = ["(Missing)", "X", "Y"],
        // num_categories = 3, alpha = 1.
        // Class A (class_total=3): (Missing) raw=1 prob=0.3333333333333333;
        //   X raw=2 prob=0.5; Y raw=0 prob=0.16666666666666666.
        // Class B (class_total=2): (Missing) raw=0 prob=0.2; X raw=1
        //   prob=0.4; Y raw=1 prob=0.4.
        let cases = vec![
            case_with_outlook("A", "(Missing)"),
            case_with_outlook("A", "X"),
            case_with_outlook("A", "X"),
            case_with_outlook("B", "X"),
            case_with_outlook("B", "Y"),
        ];
        let classes = vec!["A".to_string(), "B".to_string()];

        let result = compute_categorical_distribution(&cases, &classes, "Outlook", 1.0);

        assert_eq!(
            result.categories,
            vec!["(Missing)".to_string(), "X".to_string(), "Y".to_string()]
        );

        let a = &result.per_class["A"];
        assert_eq!(a["(Missing)"].raw_count, 1);
        assert!((a["(Missing)"].probability - 0.3333333333333333).abs() < 1e-12);
        assert!((a["X"].probability - 0.5).abs() < 1e-12);
        assert!((a["Y"].probability - 0.16666666666666666).abs() < 1e-12);

        let b = &result.per_class["B"];
        assert_eq!(b["(Missing)"].raw_count, 0);
        assert!((b["(Missing)"].probability - 0.2).abs() < 1e-12);
        assert!((b["X"].probability - 0.4).abs() < 1e-12);
        assert!((b["Y"].probability - 0.4).abs() < 1e-12);
    }

    #[test]
    fn class_absent_from_cases_still_gets_uniform_smoothed_distribution() {
        // Kelas "Z" tidak muncul sama sekali di cases -> class_total=0,
        // sehingga tiap kategori dapat probability seragam
        // alpha / (alpha * num_categories) = 1/num_categories.
        let cases = vec![
            case_with_outlook("Yes", "Sunny"),
            case_with_outlook("Yes", "Rain"),
        ];
        let classes = vec!["Yes".to_string(), "Z".to_string()];

        let result = compute_categorical_distribution(&cases, &classes, "Outlook", 1.0);

        let z = &result.per_class["Z"];
        for stat in z.values() {
            assert_eq!(stat.raw_count, 0);
            assert!((stat.probability - 0.5).abs() < 1e-12); // 1/2 categories
        }
    }

    #[test]
    fn alpha_changes_smoothing_strength_but_probabilities_still_sum_to_one() {
        let cases = six_row_dataset();
        let classes = vec!["No".to_string(), "Yes".to_string()];

        let result = compute_categorical_distribution(&cases, &classes, "Outlook", 0.5);

        let yes = &result.per_class["Yes"];
        // class_total=3, num_categories=3, alpha=0.5 -> denom=3+1.5=4.5
        // Sunny: raw=2 -> smoothed=2.5 -> prob=2.5/4.5
        assert!((yes["Sunny"].probability - (2.5 / 4.5)).abs() < 1e-12);

        let sum: f64 = yes.values().map(|s| s.probability).sum();
        assert!((sum - 1.0).abs() < 1e-9);
    }

    #[test]
    fn compute_all_covers_every_requested_factor() {
        let cases = vec![
            {
                let mut c = case_with_outlook("A", "Sunny");
                c.factors.insert("Humidity".to_string(), "High".to_string());
                c
            },
            {
                let mut c = case_with_outlook("A", "Rain");
                c.factors.insert("Humidity".to_string(), "Low".to_string());
                c
            },
        ];
        let classes = vec!["A".to_string()];
        let factor_names = vec!["Outlook".to_string(), "Humidity".to_string()];

        let result = compute_all_categorical_distributions(&cases, &classes, &factor_names, 1.0);

        assert!(result.contains_key("Outlook"));
        assert!(result.contains_key("Humidity"));
    }
}
