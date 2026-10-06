//! Test Fase S4: API fit / transform / fit_transform, resep (TextVectorizerModel) dan CSR.
//! Angka acuan (golden) diambil persis dari PLAN_FIX.md §3.6 (toleransi 1e-6).

use statify_text_core::{
    fit, fit_transform, output_from_model, run_pipeline, transform, CsrMatrix, TextVectorizerConfig,
    TextVectorizerModel,
};

const TOL: f64 = 1e-6;

/// Korpus acuan D (PLAN_FIX.md §3.6).
fn korpus_d() -> Vec<String> {
    vec![
        "Saya suka makan nasi".to_string(),
        "Saya tidak suka nasi!".to_string(),
        "Makan, makan, makan".to_string(),
    ]
}

fn docs(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// Config dasar (Weka raw/none/none); field dapat ditimpa lewat `overrides`.
fn cfg(overrides: serde_json::Value) -> TextVectorizerConfig {
    let mut base = serde_json::json!({
        "lowercase": true,
        "stemming_method": "none",
        "stopwords_method": "none",
        "custom_stopwords": null,
        "delimiters": r#"[\s.,;:'"()?!]+"#,
        "ngram_min": 1,
        "ngram_max": 1,
        "formula_standard": "weka",
        "tf_method": "raw",
        "idf_method": "none",
        "normalization": "none",
        "words_to_keep": 1000,
        "min_term_freq": 1,
    });
    if let (Some(b), Some(o)) = (base.as_object_mut(), overrides.as_object()) {
        for (k, v) in o {
            b.insert(k.clone(), v.clone());
        }
    }
    TextVectorizerConfig::from_json_value(base).expect("config uji harus valid")
}

fn assert_matrix(actual: &[Vec<f64>], expected: &[Vec<f64>]) {
    assert_eq!(actual.len(), expected.len(), "jumlah baris berbeda");
    for (r, (a_row, e_row)) in actual.iter().zip(expected.iter()).enumerate() {
        assert_eq!(a_row.len(), e_row.len(), "jumlah kolom baris {} berbeda", r);
        for (c, (a, e)) in a_row.iter().zip(e_row.iter()).enumerate() {
            assert!((a - e).abs() < TOL, "sel [{}][{}]: dapat {} seharusnya {}", r, c, a, e);
        }
    }
}

fn assert_close(a: f64, e: f64) {
    assert!((a - e).abs() < TOL, "dapat {} seharusnya {}", a, e);
}

const VOCAB_D: [&str; 5] = ["makan", "nasi", "saya", "suka", "tidak"];

/// Tujuh konfigurasi golden §3.6 beserta matriks acuannya.
fn golden_cases() -> Vec<(&'static str, serde_json::Value, Vec<Vec<f64>>)> {
    vec![
        (
            "lama sublinear/smooth/none (custom)",
            serde_json::json!({ "formula_standard": "custom", "tf_method": "sublinear", "idf_method": "smooth" }),
            vec![
                vec![1.287682, 1.287682, 1.287682, 1.287682, 0.0],
                vec![0.0, 1.287682, 1.287682, 1.287682, 1.693147],
                vec![2.702345, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "weka raw/none/none",
            serde_json::json!({}),
            vec![
                vec![1.0, 1.0, 1.0, 1.0, 0.0],
                vec![0.0, 1.0, 1.0, 1.0, 1.0],
                vec![3.0, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "weka log1p/standard/none",
            serde_json::json!({ "tf_method": "log1p", "idf_method": "standard" }),
            vec![
                vec![0.281047, 0.281047, 0.281047, 0.281047, 0.0],
                vec![0.0, 0.281047, 0.281047, 0.281047, 0.761500],
                vec![0.562094, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "weka raw/standard/doc_length",
            serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }),
            vec![
                vec![0.555204, 0.555204, 0.555204, 0.555204, 0.0],
                vec![0.0, 0.345296, 0.345296, 0.345296, 0.935584],
                vec![1.110408, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "sklearn raw/smooth/l2",
            serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" }),
            vec![
                vec![0.5, 0.5, 0.5, 0.5, 0.0],
                vec![0.0, 0.459854, 0.459854, 0.459854, 0.604652],
                vec![1.0, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "sklearn raw/plus1/l2",
            serde_json::json!({ "formula_standard": "sklearn", "idf_method": "plus1", "normalization": "l2" }),
            vec![
                vec![0.5, 0.5, 0.5, 0.5, 0.0],
                vec![0.0, 0.437287, 0.437287, 0.437287, 0.652948],
                vec![1.0, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
        (
            "sklearn raw/smooth/none",
            serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth" }),
            vec![
                vec![1.287682, 1.287682, 1.287682, 1.287682, 0.0],
                vec![0.0, 1.287682, 1.287682, 1.287682, 1.693147],
                vec![3.863046, 0.0, 0.0, 0.0, 0.0],
            ],
        ),
    ]
}

/// Bandingkan dua CSR secara EKSAK (struktur dan nilai bit-per-bit): fit_transform dan
/// transform(fit) memakai jalur perhitungan yang sama sehingga harus identik.
fn assert_csr_identik(a: &CsrMatrix, b: &CsrMatrix) {
    assert_eq!(a, b);
}

// ── Ekuivalensi transform(fit(D), D) == fit_transform(D) ─────────────────────

#[test]
fn transform_fit_sama_dengan_fit_transform_untuk_semua_golden() {
    let d = korpus_d();
    for (nama, overrides, expected) in golden_cases() {
        let config = cfg(overrides);
        let model = fit(&d, &config).unwrap_or_else(|e| panic!("{}: fit gagal: {}", nama, e));
        let via_transform = transform(&model, &d).unwrap_or_else(|e| panic!("{}: transform gagal: {}", nama, e));
        let (model2, via_ft) = fit_transform(&d, &config).unwrap_or_else(|e| panic!("{}: {}", nama, e));

        assert_csr_identik(&via_transform, &via_ft);
        assert_eq!(model.vocabulary, model2.vocabulary, "{}", nama);
        assert_eq!(model.vocabulary, VOCAB_D, "{}", nama);
        assert_eq!(model.idf, model2.idf, "{}", nama);
        assert_eq!(model.doc_freq, model2.doc_freq, "{}", nama);
        assert_eq!(model.avg_doc_norm, model2.avg_doc_norm, "{}", nama);
        // Golden §3.6 lewat to_dense()
        assert_matrix(&via_ft.to_dense(), &expected);
    }
}

#[test]
fn transform_fit_sama_dengan_fit_transform_untuk_konfigurasi_lain() {
    let d = docs(&[
        "Makan nasi goreng enak sekali",
        "",
        "nasi goreng nasi goreng pedas",
        "Minum teh manis, minum kopi pahit!",
        "makan makan makan",
    ]);
    let variasi = vec![
        serde_json::json!({ "ngram_min": 1, "ngram_max": 2, "tf_method": "log1p", "idf_method": "standard" }),
        serde_json::json!({ "formula_standard": "sklearn", "tf_method": "sublinear", "idf_method": "plus1", "normalization": "l1" }),
        serde_json::json!({ "formula_standard": "custom", "tf_method": "normalized", "idf_method": "smooth", "normalization": "l2", "words_to_keep": 4 }),
        serde_json::json!({ "words_to_keep": 3, "min_term_freq": 2 }),
        serde_json::json!({ "tf_method": "binary", "idf_method": "standard", "normalization": "doc_length", "words_to_keep": 0 }),
        serde_json::json!({ "stemming_method": "indonesian" }),
    ];
    for overrides in variasi {
        let config = cfg(overrides.clone());
        let model = fit(&d, &config).expect("fit");
        let (_, via_ft) = fit_transform(&d, &config).expect("fit_transform");
        let via_transform = transform(&model, &d).expect("transform");
        assert_csr_identik(&via_transform, &via_ft);
        assert_eq!(via_ft.n_rows, d.len(), "{}", overrides);
    }
}

#[test]
fn keluaran_run_pipeline_sama_dengan_to_dense_fit_transform() {
    let d = korpus_d();
    let config = cfg(serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" }));
    let (model, csr) = fit_transform(&d, &config).unwrap();
    let dari_csr = output_from_model(&model, &csr);
    let dari_pipeline = run_pipeline(&d, &config).unwrap();
    assert_eq!(dari_csr.vocabulary, dari_pipeline.vocabulary);
    assert_eq!(dari_csr.matrix, dari_pipeline.matrix);
    assert_eq!(dari_csr.stats.total_documents, 3);
    assert_eq!(dari_csr.stats.empty_documents, 0);
    assert_eq!(dari_csr.stats.vocabulary_size, 5);
    assert_eq!(dari_csr.stats.formula_standard, "sklearn");
    assert_eq!(
        dari_csr.stats.method,
        "TF: raw, IDF: smooth, Norm: l2, Keep: 1000, MinFreq: 1"
    );
}

// ── Isi resep ────────────────────────────────────────────────────────────────

#[test]
fn isi_model_pada_korpus_d() {
    let model = fit(&korpus_d(), &cfg(serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" }))).unwrap();
    assert_eq!(model.recipe_version, "1.0");
    assert_eq!(model.vocabulary, VOCAB_D);
    assert_eq!(model.n_docs, 3);
    assert_eq!(model.doc_freq, vec![2, 2, 2, 2, 1]);
    assert_eq!(model.idf.len(), 5);
    for (i, e) in [1.287682, 1.287682, 1.287682, 1.287682, 1.693147].iter().enumerate() {
        assert_close(model.idf[i], *e);
    }
    assert_eq!(model.avg_doc_norm, None, "avg_doc_norm hanya untuk doc_length");
    assert!(model.resolved_stopwords.is_empty());
}

#[test]
fn idf_none_menyimpan_satu_dan_idf_plus1_sesuai_golden() {
    let none = fit(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    assert_eq!(none.idf, vec![1.0; 5]);
    let plus1 = fit(&korpus_d(), &cfg(serde_json::json!({ "formula_standard": "sklearn", "idf_method": "plus1", "normalization": "l2" }))).unwrap();
    assert_close(plus1.idf[0], 1.405465);
    assert_close(plus1.idf[4], 2.098612);
}

#[test]
fn resolved_stopwords_lowercase_unik_dan_urut_alfabetis() {
    let config = cfg(serde_json::json!({
        "stopwords_method": "custom",
        "custom_stopwords": r#"["Yang","di","YANG","ke","Dan"]"#,
    }));
    let model = fit(&docs(&["makan nasi yang enak di rumah"]), &config).unwrap();
    assert_eq!(model.resolved_stopwords, vec!["dan", "di", "ke", "yang"]);
    assert!(!model.vocabulary.contains(&"yang".to_string()));
    assert!(!model.vocabulary.contains(&"di".to_string()));
}

#[test]
fn transform_memakai_resolved_stopwords_dari_model_bukan_config() {
    let config = cfg(serde_json::json!({
        "stopwords_method": "custom",
        "custom_stopwords": r#"["yang"]"#,
    }));
    let mut model = fit(&docs(&["makan nasi yang enak", "minum teh yang manis"]), &config).unwrap();
    // JSON di config sengaja dirusak: transform tidak boleh mem-parse ulang, hanya memakai daftar final di model.
    model.config.custom_stopwords = Some("bukan json".to_string());
    let csr = transform(&model, &docs(&["makan yang nasi"])).expect("transform tidak boleh gagal karena config");
    let dense = csr.to_dense();
    let col = |t: &str| model.vocabulary.iter().position(|v| v == t).unwrap();
    assert_close(dense[0][col("makan")], 1.0);
    assert_close(dense[0][col("nasi")], 1.0);
    assert!(!model.vocabulary.contains(&"yang".to_string()));
}

// ── T13: fit pada train, transform data baru ─────────────────────────────────

#[test]
fn t13_kosakata_tetap_oov_diabaikan_idf_memakai_n_latih() {
    let train = docs(&["makan nasi", "minum teh"]);
    let baru = docs(&["makan teh kopi"]);
    // Standar sklearn smooth: idf = ln((1+2)/(1+1)) + 1 = 1.405465 untuk setiap term (N=2, df=1).
    let config = cfg(serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth" }));
    let model = fit(&train, &config).unwrap();
    assert_eq!(model.vocabulary, vec!["makan", "minum", "nasi", "teh"]);
    assert_eq!(model.n_docs, 2);

    let csr = transform(&model, &baru).unwrap();
    assert_eq!(csr.n_rows, 1);
    assert_eq!(csr.n_cols, 4);
    assert_matrix(&csr.to_dense(), &[vec![1.405465, 0.0, 0.0, 1.405465]]);
    // "kopi" (OOV) tidak membentuk kolom/entri apa pun.
    assert_eq!(csr.indices, vec![0, 3]);

    // Bila IDF dihitung ulang dari data transform (N=1, df=1) nilainya 1.0 — harus BUKAN itu.
    assert!((csr.data[0] - 1.0).abs() > 0.1);

    // Weka standard: idf = ln(N/df) = ln(2) = 0.693147 (N=2 dari data latih).
    let weka = fit(&train, &cfg(serde_json::json!({ "idf_method": "standard" }))).unwrap();
    let dense = transform(&weka, &baru).unwrap().to_dense();
    assert_matrix(&dense, &[vec![0.693147, 0.0, 0.0, 0.693147]]);
}

// ── T14: dokumen seluruhnya OOV → baris nol ──────────────────────────────────

#[test]
fn t14_dokumen_seluruhnya_oov_menjadi_baris_nol_tanpa_error() {
    let model = fit(&docs(&["makan nasi", "minum teh"]), &cfg(serde_json::json!({}))).unwrap();
    let csr = transform(&model, &docs(&["kopi susu roti"])).expect("OOV tidak boleh error");
    assert_eq!(csr.n_rows, 1);
    assert_eq!(csr.indptr, vec![0, 0]);
    assert!(csr.indices.is_empty() && csr.data.is_empty());
    assert_eq!(csr.to_dense(), vec![vec![0.0; 4]]);
}

#[test]
fn dokumen_kosong_dan_oov_di_tengah_tetap_sejajar_dan_tanpa_nan() {
    let model = fit(
        &korpus_d(),
        &cfg(serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" })),
    )
    .unwrap();
    let baru = docs(&["saya suka kopi", "", "   ", "kopi teh", "makan"]);
    let csr = transform(&model, &baru).unwrap();
    assert_eq!(csr.n_rows, 5);
    let dense = csr.to_dense();
    assert!(dense.iter().flatten().all(|x| x.is_finite()));
    assert_eq!(dense[1], vec![0.0; 5]);
    assert_eq!(dense[2], vec![0.0; 5]);
    assert_eq!(dense[3], vec![0.0; 5]);
    // Baris ke-0: "saya" dan "suka" (kopi OOV), keduanya idf 1.287682 → l2: 1/√2 tiap kolom.
    assert_close(dense[0][2], 1.0 / 2.0_f64.sqrt());
    assert_close(dense[0][3], 1.0 / 2.0_f64.sqrt());
    assert_close(dense[4][0], 1.0);
}

// ── doc_length memakai avg_doc_norm tersimpan ────────────────────────────────

#[test]
fn doc_length_memakai_avg_doc_norm_tersimpan_bukan_dari_data_transform() {
    let config = cfg(serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }));
    let model = fit(&korpus_d(), &config).unwrap();
    let avg = model.avg_doc_norm.expect("doc_length harus menyimpan avg_doc_norm");
    assert_close(avg, 1.110408);

    // "makan nasi": makan df=2, nasi df=2 → idf ln(3/2) tiap term; norma ≠ avg.
    let csr = transform(&model, &docs(&["makan nasi"])).unwrap();
    let dense = csr.to_dense();
    // Setelah doc_length: tiap sel = avg / √2 (dua sel sama besar). Bila avg dihitung dari data
    // transform (satu dokumen), hasilnya akan sama dengan nilai asli 0.405465 — bukan nilai ini.
    let diharapkan = avg / 2.0_f64.sqrt();
    assert_close(dense[0][0], diharapkan);
    assert_close(dense[0][1], diharapkan);
    assert_close(diharapkan, 0.785177);
    assert!((dense[0][0] - 3.0_f64.ln() + 2.0_f64.ln()).abs() > 0.1, "tidak boleh sama dengan nilai tanpa normalisasi");
    // Norma baris hasil = avg_doc_norm tersimpan.
    let norma = (dense[0][0].powi(2) + dense[0][1].powi(2)).sqrt();
    assert_close(norma, avg);
}

#[test]
fn doc_length_tanpa_avg_doc_norm_pada_model_menghasilkan_invalid_data() {
    let mut model = fit(&korpus_d(), &cfg(serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }))).unwrap();
    model.avg_doc_norm = None;
    let err = transform(&model, &korpus_d()).unwrap_err();
    assert_eq!(err.code, "INVALID_DATA");
}

// ── Serialisasi model ────────────────────────────────────────────────────────

#[test]
fn model_json_roundtrip_menghasilkan_transform_identik() {
    let d = korpus_d();
    for (nama, overrides, _) in golden_cases() {
        let config = cfg(overrides);
        let (model, csr_asli) = fit_transform(&d, &config).unwrap();
        let json = serde_json::to_string(&model).unwrap_or_else(|e| panic!("{}: {}", nama, e));
        let pulih: TextVectorizerModel = serde_json::from_str(&json).unwrap_or_else(|e| panic!("{}: {}", nama, e));
        assert_eq!(pulih.vocabulary, model.vocabulary, "{}", nama);
        assert_eq!(pulih.idf.len(), model.idf.len(), "{}", nama);
        for (x, y) in pulih.idf.iter().zip(model.idf.iter()) {
            assert_eq!(x, y, "{}", nama); // eksak berkat float_roundtrip
        }
        assert_eq!(pulih.doc_freq, model.doc_freq, "{}", nama);
        assert_eq!(pulih.n_docs, model.n_docs, "{}", nama);
        assert_eq!(pulih.avg_doc_norm, model.avg_doc_norm, "{}", nama);
        assert_csr_identik(&transform(&pulih, &d).unwrap(), &csr_asli);
        // Juga pada data baru
        let baru = docs(&["Saya makan kopi", "tidak suka teh"]);
        assert_csr_identik(&transform(&pulih, &baru).unwrap(), &transform(&model, &baru).unwrap());
    }
}

#[test]
fn model_json_memuat_kunci_sesuai_kontrak() {
    let model = fit(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    let v = serde_json::to_value(&model).unwrap();
    for kunci in [
        "recipe_version", "config", "resolved_stopwords", "vocabulary", "idf", "doc_freq", "n_docs", "avg_doc_norm",
    ] {
        assert!(v.get(kunci).is_some(), "kunci {} hilang", kunci);
    }
    assert_eq!(v["recipe_version"], "1.0");
    assert!(v["avg_doc_norm"].is_null());
}

#[test]
fn csr_json_roundtrip() {
    let (_, csr) = fit_transform(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    let pulih: CsrMatrix = serde_json::from_str(&serde_json::to_string(&csr).unwrap()).unwrap();
    assert_eq!(pulih, csr);
}

// ── Invarian CSR ─────────────────────────────────────────────────────────────

#[test]
fn csr_invarian_dan_to_dense_raw_count() {
    let (_, csr) = fit_transform(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    assert_eq!(csr.n_rows, 3);
    assert_eq!(csr.n_cols, 5);
    assert_eq!(csr.indptr, vec![0, 4, 8, 9]);
    assert_eq!(csr.indices, vec![0, 1, 2, 3, 1, 2, 3, 4, 0]);
    assert_eq!(csr.data, vec![1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 3.0]);
    assert_eq!(
        csr.to_dense(),
        vec![
            vec![1.0, 1.0, 1.0, 1.0, 0.0],
            vec![0.0, 1.0, 1.0, 1.0, 1.0],
            vec![3.0, 0.0, 0.0, 0.0, 0.0],
        ]
    );
}

#[test]
fn csr_indeks_kolom_urut_menaik_per_baris() {
    let d = docs(&["zebra apel mangga apel", "mangga zebra", "apel"]);
    let (model, csr) = fit_transform(&d, &cfg(serde_json::json!({}))).unwrap();
    assert_eq!(model.vocabulary, vec!["apel", "mangga", "zebra"]);
    assert_eq!(csr.indptr.len(), csr.n_rows + 1);
    assert_eq!(*csr.indptr.last().unwrap(), csr.indices.len());
    for r in 0..csr.n_rows {
        let baris = &csr.indices[csr.indptr[r]..csr.indptr[r + 1]];
        assert!(baris.windows(2).all(|w| w[0] < w[1]), "baris {} tidak urut", r);
        assert!(baris.iter().all(|&c| (c as usize) < csr.n_cols));
    }
}

#[test]
fn to_dense_tidak_panic_pada_csr_rusak() {
    let rusak = CsrMatrix { n_rows: 3, n_cols: 2, indptr: vec![0, 5], indices: vec![0, 9], data: vec![1.0] };
    let dense = rusak.to_dense();
    assert_eq!(dense.len(), 3);
    assert!(dense.iter().all(|r| r.len() == 2));
}

// ── Validasi & error ─────────────────────────────────────────────────────────

#[test]
fn fit_menerapkan_validasi_yang_sama_dengan_run_pipeline() {
    let config = cfg(serde_json::json!({}));
    assert_eq!(fit(&[], &config).unwrap_err().code, "EMPTY_INPUT");
    assert_eq!(fit(&docs(&["", "  "]), &config).unwrap_err().code, "EMPTY_INPUT");
    let bad = cfg(serde_json::json!({ "formula_standard": "weka", "tf_method": "sublinear" }));
    assert_eq!(fit(&korpus_d(), &bad).unwrap_err().code, "INVALID_CONFIG");
    let rusak = cfg(serde_json::json!({ "stopwords_method": "custom", "custom_stopwords": "bukan json" }));
    assert_eq!(fit(&korpus_d(), &rusak).unwrap_err().code, "INVALID_STOPWORDS");
    let min = cfg(serde_json::json!({ "min_term_freq": 99 }));
    assert_eq!(fit(&korpus_d(), &min).unwrap_err().code, "EMPTY_VOCABULARY");
}

#[test]
fn transform_menolak_array_kosong_dan_model_tidak_valid() {
    let model = fit(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    assert_eq!(transform(&model, &[]).unwrap_err().code, "EMPTY_INPUT");

    let mut versi = model.clone();
    versi.recipe_version = "9.9".to_string();
    assert_eq!(transform(&versi, &korpus_d()).unwrap_err().code, "INVALID_DATA");

    let mut panjang = model.clone();
    panjang.idf.pop();
    assert_eq!(transform(&panjang, &korpus_d()).unwrap_err().code, "INVALID_DATA");

    let mut kosong = model.clone();
    kosong.vocabulary.clear();
    kosong.idf.clear();
    kosong.doc_freq.clear();
    assert_eq!(transform(&kosong, &korpus_d()).unwrap_err().code, "EMPTY_VOCABULARY");
}

#[test]
fn transform_dokumen_semua_kosong_diperbolehkan_menjadi_baris_nol() {
    // Berbeda dari fit: pada data baru, dokumen kosong semua bukan error (hasilnya baris nol).
    let model = fit(&korpus_d(), &cfg(serde_json::json!({}))).unwrap();
    let csr = transform(&model, &docs(&["", "   "])).unwrap();
    assert_eq!(csr.to_dense(), vec![vec![0.0; 5]; 2]);
}

#[test]
fn ngram_pada_resep_dipakai_saat_transform() {
    let config = cfg(serde_json::json!({ "ngram_min": 1, "ngram_max": 2 }));
    let model = fit(&docs(&["makan nasi goreng", "minum teh"]), &config).unwrap();
    assert!(model.vocabulary.contains(&"makan nasi".to_string()));
    let dense = transform(&model, &docs(&["makan nasi goreng"])).unwrap().to_dense();
    let col = |t: &str| model.vocabulary.iter().position(|v| v == t).unwrap();
    assert_close(dense[0][col("makan nasi")], 1.0);
    assert_close(dense[0][col("nasi goreng")], 1.0);
    assert_close(dense[0][col("minum teh")], 0.0);
}
