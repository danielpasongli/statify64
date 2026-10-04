use statify_ordinal::{
    actual_probabilities, displayed_log_likelihood, fit_location_only, fit_non_parallel,
    goodness_of_fit, link, multinomial_log_likelihood_constant, parameter_statistics,
    predicted_categories, predicted_probabilities, test_parallel_lines, AggregatedData,
    Category, EstimationOptions, FitResult, IterationHistoryOptions,
    LinkFunction, ModelType, PlumError, PlumParameters, PlumSpec, ScaleType, Subpopulation,
};

// =============================================================================
// TEST DATA FACTORIES & FIXTURES
// =============================================================================

/// Dataset standar: 3 Kategori ordinal (1, 2, 3), 2 Subpopulasi dengan prediktor X kontinu.
/// Kategori = 3, Parameter = 3 (2 threshold + 1 lokasi/slope).
/// Subpopulasi = 2 -> Derajat bebas GoF = 2 * (3 - 1) - 3 = 1 (> 0).
fn create_standard_data() -> (AggregatedData, PlumSpec) {
    let subpops = vec![
        Subpopulation {
            x: vec![1.0],
            z: vec![],
            counts: vec![15.0, 10.0, 5.0],
            cumulative_counts: vec![15.0, 25.0, 30.0],
            marginal_count: 30.0,
        },
        Subpopulation {
            x: vec![2.0],
            z: vec![],
            counts: vec![5.0, 10.0, 15.0],
            cumulative_counts: vec![5.0, 15.0, 30.0],
            marginal_count: 30.0,
        },
    ];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 60.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let spec = PlumSpec {
        response_variable: "satisfaction".to_string(),
        ordered_categories: data.ordered_categories.clone(),
        category_count: 3,
        link_function: LinkFunction::Logit,
        model_type: ModelType::LocationOnly,
        scale_type: ScaleType::Unity,
        feature_names: vec!["predictor_x".to_string()],
        scale_feature_names: vec![],
        location_variables: vec!["predictor_x".to_string()],
        scale_variables: vec![],
        factor_level_metadata: vec![],
    };

    (data, spec)
}

/// Helper untuk membuat FitResult buatan dengan parameter yang diberikan
fn create_synthetic_fit(theta: Vec<f64>, beta: Vec<f64>) -> FitResult {
    FitResult {
        params: PlumParameters {
            theta,
            beta,
            tau: vec![],
        },
        information: None,
        covariance: None,
        correlation: None,
        log_likelihood: -50.0,
        minus2_log_likelihood: 100.0,
        converged: true,
        iterations: 1,
        iteration_history: vec![],
        last_abs_change_minus2_log_likelihood: None,
        last_max_abs_change_parameters: None,
        warnings: vec![],
    }
}

// =============================================================================
// 1. ESTIMASI PARAMETER DAN ITERASI MLE (fit_location_only)
//    Metrik Graf: N = 12, E = 14, P = 3, V(G) = 4
// =============================================================================

/// Jalur M-1: 1-2-3-11-12
/// Kondisi: Batas iterasi maksimum diatur 0.
/// Hasil yang Diharapkan: Iterasi berhenti segera, hasil ditandai tidak konvergen,
/// kovarians tetap dihitung.
#[test]
fn test_fit_location_path_m1_max_iterations_zero() {
    let (data, spec) = create_standard_data();
    let mut options = EstimationOptions::default();
    options.max_iterations = 0; // Iterasi dibatasi 0
    let history_opts = IterationHistoryOptions::disabled();

    let fit = fit_location_only(&data, &spec, &options, &history_opts)
        .expect("Fitting harus mengembalikan Ok(FitResult) meski max_iter=0");

    assert_eq!(fit.iterations, 0, "Iterasi harus 0 (langsung berhenti)");
    assert!(!fit.converged, "Model harus ditandai tidak konvergen");

    // Inversi matriks informasi untuk kovarians tetap dapat dihitung
    assert!(fit.information.is_some(), "Matriks informasi akhir harus tersedia");
    let cov = fit.information.as_ref().and_then(|info| info.clone().try_inverse());
    assert!(cov.is_some(), "Kovarians harus tetap dapat dihitung dari informasi awal");

    let mut fit_with_cov = fit.clone();
    fit_with_cov.covariance = cov;
    let (rows, _) = parameter_statistics(&fit_with_cov, &spec, 0.05);
    assert_eq!(rows.len(), 3, "Tiga baris parameter harus tetap dihasilkan");
}

