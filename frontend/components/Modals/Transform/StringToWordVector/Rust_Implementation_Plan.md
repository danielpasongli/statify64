# Rencana Implementasi: Fase 3 (Mesin Rust & WASM)

> **⚠️ Dokumen historis (Fase 3 asli).** Setelah Tahap 1 (`PLAN_FIX.md` S1–S9), sebagian isi di bawah **tidak berlaku lagi**: logika Rust dipindah ke crate `frontend/rust-crates/statify-text-core` (CORE), rumus vektorisasi diganti (preset Weka/scikit-learn/Custom), dan format `stats` serta penanganan error berubah. Rujukan yang berlaku: `README.md` bagian "Status Terkini", `PLAN_FIX.md` §3 (kontrak teknis), dan `frontend/rust-crates/statify-text-core/README.md`. Isi lama dipertahankan apa adanya sebagai sejarah; setiap bagian yang usang ditandai "⚠️ Tidak berlaku lagi" atau "⚠️ Diperbarui".

Dokumen ini adalah panduan teknis step-by-step pengembangan mesin NLP menggunakan Rust yang dikompilasi ke WebAssembly (WASM). Versi ini telah diperbarui dengan perbaikan pipeline, formula standar, error handling, output format, dan rencana integrasi WASM.

---

## ⚙️ Dependensi `Cargo.toml` (Final)

> **⚠️ Diperbarui (Tahap 1):** dependensi pengolah teks kini dideklarasikan di `statify-text-core/Cargo.toml` (tanpa `wasm-bindgen`, `web-sys`, `serde-wasm-bindgen`, `console_error_panic_hook`). `STWV/rust/Cargo.toml` hanya menambah dependensi path ke CORE untuk pembungkus WASM.

```toml
[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde-wasm-bindgen = "0.4"
serde_json = "1.0"
rust-stemmers = "1.2.0"
sastrawi-rs = "0.5.1"
hashbrown = "0.14"
regex = "1.10"
console_error_panic_hook = { version = "0.1", optional = true }

[features]
default = ["console_error_panic_hook"]

[dependencies.web-sys]
version = "0.3"
features = ["console"]
```

> **Catatan `sastrawi-rs`:** Dikonfirmasi tersedia di crates.io v0.5.1 (`cargo search sastrawi`). Library ini menggunakan arsitektur zero-regex + FST (Finite State Transducer), sehingga sangat ringan di lingkungan WASM. Cara penggunaan: `use sastrawi::{Dictionary, Stemmer};`.

> **Catatan `console_error_panic_hook`:** Wajib didaftarkan agar Rust `panic!()` terlihat di browser DevTools. Tanpa ini, error WASM hanya muncul sebagai "RuntimeError: unreachable" yang tidak informatif.

---

## 📌 Analisis Arsitektur & Edge Cases

### 1. Dampak Fitur "Lowercase" sebagai Opsional
- **Tokenizer & Vocabulary**: Jika Lowercase dinonaktifkan, `"Apple"` dan `"apple"` dihitung sebagai dua term yang berbeda dalam matriks. Berguna untuk Named Entity Recognition (NER).
- **Stopwords Filter**: Tetap menggunakan *case-insensitive checking* tanpa mengubah data asli: `stopwords_set.contains(&token.to_lowercase())`. Token asli tetap dipertahankan jika tidak cocok.
- **Stemmer**: Algoritma Sastrawi (Nazief-Adriani) dan Porter **sensitif huruf kapital**. Oleh karena itu, setiap token akan dipaksa lowercase **secara internal** sebelum memasuki fase Stemmer, terlepas dari setting Lowercase pengguna. UI harus menampilkan peringatan ini.

### 2. Pendelegasian Stopwords ke Frontend
Daftar stopwords **tidak di-hardcode di Rust**. Alurnya:
1. Frontend menyimpan kamus (`stopwords.ts` atau `.json`).
2. Saat user memilih metode stopwords, frontend memuat array ke Textarea UI.
3. Saat tombol Run ditekan, frontend mengirim array sebagai string JSON dalam payload `custom_stopwords`.
4. Rust menerima string tersebut, men-deserialize, lalu membangun `hashbrown::HashSet` secara instan.

Keuntungan: Bundle size WASM tetap kecil, dan user bisa mengedit stopwords secara bebas.

---

## ✅ Pipeline NLP yang Benar (Urutan Standar)

Pipeline yang benar mengikuti urutan standar NLP industri:

