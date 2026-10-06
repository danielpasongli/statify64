// naive-bayes/rust/src/stats/attribute_distribution.rs
//
// PLAN.md Fase 15 — "Attribute Distribution Table & Case Processing
// Summary". Bagian ini: Attribute Distribution Table gaya WEKA (AGENTS.md
// §5.8):
//
//   "Baris = tiap atribut; untuk atribut kategorik, setiap kategori
//   menjadi sub-baris tersendiri, dengan kolom per kelas target
//   menampilkan: raw count, smoothed count (count + alpha), probability
//   (smoothed_count / (class_total + alpha * jumlah_kategori)), dan total.
//   Untuk atribut numerik: tampilkan mean dan std dev per kelas. Weighted
//   sum dihapus dari scope (tidak ditampilkan)."
//
// === TITIK PALING GAMPANG SALAH (instruksi tugas Fase 15, AGENTS.md
// §5.5) ===
//
//   "Model akhir yang diekspor/dilaporkan strukturnya (Attribute
//   Distribution Table) selalu dilatih ulang pada SELURUH dataset setelah
//   proses validasi (holdout atau k-fold) selesai dipakai murni untuk
//   mengukur performa ... Attribute Distribution Table dan model yang
//   diekspor berasal dari model final yang dilatih ulang di seluruh data
//   — bukan dari satu fold tertentu atau agregasi lintas-fold."
//
// Modul ini TIDAK menerima parameter fold/holdout/subset APA PUN — hanya
// `&TrainedModelParams` (hasil `stats::training::train_naive_bayes_model`)
// beserta metadata atribut (classes, predictor_order). Ini SENGAJA:
// signature fungsi di bawah secara struktural tidak memungkinkan kode ini
// diam-diam dipanggil dengan model dari satu fold saja tanpa pemanggil
// SADAR bahwa `model` yang mereka kirim itulah yang akan dilaporkan apa
// adanya. Kebenaran "model yang dikirim ke sini memang hasil retrain di
// SELURUH dataset" adalah kontrak/tanggung jawab PEMANGGIL — di Fase 15 ini
// belum ada pemanggil sungguhan (itu Fase 16/17, di luar cakupan tugas ini)
// — tapi test di bawah membuktikan modul ini melaporkan APA ADANYA model
// yang diberikan, bukan mengasumsikan/menghitung ulang dari fold tertentu
// secara diam-diam di dalam modul ini sendiri.
use std::collections::HashMap;

use crate::models::data::PredictorRole;

use super::training::TrainedModelParams;

/// Statistik satu kombinasi (kategori, kelas) pada atribut kategorik.
#[derive(Debug, Clone, PartialEq)]
pub struct CategoryClassStat {
    pub class: String,
    pub raw_count: usize,
    /// `raw_count + alpha`.
    pub smoothed_count: f64,
    /// `smoothed_count / (class_total + alpha * jumlah_kategori)`.
    pub probability: f64,
    /// Total baris berkelas ini (`class_total`, AGENTS.md §5.8 kolom
    /// "total") — nilainya SAMA untuk setiap kategori pada atribut yang
    /// sama (setiap baris kelas ini pasti tercatat di tepat satu kategori,
    /// lihat catatan `class_total` di `categorical_distribution.rs`).
    pub total: usize,
}

/// Satu sub-baris kategori pada atribut kategorik (AGENTS.md §5.8: "setiap
/// kategori menjadi sub-baris tersendiri").
#[derive(Debug, Clone, PartialEq)]
pub struct CategoricalAttributeCategoryRow {
    pub category: String,
    /// Satu entri per kelas di `AttributeDistributionRow::classes`, urutan
    /// mengikuti urutan `classes` tsb (determinisme tabel).
    pub per_class: Vec<CategoryClassStat>,
}

