//! Likelihood Naive Bayes untuk fitur teks (Multinomial / Bernoulli / Complement) — Fase N2.
//!
//! Modul murni (tanpa I/O) yang dipakai bersama oleh Naive Bayes v2 dan Apply Model v2
//! agar skor keduanya identik (AGENTS_V2 P-V2, P-V3). Rumus dikunci di AGENTS_V2 §6.1–§6.3 dan §6.6.
//!
//! Catatan perilaku:
//! - Nilai non-finite pada matriks diperlakukan sebagai 0 (validasi nilai negatif dilakukan pemanggil,
//!   kode `NB_E_TEXT_NEGATIVE` / `AM_E_TEXT_NEGATIVE`).
//! - Baris dengan label di luar `0..n_classes` diabaikan saat `train` (tanpa panic).
//! - Kelas yang tidak punya dokumen tidak menghasilkan NaN: smoothing `alpha > 0` menjaga penyebut > 0,
//!   dan `ln` diamankan (`safe_ln`) bila `alpha` tidak valid.

use crate::model::CsrMatrix;
use serde::{Deserialize, Serialize};

/// Jenis likelihood teks. Nama JSON mengikuti string TS (`multinomial`/`bernoulli`/`complement`).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TextLikelihood {
    Multinomial,
    Bernoulli,
    Complement,
}

/// Parameter model teks terlatih. Semua matriks berbentuk `[kelas][term]`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TextNbParams {
    pub likelihood: TextLikelihood,
    pub alpha: f64,
    pub classes: Vec<String>,
    /// `L_ct`: Multinomial `ln θ`, Bernoulli `ln p`, Complement `−ln θ̃` (AGENTS_V2 §6.1–6.3).
    pub log_weights: Vec<Vec<f64>>,
    /// `A_ct = ln(1 − p_ct)`; hanya terisi untuk Bernoulli.
    pub log_weights_absent: Option<Vec<Vec<f64>>>,
    /// `N_ct` (Multinomial), `n_ct` (Bernoulli), `C_ct` (Complement).
    pub class_term_counts: Vec<Vec<f64>>,
    /// `false` hanya untuk Complement dengan `K >= 2` (skor tanpa prior, §6.3).
    pub uses_class_prior: bool,
}

/// `ln` aman: nilai ≤ 0 atau NaN dipetakan ke `ln(f64::MIN_POSITIVE)` (konsisten dengan `safe_ln` NB v1).
fn safe_ln(value: f64) -> f64 {
    if value > 0.0 {
        value.ln()
    } else {
        f64::MIN_POSITIVE.ln()
    }
}

/// Iterasi entri (kolom, nilai) satu baris CSR; entri di luar rentang atau non-finite dilewati.
fn row_entries(x: &CsrMatrix, row: usize) -> impl Iterator<Item = (usize, f64)> + '_ {
    let (start, end) = match (x.indptr.get(row), x.indptr.get(row + 1)) {
        (Some(&s), Some(&e)) => (s, e.min(x.indices.len()).min(x.data.len())),
        _ => (0, 0),
    };
    (start..end).filter_map(move |k| {
        let col = x.indices[k] as usize;
        let value = x.data[k];
        if col < x.n_cols && value.is_finite() {
            Some((col, value))
        } else {
            None
        }
    })
}

/// Latih likelihood teks dari matriks term–dokumen `x` (CSR, baris = dokumen) dan label kelas `y`
/// (indeks `0..n_classes`). `classes` adalah nama kelas berurutan sesuai indeks.
pub fn train(
    x: &CsrMatrix,
    y: &[usize],
    n_classes: usize,
    classes: &[String],
    likelihood: TextLikelihood,
    alpha: f64,
) -> TextNbParams {
    let v = x.n_cols;
    let rows = x.n_rows.min(y.len());

    // Akumulasi per kelas: jumlah nilai (N_ct), jumlah dokumen dengan x>0 (n_ct), jumlah dokumen (n_c).
    let mut sum_counts = vec![vec![0.0_f64; v]; n_classes];
    let mut presence_counts = vec![vec![0.0_f64; v]; n_classes];
    let mut docs_per_class = vec![0.0_f64; n_classes];

    for (row, &label) in y.iter().enumerate().take(rows) {
        if label >= n_classes {
            continue;
        }
        docs_per_class[label] += 1.0;
        for (col, value) in row_entries(x, row) {
            sum_counts[label][col] += value;
            if value > 0.0 {
                presence_counts[label][col] += 1.0;
            }
        }
    }

    let v_f = v as f64;
    let mut log_weights = vec![vec![0.0_f64; v]; n_classes];
    let mut log_absent: Option<Vec<Vec<f64>>> = None;
    let class_term_counts: Vec<Vec<f64>>;

    match likelihood {
        TextLikelihood::Multinomial => {
            for c in 0..n_classes {
                let n_c: f64 = sum_counts[c].iter().sum();
                let denom = n_c + alpha * v_f;
                for t in 0..v {
                    log_weights[c][t] = safe_ln((sum_counts[c][t] + alpha) / denom);
                }
            }
            class_term_counts = sum_counts;
        }
        TextLikelihood::Bernoulli => {
            let mut absent = vec![vec![0.0_f64; v]; n_classes];
            for c in 0..n_classes {
                let denom = docs_per_class[c] + 2.0 * alpha;
                for t in 0..v {
                    let p = (presence_counts[c][t] + alpha) / denom;
                    log_weights[c][t] = safe_ln(p);
                    absent[c][t] = safe_ln(1.0 - p);
                }
            }
            log_absent = Some(absent);
            class_term_counts = presence_counts;
        }
        TextLikelihood::Complement => {
            // Total per term di seluruh kelas; C_ct = total_t − N_ct (dokumen di luar kelas c).
            let mut total = vec![0.0_f64; v];
            for class_sums in &sum_counts {
                for (t, value) in class_sums.iter().enumerate() {
                    total[t] += value;
                }
            }
            let mut complement_counts = vec![vec![0.0_f64; v]; n_classes];
            for c in 0..n_classes {
                for t in 0..v {
                    // Kurangi dari total bisa menyisakan galat pembulatan kecil negatif; jepit ke 0.
                    complement_counts[c][t] = (total[t] - sum_counts[c][t]).max(0.0);
                }
                let sum_c: f64 = complement_counts[c].iter().sum();
                let denom = sum_c + alpha * v_f;
                for t in 0..v {
                    log_weights[c][t] = -safe_ln((complement_counts[c][t] + alpha) / denom);
                }
            }
            class_term_counts = complement_counts;
        }
    }

    // Complement tanpa prior bila K >= 2; K = 1 tetap memakai ln prior (§6.3).
    let uses_class_prior = !(likelihood == TextLikelihood::Complement && n_classes >= 2);

    TextNbParams {
        likelihood,
        alpha,
        classes: classes.to_vec(),
        log_weights,
        log_weights_absent: log_absent,
        class_term_counts,
        uses_class_prior,
    }
}