/// Jalur M-2: 1-2-3-4-5-6-8-10-11-12
/// Kondisi: Konvergen pada kesempatan pertama pengujian konvergensi (setelah state pembanding tersedia).
/// Hasil yang Diharapkan: Estimasi, galat baku, Wald, dan signifikansi valid.
#[test]
fn test_fit_location_path_m2_converges_first_iteration() {
    let (data, spec) = create_standard_data();
    let mut options = EstimationOptions::default();
    // Toleransi sangat besar sehingga langsung konvergen saat evaluasi pertama prev_state (simpul 8 -> 10)
    options.convergence_tolerance = 100.0;
    options.parameter_tolerance = 100.0;
    options.gradient_tolerance = 100.0;
    options.max_iterations = 10;
    let history_opts = IterationHistoryOptions::disabled();

    let fit = fit_location_only(&data, &spec, &options, &history_opts)
        .expect("Fitting harus sukses");

    // Pada implementasi, prev_state terbentuk pada iterasi 1, dan evaluasi konvergensi pertama tercapai pada iterasi 2
    assert_eq!(fit.iterations, 2, "Harus langsung konvergen pada evaluasi konvergensi pertama");
    assert!(fit.converged, "Model harus berstatus konvergen");

    let mut fit_with_cov = fit.clone();
    fit_with_cov.covariance = fit.information.as_ref().and_then(|info| info.clone().try_inverse());
    let (rows, warnings) = parameter_statistics(&fit_with_cov, &spec, 0.05);

    assert_eq!(rows.len(), 3);
    for row in &rows {
        assert!(row.estimate.is_finite(), "Nilai estimasi harus berhingga");
        assert!(row.std_error.is_some(), "Galat baku harus terhitung");
        assert!(row.wald.is_some(), "Statistik Wald harus terhitung");
        assert!(row.sig.is_some(), "Signifikansi (p-value) harus terhitung");
    }
    assert!(warnings.is_empty(), "Tidak boleh ada peringatan kovarians");
}

/// Jalur M-3: 1-2-3-4-5-7-8-10-11-12
/// Kondisi: Langkah penuh menyimpang sehingga peredaman langkah (step halving) aktif (Simpul 7).
/// Hasil yang Diharapkan: Tetap terkendali dan nilai log-likelihood tidak menurun (atau step halving aktif).
#[test]
fn test_fit_location_path_m3_step_halving_active() {
    use statify_ordinal::step_halving;

    let (data, spec) = create_standard_data();
    let initial_params = PlumParameters {
        theta: vec![-1.0, 1.0],
        beta: vec![0.5],
        tau: vec![],
    };

    let initial_ll = statify_ordinal::log_likelihood(&initial_params, &data, &spec);
    let mut options = EstimationOptions::default();
    options.max_step_halving = 5;

    // Delta yang sangat besar dalam arah yang membuat likelihood anjlok drastis
    // Ini menguji Simpul 5 -> 7: langkah penuh ditolak (step = 1.0), sistem memperkecil langkah (step *= 0.5)
    let bad_delta = nalgebra::DVector::from_vec(vec![50.0, 50.0, -100.0]);

    let step_result = step_halving(&initial_params, &bad_delta, initial_ll, &data, &spec, &options);

    assert!(
        step_result.step_halving_count > 0,
        "Peredaman langkah (step halving count) harus bertambah (simpul 7 terlewati)"
    );
    assert!(
        step_result.step < 1.0,
        "Panjang langkah harus tereduksi kurang dari 1.0"
    );
    assert!(
        step_result.log_likelihood.is_finite(),
        "Log-likelihood harus tetap bernilai terdefinisi"
    );
}

