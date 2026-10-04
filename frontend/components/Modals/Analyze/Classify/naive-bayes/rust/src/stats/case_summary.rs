// naive-bayes/rust/src/stats/case_summary.rs
//
// PLAN.md Fase 15 — "Attribute Distribution Table & Case Processing
// Summary". Bagian ini: Case Processing Summary (AGENTS.md §5.4, kalimat
// terakhir):
//
//   "Case Processing Summary melaporkan: jumlah instance total, jumlah
//   valid, jumlah/rincian yang terpengaruh missing value (setidaknya
//   jumlah baris yang dibuang karena target missing), variabel target,
//   daftar variabel atribut, dan skenario pengujian yang dipakai (holdout
//   split atau k-fold, beserta parameternya)."
//
// Modul ini murni membaca `PreprocessedData` (hasil Fase 9) dan
// `ValidationConfig` (payload config, `models/config.rs`) — tidak
// menjalankan preprocessing atau partition apa pun sendiri, dan TIDAK
// tahu (tidak perlu tahu) apakah run ini nantinya dievaluasi lewat holdout
// atau k-fold aktual; ia hanya melaporkan *skenario yang dikonfigurasi*
// apa adanya dari `ValidationConfig`.
//
// --- Field `ValidationConfig::training_percentage` (diperbaiki Fase 18) -
//
// Sebelumnya field payload ini bernama `holdout_percent` dan diperlakukan
// sebagai persentase HOLDOUT apa adanya, padahal label UI di
// `dialogs/validation.tsx` menampilkan teks "Training Percentage:" -
// inkonsistensi ini dicatat sebagai "CATATAN TERBUKA" sejak Fase 15, lalu
// dikonfirmasi sebagai bug nyata pada regresi Fase 18 (Temuan 1).
// Perbaikannya: field payload di-rename total menjadi `training_percentage`
// (sisi TS: `NaiveBayesValidationType.TrainingPercentage`, default 70
// sesuai AGENTS.md §4.2) dan sekarang benar-benar berisi persentase
// TRAINING apa adanya. Modul ini menurunkan
// `holdout_percentage = 100 - training_percentage` untuk pelaporan Case
// Processing Summary — arah derivasinya dibalik dari sebelumnya.
use crate::models::config::ValidationConfig;
use crate::models::data::PreprocessedData;

/// Skenario validasi yang dikonfigurasi untuk run ini (AGENTS.md §5.4).
/// Field yang tidak relevan dengan `method` aktif diisi `None` (mis.
/// `folds`/`training_percentage`/`holdout_percentage` untuk method
/// `"kfold"`), bukan angka default yang membingungkan.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidationScenario {
    /// `"holdout"` atau `"kfold"`, disalin apa adanya dari
    /// `ValidationConfig::validation_method`.
    pub method: String,
    pub training_percentage: Option<f64>,
    pub holdout_percentage: Option<f64>,
    pub folds: Option<i32>,
    /// `Some(seed)` bila `SetSeed`/`RandomSeed` diaktifkan pengguna,
    /// `None` bila tidak (AGENTS.md §4.2).
    pub seed: Option<i64>,
}

/// Case Processing Summary lengkap (AGENTS.md §5.4).
#[derive(Debug, Clone, PartialEq)]
pub struct CaseProcessingSummary {
    /// Jumlah instance total SEBELUM missing-value handling apa pun
    /// (`PreprocessedData::total_instances`).
    pub total_instances: usize,
    /// Jumlah instance valid SETELAH listwise deletion untuk target missing
    /// (`total_instances - excluded_target_missing`, sama dengan
    /// `PreprocessedData::cases.len()`).
    pub valid_instances: usize,
    /// Jumlah baris yang dibuang karena target missing (AGENTS.md §5.4:
    /// "setidaknya jumlah baris yang dibuang karena target missing").
    pub excluded_target_missing: usize,
    pub target_variable: String,
    /// Daftar variabel atribut (predictor) yang dipakai, urutan mengikuti
    /// payload asli (`PreprocessedData::predictor_order`) — konsisten
    /// dengan urutan yang nanti dipakai Attribute Distribution Table
    /// (`attribute_distribution.rs`) dan `feature_order` ekspor model
    /// (AGENTS.md §5.10).
    pub attribute_variables: Vec<String>,
    pub validation_scenario: ValidationScenario,
}

