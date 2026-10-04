// naive-bayes/rust/src/stats/save.rs
//
// PLAN.md Fase 16 item 1 — "Retrain model final, serialisasi JSON export".
//
// AGENTS.md §5.5 (titik paling gampang salah, ditegaskan ulang di kepala
// `stats/attribute_distribution.rs` Fase 15): model yang diekspor WAJIB
// hasil retrain di SELURUH dataset SETELAH proses validasi (holdout/k-fold)
// selesai dipakai murni untuk mengukur performa — bukan model dari satu
// fold/holdout tertentu. `retrain_final_model` di bawah TIDAK menerima
// parameter fold/subset apa pun (hanya `PreprocessedData` lengkap), sengaja
// supaya tidak ada jalan bagi kode ini untuk diam-diam dipanggil dengan
// subset data — sama pola dengan `attribute_distribution.rs` Fase 15.
// Pemanggil (`wasm::function::run_analysis`, Fase 16 item 2) yang
// bertanggung jawab memastikan model evaluasi (dipakai Model Evaluation
// Metrics/Confusion Matrix) dan model final di sini adalah DUA hasil
// training yang terpisah.
//
// `build_exported_model` menyerialisasi model final itu ke struktur JSON
// sesuai skema AGENTS.md §5.10 — NAMA FIELD DIJAGA PERSIS seperti yang
// didaftarkan di sana (dan seperti yang sudah dipakai sisi TypeScript sejak
// Fase 7/8, lihat `NaiveBayesTrainedModelRaw` di
// `naive-bayes-analysis-formatter.ts` serta stub
// `services/__fixtures__/naive-bayes-stub-result.json`): `schema_version`,
// `model_type`, `trained_at`, `target` (`name`/`classes`/`class_priors`),
// `features` (`name`/`role`/parameter distribusi), `smoothing_alpha`,
// `variance_floor`, `feature_order`, `label_mapping`, `validation_config`,
// `missing_value_policy`, `unseen_category_policy` — TIDAK ADA field yang
// diganti nama walau terasa lebih rapi secara teknis, karena ini kontrak
// file yang mungkin dipakai ulang pengguna (instruksi tugas Fase 16).
use std::collections::HashMap;

use serde::Serialize;

use crate::models::config::{NaiveBayesConfig, ValidationConfig};
use crate::models::data::{PredictorRole, PreprocessedData};

use super::training::{train_naive_bayes_model, TrainedModelParams};

/// Deskripsi kebijakan missing-value (AGENTS.md §5.4), ditulis sebagai
/// metadata self-describing di file export (AGENTS.md §5.10: "developer
/// disarankan tetap mendokumentasikan hal ini secara terlihat oleh
/// pengguna"). Kebijakan ini FIXED (bukan dikonfigurasi pengguna — tab
/// Options hanya mengekspos `SmoothingAlpha`, AGENTS.md §4.1), jadi
/// deskripsinya konstan, bukan diturunkan dari
/// `OptionsConfig::missing_value_policy` (field itu sendiri nilainya
/// selalu `"exclude"` dari sisi TS, sekadar penanda internal — lihat
/// `constants/naive-bayes-default.ts` — bukan teks deskriptif untuk
/// pengguna akhir).
const MISSING_VALUE_POLICY_DESCRIPTION: &str = "Kategorik missing dianggap kategori '(Missing)'; numerik missing dikecualikan per-atribut untuk kelas terkait; target missing dibuang (listwise).";

/// Deskripsi kebijakan kategori tak dikenal (AGENTS.md §5.9), sama
/// alasannya dengan konstanta di atas (fixed, bukan dikonfigurasi
/// pengguna).
const UNSEEN_CATEGORY_POLICY_DESCRIPTION: &str = "Kategori tak dikenal pada evaluasi diberi probabilitas kecil melalui smoothing, bukan error.";

