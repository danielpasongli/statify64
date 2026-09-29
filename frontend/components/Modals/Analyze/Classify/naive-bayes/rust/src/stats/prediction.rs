// naive-bayes/rust/src/stats/prediction.rs
//
// PLAN.md Fase 13 — "Prediksi / scoring + penanganan kategori tak dikenal".
//
// Menghitung skor log-posterior gabungan (log class prior + log-likelihood
// Gaussian untuk covariate + log-likelihood kategorik untuk factor,
// AGENTS.md §5.1) untuk setiap kelas, lalu memilih kelas dengan skor
// tertinggi (argmax). Bekerja murni di atas `stats::training::
// TrainedModelParams` (Fase 12) dan `models::data::PreprocessedCase` (Fase
// 9) — modul ini TIDAK tahu (dan tidak perlu tahu) apakah model yang
// diberikan hasil retrain di seluruh dataset atau hasil training di satu
// subset holdout/fold (AGENTS.md §5.5); itu keputusan pemanggil di Fase
// 14+ (metrik evaluasi), bukan tanggung jawab modul ini.
//
// --- AGENTS.md §5.9 (kategori tak dikenal / unseen category) -------------
//
// Fokus khusus fase ini: jika kategori pada kasus yang diprediksi tidak
// pernah muncul di data training untuk atribut ybs (situasi yang bisa
// terjadi saat evaluasi holdout/k-fold, karena training hanya melihat
// SEBAGIAN data), kategori itu diperlakukan sebagai count nol dan tetap
// mendapat probabilitas kecil lewat smoothing
// `alpha / (class_total + alpha * jumlah_kategori)` — BUKAN error, panic,
// atau NaN.
//
// `class_total` dan `jumlah_kategori` untuk kategori tak dikenal HARUS
// memakai populasi yang SAMA PERSIS dengan yang dipakai
// `categorical_distribution::compute_categorical_distribution` untuk
// kategori yang DIKENAL (§5.9 secara eksplisit meminta penyebut yang
// konsisten), supaya kategori yang kebetulan tidak muncul di satu
// fold/holdout tidak diam-diam diberi skor yang beda basis dengan kategori
// yang muncul. Karena `CategoricalDistribution` (Fase 12) tidak menyimpan
// `class_total`/`jumlah_kategori` secara eksplisit sebagai field, keduanya
// diturunkan ulang di `categorical_probability` di bawah dari data yang
// SUDAH ada (`per_class[class]` dan `categories`), bukan dihitung dengan
// definisi berbeda — lihat komentar di `categorical_probability`.
//
// --- Stabilitas numerik ----------------------------------------------------
//
// Seluruh perhitungan dilakukan di log-space (bukan perkalian probabilitas
// biasa) supaya tidak underflow ke 0.0 ketika jumlah predictor banyak
// (produk banyak probabilitas kecil bisa jadi persis 0.0 di floating point
// biasa, membuat semua kelas terlihat "sama-sama mustahil"). Densitas
// Gaussian memakai `variance` yang SUDAH melalui variance floor sejak Fase
// 12 (`numerical_distribution::GaussianParams::variance`, AGENTS.md §5.3),
// jadi tidak pernah membagi dengan nol atau `ln(0)` dari sisi variance;
// argumen `ln()` lain (prior kelas yang kebetulan 0, atau — sebagai
// pengaman ekstra — probabilitas kategorik yang kebetulan 0) diberi lantai
// (`f64::MIN_POSITIVE`) supaya skor tetap berupa angka valid dan bisa
// dibandingkan lewat argmax, bukan `-inf`/`NaN` yang meracuni perbandingan.
//
// --- Determinisme tie-break -------------------------------------------------
//
// Argmax dihitung dengan mengiterasi nama kelas terurut ALFABETIS (bukan
// urutan iterasi `HashMap`, yang tidak stabil) dan hanya memperbarui kelas
// terpilih saat skor BENAR-BENAR lebih tinggi (bukan `>=`). Efeknya: kalau
// dua kelas atau lebih punya skor identik persis (kasus jarang, tapi bisa
// terjadi mis. saat semua predictor untuk kasus itu memakai kategori tak
// dikenal dan prior kelasnya sama), pemenangnya selalu kelas yang namanya
// lebih dulu secara alfabetis — deterministik run-ke-run, bukan bergantung
// urutan hash yang tidak terjamin.
use std::collections::HashMap;
use std::f64::consts::PI;