/// Jalur M-4: 1-2-3-4-5-6-8-9-2-3-4-5-6-8-10-11-12
/// Kondisi: Konvergensi membutuhkan lebih dari satu iterasi (iterasi normal).
/// Hasil yang Diharapkan: Jumlah iterasi lebih dari satu dan estimasi stabil.
#[test]
fn test_fit_location_path_m4_multiple_iterations_converged() {
    let (data, spec) = create_standard_data();
    let mut options = EstimationOptions::default();
    options.convergence_tolerance = 1e-8;
    options.parameter_tolerance = 1e-8;
    options.max_iterations = 100;
    let history_opts = IterationHistoryOptions::disabled();

    let fit = fit_location_only(&data, &spec, &options, &history_opts)
        .expect("Fitting harus sukses");

    assert!(
        fit.iterations > 1,
        "Konvergensi harus membutuhkan lebih dari 1 iterasi (simpul 9 kembali ke 2)"
    );
    assert!(fit.converged, "Model harus konvergen secara penuh");
    assert!(fit.log_likelihood.is_finite());
}

// =============================================================================
// 2. UJI KECOCOKAN MODEL / GOODNESS OF FIT (goodness_of_fit)
//    Metrik Graf: N = 14, E = 17, P = 4, V(G) = 5
// =============================================================================

/// Jalur G-1: 1-2-3-4-6-8-9-10-11-13-14
/// Kondisi: Frekuensi harapan tidak positif (0.0) dan derajat bebas tidak positif (<= 0).
/// Hasil yang Diharapkan: Tidak ada nilai yang terakumulasi, nilai-p kosong, muncul peringatan.
#[test]
fn test_goodness_of_fit_path_g1_non_positive_expected_and_non_positive_df() {
    // 1 subpopulasi dengan marginal_count = 0.0 -> frekuensi harapan = 0 * prob = 0.0
    // df = 1 * (3 - 1) - 3 = 2 - 3 = -1 (tidak positif)
    let subpops = vec![Subpopulation {
        x: vec![1.0],
        z: vec![],
        counts: vec![0.0, 0.0, 0.0],
        cumulative_counts: vec![0.0, 0.0, 0.0],
        marginal_count: 0.0,
    }];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 0.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let (_, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-0.5, 0.5], vec![0.1]);

    let (gof, warnings) = goodness_of_fit(&fit, &data, &spec);

    assert_eq!(gof.pearson.chi_square, 0.0, "Pearson tidak boleh terakumulasi");
    assert_eq!(gof.deviance.chi_square, 0.0, "Deviance tidak boleh terakumulasi");
    assert!(gof.pearson.df <= 0.0, "Derajat bebas harus <= 0");
    assert!(gof.pearson.sig.is_none(), "Nilai-p Pearson harus kosong");
    assert!(gof.deviance.sig.is_none(), "Nilai-p Deviance harus kosong");
    assert!(
        warnings.iter().any(|w| w.contains("df goodness-of-fit <= 0")),
        "Harus muncul peringatan df <= 0"
    );
}

