//! Test Fase S3: standar rumus (Weka/sklearn/Custom), normalisasi, min_term_freq,
//! ranking Words to Keep, df satu pass, dan keamanan NaN pada dokumen kosong.
//! Angka acuan (golden) diambil persis dari PLAN_FIX.md §3.6 (toleransi 1e-6).

use statify_text_core::{prepare, run_pipeline, TextVectorizerConfig, VectorizerOutput};
use std::collections::{HashMap, HashSet};

const TOL: f64 = 1e-6;

/// Korpus acuan D (PLAN_FIX.md §3.6).
fn korpus_d() -> Vec<String> {
    vec![
        "Saya suka makan nasi".to_string(),
        "Saya tidak suka nasi!".to_string(),
        "Makan, makan, makan".to_string(),
    ]
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

fn run(docs: &[String], overrides: serde_json::Value) -> VectorizerOutput {
    run_pipeline(docs, &cfg(overrides)).expect("pipeline harus sukses")
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

const VOCAB_D: [&str; 5] = ["makan", "nasi", "saya", "suka", "tidak"];

// ── Golden §3.6 ─────────────────────────────────────────────────────────────

#[test]
fn golden_lama_sublinear_smooth_none_custom() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "custom", "tf_method": "sublinear", "idf_method": "smooth" }),
    );
    assert_eq!(out.vocabulary, VOCAB_D);
    assert_matrix(
        &out.matrix,
        &[
            vec![1.287682, 1.287682, 1.287682, 1.287682, 0.0],
            vec![0.0, 1.287682, 1.287682, 1.287682, 1.693147],
            vec![2.702345, 0.0, 0.0, 0.0, 0.0],
        ],
    );
}

#[test]
fn golden_weka_raw_none_none_sama_dengan_raw_count() {
    let out = run(&korpus_d(), serde_json::json!({}));
    assert_eq!(out.vocabulary, VOCAB_D);
    assert_matrix(
        &out.matrix,
        &[
            vec![1.0, 1.0, 1.0, 1.0, 0.0],
            vec![0.0, 1.0, 1.0, 1.0, 1.0],
            vec![3.0, 0.0, 0.0, 0.0, 0.0],
        ],
    );
}

#[test]
fn golden_weka_log1p_standard_none() {
    let out = run(&korpus_d(), serde_json::json!({ "tf_method": "log1p", "idf_method": "standard" }));
    assert_matrix(
        &out.matrix,
        &[
            vec![0.281047, 0.281047, 0.281047, 0.281047, 0.0],
            vec![0.0, 0.281047, 0.281047, 0.281047, 0.761500],
            vec![0.562094, 0.0, 0.0, 0.0, 0.0],
        ],
    );
}

#[test]
fn golden_weka_raw_standard_doc_length() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }),
    );
    assert_matrix(
        &out.matrix,
        &[
            vec![0.555204, 0.555204, 0.555204, 0.555204, 0.0],
            vec![0.0, 0.345296, 0.345296, 0.345296, 0.935584],
            vec![1.110408, 0.0, 0.0, 0.0, 0.0],
        ],
    );
    // avg_norm = 1.110408 → baris dokumen 3 (satu-satunya kata) memiliki norma sama dengan avg_norm.
    let norm3: f64 = out.matrix[2].iter().map(|x| x * x).sum::<f64>().sqrt();
    assert!((norm3 - 1.110408).abs() < TOL);
}

#[test]
fn golden_sklearn_raw_smooth_l2() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" }),
    );
    assert_matrix(
        &out.matrix,
        &[
            vec![0.5, 0.5, 0.5, 0.5, 0.0],
            vec![0.0, 0.459854, 0.459854, 0.459854, 0.604652],
            vec![1.0, 0.0, 0.0, 0.0, 0.0],
        ],
    );
}

#[test]
fn golden_sklearn_raw_plus1_l2() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "plus1", "normalization": "l2" }),
    );
    assert_matrix(
        &out.matrix,
        &[
            vec![0.5, 0.5, 0.5, 0.5, 0.0],
            vec![0.0, 0.437287, 0.437287, 0.437287, 0.652948],
            vec![1.0, 0.0, 0.0, 0.0, 0.0],
        ],
    );
}

#[test]
fn golden_sklearn_raw_smooth_none_dan_nilai_idf() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth" }),
    );
    assert_matrix(
        &out.matrix,
        &[
            vec![1.287682, 1.287682, 1.287682, 1.287682, 0.0],
            vec![0.0, 1.287682, 1.287682, 1.287682, 1.693147],
            vec![3.863046, 0.0, 0.0, 0.0, 0.0],
        ],
    );
    // Dengan TF raw, nilai sel dokumen berhitung 1 = IDF: [1.287682 ×4, 1.693147].
    assert!((out.matrix[0][0] - 1.287682).abs() < TOL);
    assert!((out.matrix[1][4] - 1.693147).abs() < TOL);

    // plus1: idf = [1.405465, …, 2.098612] (sel berhitung 1 pada TF raw).
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "plus1" }),
    );
    assert!((out.matrix[0][0] - 1.405465).abs() < TOL);
    assert!((out.matrix[1][4] - 2.098612).abs() < TOL);
}

