// naive-bayes/rust/src/stats/numerical_distribution.rs
//
// PLAN.md Fase 12 — parameter Gaussian (mean & variance) per covariate per
// kelas, dengan variance floor (AGENTS.md §5.1, §5.3).
//
// KEPUTUSAN (diselesaikan memakai konvensi yang umum dipakai — bukan lagi
// judgment call terbuka, lihat catatan pemilik produk di riwayat
// implementasi Fase 12):
//
// 1. Variance dihitung sebagai POPULATION variance (dibagi `n`, bukan
//    `n - 1`). AGENTS.md §5.1/§5.3 tidak menuliskan rumus varians secara
//    rinci; population variance dipakai karena itu konvensi standar
//    Gaussian Naive Bayes (persis seperti `scikit-learn GaussianNB`, yang
//    memakai `np.var` dengan `ddof=0`).
//
// 2. Kelas yang tidak punya SATU PUN observasi non-missing untuk suatu
//    covariate (edge case yang jarang terjadi — butuh SELURUH baris satu
//    kelas missing pada satu atribut sekaligus) memakai FALLBACK ke mean &
//    variance GLOBAL (dihitung dari seluruh `cases` yang diberikan untuk
//    covariate ini, lintas kelas), bukan `mean = 0.0` yang arbitrer.
//    Ini konvensi umum "backoff ke statistik marginal" ketika data
//    spesifik-kelas tidak tersedia — jauh lebih masuk akal secara
//    statistik daripada nilai konstan yang tidak berdasar. Bila bahkan
//    data global pun kosong (tidak ada satu pun observasi valid untuk
//    covariate ini di seluruh dataset — kasus yang jauh lebih degenerate
//    lagi), baru jatuh ke `mean = 0.0, variance = variance_floor`.
//
// Nilai `None` (missing) pada suatu covariate untuk suatu baris
// DIKECUALIKAN hanya dari perhitungan atribut itu untuk kelas terkait
// (AGENTS.md §5.4) — fungsi ini menerima `PreprocessedCase` yang sudah
// melalui preprocessing Fase 9, jadi tinggal memfilter `Some(v)` per kelas
// (dan, untuk fallback global, lintas kelas).
use std::collections::HashMap;

use crate::models::data::PreprocessedCase;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GaussianParams {
    pub mean: f64,
    /// Variance SETELAH variance floor diterapkan (AGENTS.md §5.3). Nilai
    /// mentah sebelum floor tidak disimpan terpisah karena tidak dipakai di
    /// luar modul ini — parameter ini langsung dipakai sebagai input rumus
    /// densitas Gaussian di Fase 13 (prediksi).
    pub variance: f64,
    /// Jumlah observasi non-missing yang DIPAKAI menghitung mean/variance
    /// ini. Kalau kelas ini jatuh ke fallback global (lihat komentar di
    /// atas), `n` adalah jumlah observasi GLOBAL yang dipakai (bukan 0),
    /// karena itulah observasi yang benar-benar dipakai.
    pub n: usize,
}