```
Input: Vec<String> (array dokumen mentah)
  │
  ▼
[1] Validate Input       → Tangani null, string kosong, non-UTF8
  │
  ▼
[2] Lowercase            → Jika config.lowercase == true
  │
  ▼
[3] Tokenizer            → Pecah teks berdasarkan delimiter/regex
  │
  ▼
[4] Stopwords Filter     → Buang kata dari HashSet (case-insensitive)
  │
  ▼
[5] Stemmer              → Pangkas ke kata dasar (paksa lowercase internal)
  │
  ▼
[6] N-Gram Generator     → Buat unigram/bigram/trigram SETELAH stemming
  │
  ▼
[7] Vectorizer           → Bangun Vocabulary → Hitung TF/IDF/Binary
  │
  ▼
Output: JSON { vocabulary, matrix, stats }
```

> **Kritis**: N-Gram **wajib dilakukan setelah Stemming** (bukan di dalam Tokenizer). Jika N-Gram dilakukan sebelum stemming, bigram seperti `["memakan", "makanan"]` tidak akan terdeteksi sebagai `["makan", "makan"]` setelah di-stem.

---

## 🛠 Langkah 1: Validasi Input (`src/validator.rs`)

> **⚠️ Diperbarui (Tahap 1):** `validator.rs` sekarang di CORE. Perubahan perilaku: dokumen kosong di tengah array **diperbolehkan** (menjadi baris nol); `EMPTY_INPUT` hanya untuk array kosong atau semua dokumen kosong. `ngram_max` dibatasi ≤ 5, `min_term_freq` ≥ 1, dan kombinasi TF/IDF/Normalisasi divalidasi per preset (`INVALID_CONFIG`). Nilai enum tidak dikenal ditolak, tidak lagi jatuh ke default.

**Tujuan:** Sanitasi data sebelum masuk pipeline agar tidak ada crash di tengah proses.

**Logika:**
```rust
pub fn validate_documents(docs: &[String]) -> Result<(), AppError> {
    if docs.is_empty() {
        return Err(AppError::EmptyInput("Array dokumen kosong".into()));
    }
    if docs.iter().all(|d| d.trim().is_empty()) {
        return Err(AppError::EmptyInput("Semua dokumen berisi string kosong".into()));
    }
    Ok(())
}
```

**Error yang ditangani:**
| Kondisi | Respons |
|---|---|
| `docs` kosong (`[]`) | Return error: "Array dokumen kosong" |
| Semua dokumen string kosong | Return error: "Semua dokumen kosong" |
| `ngram_min > ngram_max` | Return error: "Konfigurasi N-Gram tidak valid" |
| `delimiters` kosong | Gunakan fallback default: `r"[\s\p{P}]+"` |
| `custom_stopwords` gagal parse JSON | Return error dengan detail posisi parse error |

---

## 🛠 Langkah 2: Tokenizer (`src/tokenizer.rs`)

**Tujuan:** Memecah satu dokumen menjadi array token tunggal.

**Logika:**
1. Terima `&str` satu baris teks.
2. Terapkan Lowercase jika `config.lowercase == true`.
3. Gunakan `regex::Regex` untuk split berdasarkan `config.delimiters`.
4. Buang token kosong (`""`) hasil split.
5. Return `Vec<String>`.

**Catatan implementasi:**
- Compile `Regex` hanya sekali di luar loop dokumen (gunakan `lazy_static!` atau `once_cell::sync::Lazy`) untuk performa optimal. Mengkompilasi regex di dalam loop adalah bottleneck besar.
- Jika `config.delimiters` bukan regex valid → tangkap error dan return `AppError::InvalidRegex`.

**Input:** `&str`, **Output:** `Vec<String>`

---

## 🛠 Langkah 3: Stopwords Filter (`src/stopwords.rs`)

> **⚠️ Diperbarui (Tahap 1):** daftar stopword di-parse **sekali** (`build_set`) dan JSON yang rusak menghasilkan `INVALID_STOPWORDS` (tidak ada lagi fallback diam-diam yang mengosongkan token). Bagian "Log peringatan, lanjutkan tanpa filter" untuk `custom_stopwords = None` tetap berlaku.

**Tujuan:** Buang kata-kata yang tidak informatif berdasarkan HashSet dinamis dari frontend.

**Logika:**
1. Parse `config.custom_stopwords` (tipe `Option<String>`) dari payload JSON.
2. Jika `Some(json_str)` → deserialize ke `Vec<String>` → masukkan ke `hashbrown::HashSet<String>`.
3. Jika `None` atau `stopwords_method == "none"` → lewati filter ini sepenuhnya.
4. Filter: `tokens.retain(|t| !set.contains(&t.to_lowercase()))`.

