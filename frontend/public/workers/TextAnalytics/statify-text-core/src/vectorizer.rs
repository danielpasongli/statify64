use crate::config::{FormulaStandard, IdfMethod, Normalization, TextVectorizerConfig, TfMethod};
use crate::error::TextError;
use crate::model::{CsrMatrix, TextVectorizerModel, RECIPE_VERSION};
use serde::Serialize;
use std::collections::HashMap;

/// Struct output final yang dikirim ke JavaScript.
#[derive(Serialize, Debug)]
pub struct VectorizerOutput {
    pub vocabulary: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
    pub stats: OutputStats,
}

/// Statistik keluaran (PLAN_FIX.md §3.5).
#[derive(Serialize, Debug)]
pub struct OutputStats {
    pub total_documents: usize,
    /// Jumlah dokumen yang tidak punya satu pun token di kosakata akhir (baris nol).
    pub empty_documents: usize,
    pub vocabulary_size: usize,
    /// "weka" | "sklearn" | "custom"
    pub formula_standard: String,
    /// Contoh: "TF: raw, IDF: none, Norm: none, Keep: 1000, MinFreq: 1"
    pub method: String,
}

/// Statistik satu term selama satu pass di seluruh dokumen.
struct TermStat {
    /// Total kemunculan (raw count) di seluruh dokumen.
    total: u64,
    /// Jumlah dokumen yang memuat term.
    df: u32,
}

/// Satu baris sparse: pasangan (indeks kolom, nilai) urut menurut kolom.
/// Nilai sudah `tf × idf`, BELUM dinormalisasi (normalisasi dilakukan `finish_rows`).
pub(crate) type SparseRow = Vec<(u32, f64)>;

/// Kompatibilitas v1: vectorize token per dokumen menjadi matriks dense + statistik.
/// Setara `fit_tokens` + `finish_rows` + `output_from_model` (tanpa daftar stopword di resep).
pub fn vectorize(
    processed: Vec<Vec<String>>,
    config: &TextVectorizerConfig,
) -> Result<VectorizerOutput, TextError> {
    let (model, rows) = fit_tokens(&processed, config, Vec::new())?;
    let csr = finish_rows(rows, &model)?;
    Ok(output_from_model(&model, &csr))
}

/// Bangun keluaran §3.5 (dense + stats) dari model dan matriks CSR-nya (`to_dense()`).
/// `empty_documents` = baris tanpa satu pun entri (dokumen tanpa term kosakata).
pub fn output_from_model(model: &TextVectorizerModel, csr: &CsrMatrix) -> VectorizerOutput {
    let cfg = &model.config;
    VectorizerOutput {
        stats: OutputStats {
            total_documents: csr.n_rows,
            empty_documents: csr.indptr.windows(2).filter(|w| w[0] == w[1]).count(),
            vocabulary_size: model.vocabulary.len(),
            formula_standard: cfg.formula_standard.as_str().to_string(),
            method: format!(
                "TF: {}, IDF: {}, Norm: {}, Keep: {}, MinFreq: {}",
                cfg.tf_method.as_str(),
                cfg.idf_method.as_str(),
                cfg.normalization.as_str(),
                cfg.words_to_keep,
                cfg.min_term_freq
            ),
        },
        vocabulary: model.vocabulary.clone(),
        matrix: csr.to_dense(),
    }
}

