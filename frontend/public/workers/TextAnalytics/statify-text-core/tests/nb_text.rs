//! Test Fase N2: modul `nb_text` (likelihood teks Multinomial / Bernoulli / Complement + Top-k).
//! Angka acuan (golden) diambil persis dari AGENTS_V2.md §6.7 (toleransi 1e-6).

use statify_text_core::nb_text::{score_rows, top_k, train, TextLikelihood, TextNbParams};
use statify_text_core::{fit_transform, transform, CsrMatrix, TextVectorizerConfig};

const TOL: f64 = 1e-6;

fn csr_from_dense(rows: &[Vec<f64>]) -> CsrMatrix {
    let n_cols = rows.first().map_or(0, |r| r.len());
    let mut indptr = vec![0usize];
    let mut indices = Vec::new();
    let mut data = Vec::new();
    for row in rows {
        for (c, &v) in row.iter().enumerate() {
            if v != 0.0 {
                indices.push(c as u32);
                data.push(v);
            }
        }
        indptr.push(indices.len());
    }
    CsrMatrix { n_rows: rows.len(), n_cols, indptr, indices, data }
}

fn terms() -> Vec<String> {
    ["makan", "nasi", "saya", "suka", "tidak"].iter().map(|s| s.to_string()).collect()
}

fn classes() -> Vec<String> {
    vec!["neg".to_string(), "pos".to_string()]
}

/// Data latih golden §6.7: pos, neg, pos. Kelas terurut [neg, pos] → y = [1, 0, 1].
fn golden_train(likelihood: TextLikelihood) -> TextNbParams {
    let x = csr_from_dense(&[
        vec![1.0, 1.0, 1.0, 1.0, 0.0],
        vec![0.0, 1.0, 1.0, 1.0, 1.0],
        vec![3.0, 0.0, 0.0, 0.0, 0.0],
    ]);
    train(&x, &[1, 0, 1], 2, &classes(), likelihood, 1.0)
}

/// Dokumen uji "makan nasi enak" → x = [1,1,0,0,0] (enak OOV).
fn golden_test_matrix() -> CsrMatrix {
    csr_from_dense(&[vec![1.0, 1.0, 0.0, 0.0, 0.0]])
}

fn assert_close(actual: f64, expected: f64, ctx: &str) {
    assert!((actual - expected).abs() < TOL, "{ctx}: diperoleh {actual}, diharapkan {expected}");
}

fn assert_matrix(actual: &[Vec<f64>], expected: &[[f64; 5]; 2], name: &str) {
    assert_eq!(actual.len(), 2, "{name}: jumlah kelas");
    for (c, row) in expected.iter().enumerate() {
        assert_eq!(actual[c].len(), 5, "{name}: jumlah term");
        for (t, &e) in row.iter().enumerate() {
            assert_close(actual[c][t], e, &format!("{name}[{c}][{t}]"));
        }
    }
}

/// Skor gabungan = ln prior + kontribusi Text (bila `uses_class_prior`); prior = proporsi kelas [1/3, 2/3].
fn combined(params: &TextNbParams, contribution: &[f64]) -> Vec<f64> {
    let priors = [1.0_f64 / 3.0, 2.0 / 3.0];
    contribution
        .iter()
        .enumerate()
        .map(|(c, s)| if params.uses_class_prior { priors[c].ln() + s } else { *s })
        .collect()
}

fn p_pos(scores: &[f64]) -> f64 {
    let max = scores.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = scores.iter().map(|s| (s - max).exp()).collect();
    exps[1] / exps.iter().sum::<f64>()
}

