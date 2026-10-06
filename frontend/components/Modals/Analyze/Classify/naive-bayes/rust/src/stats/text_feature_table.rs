// naive-bayes/rust/src/stats/text_feature_table.rs
//
// Fase N4 (PLAN_V2) — Text Feature Table: tabel "kata paling berpengaruh per
// kelas" untuk model dengan fitur Text (AGENTS_V2 V9, §6.6, §9).
//
// === Bentuk JSON (DIKUNCI di Fase N8; jangan diubah tanpa menyentuh N8) ===
//
//   text_feature_table: {
//     likelihood: "multinomial" | "bernoulli" | "complement",
//     classes:    [kelas...],                 // urutan kelas model
//     k:          <Top-k yang diminta>,
//     top:  { <kelas>: [ { term, score, log_weight, count } ... ] },  // maks. k per kelas
//     full: [ { term, class, count, log_weight, probability, score } ... ]  // semua term x kelas
//   }
//
// `top` berupa object berkunci nama kelas dengan URUTAN kunci = urutan
// `classes` (bukan urutan hash), supaya tampilan stabil. `full` berurutan
// term demi term (urutan parameter model), lalu kelas — format panjang yang
// langsung dipakai aksi Download CSV / Copy TSV (kolom
// `term,class,count,log_weight,probability,score`).
//
// === Prinsip (AGENTS_V2 P-V2) ===
//
// Berkas ini TIDAK punya rumus likelihood/skor sendiri. Skor Top-k
// `score_ct = L_ct - mean_{c'!=c} L_c't` (bila K = 1: `L_ct`), urutan menurun,
// seri -> term alfabetis, semuanya dari `CORE::nb_text::top_k`. Di sini hanya
// penyusunan struktur JSON dari hasilnya.
//
// `probability` = `exp(log_weight)` untuk Multinomial/Bernoulli (`theta` /
// `p`); untuk Complement `log_weight = -ln(theta~)` sehingga
// `probability = exp(-log_weight) = theta~` (AGENTS_V2 §9).
//
// === Sumber model (AGENTS.md §5.5, catatan N3b) ===
//
// Pemanggil WAJIB mengirim parameter MODEL FINAL (retrain di seluruh baris
// valid), BUKAN model per-fold/holdout: fungsi ini hanya menerima
// `TextNbParams` + nama term dan sengaja tidak tahu apa pun soal fold.
use std::collections::BTreeMap;

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use statify_text_core::nb_text::{self, TextLikelihood, TextNbParams};

/// Nama likelihood untuk JSON (sama dengan string TS/`text.likelihood` export).
pub fn likelihood_name(likelihood: TextLikelihood) -> &'static str {
    match likelihood {
        TextLikelihood::Multinomial => "multinomial",
        TextLikelihood::Bernoulli => "bernoulli",
        TextLikelihood::Complement => "complement",
    }
}

/// Satu baris tabel Top-k satu kelas.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextFeatureTopEntry {
    pub term: String,
    /// Skor pengaruh §6.6.
    pub score: f64,
    /// `L_ct` (Multinomial `ln theta`, Bernoulli `ln p`, Complement `-ln theta~`).
    pub log_weight: f64,
    /// `N_ct` (Multinomial), `n_ct` (Bernoulli), `C_ct` (Complement).
    pub count: f64,
}

/// Satu baris data lengkap (satu term x satu kelas) untuk CSV/TSV.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextFeatureFullEntry {
    pub term: String,
    pub class: String,
    pub count: f64,
    pub log_weight: f64,
    pub probability: f64,
    pub score: f64,
}

/// Peta kelas -> daftar Top-k dengan urutan kunci terjaga (urutan kelas model).
#[derive(Debug, Clone, PartialEq)]
pub struct TopByClass(pub Vec<(String, Vec<TextFeatureTopEntry>)>);

impl Serialize for TopByClass {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (class, entries) in &self.0 {
            map.serialize_entry(class, entries)?;
        }
        map.end()
    }
}