/// Bangun Case Processing Summary dari hasil preprocessing (Fase 9) dan
/// konfigurasi validasi yang dikirim pengguna. Fungsi ini TIDAK
/// menjalankan partition/training apa pun — murni merangkum angka yang
/// sudah tersedia di `preprocessed` dan `validation_config` apa adanya.
pub fn compute_case_processing_summary(
    preprocessed: &PreprocessedData,
    validation_config: &ValidationConfig,
) -> CaseProcessingSummary {
    let validation_scenario = match validation_config.validation_method.as_str() {
        "kfold" => ValidationScenario {
            method: "kfold".to_string(),
            training_percentage: None,
            holdout_percentage: None,
            folds: Some(validation_config.k_folds),
            seed: validation_config.random_seed,
        },
        // Default ke "holdout" untuk nilai method yang tidak dikenal
        // (pengaman lapis kedua — seharusnya sudah dibatasi ke
        // "holdout" | "kfold" oleh tipe TS, AGENTS.md §4.2), bukan panic
        // atau melaporkan skenario kosong.
        _ => {
            let training_percentage = validation_config.training_percentage;
            let holdout_percentage = 100.0 - training_percentage;
            ValidationScenario {
                method: "holdout".to_string(),
                training_percentage: Some(training_percentage),
                holdout_percentage: Some(holdout_percentage),
                folds: None,
                seed: validation_config.random_seed,
            }
        }
    };

    let attribute_variables: Vec<String> = preprocessed
        .predictor_order
        .iter()
        .map(|(name, _)| name.clone())
        .collect();

    CaseProcessingSummary {
        total_instances: preprocessed.total_instances,
        valid_instances: preprocessed.cases.len(),
        excluded_target_missing: preprocessed.excluded_target_missing,
        target_variable: preprocessed.target_variable.clone(),
        attribute_variables,
        validation_scenario,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data::{PredictorRole, PreprocessedCase};
    use std::collections::HashMap;

    fn validation_config(
        method: &str,
        training_percentage: f64,
        k_folds: i32,
        random_seed: Option<i64>,
    ) -> ValidationConfig {
        ValidationConfig {
            validation_method: method.to_string(),
            training_percentage,
            k_folds,
            random_seed,
        }
    }

    fn preprocessed_with(
        total_instances: usize,
        excluded_target_missing: usize,
        n_valid_cases: usize,
    ) -> PreprocessedData {
        let cases: Vec<PreprocessedCase> = (0..n_valid_cases)
            .map(|i| PreprocessedCase {
                target_class: if i % 2 == 0 { "A" } else { "B" }.to_string(),
                factors: HashMap::new(),
                covariates: HashMap::new(),
            })
            .collect();

        PreprocessedData {
            total_instances,
            excluded_target_missing,
            target_variable: "Species".to_string(),
            predictor_order: vec![
                ("SoilType".to_string(), PredictorRole::Factor),
                ("PetalLength".to_string(), PredictorRole::Covariate),
                ("PetalWidth".to_string(), PredictorRole::Covariate),
            ],
            factor_names: vec!["SoilType".to_string()],
            covariate_names: vec!["PetalLength".to_string(), "PetalWidth".to_string()],
            classes: vec!["A".to_string(), "B".to_string()],
            cases,
        }
    }

    #[test]
    fn reports_total_valid_and_excluded_counts_matching_preprocessing() {
        // 150 instance total, 2 dibuang karena target missing -> 148 valid.
        let preprocessed = preprocessed_with(150, 2, 148);
        let validation_config = validation_config("holdout", 30.0, 10, Some(12345));

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.total_instances, 150);
        assert_eq!(summary.valid_instances, 148);
        assert_eq!(summary.excluded_target_missing, 2);
        assert_eq!(summary.target_variable, "Species");
    }

    #[test]
    fn attribute_variables_follow_predictor_order_regardless_of_factor_or_covariate() {
        let preprocessed = preprocessed_with(10, 0, 10);
        let validation_config = validation_config("holdout", 30.0, 10, None);

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(
            summary.attribute_variables,
            vec![
                "SoilType".to_string(),
                "PetalLength".to_string(),
                "PetalWidth".to_string()
            ]
        );
    }

    #[test]
    fn holdout_scenario_reports_holdout_as_complement_of_configured_training_percentage() {
        // training_percentage = 70 (Fase 18 Temuan 1: field ini sekarang
        // benar-benar persentase training) -> holdout_percentage harus 30.
        let preprocessed = preprocessed_with(100, 0, 100);
        let validation_config = validation_config("holdout", 70.0, 10, Some(2000000));

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.validation_scenario.method, "holdout");
        assert_eq!(summary.validation_scenario.training_percentage, Some(70.0));
        assert_eq!(summary.validation_scenario.holdout_percentage, Some(30.0));
        assert_eq!(summary.validation_scenario.folds, None);
        assert_eq!(summary.validation_scenario.seed, Some(2000000));
    }

    #[test]
    fn kfold_scenario_reports_folds_and_seed_without_holdout_fields() {
        let preprocessed = preprocessed_with(100, 0, 100);
        let validation_config = validation_config("kfold", 30.0, 10, Some(42));

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.validation_scenario.method, "kfold");
        assert_eq!(summary.validation_scenario.folds, Some(10));
        assert_eq!(summary.validation_scenario.seed, Some(42));
        assert_eq!(summary.validation_scenario.training_percentage, None);
        assert_eq!(summary.validation_scenario.holdout_percentage, None);
    }

    #[test]
    fn seed_is_none_when_set_seed_is_not_enabled() {
        let preprocessed = preprocessed_with(20, 0, 20);
        let validation_config = validation_config("holdout", 30.0, 10, None);

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.validation_scenario.seed, None);
    }

    #[test]
    fn zero_excluded_target_missing_means_valid_equals_total() {
        let preprocessed = preprocessed_with(50, 0, 50);
        let validation_config = validation_config("holdout", 30.0, 10, None);

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.total_instances, summary.valid_instances);
        assert_eq!(summary.excluded_target_missing, 0);
    }

    #[test]
    fn unrecognized_validation_method_defaults_to_holdout_scenario_as_safety_net() {
        // Pengaman lapis kedua: nilai method yang bukan "holdout"/"kfold"
        // seharusnya tidak pernah terjadi (dibatasi tipe TS), tapi modul
        // ini tidak boleh panic bila tetap terjadi.
        let preprocessed = preprocessed_with(10, 0, 10);
        let validation_config = validation_config("unexpected", 25.0, 5, None);

        let summary = compute_case_processing_summary(&preprocessed, &validation_config);

        assert_eq!(summary.validation_scenario.method, "holdout");
        assert_eq!(summary.validation_scenario.training_percentage, Some(25.0));
        assert_eq!(summary.validation_scenario.holdout_percentage, Some(75.0));
    }
}
