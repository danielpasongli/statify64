use crate::config::{FormulaStandard, IdfMethod, Normalization, TextVectorizerConfig, TfMethod};
use crate::error::TextError;

/// Batas atas N-Gram yang diizinkan (mencegah ledakan jumlah n-gram/memori).
pub const NGRAM_MAX_LIMIT: usize = 5;

/// Cek rentang N-Gram (dipakai bersama oleh `validate` dan `validate_config`).
fn check_ngram(ngram_min: usize, ngram_max: usize) -> Result<(), TextError> {
    if ngram_min == 0 {
        return Err(TextError::new(
            "INVALID_CONFIG",
            "The minimum n-gram size cannot be 0. The smallest valid value is 1.",
        ));
    }
    if ngram_min > ngram_max {
        return Err(TextError::new(
            "INVALID_CONFIG",
            &format!(
                "Invalid n-gram range: the minimum size ({}) is greater than the maximum size ({}).",
                ngram_min, ngram_max
            ),
        ));
    }
    if ngram_max > NGRAM_MAX_LIMIT {
        return Err(TextError::new(
            "INVALID_CONFIG",
            &format!(
                "The maximum n-gram size ({}) exceeds the limit of {}.",
                ngram_max, NGRAM_MAX_LIMIT
            ),
        ));
    }
    Ok(())
}

/// Validasi kombinasi TF/IDF/normalisasi terhadap standar rumus (PLAN_FIX.md §3.1).
/// Kombinasi di luar tabel → `INVALID_CONFIG`. Standar `custom` menerima semua kombinasi.
pub fn validate_formula(config: &TextVectorizerConfig) -> Result<(), TextError> {
    let (tf_ok, idf_ok, norm_ok) = match config.formula_standard {
        FormulaStandard::Custom => return Ok(()),
        FormulaStandard::Weka => (
            matches!(config.tf_method, TfMethod::Binary | TfMethod::Raw | TfMethod::Log1p),
            matches!(config.idf_method, IdfMethod::None | IdfMethod::Standard),
            matches!(config.normalization, Normalization::None | Normalization::DocLength),
        ),
        FormulaStandard::Sklearn => (
            matches!(config.tf_method, TfMethod::Binary | TfMethod::Raw | TfMethod::Sublinear),
            matches!(config.idf_method, IdfMethod::None | IdfMethod::Smooth | IdfMethod::Plus1),
            matches!(config.normalization, Normalization::None | Normalization::L2 | Normalization::L1),
        ),
    };
    let std_name = config.formula_standard.as_str();
    if !tf_ok {
        return Err(TextError::new(
            "INVALID_CONFIG",
            &format!("TF method \"{}\" is not valid for the {} standard.", config.tf_method.as_str(), std_name),
        ));
    }
    if !idf_ok {
        return Err(TextError::new(
            "INVALID_CONFIG",
            &format!("IDF method \"{}\" is not valid for the {} standard.", config.idf_method.as_str(), std_name),
        ));
    }
    if !norm_ok {
        return Err(TextError::new(
            "INVALID_CONFIG",
            &format!("Normalization \"{}\" is not valid for the {} standard.", config.normalization.as_str(), std_name),
        ));
    }
    Ok(())
}

/// Validasi rentang konfigurasi (tanpa melihat dokumen): ngram_min >= 1, ngram_min <= ngram_max <= 5,
/// min_term_freq >= 1, dan kombinasi TF/IDF/normalisasi sah untuk standarnya.
/// Dipanggil oleh `prepare` agar semua konsumen crate ini tervalidasi.
pub fn validate_config(config: &TextVectorizerConfig) -> Result<(), TextError> {
    check_ngram(config.ngram_min, config.ngram_max)?;
    if config.min_term_freq == 0 {
        return Err(TextError::new(
            "INVALID_CONFIG",
            "The minimum term frequency cannot be 0. The smallest valid value is 1.",
        ));
    }
    validate_formula(config)?;
    Ok(())
}

/// Validasi input sebelum memasuki pipeline NLP.
/// Menangkap error sedini mungkin agar tidak ada crash di tengah proses.
///
/// Parameter:
/// - `docs`      : slice dokumen teks mentah
/// - `ngram_min` : batas bawah N-Gram (harus >= 1)
/// - `ngram_max` : batas atas N-Gram (harus >= ngram_min, <= 5)
///
/// Dokumen kosong di tengah diperbolehkan (menjadi baris nol); hanya array kosong
/// atau SEMUA dokumen kosong yang ditolak (`EMPTY_INPUT`).
pub fn validate(docs: &[String], ngram_min: usize, ngram_max: usize) -> Result<(), TextError> {
    if docs.is_empty() {
        return Err(TextError::new(
            "EMPTY_INPUT",
            "The document list is empty. Make sure the selected variable contains data.",
        ));
    }
    if docs.iter().all(|d| d.trim().is_empty()) {
        return Err(TextError::new("EMPTY_INPUT", "All documents are empty. Make sure the selected variable contains text."));
    }
    check_ngram(ngram_min, ngram_max)
}