/// Hitung mean & variance (population variance) + floor dari satu
/// kumpulan nilai. Dipakai untuk kelas tertentu maupun untuk fallback
/// global (kumpulan nilai lintas kelas) — satu rumus yang sama.
fn mean_variance_with_floor(values: &[f64], variance_floor: f64) -> GaussianParams {
    let n = values.len();
    if n == 0 {
        return GaussianParams {
            mean: 0.0,
            variance: variance_floor,
            n: 0,
        };
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    let raw_variance = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n as f64;
    GaussianParams {
        mean,
        variance: raw_variance.max(variance_floor),
        n,
    }
}

/// Hitung mean & variance (dengan variance floor) untuk SATU covariate,
/// per kelas.
///
/// `variance_floor` diambil dari `OptionsConfig::variance_floor`
/// (AGENTS.md §5.3: konstan per run, terdokumentasi, bukan berubah-ubah per
/// atribut/kelas/dataset — nilainya sendiri didefinisikan sebagai konstanta
/// di sisi TypeScript, `NaiveBayesDefault.VarianceFloor = 1e-9`, dan
/// dikirim apa adanya lewat payload config; modul ini hanya memakainya
/// sebagai batas bawah, tidak mendefinisikan ulang nilainya).
pub fn compute_gaussian_parameters(
    cases: &[PreprocessedCase],
    classes: &[String],
    covariate_name: &str,
    variance_floor: f64,
) -> HashMap<String, GaussianParams> {
    let mut values_by_class: HashMap<&str, Vec<f64>> =
        classes.iter().map(|c| (c.as_str(), Vec::new())).collect();
    let mut all_values: Vec<f64> = Vec::new();

    for case in cases {
        if let Some(Some(value)) = case.covariates.get(covariate_name) {
            all_values.push(*value);
            values_by_class
                .entry(case.target_class.as_str())
                .or_default()
                .push(*value);
        }
    }

    // Fallback global dihitung sekali (lintas kelas), dipakai hanya oleh
    // kelas yang tidak punya observasi sendiri sama sekali.
    let global_fallback = mean_variance_with_floor(&all_values, variance_floor);

    classes
        .iter()
        .map(|class| {
            let values = values_by_class
                .get(class.as_str())
                .cloned()
                .unwrap_or_default();
            let params = if values.is_empty() {
                global_fallback
            } else {
                mean_variance_with_floor(&values, variance_floor)
            };
            (class.clone(), params)
        })
        .collect()
}

/// Hitung Gaussian parameters untuk SEMUA covariate sekaligus — dipakai
/// oleh `stats::training::train_naive_bayes_model`.
pub fn compute_all_gaussian_parameters(
    cases: &[PreprocessedCase],
    classes: &[String],
    covariate_names: &[String],
    variance_floor: f64,
) -> HashMap<String, HashMap<String, GaussianParams>> {
    covariate_names
        .iter()
        .map(|name| {
            (
                name.clone(),
                compute_gaussian_parameters(cases, classes, name, variance_floor),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn case_with_temp(target_class: &str, temp: Option<f64>) -> PreprocessedCase {
        let mut covariates = HashMap::new();
        covariates.insert("Temp".to_string(), temp);
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors: HashMap::new(),
            covariates,
        }
    }

    const VARIANCE_FLOOR: f64 = 1e-9;

    /// Dataset kecil buatan tangan (6 baris, 2 kelas), sama dengan yang
    /// dipakai `class_prior` dan `categorical_distribution` (satu dataset,
    /// dicek dari beberapa sudut). Pembanding dihitung terpisah dengan
    /// Python (population variance, `sum((v-mean)**2)/n`):
    ///   - Yes: Temp=[70,72,74] -> mean=72.0, variance=2.6666666666666665
    ///   - No:  Temp=[80,82,90] -> mean=84.0, variance=18.666666666666668
    fn six_row_dataset() -> Vec<PreprocessedCase> {
        vec![
            case_with_temp("Yes", Some(70.0)),
            case_with_temp("Yes", Some(72.0)),
            case_with_temp("Yes", Some(74.0)),
            case_with_temp("No", Some(80.0)),
            case_with_temp("No", Some(82.0)),
            case_with_temp("No", Some(90.0)),
        ]
    }

    #[test]
    fn mean_and_variance_match_manual_calculation() {
        let cases = six_row_dataset();
        let classes = vec!["No".to_string(), "Yes".to_string()];

        let result = compute_gaussian_parameters(&cases, &classes, "Temp", VARIANCE_FLOOR);

        let yes = result["Yes"];
        assert!((yes.mean - 72.0).abs() < 1e-9, "Yes mean = {}", yes.mean);
        assert!(
            (yes.variance - 2.6666666666666665).abs() < 1e-9,
            "Yes variance = {}",
            yes.variance
        );
        assert_eq!(yes.n, 3);

        let no = result["No"];
        assert!((no.mean - 84.0).abs() < 1e-9, "No mean = {}", no.mean);
        assert!(
            (no.variance - 18.666666666666668).abs() < 1e-9,
            "No variance = {}",
            no.variance
        );
        assert_eq!(no.n, 3);
    }

    #[test]
    fn missing_numeric_value_is_excluded_from_that_attribute_only() {
        let cases = vec![
            case_with_temp("A", Some(50.0)),
            case_with_temp("A", Some(50.0)),
            case_with_temp("A", Some(50.0)),
            case_with_temp("B", None),
            case_with_temp("B", Some(60.0)),
        ];
        let classes = vec!["A".to_string(), "B".to_string()];

        let result = compute_gaussian_parameters(&cases, &classes, "Temp", VARIANCE_FLOOR);

        let b = result["B"];
        assert_eq!(b.n, 1, "hanya satu observasi non-missing untuk kelas B");
        assert!((b.mean - 60.0).abs() < 1e-9);
    }

    #[test]
    fn zero_variance_is_floored_to_variance_floor() {
        let cases = vec![
            case_with_temp("A", Some(50.0)),
            case_with_temp("A", Some(50.0)),
            case_with_temp("A", Some(50.0)),
            case_with_temp("B", None),
            case_with_temp("B", Some(60.0)),
        ];
        let classes = vec!["A".to_string(), "B".to_string()];

        let result = compute_gaussian_parameters(&cases, &classes, "Temp", VARIANCE_FLOOR);

        assert_eq!(result["A"].variance, VARIANCE_FLOOR);
        assert_eq!(result["B"].variance, VARIANCE_FLOOR);
    }

    #[test]
    fn class_with_zero_non_missing_observations_and_no_global_data_falls_back_to_zero() {
        // Kasus paling degenerate: tidak ada SATU PUN observasi valid untuk
        // covariate ini di seluruh dataset (bukan cuma di kelas ini) ->
        // fallback global sendiri kosong -> mean=0.0, variance=floor.
        let cases = vec![case_with_temp("C", None), case_with_temp("C", None)];
        let classes = vec!["C".to_string()];

        let result = compute_gaussian_parameters(&cases, &classes, "Temp", VARIANCE_FLOOR);

        let c = result["C"];
        assert_eq!(c.n, 0);
        assert_eq!(c.mean, 0.0);
        assert_eq!(c.variance, VARIANCE_FLOOR);
    }

    #[test]
    fn class_absent_from_cases_falls_back_to_global_mean_and_variance() {
        // Pembanding manual (Python): global values = [10, 20, 100, 200]
        // (gabungan kelas A=[10,20] dan C=[100,200]; kelas B tidak punya
        // observasi sama sekali) -> global mean=82.5, variance=5818.75.
        // Kelas B harus memakai fallback ini, BUKAN mean=0.0.
        let cases = vec![
            case_with_temp("A", Some(10.0)),
            case_with_temp("A", Some(20.0)),
            case_with_temp("C", Some(100.0)),
            case_with_temp("C", Some(200.0)),
        ];
        let classes = vec!["A".to_string(), "B".to_string(), "C".to_string()];

        let result = compute_gaussian_parameters(&cases, &classes, "Temp", VARIANCE_FLOOR);

        let b = result["B"];
        assert_eq!(b.n, 4, "fallback memakai seluruh 4 observasi global");
        assert!((b.mean - 82.5).abs() < 1e-9, "B mean = {}", b.mean);
        assert!((b.variance - 5818.75).abs() < 1e-6, "B variance = {}", b.variance);

        // Kelas A & C tetap memakai statistik milik sendiri (tidak ikut
        // fallback), tidak terpengaruh oleh adanya kelas B yang kosong.
        assert!((result["A"].mean - 15.0).abs() < 1e-9);
        assert!((result["A"].variance - 25.0).abs() < 1e-9);
    }

    #[test]
    fn compute_all_covers_every_requested_covariate() {
        let cases = vec![
            {
                let mut c = case_with_temp("A", Some(10.0));
                c.covariates.insert("Humidity".to_string(), Some(80.0));
                c
            },
            {
                let mut c = case_with_temp("A", Some(20.0));
                c.covariates.insert("Humidity".to_string(), Some(90.0));
                c
            },
        ];
        let classes = vec!["A".to_string()];
        let covariate_names = vec!["Temp".to_string(), "Humidity".to_string()];

        let result = compute_all_gaussian_parameters(&cases, &classes, &covariate_names, VARIANCE_FLOOR);

        assert!(result.contains_key("Temp"));
        assert!(result.contains_key("Humidity"));
        assert!((result["Humidity"]["A"].mean - 85.0).abs() < 1e-9);
    }
}