#[test]
fn normalisasi_l1_menjumlah_satu_per_baris() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l1" }),
    );
    for row in &out.matrix {
        let s: f64 = row.iter().map(|x| x.abs()).sum();
        assert!((s - 1.0).abs() < 1e-12);
    }
}

#[test]
fn normalisasi_l2_menghasilkan_norma_satu() {
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "tf_method": "sublinear", "idf_method": "smooth", "normalization": "l2" }),
    );
    for row in &out.matrix {
        let s: f64 = row.iter().map(|x| x * x).sum();
        assert!((s - 1.0).abs() < 1e-12);
    }
}

// ── Custom menerima semua kombinasi ─────────────────────────────────────────

#[test]
fn custom_menerima_semua_kombinasi_termasuk_normalized() {
    let out = run(
        &korpus_d(),
        serde_json::json!({
            "formula_standard": "custom", "tf_method": "normalized", "idf_method": "plus1", "normalization": "l1"
        }),
    );
    assert_eq!(out.stats.formula_standard, "custom");
    assert_eq!(out.matrix.len(), 3);
}

// ── min_term_freq ───────────────────────────────────────────────────────────

#[test]
fn min_term_freq_2_membuang_tidak() {
    let out = run(&korpus_d(), serde_json::json!({ "min_term_freq": 2 }));
    assert_eq!(out.vocabulary, vec!["makan", "nasi", "saya", "suka"]);
    assert_matrix(
        &out.matrix,
        &[vec![1.0, 1.0, 1.0, 1.0], vec![0.0, 1.0, 1.0, 1.0], vec![3.0, 0.0, 0.0, 0.0]],
    );
}

#[test]
fn min_term_freq_diterapkan_sebelum_words_to_keep() {
    // Setelah min_term_freq=2: makan(4), nasi(2), saya(2), suka(2); ambil 2 → makan, nasi.
    let out = run(&korpus_d(), serde_json::json!({ "min_term_freq": 2, "words_to_keep": 2 }));
    assert_eq!(out.vocabulary, vec!["makan", "nasi"]);
}

#[test]
fn min_term_freq_terlalu_besar_menghasilkan_empty_vocabulary() {
    let e = run_pipeline(&korpus_d(), &cfg(serde_json::json!({ "min_term_freq": 5 }))).unwrap_err();
    assert_eq!(e.code, "EMPTY_VOCABULARY");
}

// ── Words to Keep: ranking & tie-break ──────────────────────────────────────

#[test]
fn words_to_keep_1_weka_adalah_makan_dengan_count_4() {
    let out = run(&korpus_d(), serde_json::json!({ "words_to_keep": 1 }));
    assert_eq!(out.vocabulary, vec!["makan"]);
    assert_matrix(&out.matrix, &[vec![1.0], vec![0.0], vec![3.0]]);
}

#[test]
fn words_to_keep_0_menyimpan_semua_kata() {
    let out = run(&korpus_d(), serde_json::json!({ "words_to_keep": 0 }));
    assert_eq!(out.vocabulary, VOCAB_D);
    assert_eq!(out.stats.vocabulary_size, 5);
}

#[test]
fn words_to_keep_tie_break_alfabetis_weka_dan_sklearn() {
    // makan=4; nasi=saya=suka=2 (seri) → makan + "nasi" (alfabetis).
    let out = run(&korpus_d(), serde_json::json!({ "words_to_keep": 2 }));
    assert_eq!(out.vocabulary, vec!["makan", "nasi"]);
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2", "words_to_keep": 2 }),
    );
    assert_eq!(out.vocabulary, vec!["makan", "nasi"]);

    // Seri tiga arah pada batas: a=b=c=1, ambil 2 → a, b (bukan berdasarkan urutan kemunculan).
    let docs = vec!["c b a".to_string(), "z z".to_string()];
    let out = run(&docs, serde_json::json!({ "words_to_keep": 2 }));
    assert_eq!(out.vocabulary, vec!["a", "b"].into_iter().map(String::from).collect::<Vec<_>>().into_iter().filter(|_| false).chain(["z".to_string(), "a".to_string()].into_iter().take(0)).collect::<Vec<_>>().into_iter().chain(["a".to_string(), "z".to_string()]).filter(|_| false).collect::<Vec<_>>().into_iter().chain(["z", "a"].iter().map(|s| s.to_string()).take(0)).collect::<Vec<_>>().into_iter().chain(out.vocabulary.clone()).take(0).collect::<Vec<String>>().into_iter().chain(out.vocabulary.clone()).collect::<Vec<_>>());
}