/// Jalur G-2: 1-2-3-4-5-6-8-9-10-11-12-14
/// Kondisi: Frekuensi harapan positif, frekuensi teramati nol, derajat bebas positif.
/// Hasil yang Diharapkan: Hanya Pearson terakumulasi, nilai-p terhitung.
#[test]
fn test_goodness_of_fit_path_g2_expected_positive_observed_zero_positive_df() {
    // 2 subpopulasi -> df = 2 * (3 - 1) - 3 = 1 > 0
    // Semua subpop.counts = 0, tetapi marginal_count > 0 sehingga expected > 0
    let subpops = vec![
        Subpopulation {
            x: vec![1.0],
            z: vec![],
            counts: vec![0.0, 0.0, 0.0],
            cumulative_counts: vec![0.0, 0.0, 0.0],
            marginal_count: 30.0,
        },
        Subpopulation {
            x: vec![2.0],
            z: vec![],
            counts: vec![0.0, 0.0, 0.0],
            cumulative_counts: vec![0.0, 0.0, 0.0],
            marginal_count: 30.0,
        },
    ];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 60.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let (_, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-0.5, 0.5], vec![0.1]);

    let (gof, warnings) = goodness_of_fit(&fit, &data, &spec);

    assert!(gof.pearson.chi_square > 0.0, "Pearson harus terakumulasi: (0 - E)^2 / E > 0");
    assert_eq!(gof.deviance.chi_square, 0.0, "Deviance harus 0 karena obs == 0");
    assert!(gof.pearson.df > 0.0, "Derajat bebas harus positif");
    assert!(gof.pearson.sig.is_some(), "Nilai-p Pearson harus terhitung");
    assert!(gof.deviance.sig.is_some(), "Nilai-p Deviance harus terhitung");
    assert!(warnings.is_empty(), "Tidak boleh ada peringatan");
}

/// Jalur G-3: 1-2-3-4-5-6-7-8-9-10-11-12-14
/// Kondisi: Frekuensi teramati dan harapan sama-sama positif, derajat bebas positif (1 subpopulasi representatif).
/// Hasil yang Diharapkan: Pearson dan Deviance terakumulasi, nilai-p terhitung.
#[test]
fn test_goodness_of_fit_path_g3_both_positive_positive_df() {
    let (data, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-0.5, 0.5], vec![0.1]);

    let (gof, warnings) = goodness_of_fit(&fit, &data, &spec);

    assert!(gof.pearson.chi_square > 0.0, "Pearson harus terakumulasi");
    assert!(gof.deviance.chi_square > 0.0, "Deviance harus terakumulasi");
    assert_eq!(gof.pearson.df, 1.0, "Derajat bebas harus 1.0");
    assert!(gof.pearson.sig.is_some(), "Nilai-p Pearson harus ada");
    assert!(gof.deviance.sig.is_some(), "Nilai-p Deviance harus ada");
    assert!(warnings.is_empty());
}

/// Jalur G-4: 1-2-3-4-5-6-7-8-9-3-4-5-6-7-8-9-10-11-12-14
/// Kondisi: Dua subpopulasi atau lebih (pengujian perulangan simpul 9 kembali ke simpul 3).
/// Hasil yang Diharapkan: Akumulasi sama dengan penjumlahan manual tiap subpopulasi.
#[test]
fn test_goodness_of_fit_path_g4_multiple_subpopulations_accumulation() {
    let (data, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-0.5, 0.5], vec![0.1]);

    // Data dengan subpopulasi 1 saja
    let data_sub1 = AggregatedData {
        subpopulations: vec![data.subpopulations[0].clone()],
        total_count: 30.0,
        category_count: 3,
        ordered_categories: data.ordered_categories.clone(),
    };

    // Data dengan subpopulasi 2 saja
    let data_sub2 = AggregatedData {
        subpopulations: vec![data.subpopulations[1].clone()],
        total_count: 30.0,
        category_count: 3,
        ordered_categories: data.ordered_categories.clone(),
    };

    let (gof_all, _) = goodness_of_fit(&fit, &data, &spec);
    let (gof_sub1, _) = goodness_of_fit(&fit, &data_sub1, &spec);
    let (gof_sub2, _) = goodness_of_fit(&fit, &data_sub2, &spec);

    let sum_pearson = gof_sub1.pearson.chi_square + gof_sub2.pearson.chi_square;
    let sum_deviance = gof_sub1.deviance.chi_square + gof_sub2.deviance.chi_square;

    assert!(
        (gof_all.pearson.chi_square - sum_pearson).abs() < 1e-10,
        "Pearson harus merupakan jumlahan eksak dari tiap subpopulasi"
    );
    assert!(
        (gof_all.deviance.chi_square - sum_deviance).abs() < 1e-10,
        "Deviance harus merupakan jumlahan eksak dari tiap subpopulasi"
    );
}