/// FIT (PLAN_FIX.md §3.2): menghitung seluruh statistik dari token dokumen latih.
///
/// Urutan nilai sel: `tf → × idf → normalisasi`.
/// - TF        : binary | raw | log1p (ln(1+c)) | sublinear (1+ln c) | normalized (c / T(d))
/// - IDF       : none | standard ln(N/df) | smooth ln((1+N)/(1+df))+1 | plus1 ln(N/df)+1
/// - Normalisasi: none | l1 | l2 | doc_length (Weka: v · avg_norm / ‖v‖₂)
///
/// Pemilihan kosakata: (1) kumpulkan term + total count + df dalam SATU pass per dokumen,
/// (2) buang total count < `min_term_freq`, (3) bila `words_to_keep` > 0 dan term > `words_to_keep`:
/// rangking (weka/sklearn: total count; custom: Σ TF×IDF), tie → alfabetis, (4) urut alfabetis
/// (byte-wise) sebagai urutan kolom, (5) IDF hanya untuk kosakata akhir.
///
/// Mengembalikan model (resep: kosakata, idf, df, N, `avg_doc_norm`) dan baris sparse data latih
/// (belum dinormalisasi). Dokumen tanpa token di kosakata menghasilkan baris kosong.
pub(crate) fn fit_tokens(
    processed: &[Vec<String>],
    config: &TextVectorizerConfig,
    resolved_stopwords: Vec<String>,
) -> Result<(TextVectorizerModel, Vec<SparseRow>), TextError> {
    let tf_method = config.tf_method;
    let idf_method = config.idf_method;
    let words_to_keep = config.words_to_keep;
    let min_term_freq = config.min_term_freq.max(1) as u64;
    let n = processed.len();
    let n_docs = u32::try_from(n)
        .map_err(|_| TextError::new("INVALID_DATA", "The number of documents exceeds the supported limit."))?;

    // 1. SATU pass per dokumen: indeks term, total count, df, dan count sparse per dokumen (F09).
    let mut term_index: HashMap<&str, usize> = HashMap::new();
    let mut terms: Vec<&str> = Vec::new();
    let mut stats: Vec<TermStat> = Vec::new();
    // Per dokumen: pasangan (id term, raw count) hanya untuk term yang muncul.
    let mut doc_counts: Vec<Vec<(usize, u32)>> = Vec::with_capacity(n);

    for doc_tokens in processed {
        let mut counts: HashMap<usize, u32> = HashMap::new();
        for token in doc_tokens {
            let next_id = terms.len();
            let id = *term_index.entry(token.as_str()).or_insert(next_id);
            if id == next_id {
                terms.push(token.as_str());
                stats.push(TermStat { total: 0, df: 0 });
            }
            *counts.entry(id).or_insert(0) += 1;
        }
        let mut entries: Vec<(usize, u32)> = Vec::with_capacity(counts.len());
        for (id, c) in counts {
            stats[id].total += c as u64;
            stats[id].df += 1;
            entries.push((id, c));
        }
        doc_counts.push(entries);
    }

    if terms.is_empty() {
        return Err(TextError::new(
            "EMPTY_VOCABULARY",
            "The vocabulary is empty after text preprocessing. Try using fewer stopwords or changing the stemming setting.",
        ));
    }

    // 2. Buang term dengan total raw count < min_term_freq.
    let mut candidates: Vec<usize> = (0..terms.len())
        .filter(|&i| stats[i].total >= min_term_freq)
        .collect();
    if candidates.is_empty() {
        return Err(TextError::new(
            "EMPTY_VOCABULARY",
            "The vocabulary is empty after applying the minimum term frequency. Try lowering the minimum term frequency.",
        ));
    }

    // 3. Words to Keep: 0 = simpan semua; selain itu rangking sesuai standar lalu truncate ketat.
    if words_to_keep > 0 && candidates.len() > words_to_keep {
        if config.formula_standard == FormulaStandard::Custom {
            // Cara lama: skor = Σ_d TF(d) × IDF (IDF dari df seluruh dokumen), tie → alfabetis.
            let mut score = vec![0.0_f64; terms.len()];
            for entries in &doc_counts {
                let total_tokens: u32 = entries.iter().map(|&(_, c)| c).sum();
                for &(id, c) in entries {
                    score[id] += tf_value(tf_method, c as f64, total_tokens as f64);
                }
            }
            for &i in &candidates {
                let idf = if idf_method == IdfMethod::None {
                    1.0
                } else {
                    idf_value(idf_method, n as f64, stats[i].df as f64)
                };
                score[i] *= idf;
            }
            candidates.sort_by(|&a, &b| {
                score[b]
                    .partial_cmp(&score[a])
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| terms[a].cmp(terms[b]))
            });
        } else {
            // Weka & sklearn: total raw count menurun, tie → alfabetis (byte-wise) naik.
            candidates.sort_by(|&a, &b| {
                stats[b]
                    .total
                    .cmp(&stats[a].total)
                    .then_with(|| terms[a].cmp(terms[b]))
            });
        }
        candidates.truncate(words_to_keep);
    }

    // 4. Urutan kolom: alfabetis byte-wise.
    candidates.sort_by(|&a, &b| terms[a].cmp(terms[b]));
    let vocabulary: Vec<String> = candidates.iter().map(|&i| terms[i].to_string()).collect();

    // Peta id term → indeks kolom (usize::MAX = di luar kosakata).
    let mut col_of = vec![usize::MAX; terms.len()];
    for (col, &id) in candidates.iter().enumerate() {
        col_of[id] = col;
    }

    // 5. IDF + df hanya untuk kosakata akhir (df sudah dihitung pada pass di atas).
    let idf: Vec<f64> = candidates
        .iter()
        .map(|&id| {
            if idf_method == IdfMethod::None {
                1.0
            } else {
                idf_value(idf_method, n as f64, stats[id].df as f64)
            }
        })
        .collect();
    let doc_freq: Vec<u32> = candidates.iter().map(|&id| stats[id].df).collect();

    // 6. Baris sparse data latih: tf → × idf (belum dinormalisasi).
    let mut rows: Vec<SparseRow> = Vec::with_capacity(n);
    for (d, entries) in doc_counts.iter().enumerate() {
        let mut counts: Vec<(usize, u32)> = entries
            .iter()
            .filter_map(|&(id, c)| {
                let col = col_of[id];
                if col == usize::MAX {
                    None
                } else {
                    Some((col, c))
                }
            })
            .collect();
        // T(d): semua token dokumen (termasuk n-gram, sebelum pemangkasan kosakata)
        rows.push(row_from_counts(&mut counts, processed[d].len() as f64, tf_method, &idf));
    }

    // 7. avg_doc_norm (hanya doc_length): rata-rata ‖v‖₂ baris latih yang normanya > 0,
    //    dihitung SEKALI di sini dan disimpan di model (Weka normalizeDocLength).
    let avg_doc_norm = if config.normalization == Normalization::DocLength {
        let positives: Vec<f64> = rows
            .iter()
            .map(|r| row_l2_norm(r))
            .filter(|&x| x > 0.0)
            .collect();
        Some(if positives.is_empty() {
            0.0
        } else {
            positives.iter().sum::<f64>() / positives.len() as f64
        })
    } else {
        None
    };

    let model = TextVectorizerModel {
        recipe_version: RECIPE_VERSION.to_string(),
        config: config.clone(),
        resolved_stopwords,
        vocabulary,
        idf,
        doc_freq,
        n_docs,
        avg_doc_norm,
    };
    Ok((model, rows))
}