#[test]
fn golden_multinomial() {
    let params = golden_train(TextLikelihood::Multinomial);
    assert_matrix(
        &params.log_weights,
        &[
            [-2.197225, -1.504077, -1.504077, -1.504077, -1.504077],
            [-0.875469, -1.791759, -1.791759, -1.791759, -2.484907],
        ],
        "log_weights",
    );
    assert!(params.uses_class_prior);
    assert!(params.log_weights_absent.is_none());
    // N_ct: neg = [0,1,1,1,1]; pos = [4,1,1,1,0].
    assert_eq!(params.class_term_counts[0], vec![0.0, 1.0, 1.0, 1.0, 1.0]);
    assert_eq!(params.class_term_counts[1], vec![4.0, 1.0, 1.0, 1.0, 0.0]);

    let contrib = score_rows(&params, &golden_test_matrix());
    let s = combined(&params, &contrib[0]);
    assert_close(s[0], -4.799914, "skor neg");
    assert_close(s[1], -3.072693, "skor pos");
    assert_close(p_pos(&s), 0.849057, "P(pos)");
}

#[test]
fn golden_bernoulli() {
    let params = golden_train(TextLikelihood::Bernoulli);
    assert_matrix(
        &params.log_weights,
        &[
            [-1.098612, -0.405465, -0.405465, -0.405465, -0.405465],
            [-0.287682, -0.693147, -0.693147, -0.693147, -1.386294],
        ],
        "log_weights",
    );
    assert!(params.log_weights_absent.is_some());
    assert!(params.uses_class_prior);
    // n_ct (jumlah dokumen dengan b=1): neg = [0,1,1,1,1]; pos = [2,1,1,1,0].
    assert_eq!(params.class_term_counts[0], vec![0.0, 1.0, 1.0, 1.0, 1.0]);
    assert_eq!(params.class_term_counts[1], vec![2.0, 1.0, 1.0, 1.0, 0.0]);

    let contrib = score_rows(&params, &golden_test_matrix());
    let s = combined(&params, &contrib[0]);
    assert_close(s[0], -5.898527, "skor neg");
    assert_close(s[1], -3.060271, "skor pos");
    assert_close(p_pos(&s), 0.944708, "P(pos)");
}

#[test]
fn golden_complement_tanpa_prior() {
    let params = golden_train(TextLikelihood::Complement);
    assert_matrix(
        &params.log_weights,
        &[
            [0.875469, 1.791759, 1.791759, 1.791759, 2.484907],
            [2.197225, 1.504077, 1.504077, 1.504077, 1.504077],
        ],
        "log_weights",
    );
    assert!(!params.uses_class_prior, "Complement dengan K >= 2 tidak memakai prior");

    let contrib = score_rows(&params, &golden_test_matrix());
    let s = combined(&params, &contrib[0]);
    assert_close(s[0], 2.667228, "skor neg");
    assert_close(s[1], 3.701302, "skor pos");
    assert_close(p_pos(&s), 0.737705, "P(pos)");
}

#[test]
fn bernoulli_menghitung_term_absen_untuk_seluruh_kosakata() {
    // Dokumen kosong (semua term absen) → skor = Σ_t A_ct untuk tiap kelas.
    let params = golden_train(TextLikelihood::Bernoulli);
    let empty = csr_from_dense(&[vec![0.0; 5]]);
    let contrib = score_rows(&params, &empty);
    let absent = params.log_weights_absent.as_ref().unwrap();
    for c in 0..2 {
        let expected: f64 = absent[c].iter().sum();
        assert_close(contrib[0][c], expected, &format!("Σ A kelas {c}"));
    }
}