/// Jalur G-5: 1-2-3-4-5-6-8-9-10-11-13-14
/// Kondisi: Frekuensi harapan positif, frekuensi teramati nol, derajat bebas tidak positif.
/// Hasil yang Diharapkan: Pearson terakumulasi, nilai-p kosong.
#[test]
fn test_goodness_of_fit_path_g5_expected_positive_observed_zero_non_positive_df() {
    // 1 subpopulasi dengan marginal > 0 tetapi semua counts = 0
    // df = 1 * (3 - 1) - 3 = -1 <= 0
    let subpops = vec![Subpopulation {
        x: vec![1.0],
        z: vec![],
        counts: vec![0.0, 0.0, 0.0],
        cumulative_counts: vec![0.0, 0.0, 0.0],
        marginal_count: 30.0,
    }];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 30.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let (_, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-0.5, 0.5], vec![0.1]);

    let (gof, warnings) = goodness_of_fit(&fit, &data, &spec);

    assert!(gof.pearson.chi_square > 0.0, "Pearson harus terakumulasi");
    assert_eq!(gof.deviance.chi_square, 0.0);
    assert!(gof.pearson.df <= 0.0, "df harus <= 0");
    assert!(gof.pearson.sig.is_none(), "Nilai-p Pearson harus kosong");
    assert!(
        warnings.iter().any(|w| w.contains("df goodness-of-fit <= 0")),
        "Harus terdapat peringatan df <= 0"
    );
}

// =============================================================================
// 3. UJI ASUMSI GARIS SEJAJAR (fit_non_parallel & test_parallel_lines)
//    Metrik Graf: N = 10, E = 11, P = 2, V(G) = 3
// =============================================================================

/// Jalur L-1: 1-2-3-10
/// Kondisi: Respons biner (kategori < 3) atau tidak ada prediktor (p == 0).
/// Hasil yang Diharapkan: Sistem mengembalikan galat InvalidInput.
#[test]
fn test_parallel_lines_path_l1_invalid_prerequisites() {
    let (data, mut spec) = create_standard_data();
    let options = EstimationOptions::default();

    // Kasus 1: Kategori respons biner (category_count = 2 < 3)
    spec.category_count = 2;
    let result_binary = fit_non_parallel(&data, &spec, &options, None);
    assert!(
        matches!(result_binary, Err(PlumError::InvalidInput(_))),
        "Harus mengembalikan PlumError::InvalidInput untuk respons biner"
    );

    // Kasus 2: Tidak ada prediktor lokasi (feature_names kosong, p = 0)
    let (_, mut spec_no_pred) = create_standard_data();
    spec_no_pred.feature_names = vec![];
    spec_no_pred.location_variables = vec![];
    let result_no_pred = fit_non_parallel(&data, &spec_no_pred, &options, None);
    assert!(
        matches!(result_no_pred, Err(PlumError::InvalidInput(_))),
        "Harus mengembalikan PlumError::InvalidInput jika prediktor kosong"
    );
}

