// naive-bayes/rust/src/stats/training.rs
//
// PLAN.md Fase 12 — titik gabung dari class_prior, numerical_distribution,
// dan categorical_distribution menjadi satu "model terlatih" (parameter
// mentah, bukan struktur ekspor JSON final — itu tanggung jawab
// `stats::save` di Fase 16, AGENTS.md §5.10).
//
// Fungsi ini sengaja TIDAK tahu apa pun soal partition/k-fold (Fase
// 10/11) atau retrain-final-vs-evaluasi (AGENTS.md §5.5) — pemanggil di
// Fase 13-16 yang menentukan `cases` mana yang dikirim ke sini (subset
// training satu fold/holdout untuk evaluasi, atau seluruh dataset untuk
// model final yang diekspor/dilaporkan).
use std::collections::HashMap;

use crate::models::data::PreprocessedCase;

use super::categorical_distribution::{
    compute_all_categorical_distributions, CategoricalDistribution,
};
use super::class_prior::{compute_class_priors, ClassPriors};
use super::numerical_distribution::{
    compute_all_gaussian_parameters, compute_all_gaussian_parameters_with_spec, GaussianParams,
    NumericLikelihoodSpec,
};
use super::text_features::{train_text_model, TextTrainInput, TrainedTextModel};

#[derive(Debug, Clone)]
pub struct TrainedModelParams {
    pub class_priors: ClassPriors,
    /// covariate name -> class -> Gaussian params.
    pub gaussian: HashMap<String, HashMap<String, GaussianParams>>,
    /// factor name -> distribusi kategorik (kategori + stat per kelas).
    pub categorical: HashMap<String, CategoricalDistribution>,
    /// Fase N3a (AGENTS_V2 §8): parameter Text (jalur `vector`) dari
    /// `CORE::nb_text` + nama term. `None` untuk model setara v1.
    pub text: Option<TrainedTextModel>,
    /// Fase N3a: `min_var` Gaussian min-std per covariate (HANYA atribut
    /// ber-`gaussian_minstd`; atribut Gaussian biasa tidak punya entri).
    /// Variance di `gaussian` sudah mencakup min-std dan floor.
    pub numeric_min_variance: HashMap<String, f64>,
}

/// Latih satu model Naive Bayes campuran dari `cases` yang diberikan:
/// prior kelas (class_prior.rs), parameter Gaussian per covariate
/// (numerical_distribution.rs), dan distribusi kategorik + smoothing per
/// factor (categorical_distribution.rs) — sesuai judul Fase 12 di PLAN.md.
///
/// `alpha` hanya dipakai untuk factor (AGENTS.md §5.2: "tidak diterapkan
/// pada atribut numerik"); `variance_floor` hanya dipakai untuk covariate
/// (AGENTS.md §5.3). Tidak ada langkah lain di sini (tidak ada prediksi,
/// tidak ada metrik) — itu Fase 13/14.
pub fn train_naive_bayes_model(
    cases: &[PreprocessedCase],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
) -> TrainedModelParams {
    TrainedModelParams {
        class_priors: compute_class_priors(cases, classes),
        gaussian: compute_all_gaussian_parameters(cases, classes, covariate_names, variance_floor),
        categorical: compute_all_categorical_distributions(cases, classes, factor_names, alpha),
        text: None,
        numeric_min_variance: HashMap::new(),
    }
}

