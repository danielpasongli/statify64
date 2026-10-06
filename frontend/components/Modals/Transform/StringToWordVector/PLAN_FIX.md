# PLAN_FIX.md — Tahap 1: Perbaikan StringToWordVector (STWV)

Dokumen ini adalah rencana kerja **Tahap 1** untuk agent implementasi (Claude Sonnet, effort medium).
Sumber temuan: `AUDIT_REPORT.md` (folder yang sama). Tahap 2 (Naive Bayes v2 + Apply Model v2) ada di
`frontend/components/Modals/Analyze/Classify/naive-bayes/PLAN_V2.md` dan baru dimulai **setelah Tahap 1 selesai**.

Notasi path:
- `STWV/` = `frontend/components/Modals/Transform/StringToWordVector/`
- `CORE/` = `frontend/rust-crates/statify-text-core/` (crate baru, library Rust murni)

---

## 0. Keputusan pemilik proyek yang mengikat (jangan diubah agent)

| ID | Keputusan |
|---|---|
| D1 | Tahap 1 hanya memperbaiki STWV: F01, F04, F08, F09 (sebagian), F11, F12, F13 (sebagian), F14, F15, F16/F17 (via preset), F19, F20, F21, F22, F23. |
| D2 | **Tidak dikerjakan:** F06 (negasi stopword, tidak ada perubahan kode/teks), F02 (resep/fixed dictionary di STWV), F05 (leakage jalur STWV), `wordsToKeep` per-kelas. F02/F05 hanya dicatat sebagai batasan di README. |
| D3 | Output STWV tetap **hanya kolom vektor** baru di dataset (tidak ada metadata/resep yang disimpan oleh STWV). |
| D4 | Sel teks kosong/null → **vektor nol**, baris tetap sejajar dengan dataset (F01). |
| D5 | Preset rumus: **Weka (default)**, **scikit-learn**, **Custom**. Custom tidak wajib diuji terhadap tool lain. |
| D6 | Default baru: standar **Weka**, TF = **Word count**, IDF = **None**, Normalisasi = **None** (mengubah angka default dibanding sebelumnya). Opsi lain default tetap: lowercase ON, stopwords None, stemming None, tokenizer Word, delimiter `[\s.,;:'"()?!]+`, Words to Keep 1000, Min Term Freq 1. |
| D7 | Words to Keep: preset Weka & sklearn merangking berdasarkan **total kemunculan kata (raw count) di seluruh dokumen**, tie → alfabetis. Preset Custom memakai cara lama (Σ TF×IDF). `0` = simpan semua kata. |
| D8 | `minTermFreq` ditambahkan (default 1): kata dengan total raw count < minTermFreq dibuang sebelum Words to Keep. |
| D9 | Inti Rust dipindah ke crate bersama `CORE/` (library murni, tanpa `wasm-bindgen`) agar dipakai STWV, NB v2, dan AM v2. Crate WASM STWV menjadi pembungkus tipis. |
| D10 | Di Tahap 1 output WASM STWV ke UI tetap **matriks dense**. Format sparse (CSR) hanya untuk konsumen Rust (Tahap 2). |
| D11 | Semua agent bekerja di **satu working tree, branch `dija-v2`**. Build WASM **dijalankan manual oleh pemilik**. |

---

## 1. Aturan kerja agent (berlaku untuk SEMUA fase)

1. Kerjakan **hanya** fase yang ditugaskan. Ubah/buat **hanya** file di daftar "File milik fase". Bila butuh mengubah file lain, berhenti dan tulis di laporan.
2. **Dilarang** menjalankan perintah `git` apa pun, formatter seluruh repo, `npm install`/`npm ci`, `cargo add`, `cargo update`, `wasm-pack`, atau menyalin hasil build ke `wasm-output/`.
3. Boleh menjalankan: `cargo test` di crate milik fase (dari folder crate tersebut), `npx jest <path test milik fase>` dari root repo, `npx tsc --noEmit -p frontend` (bila tersedia). Bila gagal karena toolchain/jaringan tidak ada, **jangan** mencari jalan pintas — tulis perintahnya di laporan.
4. Jangan mengubah perilaku di luar lingkup fase. Jangan "merapikan" kode yang tidak terkait.
5. Komentar kode dan pesan error untuk pengguna dalam **Bahasa Indonesia**; label UI dalam **Bahasa Inggris** (konsisten dengan menu lain).
6. Setelah selesai, tulis laporan ke **file baru** `STWV/plan-reports/<ID-FASE>.md` berisi: ringkasan perubahan, daftar file diubah/dibuat/dihapus, test yang dijalankan + hasil (atau "tidak dijalankan: alasan"), sisa pekerjaan/risiko, dan **perintah yang harus dijalankan pemilik**. Jangan mengedit `PLAN_FIX.md` (pemilik yang mencentang checklist).
7. Fase lanjutan wajib membaca laporan fase prasyaratnya di `STWV/plan-reports/`.

