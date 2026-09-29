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
use super::numerical_distribution::{compute_all_gaussian_parameters, GaussianParams};

#[derive(Debug, Clone)]
pub struct TrainedModelParams {
    pub class_priors: ClassPriors,
    /// covariate name -> class -> Gaussian params.
    pub gaussian: HashMap<String, HashMap<String, GaussianParams>>,
    /// factor name -> distribusi kategorik (kategori + stat per kelas).
    pub categorical: HashMap<String, CategoricalDistribution>,
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
    }
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
