//! `statify-text-core` — inti pemrosesan teks Statify (library Rust murni).
//!
//! Dipakai oleh pembungkus WASM StringToWordVector (STWV) dan, pada Tahap 2,
//! oleh Naive Bayes v2 dan Apply Model v2.
//!
//! Fase S1: logika dipindahkan dari `STWV/rust/src` TANPA mengubah perilaku.

pub mod config;
pub mod error;
pub mod model;
pub mod nb_text;
pub mod ngram;
pub mod pipeline;
pub mod stemmer;
pub mod stopwords;
pub mod tokenizer;
pub mod validator;
pub mod vectorizer;

pub use config::{
    FormulaStandard, IdfMethod, Normalization, StemmingMethod, StopwordsMethod, TextVectorizerConfig, TfMethod,
};
pub use error::TextError;
pub use model::{fit, fit_transform, transform, CsrMatrix, TextVectorizerModel, RECIPE_VERSION};
pub use pipeline::{prepare, Pipeline};
pub use vectorizer::{output_from_model, OutputStats, VectorizerOutput};

/// Pipeline NLP: Tokenize → Filter Stopwords → Stem → N-Gram untuk seluruh dokumen.
///
/// Regex, set stopwords, dan stemmer dibangun SEKALI lewat `prepare` (F08). Error parse stopwords
/// dipropagasi sebagai `INVALID_STOPWORDS` (F11); fallback diam-diam v1 dihapus.
pub fn preprocess_documents(
    raw_docs: &[String],
    config: &TextVectorizerConfig,
) -> Result<Vec<Vec<String>>, TextError> {
    let pipeline = prepare(config)?;
    Ok(pipeline.tokens_batch(raw_docs))
}

/// Jalankan seluruh pipeline: validasi → preprocessing → vectorize.
/// Hasil identik dengan `process_text_data` versi v1 untuk konfigurasi yang sah.
pub fn run_pipeline(
    raw_docs: &[String],
    config: &TextVectorizerConfig,
) -> Result<VectorizerOutput, TextError> {
    // fit_transform: validasi → pipeline NLP (dibangun sekali) → statistik fit → matriks CSR.
    // Keluaran dense (§3.5) dibangun dari CSR lewat `to_dense()`.
    let (model, csr) = model::fit_transform(raw_docs, config)?;
    Ok(output_from_model(&model, &csr))
}
