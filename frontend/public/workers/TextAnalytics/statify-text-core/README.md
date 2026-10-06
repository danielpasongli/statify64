# statify-text-core (CORE)

Crate library Rust murni (`crate-type = ["rlib"]`, tanpa `wasm-bindgen`) yang berisi inti pemrosesan teks Statify: tokenizer, stopwords, stemmer, n-gram, dan vectorizer (TF / IDF / normalisasi). Crate ini dipakai oleh:

- **StringToWordVector (STWV)** lewat pembungkus WASM tipis `frontend/components/Modals/Transform/StringToWordVector/rust` (Tahap 1).
- **Naive Bayes v2** dan **Apply Model v2** (Tahap 2; belum dikerjakan), yang akan memakai `fit` / `transform` dan `TextVectorizerModel` ("resep").

Kontrak teknis yang mengikat ada di `PLAN_FIX.md` §3 (folder STWV). Dokumen pengguna ada di `README.md` STWV bagian "Status Terkini".

## Struktur

| Berkas | Isi |
|---|---|
| `src/config.rs` | `TextVectorizerConfig` dan enum `StopwordsMethod`, `StemmingMethod`, `TfMethod`, `IdfMethod`, `FormulaStandard`, `Normalization` (JSON snake_case + alias nilai lama) |
| `src/error.rs` | `TextError { code, message }` |
| `src/validator.rs` | validasi dokumen, rentang config, dan kombinasi rumus per preset |
| `src/tokenizer.rs`, `stopwords.rs`, `stemmer.rs`, `ngram.rs` | tahap pipeline NLP |
| `src/pipeline.rs` | `Pipeline` dan `prepare` (regex, set stopword, stemmer dibuat sekali) |
| `src/vectorizer.rs` | pemilihan kosakata, TF/IDF/normalisasi, penyusunan CSR |
| `src/model.rs` | `TextVectorizerModel`, `CsrMatrix`, `fit`, `transform`, `fit_transform` |
| `src/lib.rs` | ekspor publik, `run_pipeline`, `output_from_model` (keluaran dense untuk UI) |
| `tests/` | `characterization.rs` (15), `s2_pipeline.rs` (16), `s3_formulas.rs` (25), `s4_fit_transform.rs` (22) |

## API publik (PLAN_FIX §3.4)

```rust
pub fn prepare(cfg: &TextVectorizerConfig) -> Result<Pipeline, TextError>;
impl Pipeline { pub fn tokens_batch(&self, docs: &[String]) -> Vec<Vec<String>>; }

pub fn fit(docs: &[String], cfg: &TextVectorizerConfig) -> Result<TextVectorizerModel, TextError>;
pub fn transform(model: &TextVectorizerModel, docs: &[String]) -> Result<CsrMatrix, TextError>;
pub fn fit_transform(docs: &[String], cfg: &TextVectorizerConfig)
    -> Result<(TextVectorizerModel, CsrMatrix), TextError>;

pub struct TextVectorizerModel {   // Serialize + Deserialize
    pub recipe_version: String,    // "1.0"
    pub config: TextVectorizerConfig,
    pub resolved_stopwords: Vec<String>, // lowercase, unik, urut alfabetis
    pub vocabulary: Vec<String>,         // urutan kolom (alfabetis byte-wise)
    pub idf: Vec<f64>,                   // sejajar vocabulary (1.0 bila idf none)
    pub doc_freq: Vec<u32>,
    pub n_docs: u32,
    pub avg_doc_norm: Option<f64>,       // hanya untuk doc_length
}
pub struct CsrMatrix { pub n_rows: usize, pub n_cols: usize,
                       pub indptr: Vec<usize>, pub indices: Vec<u32>, pub data: Vec<f64> }
impl CsrMatrix { pub fn to_dense(&self) -> Vec<Vec<f64>>; }
```

Tambahan publik di luar §3.4 (aditif, tidak mengubah kontrak): `output_from_model`, `RECIPE_VERSION`, `vectorize`, `run_pipeline`, `preprocess_documents`.

### Perilaku yang perlu diketahui konsumen

- `transform` hanya membaca model: kosakata, `idf`, `avg_doc_norm`, dan `resolved_stopwords`. Tidak ada df/IDF/avg_norm yang dihitung dari data yang ditransformasi; term di luar kosakata (OOV) diabaikan.
- Dokumen kosong, whitespace, atau seluruhnya OOV menjadi baris nol (tanpa NaN/Inf). `fit` menolak array kosong dan "semua dokumen kosong" (`EMPTY_INPUT`); `transform` menolak array kosong tetapi menerima dokumen yang semuanya kosong.
- `transform` memvalidasi model (`recipe_version`, panjang `vocabulary`/`idf`/`doc_freq`, `avg_doc_norm` ada untuk `doc_length`) → `INVALID_DATA` atau `EMPTY_VOCABULARY`.
- CSR menyimpan entri nol eksplisit untuk term yang ada di dokumen tetapi bernilai 0.0 (mis. IDF standard = 0); abaikan nilai 0 bila perlu. `to_dense()` tidak panic pada CSR rusak.
- `Dictionary` Sastrawi dibangun pada setiap pemanggilan `fit`/`transform`; panggil per batch besar, bukan per dokumen.
- Kode error: `EMPTY_INPUT`, `INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, `EMPTY_VOCABULARY`, `INVALID_DATA`, `SERIALIZE_ERROR` (pesan Bahasa Indonesia).

## Menjalankan test

```bash
cd frontend/public/workers/TextAnalytics/statify-text-core
cargo test        # harapan: 15 + 16 + 25 + 22 = 78 lulus
```

## Catatan untuk Tahap 2

1. **Presisi f64 pada JSON model.** `serde_json` tanpa fitur `float_roundtrip` dapat menggeser f64 sebesar 1 ulp pada siklus `to_string` → `from_str` (contoh: `avg_doc_norm` `…6971` → `…6973`). Jalur objek WASM (`serde_wasm_bindgen`) tidak terpengaruh. Kerjakan SEBELUM atau BERSAMAAN dengan langkah Tahap 2 pertama yang menyimpan/memuat model sebagai string JSON, sesuai `plan-reports/CATATAN_TAHAP2_float_roundtrip.md`: ubah `serde_json` di `Cargo.toml` menjadi `{ version = "1.0", features = ["float_roundtrip"] }`, kembalikan test `model_json_roundtrip_menghasilkan_transform_identik` ke perbandingan eksak, lalu jalankan `cargo test` dan `cargo check`. **Belum diterapkan** pada Tahap 1.
2. **Cargo.lock.** CORE memiliki `Cargo.lock` sendiri yang memakai `sastrawi-rs 0.5.3`, sedangkan `Cargo.lock` STWV terkunci pada `0.5.1`. Samakan versi bila hasil stemming berbeda antara test native dan WASM.
3. Format sparse (CSR) dan resep ditujukan bagi NB v2 / AM v2; STWV tidak menampilkan atau menyimpan resep (keputusan D3).