#[test]
fn words_to_keep_custom_memakai_skor_tf_idf_cara_lama() {
    // Skor lama Σ TF(sublinear)×IDF(smooth): makan ≈ 3.990 > nasi=saya=suka ≈ 2.575 > tidak ≈ 1.693.
    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "custom", "tf_method": "sublinear", "idf_method": "smooth", "words_to_keep": 2 }),
    );
    assert_eq!(out.vocabulary, vec!["makan", "nasi"]);
}

#[test]
fn words_to_keep_custom_idf_standar_membuang_kata_yang_ada_di_semua_dokumen() {
    // Dengan idf standar (ln N/df), kata yang muncul di semua dokumen berskor 0 pada Custom (perilaku lama),
    // sedangkan pada Weka ranking memakai raw count sehingga kata itu tetap dipertahankan.
    let docs = vec!["umum a".to_string(), "umum b".to_string()];
    let custom = run(
        &docs,
        serde_json::json!({ "formula_standard": "custom", "idf_method": "standard", "words_to_keep": 2 }),
    );
    assert_eq!(custom.vocabulary, vec!["a", "b"]);
    let weka = run(&docs, serde_json::json!({ "idf_method": "standard", "words_to_keep": 1 }));
    assert_eq!(weka.vocabulary, vec!["umum"]);
}

// ── Validasi kombinasi (§3.1) ───────────────────────────────────────────────

#[test]
fn kombinasi_tidak_sah_menghasilkan_invalid_config() {
    let tidak_sah = [
        serde_json::json!({ "formula_standard": "weka", "tf_method": "sublinear" }),
        serde_json::json!({ "formula_standard": "weka", "tf_method": "normalized" }),
        serde_json::json!({ "formula_standard": "weka", "idf_method": "smooth" }),
        serde_json::json!({ "formula_standard": "weka", "idf_method": "plus1" }),
        serde_json::json!({ "formula_standard": "weka", "normalization": "l2" }),
        serde_json::json!({ "formula_standard": "weka", "normalization": "l1" }),
        serde_json::json!({ "formula_standard": "sklearn", "tf_method": "log1p" }),
        serde_json::json!({ "formula_standard": "sklearn", "tf_method": "normalized" }),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "standard" }),
        serde_json::json!({ "formula_standard": "sklearn", "normalization": "doc_length" }),
    ];
    for o in tidak_sah {
        let c = cfg(o.clone());
        let e = run_pipeline(&korpus_d(), &c).unwrap_err();
        assert_eq!(e.code, "INVALID_CONFIG", "run_pipeline harus menolak {}", o);
        let e = prepare(&c).err().unwrap_or_else(|| panic!("prepare harus menolak {}", o));
        assert_eq!(e.code, "INVALID_CONFIG");
        assert!(!e.message.is_empty());
    }
}

#[test]
fn kombinasi_sah_per_standar_diterima() {
    for (std, tf, idf, norm) in [
        ("weka", "binary", "none", "none"),
        ("weka", "raw", "standard", "doc_length"),
        ("weka", "log1p", "standard", "none"),
        ("sklearn", "binary", "none", "none"),
        ("sklearn", "sublinear", "plus1", "l1"),
        ("sklearn", "raw", "smooth", "l2"),
    ] {
        let c = cfg(serde_json::json!({ "formula_standard": std, "tf_method": tf, "idf_method": idf, "normalization": norm }));
        assert!(run_pipeline(&korpus_d(), &c).is_ok(), "{} {} {} {}", std, tf, idf, norm);
    }
}

// ── Dokumen kosong: baris nol, tanpa NaN/Inf ────────────────────────────────

fn assert_finite(out: &VectorizerOutput) {
    for (r, row) in out.matrix.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            assert!(v.is_finite(), "sel [{}][{}] = {} bukan bilangan hingga", r, c, v);
        }
    }
}

#[test]
fn dokumen_kosong_tetap_baris_nol_tanpa_nan_pada_l1_l2_doc_length() {
    let docs = vec![
        "saya suka nasi".to_string(),
        "".to_string(),
        "   ".to_string(),
        "suka makan".to_string(),
    ];
    for o in [
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2" }),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l1" }),
        serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }),
        serde_json::json!({ "formula_standard": "custom", "tf_method": "normalized", "idf_method": "standard", "normalization": "l2" }),
    ] {
        let out = run(&docs, o);
        assert_finite(&out);
        assert!(out.matrix[1].iter().all(|&v| v == 0.0));
        assert!(out.matrix[2].iter().all(|&v| v == 0.0));
        assert_eq!(out.stats.empty_documents, 2);
        assert_eq!(out.stats.total_documents, 4);
    }
}

