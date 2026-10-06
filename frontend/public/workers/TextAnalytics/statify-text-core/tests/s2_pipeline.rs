//! Test Fase S2: Pipeline sekali-inisialisasi, error objek (TextError), enum config + alias lama.
//! Characterization S1 (`characterization.rs`) tetap menjadi penjaga regresi perilaku v1.

use statify_text_core::{
    prepare, run_pipeline, FormulaStandard, IdfMethod, Normalization, StemmingMethod, StopwordsMethod,
    TextVectorizerConfig, TfMethod,
};

fn korpus_d() -> Vec<String> {
    vec![
        "Saya suka makan nasi".to_string(),
        "Saya tidak suka nasi!".to_string(),
        "Makan, makan, makan".to_string(),
    ]
}

/// JSON config dasar; field dapat ditimpa lewat `overrides`.
fn json_config(overrides: serde_json::Value) -> serde_json::Value {
    let mut base = serde_json::json!({
        "lowercase": true,
        "stemming_method": "none",
        "stopwords_method": "none",
        "custom_stopwords": null,
        "delimiters": r#"[\s.,;:'"()?!]+"#,
        "ngram_min": 1,
        "ngram_max": 1,
        "tf_method": "raw",
        "idf_method": "none",
        "words_to_keep": 1000,
    });
    if let (Some(b), Some(o)) = (base.as_object_mut(), overrides.as_object()) {
        for (k, v) in o {
            b.insert(k.clone(), v.clone());
        }
    }
    base
}

fn cfg(overrides: serde_json::Value) -> TextVectorizerConfig {
    TextVectorizerConfig::from_json_value(json_config(overrides)).expect("config uji harus valid")
}

// ── F11 / T6: error stopwords dipropagasi ───────────────────────────────────

#[test]
fn t6_stopwords_json_rusak_menghasilkan_invalid_stopwords() {
    let c = cfg(serde_json::json!({ "stopwords_method": "custom", "custom_stopwords": "not json" }));
    let e = run_pipeline(&korpus_d(), &c).unwrap_err();
    assert_eq!(e.code, "INVALID_STOPWORDS");
    assert!(!e.message.is_empty());

    // `prepare` sendiri juga menolak (parse hanya sekali, di sini).
    let e2 = prepare(&c).err().expect("prepare harus gagal");
    assert_eq!(e2.code, "INVALID_STOPWORDS");
}

#[test]
fn stopwords_json_rusak_diabaikan_bila_metode_none() {
    // Perilaku v1: metode "none" tidak pernah membaca daftar.
    let c = cfg(serde_json::json!({ "stopwords_method": "none", "custom_stopwords": "not json" }));
    assert!(run_pipeline(&korpus_d(), &c).is_ok());
}

#[test]
fn stopwords_metode_bawaan_dengan_daftar_dari_frontend_memfilter() {
    // Frontend mengirim daftar final di custom_stopwords untuk metode "indonesian".
    let c = cfg(serde_json::json!({
        "stopwords_method": "indonesian",
        "custom_stopwords": r#"["saya","tidak"]"#,
    }));
    let out = run_pipeline(&korpus_d(), &c).unwrap();
    assert_eq!(out.vocabulary, vec!["makan", "nasi", "suka"]);
}

#[test]
fn stopwords_tanpa_daftar_lanjut_tanpa_filter() {
    let c = cfg(serde_json::json!({ "stopwords_method": "custom", "custom_stopwords": null }));
    let out = run_pipeline(&korpus_d(), &c).unwrap();
    assert_eq!(out.vocabulary.len(), 5);
}

// ── F21: enum config, nilai tak dikenal ditolak ─────────────────────────────

#[test]
fn nilai_enum_tidak_dikenal_menghasilkan_invalid_config() {
    for (field, nilai) in [
        ("tf_method", "bogus"),
        ("idf_method", "bogus"),
        ("stopwords_method", "bogus"),
        ("stemming_method", "bogus"),
        ("formula_standard", "bogus"),
        ("normalization", "bogus"),
    ] {
        let mut v = json_config(serde_json::json!({}));
        v[field] = serde_json::json!(nilai);
        let e = TextVectorizerConfig::from_json_value(v).err().expect(field);
        assert_eq!(e.code, "INVALID_CONFIG", "field {}", field);
    }
}