/// Fase N3a (PLAN_V2): padanan `train_naive_bayes_model` untuk konfigurasi v2 —
/// likelihood Numeric per atribut (`gaussian` / `gaussian_minstd`) dan,
/// opsional, fitur Text jalur `vector` lewat `CORE::nb_text` (AGENTS_V2 §6).
///
/// `text.x` HARUS sejajar dengan `cases`. `alpha` hanya untuk factor
/// (Categorical); alpha Text ada di `text.alpha` dan divalidasi
/// (`0 < alpha <= 999`) SEBELUM `nb_text::train`. Tanpa `text` dan dengan
/// `numeric` Gaussian biasa, hasilnya identik dengan `train_naive_bayes_model`
/// (diuji di `text_features::tests::v2_tanpa_text_dan_gaussian_biasa_sama_dengan_v1`).
#[allow(clippy::too_many_arguments)]
pub fn train_naive_bayes_model_v2(
    cases: &[PreprocessedCase],
    classes: &[String],
    factor_names: &[String],
    covariate_names: &[String],
    alpha: f64,
    variance_floor: f64,
    numeric: &NumericLikelihoodSpec,
    text: Option<&TextTrainInput<'_>>,
) -> Result<TrainedModelParams, String> {
    let text_model = match text {
        Some(input) => Some(train_text_model(cases, classes, input)?),
        None => None,
    };
    let (gaussian, numeric_min_variance) = compute_all_gaussian_parameters_with_spec(
        cases,
        classes,
        covariate_names,
        variance_floor,
        numeric,
    );

    Ok(TrainedModelParams {
        class_priors: compute_class_priors(cases, classes),
        gaussian,
        categorical: compute_all_categorical_distributions(cases, classes, factor_names, alpha),
        text: text_model,
        numeric_min_variance,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    fn case(target_class: &str, outlook: &str, temp: f64) -> PreprocessedCase {
        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), outlook.to_string());
        let mut covariates = StdHashMap::new();
        covariates.insert("Temp".to_string(), Some(temp));
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors,
            covariates,
        }
    }

    /// Integrasi Fase 12: dataset kecil buatan tangan (6 baris, 2 kelas, 1
    /// factor "Outlook", 1 covariate "Temp") — SAMA PERSIS dengan dataset
    /// yang dicek terpisah di `class_prior`, `numerical_distribution`, dan
    /// `categorical_distribution`, sekaligus dicocokkan lagi dengan
    /// perhitungan manual Python di sini untuk memastikan ketiganya
    /// terhubung benar lewat satu pemanggilan `train_naive_bayes_model`.
    ///
    /// Perhitungan manual (Python, lihat laporan implementasi Fase 12):
    ///   class_priors: Yes=0.5, No=0.5
    ///   Gaussian Temp: Yes mean=72.0 var=2.6666666666666665;
    ///                  No  mean=84.0 var=18.666666666666668
    ///   Categorical Outlook (alpha=1): Yes Sunny=0.5, Rain=0.3333.., Overcast=0.1666..;
    ///                                  No  Sunny=0.3333.., Overcast=0.5, Rain=0.1666..
    #[test]
    fn training_combines_priors_gaussian_and_categorical_correctly() {
        let cases = vec![
            case("Yes", "Sunny", 70.0),
            case("Yes", "Sunny", 72.0),
            case("Yes", "Rain", 74.0),
            case("No", "Sunny", 80.0),
            case("No", "Overcast", 82.0),
            case("No", "Overcast", 90.0),
        ];
        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let model = train_naive_bayes_model(
            &cases,
            &classes,
            &factor_names,
            &covariate_names,
            1.0,
            1e-9,
        );

        // Class priors.
        assert!((model.class_priors.priors["Yes"] - 0.5).abs() < 1e-12);
        assert!((model.class_priors.priors["No"] - 0.5).abs() < 1e-12);

        // Gaussian (Temp).
        let temp = &model.gaussian["Temp"];
        assert!((temp["Yes"].mean - 72.0).abs() < 1e-9);
        assert!((temp["Yes"].variance - 2.6666666666666665).abs() < 1e-9);
        assert!((temp["No"].mean - 84.0).abs() < 1e-9);
        assert!((temp["No"].variance - 18.666666666666668).abs() < 1e-9);

        // Categorical (Outlook).
        let outlook = &model.categorical["Outlook"];
        assert!((outlook.per_class["Yes"]["Sunny"].probability - 0.5).abs() < 1e-12);
        assert!(
            (outlook.per_class["Yes"]["Rain"].probability - 0.3333333333333333).abs() < 1e-12
        );
        assert!(
            (outlook.per_class["Yes"]["Overcast"].probability - 0.16666666666666666).abs()
                < 1e-12
        );
        assert!((outlook.per_class["No"]["Overcast"].probability - 0.5).abs() < 1e-12);
        assert!(
            (outlook.per_class["No"]["Sunny"].probability - 0.3333333333333333).abs() < 1e-12
        );
        assert!(
            (outlook.per_class["No"]["Rain"].probability - 0.16666666666666666).abs() < 1e-12
        );
    }

    #[test]
    fn alpha_is_never_applied_to_gaussian_parameters() {
        // AGENTS.md §5.2: smoothing alpha HANYA berlaku untuk atribut
        // kategorik. Jalankan training dengan dua nilai alpha berbeda dan
        // pastikan parameter Gaussian tidak berubah sama sekali.
        let cases = vec![
            case("Yes", "Sunny", 70.0),
            case("Yes", "Sunny", 72.0),
            case("No", "Overcast", 82.0),
            case("No", "Overcast", 90.0),
        ];
        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let model_alpha_1 =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);
        let model_alpha_5 = train_naive_bayes_model(
            &cases,
            &classes,
            &factor_names,
            &covariate_names,
            5.0,
            1e-9,
        );

        assert_eq!(
            model_alpha_1.gaussian["Temp"]["Yes"].mean,
            model_alpha_5.gaussian["Temp"]["Yes"].mean
        );
        assert_eq!(
            model_alpha_1.gaussian["Temp"]["Yes"].variance,
            model_alpha_5.gaussian["Temp"]["Yes"].variance
        );

        // Sebaliknya, distribusi kategorik HARUS berubah mengikuti alpha.
        assert_ne!(
            model_alpha_1.categorical["Outlook"].per_class["Yes"]["Sunny"].probability,
            model_alpha_5.categorical["Outlook"].per_class["Yes"]["Sunny"].probability
        );
    }
}

