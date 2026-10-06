/// Generator N-Gram.
/// Dijalankan **setelah** stemming agar bigram terbentuk dari kata dasar yang sudah di-stem.
///
/// Contoh: tokens = ["makan", "minum", "tidur"], ngram_min=1, ngram_max=2
/// Output: ["makan", "minum", "tidur", "makan minum", "minum tidur"]

pub fn generate(tokens: Vec<String>, ngram_min: usize, ngram_max: usize) -> Vec<String> {
    // Unigram saja — kembalikan langsung tanpa alokasi tambahan
    if ngram_min == 1 && ngram_max == 1 {
        return tokens;
    }

    let mut result = Vec::new();
    for n in ngram_min..=ngram_max {
        for window in tokens.windows(n) {
            result.push(window.join(" "));
        }
    }
    result
}