### Prompt dasar (tempel ke agent, ganti `<ID>`)

```
Kamu adalah agent implementasi untuk proyek Statify (Next.js + Rust/WASM), branch dija-v2 (jangan ganti branch).
Tugasmu: kerjakan HANYA Fase <ID> pada file
frontend/components/Modals/Transform/StringToWordVector/PLAN_FIX.md.
Sebelum mulai baca: PLAN_FIX.md §0, §1, §2, §3 dan bagian Fase <ID>; AUDIT_REPORT.md (temuan yang dirujuk fase);
serta laporan fase prasyarat di StringToWordVector/plan-reports/.
Patuhi aturan §1 (tanpa git, tanpa npm install/cargo add/wasm-pack, hanya file milik fase).
Selesaikan semua item "Tugas" dan "Kriteria selesai", jalankan test yang diizinkan,
lalu tulis laporan ke StringToWordVector/plan-reports/<ID>.md.
```

---

## 2. Peta gelombang (paralel)

```
Gelombang 1 (paralel):  S1  Rust: ekstraksi crate CORE + characterization test
                        S5  TS : perbaikan hook (F01, F04-TS, F20, F21) + config.ts
                        S7  Housekeeping: build-wasm.sh (F15), hapus stub worker (F23)
Gelombang 2 (paralel):  S2  Rust: pipeline sekali-inisialisasi, error objek, enum config (F04-Rust, F08, F11, F21)
                        S6  TS : OptionsTab preset Weka/sklearn/Custom, minTermFreq, validasi (F12, F19, F22)
Gelombang 3:            S3  Rust: standar rumus, normalisasi, minTermFreq, wordsToKeep 0/ranking, df satu pass (F09, F13, F16, F17)
Gelombang 4:            S4  Rust: API fit/transform + TextVectorizerModel (resep) + CSR (untuk Tahap 2)
Gelombang 5 (manual):   S8  PEMILIK: build WASM STWV + uji manual
Gelombang 6:            S9  Verifikasi akhir + README/dokumentasi batasan
```

| Fase | Prasyarat | Bisa paralel dengan | Perkiraan |
|---|---|---|---|
| S1 | – | S5, S7 | M |
| S5 | – | S1, S7 | M |
| S7 | – | S1, S5 | S |
| S2 | S1 | S6 | M |
| S6 | S5 | S2, S3, S4 | M |
| S3 | S2 | S6 | M |
| S4 | S3 | S6 | M |
| S8 | S4, S6 | – | manual |
| S9 | S8 | – | S |

---

## 3. Kontrak teknis Tahap 1 (dikunci; Tahap 2 bergantung pada ini)

### 3.1 Konfigurasi (JSON TS → Rust, snake_case)

```rust
// CORE/src/config.rs
pub struct TextVectorizerConfig {
    pub lowercase: bool,
    pub stopwords_method: StopwordsMethod,   // "none" | "indonesian" | "english" | "custom"
    pub custom_stopwords: Option<String>,    // JSON array string (kontrak lama dipertahankan); daftar final dari TS
    pub stemming_method: StemmingMethod,     // "none" | "indonesian" | "english"
    pub delimiters: String,                  // regex; kosong → fallback r"[\s\p{P}]+"
    pub ngram_min: usize,                    // >= 1
    pub ngram_max: usize,                    // >= ngram_min, <= 5
    #[serde(default)] pub formula_standard: FormulaStandard, // "weka" (default) | "sklearn" | "custom"
    pub tf_method: TfMethod,                 // "binary" | "raw" | "log1p" | "sublinear" | "normalized"
                                             //   alias lama: "none" → binary, "log" → sublinear
    pub idf_method: IdfMethod,               // "none" | "standard" | "smooth" | "plus1"
                                             //   alias lama: "idf" → standard
    #[serde(default)] pub normalization: Normalization, // "none" (default) | "l1" | "l2" | "doc_length"
    pub words_to_keep: usize,                // 0 = semua
    #[serde(default = "one")] pub min_term_freq: usize, // >= 1
}
```