impl TopByClass {
    /// Daftar Top-k satu kelas (None bila kelas tidak ada).
    pub fn get(&self, class: &str) -> Option<&Vec<TextFeatureTopEntry>> {
        self.0
            .iter()
            .find(|(name, _)| name == class)
            .map(|(_, entries)| entries)
    }
}

/// Text Feature Table lengkap (bentuk terkunci N8, lihat kepala berkas).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TextFeatureTable {
    pub likelihood: &'static str,
    pub classes: Vec<String>,
    pub k: usize,
    pub top: TopByClass,
    pub full: Vec<TextFeatureFullEntry>,
}

/// Bangun Text Feature Table dari parameter Text MODEL FINAL.
///
/// `terms` sejajar indeks parameter (nama kolom vektor / kosakata resep). `k`
/// = jumlah term teratas per kelas (`TextTopK`, sudah 1-1000 dari TS); dipotong
/// ke jumlah term yang ada dan tidak pernah memicu panic (k = 0 -> `top` kosong).
/// Dimensi yang tidak sejajar (seharusnya mustahil, divalidasi
/// `text_features::train_text_model`) ditangani tanpa panic: nilai yang tidak
/// ada dianggap 0 dan nama term yang tidak ada menjadi string kosong.
pub fn build_text_feature_table(
    params: &TextNbParams,
    terms: &[String],
    k: usize,
) -> TextFeatureTable {
    let n_classes = params.log_weights.len();
    let n_terms = params.log_weights.first().map_or(0, |row| row.len());

    let class_name = |c: usize| params.classes.get(c).cloned().unwrap_or_default();
    let term_name = |t: usize| terms.get(t).cloned().unwrap_or_default();
    fn weight(matrix: &[Vec<f64>], c: usize, t: usize) -> f64 {
        matrix
            .get(c)
            .and_then(|row| row.get(t))
            .copied()
            .unwrap_or(0.0)
    }

    // Seluruh term terurut per kelas (skor + tie-break alfabetis) dari CORE;
    // Top-k = k entri pertama, dan matriks skor untuk `full` diambil dari
    // hasil yang sama (satu sumber kebenaran skor).
    let ranked = nb_text::top_k(params, terms, n_terms);

    let mut score_matrix: Vec<Vec<f64>> = vec![vec![0.0; n_terms]; n_classes];
    for (c, list) in ranked.iter().enumerate() {
        for &(t, score) in list {
            if let Some(cell) = score_matrix.get_mut(c).and_then(|row| row.get_mut(t)) {
                *cell = score;
            }
        }
    }

    let top = TopByClass(
        ranked
            .iter()
            .enumerate()
            .map(|(c, list)| {
                let entries = list
                    .iter()
                    .take(k)
                    .map(|&(t, score)| TextFeatureTopEntry {
                        term: term_name(t),
                        score,
                        log_weight: weight(&params.log_weights, c, t),
                        count: weight(&params.class_term_counts, c, t),
                    })
                    .collect();
                (class_name(c), entries)
            })
            .collect(),
    );

    let is_complement = params.likelihood == TextLikelihood::Complement;
    let mut full: Vec<TextFeatureFullEntry> = Vec::with_capacity(n_terms * n_classes);
    for t in 0..n_terms {
        for c in 0..n_classes {
            let log_weight = weight(&params.log_weights, c, t);
            let probability = if is_complement {
                (-log_weight).exp()
            } else {
                log_weight.exp()
            };
            full.push(TextFeatureFullEntry {
                term: term_name(t),
                class: class_name(c),
                count: weight(&params.class_term_counts, c, t),
                log_weight,
                probability,
                score: weight(&score_matrix, c, t),
            });
        }
    }

    TextFeatureTable {
        likelihood: likelihood_name(params.likelihood),
        classes: params.classes.clone(),
        k,
        top,
        full,
    }
}