/// Statistik satu kelas pada atribut numerik: mean & std dev
/// (AGENTS.md §5.8 — TIDAK ada weighted sum, "dihapus dari scope").
#[derive(Debug, Clone, PartialEq)]
pub struct NumericClassStat {
    pub class: String,
    pub mean: f64,
    /// `sqrt(variance)`. `variance` pada `GaussianParams` sudah melalui
    /// variance floor (AGENTS.md §5.3, selalu > 0), jadi nilai ini tidak
    /// pernah NaN.
    pub std_dev: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttributeRole {
    Categorical,
    Numerical,
}

/// Satu baris atribut pada Attribute Distribution Table.
#[derive(Debug, Clone, PartialEq)]
pub struct AttributeDistributionRow {
    pub name: String,
    pub role: AttributeRole,
    /// Daftar kelas yang dipakai untuk kolom tabel ini (disalin dari
    /// parameter `classes` yang diberikan ke
    /// `compute_attribute_distribution_table`).
    pub classes: Vec<String>,
    /// `Some(..)` hanya bila `role == Categorical`.
    pub categorical: Option<Vec<CategoricalAttributeCategoryRow>>,
    /// `Some(..)` hanya bila `role == Numerical`.
    pub numeric: Option<Vec<NumericClassStat>>,
}

/// Bangun Attribute Distribution Table lengkap dari `model` (AGENTS.md
/// §5.8), untuk seluruh atribut di `predictor_order` (menentukan urutan
/// baris, sama dengan urutan payload asli / `feature_order` ekspor model
/// nanti — AGENTS.md §5.10) dan `classes` (menentukan kolom).
///
/// `model` HARUS berasal dari retrain di seluruh dataset (lihat catatan
/// kepala file) — fungsi ini sendiri tidak dan tidak bisa memverifikasi
/// hal itu (tidak ada informasi "fold mana" yang melekat pada
/// `TrainedModelParams`), sehingga tanggung jawab itu murni ada di sisi
/// pemanggil.
pub fn compute_attribute_distribution_table(
    model: &TrainedModelParams,
    predictor_order: &[(String, PredictorRole)],
    classes: &[String],
) -> Vec<AttributeDistributionRow> {
    predictor_order
        .iter()
        .map(|(name, role)| match role {
            PredictorRole::Factor => build_categorical_row(name, model, classes),
            PredictorRole::Covariate => build_numerical_row(name, model, classes),
        })
        .collect()
}

fn build_categorical_row(
    name: &str,
    model: &TrainedModelParams,
    classes: &[String],
) -> AttributeDistributionRow {
    let class_totals: &HashMap<String, usize> = &model.class_priors.class_counts;

    let categorical_rows: Vec<CategoricalAttributeCategoryRow> = match model.categorical.get(name)
    {
        Some(distribution) => distribution
            .categories
            .iter()
            .map(|category| {
                let per_class = classes
                    .iter()
                    .map(|class| {
                        let total = *class_totals.get(class).unwrap_or(&0);
                        match distribution
                            .per_class
                            .get(class)
                            .and_then(|per_category| per_category.get(category))
                        {
                            Some(stat) => CategoryClassStat {
                                class: class.clone(),
                                raw_count: stat.raw_count,
                                smoothed_count: stat.smoothed_count,
                                probability: stat.probability,
                                total,
                            },
                            // Kombinasi (kelas, kategori) tidak ditemukan di
                            // model (seharusnya tidak terjadi —
                            // `compute_categorical_distribution` selalu
                            // mengisi entri untuk setiap kombinasi kelas x
                            // kategori, AGENTS.md §5.9) — pengaman lapis
                            // kedua, dilaporkan sebagai nol, bukan panik.
                            None => CategoryClassStat {
                                class: class.clone(),
                                raw_count: 0,
                                smoothed_count: 0.0,
                                probability: 0.0,
                                total,
                            },
                        }
                    })
                    .collect();

                CategoricalAttributeCategoryRow {
                    category: category.clone(),
                    per_class,
                }
            })
            .collect(),
        // Atribut kategorik yang namanya tidak ditemukan di model sama
        // sekali (seharusnya tidak terjadi bila `predictor_order` berasal
        // dari `PreprocessedData` yang sama dengan yang dipakai training) —
        // pengaman lapis kedua: baris tetap muncul, tanpa sub-baris
        // kategori, bukan panik/menghilangkan atribut dari tabel diam-diam.
        None => Vec::new(),
    };

    AttributeDistributionRow {
        name: name.to_string(),
        role: AttributeRole::Categorical,
        classes: classes.to_vec(),
        categorical: Some(categorical_rows),
        numeric: None,
    }
}

fn build_numerical_row(
    name: &str,
    model: &TrainedModelParams,
    classes: &[String],
) -> AttributeDistributionRow {
    let gaussian_by_class = model.gaussian.get(name);

    let numeric_rows: Vec<NumericClassStat> = classes
        .iter()
        .map(|class| match gaussian_by_class.and_then(|g| g.get(class)) {
            Some(params) => NumericClassStat {
                class: class.clone(),
                mean: params.mean,
                // `variance` sudah >= variance_floor (AGENTS.md §5.3), tapi
                // `.max(0.0)` dijaga di sini juga sebagai pengaman lapis
                // kedua terhadap sqrt bilangan negatif (tidak pernah NaN).
                std_dev: params.variance.max(0.0).sqrt(),
            },
            // Covariate yang namanya tidak ditemukan di model (pengaman
            // lapis kedua, seharusnya tidak terjadi) -> dilaporkan 0.0,
            // bukan panik.
            None => NumericClassStat {
                class: class.clone(),
                mean: 0.0,
                std_dev: 0.0,
            },
        })
        .collect();

    AttributeDistributionRow {
        name: name.to_string(),
        role: AttributeRole::Numerical,
        classes: classes.to_vec(),
        categorical: None,
        numeric: Some(numeric_rows),
    }
}

// =====================================================================
// Fase N4 (PLAN_V2 / AGENTS_V2 §9) — keterangan likelihood Numeric.
//
// Tabel di atas TETAP hanya memuat atribut Numeric/Categorical dari
// `predictor_order` (fitur Text tidak punya baris di sini; ia punya Text
// Feature Table sendiri). `AttributeDistributionRow` tidak diubah (bentuk v1
// tetap); keterangan "Gaussian (Weka min. std)" untuk atribut ber-
// `gaussian_minstd` diambil lewat fungsi terpisah di bawah. Kolom `std_dev`
// pada tabel sudah memakai variance SETELAH min-std dan floor.
// =====================================================================

/// Keterangan likelihood satu atribut Numeric ber-`gaussian_minstd`.
#[derive(Debug, Clone, PartialEq)]
pub struct NumericLikelihoodNote {
    /// Selalu `"gaussian_minstd"` (Gaussian biasa tidak punya keterangan).
    pub likelihood: &'static str,
    /// `min_var` §6.4 yang dipakai.
    pub min_variance: f64,
    /// Teks tampilan (Inggris, label UI).
    pub note: String,
}

/// Keterangan untuk atribut `name` bila ia memakai Gaussian min-std (ada di
/// `model.numeric_min_variance`); `None` untuk Gaussian biasa (perilaku v1).
pub fn numeric_likelihood_note(
    model: &TrainedModelParams,
    name: &str,
) -> Option<NumericLikelihoodNote> {
    model
        .numeric_min_variance
        .get(name)
        .map(|&min_variance| NumericLikelihoodNote {
            likelihood: "gaussian_minstd",
            min_variance,
            note: format!("Gaussian with a minimum standard deviation floor (Weka-style); minimum variance = {}", min_variance),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::data::PreprocessedCase;
    use crate::stats::training::train_naive_bayes_model;
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

    /// SAMA PERSIS dataset 6-baris yang dipakai `training.rs` (Fase 12) —
    /// dipakai lagi di sini supaya angka Attribute Distribution Table bisa
    /// dicocokkan terhadap perhitungan manual yang sama:
    ///   class_priors: Yes=0.5, No=0.5 (class_counts: Yes=3, No=3)
    ///   Gaussian Temp: Yes mean=72.0 var=2.6666666666666665 (std=1.6329931618554518);
    ///                  No  mean=84.0 var=18.666666666666668 (std=4.320493798938573)
    ///   Categorical Outlook (alpha=1, num_categories=3):
    ///     Yes: Sunny raw=2 prob=0.5, Rain raw=1 prob=0.3333.., Overcast raw=0 prob=0.1666..
    ///     No:  Sunny raw=1 prob=0.3333.., Overcast raw=2 prob=0.5, Rain raw=0 prob=0.1666..
    fn six_row_dataset() -> Vec<PreprocessedCase> {
        vec![
            case("Yes", "Sunny", 70.0),
            case("Yes", "Sunny", 72.0),
            case("Yes", "Rain", 74.0),
            case("No", "Sunny", 80.0),
            case("No", "Overcast", 82.0),
            case("No", "Overcast", 90.0),
        ]
    }

    fn predictor_order() -> Vec<(String, PredictorRole)> {
        vec![
            ("Outlook".to_string(), PredictorRole::Factor),
            ("Temp".to_string(), PredictorRole::Covariate),
        ]
    }

    fn classes() -> Vec<String> {
        vec!["No".to_string(), "Yes".to_string()]
    }

    #[test]
    fn table_row_order_and_role_follow_predictor_order() {
        let cases = six_row_dataset();
        let classes = classes();
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let table = compute_attribute_distribution_table(&model, &predictor_order(), &classes);

        assert_eq!(table.len(), 2);
        assert_eq!(table[0].name, "Outlook");
        assert_eq!(table[0].role, AttributeRole::Categorical);
        assert!(table[0].categorical.is_some());
        assert!(table[0].numeric.is_none());
        assert_eq!(table[1].name, "Temp");
        assert_eq!(table[1].role, AttributeRole::Numerical);
        assert!(table[1].numeric.is_some());
        assert!(table[1].categorical.is_none());
    }

    #[test]
    fn categorical_row_matches_manual_calculation_including_total_column() {
        let cases = six_row_dataset();
        let classes = classes();
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let table = compute_attribute_distribution_table(&model, &predictor_order(), &classes);
        let outlook_categories = table[0].categorical.as_ref().unwrap();

        // categories terurut alfabetis (dari CategoricalDistribution):
        // Overcast, Rain, Sunny.
        assert_eq!(
            outlook_categories
                .iter()
                .map(|row| row.category.clone())
                .collect::<Vec<_>>(),
            vec![
                "Overcast".to_string(),
                "Rain".to_string(),
                "Sunny".to_string()
            ]
        );

        let sunny_row = outlook_categories
            .iter()
            .find(|row| row.category == "Sunny")
            .unwrap();
        let sunny_yes = sunny_row
            .per_class
            .iter()
            .find(|stat| stat.class == "Yes")
            .unwrap();
        assert_eq!(sunny_yes.raw_count, 2);
        assert_eq!(sunny_yes.smoothed_count, 3.0);
        assert!((sunny_yes.probability - 0.5).abs() < 1e-12);
        // AGENTS.md §5.8 kolom "total" = class_total, class Yes punya 3
        // baris total (bukan jumlah kategori Sunny saja).
        assert_eq!(sunny_yes.total, 3);

        let sunny_no = sunny_row
            .per_class
            .iter()
            .find(|stat| stat.class == "No")
            .unwrap();
        assert_eq!(sunny_no.raw_count, 1);
        assert!((sunny_no.probability - 0.3333333333333333).abs() < 1e-12);
        assert_eq!(sunny_no.total, 3);

        // "total" harus SAMA untuk kategori lain pada kelas yang sama
        // (Rain, kelas Yes juga total=3).
        let rain_row = outlook_categories
            .iter()
            .find(|row| row.category == "Rain")
            .unwrap();
        let rain_yes = rain_row
            .per_class
            .iter()
            .find(|stat| stat.class == "Yes")
            .unwrap();
        assert_eq!(rain_yes.total, 3);

        // Kategori dengan raw_count 0 di suatu kelas tetap muncul dengan
        // probabilitas smoothing kecil, bukan hilang (AGENTS.md §5.9).
        let overcast_row = outlook_categories
            .iter()
            .find(|row| row.category == "Overcast")
            .unwrap();
        let overcast_yes = overcast_row
            .per_class
            .iter()
            .find(|stat| stat.class == "Yes")
            .unwrap();
        assert_eq!(overcast_yes.raw_count, 0);
        assert!((overcast_yes.probability - 0.16666666666666666).abs() < 1e-12);
    }

    #[test]
    fn numerical_row_reports_mean_and_std_dev_without_weighted_sum() {
        let cases = six_row_dataset();
        let classes = classes();
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];
        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let table = compute_attribute_distribution_table(&model, &predictor_order(), &classes);
        let temp_rows = table[1].numeric.as_ref().unwrap();

        let yes = temp_rows.iter().find(|s| s.class == "Yes").unwrap();
        assert!((yes.mean - 72.0).abs() < 1e-9);
        // std_dev = sqrt(2.6666666666666665).
        assert!((yes.std_dev - 1.6329931618554518).abs() < 1e-9);

        let no = temp_rows.iter().find(|s| s.class == "No").unwrap();
        assert!((no.mean - 84.0).abs() < 1e-9);
        // std_dev = sqrt(18.666666666666668).
        assert!((no.std_dev - 4.320493798938573).abs() < 1e-9);

        // AGENTS.md §5.8: "Weighted sum dihapus dari scope" — struct
        // `NumericClassStat` secara struktural tidak punya field itu sama
        // sekali (dicek lewat compile: hanya class/mean/std_dev yang ada).
    }

    /// TITIK PALING KRITIS Fase 15 (AGENTS.md §5.5): tabel HARUS berasal
    /// dari model yang dilatih di SELURUH dataset, bukan satu fold.
    /// Test ini membuktikan modul ini melaporkan APA ADANYA model yang
    /// diberikan pemanggil — melatih model dari subset data (fold) yang
    /// proporsinya sengaja dibuat berbeda dari keseluruhan data
    /// menghasilkan tabel yang BERBEDA dari model full-data, sehingga
    /// salah kirim model fold ke fungsi ini akan langsung menghasilkan
    /// angka yang salah dan terdeteksi (bukan diam-diam identik).
    #[test]
    fn table_reflects_whichever_model_is_given_full_dataset_differs_from_a_skewed_fold() {
        let full_cases = six_row_dataset();
        let classes = classes();
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let full_model = train_naive_bayes_model(
            &full_cases,
            &classes,
            &factor_names,
            &covariate_names,
            1.0,
            1e-9,
        );

        // "Fold" yang sengaja proporsinya berbeda: hanya 3 baris pertama
        // (semuanya kelas "Yes", Outlook Sunny/Sunny/Rain, Temp
        // 70/72/74) — meniru situasi satu fold k-fold yang tidak mewakili
        // keseluruhan dataset.
        let skewed_fold_cases = &full_cases[0..3];
        let fold_model = train_naive_bayes_model(
            skewed_fold_cases,
            &classes,
            &factor_names,
            &covariate_names,
            1.0,
            1e-9,
        );

        let full_table =
            compute_attribute_distribution_table(&full_model, &predictor_order(), &classes);
        let fold_table =
            compute_attribute_distribution_table(&fold_model, &predictor_order(), &classes);

        // Attribute Distribution Table dari model full-data HARUS cocok
        // dengan perhitungan manual full-data (dicek juga di test-test di
        // atas): mean Temp kelas "No" = 84.0.
        let full_temp_no = full_table[1]
            .numeric
            .as_ref()
            .unwrap()
            .iter()
            .find(|s| s.class == "No")
            .unwrap();
        assert!((full_temp_no.mean - 84.0).abs() < 1e-9);

        // Model dari fold yang skewed (tidak ada baris kelas "No" sama
        // sekali) TIDAK BOLEH punya mean 84.0 untuk kelas "No" — kelas ini
        // jatuh ke fallback (AGENTS.md §5.1 numerical_distribution.rs,
        // fallback global memakai seluruh 3 nilai Temp milik kelas "Yes"
        // sendiri karena tidak ada data global lain: mean=(70+72+74)/3=72.0).
        let fold_temp_no = fold_table[1]
            .numeric
            .as_ref()
            .unwrap()
            .iter()
            .find(|s| s.class == "No")
            .unwrap();
        assert_ne!(fold_temp_no.mean, full_temp_no.mean);

        // Ini membuktikan: memanggil fungsi ini dengan model fold
        // (SALAH, melanggar AGENTS.md §5.5) menghasilkan tabel yang jelas
        // berbeda dari model full-data (BENAR) — kesalahan seperti itu
        // akan langsung kelihatan di hasil, bukan tersembunyi.
    }

    #[test]
    fn missing_attribute_name_in_model_is_reported_as_empty_not_panicking() {
        // Pengaman lapis kedua: predictor_order menyebut atribut yang
        // ternyata tidak ada di model sama sekali.
        let cases = six_row_dataset();
        let classes = classes();
        let model = train_naive_bayes_model(
            &cases,
            &classes,
            &["Outlook".to_string()],
            &["Temp".to_string()],
            1.0,
            1e-9,
        );

        let bogus_order = vec![("NotInModel".to_string(), PredictorRole::Factor)];
        let table = compute_attribute_distribution_table(&model, &bogus_order, &classes);

        assert_eq!(table.len(), 1);
        assert_eq!(table[0].name, "NotInModel");
        assert!(table[0].categorical.as_ref().unwrap().is_empty());
    }
}

// Fase N4 — test keterangan likelihood Numeric dan tabel tanpa baris Text
// (modul terpisah; test lama tidak diubah).
#[cfg(test)]
mod tests_n4 {
    use super::*;
    use crate::models::config::{NumericLikelihood, TextLikelihood};
    use crate::models::data::PreprocessedCase;
    use crate::stats::numerical_distribution::NumericLikelihoodSpec;
    use crate::stats::text_features::TextTrainInput;
    use crate::stats::training::{train_naive_bayes_model, train_naive_bayes_model_v2};
    use statify_text_core::CsrMatrix;
    use std::collections::HashMap as StdHashMap;

    fn xy_case(target_class: &str, x: f64, y: f64) -> PreprocessedCase {
        let mut covariates = StdHashMap::new();
        covariates.insert("x".to_string(), Some(x));
        covariates.insert("y".to_string(), Some(y));
        PreprocessedCase {
            target_class: target_class.to_string(),
            factors: StdHashMap::new(),
            covariates,
        }
    }

    /// Golden min-std AGENTS_V2 §6.7: x kelas A [1,1,1], kelas B [3,5].
    fn minstd_cases() -> Vec<PreprocessedCase> {
        vec![
            xy_case("A", 1.0, 1.0),
            xy_case("A", 1.0, 2.0),
            xy_case("A", 1.0, 3.0),
            xy_case("B", 3.0, 10.0),
            xy_case("B", 5.0, 20.0),
        ]
    }

    fn classes() -> Vec<String> {
        vec!["A".to_string(), "B".to_string()]
    }

    fn names() -> Vec<String> {
        vec!["x".to_string(), "y".to_string()]
    }

    fn order() -> Vec<(String, PredictorRole)> {
        vec![
            ("x".to_string(), PredictorRole::Covariate),
            ("y".to_string(), PredictorRole::Covariate),
        ]
    }

    fn minstd_x_model() -> TrainedModelParams {
        let mut overrides = StdHashMap::new();
        overrides.insert("x".to_string(), NumericLikelihood::GaussianMinstd);
        let spec = NumericLikelihoodSpec {
            default: NumericLikelihood::Gaussian,
            overrides,
        };
        train_naive_bayes_model_v2(
            &minstd_cases(),
            &classes(),
            &[],
            &names(),
            1.0,
            1e-9,
            &spec,
            None,
        )
        .expect("latih min-std")
    }

    #[test]
    fn keterangan_hanya_untuk_atribut_gaussian_minstd() {
        let model = minstd_x_model();

        let note = numeric_likelihood_note(&model, "x").expect("x memakai min-std");
        assert_eq!(note.likelihood, "gaussian_minstd");
        assert!((note.min_variance - 0.111111).abs() < 1e-6);
        assert!(note.note.contains("minimum standard deviation floor"), "{}", note.note);

        // y Gaussian biasa dan atribut yang tidak ada: tanpa keterangan (perilaku v1).
        assert_eq!(numeric_likelihood_note(&model, "y"), None);
        assert_eq!(numeric_likelihood_note(&model, "tidak_ada"), None);

        // Model v1 murni: tidak pernah ada keterangan.
        let v1 = train_naive_bayes_model(&minstd_cases(), &classes(), &[], &names(), 1.0, 1e-9);
        assert_eq!(numeric_likelihood_note(&v1, "x"), None);
    }

    #[test]
    fn std_dev_tabel_memakai_variance_setelah_min_std() {
        let model = minstd_x_model();
        let rows = compute_attribute_distribution_table(&model, &order(), &classes());
        assert_eq!(rows.len(), 2);

        // x kelas A: variance dinaikkan ke min_var (1/9) -> std = 1/3, bukan sqrt(floor).
        let x_stats = rows[0].numeric.as_ref().expect("baris numerik x");
        assert!((x_stats[0].std_dev - 1.0 / 3.0).abs() < 1e-9);
        // x kelas B: variance 1.0 -> std 1.0.
        assert!((x_stats[1].std_dev - 1.0).abs() < 1e-9);
    }

    fn text_matrix() -> CsrMatrix {
        // 5 baris x 2 term: A A A B B.
        CsrMatrix {
            n_rows: 5,
            n_cols: 2,
            indptr: vec![0, 1, 2, 3, 4, 5],
            indices: vec![0, 0, 1, 1, 1],
            data: vec![1.0, 2.0, 1.0, 3.0, 1.0],
        }
    }

    #[test]
    fn model_dengan_text_tidak_menambah_baris_tabel_hanya_numeric_dan_categorical() {
        let x = text_matrix();
        let terms = vec!["kata_a".to_string(), "kata_b".to_string()];
        let input = TextTrainInput {
            x: &x,
            terms: &terms,
            likelihood: TextLikelihood::Multinomial,
            alpha: 1.0,
        };
        let model = train_naive_bayes_model_v2(
            &minstd_cases(),
            &classes(),
            &[],
            &names(),
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        )
        .expect("latih campuran");
        assert!(model.text.is_some());

        // `predictor_order` hanya memuat Numeric/Categorical -> tepat 2 baris,
        // tak satu pun bernama term Text.
        let rows = compute_attribute_distribution_table(&model, &order(), &classes());
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row.role == AttributeRole::Numerical));
        assert!(rows.iter().all(|row| !row.name.starts_with("kata_")));

        // Model hanya-Text (tanpa predictor lain): tabel kosong, bukan error.
        let text_only_cases: Vec<PreprocessedCase> = ["A", "A", "A", "B", "B"]
            .iter()
            .map(|target| PreprocessedCase {
                target_class: target.to_string(),
                factors: StdHashMap::new(),
                covariates: StdHashMap::new(),
            })
            .collect();
        let text_only = train_naive_bayes_model_v2(
            &text_only_cases,
            &classes(),
            &[],
            &[],
            1.0,
            1e-9,
            &NumericLikelihoodSpec::default(),
            Some(&input),
        )
        .expect("latih hanya-Text");
        let rows = compute_attribute_distribution_table(&text_only, &[], &classes());
        assert!(rows.is_empty());
    }
}