Semua enum memakai `#[serde(rename_all = "snake_case")]` + `#[serde(alias = ...)]` untuk nilai lama. Nilai tidak dikenal → error `INVALID_CONFIG` (tidak ada lagi fallback diam-diam `_ => ...`).

**Kombinasi yang sah per standar** (divalidasi di Rust dan TS):

| Standar | TF | IDF | Normalisasi | Default saat dipilih |
|---|---|---|---|---|
| `weka` | binary, raw, log1p | none, standard | none, doc_length | raw / none / none |
| `sklearn` | binary, raw, sublinear | none, smooth, plus1 | none, l2, l1 | raw / smooth / l2 |
| `custom` | semua | semua | semua | (nilai saat ini dipertahankan) |

### 3.2 Rumus (dikunci)

Notasi: `c` = raw count term di dokumen, `T(d)` = jumlah token dokumen setelah preprocessing (termasuk n-gram, sebelum pemangkasan kosakata), `N` = jumlah dokumen fit, `df` = jumlah dokumen fit yang memuat term.

| Nama | Rumus |
|---|---|
| TF binary | `1` bila c>0, selain itu 0 |
| TF raw | `c` |
| TF log1p (Weka TFTransform) | `ln(1 + c)` |
| TF sublinear (sklearn) | `1 + ln(c)` bila c>0, selain itu 0 |
| TF normalized | `c / T(d)` (0 bila T(d)=0) |
| IDF none | `1` |
| IDF standard (Weka) | `ln(N / df)` |
| IDF smooth (sklearn default) | `ln((1+N)/(1+df)) + 1` |
| IDF plus1 (sklearn smooth_idf=False) | `ln(N/df) + 1` |
| Norm l2 | `v / ‖v‖₂` (baris nol tetap nol) |
| Norm l1 | `v / Σ|v|` (baris nol tetap nol) |
| Norm doc_length (Weka normalizeDocLength) | `v · avg_norm / ‖v‖₂`, `avg_norm` = rata-rata `‖v‖₂` dokumen fit yang normanya > 0 (dihitung saat fit, disimpan di model) |

Urutan nilai sel: `tf → × idf → normalisasi`.

**Pemilihan kosakata (saat fit):**
1. Kumpulkan semua term + total raw count + df.
2. Buang term dengan total raw count `< min_term_freq`.
3. Bila `words_to_keep > 0` dan jumlah term > `words_to_keep`: rangking —
   - `weka`/`sklearn`: total raw count menurun, tie → alfabetis (byte-wise) naik;
   - `custom`: skor Σ_d TF(d)×IDF (cara lama), tie → alfabetis.
   Ambil `words_to_keep` teratas (truncate ketat; catat di README bahwa Weka menyimpan semua yang seri).
4. Urutkan kosakata akhir alfabetis (byte-wise) → urutan kolom.
5. Hitung df/IDF hanya untuk kosakata akhir. Bila kosakata kosong → `EMPTY_VOCABULARY`.

**Dokumen kosong** (string kosong/whitespace atau semua token terbuang) → baris nol. Validator hanya menolak bila array dokumen kosong atau **semua** dokumen kosong (`EMPTY_INPUT`).

### 3.3 Error

```rust
#[derive(Serialize)] pub struct TextError { pub code: String, pub message: String }
```
Kode: `EMPTY_INPUT`, `INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, `EMPTY_VOCABULARY`, `INVALID_DATA`, `SERIALIZE_ERROR`. Pesan dalam Bahasa Indonesia.
Pembungkus WASM STWV mengembalikan error sebagai **objek JS** `{code, message}` (via `serde_wasm_bindgen::to_value`), bukan string.

### 3.4 API crate CORE (setelah S4)

```rust
pub struct Pipeline { /* regex, set stopword, stemmer — dibangun SEKALI */ }
pub fn prepare(cfg: &TextVectorizerConfig) -> Result<Pipeline, TextError>;
impl Pipeline { pub fn tokens_batch(&self, docs: &[String]) -> Vec<Vec<String>>; }