/// Konversi `top` menjadi peta terurut (dipakai test/pemanggil yang butuh
/// pencarian cepat tanpa menyentuh urutan kunci JSON).
pub fn top_as_map(top: &TopByClass) -> BTreeMap<String, Vec<TextFeatureTopEntry>> {
    top.0.iter().cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use statify_text_core::CsrMatrix;

    const TOL: f64 = 1e-6;

    fn classes() -> Vec<String> {
        vec!["neg".to_string(), "pos".to_string()]
    }

    fn terms() -> Vec<String> {
        ["makan", "nasi", "saya", "suka", "tidak"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    /// Matriks latih golden AGENTS_V2 §6.7 (label pos, neg, pos).
    fn golden_matrix() -> CsrMatrix {
        let rows: Vec<Vec<f64>> = vec![
            vec![1.0, 1.0, 1.0, 1.0, 0.0],
            vec![0.0, 1.0, 1.0, 1.0, 1.0],
            vec![3.0, 0.0, 0.0, 0.0, 0.0],
        ];
        let mut indptr = vec![0usize];
        let mut indices = Vec::new();
        let mut data = Vec::new();
        for row in &rows {
            for (col, &value) in row.iter().enumerate() {
                if value != 0.0 {
                    indices.push(col as u32);
                    data.push(value);
                }
            }
            indptr.push(indices.len());
        }
        CsrMatrix {
            n_rows: rows.len(),
            n_cols: 5,
            indptr,
            indices,
            data,
        }
    }

    fn golden_params(likelihood: TextLikelihood) -> TextNbParams {
        // pos = 1, neg = 0 (kelas terurut [neg, pos]).
        nb_text::train(&golden_matrix(), &[1, 0, 1], 2, &classes(), likelihood, 1.0)
    }

    fn close(actual: f64, expected: f64, context: &str) {
        assert!(
            (actual - expected).abs() < TOL,
            "{}: diperoleh {}, diharapkan {}",
            context,
            actual,
            expected
        );
    }

    fn names(entries: &[TextFeatureTopEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.term.as_str()).collect()
    }

    #[test]
    fn multinomial_golden_top_k_urutan_skor_dan_tie_break_alfabetis() {
        let table =
            build_text_feature_table(&golden_params(TextLikelihood::Multinomial), &terms(), 5);
        assert_eq!(table.likelihood, "multinomial");
        assert_eq!(table.classes, classes());
        assert_eq!(table.k, 5);

        // neg: tidak (0.98083) lebih dulu; nasi/saya/suka seri (0.287682) -> alfabetis; makan terakhir.
        let neg = table.top.get("neg").expect("top neg");
        assert_eq!(names(neg), vec!["tidak", "nasi", "saya", "suka", "makan"]);
        close(neg[0].score, 0.980830, "skor neg/tidak");
        close(neg[1].score, 0.287682, "skor neg/nasi");
        close(neg[4].score, -1.321756, "skor neg/makan");
        // log_weight & count = golden §6.7 / N_ct.
        close(neg[0].log_weight, -1.504077, "L neg/tidak");
        close(neg[0].count, 1.0, "N neg/tidak");
        close(neg[4].log_weight, -2.197225, "L neg/makan");
        close(neg[4].count, 0.0, "N neg/makan");

        // pos: makan (1.321756), nasi/saya/suka seri (-0.287682), tidak (-0.98083).
        let pos = table.top.get("pos").expect("top pos");
        assert_eq!(names(pos), vec!["makan", "nasi", "saya", "suka", "tidak"]);
        close(pos[0].score, 1.321756, "skor pos/makan");
        close(pos[0].log_weight, -0.875469, "L pos/makan");
        close(pos[0].count, 4.0, "N pos/makan");
        close(pos[4].score, -0.980830, "skor pos/tidak");
        close(pos[4].count, 0.0, "N pos/tidak");
    }

    #[test]
    fn top_k_dipotong_ke_k_dan_k_nol_atau_besar_tidak_panic() {
        let params = golden_params(TextLikelihood::Multinomial);

        let table = build_text_feature_table(&params, &terms(), 2);
        assert_eq!(table.top.get("neg").map(|v| v.len()), Some(2));
        assert_eq!(table.top.get("pos").map(|v| v.len()), Some(2));
        // `full` tetap memuat SEMUA term x kelas walau k kecil.
        assert_eq!(table.full.len(), 10);

        let table = build_text_feature_table(&params, &terms(), 0);
        assert_eq!(table.top.get("neg").map(|v| v.len()), Some(0));
        assert_eq!(table.full.len(), 10);

        let table = build_text_feature_table(&params, &terms(), 1000);
        assert_eq!(table.top.get("neg").map(|v| v.len()), Some(5));
        assert_eq!(table.k, 1000);
    }

    #[test]
    fn full_berurutan_term_lalu_kelas_dengan_probability_multinomial() {
        let table =
            build_text_feature_table(&golden_params(TextLikelihood::Multinomial), &terms(), 3);
        assert_eq!(table.full.len(), 10);

        // Urutan: makan/neg, makan/pos, nasi/neg, nasi/pos, ...
        assert_eq!(table.full[0].term, "makan");
        assert_eq!(table.full[0].class, "neg");
        assert_eq!(table.full[1].term, "makan");
        assert_eq!(table.full[1].class, "pos");
        assert_eq!(table.full[2].term, "nasi");
        assert_eq!(table.full[9].term, "tidak");
        assert_eq!(table.full[9].class, "pos");

        // makan/neg: theta = 1/9; log = -2.197225; count 0; skor -1.321756.
        close(table.full[0].probability, 1.0 / 9.0, "prob makan/neg");
        close(table.full[0].log_weight, -2.197225, "L makan/neg");
        close(table.full[0].count, 0.0, "count makan/neg");
        close(table.full[0].score, -1.321756, "skor makan/neg");
        // makan/pos: theta = 5/12.
        close(table.full[1].probability, 5.0 / 12.0, "prob makan/pos");
        close(table.full[1].score, 1.321756, "skor makan/pos");

        // Setiap baris `full` konsisten dengan baris `top` yang sama.
        for class in classes() {
            for entry in table.top.get(&class).expect("top") {
                let found = table
                    .full
                    .iter()
                    .find(|f| f.class == class && f.term == entry.term)
                    .expect("entri full");
                assert_eq!(found.score, entry.score);
                assert_eq!(found.log_weight, entry.log_weight);
                assert_eq!(found.count, entry.count);
            }
        }
    }

    #[test]
    fn bernoulli_probability_adalah_p_dan_count_adalah_dokumen() {
        let table =
            build_text_feature_table(&golden_params(TextLikelihood::Bernoulli), &terms(), 5);
        assert_eq!(table.likelihood, "bernoulli");
        // makan/neg: n_ct = 0, n_c = 1 -> p = (0+1)/(1+2) = 1/3.
        close(table.full[0].probability, 1.0 / 3.0, "p makan/neg");
        close(table.full[0].log_weight, -1.098612, "L makan/neg");
        close(table.full[0].count, 0.0, "n makan/neg");
        // makan/pos: n_ct = 2 (dua dokumen pos memuat makan), n_c = 2 -> p = 3/4.
        close(table.full[1].probability, 0.75, "p makan/pos");
        close(table.full[1].log_weight, -0.287682, "L makan/pos");
        close(table.full[1].count, 2.0, "n makan/pos");
    }

    #[test]
    fn complement_probability_adalah_exp_minus_log_weight() {
        let table =
            build_text_feature_table(&golden_params(TextLikelihood::Complement), &terms(), 5);
        assert_eq!(table.likelihood, "complement");
        // makan/neg: L = -ln(theta~) = 0.875469; theta~ = (C+1)/(sum C + V) = 5/12.
        close(table.full[0].log_weight, 0.875469, "L makan/neg");
        close(table.full[0].probability, 5.0 / 12.0, "theta~ makan/neg");
        // C_ct makan/neg = jumlah makan di dokumen non-neg = 1 + 3 = 4.
        close(table.full[0].count, 4.0, "C makan/neg");
        // makan/pos: L = 2.197225; theta~ = 1/9; C = 0.
        close(table.full[1].log_weight, 2.197225, "L makan/pos");
        close(table.full[1].probability, 1.0 / 9.0, "theta~ makan/pos");
        close(table.full[1].count, 0.0, "C makan/pos");
        // Skor Top-k dari CORE (L_ct - rata-rata L kelas lain): neg/makan = 0.875469 - 2.197225.
        close(table.full[0].score, -1.321756, "skor makan/neg");
    }

    #[test]
    fn serialisasi_json_memenuhi_bentuk_terkunci_dan_urutan_kunci_top_mengikuti_kelas() {
        let table =
            build_text_feature_table(&golden_params(TextLikelihood::Multinomial), &terms(), 2);
        let json = serde_json::to_value(&table).expect("serialisasi");

        let keys: Vec<&String> = json.as_object().expect("object").keys().collect();
        let mut sorted: Vec<&str> = keys.iter().map(|k| k.as_str()).collect();
        sorted.sort();
        assert_eq!(sorted, vec!["classes", "full", "k", "likelihood", "top"]);

        assert_eq!(json["likelihood"], "multinomial");
        assert_eq!(json["classes"], serde_json::json!(["neg", "pos"]));
        assert_eq!(json["k"], 2);

        let top = json["top"].as_object().expect("top object");
        assert_eq!(top.len(), 2);
        let first = &json["top"]["neg"][0];
        let mut entry_keys: Vec<&str> = first
            .as_object()
            .expect("entri")
            .keys()
            .map(|k| k.as_str())
            .collect();
        entry_keys.sort();
        assert_eq!(entry_keys, vec!["count", "log_weight", "score", "term"]);

        let full0 = json["full"][0].as_object().expect("full[0]");
        let mut full_keys: Vec<&str> = full0.keys().map(|k| k.as_str()).collect();
        full_keys.sort();
        assert_eq!(
            full_keys,
            vec![
                "class",
                "count",
                "log_weight",
                "probability",
                "score",
                "term"
            ]
        );

        // Urutan kunci `top` (serde_json dengan preserve_order tidak aktif akan
        // mengurutkan alfabetis; urutan sebenarnya diperiksa langsung di struct).
        let order: Vec<&str> = table.top.0.iter().map(|(c, _)| c.as_str()).collect();
        assert_eq!(order, vec!["neg", "pos"]);
    }

    #[test]
    fn kelas_tanpa_dokumen_tidak_menghasilkan_nan_dan_satu_kelas_memakai_log_weight() {
        // K = 1: skor = L_ct (§6.6).
        let single_classes = vec!["only".to_string()];
        let params = nb_text::train(
            &golden_matrix(),
            &[0, 0, 0],
            1,
            &single_classes,
            TextLikelihood::Multinomial,
            1.0,
        );
        let table = build_text_feature_table(&params, &terms(), 5);
        for entry in &table.full {
            assert!(entry.score.is_finite() && entry.log_weight.is_finite());
            assert_eq!(entry.score, entry.log_weight);
        }

        // Kelas "pos" tidak punya dokumen sama sekali -> tetap finite (smoothing).
        let params = nb_text::train(
            &golden_matrix(),
            &[0, 0, 0],
            2,
            &classes(),
            TextLikelihood::Multinomial,
            1.0,
        );
        let table = build_text_feature_table(&params, &terms(), 5);
        for entry in &table.full {
            assert!(entry.score.is_finite(), "{:?}", entry);
            assert!(entry.probability.is_finite(), "{:?}", entry);
        }
    }

    #[test]
    fn parameter_kosong_tidak_panic() {
        let params = nb_text::train(
            &CsrMatrix {
                n_rows: 0,
                n_cols: 0,
                indptr: vec![0],
                indices: vec![],
                data: vec![],
            },
            &[],
            2,
            &classes(),
            TextLikelihood::Multinomial,
            1.0,
        );
        let table = build_text_feature_table(&params, &[], 10);
        assert!(table.full.is_empty());
        assert!(table.top.0.iter().all(|(_, entries)| entries.is_empty()));
    }
}