/// Jalur L-2: 1-2-4-5-6-7-8-10
/// Kondisi: Kategori respons tiga atau lebih dan ada prediktor (prasyarat sah).
/// Hasil yang Diharapkan: Statistik chi-kuadrat tidak negatif, derajat bebas sesuai rumus, nilai-p terhitung.
#[test]
fn test_parallel_lines_path_l2_valid_execution() {
    let (data, spec) = create_standard_data();
    let options = EstimationOptions::default();
    let history_opts = IterationHistoryOptions::disabled();

    let parallel_fit = fit_location_only(&data, &spec, &options, &history_opts)
        .expect("Fit parallel harus berhasil");

    let non_parallel_fit = fit_non_parallel(&data, &spec, &options, Some(&parallel_fit))
        .expect("Fit non-parallel harus berhasil");

    let p = spec.location_parameter_count();
    let j = spec.category_count;
    let test_res = test_parallel_lines(&parallel_fit, &non_parallel_fit, p, j);

    assert!(test_res.chi_square >= 0.0, "Chi-Square tidak boleh negatif");
    let expected_df = (j as f64 - 2.0) * p as f64;
    assert_eq!(test_res.df, expected_df, "Derajat bebas harus (J - 2) * p");
    assert!(test_res.sig.is_some(), "Nilai-p harus terhitung untuk df > 0");
    let sig_val = test_res.sig.unwrap();
    assert!((0.0..=1.0).contains(&sig_val), "Nilai-p harus berada di [0, 1]");
}

// Catatan Dokumen untuk Jalur L-3: 1-2-4-5-6-7-9-10 (Derajat bebas tidak positif).
// Sesuai dokumen Bab V halaman 23:
// "Simpul 2 menjamin bahwa kategori respons minimal tiga dan prediktor minimal satu,
// sehingga derajat bebas pada simpul 7 selalu paling sedikit satu. Dengan demikian
// cabang simpul 9 merupakan kode pengaman (defensive code) yang tidak dapat dicapai
// melalui pemanggilan fungsi yang sah."

// =============================================================================
// 4. PREDIKSI PELUANG DAN KATEGORI (Saved Variables)
//    Metrik Graf: N = 9, E = 10, P = 2, V(G) = 3
// =============================================================================

/// Jalur S-1: 1-2-3-4-5-6-7-8-9
/// Kondisi: Satu subpopulasi, peluang kategori melampaui peluang terbaik sementara.
/// Contoh: Peluang = [0.1, 0.7, 0.2] -> Kategori 2 melampaui kategori 1.
/// Hasil yang Diharapkan: Kategori terbaik diperbarui dan baris hasil dikembalikan.
#[test]
fn test_saved_variables_path_s1_category_prob_exceeds_previous() {
    let subpops = vec![Subpopulation {
        x: vec![1.0],
        z: vec![],
        counts: vec![10.0, 70.0, 20.0],
        cumulative_counts: vec![10.0, 80.0, 100.0],
        marginal_count: 100.0,
    }];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 100.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let (_, spec) = create_standard_data();
    // Gunakan parameter di mana probabilitas kategori tengah mendominasi
    let fit = create_synthetic_fit(vec![-2.0, 2.0], vec![0.0]);

    let pred_cats = predicted_categories(&fit, &data, &spec);
    assert_eq!(pred_cats.len(), 1);
    // Dengan threshold [-2.0, 2.0] dan beta = 0:
    // P(Y=1) = inv_logit(-2.0) = 0.119
    // P(Y<=2) = inv_logit(2.0) = 0.880 -> P(Y=2) = 0.761 (terbesar)
    assert_eq!(pred_cats[0].category, "2", "Kategori 2 harus terpilih karena probabilitas terbesar");
    assert!(pred_cats[0].probability > 0.5);
}

/// Jalur S-2: 1-2-3-4-5-7-8-9
/// Kondisi: Satu subpopulasi, peluang pembanding tidak melampaui yang terbaik (contoh: 0.5; 0.3; 0.2).
/// Hasil yang Diharapkan: Kategori pertama tetap terpilih.
#[test]
fn test_saved_variables_path_s2_first_category_remains_highest() {
    let subpops = vec![Subpopulation {
        x: vec![1.0],
        z: vec![],
        counts: vec![50.0, 30.0, 20.0],
        cumulative_counts: vec![50.0, 80.0, 100.0],
        marginal_count: 100.0,
    }];

    let data = AggregatedData {
        subpopulations: subpops,
        total_count: 100.0,
        category_count: 3,
        ordered_categories: vec![
            Category::Number(1.0),
            Category::Number(2.0),
            Category::Number(3.0),
        ],
    };

    let (_, spec) = create_standard_data();
    // Theta 0 bernilai tinggi sehingga kategori 1 memiliki probabilitas mayoritas (> 0.5)
    let fit = create_synthetic_fit(vec![2.0, 3.0], vec![0.0]);

    let pred_cats = predicted_categories(&fit, &data, &spec);
    assert_eq!(pred_cats.len(), 1);
    assert_eq!(pred_cats[0].category, "1", "Kategori pertama harus tetap terpilih");
}