#[test]
fn kelas_tanpa_dokumen_tidak_menghasilkan_nan() {
    // Tiga kelas, kelas indeks 2 tidak punya dokumen satu pun.
    let x = csr_from_dense(&[vec![1.0, 0.0, 2.0], vec![0.0, 3.0, 0.0]]);
    let names: Vec<String> = ["a", "b", "kosong"].iter().map(|s| s.to_string()).collect();
    for lk in [TextLikelihood::Multinomial, TextLikelihood::Bernoulli, TextLikelihood::Complement] {
        let params = train(&x, &[0, 1], 3, &names, lk, 1.0);
        for row in &params.log_weights {
            assert!(row.iter().all(|v| v.is_finite()), "{lk:?}: log_weights harus finite");
        }
        if let Some(absent) = &params.log_weights_absent {
            assert!(absent.iter().flatten().all(|v| v.is_finite()), "{lk:?}: log_weights_absent finite");
        }
        let scores = score_rows(&params, &x);
        assert!(scores.iter().flatten().all(|v| v.is_finite()), "{lk:?}: skor harus finite");
        let tk = top_k(&params, &["x".into(), "y".into(), "z".into()], 3);
        assert!(tk.iter().flatten().all(|(_, s)| s.is_finite()), "{lk:?}: skor top-k finite");
    }
}

#[test]
fn label_di_luar_rentang_diabaikan_tanpa_panic() {
    let x = csr_from_dense(&[vec![1.0, 0.0], vec![0.0, 1.0], vec![1.0, 1.0]]);
    let names = classes();
    // Label 7 tidak valid; y lebih pendek dari jumlah baris → baris terakhir diabaikan.
    let params = train(&x, &[0, 7], 2, &names, TextLikelihood::Multinomial, 1.0);
    assert!(params.log_weights.iter().flatten().all(|v| v.is_finite()));
}

#[test]
fn top_k_multinomial_urut_dan_tiebreak_alfabetis() {
    let params = golden_train(TextLikelihood::Multinomial);
    let tk = top_k(&params, &terms(), 5);
    assert_eq!(tk.len(), 2);

    // Kelas neg: skor = L_neg − L_pos → tidak 0.98083, lalu nasi/saya/suka (seri 0.287682, alfabetis), makan −1.321756.
    let order_neg: Vec<usize> = tk[0].iter().map(|(t, _)| *t).collect();
    assert_eq!(order_neg, vec![4, 1, 2, 3, 0]);
    assert_close(tk[0][0].1, 0.980830, "skor tidak (neg)");
    assert_close(tk[0][1].1, 0.287682, "skor nasi (neg)");
    assert_close(tk[0][4].1, -1.321756, "skor makan (neg)");

    // Kelas pos: kebalikannya (K = 2 → rata-rata kelas lain = L kelas lawan).
    let order_pos: Vec<usize> = tk[1].iter().map(|(t, _)| *t).collect();
    assert_eq!(order_pos, vec![0, 1, 2, 3, 4]);
    assert_close(tk[1][0].1, 1.321756, "skor makan (pos)");
}

#[test]
fn top_k_tiebreak_memakai_nama_term_bukan_indeks() {
    // Temuan N2-1 (REVIEW-G1): `terms()` sudah terurut alfabetis sehingga urutan indeks
    // = urutan alfabetis dan test lain tidak bisa membedakannya. Di sini nama term sengaja
    // tidak terurut: indeks 0..4 = a, z, y, x, b.
    let params = golden_train(TextLikelihood::Multinomial);
    let names: Vec<String> = ["a", "z", "y", "x", "b"].iter().map(|s| s.to_string()).collect();
    let tk = top_k(&params, &names, 5);
    assert_eq!(tk.len(), 2);

    // Kelas neg: indeks 4 skor tertinggi; indeks 1,2,3 seri (0.287682) → urut nama:
    // x(3) < y(2) < z(1); indeks 0 terakhir. Urutan indeks yang salah akan memberi [4,1,2,3,0].
    let order_neg: Vec<usize> = tk[0].iter().map(|(t, _)| *t).collect();
    assert_eq!(order_neg, vec![4, 3, 2, 1, 0]);
}

#[test]
fn top_k_membatasi_jumlah_dan_k_nol() {
    let params = golden_train(TextLikelihood::Multinomial);
    let tk = top_k(&params, &terms(), 2);
    assert!(tk.iter().all(|row| row.len() == 2));
    assert_eq!(tk[0].iter().map(|(t, _)| *t).collect::<Vec<_>>(), vec![4, 1]);
    let tk0 = top_k(&params, &terms(), 0);
    assert!(tk0.iter().all(|row| row.is_empty()));
    let tk_besar = top_k(&params, &terms(), 1000);
    assert!(tk_besar.iter().all(|row| row.len() == 5));
}