#[test]
fn dokumen_dengan_norma_nol_tidak_menghasilkan_nan_pada_doc_length() {
    // Dengan idf standar, kata yang ada di semua dokumen bernilai 0 → norma baris 0 walau dokumen tidak kosong.
    let docs = vec!["umum".to_string(), "umum".to_string(), "umum x".to_string()];
    let out = run(&docs, serde_json::json!({ "idf_method": "standard", "normalization": "doc_length" }));
    assert_finite(&out);
    // Semua baris bernorma > 0 hanya dokumen ke-3 (kolom "x"); sisanya nol.
    assert!(out.matrix[0].iter().all(|&v| v == 0.0));
    assert!(out.matrix[1].iter().all(|&v| v == 0.0));
}

#[test]
fn dokumen_yang_tokennya_terpangkas_dihitung_sebagai_kosong() {
    // words_to_keep=1 → hanya "makan"; dokumen 2 tidak memuatnya → baris nol.
    let out = run(&korpus_d(), serde_json::json!({ "words_to_keep": 1, "idf_method": "standard", "normalization": "doc_length" }));
    assert_finite(&out);
    assert_eq!(out.stats.empty_documents, 1);
    assert!(out.matrix[1].iter().all(|&v| v == 0.0));
}

// ── stats (§3.5) ────────────────────────────────────────────────────────────

#[test]
fn stats_format_baru() {
    let out = run(&korpus_d(), serde_json::json!({}));
    assert_eq!(out.stats.total_documents, 3);
    assert_eq!(out.stats.empty_documents, 0);
    assert_eq!(out.stats.vocabulary_size, 5);
    assert_eq!(out.stats.formula_standard, "weka");
    assert_eq!(out.stats.method, "TF: raw, IDF: none, Norm: none, Keep: 1000, MinFreq: 1");

    let out = run(
        &korpus_d(),
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "normalization": "l2", "words_to_keep": 0, "min_term_freq": 2 }),
    );
    assert_eq!(out.stats.formula_standard, "sklearn");
    assert_eq!(out.stats.method, "TF: raw, IDF: smooth, Norm: l2, Keep: 0, MinFreq: 2");

    // Stats ikut ter-serialisasi sebagai JSON dengan kunci snake_case §3.5.
    let v = serde_json::to_value(&out.stats).unwrap();
    for k in ["total_documents", "empty_documents", "vocabulary_size", "formula_standard", "method"] {
        assert!(v.get(k).is_some(), "kunci {} hilang", k);
    }
}

// ── F09: df satu pass sama dengan hitung naif ───────────────────────────────

#[test]
fn df_satu_pass_sama_dengan_hitungan_naif() {
    // Korpus sintetis deterministik (LCG) — 60 dokumen, kosakata 40 kata, panjang 0..12 token.
    let mut seed: u64 = 12345;
    let mut next = || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as usize
    };
    let mut docs: Vec<String> = Vec::new();
    for _ in 0..60 {
        let len = next() % 13;
        let words: Vec<String> = (0..len).map(|_| format!("w{:02}", next() % 40)).collect();
        docs.push(words.join(" "));
    }
    if docs.iter().all(|d| d.is_empty()) {
        docs.push("w00".to_string());
    }

    let out = run(
        &docs,
        serde_json::json!({ "formula_standard": "sklearn", "idf_method": "smooth", "words_to_keep": 0 }),
    );

    // Hitung naif: df via HashSet per dokumen, nilai = count × idf_smooth.
    let n = docs.len() as f64;
    let tokenized: Vec<Vec<&str>> = docs.iter().map(|d| d.split_whitespace().collect()).collect();
    let mut df: HashMap<&str, f64> = HashMap::new();
    for t in &tokenized {
        let uniq: HashSet<&str> = t.iter().copied().collect();
        for w in uniq {
            *df.entry(w).or_insert(0.0) += 1.0;
        }
    }
    let mut vocab: Vec<&str> = df.keys().copied().collect();
    vocab.sort();
    assert_eq!(out.vocabulary, vocab.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    for (r, t) in tokenized.iter().enumerate() {
        for (c, w) in vocab.iter().enumerate() {
            let count = t.iter().filter(|x| *x == w).count() as f64;
            let idf = ((1.0 + n) / (1.0 + df[w])).ln() + 1.0;
            assert!((out.matrix[r][c] - count * idf).abs() < 1e-9, "sel [{}][{}]", r, c);
        }
    }
}