**Error yang ditangani:**
| Kondisi | Respons |
|---|---|
| JSON stopwords tidak valid | Return `AppError::InvalidStopwords` dengan pesan detail |
| `custom_stopwords` = `None` dan method bukan "none" | Log peringatan, lanjutkan tanpa filter |

---

## 🛠 Langkah 4: Stemmer (`src/stemmer.rs`)

> **⚠️ Diperbarui (Tahap 1):** `Pipeline` membuat stemmer dan `Dictionary` Sastrawi **sekali per batch** (dengan cache memo), bukan per dokumen. Metode tidak dikenal (`_ => tokens`) tidak lagi diterima: nilai enum tidak dikenal menghasilkan `INVALID_CONFIG`. Stemmer tetap memaksa lowercase (catatan tampil di UI).

**Tujuan:** Memangkas kata ke bentuk dasarnya.

**Logika:**
```rust
pub fn stem_tokens(tokens: Vec<String>, method: &str) -> Vec<String> {
    match method {
        "indonesian" => { /* gunakan sastrawi::Stemmer */ }
        "english"    => { /* gunakan rust_stemmers::Stemmer::create(Algorithm::English) */ }
        "none"       => tokens, // langsung return tanpa modifikasi
        _            => tokens, // method tidak dikenal → lewati + log warning
    }
}
```

**Catatan implementasi:**
- `sastrawi::Dictionary::new()` bersifat mahal (memuat FST). Inisialisasi **sekali di luar loop** dokumen, lalu pinjam referensinya.
- Setiap token dipaksa `.to_lowercase()` **sebelum** dikirim ke stemmer (karena keterbatasan algoritma), tapi ini **hanya terjadi internal di fungsi ini**, tidak mengubah array asli.
- Hasil stemming yang mengembalikan string kosong harus difilter: `result.retain(|t| !t.is_empty())`.

---

## 🛠 Langkah 5: N-Gram Generator (`src/ngram.rs`)

**Tujuan:** Menghasilkan kombinasi N kata berurutan dari array token yang sudah bersih.

**Logika:**
```rust
pub fn generate_ngrams(tokens: &[String], min: usize, max: usize) -> Vec<String> {
    let mut result = Vec::new();
    for n in min..=max {
        for window in tokens.windows(n) {
            result.push(window.join(" "));
        }
    }
    result
}
```

**Error yang ditangani:**
| Kondisi | Respons |
|---|---|
| `ngram_min == 0` | Return error: N-Gram minimum tidak boleh 0 |
| `ngram_min > ngram_max` | Return error: konfigurasi N-Gram tidak valid |
| `tokens` terlalu pendek untuk `ngram_min` | Return `[]` (array kosong, bukan error) |
| `ngram_min == 1 && ngram_max == 1` | Setara unigram, jalankan normal |

---

## 🛠 Langkah 6: Vectorizer (`src/vectorizer.rs`)

> **⚠️ Tidak berlaku lagi (rumus lama):** tabel "Formula yang Digunakan" di bawah (TF = `count/total`, IDF smooth sebagai satu-satunya IDF, tanpa normalisasi baris, klaim "kompatibel sklearn") sudah **digantikan** oleh rumus terkunci di `PLAN_FIX.md` §3.2 dan tabel rumus pada `README.md` bagian "Status Terkini". Default baru adalah Weka raw / IDF none / Norm none; padanan sklearn tersedia lewat preset scikit-learn (raw/smooth/l2 = `TfidfVectorizer()` default). Pemilihan kosakata (min term freq, rangking Words to Keep, truncate ketat) dan perhitungan df satu pass juga berubah; lihat README.

**Tujuan:** Mengubah koleksi token per dokumen menjadi matriks angka.

### Formula yang Digunakan (Standar scikit-learn, kompatibel Python)

Agar hasil dapat dibandingkan langsung dengan Python `sklearn.TfidfVectorizer`:

| Metode | Formula |
|---|---|
| **Binary** | `1.0` jika term ada, `0.0` jika tidak |
| **TF** (Term Frequency) | `count(t, d) / total_terms(d)` — frekuensi relatif |
| **IDF** (Inverse Doc Freq) | `log((1 + N) / (1 + df(t))) + 1` — standar sklearn smooth |
| **TF-IDF** | `TF(t,d) × IDF(t)` — gabungan keduanya |