use crate::models::data::PreprocessedCase;

use super::categorical_distribution::CategoricalDistribution;
use super::training::TrainedModelParams;

/// Hasil scoring satu kasus terhadap model terlatih.
#[derive(Debug, Clone, PartialEq)]
pub struct PredictionScores {
    /// class -> skor log-posterior (log prior + total log-likelihood).
    /// Bukan probabilitas ternormalisasi (tidak dibagi evidence) — cukup
    /// untuk argmax, yang satu-satunya kebutuhan Fase 13/14 (memilih kelas
    /// prediksi untuk confusion matrix & metrik evaluasi).
    pub scores: HashMap<String, f64>,
    /// Kelas dengan skor tertinggi. `None` hanya ketika model sama sekali
    /// tidak punya kelas (`TrainedModelParams::class_priors` kosong) —
    /// kasus degenerate yang seharusnya sudah dicegah di validasi form
    /// (predictor/target wajib terisi) maupun preprocessing (§3.2), tapi
    /// dijaga di sini juga supaya tidak panic.
    pub predicted_class: Option<String>,
}

/// Log densitas Gaussian: `-0.5 * ln(2*pi*variance) - (x-mean)^2 / (2*variance)`
/// (AGENTS.md §5.1: atribut `scale` dimodelkan sebagai Gaussian Naive
/// Bayes). `variance` di sini SUDAH melalui variance floor sejak Fase 12,
/// tapi tetap dijaga lapis kedua di sini (`variance.max(f64::MIN_POSITIVE)`)
/// supaya modul ini tidak pernah membagi dengan nol atau menghitung
/// `ln(0)` walau dipanggil langsung dengan parameter buatan tangan (mis.
/// dari test) di luar jalur normal Fase 12.
fn log_gaussian_density(x: f64, mean: f64, variance: f64) -> f64 {
    let variance = variance.max(f64::MIN_POSITIVE);
    -0.5 * (2.0 * PI * variance).ln() - (x - mean).powi(2) / (2.0 * variance)
}

