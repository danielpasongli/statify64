use crate::config::StopwordsMethod;
use crate::error::TextError;
use hashbrown::HashSet;

/// Bangun HashSet stopwords SEKALI (parse JSON hanya satu kali per pemanggilan pipeline).
///
/// Daftar stopwords dikirim dari frontend sebagai JSON string (array of strings).
/// Disimpan dalam lowercase agar pengecekan case-insensitive tanpa mengubah token asli.
///
/// - method `None`                          → `Ok(None)` (tanpa filter; JSON diabaikan)
/// - method lain, daftar null/kosong         → `Ok(None)` (lanjut tanpa filter, perilaku v1)
/// - method lain, JSON tidak valid           → `Err(INVALID_STOPWORDS)` (F11: tidak lagi ditelan diam-diam)
pub fn build_set(
    stopwords_method: StopwordsMethod,
    custom_stopwords_json: &Option<String>,
) -> Result<Option<HashSet<String>>, TextError> {
    if stopwords_method == StopwordsMethod::None {
        return Ok(None);
    }

    match custom_stopwords_json {
        Some(json_str) if !json_str.is_empty() => {
            let list: Vec<String> = serde_json::from_str(json_str).map_err(|e| {
                TextError::new(
                    "INVALID_STOPWORDS",
                    &format!("Failed to parse the custom stopwords JSON: {}. Make sure it is a JSON array of strings.", e),
                )
            })?;
            // Simpan dalam lowercase agar pengecekan case-insensitive
            Ok(Some(list.into_iter().map(|s| s.to_lowercase()).collect()))
        }
        // custom_stopwords null/kosong tapi method bukan "none" → lanjut tanpa filter
        _ => Ok(None),
    }
}

/// Buang token yang ada di dalam set stopwords (case-insensitive).
pub fn filter_with_set(tokens: Vec<String>, stopwords_set: &HashSet<String>) -> Vec<String> {
    tokens
        .into_iter()
        .filter(|t| !stopwords_set.contains(&t.to_lowercase()))
        .collect()
}

/// Stopwords filter satu-dokumen (praktis untuk pemanggilan ad-hoc): `build_set` + `filter_with_set`.
/// Untuk banyak dokumen gunakan `Pipeline` agar JSON hanya di-parse sekali.
pub fn filter(
    tokens: Vec<String>,
    stopwords_method: StopwordsMethod,
    custom_stopwords_json: &Option<String>,
) -> Result<Vec<String>, TextError> {
    Ok(match build_set(stopwords_method, custom_stopwords_json)? {
        Some(set) => filter_with_set(tokens, &set),
        None => tokens,
    })
}