> **Mengapa formula ini?** Formula IDF `log((1+N)/(1+df)) + 1` adalah default `TfidfVectorizer` scikit-learn dengan `smooth_idf=True`. Ini mencegah division-by-zero jika `df=0` dan mencegah zero-weight jika term muncul di semua dokumen.

**Langkah Implementasi:**
1. Kumpulkan semua token dari seluruh dokumen → bangun **Vocabulary** (sorted A-Z untuk hasil deterministik).
2. Untuk setiap dokumen, hitung skor sesuai `config.vectorization_method`.
3. Hasilkan `Vec<Vec<f64>>` (baris = dokumen, kolom = term di vocabulary).

**Error yang ditangani:**
| Kondisi | Respons |
|---|---|
| Vocabulary kosong (semua token dibuang stopwords/stemmer) | Return error: "Vocabulary kosong setelah preprocessing" |
| `df` = 0 untuk suatu term (tidak mungkin tapi defensif) | IDF = `log((1+N)/1) + 1`, tidak crash |
| `total_terms(d)` = 0 untuk suatu dokumen | TF = 0.0 untuk semua term di dokumen itu |

---

## 🛠 Langkah 7: Output & Struct Hasil (`lib.rs`)

> **⚠️ Diperbarui (Tahap 1):** `OutputStats` kini berisi `total_documents`, `empty_documents`, `vocabulary_size`, `formula_standard`, dan `method` (mis. `"TF: raw, IDF: none, Norm: none, Keep: 1000, MinFreq: 1"`) sesuai `PLAN_FIX.md` §3.5; contoh JSON dan field `method` di bawah adalah format lama. `AppError` kini bernama `TextError` dan dikirim ke JS sebagai **objek** `{code, message}` (bukan string JSON).

**Format output JSON final yang lengkap:**

```json
{
  "vocabulary": ["apple", "banana", "cherry"],
  "matrix": [
    [0.577, 0.0,   0.577],
    [0.0,   0.707, 0.0  ]
  ],
  "stats": {
    "total_documents": 2,
    "vocabulary_size": 3,
    "method": "tf-idf"
  }
}
```

**Struct Rust:**
```rust
#[derive(Serialize)]
pub struct VectorizerOutput {
    pub vocabulary: Vec<String>,
    pub matrix: Vec<Vec<f64>>,
    pub stats: OutputStats,
}

#[derive(Serialize)]
pub struct OutputStats {
    pub total_documents: usize,
    pub vocabulary_size: usize,
    pub method: String,
}
```

**Struct Error Terpusat:**
```rust
#[derive(Serialize)]
pub struct AppError {
    pub code: String,    // "EMPTY_INPUT", "INVALID_CONFIG", dll
    pub message: String, // Pesan ramah pengguna
}
```

Semua error dari `process_text_data` di-return sebagai `Err(JsValue)` berisi JSON `AppError`, sehingga Web Worker dapat menampilkan pesan error yang jelas ke UI.

---

## 🛠 Langkah 8: Penyambungan Pipeline (`lib.rs`)

> **⚠️ Tidak berlaku lagi (alur lama):** `process_text_data` di `STWV/rust/src/lib.rs` kini pembungkus tipis yang memanggil `fit_transform` dari CORE lalu `to_dense()`. Alur per dokumen (`tokenizer → stopwords → stemmer → ngram`) berada di `Pipeline::tokens_batch` pada CORE. Urutan pipeline NLP di bagian "Pipeline NLP yang Benar" tetap berlaku.

```rust
#[wasm_bindgen]
pub fn process_text_data(js_data: JsValue, js_config: JsValue) -> Result<JsValue, JsValue> {
    init_panic_hook();
    
    let config: VectorizerConfig = parse_config(js_config)?;
    let raw_docs: Vec<String>    = parse_data(js_data)?;
    
    validate_documents(&raw_docs, &config)?;
    
    let processed: Vec<Vec<String>> = raw_docs.iter().map(|doc| {
        let tokens = tokenizer::tokenize(doc, &config);
        let tokens = stopwords::filter(tokens, &config);
        let tokens = stemmer::stem(tokens, &config);
        let tokens = ngram::generate(tokens, &config);
        tokens
    }).collect();
    
    let output = vectorizer::vectorize(processed, &config)?;
    
    serde_wasm_bindgen::to_value(&output)
        .map_err(|e| make_error("SERIALIZE_ERROR", &e.to_string()))
}
```

---

## 📦 Langkah 9: Build & Integrasi WASM