/// Probabilitas kategori satu atribut kategorik untuk satu kelas, MENANGANI
/// kategori tak dikenal (AGENTS.md §5.9) — lihat catatan panjang di kepala
/// file untuk alasan kenapa `class_total`/`jumlah_kategori` diturunkan
/// ulang dari `per_class`/`categories` alih-alih disimpan sebagai field
/// terpisah.
///
/// - Kategori DIKENAL untuk kelas ini (ada di `per_class[class]`) ->
///   pakai `probability` yang sudah dihitung Fase 12 apa adanya.
/// - Kategori TAK DIKENAL (tidak ada di `per_class[class]`, baik karena
///   tidak pernah muncul di training sama sekali, atau — kasus yang lebih
///   jarang — hanya tidak muncul di kelas ini padahal dikenal di kelas
///   lain; keduanya diperlakukan sama karena `per_class[class]` selalu
///   berisi SEMUA kategori yang dikenal LINTAS KELAS, lihat
///   `categorical_distribution.rs`) -> hitung dari nol:
///     `class_total` = jumlah seluruh `raw_count` kelas ini (valid karena
///     `categorical_distribution.rs` menjamin setiap baris kelas ini
///     tercatat pada TEPAT SATU kategori, jadi menjumlah raw_count = jumlah
///     baris kelas ini, populasi yang SAMA dipakai saat menghitung kategori
///     yang dikenal).
///     `jumlah_kategori` = `distribution.categories.len()` — persis
///     populasi yang sama dipakai `compute_categorical_distribution`.
///     `probability = alpha / (class_total + alpha * jumlah_kategori)`.
fn categorical_probability(
    distribution: &CategoricalDistribution,
    class: &str,
    category: &str,
    alpha: f64,
) -> f64 {
    let Some(per_class) = distribution.per_class.get(class) else {
        // Kelas ini tidak punya entri di `per_class` sama sekali.
        // `compute_categorical_distribution` menjamin setiap kelas yang
        // diminta punya entri (termasuk yang class_total-nya 0), jadi ini
        // seharusnya tidak pernah terjadi pada jalur normal — dijaga di
        // sini sebagai pengaman lapis kedua, konsisten dengan gaya
        // defensif modul-modul Fase 12 lainnya.
        return 0.0;
    };

    if let Some(stat) = per_class.get(category) {
        return stat.probability;
    }

    let class_total: f64 = per_class.values().map(|stat| stat.raw_count as f64).sum();
    let num_categories = distribution.categories.len() as f64;
    let denom = class_total + alpha * num_categories;

    if denom > 0.0 {
        alpha / denom
    } else {
        // `denom == 0` hanya mungkin bila `class_total == 0` DAN
        // `num_categories == 0` (atribut ini sama sekali tidak punya
        // kategori dikenal di seluruh training) — kasus degenerate yang
        // seharusnya sudah dicegah di validasi form (predictor efektif
        // tidak boleh kosong). Dijaga di sini juga supaya tidak
        // menghasilkan NaN/Inf, konsisten dengan pola yang sama persis di
        // `categorical_distribution::compute_categorical_distribution`.
        0.0
    }
}

/// Log dari sebuah probabilitas, dengan lantai `f64::MIN_POSITIVE` untuk
/// nilai yang kebetulan 0 (prior kelas yang tidak pernah muncul di
/// training, atau probabilitas kategorik degenerate di atas) — supaya
/// hasilnya angka valid yang sangat negatif (bukan `-inf`), tetap bisa
/// dibandingkan lewat argmax tanpa mencemari perbandingan dengan `NaN`
/// (`-inf - (-inf)` adalah `NaN`).
fn safe_ln(probability: f64) -> f64 {
    if probability > 0.0 {
        probability.ln()
    } else {
        f64::MIN_POSITIVE.ln()
    }
}