/// TRANSFORM: ubah token dokumen menjadi baris sparse memakai kosakata & IDF dari model.
/// Term di luar kosakata (OOV) diabaikan. Tidak ada statistik yang dihitung ulang dari data ini.
pub(crate) fn rows_for_model(model: &TextVectorizerModel, processed: &[Vec<String>]) -> Vec<SparseRow> {
    let col_of: HashMap<&str, usize> = model
        .vocabulary
        .iter()
        .enumerate()
        .map(|(i, t)| (t.as_str(), i))
        .collect();
    processed
        .iter()
        .map(|tokens| {
            let mut counts: HashMap<usize, u32> = HashMap::new();
            for token in tokens {
                if let Some(&col) = col_of.get(token.as_str()) {
                    *counts.entry(col).or_insert(0) += 1;
                }
            }
            let mut entries: Vec<(usize, u32)> = counts.into_iter().collect();
            row_from_counts(&mut entries, tokens.len() as f64, model.config.tf_method, &model.idf)
        })
        .collect()
}

/// Terapkan normalisasi baris (sesuai config model; `doc_length` memakai `avg_doc_norm` TERSIMPAN)
/// lalu susun matriks CSR. Baris nol tetap nol (tanpa NaN/Inf).
pub(crate) fn finish_rows(rows: Vec<SparseRow>, model: &TextVectorizerModel) -> Result<CsrMatrix, TextError> {
    let normalization = model.config.normalization;
    let avg_norm = if normalization == Normalization::DocLength {
        match model.avg_doc_norm {
            Some(a) => a,
            None => {
                return Err(TextError::new(
                    "INVALID_DATA",
                    "The text model is inconsistent: document-length normalization requires the stored average document norm (avg_doc_norm).",
                ))
            }
        }
    } else {
        0.0
    };

    let mut indptr: Vec<usize> = Vec::with_capacity(rows.len() + 1);
    indptr.push(0);
    let mut indices: Vec<u32> = Vec::new();
    let mut data: Vec<f64> = Vec::new();
    let n_rows = rows.len();

    for mut row in rows {
        match normalization {
            Normalization::None => {}
            Normalization::L1 => {
                let s: f64 = row.iter().map(|&(_, x)| x.abs()).sum();
                if s > 0.0 {
                    row.iter_mut().for_each(|e| e.1 /= s);
                }
            }
            Normalization::L2 => {
                let s = row_l2_norm(&row);
                if s > 0.0 {
                    row.iter_mut().for_each(|e| e.1 /= s);
                }
            }
            Normalization::DocLength => {
                let norm = row_l2_norm(&row);
                if norm > 0.0 {
                    let factor = avg_norm / norm;
                    row.iter_mut().for_each(|e| e.1 *= factor);
                }
            }
        }
        for (col, value) in row {
            indices.push(col);
            data.push(value);
        }
        indptr.push(indices.len());
    }

    Ok(CsrMatrix {
        n_rows,
        n_cols: model.vocabulary.len(),
        indptr,
        indices,
        data,
    })
}