pub struct TextVectorizerModel {          // "resep", Serialize + Deserialize
    pub recipe_version: String,           // "1.0"
    pub config: TextVectorizerConfig,
    pub resolved_stopwords: Vec<String>,  // daftar final (lowercase) yang dipakai saat fit
    pub vocabulary: Vec<String>,          // urutan kolom
    pub idf: Vec<f64>,                    // sejajar vocabulary (1.0 bila idf none)
    pub doc_freq: Vec<u32>,               // df saat fit
    pub n_docs: u32,
    pub avg_doc_norm: Option<f64>,        // hanya untuk doc_length
}
pub struct CsrMatrix { pub n_rows: usize, pub n_cols: usize,
                       pub indptr: Vec<usize>, pub indices: Vec<u32>, pub data: Vec<f64> }
impl CsrMatrix { pub fn to_dense(&self) -> Vec<Vec<f64>>; }

pub fn fit(docs: &[String], cfg: &TextVectorizerConfig) -> Result<TextVectorizerModel, TextError>;
pub fn transform(model: &TextVectorizerModel, docs: &[String]) -> Result<CsrMatrix, TextError>;
pub fn fit_transform(docs: &[String], cfg: &TextVectorizerConfig) -> Result<(TextVectorizerModel, CsrMatrix), TextError>;
```
`transform` memakai `resolved_stopwords`, `vocabulary`, `idf`, `avg_doc_norm` dari model — **tidak** menghitung ulang statistik apa pun; term di luar kosakata (OOV) diabaikan.

### 3.5 Output WASM STWV ke UI (Tahap 1)

```json
{ "vocabulary": ["..."], "matrix": [[...]],
  "stats": { "total_documents": 3, "empty_documents": 0, "vocabulary_size": 5,
             "formula_standard": "weka", "method": "TF: raw, IDF: none, Norm: none, Keep: 1000, MinFreq: 1" } }