### 9.1 Persiapan Tools
```bash
# Install wasm-pack (satu kali)
cargo install wasm-pack

# Verifikasi
wasm-pack --version
```

### 9.2 Command Build
```bash
# Jalankan dari direktori: .../StringToWordVector/rust/
wasm-pack build --target web --out-dir ../wasm-output --release
```

- `--target web`: Menghasilkan ES Module yang bisa di-import langsung oleh Web Worker.
- `--out-dir ../wasm-output`: Output ditempatkan di folder `wasm-output/` sejajar dengan `rust/`.
- `--release`: Mengaktifkan optimasi Rust (wajib untuk produksi, jauh lebih kecil & cepat).

### 9.3 Output Build
Folder `wasm-output/` akan berisi:
```
wasm-output/
├── statify_string_to_word.js       ← Glue code (ES Module)
├── statify_string_to_word_bg.wasm  ← Binary WASM
├── statify_string_to_word.d.ts     ← TypeScript definitions
└── package.json
```

### 9.4 Integrasi di Web Worker
```typescript
// stringToWord.worker.ts
import init, { process_text_data } from '../wasm-output/statify_string_to_word.js';

let wasmReady = false;

self.onmessage = async (event) => {
    if (!wasmReady) {
        await init(); // Inisialisasi WASM (hanya sekali)
        wasmReady = true;
    }

    const { data, config } = event.data;

    try {
        const result = process_text_data(data, config);
        self.postMessage({ status: 'success', payload: result });
    } catch (error) {
        // error adalah AppError JSON dari Rust
        self.postMessage({ status: 'error', payload: error });
    }
};
```

### 9.5 Catatan Vite / Next.js
Jika proyek menggunakan Vite, tambahkan di `vite.config.ts`:
```typescript
optimizeDeps: { exclude: ['../wasm-output/statify_string_to_word.js'] }
```
Ini mencegah Vite mencoba mem-bundle file WASM glue code yang sudah self-contained.

---

## ⚠️ Analisis Risiko & Potensi Masalah Lain

### R1: Performa untuk Dataset Besar
**Masalah:** Memori WASM terbatas (default 16MB initial, dapat tumbuh). Dataset dengan ribuan dokumen panjang bisa menekan memori.
**Solusi:** Pertimbangkan streaming/chunking di level Worker — kirim dokumen per-batch, bukan sekaligus.

### R2: Regex Compilation di Loop
**Masalah:** Mengkompilasi `Regex` baru di setiap iterasi dokumen = bottleneck besar.
**Solusi:** Wajib gunakan `once_cell::sync::Lazy<Regex>` atau kompilasi sekali sebelum loop.

### R3: `sastrawi::Dictionary` Loading

> **✅ Terselesaikan (S2):** `Dictionary`/`Stemmer` dibuat sekali per batch di `Pipeline`.
**Masalah:** `Dictionary::new()` memuat file FST ke memori. Jika dipanggil per-dokumen, ini lambat.
**Solusi:** Inisialisasi Dictionary di luar loop: `let dict = Dictionary::new(); let stemmer = Stemmer::new(&dict);`

### R4: Normalisasi TF-IDF (L2 Norm)

> **⚠️ Diperbarui (S3):** normalisasi diimplementasikan sebagai opsi `normalization` (`none` | `l1` | `l2` | `doc_length`), bukan field `normalize: bool`. Default `none` (preset Weka); preset scikit-learn memakai `l2`.
**Masalah:** scikit-learn secara default menerapkan **L2 normalization** pada setiap baris matriks TF-IDF. Tanpa ini, hasil angka akan berbeda meski formula IDF sama.
**Solusi:** Implementasikan langkah normalisasi opsional. Formula: `v_normalized[i] = v[i] / sqrt(sum(v[j]^2))`. Tambahkan field `normalize: bool` di `VectorizerConfig`.

### R5: Kompatibilitas WASM dengan Bundler
**Masalah:** File `.wasm` perlu di-serve dengan MIME type `application/wasm`. Server dev standar kadang salah mengkonfigurasi ini.
**Solusi:** Pastikan dev server (Vite/Next.js) sudah dikonfigurasi dengan benar, atau gunakan `wasm-pack build --target bundler` jika menggunakan Webpack/Vite bundler.

### R6: Thread Safety di Web Worker
**Masalah:** WASM di browser bersifat single-threaded secara default (Atomics/SharedArrayBuffer memerlukan header khusus).
**Solusi:** Desain saat ini sudah benar — semua komputasi berat di Web Worker tunggal, tidak perlu multi-threading.