/// Hitung skor log-posterior satu kasus terhadap model terlatih, lalu pilih
/// kelas dengan skor tertinggi (AGENTS.md §5.1).
///
/// Predictor numerik yang missing PADA KASUS INI (`case.covariates.get(name)`
/// berupa `None` sama sekali, atau `Some(None)`) dikecualikan dari skor
/// untuk kasus ini saja — konsisten dengan perlakuan missing saat training
/// (AGENTS.md §5.4): satu atribut kosong tidak menggagalkan prediksi
/// seluruh kasus. Predictor kategorik pada `PreprocessedCase` hasil Fase 9
/// tidak pernah benar-benar missing (nilai kosong sudah jadi kategori
/// `"(Missing)"` sejak preprocessing), tapi cabang "atribut model tidak ada
/// di `case.factors`" tetap dijaga (dikecualikan dari skor, bukan panic)
/// sebagai pengaman kalau fungsi ini dipanggil dengan `PreprocessedCase`
/// yang dibangun manual/parsial (mis. dari test).
pub fn predict_case(
    model: &TrainedModelParams,
    case: &PreprocessedCase,
    alpha: f64,
) -> PredictionScores {
    let mut class_names: Vec<&String> = model.class_priors.class_counts.keys().collect();
    class_names.sort();

    let mut scores: HashMap<String, f64> = HashMap::with_capacity(class_names.len());
    let mut predicted_class: Option<String> = None;
    let mut best_score = f64::NEG_INFINITY;

    for class in &class_names {
        let prior = *model.class_priors.priors.get(class.as_str()).unwrap_or(&0.0);
        let mut score = safe_ln(prior);

        for (covariate_name, per_class_params) in &model.gaussian {
            if let Some(Some(value)) = case.covariates.get(covariate_name) {
                if let Some(params) = per_class_params.get(class.as_str()) {
                    score += log_gaussian_density(*value, params.mean, params.variance);
                }
            }
            // `case.covariates.get(name)` bernilai `None` (atribut tidak
            // ada di kasus ini) atau `Some(None)` (missing, AGENTS.md §5.4)
            // -> atribut ini dikecualikan dari skor kasus ini saja, model
            // tetap punya parameter Gaussian-nya untuk kasus lain.
        }

        for (factor_name, distribution) in &model.categorical {
            if let Some(category) = case.factors.get(factor_name) {
                let probability = categorical_probability(distribution, class.as_str(), category, alpha);
                score += safe_ln(probability);
            }
            // Lihat catatan di doc comment fungsi ini: cabang ini murni
            // pengaman, bukan jalur normal.
        }

        scores.insert((*class).clone(), score);

        // Argmax deterministik: hanya perbarui saat BENAR-BENAR lebih
        // tinggi (bukan `>=`), dengan `class_names` yang sudah diurutkan
        // alfabetis -> ties selalu dimenangkan kelas alfabetis pertama.
        if score > best_score {
            best_score = score;
            predicted_class = Some((*class).clone());
        }
    }

    PredictionScores {
        scores,
        predicted_class,
    }
}

