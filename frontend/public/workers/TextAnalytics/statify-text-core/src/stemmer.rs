use crate::config::StemmingMethod;
use rust_stemmers::{Algorithm, Stemmer as EnStemmer};
use std::collections::HashMap;

/// Stemmer: memangkas token ke bentuk dasarnya.
///
/// Catatan penting:
/// - Sastrawi (Nazief-Adriani) dan Porter SENSITIF huruf kapital.
///   Oleh karena itu, setiap token dipaksa `.to_lowercase()` secara internal
///   sebelum dikirim ke stemmer, TERLEPAS dari setting `lowercase` pengguna.
/// - Dictionary sastrawi HARUS diinisialisasi di luar fungsi ini (mahal).
///   `Pipeline` menyimpan `Dictionary` dan meneruskan referensinya ke `stem_batch`;
///   `Stemmer` dibuat SEKALI per batch (bukan per dokumen).
/// - Hasil stem di-memo (cache `HashMap`) per batch: kata yang sama tidak di-stem ulang.
/// - Token hasil stemming yang kosong difilter dari output.
pub fn stem_batch(
    docs: Vec<Vec<String>>,
    stemming_method: StemmingMethod,
    dictionary: Option<&sastrawi::Dictionary>,
) -> Vec<Vec<String>> {
    match stemming_method {
        StemmingMethod::Indonesian => {
            // Pengaman: bila pemanggil tidak memberi Dictionary, buat sekali di sini (tetap sekali per batch).
            let owned_dict;
            let dict: &sastrawi::Dictionary = match dictionary {
                Some(d) => d,
                None => {
                    owned_dict = sastrawi::Dictionary::new();
                    &owned_dict
                }
            };
            let stemmer = sastrawi::Stemmer::new(dict);
            let mut cache: HashMap<String, String> = HashMap::new();
            docs.into_iter()
                .map(|tokens| {
                    tokens
                        .into_iter()
                        .map(|t| {
                            let lower = t.to_lowercase();
                            if let Some(hit) = cache.get(&lower) {
                                return hit.clone();
                            }
                            let stemmed = stemmer.stem_word(&lower).to_string();
                            cache.insert(lower, stemmed.clone());
                            stemmed
                        })
                        .filter(|t: &String| !t.is_empty())
                        .collect()
                })
                .collect()
        }
        StemmingMethod::English => {
            let stemmer = EnStemmer::create(Algorithm::English);
            let mut cache: HashMap<String, String> = HashMap::new();
            docs.into_iter()
                .map(|tokens| {
                    tokens
                        .into_iter()
                        .map(|t| {
                            let lower = t.to_lowercase();
                            if let Some(hit) = cache.get(&lower) {
                                return hit.clone();
                            }
                            let stemmed = stemmer.stem(&lower).to_string();
                            cache.insert(lower, stemmed.clone());
                            stemmed
                        })
                        .filter(|t| !t.is_empty())
                        .collect()
                })
                .collect()
        }
        // "none" → kembalikan token apa adanya
        StemmingMethod::None => docs,
    }
}

/// Stemming satu dokumen (praktis untuk pemanggilan ad-hoc; metode berupa string v1).
/// "indonesian" | "english"; nilai lain → token apa adanya. Untuk banyak dokumen gunakan `Pipeline`.
pub fn stem(tokens: Vec<String>, stemming_method: &str) -> Vec<String> {
    let method = match stemming_method {
        "indonesian" => StemmingMethod::Indonesian,
        "english" => StemmingMethod::English,
        _ => StemmingMethod::None,
    };
    stem_batch(vec![tokens], method, None).pop().unwrap_or_default()
}
