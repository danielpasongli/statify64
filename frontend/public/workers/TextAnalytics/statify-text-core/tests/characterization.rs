//! Characterization test untuk crate `statify-text-core` (Fase S1).
//!
//! Tujuan: MENGUNCI perilaku v1 (sebelum Fase S2/S3 mengubah rumus & enum) agar
//! pemindahan kode dari `STWV/rust` ke crate inti terbukti tidak mengubah perilaku.
//! Angka acuan ("Lama", PLAN_FIX.md §3.6) dihitung dari kode v1: TF `log` (= 1 + ln f),
//! IDF `smooth`, tanpa normalisasi baris.
//!
//! Catatan untuk fase lanjutan: test di file ini sengaja TIDAK mengunci perilaku yang
//! memang akan diubah (mis. fallback diam-diam pada stopwords JSON rusak — F11).

use statify_text_core::{
    ngram, preprocess_documents, run_pipeline, stemmer, StemmingMethod, StopwordsMethod, TextVectorizerConfig,
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

/// Bangun config v1 (kontrak string lama) dari JSON agar kontrak JSON ikut teruji.
fn config(tf: &str, idf: &str, ngram_min: usize, ngram_max: usize, words_to_keep: usize) -> TextVectorizerConfig {
    let json = serde_json::json!({
        "lowercase": true,
        "stemming_method": "none",
        "stopwords_method": "none",
        "custom_stopwords": null,
        "delimiters": r#"[\s.,;:'"()?!]+"#,
        "ngram_min": ngram_min,
        "ngram_max": ngram_max,
        // S3: kombinasi v1 (log + smooth) hanya sah pada standar "custom"; ekspektasi angka tidak berubah.
        "formula_standard": "custom",
        "tf_method": tf,
        "idf_method": idf,
        "words_to_keep": words_to_keep,
    });
    serde_json::from_value(json).expect("config uji harus valid")
}

fn assert_matrix(actual: &[Vec<f64>], expected: &[Vec<f64>]) {
    assert_eq!(actual.len(), expected.len(), "jumlah baris berbeda");
    for (r, (a_row, e_row)) in actual.iter().zip(expected.iter()).enumerate() {
        assert_eq!(a_row.len(), e_row.len(), "jumlah kolom baris {} berbeda", r);
        for (c, (a, e)) in a_row.iter().zip(e_row.iter()).enumerate() {
            assert!(
                (a - e).abs() < TOL,
                "sel [{}][{}]: dapat {} seharusnya {}",
                r, c, a, e
            );
        }
    }
}

#[test]
fn golden_lama_log_smooth_none_pada_korpus_d() {
    let out = run_pipeline(&korpus_d(), &config("log", "smooth", 1, 1, 1000)).expect("harus sukses");

    assert_eq!(out.vocabulary, vec!["makan", "nasi", "saya", "suka", "tidak"]);
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
fn stats_v1_dipertahankan() {
    let out = run_pipeline(&korpus_d(), &config("log", "smooth", 1, 1, 1000)).unwrap();
    assert_eq!(out.stats.total_documents, 3);
    assert_eq!(out.stats.vocabulary_size, 5);
    // S3: format `method` mengikuti PLAN_FIX.md §3.5 (label "log" v1 kini bernama "sublinear").
    assert_eq!(out.stats.method, "TF: sublinear, IDF: smooth, Norm: none, Keep: 1000, MinFreq: 1");
}

#[test]
fn raw_none_menghasilkan_raw_count() {
    // Sama dengan raw count D pada §3.6 (kosakata alfabetis).
    let out = run_pipeline(&korpus_d(), &config("raw", "none", 1, 1, 1000)).unwrap();
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
fn words_to_keep_2_pada_korpus_d_cara_lama() {
    // Skor lama = Σ TF(log) × IDF(smooth):
    //   makan ≈ 3.990 ; nasi = saya = suka ≈ 2.575 (seri) ; tidak ≈ 1.693.
    // Dua teratas: makan, lalu tie → alfabetis → nasi.
    let out = run_pipeline(&korpus_d(), &config("log", "smooth", 1, 1, 2)).unwrap();
    assert_eq!(out.vocabulary, vec!["makan", "nasi"]);
    assert_matrix(
        &out.matrix,
        &[
            vec![1.287682, 1.287682],
            vec![0.0, 1.287682],
            vec![2.702345, 0.0],
        ],
    );
}

#[test]
fn ngram_unigram_vs_bigram() {
    let docs = vec!["makan nasi goreng".to_string()];

    let uni = preprocess_documents(&docs, &config("raw", "none", 1, 1, 1000)).unwrap();
    assert_eq!(uni[0], vec!["makan", "nasi", "goreng"]);

    let bi = preprocess_documents(&docs, &config("raw", "none", 1, 2, 1000)).unwrap();
    assert_eq!(bi[0], vec!["makan", "nasi", "goreng", "makan nasi", "nasi goreng"]);

    // Fungsi n-gram langsung.
    let langsung = ngram::generate(vec!["a".into(), "b".into(), "c".into()], 1, 2);
    assert_eq!(langsung, vec!["a", "b", "c", "a b", "b c"]);
}

#[test]
fn stopwords_custom_tidak_peka_huruf_besar_kecil() {
    let mut cfg = config("raw", "none", 1, 1, 1000);
    cfg.stopwords_method = StopwordsMethod::Custom;
    // Daftar memakai huruf campuran; token pada dokumen juga huruf campuran.
    cfg.custom_stopwords = Some(r#"["SAYA","Tidak"]"#.to_string());
    cfg.lowercase = false; // token asli tetap berhuruf besar, pencocokan tetap case-insensitive

    let docs = vec!["Saya TIDAK suka Nasi".to_string()];
    let tokens = preprocess_documents(&docs, &cfg).unwrap();
    assert_eq!(tokens[0], vec!["suka", "Nasi"]);
}

#[test]
fn stemming_indonesia_memakan_menjadi_makan() {
    let hasil = stemmer::stem(vec!["memakan".to_string()], "indonesian");
    assert_eq!(hasil, vec!["makan"]);
}

#[test]
fn stemming_inggris_running_menjadi_run() {
    let hasil = stemmer::stem(vec!["running".to_string()], "english");
    assert_eq!(hasil, vec!["run"]);
}

#[test]
fn stemming_selalu_lowercase_walau_opsi_lowercase_mati() {
    // Perilaku v1 (F12): stemmer memaksa lowercase internal.
    let mut cfg = config("raw", "none", 1, 1, 1000);
    cfg.lowercase = false;
    cfg.stemming_method = StemmingMethod::English;
    let tokens = preprocess_documents(&["Running".to_string()], &cfg).unwrap();
    assert_eq!(tokens[0], vec!["run"]);
}

#[test]
fn dokumen_kosong_di_tengah_menjadi_baris_nol_dan_sejajar() {
    let docs = vec!["saya suka nasi".to_string(), "".to_string(), "suka makan".to_string()];
    let out = run_pipeline(&docs, &config("raw", "none", 1, 1, 1000)).unwrap();
    assert_eq!(out.matrix.len(), 3);
    assert!(out.matrix[1].iter().all(|&v| v == 0.0), "baris dokumen kosong harus nol");
    assert!(out.matrix[0].iter().any(|&v| v > 0.0));
    assert!(out.matrix[2].iter().any(|&v| v > 0.0));
}

#[test]
fn validator_array_kosong_dan_semua_kosong_ditolak() {
    let cfg = config("raw", "none", 1, 1, 1000);
    let e1 = run_pipeline(&[], &cfg).unwrap_err();
    assert_eq!(e1.code, "EMPTY_INPUT");
    let e2 = run_pipeline(&["  ".to_string(), "".to_string()], &cfg).unwrap_err();
    assert_eq!(e2.code, "EMPTY_INPUT");
}

#[test]
fn validator_ngram_tidak_valid_ditolak() {
    let e1 = run_pipeline(&korpus_d(), &config("raw", "none", 0, 1, 1000)).unwrap_err();
    assert_eq!(e1.code, "INVALID_CONFIG");
    let e2 = run_pipeline(&korpus_d(), &config("raw", "none", 3, 2, 1000)).unwrap_err();
    assert_eq!(e2.code, "INVALID_CONFIG");
}

#[test]
fn regex_tidak_valid_menghasilkan_invalid_regex() {
    let mut cfg = config("raw", "none", 1, 1, 1000);
    cfg.delimiters = "[(".to_string();
    let e = run_pipeline(&korpus_d(), &cfg).unwrap_err();
    assert_eq!(e.code, "INVALID_REGEX");
}

#[test]
fn semua_token_terbuang_menghasilkan_empty_vocabulary() {
    // Semua kata adalah stopword → kosakata kosong.
    let mut cfg = config("raw", "none", 1, 1, 1000);
    cfg.stopwords_method = StopwordsMethod::Custom;
    cfg.custom_stopwords = Some(r#"["saya","suka","makan","nasi","tidak"]"#.to_string());
    let e = run_pipeline(&korpus_d(), &cfg).unwrap_err();
    assert_eq!(e.code, "EMPTY_VOCABULARY");
}

#[test]
fn kontrak_json_lama_diparse_dan_error_diserialisasi() {
    // Kontrak JSON v1 (snake_case, custom_stopwords opsional) harus tetap diterima.
    let cfg: TextVectorizerConfig = serde_json::from_str(
        r#"{"lowercase":true,"stemming_method":"none","stopwords_method":"none",
            "delimiters":"","ngram_min":1,"ngram_max":1,
            "tf_method":"raw","idf_method":"none","words_to_keep":0}"#,
    )
    .expect("custom_stopwords harus opsional");
    // Delimiter kosong → fallback r"[\s\p{P}]+".
    let out = run_pipeline(&korpus_d(), &cfg).unwrap();
    assert_eq!(out.vocabulary.len(), 5);

    // Error core (TextError) harus Serialize sebagai { code, message }.
    let err = run_pipeline(&[], &cfg).unwrap_err();
    let v = serde_json::to_value(&err).unwrap();
    assert_eq!(v["code"], "EMPTY_INPUT");
    assert!(v["message"].as_str().unwrap().len() > 0);
}
