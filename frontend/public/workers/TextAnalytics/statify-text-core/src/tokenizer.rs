use crate::error::TextError;
use regex::Regex;

/// Tokenizer: memecah satu dokumen menjadi array token.
///
/// Lowercase diterapkan DI SINI jika config.lowercase == true.
/// Regex delimiter di-compile di luar (oleh pemanggil) untuk efisiensi.
pub fn tokenize(doc: &str, lowercase: bool, re: &Regex) -> Vec<String> {
    let text = if lowercase {
        doc.to_lowercase()
    } else {
        doc.to_string()
    };

    re.split(&text)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Compile regex dari string delimiter yang dikirim config.
/// Dipanggil SEKALI sebelum loop dokumen agar tidak mengulang kompilasi.
pub fn compile_regex(delimiter_pattern: &str) -> Result<Regex, TextError> {
    // Gunakan fallback jika delimiter kosong
    let pattern = if delimiter_pattern.trim().is_empty() {
        r"[\s\p{P}]+"
    } else {
        delimiter_pattern
    };

    Regex::new(pattern).map_err(|e| {
        TextError::new(
            "INVALID_REGEX",
            &format!("The delimiter regex pattern is invalid: {}", e),
        )
    })
}