/// Prediksi banyak kasus sekaligus, urutan hasil sejajar dengan `cases` —
/// dipakai Fase 14 (metrik evaluasi & confusion matrix) untuk menghasilkan
/// prediksi holdout/gabungan k-fold.
pub fn predict_cases(
    model: &TrainedModelParams,
    cases: &[PreprocessedCase],
    alpha: f64,
) -> Vec<PredictionScores> {
    cases.iter().map(|case| predict_case(model, case, alpha)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    use super::super::training::train_naive_bayes_model;

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

    /// Dataset kecil buatan tangan (6 baris, 2 kelas, 1 factor "Outlook", 1
    /// covariate "Temp") — SAMA PERSIS dengan dataset yang dipakai
    /// `class_prior`, `numerical_distribution`, `categorical_distribution`,
    /// dan `training` (lihat komentar di file-file itu), supaya model yang
    /// dipakai fase ini sudah tervalidasi dari sisi training-nya sebelum
    /// diuji lagi dari sisi prediksi.
    fn six_row_model(alpha: f64) -> TrainedModelParams {
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

        train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, alpha, 1e-9)
    }

    /// Pembanding manual (Python, formula identik: log gaussian density +
    /// log prior + log probabilitas kategorik, lihat laporan implementasi
    /// Fase 13) untuk kasus Outlook=Overcast, Temp=85.0 — secara intuitif
    /// jelas mengarah ke kelas "No" (Overcast & Temp tinggi mendominasi
    /// data "No").
    #[test]
    fn predicts_expected_class_for_clear_cut_overcast_case() {
        let model = six_row_model(1.0);
        let query = case("UNUSED", "Overcast", 85.0);

        let result = predict_case(&model, &query, 1.0);

        assert_eq!(result.predicted_class, Some("No".to_string()));
        assert!((result.scores["No"] - (-3.7953883096437977)).abs() < 1e-9);
        assert!((result.scores["Yes"] - (-35.581759809498536)).abs() < 1e-9);
    }

    /// Pembanding manual (Python): Outlook=Sunny, Temp=71.0 -> jelas
    /// mengarah ke kelas "Yes".
    #[test]
    fn predicts_expected_class_for_clear_cut_sunny_case() {
        let model = six_row_model(1.0);
        let query = case("UNUSED", "Sunny", 71.0);

        let result = predict_case(&model, &query, 1.0);

        assert_eq!(result.predicted_class, Some("Yes".to_string()));
        assert!((result.scores["No"] - (-8.700853417751961)).abs() < 1e-9);
        assert!((result.scores["Yes"] - (-2.9831475208304266)).abs() < 1e-9);
    }

    /// FOKUS UTAMA FASE 13 (AGENTS.md §5.9): kategori "Foggy" tidak pernah
    /// muncul di training sama sekali. Prediksi tidak boleh panic/NaN, dan
    /// harus tetap menghasilkan kelas valid — di sini "Yes" tetap menang
    /// karena Temp=72.0 sangat dekat dengan mean Yes (72.0), walau
    /// probabilitas kategorik "Foggy" sama-sama kecil (1/6) untuk kedua
    /// kelas (pembanding manual Python, lihat laporan implementasi).
    #[test]
    fn unseen_category_does_not_panic_or_produce_nan_and_still_predicts_a_valid_class() {
        let model = six_row_model(1.0);
        let query = case("UNUSED", "Foggy", 72.0);

        let result = predict_case(&model, &query, 1.0);

        assert!(result.scores["No"].is_finite());
        assert!(result.scores["Yes"].is_finite());
        assert!(!result.scores["No"].is_nan());
        assert!(!result.scores["Yes"].is_nan());

        assert_eq!(result.predicted_class, Some("Yes".to_string()));
        assert!((result.scores["No"] - (-8.72435774116905)).abs() < 1e-9);
        assert!((result.scores["Yes"] - (-3.894259809498536)).abs() < 1e-9);
    }

    /// `categorical_probability` untuk kategori tak dikenal harus memakai
    /// `class_total`/`jumlah_kategori` yang SAMA dengan yang dipakai
    /// kategori dikenal (AGENTS.md §5.9) — dicek langsung terhadap fungsi
    /// helper-nya, bukan cuma lewat skor gabungan.
    #[test]
    fn categorical_probability_for_unseen_category_matches_smoothing_formula() {
        let model = six_row_model(1.0);
        let outlook = &model.categorical["Outlook"];

        // class_total=3, num_categories=3 (Overcast/Rain/Sunny), alpha=1
        // -> alpha / (3 + 1*3) = 1/6 = 0.16666666666666666, untuk KEDUA
        // kelas (class_total sama-sama 3 pada dataset ini).
        let prob_yes = categorical_probability(outlook, "Yes", "Foggy", 1.0);
        let prob_no = categorical_probability(outlook, "No", "Foggy", 1.0);

        assert!((prob_yes - 0.16666666666666666).abs() < 1e-12);
        assert!((prob_no - 0.16666666666666666).abs() < 1e-12);

        // Properti sanity: probabilitas kategori tak dikenal harus SAMA
        // dengan probabilitas kategori DIKENAL yang kebetulan raw_count-nya
        // 0 di kelas yang sama (mis. "Overcast" untuk kelas "Yes"), karena
        // keduanya memakai rumus & penyebut yang identik.
        let known_zero_count_prob = outlook.per_class["Yes"]["Overcast"].probability;
        assert!((prob_yes - known_zero_count_prob).abs() < 1e-12);
    }

    /// Alpha berbeda (0) tidak boleh menyebabkan panic pada kategori tak
    /// dikenal, walau hasilnya degenerate (probabilitas 0). Kontrak UI
    /// memang mewajibkan `alpha > 0` (AGENTS.md §4.1), jadi ini murni
    /// pengaman lapis kedua kalau fungsi dipanggil di luar jalur form
    /// (mis. langsung dari test/kode lain).
    #[test]
    fn unseen_category_with_zero_alpha_does_not_panic_even_though_degenerate() {
        let model = six_row_model(1.0);
        let outlook = &model.categorical["Outlook"];

        let prob = categorical_probability(outlook, "Yes", "Foggy", 0.0);
        assert_eq!(prob, 0.0);

        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), "Foggy".to_string());
        let query = PreprocessedCase {
            target_class: "UNUSED".to_string(),
            factors,
            covariates: StdHashMap::new(),
        };

        let result = predict_case(&model, &query, 0.0);
        assert!(result.scores["Yes"].is_finite());
        assert!(!result.scores["Yes"].is_nan());
        assert!(result.predicted_class.is_some());
    }

    /// Predictor numerik missing PADA KASUS ini (`Some(None)`) dikecualikan
    /// dari skor kasus itu saja (AGENTS.md §5.4) — tidak menyebabkan panic,
    /// dan tetap menghasilkan kelas prediksi yang valid berdasarkan sisa
    /// atribut (di sini murni dari prior + Outlook).
    #[test]
    fn missing_covariate_value_on_case_is_excluded_without_panicking() {
        let model = six_row_model(1.0);

        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), "Overcast".to_string());
        let mut covariates = StdHashMap::new();
        covariates.insert("Temp".to_string(), None); // missing pada kasus ini
        let query = PreprocessedCase {
            target_class: "UNUSED".to_string(),
            factors,
            covariates,
        };

        let result = predict_case(&model, &query, 1.0);

        assert!(result.scores["No"].is_finite());
        assert!(result.scores["Yes"].is_finite());
        // Overcast hanya pernah muncul di kelas "No" pada training -> tanpa
        // Temp sama sekali, "No" tetap menang murni dari prior (seri) +
        // probabilitas kategorik Outlook yang jauh lebih tinggi untuk "No".
        assert_eq!(result.predicted_class, Some("No".to_string()));
    }

    /// Sama seperti di atas, tapi atribut `Temp` bahkan tidak ada sama
    /// sekali di `case.covariates` (bukan `Some(None)`, tapi key-nya
    /// hilang) — cabang pengaman yang berbeda dari test sebelumnya, harus
    /// tetap tidak panic.
    #[test]
    fn covariate_absent_entirely_from_case_is_excluded_without_panicking() {
        let model = six_row_model(1.0);

        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), "Sunny".to_string());
        let query = PreprocessedCase {
            target_class: "UNUSED".to_string(),
            factors,
            covariates: StdHashMap::new(), // "Temp" tidak ada sama sekali
        };

        let result = predict_case(&model, &query, 1.0);

        assert!(result.scores["No"].is_finite());
        assert!(result.scores["Yes"].is_finite());
        assert!(result.predicted_class.is_some());
    }

    /// Kombinasi paling ekstrem: kategori tak dikenal DAN covariate missing
    /// sekaligus, dengan prior kedua kelas sama (0.5/0.5) sehingga skor
    /// akhir kedua kelas identik persis -> tie-break harus deterministik
    /// (kelas alfabetis pertama, "No", menang), BUKAN NaN/panic/pilihan
    /// acak antar-run (pembanding manual Python, lihat laporan
    /// implementasi).
    #[test]
    fn tied_scores_break_deterministically_toward_alphabetically_first_class() {
        let model = six_row_model(1.0);

        let mut factors = StdHashMap::new();
        factors.insert("Outlook".to_string(), "Foggy".to_string());
        let query = PreprocessedCase {
            target_class: "UNUSED".to_string(),
            factors,
            covariates: StdHashMap::new(),
        };

        let first = predict_case(&model, &query, 1.0);
        let second = predict_case(&model, &query, 1.0);

        assert!((first.scores["No"] - (-2.4849066497880004)).abs() < 1e-9);
        assert!((first.scores["Yes"] - (-2.4849066497880004)).abs() < 1e-9);
        assert_eq!(first.predicted_class, Some("No".to_string()));
        // Determinisme run-ke-run (bukan hanya dalam satu run) untuk
        // meyakinkan tie-break tidak bergantung urutan iterasi HashMap yang
        // bisa berbeda antar proses.
        assert_eq!(first.predicted_class, second.predicted_class);
    }

    /// Kelas yang sama sekali tidak muncul di training (prior 0.0, hasil
    /// fallback global untuk Gaussian & distribusi seragam untuk
    /// kategorik, semua sudah teruji di Fase 12) tidak boleh membuat
    /// prediksi panic/NaN, dan praktis tidak akan pernah terpilih karena
    /// prior-nya nyaris nol (log-nya sangat negatif).
    #[test]
    fn class_absent_from_training_gets_finite_score_and_is_not_picked_over_real_classes() {
        let cases = vec![
            case("Yes", "Sunny", 70.0),
            case("Yes", "Sunny", 72.0),
            case("No", "Overcast", 82.0),
            case("No", "Overcast", 90.0),
        ];
        // "Z" diminta sebagai kelas tapi tidak pernah muncul di `cases`.
        let classes = vec!["No".to_string(), "Yes".to_string(), "Z".to_string()];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let query = case("UNUSED", "Overcast", 85.0);
        let result = predict_case(&model, &query, 1.0);

        assert!(result.scores["Z"].is_finite());
        assert!(!result.scores["Z"].is_nan());
        assert!(result.scores["Z"] < result.scores["No"]);
        assert!(result.scores["Z"] < result.scores["Yes"]);
        assert_ne!(result.predicted_class, Some("Z".to_string()));
    }

    /// Model tanpa kelas sama sekali (kasus degenerate yang seharusnya
    /// sudah dicegah lebih awal di validasi form/preprocessing) tidak boleh
    /// panic — `predicted_class` harus `None`, bukan crash saat mengambil
    /// argmax dari kumpulan skor kosong.
    #[test]
    fn model_with_no_classes_returns_none_predicted_class_without_panicking() {
        let cases: Vec<PreprocessedCase> = vec![];
        let classes: Vec<String> = vec![];
        let factor_names = vec!["Outlook".to_string()];
        let covariate_names = vec!["Temp".to_string()];

        let model =
            train_naive_bayes_model(&cases, &classes, &factor_names, &covariate_names, 1.0, 1e-9);

        let query = case("UNUSED", "Sunny", 70.0);
        let result = predict_case(&model, &query, 1.0);

        assert!(result.scores.is_empty());
        assert_eq!(result.predicted_class, None);
    }

    /// `predict_cases` memproses banyak kasus sekaligus, urutan hasil
    /// sejajar dengan input — dipakai Fase 14 untuk evaluasi holdout/k-fold.
    #[test]
    fn predict_cases_processes_every_case_in_order() {
        let model = six_row_model(1.0);
        let queries = vec![
            case("UNUSED", "Overcast", 85.0), // jelas "No"
            case("UNUSED", "Sunny", 71.0),    // jelas "Yes"
        ];

        let results = predict_cases(&model, &queries, 1.0);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].predicted_class, Some("No".to_string()));
        assert_eq!(results[1].predicted_class, Some("Yes".to_string()));
    }

    /// Alpha yang berbeda-beda tidak boleh membuat kategori tak dikenal
    /// menghasilkan probabilitas di luar rentang [0, 1] atau NaN — properti
    /// sanity tambahan atas rumus smoothing untuk unseen category.
    #[test]
    fn unseen_category_probability_stays_within_valid_range_across_alphas() {
        let model = six_row_model(1.0);
        let outlook = &model.categorical["Outlook"];

        for alpha in [0.1, 0.5, 1.0, 5.0, 999.0] {
            let prob = categorical_probability(outlook, "Yes", "Foggy", alpha);
            assert!(prob.is_finite());
            assert!(!prob.is_nan());
            assert!(prob >= 0.0 && prob <= 1.0, "alpha={} prob={}", alpha, prob);
        }
    }
}
