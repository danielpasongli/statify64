//! API fit/transform + "resep" (TextVectorizerModel) + matriks sparse CSR (PLAN_FIX.md §3.4, Fase S4).
//!
//! `fit` menghitung SEMUA statistik (kosakata, df, IDF, N, `avg_doc_norm`) dari data latih dan
//! menyimpannya di model. `transform` hanya MEMBACA model: tidak ada statistik yang dihitung ulang
//! dari data transform; term di luar kosakata (OOV) diabaikan.

use crate::config::TextVectorizerConfig;
use crate::error::TextError;
use crate::pipeline::{self, Pipeline};
use crate::{validator, vectorizer};
use hashbrown::HashSet;
use serde::{Deserialize, Serialize};

/// Versi format resep. `transform` menolak model dengan versi lain (`INVALID_DATA`).
pub const RECIPE_VERSION: &str = "1.0";

/// "Resep" vectorizer teks: semua yang dibutuhkan untuk mengulang transformasi yang sama pada data baru.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TextVectorizerModel {
    /// "1.0"
    pub recipe_version: String,
    /// Konfigurasi saat fit (disimpan apa adanya).
    pub config: TextVectorizerConfig,
    /// Daftar stopword final (lowercase, unik, urut alfabetis) yang dipakai saat fit.
    /// `transform` memakai daftar ini, BUKAN mem-parse ulang `config.custom_stopwords`.
    pub resolved_stopwords: Vec<String>,
    /// Kosakata akhir; urutan = urutan kolom (alfabetis byte-wise).
    pub vocabulary: Vec<String>,
    /// Nilai IDF sejajar `vocabulary` (1.0 bila idf none).
    pub idf: Vec<f64>,
    /// Document frequency saat fit, sejajar `vocabulary`.
    pub doc_freq: Vec<u32>,
    /// Jumlah dokumen saat fit (N).
    pub n_docs: u32,
    /// Rata-rata norma L2 baris dokumen fit (norma > 0). Hanya terisi untuk normalisasi `doc_length`.
    pub avg_doc_norm: Option<f64>,
}

/// Matriks sparse format CSR. Indeks kolom tiap baris urut menaik.
///
/// Catatan: sel dari term yang ada di kosakata disimpan secara struktural walau nilainya 0.0
/// (mis. IDF standard = ln(N/df) = 0). Baris tanpa entri = dokumen tanpa satu pun term kosakata.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CsrMatrix {
    pub n_rows: usize,
    pub n_cols: usize,
    /// Panjang `n_rows + 1`; entri baris r berada di `indptr[r]..indptr[r+1]`.
    pub indptr: Vec<usize>,
    pub indices: Vec<u32>,
    pub data: Vec<f64>,
}

impl CsrMatrix {
    /// Ubah ke matriks dense (`n_rows` × `n_cols`). Entri di luar rentang diabaikan (tanpa panic).
    pub fn to_dense(&self) -> Vec<Vec<f64>> {
        let mut dense = vec![vec![0.0_f64; self.n_cols]; self.n_rows];
        for (r, row) in dense.iter_mut().enumerate() {
            let (start, end) = match (self.indptr.get(r), self.indptr.get(r + 1)) {
                (Some(&s), Some(&e)) => (s, e),
                _ => break,
            };
            let end = end.min(self.indices.len()).min(self.data.len());
            for k in start..end {
                let c = self.indices[k] as usize;
                if c < self.n_cols {
                    row[c] = self.data[k];
                }
            }
        }
        dense
    }
}

/// Validasi → pipeline NLP → statistik fit. Mengembalikan model + baris sparse (sebelum normalisasi).
/// Urutan validasi sama dengan `run_pipeline` v1 (dokumen → config/regex/stopwords).
fn fit_internal(
    docs: &[String],
    cfg: &TextVectorizerConfig,
) -> Result<(TextVectorizerModel, Vec<vectorizer::SparseRow>), TextError> {
    validator::validate(docs, cfg.ngram_min, cfg.ngram_max)?;
    let pipeline = pipeline::prepare(cfg)?;
    let processed = pipeline.tokens_batch(docs);
    vectorizer::fit_tokens(&processed, cfg, pipeline.resolved_stopwords())
}

/// Latih vectorizer pada `docs` dan kembalikan resepnya.
pub fn fit(docs: &[String], cfg: &TextVectorizerConfig) -> Result<TextVectorizerModel, TextError> {
    let (model, _rows) = fit_internal(docs, cfg)?;
    Ok(model)
}

/// Terapkan resep pada `docs`. Tidak ada statistik yang dihitung ulang: kosakata, IDF, dan
/// `avg_doc_norm` berasal dari `model`. Term di luar kosakata (OOV) diabaikan; dokumen kosong/OOV → baris nol.
pub fn transform(model: &TextVectorizerModel, docs: &[String]) -> Result<CsrMatrix, TextError> {
    validate_model(model)?;
    if docs.is_empty() {
        return Err(TextError::new(
            "EMPTY_INPUT",
            "The document list is empty. Make sure the selected variable contains data.",
        ));
    }
    // Stopword dari model (sudah final), bukan dari config.
    let stopwords: Option<HashSet<String>> = if model.resolved_stopwords.is_empty() {
        None
    } else {
        Some(model.resolved_stopwords.iter().cloned().collect())
    };
    let pipeline: Pipeline = pipeline::prepare_with_stopwords(&model.config, stopwords)?;
    let processed = pipeline.tokens_batch(docs);
    let rows = vectorizer::rows_for_model(model, &processed);
    vectorizer::finish_rows(rows, model)
}

/// `fit` lalu `transform` pada data yang sama; hasilnya identik dengan `transform(&fit(..), ..)`.
pub fn fit_transform(
    docs: &[String],
    cfg: &TextVectorizerConfig,
) -> Result<(TextVectorizerModel, CsrMatrix), TextError> {
    let (model, rows) = fit_internal(docs, cfg)?;
    let csr = vectorizer::finish_rows(rows, &model)?;
    Ok((model, csr))
}

/// Pastikan model utuh (mis. hasil deserialisasi dari sumber luar) sebelum dipakai.
fn validate_model(model: &TextVectorizerModel) -> Result<(), TextError> {
    if model.recipe_version != RECIPE_VERSION {
        return Err(TextError::new(
            "INVALID_DATA",
            &format!(
                "The text model has an unsupported recipe version \"{}\" (expected \"{}\").",
                model.recipe_version, RECIPE_VERSION
            ),
        ));
    }
    if model.vocabulary.is_empty() {
        return Err(TextError::new("EMPTY_VOCABULARY", "The text model has an empty vocabulary."));
    }
    if model.idf.len() != model.vocabulary.len() || model.doc_freq.len() != model.vocabulary.len() {
        return Err(TextError::new(
            "INVALID_DATA",
            "The text model is inconsistent: the vocabulary, idf, and doc_freq lists must have the same length.",
        ));
    }
    Ok(())
}
