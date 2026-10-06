# Dokumentasi Modul String to Word Vector (STWV)

**Lokasi kode:** `frontend/components/Modals/Transform/StringToWordVector/`
**Mesin inti (Rust):** `frontend/public/workers/TextAnalytics/statify-text-core/` (disebut **CORE**)
**Menu:** *Transform → String to Word Vector*
**Status:** Tahap 1 (`PLAN_FIX.md` S1–S9) selesai; CORE juga dipakai Naive Bayes v2 dan Apply Model v2.

Dokumen ini ditulis untuk tiga pembaca sekaligus:

| Bagian | Untuk siapa | Isi |
|---|---|---|
| [A. Panduan pengguna](#a-panduan-pengguna) | Pengguna Statify | Apa fungsinya, langkah pakai, arti setiap opsi, cara membaca hasil, masalah umum |
| [B. Landasan teori & metodologi](#b-landasan-teori--metodologi-bahan-skripsi) | Penulisan skripsi | Konsep, alur pra-pemrosesan, rumus TF/IDF/normalisasi, contoh perhitungan, keterbatasan metodologis |
| [C. Dokumentasi teknis](#c-dokumentasi-teknis-pengembang) | Pengembang | Arsitektur, struktur file, alur data, kontrak config/output/error, test, build |

Dokumen kontrak yang mengikat tetap `PLAN_FIX.md` §3 (rumus & API dikunci). Riwayat temuan ada di `AUDIT_REPORT.md`,
laporan per fase di `plan-reports/S1.md`–`S9.md`, dan ringkasan status di `README.md`.

---

## A. Panduan pengguna

### A.1 Apa itu String to Word Vector?

Kebanyakan metode statistik dan *machine learning* hanya bisa mengolah angka. **String to Word Vector** mengubah satu
kolom teks (misalnya isi tweet atau ulasan) menjadi **banyak kolom angka**: satu kolom untuk setiap kata (atau frasa
n-gram) yang dipilih. Nilai pada kolom itu menunjukkan seberapa penting kata tersebut di baris (dokumen) yang
bersangkutan, misalnya berapa kali kata itu muncul atau bobot TF-IDF-nya.

Contoh. Kolom `Teks` berisi tiga baris:

| Baris | Teks |
|---|---|
| 1 | Saya suka makan nasi |
| 2 | Saya tidak suka nasi! |
| 3 | Makan, makan, makan |

Dengan pengaturan default (Weka, hitungan kata), STWV menambahkan lima kolom baru:

| Baris | VEC_makan | VEC_nasi | VEC_saya | VEC_suka | VEC_tidak |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | 1 | 0 |
| 2 | 0 | 1 | 1 | 1 | 1 |
| 3 | 3 | 0 | 0 | 0 | 0 |

Kolom ini kemudian bisa dipakai menu lain, misalnya sebagai **Word-Vector Variables** di Naive Bayes.

### A.2 Kapan dipakai (dan kapan tidak)

- **Pakai STWV** bila Anda ingin melihat atau menyimpan matriks kata di Data View, memakai vektor kata di menu selain
  Naive Bayes, atau membandingkan konfigurasi vektorisasi secara manual.
- **Untuk klasifikasi teks dengan Naive Bayes**, jalur **Raw Text Variable** di menu Naive Bayes biasanya lebih tepat:
  pra-pemrosesannya identik (mesin CORE yang sama), tetapi kosakata/IDF dihitung ulang hanya dari data latih tiap
  holdout/fold (tanpa kebocoran data), dan resepnya disimpan sehingga model bisa diterapkan ke data baru lewat
  Apply Model. Lihat `../../Analyze/Classify/naive-bayes/DOKUMENTASI.md`.

### A.3 Langkah pemakaian

1. Buka dataset yang memuat kolom teks.
2. Pilih menu **Transform → String to Word Vector**. Panel muncul di sidebar kanan dengan dua tab: **Variables** dan **Options**.
3. Tab **Variables**: daftar kiri (**Variables:**) hanya berisi variabel bertipe `STRING` atau ber-*measure* `nominal`.
   Klik satu variabel, lalu klik tombol panah untuk memindahkannya ke **Target Variable**. Klik variabel di kotak
   Target untuk mengembalikannya.
4. Tab **Options**: atur nama kolom hasil (**Vector Column Name**), pra-pemrosesan, tokenizer, dan metode vektorisasi
   (lihat A.4). Bila ada opsi yang tidak sah, di bawah panel muncul pesan **"Opsi belum valid:"** dan tombol OK nonaktif.
5. Klik **OK**. Selama proses tampil "Memproses... Harap tunggu.". Setelah selesai:
   - kolom baru ditambahkan di akhir dataset,
   - ringkasan proses ditulis ke Output Viewer,
   - muncul toast "N kolom vektor berhasil ditambahkan ke dataset." dan panel tertutup.
6. **Reset** mengembalikan semua pilihan ke default; **Cancel** menutup tanpa memproses.

Karena hasil langsung ditulis saat OK, tidak ada tombol terpisah untuk menambahkan ke dataset. Menjalankan STWV dua
kali akan menambahkan dua set kolom (nama yang bentrok otomatis diberi akhiran agar unik).

### A.4 Arti setiap opsi (tab Options)

| Opsi | Default | Penjelasan |
|---|---|---|
| **Vector Column Name** | `VEC_` | Awalan nama kolom. Nama akhir = awalan + kata (mis. `VEC_makan`). Maks. 32 karakter, harus diawali huruf/`@`/`#`/`$`, hanya huruf, angka, `.`, `_`, `@`, `#`, `$`, tanpa spasi. |
| **Lowercase** | ON | Mengubah teks menjadi huruf kecil sebelum dipecah, sehingga "Makan" dan "makan" dianggap kata yang sama. |
| **Stopwords Removal** | None | Membuang kata umum yang dianggap tidak informatif. Pilihan: None, Indonesian, English, Custom (satu kata per baris). Pencocokan tidak membedakan huruf besar/kecil. |
| **Stemming** | None | Mengubah kata ke bentuk dasar. **Indonesian (Sastrawi)** (algoritma Nazief–Adriani), **English (Porter)** (sebenarnya Snowball English/Porter2). Stemming selalu menghasilkan huruf kecil. |
| **Tokenizer** | Word | **Word** = satu kata per token (unigram). **N-gram** = gabungan kata berurutan dengan ukuran min–max (1–5), mis. min 1 max 2 menghasilkan "makan", "nasi", dan "makan nasi". |
| **Delimiters** | `[\s.,;:'"()?!]+` | Ekspresi reguler pemisah token. Karakter yang tidak ada di sini (mis. `#`, `@`, `/`, `-`) tetap menempel pada kata. |
| **Formula standard** | Weka | Menentukan kombinasi rumus yang sah: **Weka**, **scikit-learn**, atau **Custom** (bebas). Mengganti standar menerapkan nilai default standar itu (kecuali Custom). |
| **Term Frequency (TF)** | Word count | Cara menghitung nilai kata dalam satu dokumen (lihat B.4). |
| **Inverse Document Frequency (IDF)** | None | Bobot yang menurunkan pengaruh kata yang muncul di banyak dokumen. |
| **Normalization** | None | Menyamakan skala vektor antar dokumen (L1, L2, atau panjang dokumen ala Weka). |
| **Words to Keep** | 1000 | Jumlah maksimum kata yang disimpan sebagai kolom. `0` = simpan semua. |
| **Min term frequency** | 1 | Kata dengan total kemunculan di seluruh data di bawah nilai ini dibuang. |

Kombinasi yang sah per standar:

| Standar | TF | IDF | Normalization | Default |
|---|---|---|---|---|
| Weka | Presence (0/1), Word count, log(1 + f) | None, ln(N / df) | None, Normalize document length | Word count / None / None |
| scikit-learn | Binary, Count, Sublinear 1 + ln(f) | None, Smooth, ln(N/df) + 1 | None, L2, L1 | Count / Smooth / L2 |
| Custom | semua (termasuk Normalized f / tokens) | semua | semua | nilai yang sedang dipilih |

Preset scikit-learn default (Count / Smooth / L2) setara dengan `TfidfVectorizer()` bawaan scikit-learn.

### A.5 Membaca hasil

**Di Data View.** Setiap kolom baru:

- tipe `NUMERIC`, measure `scale`, lebar 8;
- label `Vector of "kata"` (kata asli tersimpan di label walau nama kolom dirapikan);
- 0 desimal bila nilainya pasti bilangan bulat (TF biner/hitungan tanpa IDF dan tanpa normalisasi), selain itu 4 desimal
  (yang dibulatkan hanya tampilannya; nilai tersimpan utuh);
- urutan kolom alfabetis menurut kata.

Baris yang teksnya kosong atau semua katanya terbuang tetap ada dan berisi nol semua (**vektor nol**), sehingga baris
tetap sejajar dengan label kelas.

**Di Output Viewer** (judul "String to Word Vector"):

| Tabel | Isi |
|---|---|
| Ringkasan teks | Kalimat ringkas jumlah dokumen, kosakata, dan kolom yang ditambahkan. |
| **Processing Summary** | Source Variable, Documents (Rows), Documents with Zero Vector, Vocabulary Size, Columns Added to Dataset, Column Name Prefix, First – Last Column, Processing Time (ms). |
| **Settings** | Seluruh konfigurasi yang dipakai (preprocessing, tokenizer, rumus). |
| **Vocabulary** | Kolom No, Term, Dataset Column, Documents (Non-zero); maks. 200 baris ditampilkan (kolom di dataset tetap lengkap). |

### A.6 Pesan galat yang mungkin muncul

| Kode | Arti dan tindakan |
|---|---|
| `EMPTY_DATA` | Variabel terpilih tidak memiliki teks sama sekali. Pilih kolom lain. |
| `EMPTY_INPUT` | Semua dokumen kosong. |
| `EMPTY_VOCABULARY` | Tidak ada kata yang tersisa setelah pra-pemrosesan (mis. semua terbuang stopword atau Min term frequency terlalu tinggi). Longgarkan pengaturan. |
| `INVALID_CONFIG` | Kombinasi opsi tidak sah (mis. n-gram min > max, TF/IDF tidak sah untuk standar terpilih). |
| `INVALID_REGEX` | Pola Delimiters bukan regex yang valid. |
| `INVALID_STOPWORDS` | Daftar stopword tidak dapat dibaca. |
| `INVALID_COLUMN_NAME` | Vector Column Name tidak memenuhi aturan nama. |
| `VARIABLE_NOT_FOUND` | Variabel terpilih sudah dihapus/berubah; pilih ulang. |
| `SAVE_FAILED` | Kolom gagal ditambahkan ke dataset. |
| `INVALID_DATA`, `SERIALIZE_ERROR`, `WORKER_ERROR`, `INTERNAL_ERROR` | Galat internal; muat ulang halaman dan coba lagi. |

Galat ditampilkan di panel dalam bentuk `[KODE] pesan`.

### A.7 Tips konfigurasi

- **Mulai dari default Weka**, lalu ubah satu opsi setiap kali agar pengaruhnya terlihat.
- **Dataset tweet:** pemisah default tidak memecah `#hashtag`, `@mention`, potongan URL (`https`, `//bit`), atau simbol
  (`&`, `->`). Pertimbangkan menambah karakter ke Delimiters (mis. `[\s.,;:'"()?!/<>&\-]+`) atau membersihkan URL di data.
- **Analisis sentimen:** daftar stopword Indonesia/Inggris bawaan memuat kata negasi (`tidak`, `bukan`, `belum`,
  `jangan`, `not`, `no`). Gunakan stopwords None atau Custom tanpa kata negasi.
- **Kosakata besar:** ribuan kolom membuat dataset dan menu lain (mis. tab Variables Naive Bayes) berat. Batasi
  **Words to Keep** (mis. 1.000–5.000) atau gunakan jalur Raw Text di Naive Bayes.
- **Hasil dapat diulang:** STWV deterministik; konfigurasi dan data yang sama selalu menghasilkan kolom yang sama.

---

## B. Landasan teori & metodologi (bahan skripsi)

### B.1 Representasi *bag-of-words*

STWV memakai model **bag-of-words**: setiap dokumen direpresentasikan sebagai vektor berdimensi `V` (ukuran kosakata),
tanpa memperhatikan urutan kata (kecuali urutan lokal yang ditangkap n-gram). Koleksi `N` dokumen menjadi matriks
dokumen–term `X` berukuran `N × V`. Pendekatan ini setara dengan filter `StringToWordVector` pada Weka dan
`CountVectorizer`/`TfidfVectorizer` pada scikit-learn; Statify menyediakan preset untuk keduanya agar angka dapat
dibandingkan.

### B.2 Alur pra-pemrosesan

Urutan di CORE (`pipeline.rs`, `Pipeline::tokens_batch`) bersifat tetap:

```
teks mentah
  → [1] lowercase (opsional)
  → [2] tokenisasi: split dengan regex Delimiters, token kosong dibuang
  → [3] buang stopword (case-insensitive)
  → [4] stemming (Sastrawi / Snowball English; selalu lowercase; hasil di-cache per batch)
  → [5] pembentukan n-gram (setelah stemming, jadi bigram tersusun dari kata dasar)
  → daftar token per dokumen
```

Catatan metodologis:

- Stopword dibuang **sebelum** stemming, sehingga kata hasil stemming yang kebetulan berupa stopword tidak dibuang ulang.
- Satu dokumen masukan selalu menghasilkan tepat satu baris keluaran; dokumen kosong menjadi baris nol.

### B.3 Pemilihan kosakata

Dilakukan saat *fit* atas seluruh dokumen yang diproses:

1. Kumpulkan setiap term beserta **total kemunculan** di seluruh dokumen dan **document frequency** `df`
   (jumlah dokumen yang memuat term), dalam satu kali lintasan.
2. Buang term dengan total kemunculan `< Min term frequency`.
3. Bila `Words to Keep > 0` dan jumlah term melebihi batas, peringkatkan lalu ambil teratas:
   - Weka dan scikit-learn: total kemunculan menurun; seri diurutkan alfabetis;
   - Custom: skor Σ_d TF(d)·IDF; seri alfabetis.
   Pemotongan bersifat **ketat** (Weka asli menyimpan semua term yang seri di batas, sehingga jumlah kolom Weka bisa
   melebihi Words to Keep).
4. Kosakata akhir diurutkan alfabetis (byte-wise) dan menjadi urutan kolom.
5. `df` dan IDF dihitung untuk kosakata akhir. Kosakata kosong → `EMPTY_VOCABULARY`.

### B.4 Rumus pembobotan (dikunci, `PLAN_FIX.md` §3.2)

Notasi: `c` = jumlah kemunculan term di dokumen, `T(d)` = jumlah token dokumen setelah pra-pemrosesan (termasuk
n-gram, sebelum pemangkasan kosakata), `N` = jumlah dokumen, `df` = jumlah dokumen yang memuat term.

| Komponen | Nama | Rumus | Padanan |
|---|---|---|---|
| TF | binary | `1` bila `c > 0`, selain itu `0` | Weka `outputWordCounts=false`; sklearn `binary=True` |
| TF | raw | `c` | Weka word count; sklearn count |
| TF | log1p | `ln(1 + c)` | Weka `TFTransform` |
| TF | sublinear | `1 + ln(c)` bila `c > 0` | sklearn `sublinear_tf=True` |
| TF | normalized | `c / T(d)` | (Custom) |
| IDF | none | `1` | – |
| IDF | standard | `ln(N / df)` | Weka `IDFTransform` |
| IDF | smooth | `ln((1 + N) / (1 + df)) + 1` | sklearn default |
| IDF | plus1 | `ln(N / df) + 1` | sklearn `smooth_idf=False` |
| Norm | l2 | `v / ‖v‖₂` | sklearn `norm='l2'` |
| Norm | l1 | `v / Σ|v|` | sklearn `norm='l1'` |
| Norm | doc_length | `v · avg_norm / ‖v‖₂`, `avg_norm` = rata-rata `‖v‖₂` dokumen ber-norma > 0 | Weka `normalizeDocLength` |

Nilai sel dihitung berurutan: **TF → × IDF → normalisasi**. Baris dengan norma 0 tetap nol (tanpa NaN/Inf).

### B.5 Contoh perhitungan (angka acuan *golden*)

Korpus (`PLAN_FIX.md` §3.6): `D1 = "Saya suka makan nasi"`, `D2 = "Saya tidak suka nasi!"`, `D3 = "Makan, makan, makan"`.
Lowercase ON, tanpa stopword/stemming, unigram. Kosakata: `[makan, nasi, saya, suka, tidak]`.

Hitungan mentah (`c`):

```
D1 [1, 1, 1, 1, 0]
D2 [0, 1, 1, 1, 1]
D3 [3, 0, 0, 0, 0]
df = [2, 2, 2, 2, 1],  N = 3
```

**Weka log1p / standard / none.** IDF `makan` = `ln(3/2)` = 0,405465; `tidak` = `ln(3/1)` = 1,098612.
Sel `D1·makan` = `ln(1+1) × 0,405465` = 0,693147 × 0,405465 = **0,281047**. Sel `D2·tidak` = 0,693147 × 1,098612 = **0,761500**.
Sel `D3·makan` = `ln(1+3) × 0,405465` = **0,562094**. Hasil lengkap:
`[[0.281047,0.281047,0.281047,0.281047,0],[0,0.281047,0.281047,0.281047,0.761500],[0.562094,0,0,0,0]]`.

**scikit-learn raw / smooth / l2** (= `TfidfVectorizer()`): IDF `[1.287682,1.287682,1.287682,1.287682,1.693147]`;
hasil `[[0.5,0.5,0.5,0.5,0],[0,0.459854,0.459854,0.459854,0.604652],[1,0,0,0,0]]`.

**Weka raw / standard / doc_length:** `avg_norm` = 1,110408; hasil
`[[0.555204,0.555204,0.555204,0.555204,0],[0,0.345296,0.345296,0.345296,0.935584],[1.110408,0,0,0,0]]`.

Angka sklearn dibuat dengan scikit-learn 1.9.1; semua angka ini diuji otomatis di CORE dengan toleransi 1e-6
(`tests/s3_formulas.rs`, `tests/characterization.rs`).

### B.6 Keterbatasan metodologis (untuk dicantumkan)

1. **Kebocoran data saat evaluasi.** Kosakata, `df`/IDF, dan Words to Keep dihitung dari **seluruh** dataset sebelum
   dibagi menjadi data latih/uji oleh menu klasifikasi. Informasi data uji ikut membentuk fitur, sehingga metrik
   holdout/k-fold dapat sedikit optimis. Jalur Raw Text di Naive Bayes v2 menghindarinya.
2. **Tidak ada resep yang disimpan.** STWV tidak menyimpan kosakata/IDF. Menjalankan STWV ulang pada data baru
   menghitung kosakata, IDF, dan normalisasi dari data baru, sehingga nilai kolom bernama sama tidak setara dengan saat
   latih (kecuali konfigurasi tanpa IDF dan tanpa normalisasi).
3. **Truncate ketat Words to Keep** (lihat B.3).
4. **Stemming selalu lowercase**; opsi Lowercase OFF tidak berlaku bila stemming aktif.
5. **Stopword bawaan memuat kata negasi** (keputusan pemilik D2, tidak diubah).
6. **Words to Keep global**, bukan per kelas.
7. **Tokenizer berbasis delimiter**, tanpa normalisasi khusus tweet (URL, mention, hashtag, kata ulang seperti `seolah2`).
8. **Matriks padat ke UI**: memori naik sebanding `N × V`.

---

## C. Dokumentasi teknis (pengembang)

### C.1 Arsitektur

```
[UI] StringToWordVectorModal.tsx  (tab Variables | Options; footer OK / Reset / Cancel)
   ├─ VariablesTab.tsx      pilih satu variabel STRING/nominal
   └─ OptionsTab.tsx        StwvConfig (config.ts) + Vector Column Name
        │ state & orkestrasi: hooks/useStringToWordVector.ts
        ▼
 checkAndSave() → getVariableData(variable) → utils/buildDocuments.ts (null → "", baris tidak dibuang)
        │ postMessage({ data: string[], config: toRustConfig(config) })
        ▼
[Worker] stringToWord.processor.ts → init() WASM (wasm-output/) → process_text_data(data, config)
        ▼
[WASM tipis] rust/src/lib.rs   parse → statify_text_core::fit_transform → output_from_model (dense)
        ▼
[CORE] frontend/public/workers/TextAnalytics/statify-text-core
   validator → Pipeline (regex/stopword/stemmer dibuat sekali) → vectorizer → TextVectorizerModel + CsrMatrix
        ▼ { vocabulary, matrix, stats } atau galat { code, message }
 utils/buildColumnData.ts → useDataStore.addVariableColumns → registerVariableMetadata
 utils/buildStwvOutput.ts + utils/writeStwvOutput.ts → Output Viewer (useResultStore)
```

Registrasi menu: `Transform/TransformMenu.tsx` (`ModalType.StringToWordVector`), `Transform/TransformRegistry.ts`
(komponen + kontainer `"sidebar"`).

### C.2 Struktur file

| File | Tanggung jawab |
|---|---|
| `StringToWordVectorModal.tsx` | Kerangka panel, tab, footer, tampilan galat/loading. |
| `VariablesTab.tsx` | Daftar variabel teks + kotak Target Variable. |
| `OptionsTab.tsx` | Semua opsi; dipakai ulang (read-only) oleh tab **Text Preprocessing** Naive Bayes v2. Prop `columnPrefix` opsional (tidak ditampilkan di NB). |
| `config.ts` | `StwvConfig`, `STWV_DEFAULT_CONFIG`, `validateStwvConfig`, `applyFormulaStandard`, `toRustConfig`, `getVectorDecimals`. Diimpor NB v2. |
| `types.ts` | `VectorizerConfigPayload`, `VectorizerOutput`, `AppError`, enum metode. |
| `constants/formula-standards.ts` | Definisi tiga standar (opsi sah, label, rumus tooltip, default). |
| `constants/stopwords.ts` | Daftar stopword Indonesia dan Inggris. |
| `hooks/useStringToWordVector.ts` | State, worker (lazy), `runAndAddToDataset`, `addVectorColumns`, `reset`. |
| `stringToWord.processor.ts` | Web Worker; `init()` WASM sekali; galat dinormalkan. |
| `utils/buildDocuments.ts` | Sel → dokumen (`null`/`undefined` → `""`), `areAllDocumentsEmpty`, `EMPTY_DATA_ERROR`. |
| `utils/buildColumnData.ts` | Matriks → kolom dataset (nama unik via `processVariableName`). |
| `utils/columnPrefix.ts` | `DEFAULT_COLUMN_PREFIX`, `validateColumnPrefix`. |
| `utils/normalizeWorkerError.ts` | Galat apa pun → `{code, message}`. |
| `utils/resolveVariable.ts` | Mencari ulang variabel (id → tempId → name). |
| `utils/buildStwvOutput.ts`, `utils/writeStwvOutput.ts` | Menyusun dan menulis tabel Output Viewer. |
| `rust/` | Pembungkus WASM (`process_text_data`); dependensi `statify-text-core` via path. |
| `wasm-output/` | Hasil `wasm-pack` (dibuat manual oleh pemilik). |
| `__tests__/` | Test jest unit. |

CORE (`frontend/public/workers/TextAnalytics/statify-text-core/src/`):

| File | Isi |
|---|---|
| `config.rs` | `TextVectorizerConfig` + enum (`snake_case`, alias nilai lama: TF `none`→binary, `log`→sublinear; IDF `idf`→standard). |
| `error.rs` | `TextError { code, message }`. |
| `validator.rs` | Validasi dokumen, rentang (`ngram` 1..5), kombinasi rumus per standar. |
| `tokenizer.rs`, `stopwords.rs`, `stemmer.rs`, `ngram.rs` | Tahap pipeline. Regex kosong → fallback `[\s\p{P}]+`. |
| `pipeline.rs` | `prepare(cfg)` → `Pipeline`, `tokens_batch`. |
| `vectorizer.rs` | `fit_tokens` (kosakata, df satu lintasan), TF/IDF/normalisasi, CSR, `output_from_model`. |
| `model.rs` | `TextVectorizerModel` (resep), `CsrMatrix`, `fit`, `transform`, `fit_transform`. |
| `nb_text.rs` | Likelihood Naive Bayes untuk teks (dipakai NB v2/AM v2, bukan STWV). |

### C.3 Kontrak konfigurasi (TS → Rust)

`toRustConfig(config: StwvConfig)` menghasilkan JSON snake_case (`PLAN_FIX.md` §3.1):

```ts
{
  lowercase: boolean,
  stemming_method: "none" | "indonesian" | "english",
  stopwords_method: "none" | "indonesian" | "english" | "custom",
  custom_stopwords: string | null,   // JSON array string daftar final; null bila method none
  delimiters: string,                // regex
  ngram_min: number, ngram_max: number,   // mode Word dipaksa 1..1
  formula_standard: "weka" | "sklearn" | "custom",
  tf_method: "binary" | "raw" | "log1p" | "sublinear" | "normalized",
  idf_method: "none" | "standard" | "smooth" | "plus1",
  normalization: "none" | "l1" | "l2" | "doc_length",
  words_to_keep: number,             // 0 = semua
  min_term_freq: number              // >= 1
}
```

Validasi dilakukan dua lapis: `validateStwvConfig` (TS, pesan Bahasa Indonesia, menonaktifkan OK) dan
`validator.rs` (Rust, `INVALID_CONFIG`). Nilai enum tak dikenal ditolak (tidak ada *fallback* diam-diam).

### C.4 Kontrak keluaran dan galat

Sukses (worker → UI): `{ status: "success", payload: VectorizerOutput }`

```json
{ "vocabulary": ["makan","nasi","saya","suka","tidak"],
  "matrix": [[1,1,1,1,0],[0,1,1,1,1],[3,0,0,0,0]],
  "stats": { "total_documents": 3, "empty_documents": 0, "vocabulary_size": 5,
             "formula_standard": "weka", "method": "TF: raw, IDF: none, Norm: none, Keep: 1000, MinFreq: 1" } }
```

Gagal: `{ status: "error", payload: { code, message } }`. Rust melempar **objek JS** `{code, message}`
(`serde_wasm_bindgen`); `normalizeWorkerError` juga menangani string JSON dan `Error` init WASM.
Kode Rust: `EMPTY_INPUT`, `INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, `EMPTY_VOCABULARY`, `INVALID_DATA`,
`SERIALIZE_ERROR`. Kode TS: `EMPTY_DATA`, `INVALID_COLUMN_NAME`, `VARIABLE_NOT_FOUND`, `SAVE_FAILED`, `WORKER_ERROR`,
`INTERNAL_ERROR`.

### C.5 API CORE (dipakai NB v2 dan AM v2)

```rust
pub fn prepare(cfg: &TextVectorizerConfig) -> Result<Pipeline, TextError>;
pub fn fit(docs: &[String], cfg: &TextVectorizerConfig) -> Result<TextVectorizerModel, TextError>;
pub fn transform(model: &TextVectorizerModel, docs: &[String]) -> Result<CsrMatrix, TextError>;
pub fn fit_transform(docs: &[String], cfg: &TextVectorizerConfig) -> Result<(TextVectorizerModel, CsrMatrix), TextError>;

pub struct TextVectorizerModel {          // "resep", Serialize + Deserialize
    pub recipe_version: String,           // "1.0"
    pub config: TextVectorizerConfig,
    pub resolved_stopwords: Vec<String>,  // final, lowercase, unik, alfabetis
    pub vocabulary: Vec<String>,          // urutan kolom
    pub idf: Vec<f64>,                    // 1.0 bila idf none
    pub doc_freq: Vec<u32>,
    pub n_docs: u32,
    pub avg_doc_norm: Option<f64>,        // hanya doc_length
}
pub struct CsrMatrix { pub n_rows: usize, pub n_cols: usize,
                       pub indptr: Vec<usize>, pub indices: Vec<u32>, pub data: Vec<f64> }
```

`transform` hanya membaca resep (tidak menghitung ulang df/IDF/avg_norm); kata di luar kosakata diabaikan. STWV
sendiri memanggil `fit_transform` lalu membuang resep (keputusan D3). `serde_json` CORE memakai fitur
`float_roundtrip` agar f64 pada resep kembali identik bit-per-bit setelah disimpan sebagai JSON.

### C.6 Penulisan kolom ke dataset

`addVectorColumns` (hook):

1. `buildColumnData(output, resolveName, prefix)`: nama dasar `prefix + term`, dirapikan dan dibuat unik oleh
   `processVariableName` terhadap variabel yang ada + nama yang sudah diklaim; nilai kolom `j` = `matrix[i][j]`.
2. `dataStore.checkAndSave()` lalu `addVariableColumns(...)` (pengosongan `pendingUpdates` mencegah kolom hilang
   setelah muat ulang).
3. `registerVariableMetadata`: `NUMERIC`, `scale`, `width 8`, `columns 64`, `align right`, `role input`, desimal dari
   `getVectorDecimals`, label `Vector of "term"`.
4. `loadVariables()` untuk menyegarkan UI.

Sebelum worker dijalankan, hook juga memanggil `checkAndSave()` agar edit sel tertunda ikut terbaca, dan
`resolveVariable` untuk memastikan variabel masih ada.

### C.7 Test

| Lapisan | Lokasi | Jumlah |
|---|---|---|
| Rust CORE | `frontend/public/workers/TextAnalytics/statify-text-core/tests/` | `characterization` 15, `s2_pipeline` 16, `s3_formulas` 25, `s4_fit_transform` 22, `nb_text` 13 (total 91) |
| Jest | `StringToWordVector/__tests__/` | `buildDocuments`, `normalizeWorkerError`, `buildColumnData`, `config`, `columnPrefix`, `buildStwvOutput` |

```bash
# Rust
cd frontend/public/workers/TextAnalytics/statify-text-core && cargo test
# Jest: jalankan dari folder frontend (jest.config.ts di root repo usang)
cd frontend && npx jest components/Modals/Transform/StringToWordVector --coverage=false
```

### C.8 Build WASM

```bash
cd frontend/components/Modals/Transform/StringToWordVector/rust
wasm-pack build --target web --out-dir ../wasm-output --release   # sama dengan blok STWV di build-wasm.sh
```

`build-wasm.sh` di root repo memuat blok STWV. Hasil (`wasm-output/statify_string_to_word*.{js,wasm,d.ts}`) diimpor
langsung oleh worker. Jangan menyalin `.gitignore` hasil build (berisi `*`).

### C.9 Keputusan desain penting (PLAN_FIX §0)

| ID | Keputusan |
|---|---|
| D3 | STWV tidak menyimpan/menampilkan resep; resep hanya untuk NB v2/AM v2. |
| D4 | Sel kosong tidak dibuang; menjadi vektor nol agar baris sejajar. |
| D5 | Tiga standar rumus (Weka, scikit-learn, Custom). |
| D6 | Default Weka / raw / none / none. |
| D7 | Words to Keep 0 = semua; rangking total kemunculan. |
| D8 | Min term frequency. |
| D10 | Keluaran ke UI tetap dense; CSR untuk konsumen Rust. |
| D11 | Build WASM manual oleh pemilik. |

### C.10 Hubungan dengan modul lain

- **Naive Bayes v2** mengimpor `OptionsTab.tsx` dan `config.ts` (read-only) untuk tab Text Preprocessing dan memakai
  CORE `fit/transform` untuk jalur Raw Text. Kolom hasil STWV dapat dimasukkan ke slot **Word-Vector Variables**.
- **Apply Model v2** memakai CORE `transform` dengan resep dari model Naive Bayes jalur Raw Text.
- Ketiganya berbagi crate CORE lewat path dependency, sehingga pra-pemrosesan teks identik di semua menu.