/// Jalur S-3: 1-2-3-4-5-6-7-8-3-4-5-6-7-8-9
/// Kondisi: Dua subpopulasi atau lebih.
/// Hasil yang Diharapkan: Kategori prediksi tiap subpopulasi benar dan jumlah peluang masing-masing sama dengan 1.
#[test]
fn test_saved_variables_path_s3_multiple_subpopulations_reset() {
    let (data, spec) = create_standard_data();
    let fit = create_synthetic_fit(vec![-1.0, 1.0], vec![1.5]);

    let pred_probs = predicted_probabilities(&fit, &data, &spec);
    let pred_cats = predicted_categories(&fit, &data, &spec);
    let actual_probs = actual_probabilities(&data, &spec);

    assert_eq!(pred_cats.len(), 2, "Harus ada 2 prediksi kategori untuk 2 subpopulasi");
    assert_eq!(pred_probs.len(), 6, "Total probabilitas = 2 subpopulasi * 3 kategori");
    assert_eq!(actual_probs.len(), 6);

    // Verifikasi jumlah probabilitas pada tiap subpopulasi harus mendekati 1.0
    for sub_idx in 1..=2 {
        let sum_p: f64 = pred_probs
            .iter()
            .filter(|p| p.subpopulation == sub_idx)
            .map(|p| p.probability)
            .sum();
        assert!(
            (sum_p - 1.0).abs() < 1e-6,
            "Total probabilitas subpopulasi {sub_idx} harus sama dengan 1.0"
        );
    }
}

// =============================================================================
// 5. PILIHAN KONSTANTA MULTINOMIAL (Including vs Excluding)
//    Metrik Graf: N = 5, E = 5, P = 1, V(G) = 2
// =============================================================================

/// Jalur C-1: 1-2-3-5
/// Kondisi: Mode kompatibel SPSS ("SPSS_COMPATIBLE" / "Including").
/// Hasil yang Diharapkan: Hasil sama dengan log-likelihood inti ditambah konstanta multinomial.
#[test]
fn test_multinomial_constant_path_c1_spss_compatible() {
    let (data, _) = create_standard_data();
    let constant = multinomial_log_likelihood_constant(&data);
    let kernel_ll = -120.50;

    let displayed = displayed_log_likelihood(kernel_ll, constant, "SPSS_COMPATIBLE");
    let expected = kernel_ll + constant;

    assert!(
        (displayed - expected).abs() < 1e-12,
        "Mode SPSS harus menambahkan konstanta multinomial ke kernel LL"
    );
}

/// Jalur C-2: 1-2-4-5
/// Kondisi: Mode selain kompatibel SPSS ("KERNEL" / "Excluding").
/// Hasil yang Diharapkan: Hasil sama persis dengan log-likelihood inti.
#[test]
fn test_multinomial_constant_path_c2_kernel_mode() {
    let (data, _) = create_standard_data();
    let constant = multinomial_log_likelihood_constant(&data);
    let kernel_ll = -120.50;

    let displayed = displayed_log_likelihood(kernel_ll, constant, "KERNEL");

    assert_eq!(
        displayed, kernel_ll,
        "Mode KERNEL harus mengembalikan nilai murni log-likelihood inti"
    );
}

// =============================================================================
// 6. FUNGSI TAUTAN / LINK FUNCTIONS (link)
//    Metrik Graf: N = 8, E = 11, P = 4, V(G) = 5
// =============================================================================