#[test]
fn top_k_satu_kelas_memakai_log_weight_langsung() {
    let x = csr_from_dense(&[vec![2.0, 1.0, 0.0]]);
    let names = vec!["tunggal".to_string()];
    let params = train(&x, &[0], 1, &names, TextLikelihood::Multinomial, 1.0);
    let tk = top_k(&params, &["a".into(), "b".into(), "c".into()], 3);
    assert_eq!(tk.len(), 1);
    for (t, s) in &tk[0] {
        assert_close(*s, params.log_weights[0][*t], "score = L untuk K = 1");
    }
    assert_eq!(tk[0][0].0, 0, "term dengan bobot terbesar lebih dulu");
    // K = 1 pada Complement tetap memakai prior (§6.3).
    let comp = train(&x, &[0], 1, &names, TextLikelihood::Complement, 1.0);
    assert!(comp.uses_class_prior);
}

#[test]
fn score_rows_mengabaikan_indeks_di_luar_kosakata_dan_nilai_non_finite() {
    let params = golden_train(TextLikelihood::Multinomial);
    // Kolom 9 di luar kosakata dan nilai NaN pada kolom 0 harus diabaikan (tanpa panic/NaN).
    let x = CsrMatrix {
        n_rows: 1,
        n_cols: 10,
        indptr: vec![0, 3],
        indices: vec![0, 1, 9],
        data: vec![f64::NAN, 1.0, 5.0],
    };
    let s = score_rows(&params, &x);
    assert_close(s[0][0], params.log_weights[0][1], "hanya kolom 1 yang dihitung (neg)");
    assert_close(s[0][1], params.log_weights[1][1], "hanya kolom 1 yang dihitung (pos)");
}

#[test]
fn nilai_pecahan_tf_idf_diperbolehkan() {
    let x = csr_from_dense(&[vec![0.5, 1.5], vec![2.0, 0.0]]);
    let params = train(&x, &[0, 1], 2, &classes(), TextLikelihood::Multinomial, 1.0);
    assert_close(params.class_term_counts[0][0], 0.5, "N_ct pecahan");
    assert_close(params.class_term_counts[0][1], 1.5, "N_ct pecahan");
    // θ_0 = (0.5+1)/(2+2) → ln(0.375).
    assert_close(params.log_weights[0][0], (1.5_f64 / 4.0).ln(), "log θ pecahan");
}

#[test]
fn jalur_raw_end_to_end_cocok_dengan_golden() {
    // 3 dokumen PLAN_FIX §3.6 dengan label pos/neg/pos; konfigurasi Weka default (raw/none/none).
    let cfg: TextVectorizerConfig = serde_json::from_value(serde_json::json!({
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
    }))
    .expect("config valid");
    let docs: Vec<String> = ["Saya suka makan nasi", "Saya tidak suka nasi!", "Makan, makan, makan"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let (model, x) = fit_transform(&docs, &cfg).expect("fit_transform");
    assert_eq!(model.vocabulary, terms());

    let params = train(&x, &[1, 0, 1], 2, &classes(), TextLikelihood::Multinomial, 1.0);
    assert_matrix(
        &params.log_weights,
        &[
            [-2.197225, -1.504077, -1.504077, -1.504077, -1.504077],
            [-0.875469, -1.791759, -1.791759, -1.791759, -2.484907],
        ],
        "log_weights raw",
    );

    let xt = transform(&model, &["makan nasi enak".to_string()]).expect("transform");
    let s = combined(&params, &score_rows(&params, &xt)[0]);
    assert_close(p_pos(&s), 0.849057, "P(pos) raw");
}