#[test]
fn field_wajib_hilang_menghasilkan_invalid_config() {
    let e = TextVectorizerConfig::from_json_str(r#"{"lowercase":true}"#).err().expect("harus gagal");
    assert_eq!(e.code, "INVALID_CONFIG");
}

#[test]
fn alias_nilai_lama_diterima() {
    // tf "none" → binary, tf "log" → sublinear, idf "idf" → standard, idf "none" → none.
    assert_eq!(cfg(serde_json::json!({ "tf_method": "none" })).tf_method, TfMethod::Binary);
    assert_eq!(cfg(serde_json::json!({ "tf_method": "log" })).tf_method, TfMethod::Sublinear);
    assert_eq!(cfg(serde_json::json!({ "idf_method": "idf" })).idf_method, IdfMethod::Standard);
    assert_eq!(cfg(serde_json::json!({ "idf_method": "none" })).idf_method, IdfMethod::None);
}

#[test]
fn nilai_enum_baru_diterima() {
    assert_eq!(cfg(serde_json::json!({ "tf_method": "log1p" })).tf_method, TfMethod::Log1p);
    assert_eq!(cfg(serde_json::json!({ "tf_method": "sublinear" })).tf_method, TfMethod::Sublinear);
    assert_eq!(cfg(serde_json::json!({ "tf_method": "normalized" })).tf_method, TfMethod::Normalized);
    assert_eq!(cfg(serde_json::json!({ "idf_method": "standard" })).idf_method, IdfMethod::Standard);
    assert_eq!(cfg(serde_json::json!({ "idf_method": "plus1" })).idf_method, IdfMethod::Plus1);
    assert_eq!(cfg(serde_json::json!({ "stopwords_method": "english" })).stopwords_method, StopwordsMethod::English);
    assert_eq!(cfg(serde_json::json!({ "stemming_method": "indonesian" })).stemming_method, StemmingMethod::Indonesian);
    assert_eq!(cfg(serde_json::json!({ "normalization": "doc_length" })).normalization, Normalization::DocLength);
    assert_eq!(cfg(serde_json::json!({ "formula_standard": "sklearn" })).formula_standard, FormulaStandard::Sklearn);
}

#[test]
fn field_baru_punya_default_dan_json_v1_tetap_diterima() {
    let c = cfg(serde_json::json!({}));
    assert_eq!(c.formula_standard, FormulaStandard::Weka);
    assert_eq!(c.normalization, Normalization::None);
    assert_eq!(c.min_term_freq, 1);
}

#[test]
fn alias_lama_menghasilkan_angka_v1_yang_sama() {
    // "log"/"smooth" lewat JSON harus identik dengan golden "Lama" §3.6.
    let c = cfg(serde_json::json!({ "formula_standard": "custom", "tf_method": "log", "idf_method": "smooth" }));
    let out = run_pipeline(&korpus_d(), &c).unwrap();
    assert!((out.matrix[2][0] - 2.702345).abs() < 1e-6);
    assert!((out.matrix[1][4] - 1.693147).abs() < 1e-6);
    // S3: format `method` mengikuti PLAN_FIX.md §3.5.
    assert_eq!(out.stats.method, "TF: sublinear, IDF: smooth, Norm: none, Keep: 1000, MinFreq: 1");

    // "idf" lama = ln(N/df): makan df=2 → ln(3/2) = 0.405465; raw count 1.
    let c = cfg(serde_json::json!({ "tf_method": "raw", "idf_method": "idf" }));
    let out = run_pipeline(&korpus_d(), &c).unwrap();
    assert!((out.matrix[0][0] - (3.0_f64 / 2.0).ln()).abs() < 1e-6);
}

#[test]
fn tf_log1p_dan_idf_plus1_dihitung_sesuai_rumus() {
    let c = cfg(serde_json::json!({ "formula_standard": "custom", "tf_method": "log1p", "idf_method": "plus1" }));
    let out = run_pipeline(&korpus_d(), &c).unwrap();
    // makan di dokumen 3: c=3 → ln(4); df=2 → idf = ln(3/2) + 1.
    let harapan = 4.0_f64.ln() * ((3.0_f64 / 2.0).ln() + 1.0);
    assert!((out.matrix[2][0] - harapan).abs() < 1e-9);
}

// ── Validasi rentang ────────────────────────────────────────────────────────

#[test]
fn validasi_rentang_config() {
    let e = run_pipeline(&korpus_d(), &cfg(serde_json::json!({ "min_term_freq": 0 }))).unwrap_err();
    assert_eq!(e.code, "INVALID_CONFIG");

    let e = run_pipeline(&korpus_d(), &cfg(serde_json::json!({ "ngram_min": 1, "ngram_max": 6 }))).unwrap_err();
    assert_eq!(e.code, "INVALID_CONFIG");

    let e = prepare(&cfg(serde_json::json!({ "ngram_min": 0 }))).err().expect("ngram_min 0");
    assert_eq!(e.code, "INVALID_CONFIG");

    // Batas atas 5 masih sah.
    assert!(run_pipeline(&korpus_d(), &cfg(serde_json::json!({ "ngram_min": 1, "ngram_max": 5 }))).is_ok());
}

// ── Dokumen kosong (§3.2) ───────────────────────────────────────────────────

#[test]
fn dokumen_kosong_dan_whitespace_di_tengah_menjadi_baris_nol() {
    let docs = vec![
        "saya suka nasi".to_string(),
        "".to_string(),
        "   ".to_string(),
        "suka makan".to_string(),
    ];
    let out = run_pipeline(&docs, &cfg(serde_json::json!({}))).unwrap();
    assert_eq!(out.matrix.len(), 4);
    assert!(out.matrix[1].iter().all(|&v| v == 0.0));
    assert!(out.matrix[2].iter().all(|&v| v == 0.0));
    assert!(out.matrix[3].iter().any(|&v| v > 0.0));
}

// ── F08: Pipeline dibangun sekali, dipakai ulang ────────────────────────────

#[test]
fn pipeline_dipakai_ulang_hasilnya_konsisten_dan_sejajar() {
    let c = cfg(serde_json::json!({ "stemming_method": "indonesian", "ngram_min": 1, "ngram_max": 2 }));
    let pipeline = prepare(&c).expect("prepare harus sukses");
    let docs = vec![
        "Memakan nasi".to_string(),
        "".to_string(),
        "memakan nasi memakan".to_string(),
    ];

    let batch = pipeline.tokens_batch(&docs);
    assert_eq!(batch.len(), docs.len(), "satu dokumen → satu entri");
    assert!(batch[1].is_empty(), "dokumen kosong → tanpa token");

    // Hasil batch (dengan cache memo) harus sama dengan memproses dokumen satu per satu.
    for (i, d) in docs.iter().enumerate() {
        let sendiri = pipeline.tokens_batch(std::slice::from_ref(d));
        assert_eq!(batch[i], sendiri[0], "dokumen {} berbeda", i);
    }

    // Pipeline yang sama dapat dipanggil berulang kali.
    assert_eq!(pipeline.tokens_batch(&docs), batch);
    assert_eq!(batch[0][0], "makan");
}

#[test]
fn pipeline_stopwords_dan_stemming_inggris() {
    let c = cfg(serde_json::json!({
        "stemming_method": "english",
        "stopwords_method": "custom",
        "custom_stopwords": r#"["THE"]"#,
    }));
    let pipeline = prepare(&c).unwrap();
    let hasil = pipeline.tokens_batch(&["The Running dog".to_string(), "the running".to_string()]);
    assert_eq!(hasil[0], vec!["run", "dog"]);
    assert_eq!(hasil[1], vec!["run"]);
}

// ── Error berbentuk objek ───────────────────────────────────────────────────

#[test]
fn text_error_diserialisasi_sebagai_objek_code_message() {
    let e = run_pipeline(&korpus_d(), &cfg(serde_json::json!({ "delimiters": "[(" }))).unwrap_err();
    assert_eq!(e.code, "INVALID_REGEX");
    let v = serde_json::to_value(&e).unwrap();
    assert!(v.is_object());
    assert_eq!(v["code"], "INVALID_REGEX");
    assert!(!v["message"].as_str().unwrap_or("").is_empty());
}