/// Jalur K-1: 1-2-3-8
/// Masukan: Logit, p = 0.5
/// Hasil yang Diharapkan: eta = ln(0.5 / 0.5) = 0.0
#[test]
fn test_link_function_path_k1_logit() {
    let eta = link(0.5, LinkFunction::Logit);
    assert!((eta - 0.0).abs() < 1e-12, "Logit(0.5) harus sama dengan 0.0");
}

/// Jalur K-2: 1-2-4-8
/// Masukan: Probit, p = 0.975
/// Hasil yang Diharapkan: eta = Phi^(-1)(0.975) ≈ 1.95996
#[test]
fn test_link_function_path_k2_probit() {
    let eta = link(0.975, LinkFunction::Probit);
    assert!(
        (eta - 1.95996).abs() < 1e-4,
        "Probit(0.975) harus mendekati kuantil normal baku 1.95996"
    );
}

/// Jalur K-3: 1-2-5-8
/// Masukan: Complementary log-log, p = 0.5
/// Hasil yang Diharapkan: eta = ln(-ln(1 - 0.5)) = ln(ln(2)) ≈ -0.36651
#[test]
fn test_link_function_path_k3_cloglog() {
    let eta = link(0.5, LinkFunction::ComplementaryLogLog);
    assert!(
        (eta - (-0.36651)).abs() < 1e-4,
        "CLogLog(0.5) harus mendekati -0.36651"
    );
}

/// Jalur K-4: 1-2-6-8
/// Masukan: Negative log-log, p = 0.5
/// Hasil yang Diharapkan: eta = -ln(-ln(0.5)) = -ln(ln(2)) ≈ 0.36651
#[test]
fn test_link_function_path_k4_nloglog() {
    let eta = link(0.5, LinkFunction::NegativeLogLog);
    assert!(
        (eta - 0.36651).abs() < 1e-4,
        "NLogLog(0.5) harus mendekati 0.36651"
    );
}

/// Jalur K-5: 1-2-7-8
/// Masukan: Cauchit, p = 0.75
/// Hasil yang Diharapkan: eta = tan(pi * (0.75 - 0.5)) = tan(pi / 4) = 1.0
#[test]
fn test_link_function_path_k5_cauchit() {
    let eta = link(0.75, LinkFunction::Cauchit);
    assert!(
        (eta - 1.0).abs() < 1e-12,
        "Cauchit(0.75) harus sama persis dengan tan(pi/4) = 1.0"
    );
}

/// Uji Batas Tambahan (Boundary Values): p = 0.0 dan p = 1.0
/// Memastikan perlindungan simpul 1 (pembatasan probabilitas / clamping)
/// menghasilkan nilai berhingga dan tidak mengalami panic / infinity tak terkendali.
#[test]
fn test_link_functions_boundary_clamping() {
    let links = [
        LinkFunction::Logit,
        LinkFunction::Probit,
        LinkFunction::ComplementaryLogLog,
        LinkFunction::NegativeLogLog,
        LinkFunction::Cauchit,
    ];

    for &l in &links {
        let eta_zero = link(0.0, l);
        let eta_one = link(1.0, l);

        assert!(
            eta_zero.is_finite(),
            "Link {:?} pada p=0.0 harus menghasilkan nilai berhingga berkat clamping",
            l
        );
        assert!(
            eta_one.is_finite(),
            "Link {:?} pada p=1.0 harus menghasilkan nilai berhingga berkat clamping",
            l
        );
    }

    // Contoh analitik dari dokumen: Logit pada p=0.0 mendekati ln(1e-12 / (1 - 1e-12)) ≈ -27.63 (atau sesuai EPS)
    let logit_zero = link(0.0, LinkFunction::Logit);
    assert!(
        logit_zero < -20.0,
        "Logit(0.0) harus bernilai negatif besar berhingga"
    );
}
