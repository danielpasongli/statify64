use crate::config::{StemmingMethod, TextVectorizerConfig};
use crate::error::TextError;
use crate::{ngram, stemmer, stopwords, tokenizer, validator};
use hashbrown::HashSet;
use regex::Regex;

/// Pipeline preprocessing yang dibangun SEKALI (F08): regex delimiter, HashSet stopwords
/// (JSON di-parse sekali), dan Dictionary Sastrawi (bila stemming Indonesia).
/// Setelah itu dipakai untuk semua dokumen lewat `tokens_batch`.
pub struct Pipeline {
    re: Regex,
    lowercase: bool,
    stopwords: Option<HashSet<String>>,
    stemming_method: StemmingMethod,
    /// Hanya terisi untuk stemming Indonesia (Dictionary mahal dibuat; Stemmer meminjamnya per batch).
    dictionary: Option<sastrawi::Dictionary>,
    ngram_min: usize,
    ngram_max: usize,
}

/// Bangun `Pipeline` dari konfigurasi. Memvalidasi rentang config, meng-compile regex
/// (`INVALID_REGEX`) dan mem-parse stopwords (`INVALID_STOPWORDS`) hanya satu kali.
pub fn prepare(cfg: &TextVectorizerConfig) -> Result<Pipeline, TextError> {
    validator::validate_config(cfg)?;
    let re = tokenizer::compile_regex(&cfg.delimiters)?;
    let stopwords = stopwords::build_set(cfg.stopwords_method, &cfg.custom_stopwords)?;
    Ok(assemble(cfg, re, stopwords))
}

/// Seperti `prepare`, tetapi memakai set stopword yang SUDAH final (dari `TextVectorizerModel`)
/// sehingga JSON `custom_stopwords` pada config tidak di-parse ulang saat transform (Fase S4).
pub(crate) fn prepare_with_stopwords(
    cfg: &TextVectorizerConfig,
    stopwords: Option<HashSet<String>>,
) -> Result<Pipeline, TextError> {
    validator::validate_config(cfg)?;
    let re = tokenizer::compile_regex(&cfg.delimiters)?;
    Ok(assemble(cfg, re, stopwords))
}

/// Rakit `Pipeline` dari bagian-bagiannya (Dictionary Sastrawi dibuat sekali bila stemming Indonesia).
fn assemble(cfg: &TextVectorizerConfig, re: Regex, stopwords: Option<HashSet<String>>) -> Pipeline {
    let dictionary = if cfg.stemming_method == StemmingMethod::Indonesian {
        Some(sastrawi::Dictionary::new())
    } else {
        None
    };
    Pipeline {
        re,
        lowercase: cfg.lowercase,
        stopwords,
        stemming_method: cfg.stemming_method,
        dictionary,
        ngram_min: cfg.ngram_min,
        ngram_max: cfg.ngram_max,
    }
}

impl Pipeline {
    /// Daftar stopword final (lowercase, unik, urut alfabetis) untuk disimpan di resep. Kosong bila tanpa filter.
    pub(crate) fn resolved_stopwords(&self) -> Vec<String> {
        let mut list: Vec<String> = match &self.stopwords {
            Some(set) => set.iter().cloned().collect(),
            None => Vec::new(),
        };
        list.sort();
        list.dedup();
        list
    }

    /// Pipeline NLP untuk banyak dokumen: Tokenize → Filter Stopwords → Stem → N-Gram.
    /// Satu dokumen masukan menghasilkan tepat satu entri keluaran (dokumen kosong → `vec![]`),
    /// sehingga indeks dokumen selalu sejajar.
    pub fn tokens_batch(&self, docs: &[String]) -> Vec<Vec<String>> {
        // [1] Lowercase + Tokenize (Regex split), [2] Filter Stopwords (case-insensitive)
        let tokenized: Vec<Vec<String>> = docs
            .iter()
            .map(|doc| {
                let tokens = tokenizer::tokenize(doc, self.lowercase, &self.re);
                match &self.stopwords {
                    Some(set) => stopwords::filter_with_set(tokens, set),
                    None => tokens,
                }
            })
            .collect();

        // [3] Stemming (lowercase internal; stemmer & cache dibuat sekali per batch)
        let stemmed = stemmer::stem_batch(tokenized, self.stemming_method, self.dictionary.as_ref());

        // [4] N-Gram (setelah stemming agar bigram terbentuk dari kata dasar)
        stemmed
            .into_iter()
            .map(|tokens| ngram::generate(tokens, self.ngram_min, self.ngram_max))
            .collect()
    }
}