/// Kontribusi skor Text per baris per kelas (TANPA `ln prior`): `[baris][kelas]`.
///
/// - Multinomial/Complement: `Σ_t x_dt · L_ct` (hanya entri non-nol).
/// - Bernoulli: `Σ_t A_ct + Σ_{t: b=1} (L_ct − A_ct)` dengan `b = 1` bila `x_dt > 0`.
pub fn score_rows(params: &TextNbParams, x: &CsrMatrix) -> Vec<Vec<f64>> {
    let n_classes = params.log_weights.len();
    let n_terms = params.log_weights.first().map_or(0, |row| row.len());

    // Bernoulli: jumlah A_ct seluruh term per kelas dihitung sekali.
    let absent_sums: Vec<f64> = match (&params.likelihood, &params.log_weights_absent) {
        (TextLikelihood::Bernoulli, Some(absent)) => absent.iter().map(|row| row.iter().sum()).collect(),
        _ => vec![0.0; n_classes],
    };

    let mut result = Vec::with_capacity(x.n_rows);
    for row in 0..x.n_rows {
        let mut scores = absent_sums.clone();
        for (col, value) in row_entries(x, row) {
            if col >= n_terms {
                continue;
            }
            match params.likelihood {
                TextLikelihood::Multinomial | TextLikelihood::Complement => {
                    for (c, score) in scores.iter_mut().enumerate() {
                        *score += value * params.log_weights[c][col];
                    }
                }
                TextLikelihood::Bernoulli => {
                    if value > 0.0 {
                        if let Some(absent) = &params.log_weights_absent {
                            for (c, score) in scores.iter_mut().enumerate() {
                                *score += params.log_weights[c][col] - absent[c][col];
                            }
                        }
                    }
                }
            }
        }
        result.push(scores);
    }
    result
}

/// Top-k term paling berpengaruh per kelas (§6.6): `score_ct = L_ct − mean_{c'≠c} L_c't`
/// (bila `K = 1`: `score = L_ct`). Urut menurun menurut skor; seri → term alfabetis (byte-wise),
/// lalu indeks term. Hasil: `[kelas] -> [(indeks term, skor)]`, maksimal `k` entri per kelas.
pub fn top_k(params: &TextNbParams, terms: &[String], k: usize) -> Vec<Vec<(usize, f64)>> {
    let n_classes = params.log_weights.len();
    let n_terms = params.log_weights.first().map_or(0, |row| row.len());

    // Jumlah L per term lintas kelas, agar rata-rata kelas lain = (jumlah − L_ct) / (K − 1).
    let mut column_sums = vec![0.0_f64; n_terms];
    for class_weights in &params.log_weights {
        for (t, value) in class_weights.iter().enumerate().take(n_terms) {
            column_sums[t] += value;
        }
    }

    let term_name = |t: usize| terms.get(t).map(String::as_str).unwrap_or("");

    let mut result = Vec::with_capacity(n_classes);
    for class_weights in &params.log_weights {
        let mut scored: Vec<(usize, f64)> = (0..n_terms)
            .map(|t| {
                let l = class_weights.get(t).copied().unwrap_or(0.0);
                let score = if n_classes >= 2 {
                    l - (column_sums[t] - l) / (n_classes as f64 - 1.0)
                } else {
                    l
                };
                (t, score)
            })
            .collect();
        scored.sort_by(|a, b| {
            b.1.total_cmp(&a.1)
                .then_with(|| term_name(a.0).cmp(term_name(b.0)))
                .then_with(|| a.0.cmp(&b.0))
        });
        scored.truncate(k);
        result.push(scored);
    }
    result
}