/// Susun baris sparse dari (kolom, raw count): urut menurut kolom, nilai = tf × idf.
/// Dipakai bersama oleh fit dan transform agar kedua jalur identik.
fn row_from_counts(counts: &mut [(usize, u32)], total: f64, tf_method: TfMethod, idf: &[f64]) -> SparseRow {
    counts.sort_unstable_by_key(|&(col, _)| col);
    counts
        .iter()
        .map(|&(col, c)| (col as u32, tf_value(tf_method, c as f64, total) * idf[col]))
        .collect()
}

/// Norma Euclidean (L2) baris sparse.
fn row_l2_norm(row: &[(u32, f64)]) -> f64 {
    row.iter().map(|&(_, x)| x * x).sum::<f64>().sqrt()
}

/// Nilai TF satu term pada satu dokumen (`count` = raw count, `total` = jumlah token dokumen).
/// Pencocokan enum bersifat exhaustive: tidak ada lagi fallback diam-diam `_ => count` (F21).
fn tf_value(tf_method: TfMethod, count: f64, total: f64) -> f64 {
    match tf_method {
        TfMethod::Binary => if count > 0.0 { 1.0 } else { 0.0 },
        TfMethod::Raw => count,
        TfMethod::Normalized => if total > 0.0 { count / total } else { 0.0 },
        TfMethod::Sublinear => if count > 0.0 { 1.0 + count.ln() } else { 0.0 },
        TfMethod::Log1p => (1.0 + count).ln(),
    }
}

/// Nilai IDF satu term (`n` = jumlah dokumen, `d` = document frequency, selalu >= 1 untuk term kosakata).
fn idf_value(idf_method: IdfMethod, n: f64, d: f64) -> f64 {
    match idf_method {
        IdfMethod::None => 1.0,
        IdfMethod::Standard => (n / d).ln(),
        IdfMethod::Smooth => ((1.0 + n) / (1.0 + d)).ln() + 1.0,
        IdfMethod::Plus1 => (n / d).ln() + 1.0,
    }
}