/// Skenario validasi apa adanya dari config (bentuk field sama persis
/// dengan `stats::case_summary::ValidationScenario` — didefinisikan
/// terpisah di sini, BUKAN dengan mengimpor/menambah `derive(Serialize)`
/// pada struct `case_summary.rs`, supaya file itu — bagian Fase 15 yang
/// sudah selesai & lulus test — tidak perlu disentuh sama sekali oleh
/// Fase 16 ini. Sedikit duplikasi logika kecil ini adalah trade-off
/// eksplisit untuk menjaga batas file per fase, dicatat di laporan
/// implementasi.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportValidationConfig {
    pub method: String,
    pub training_percentage: Option<f64>,
    pub holdout_percentage: Option<f64>,
    pub folds: Option<i32>,
    pub seed: Option<i64>,
}

/// Bangun `ExportValidationConfig` dari `ValidationConfig` payload —
/// logika identik `case_summary::compute_case_processing_summary`. Field
/// `ValidationConfig::training_percentage` (di-rename dari `holdout_percent`
/// pada perbaikan Fase 18 Temuan 1 — lihat catatan di kepala
/// `case_summary.rs`) diperlakukan APA ADANYA sebagai persentase training,
/// `holdout_percentage = 100 - training_percentage`.
pub fn export_validation_config(validation: &ValidationConfig) -> ExportValidationConfig {
    match validation.validation_method.as_str() {
        "kfold" => ExportValidationConfig {
            method: "kfold".to_string(),
            training_percentage: None,
            holdout_percentage: None,
            folds: Some(validation.k_folds),
            seed: validation.random_seed,
        },
        _ => {
            let training_percentage = validation.training_percentage;
            let holdout_percentage = 100.0 - training_percentage;
            ExportValidationConfig {
                method: "holdout".to_string(),
                training_percentage: Some(training_percentage),
                holdout_percentage: Some(holdout_percentage),
                folds: None,
                seed: validation.random_seed,
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportTarget {
    pub name: String,
    pub classes: Vec<String>,
    /// Sejajar index dengan `classes` (bukan map) — sesuai bentuk
    /// `NaiveBayesTrainedModelRaw::target::class_priors: number[]` di sisi
    /// TS.
    pub class_priors: Vec<f64>,
    /// AGENTS.md NB §5.10 schema 1.1 — dipakai Apply Model untuk kategori tak
    /// dikenal (§5.9). Jumlah baris training per kelas, sejajar index dengan
    /// `classes` (0 bila kelas tidak ada di `model.class_priors.class_counts`).
    pub class_counts: Vec<u64>,
}

/// Satu entri `features` (AGENTS.md §5.10: "daftar atribut dengan `name`,
/// `role` (`"categorical" | "numerical"`), dan parameter distribusinya").
/// `#[serde(untagged)]` supaya tiap varian serialize sebagai object JSON
/// polos (tanpa wrapper tag tambahan) — konsisten dengan bentuk union
/// `NaiveBayesCategoricalAttribute | NaiveBayesNumericalAttribute` di sisi
/// TS.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum ExportFeature {
    Categorical {
        name: String,
        role: &'static str,
        categories: Vec<String>,
        /// class -> probabilitas per kategori (urutan sejajar
        /// `categories`), sudah termasuk hasil smoothing (AGENTS.md
        /// §5.10: "termasuk hasil smoothing").
        distribution: HashMap<String, Vec<f64>>,
        /// AGENTS.md NB §5.10 schema 1.1 — dipakai Apply Model untuk kategori
        /// tak dikenal (§5.9). class -> Σ `raw_count` kelas itu pada fitur ini
        /// (0 bila fitur/kelas tidak ada di model).
        class_totals: HashMap<String, u64>,
    },
    Numerical {
        name: String,
        role: &'static str,
        mean: HashMap<String, f64>,
        variance: HashMap<String, f64>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExportedModel {
    pub schema_version: String,
    pub model_type: String,
    pub trained_at: String,
    pub target: ExportTarget,
    pub features: Vec<ExportFeature>,
    pub smoothing_alpha: f64,
    pub variance_floor: f64,
    /// Urutan fitur yang dipakai model (AGENTS.md §5.10: "untuk
    /// konsistensi bila model dipakai ulang") — SAMA dengan urutan
    /// `PreprocessedData::predictor_order` (urutan payload asli), juga
    /// dipakai `attribute_distribution.rs` Fase 15 untuk urutan baris
    /// tabel.
    pub feature_order: Vec<String>,
    /// class -> index (0-based, urutan `classes` yang sama dipakai di
    /// seluruh modul lain — alfabetis, `PreprocessedData::classes`).
    pub label_mapping: HashMap<String, i32>,
    pub validation_config: ExportValidationConfig,
    pub missing_value_policy: String,
    pub unseen_category_policy: String,
}

/// Retrain model Naive Bayes di SELURUH `preprocessed.cases` (AGENTS.md
/// §5.5) — dipanggil terpisah dari model(-model) yang dipakai evaluasi
/// holdout/k-fold di `wasm::function::run_analysis`. Fungsi ini sengaja
/// TIDAK menerima subset/fold apa pun sebagai parameter.
pub fn retrain_final_model(
    preprocessed: &PreprocessedData,
    config: &NaiveBayesConfig,
) -> TrainedModelParams {
    train_naive_bayes_model(
        &preprocessed.cases,
        &preprocessed.classes,
        &preprocessed.factor_names,
        &preprocessed.covariate_names,
        config.options.smoothing_alpha,
        config.options.variance_floor,
    )
}

/// Serialisasi model final (`retrain_final_model`) menjadi `ExportedModel`
/// sesuai skema AGENTS.md §5.10.
pub fn build_exported_model(
    preprocessed: &PreprocessedData,
    model: &TrainedModelParams,
    config: &NaiveBayesConfig,
) -> ExportedModel {
    let classes = &preprocessed.classes;

    let class_priors: Vec<f64> = classes
        .iter()
        .map(|class| *model.class_priors.priors.get(class).unwrap_or(&0.0))
        .collect();

    let class_counts: Vec<u64> = classes
        .iter()
        .map(|class| {
            model
                .class_priors
                .class_counts
                .get(class)
                .copied()
                .unwrap_or(0) as u64
        })
        .collect();

    let features: Vec<ExportFeature> = preprocessed
        .predictor_order
        .iter()
        .map(|(name, role)| build_export_feature(name, *role, model, classes))
        .collect();

    let label_mapping: HashMap<String, i32> = classes
        .iter()
        .enumerate()
        .map(|(idx, class)| (class.clone(), idx as i32))
        .collect();

    let feature_order: Vec<String> = preprocessed
        .predictor_order
        .iter()
        .map(|(name, _)| name.clone())
        .collect();

    ExportedModel {
        schema_version: "1.1".to_string(),
        model_type: "naive_bayes".to_string(),
        trained_at: now_iso8601(),
        target: ExportTarget {
            name: preprocessed.target_variable.clone(),
            classes: classes.clone(),
            class_priors,
            class_counts,
        },
        features,
        smoothing_alpha: config.options.smoothing_alpha,
        variance_floor: config.options.variance_floor,
        feature_order,
        label_mapping,
        validation_config: export_validation_config(&config.validation),
        missing_value_policy: MISSING_VALUE_POLICY_DESCRIPTION.to_string(),
        unseen_category_policy: UNSEEN_CATEGORY_POLICY_DESCRIPTION.to_string(),
    }
}

fn build_export_feature(
    name: &str,
    role: PredictorRole,
    model: &TrainedModelParams,
    classes: &[String],
) -> ExportFeature {
    match role {
        PredictorRole::Factor => {
            let distribution_source = model.categorical.get(name);
            let categories: Vec<String> = distribution_source
                .map(|dist| dist.categories.clone())
                .unwrap_or_default();

            let distribution: HashMap<String, Vec<f64>> = classes
                .iter()
                .map(|class| {
                    let probabilities = categories
                        .iter()
                        .map(|category| {
                            distribution_source
                                .and_then(|dist| dist.per_class.get(class))
                                .and_then(|per_class| per_class.get(category))
                                .map(|stat| stat.probability)
                                .unwrap_or(0.0)
                        })
                        .collect();
                    (class.clone(), probabilities)
                })
                .collect();

            let class_totals: HashMap<String, u64> = classes
                .iter()
                .map(|class| {
                    let total: usize = distribution_source
                        .and_then(|dist| dist.per_class.get(class))
                        .map(|per_class| per_class.values().map(|stat| stat.raw_count).sum())
                        .unwrap_or(0);
                    (class.clone(), total as u64)
                })
                .collect();

            ExportFeature::Categorical {
                name: name.to_string(),
                role: "categorical",
                categories,
                distribution,
                class_totals,
            }
        }
        PredictorRole::Covariate => {
            let params_source = model.gaussian.get(name);

            let mean: HashMap<String, f64> = classes
                .iter()
                .map(|class| {
                    let value = params_source
                        .and_then(|per_class| per_class.get(class))
                        .map(|params| params.mean)
                        .unwrap_or(0.0);
                    (class.clone(), value)
                })
                .collect();

            let variance: HashMap<String, f64> = classes
                .iter()
                .map(|class| {
                    let value = params_source
                        .and_then(|per_class| per_class.get(class))
                        .map(|params| params.variance)
                        .unwrap_or(0.0);
                    (class.clone(), value)
                })
                .collect();

            ExportFeature::Numerical {
                name: name.to_string(),
                role: "numerical",
                mean,
                variance,
            }
        }
    }
}

/// Timestamp ISO 8601 UTC untuk `trained_at`. Mengikuti pola
/// `#[cfg(target_arch = "wasm32")]` yang SUDAH dipakai
/// `mersenne_twister.rs` (Fase 10) untuk sumber entropi: di build wasm32
/// (produksi lewat `wasm-pack`) memakai `js_sys::Date` (js-sys SUDAH jadi
/// dependency sejak Fase 8, TIDAK menambah dependency baru); di build
/// native (`cargo test`) memakai `std::time::SystemTime` + konversi
/// hari->tanggal manual (`civil_from_days`, algoritma Howard Hinnant, kode
/// publik domain, ditulis langsung di sini) — supaya crate ini TIDAK perlu
/// menambah dependency `chrono` (AGENTS.md §7 / batasan tugas: hindari
/// dependency baru tanpa alasan kuat) hanya untuk format timestamp yang
/// notabene hanya bernilai metadata.
#[cfg(target_arch = "wasm32")]
fn now_iso8601() -> String {
    js_sys::Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_seconds = duration.as_secs() as i64;
    let millis = duration.subsec_millis();

    let days = total_seconds.div_euclid(86400);
    let secs_of_day = total_seconds.rem_euclid(86400);
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, month, day, hour, minute, second, millis
    )
}

/// Konversi "hari sejak 1970-01-01" ke (tahun, bulan, hari) kalender
/// Gregorian proleptik — algoritma "civil_from_days" Howard Hinnant
/// (public domain, banyak direproduksi mis. di implementasi `<chrono>`
/// C++ standar), dipilih supaya `now_iso8601` di target native tidak perlu
/// dependency eksternal.
#[cfg(not(target_arch = "wasm32"))]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data::PreprocessedCase;
    use std::collections::HashMap as StdHashMap;

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn civil_from_days_matches_known_reference_dates() {
        // Epoch Unix: 1970-01-01.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2000-03-01 adalah hari ke-11017 sejak epoch (nilai referensi
        // yang umum dipakai untuk menguji algoritma Hinnant).
        assert_eq!(civil_from_days(11017), (2000, 3, 1));
        // 2024-02-29 (tahun kabisat) -> 1969-12-31 + N; dicek lewat
        // round-trip kasar: hari berikutnya harus 2024-03-01.
        // (19782 dihitung manual dari (2024-1970)*365 + leap days s.d.
        // 2024-02-29 = 19782.)
        assert_eq!(civil_from_days(19782), (2024, 2, 29));
        assert_eq!(civil_from_days(19783), (2024, 3, 1));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn now_iso8601_produces_well_formed_timestamp() {
        let ts = now_iso8601();
        // Format tetap: YYYY-MM-DDTHH:MM:SS.mmmZ (24 karakter).
        assert_eq!(ts.len(), 24);
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[7], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert!(ts.ends_with('Z'));
    }

    fn preprocessed_fixture() -> (PreprocessedData, TrainedModelParams) {
        let mut factors1 = StdHashMap::new();
        factors1.insert("Outlook".to_string(), "Sunny".to_string());
        let mut covariates1 = StdHashMap::new();
        covariates1.insert("Temp".to_string(), Some(70.0));

        let mut factors2 = StdHashMap::new();
        factors2.insert("Outlook".to_string(), "Rain".to_string());
        let mut covariates2 = StdHashMap::new();
        covariates2.insert("Temp".to_string(), Some(85.0));

        let cases = vec![
            PreprocessedCase {
                target_class: "Yes".to_string(),
                factors: factors1,
                covariates: covariates1,
            },
            PreprocessedCase {
                target_class: "No".to_string(),
                factors: factors2,
                covariates: covariates2,
            },
        ];

        let classes = vec!["No".to_string(), "Yes".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let preprocessed = PreprocessedData {
            total_instances: 2,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("Outlook".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ],
            factor_names: factor_names.clone(),
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };

        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        (preprocessed, model)
    }

    /// AGENTS.md §5.10: field inti WAJIB ada dan namanya dijaga stabil.
    /// Test ini menegaskan `build_exported_model` menghasilkan seluruh
    /// field itu, dengan bentuk yang sejajar dengan `class_priors`/
    /// `label_mapping`/`feature_order` (bukan hanya "ada", tapi konsisten
    /// urutan/isinya satu sama lain).
    #[test]
    fn exported_model_contains_all_required_fields_with_consistent_shape() {
        let (preprocessed, model) = preprocessed_fixture();
        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                // Fase 18 Temuan 1: field ini sekarang benar-benar
                // TrainingPercentage (dulu keliru diisi sebagai holdout%).
                // 70 di sini -> holdout_percentage turunan = 30 (lihat
                // assert di bawah), sama seperti sebelum perbaikan.
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: Some(42),
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        assert_eq!(exported.schema_version, "1.1");
        assert_eq!(exported.model_type, "naive_bayes");
        assert_eq!(exported.target.name, "Play");
        assert_eq!(exported.target.classes, vec!["No".to_string(), "Yes".to_string()]);
        assert_eq!(exported.target.class_priors.len(), 2);
        // Fixture 2 baris: No=1, Yes=1 (schema 1.1).
        assert_eq!(exported.target.class_counts, vec![1u64, 1u64]);
        assert_eq!(exported.feature_order, vec!["Outlook".to_string(), "Temp".to_string()]);
        assert_eq!(exported.features.len(), 2);
        assert_eq!(exported.smoothing_alpha, 1.0);
        assert_eq!(exported.variance_floor, 1e-9);
        assert_eq!(exported.label_mapping.get("No"), Some(&0));
        assert_eq!(exported.label_mapping.get("Yes"), Some(&1));
        assert_eq!(exported.validation_config.method, "holdout");
        assert_eq!(exported.validation_config.training_percentage, Some(70.0));
        assert_eq!(exported.validation_config.holdout_percentage, Some(30.0));
        assert_eq!(exported.validation_config.seed, Some(42));
        assert!(!exported.missing_value_policy.is_empty());
        assert!(!exported.unseen_category_policy.is_empty());

        match &exported.features[0] {
            ExportFeature::Categorical {
                name,
                role,
                categories,
                distribution,
                class_totals,
            } => {
                assert_eq!(name, "Outlook");
                assert_eq!(class_totals.len(), 2);
                assert_eq!(class_totals.get("No"), Some(&1u64));
                assert_eq!(class_totals.get("Yes"), Some(&1u64));
                assert_eq!(*role, "categorical");
                assert_eq!(categories.len(), 2); // "Rain", "Sunny"
                assert_eq!(distribution.len(), 2); // satu entri per kelas
                for probs in distribution.values() {
                    assert_eq!(probs.len(), categories.len());
                }
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }

        match &exported.features[1] {
            ExportFeature::Numerical { name, role, mean, variance } => {
                assert_eq!(name, "Temp");
                assert_eq!(*role, "numerical");
                assert_eq!(mean.len(), 2);
                assert_eq!(variance.len(), 2);
            }
            other => panic!("expected numerical feature, got {:?}", other),
        }
    }

    /// `class_priors` HARUS sejajar index dengan `target.classes`, bukan
    /// map — properti yang mudah rusak diam-diam kalau urutan berubah.
    #[test]
    fn class_priors_are_aligned_by_index_with_classes() {
        let (preprocessed, model) = preprocessed_fixture();
        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "kfold".to_string(),
                training_percentage: 30.0,
                k_folds: 5,
                random_seed: None,
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        for (idx, class) in exported.target.classes.iter().enumerate() {
            let expected = model.class_priors.priors[class];
            assert!((exported.target.class_priors[idx] - expected).abs() < 1e-12);
        }

        assert_eq!(exported.validation_config.method, "kfold");
        assert_eq!(exported.validation_config.folds, Some(5));
        assert_eq!(exported.validation_config.training_percentage, None);
        assert_eq!(exported.validation_config.seed, None);
    }

    /// Predictor yang tidak punya entri di model (kasus degenerate,
    /// seharusnya tidak terjadi di jalur normal) tidak boleh panic —
    /// fallback ke kategori/nilai kosong, bukan crash.
    #[test]
    fn missing_model_entry_for_predictor_does_not_panic() {
        let (mut preprocessed, model) = preprocessed_fixture();
        preprocessed
            .predictor_order
            .push(("Ghost".to_string(), PredictorRole::Factor));

        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 30.0,
                k_folds: 10,
                random_seed: None,
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);
        assert_eq!(exported.features.len(), 3);
        match &exported.features[2] {
            ExportFeature::Categorical { categories, distribution, class_totals, .. } => {
                assert!(categories.is_empty());
                assert_eq!(class_totals.len(), 2);
                assert_eq!(class_totals.get("No"), Some(&0u64));
                assert_eq!(class_totals.get("Yes"), Some(&0u64));
                assert_eq!(distribution.len(), 2);
                for probs in distribution.values() {
                    assert!(probs.is_empty());
                }
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }
    }

    /// Apply Model PLAN.md Fase 0 langkah 5: dataset 6-baris yang sama dengan
    /// `prediction.rs` tests (No=3, Yes=3) -> `class_counts == [3,3]` dan
    /// `class_totals == {No:3, Yes:3}` (Σ raw_count per kelas).
    #[test]
    fn class_counts_and_class_totals_match_training_counts() {
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

        let preprocessed = PreprocessedData {
            total_instances: 6,
            excluded_target_missing: 0,
            target_variable: "Play".to_string(),
            predictor_order: vec![
                ("Outlook".to_string(), PredictorRole::Factor),
                ("Temp".to_string(), PredictorRole::Covariate),
            ],
            factor_names: factor_names.clone(),
            covariate_names: covariate_names.clone(),
            classes: classes.clone(),
            cases: cases.clone(),
        };
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let config = NaiveBayesConfig {
            main: crate::models::config::MainConfig {
                target_var: Some("Play".to_string()),
                excluded_var: None,
                candidate_factors: None,
                candidate_covariates: None,
            },
            options: crate::models::config::OptionsConfig {
                missing_value_policy: "exclude".to_string(),
                unseen_category_policy: "smoothing".to_string(),
                smoothing_alpha: 1.0,
                variance_floor: 1e-9,
            },
            validation: ValidationConfig {
                validation_method: "holdout".to_string(),
                training_percentage: 70.0,
                k_folds: 10,
                random_seed: Some(42),
            },
            output: crate::models::config::OutputConfig {
                case_processing_summary: true,
                attribute_distribution_table: true,
                model_evaluation_metrics: true,
                confusion_matrix: true,
            },
        };

        let exported = build_exported_model(&preprocessed, &model, &config);

        assert_eq!(exported.schema_version, "1.1");
        assert_eq!(exported.target.class_counts, vec![3u64, 3u64]);
        match &exported.features[0] {
            ExportFeature::Categorical { class_totals, .. } => {
                let mut expected: HashMap<String, u64> = HashMap::new();
                expected.insert("No".to_string(), 3);
                expected.insert("Yes".to_string(), 3);
                assert_eq!(class_totals, &expected);
            }
            other => panic!("expected categorical feature, got {:?}", other),
        }
    }
}