```

### 3.6 Angka acuan (golden) untuk test

Korpus `D = ["Saya suka makan nasi", "Saya tidak suka nasi!", "Makan, makan, makan"]`, lowercase ON, stopwords none, stemming none, delimiter default, unigram, words_to_keep 1000, min_term_freq 1.
Kosakata: `[makan, nasi, saya, suka, tidak]`. Raw count:
```
[1,1,1,1,0]
[0,1,1,1,1]
[3,0,0,0,0]
```

| Konfigurasi | Hasil (6 desimal) |
|---|---|
| Lama: tf `log`(=sublinear), idf `smooth`, norm none (characterization S1) | `[[1.287682,1.287682,1.287682,1.287682,0],[0,1.287682,1.287682,1.287682,1.693147],[2.702345,0,0,0,0]]` |
| Weka raw/none/none (default baru) | sama dengan raw count |
| Weka log1p/standard/none | `[[0.281047,0.281047,0.281047,0.281047,0],[0,0.281047,0.281047,0.281047,0.761500],[0.562094,0,0,0,0]]` |
| Weka raw/standard/doc_length (`avg_norm` = 1.110408) | `[[0.555204,0.555204,0.555204,0.555204,0],[0,0.345296,0.345296,0.345296,0.935584],[1.110408,0,0,0,0]]` |
| sklearn raw/smooth/l2 (= `TfidfVectorizer()` default) | `[[0.5,0.5,0.5,0.5,0],[0,0.459854,0.459854,0.459854,0.604652],[1,0,0,0,0]]`; idf `[1.287682,1.287682,1.287682,1.287682,1.693147]` |
| sklearn raw/plus1/l2 (`smooth_idf=False`) | `[[0.5,0.5,0.5,0.5,0],[0,0.437287,0.437287,0.437287,0.652948],[1,0,0,0,0]]`; idf `[1.405465,…,2.098612]` |
| sklearn raw/smooth/none | `[[1.287682,1.287682,1.287682,1.287682,0],[0,1.287682,1.287682,1.287682,1.693147],[3.863046,0,0,0,0]]` |

Nilai sklearn dihasilkan dengan scikit-learn 1.9.1 (tokenizer = split delimiter default, lowercase); toleransi assert `1e-6`.

---

## 4. Fase

### Fase S1 — Ekstraksi crate `CORE` + characterization test  *(Gelombang 1)*

**Temuan:** D9 (fondasi), F14 (sebagian).
**File milik fase:** `CORE/**` (baru), `STWV/rust/Cargo.toml`, `STWV/rust/src/**`.
**Tugas:**
1. Buat crate library `CORE/` (`name = "statify-text-core"`, `crate-type = ["rlib"]`, edition 2021) dengan dependensi yang sama seperti `STWV/rust/Cargo.toml` **kecuali** `wasm-bindgen`, `web-sys`, `serde-wasm-bindgen`, `console_error_panic_hook`. Versi dependensi disalin persis agar `Cargo.lock` STWV tetap bisa dipakai.
2. Pindahkan logika `tokenizer.rs`, `stopwords.rs`, `stemmer.rs`, `ngram.rs`, `vectorizer.rs`, `validator.rs`, dan struct config ke `CORE/src/` **tanpa mengubah perilaku**. Error core menjadi `TextError` (Serialize), tanpa `JsValue`.
3. `STWV/rust/Cargo.toml`: tambah `statify-text-core = { path = "../../../../../rust-crates/statify-text-core" }`. `STWV/rust/src/lib.rs` menjadi pembungkus: parse config → panggil fungsi core → serialize. Ekspor `process_text_data` dan `init_panic_hook` tetap sama namanya.
4. Tulis **characterization test** di `CORE/tests/characterization.rs` yang mengunci perilaku saat ini memakai golden baris "Lama" §3.6, plus: unigram vs bigram (`ngram_min=1,max=2` pada "makan nasi goreng" → `["makan","nasi","goreng","makan nasi","nasi goreng"]`), stopwords custom case-insensitive, stemming ID `"memakan" → "makan"`, stemming EN `"running" → "run"`, `words_to_keep=2` pada D.
**Kriteria selesai:** `cargo test` di `CORE/` hijau (atau perintah dicatat); `STWV/rust` tetap ter-compile (`cargo check` bila tersedia); tidak ada perubahan perilaku.
**Laporan:** `STWV/plan-reports/S1.md`.

### Fase S5 — Perbaikan hook & ekstraksi `config.ts`  *(Gelombang 1)*

**Temuan:** F01, F04 (sisi TS), F20, F21 (sisi TS).
**File milik fase:** `STWV/hooks/useStringToWordVector.ts`, `STWV/stringToWord.processor.ts`, `STWV/StringToWordVectorModal.tsx`, baru: `STWV/config.ts`, `STWV/types.ts`, `STWV/utils/*.ts`, `STWV/__tests__/*.test.ts`.
**Tugas:**
1. `STWV/types.ts`: satu-satunya definisi `VectorizerOutput`, `AppError`, `VectorizerConfigPayload` (hapus duplikat di hook & processor; impor dari sini).
2. `STWV/config.ts`: pindahkan state default config dan pembentukan payload Rust **apa adanya** (belum ada preset — itu S6) ke `export type StwvConfig`, `export const STWV_DEFAULT_CONFIG`, `export function toRustConfig(config: StwvConfig): VectorizerConfigPayload`. Hook memakai file ini.
3. **F01:** fungsi murni `utils/buildDocuments.ts`: `null/undefined → ""`, lainnya `String(v)`; **tidak membuang baris**. Bila semua dokumen kosong/whitespace → error `EMPTY_DATA` di UI tanpa memanggil worker. Matriks hasil ditulis ke dataset baris-demi-baris sejajar indeks asli.
4. **F04 (TS):** fungsi murni `utils/normalizeWorkerError.ts(payload: unknown): AppError` — menerima string JSON, objek `{code,message}`, `Error`, atau nilai lain → selalu menghasilkan `{code, message}` yang terisi (fallback `WASM_ERROR`). Dipakai di worker **dan** di hook (`onmessage` status error dan `onerror`).
5. **F20:** setelah `saveToDataset` sukses → `setResult(null)`. Saat Run, re-resolve variabel dari `useVariableStore.getState().variables` berdasarkan `id`; bila tidak ditemukan → error ramah pengguna. Fungsi pembentuk kolom (`utils/buildColumnData.ts`) dipisah agar bisa dites.
6. Test jest (`STWV/__tests__/`): `buildDocuments` (T1: `["a b", null, "", "b c"]` → 4 dokumen, urutan sama), `normalizeWorkerError` (string JSON, objek, Error, undefined), `buildColumnData` (matriks 4×2 → 2 kolom panjang 4, baris ke-3 = vektor dokumen ke-3).
**Kriteria selesai:** test jest hijau; `npx tsc --noEmit` tidak menambah error baru pada file milik fase; perilaku opsi UI belum berubah.
**Laporan:** `STWV/plan-reports/S5.md`.

### Fase S7 — Housekeeping build & stub  *(Gelombang 1)*

**Temuan:** F15, F23.
**File milik fase:** `build-wasm.sh` (root repo), `frontend/public/workers/StringToWordVector/vectorizer.worker.js` (hapus).
**Tugas:**
1. Tambahkan blok di `build-wasm.sh` (ikuti gaya blok lain, gunakan path relatif yang benar dari posisi `cd` terakhir — lebih aman: `cd` ke root repo dulu dengan `cd "$(dirname "$0")"` di awal blok):
   `cd frontend/components/Modals/Transform/StringToWordVector/rust && wasm-pack build --target web --out-dir ../wasm-output --release`.
   Jangan mengubah blok modul lain.
2. Hapus file stub `vectorizer.worker.js` (pastikan dulu dengan pencarian teks bahwa tidak ada impor/rujukan kode ke file itu; rujukan di README biarkan — S9 yang memperbaiki).
**Kriteria selesai:** `bash -n build-wasm.sh` lolos; tidak ada rujukan kode ke stub.
**Laporan:** `STWV/plan-reports/S7.md`.

### Fase S2 — Pipeline sekali-inisialisasi, error objek, enum config  *(Gelombang 2, setelah S1)*

**Temuan:** F04 (Rust), F08, F11, F21 (Rust).
**File milik fase:** `CORE/src/**`, `CORE/tests/**`, `STWV/rust/src/**`.
**Tugas:**
1. Ganti string metode dengan enum sesuai §3.1 (termasuk alias nilai lama). Nilai tidak dikenal → `INVALID_CONFIG`. Tambah field baru dengan `#[serde(default)]` (`formula_standard`, `normalization`, `min_term_freq`) — **perilakunya baru diimplementasi di S3**; di S2 cukup diparsing dan divalidasi rentangnya (`min_term_freq >= 1`, `ngram_max <= 5`).
2. `Pipeline` (§3.4): regex, `HashSet` stopword (parse JSON **sekali**), dan stemmer dibangun sekali per pemanggilan, lalu dipakai untuk semua dokumen. Catatan: bila `sastrawi::Stemmer` meminjam `Dictionary`, simpan `Dictionary` di dalam `Pipeline` dan buat `Stemmer` sekali di `tokens_batch`, bukan per dokumen. Tambahkan cache memo `HashMap<String,String>` hasil stem per batch.
3. **F11:** error parse stopword dipropagasi sebagai `INVALID_STOPWORDS` (hapus `unwrap_or_else(|_| vec![])`).
4. Validator mengikuti §3.2 (dokumen kosong diperbolehkan; hanya "semua kosong" yang ditolak).
5. **F04 (Rust):** pembungkus WASM mengembalikan error sebagai objek JS (`serde_wasm_bindgen::to_value(&err)`).
6. Test baru: T6 (`custom_stopwords = Some("not json")` → `INVALID_STOPWORDS`), nilai enum tidak dikenal → `INVALID_CONFIG`, alias `"log"`/`"idf"`/`"none"` diterima, dokumen kosong di tengah → baris nol, characterization S1 tetap hijau.
**Kriteria selesai:** semua test `CORE/` hijau; hasil characterization tidak berubah.
**Laporan:** `STWV/plan-reports/S2.md`.

### Fase S6 — OptionsTab: preset, minTermFreq, validasi  *(Gelombang 2, setelah S5)*

**Temuan:** F12, F13 (UI), F16/F17 (UI), F19, F22; keputusan D5–D8.
**File milik fase:** `STWV/OptionsTab.tsx`, `STWV/config.ts`, baru: `STWV/constants/formula-standards.ts`, `STWV/__tests__/config.test.ts`; `STWV/StringToWordVectorModal.tsx` **hanya** untuk menonaktifkan tombol Run + menampilkan pesan validasi (S5 sudah selesai sebelum fase ini).
**Tugas:**
1. `formula-standards.ts`: definisi tiga standar (§3.1) — opsi TF/IDF/Norm yang sah, label UI, rumus singkat untuk tooltip, dan default per standar.
   Label UI: Weka TF "Presence (0/1)", "Word count", "log(1 + f)"; IDF "None", "ln(N / df)"; Norm "None", "Normalize document length". sklearn TF "Binary", "Count", "Sublinear 1 + ln(f)"; IDF "None", "Smooth ln((1+N)/(1+df)) + 1", "ln(N/df) + 1"; Norm "None", "L2", "L1". Custom: gabungan semua dengan label rumus.
2. `config.ts`: tambah `formulaStandard`, `normalization`, `minTermFreq`; `STWV_DEFAULT_CONFIG` sesuai D6; `toRustConfig` mengirim field §3.1 (nilai enum baru, bukan alias lama). Tambah `validateStwvConfig(config): string[]` (n-gram 1..5 dan min ≤ max, `wordsToKeep` bilangan bulat ≥ 0, `minTermFreq` bulat ≥ 1, delimiter tidak kosong, kombinasi TF/IDF/Norm sah untuk standarnya).
3. `OptionsTab.tsx`: props bertipe (`config: StwvConfig`, `setConfig: React.Dispatch<React.SetStateAction<StwvConfig>>`) — **tanpa `any`** dan tanpa ketergantungan ke hook, karena komponen ini akan dipakai ulang di tab Text Preprocessing NB v2. Tambah radio "Formula standard" (Weka / scikit-learn / Custom); mengganti standar menerapkan default standar itu (Custom mempertahankan nilai saat ini). Grup TF/IDF/Normalization hanya menampilkan opsi sah. Hapus opsi TF "None" (F22). Tambah input "Min term frequency". Words to Keep menerima `0` dengan keterangan "0 = keep all words". Di bawah Stemming tampilkan catatan kecil: "Stemming always lowercases tokens; the Lowercase option is ignored when stemming is active." (F12). Input n-gram di-clamp 1..5.
4. Modal: tombol Run disabled bila `validateStwvConfig` mengembalikan pesan; pesan ditampilkan di area error.
5. Test jest `config.test.ts`: default = Weka/raw/none/none; `toRustConfig` menghasilkan nilai §3.1; validasi menolak min>max, ngram 6, wordsToKeep −1, minTermFreq 0, sklearn+doc_length; pergantian standar menerapkan default yang benar.
**Kriteria selesai:** test hijau; tidak ada `any` di `OptionsTab.tsx`/`config.ts`.
**Laporan:** `STWV/plan-reports/S6.md`.

### Fase S3 — Standar rumus, normalisasi, minTermFreq, ranking, df satu pass  *(Gelombang 3, setelah S2)*

**Temuan:** F09 (df/skor), F13 (minTermFreq, 0 = semua, ranking), F16, F17; keputusan D5–D8.
**File milik fase:** `CORE/src/**`, `CORE/tests/**`, `STWV/rust/src/**` (hanya untuk field `stats` §3.5).
**Tugas:**
1. Implementasi seluruh rumus & urutan §3.2 (TF, IDF, normalisasi termasuk `doc_length` dengan `avg_norm` dari data fit).
2. Validasi kombinasi standar (§3.1 tabel) → `INVALID_CONFIG`.
3. Pemilihan kosakata §3.2 langkah 1–5 (min_term_freq, ranking per standar, `0` = semua).
4. **F09:** hitung df, total count, dan skor dalam **satu pass per dokumen** (iterasi token unik dokumen → indeks term), hilangkan loop `vocabulary × dokumen`.
5. `stats` keluaran WASM sesuai §3.5 (`empty_documents`, `formula_standard`, `method`).
6. Test: setiap baris tabel golden §3.6 (toleransi 1e-6); `min_term_freq=2` pada D → kosakata `[makan, nasi, saya, suka]`; `words_to_keep=1` Weka → `[makan]` (count 4); `words_to_keep=0` → semua 5; tie-break alfabetis (`words_to_keep=2` pada korpus dengan count seri); kombinasi tidak sah → `INVALID_CONFIG`; dokumen kosong tetap baris nol pada l2/doc_length (tanpa NaN).
**Kriteria selesai:** semua test hijau, tidak ada NaN/Inf di output untuk dokumen kosong.
**Laporan:** `STWV/plan-reports/S3.md`.

### Fase S4 — API fit/transform, resep, CSR  *(Gelombang 4, setelah S3)*

**Temuan:** fondasi Tahap 2 (F02 untuk NB v2/AM v2), F09 (sparse internal).
**File milik fase:** `CORE/src/**`, `CORE/tests/**`, `STWV/rust/src/lib.rs`.
**Tugas:**
1. Implementasi `TextVectorizerModel`, `CsrMatrix`, `fit`, `transform`, `fit_transform` sesuai §3.4. `resolved_stopwords` berisi daftar final lowercase (urutan alfabetis, unik).
2. Pembungkus WASM STWV memakai `fit_transform` lalu `to_dense()` (output §3.5 tidak berubah).
3. Test: `transform(fit(D), D) == fit_transform(D)` untuk semua konfigurasi golden; T13: fit pada `["makan nasi","minum teh"]`, transform `["makan teh kopi"]` → kolom `[makan, minum, nasi, teh]`, `kopi` diabaikan, IDF memakai N=2; T14: dokumen seluruhnya OOV → baris nol; serialisasi model ke JSON lalu deserialisasi → transform identik; doc_length memakai `avg_doc_norm` tersimpan (bukan dari data transform).
**Kriteria selesai:** test hijau; API publik persis §3.4 (Tahap 2 bergantung padanya).
**Laporan:** `STWV/plan-reports/S4.md`.

### Fase S8 — Build WASM & uji manual  *(Gelombang 5, DIJALANKAN PEMILIK)*

```bash
# Uji crate inti dan wrapper STWV (native)
cd frontend/rust-crates/statify-text-core && cargo test && cd -
cd frontend/components/Modals/Transform/StringToWordVector/rust && cargo test && cd -

# Build WASM STWV (hasil ke wasm-output/)
cd frontend/components/Modals/Transform/StringToWordVector/rust
wasm-pack build --target web --out-dir ../wasm-output --release
cd -
```
Uji manual di aplikasi (catat hasil di `STWV/plan-reports/S8.md`):
1. `dataset_untuk_text/dataset_indonesia_testing.csv` (baris `"   "` ada): Run default → 10 baris vektor, baris ke-8 semua 0, baris lain sejajar.
2. Kosongkan satu sel teks di tengah dataset tweet 10 baris → setelah "Add to dataset", vektor baris lain tidak bergeser.
3. Set n-gram min 3 max 2 → tombol Run nonaktif + pesan. Delimiter `[(` → pesan `[INVALID_REGEX] ...` tampil jelas.
4. Preset sklearn raw/smooth/l2 pada korpus D (§3.6) → angka sama dengan tabel.
5. Klik "Add to dataset" → tombol hilang/hasil direset (tidak bisa menambah kolom ganda).

### Fase S9 — Verifikasi akhir & dokumentasi  *(Gelombang 6, setelah S8)*

**File milik fase:** `STWV/README.md`, `STWV/Rust_Implementation_Plan.md`, `STWV/AUDIT_REPORT.md` (hanya menambah bagian "Status tindak lanjut" di akhir), baru: `CORE/README.md`.
**Tugas:**
1. Baca semua laporan `plan-reports/S*.md`; jalankan ulang test yang diizinkan; laporkan regresi.
2. README STWV: perbarui arsitektur (crate CORE, worker aktif `stringToWord.processor.ts`), tabel rumus §3.2, preset, default baru (D6), perilaku sel kosong (D4), dan **Batasan yang diketahui**: (a) STWV tidak menyimpan resep — menjalankan STWV ulang pada data baru menghasilkan kosakata/IDF/normalisasi yang dihitung dari data baru; untuk prediksi data baru dengan IDF/normalisasi gunakan jalur Raw Text di Naive Bayes; (b) kosakata/IDF dihitung dari seluruh dataset sebelum validasi NB (evaluasi dapat sedikit optimis); (c) Words to Keep truncate ketat (Weka menyimpan semua yang seri); (d) stemming selalu lowercase; (e) daftar stopword bawaan memuat kata negasi (sesuai keputusan pemilik, tidak diubah).
3. Rust_Implementation_Plan.md: tandai bagian yang sudah tidak berlaku (formula lama) dan rujuk ke README.
4. AUDIT_REPORT.md: tambah tabel "Status tindak lanjut" per ID temuan (Selesai / Tidak dikerjakan (D2) / Dipindah ke Tahap 2).
**Laporan:** `STWV/plan-reports/S9.md`.

---

## 5. Checklist (dicentang pemilik)

- [x] S1  - [ ] S5  - [ ] S7
- [ ] S2  - [ ] S6
- [ ] S3
- [ ] S4
- [ ] S8 (manual)
- [ ] S9