#[cfg(test)]
mod tests_n3a {
    use super::*;
    use crate::models::config::NumericLikelihood;
    use std::collections::HashMap as StdHashMap;

    fn case_x(target_class: &str, x: f64) -> PreprocessedCase {
        let mut covariates = StdHashMap::new();
        covariates.insert("x".to_string(), Some(x));
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors: StdHashMap::new(),
            covariates,
        }
    }

    fn golden_cases() -> Vec<PreprocessedCase> {
        vec![
            case_x("A", 1.0),
            case_x("A", 1.0),
            case_x("A", 1.0),
            case_x("B", 3.0),
            case_x("B", 5.0),
        ]
    }

    #[test]
    fn v2_gaussian_minstd_mengisi_min_variance_dan_variance_setelah_min_std() {
        let classes = vec!["A".to_string(), "B".to_string()];
        let names = vec!["x".to_string()];
        let spec = NumericLikelihoodSpec {
            default: NumericLikelihood::GaussianMinstd,
            overrides: StdHashMap::new(),
        };

        let model = train_naive_bayes_model_v2(
            &golden_cases(),
            &classes,
            &[],
            &names,
            1.0,
            1e-9,
            &spec,
            None,
        )
        .expect("pelatihan min-std");

        assert!((model.numeric_min_variance["x"] - 0.111111).abs() < 1e-6);
        assert!((model.gaussian["x"]["A"].variance - 0.111111).abs() < 1e-6);
        assert!((model.gaussian["x"]["B"].variance - 1.0).abs() < 1e-12);
        assert!(model.text.is_none());
    }

    #[test]
    fn model_v1_tidak_punya_text_dan_min_variance() {
        let classes = vec!["A".to_string(), "B".to_string()];
        let names = vec!["x".to_string()];
        let model =
            train_naive_bayes_model(&golden_cases(), &classes, &[], &names, 1.0, 1e-9);
        assert!(model.text.is_none());
        assert!(model.numeric_min_variance.is_empty());
        // Floor v1 tetap berlaku untuk Gaussian biasa.
        assert!((model.gaussian["x"]["A"].variance - 1e-9).abs() < 1e-18);
    }
}
