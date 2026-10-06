# Pengembangan Modul "String to Word Vector"

Dokumen ini melacak sejarah pengembangan, arsitektur, dan ringkasan fitur komponen klasifikasi teks `StringToWordVector` pada aplikasi Statify.

## 📖 Apa itu "String to Word Vector"?

**String to Word Vector** adalah metode ekstraksi fitur dalam *Natural Language Processing* (NLP) yang diperuntukkan bagi Statify guna mengubah memori teks mentah (kolom klasifikasi berbasis string) ke dalam format matriks vektor berwujud numerik. Karena mayoritas model *Machine Learning* (seperti Naive Bayes, Regression, dll) tidak dapat memproses huruf abjad, metode pembedah kata dan kalkulasi kemunculan (*Term Frequency / Inverse Document Frequency*) menjadi sebuah kewajiban.

Fitur ini melingkupi metode pra-pemrosesan teks standar:
1. **Lowercase**: Penyeragaman huruf kecil.
2. **Stopwords Removal**: Penghapusan kata tidak bermakna ganda secara statis (Bahasa Indonesia & Inggris) maupun custom kata.
3. **Stemming**: Pemotongan imbuhan dasar menggunakan adaptasi Sastrawi (Indonesia) dan Porter (Inggris).
4. **Tokenizer**: Ekstraksi berbasis kata dasar (*Word*) hingga rangkaian *N-Gram*.
5. **Vectorization**: Transformasi matriks via *TF, IDF, TF-IDF*, maupun biner matriks (0/1), dengan preset rumus Weka (default), scikit-learn, dan Custom serta opsi normalisasi baris (lihat "Status Terkini").

## 🧭 Status Terkini (setelah Tahap 1 / PLAN_FIX S1–S9)

Bagian ini menggantikan gambaran lama pada kronologi di bawah. Kronologi dipertahankan sebagai sejarah; bila ada perbedaan, bagian ini yang berlaku. Dokumen pendukung: `PLAN_FIX.md` (kontrak teknis), `AUDIT_REPORT.md` (temuan + status tindak lanjut), `plan-reports/S*.md` (laporan per fase), dan `frontend/public/workers/TextAnalytics/statify-text-core/README.md` (API crate inti).

### Arsitektur

```
[UI] StringToWordVectorModal.tsx   (footer: OK / Reset / Cancel)
   ├─ VariablesTab.tsx   → variabel teks sumber + "Vector Column Name" (default VEC_)
   └─ OptionsTab.tsx     → StwvConfig (config.ts): preset rumus, TF/IDF/Normalization,
        │                   Words to Keep, Min term frequency, n-gram 1..5, validasi
        │  state & orkestrasi: hooks/useStringToWordVector.ts
        ▼
utils/buildDocuments.ts   : null/undefined → "" (baris TIDAK dibuang, sejajar dataset)
        │  postMessage({data, config: toRustConfig(config)})
        ▼
[Worker aktif] stringToWord.processor.ts  → init() WASM dari wasm-output/ → process_text_data
        ▼
[Pembungkus WASM tipis] STWV/rust/src/lib.rs   (parse JSON → fit_transform → to_dense → serialize)
        ▼
[Crate inti] frontend/public/workers/TextAnalytics/statify-text-core  ("CORE", library Rust murni, tanpa wasm-bindgen)
   validator → Pipeline (regex, stopword, stemmer dibuat SEKALI) → tokenizer → stopwords
   → stemmer → n-gram → vectorizer (df satu pass) → TextVectorizerModel + CsrMatrix
        ▼  {vocabulary, matrix (dense), stats}
utils/buildColumnData.ts → addVariableColumns (kolom <prefix><kata>, label = kata asli)
utils/buildStwvOutput.ts + writeStwvOutput.ts → ringkasan ke Output Viewer
```

Catatan:
- Worker yang dipakai adalah `stringToWord.processor.ts`. Stub lama `public/workers/StringToWordVector/vectorizer.worker.js` sudah dihapus (S7).
- Modul `tokenizer`, `stopwords`, `stemmer`, `ngram`, `vectorizer`, `validator` kini berada di crate CORE (bukan lagi di `STWV/rust/src/`). CORE juga dirancang sebagai fondasi Naive Bayes v2 dan Apply Model v2 (Tahap 2); API `fit` / `transform` / `fit_transform` dan `TextVectorizerModel` ("resep") sudah tersedia di CORE, tetapi **STWV sendiri tidak menyimpan atau menampilkan resep** (keputusan D3).
- Output WASM ke UI tetap **matriks dense** (D10). Format sparse (CSR) hanya untuk konsumen Rust.
- Build WASM: `build-wasm.sh` sudah memuat blok STWV; hasil di `wasm-output/` dibuat manual oleh pemilik (D11).
- Error dari Rust berupa objek `{code, message}` dengan kode `EMPTY_INPUT`, `INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, `EMPTY_VOCABULARY`, `INVALID_DATA`, `SERIALIZE_ERROR`. UI menampilkannya sebagai `[KODE] pesan`.

### Preset rumus dan nilai default

Tiga preset ("Formula standard") menentukan opsi yang sah. Mengganti preset menerapkan default preset itu; **Custom** mempertahankan nilai saat ini dan menerima semua kombinasi. Kombinasi di luar tabel ditolak di UI dan di Rust (`INVALID_CONFIG`).

| Preset | TF yang sah | IDF yang sah | Normalisasi yang sah | Default saat dipilih |
|---|---|---|---|---|
| Weka (default) | binary, raw, log1p | none, standard | none, doc_length | raw / none / none |
| scikit-learn | binary, raw, sublinear | none, smooth, plus1 | none, l2, l1 | raw / smooth / l2 |
| Custom | semua | semua | semua | nilai yang sedang dipilih |

**Default baru (D6):** preset Weka, TF = Word count (raw), IDF = None, Normalisasi = None. Opsi lain: lowercase ON, stopwords None, stemming None, tokenizer Word, delimiter `[\s.,;:'"()?!]+`, Words to Keep 1000, Min term frequency 1. Perhatian: ini mengubah angka default dibanding versi sebelum Tahap 1 (dulu TF log + IDF smooth).

### Rumus (dikunci, PLAN_FIX §3.2)

Notasi: `c` = jumlah kemunculan term di dokumen, `T(d)` = jumlah token dokumen setelah preprocessing (termasuk n-gram, sebelum pemangkasan kosakata), `N` = jumlah dokumen, `df` = jumlah dokumen yang memuat term.

| Komponen | Nama | Rumus |
|---|---|---|
| TF | binary | `1` bila c > 0, selain itu 0 |
| TF | raw (word count) | `c` |
| TF | log1p (Weka TFTransform) | `ln(1 + c)` |
| TF | sublinear (sklearn) | `1 + ln(c)` bila c > 0, selain itu 0 |
| TF | normalized | `c / T(d)` (0 bila T(d) = 0) |
| IDF | none | `1` |
| IDF | standard (Weka) | `ln(N / df)` |
| IDF | smooth (sklearn default) | `ln((1 + N) / (1 + df)) + 1` |
| IDF | plus1 (sklearn `smooth_idf=False`) | `ln(N / df) + 1` |
| Normalisasi | l2 | `v / ‖v‖₂` |
| Normalisasi | l1 | `v / Σ\|v\|` |
| Normalisasi | doc_length (Weka normalizeDocLength) | `v · avg_norm / ‖v‖₂`; `avg_norm` = rata-rata `‖v‖₂` dokumen dengan norma > 0 |

Urutan nilai sel: `TF → × IDF → normalisasi`. Baris dengan norma 0 tetap nol (tidak ada NaN/Inf).

Alias nilai lama pada JSON konfigurasi masih diterima Rust: TF `none` → binary, TF `log` → sublinear, IDF `idf` → standard.

### Pemilihan kosakata (saat fit)

1. Kumpulkan semua term beserta total kemunculan (raw count) dan df.
2. Buang term dengan total kemunculan `< Min term frequency` (D8).
3. Bila Words to Keep > 0 dan jumlah term lebih banyak, rangking lalu ambil teratas: preset Weka dan scikit-learn merangking berdasarkan **total kemunculan** (menurun), seri diurutkan alfabetis; preset Custom memakai skor lama Σ TF×IDF (D7). Words to Keep `0` = simpan semua kata.
4. Kolom akhir diurutkan alfabetis (byte-wise). df/IDF dihitung hanya untuk kosakata akhir.
5. Bila kosakata kosong → error `EMPTY_VOCABULARY`.

### Perilaku sel teks kosong (D4)

Sel teks `null`, kosong, atau hanya spasi **tidak dibuang**: ia menjadi **vektor nol** dan barisnya tetap sejajar dengan dataset (label kelas tidak bergeser). Begitu pula dokumen yang seluruh token-nya terbuang (stopword, `Min term frequency`, atau Words to Keep). Error `EMPTY_INPUT` hanya muncul bila array dokumen kosong atau **semua** dokumen kosong.

### Alur UI

- Tab Variables: pilih satu variabel teks dan isi **Vector Column Name** (awalan kolom, default `VEC_`; divalidasi, maks. 32 karakter). Nama kolom akhir = awalan + kata; nama dibuat unik dan aman oleh penamaan variabel Statify, sedangkan *label* kolom menyimpan kata aslinya.
- Tab Options: preset rumus, TF/IDF/Normalization, Words to Keep (0 = semua), Min term frequency, n-gram (di-clamp 1..5, tombol OK nonaktif + pesan bila tidak valid), stemming (dengan catatan bahwa stemming selalu lowercase).
- **OK** menjalankan STWV, menambahkan kolom ke dataset, menulis ringkasan ke Output Viewer (Processing Summary, Settings, Vocabulary), lalu menutup modal. **Reset** mengembalikan modal ke keadaan awal. Karena hasil langsung ditulis, tidak ada tombol terpisah "Add to dataset" sehingga kolom ganda tidak dapat terjadi.
- Kolom vektor disimpan dengan 0 desimal bila nilainya pasti bilangan bulat (TF binary/raw tanpa IDF dan tanpa normalisasi); selain itu 4 desimal (nilai tersimpan utuh, hanya tampilan yang dibulatkan).

### Test

- Rust (crate CORE, `cargo test`): `characterization` 15, `s2_pipeline` 16, `s3_formulas` 25, `s4_fit_transform` 22 (total 78), memuat angka acuan (golden) PLAN_FIX §3.6 untuk preset Weka dan scikit-learn.
- TypeScript (`npx jest frontend/components/Modals/Transform/StringToWordVector`): `buildDocuments`, `normalizeWorkerError`, `buildColumnData`, `config`, `columnPrefix`, `buildStwvOutput`.
- Perintah lengkap ada di `plan-reports/S9.md`.

### ⚠️ Batasan yang diketahui

(a) **STWV tidak menyimpan resep.** Menjalankan STWV ulang pada data baru menghasilkan kosakata/IDF/normalisasi yang dihitung dari data baru itu, sehingga kolom dan skalanya tidak sebanding dengan data latih. Untuk prediksi data baru dengan IDF/normalisasi yang konsisten, gunakan jalur Raw Text di Naive Bayes (bagian Tahap 2 / NB v2, lihat `naive-bayes/AGENTS_V2.md`; jalur ini belum tersedia sebelum Tahap 2 selesai).

(b) **Kosakata dan IDF dihitung dari seluruh dataset sebelum validasi Naive Bayes** (holdout/k-fold). Kata yang hanya muncul di data uji ikut menjadi fitur dan IDF memuat informasi data uji, sehingga evaluasi dapat sedikit optimis. Cantumkan sebagai keterbatasan metodologi bila metrik dilaporkan.

(c) **Words to Keep memotong secara ketat (truncate).** Bila beberapa term berskor sama di batas, hanya sebagian yang diambil (urutan alfabetis menentukan). Weka menyimpan *semua* term yang seri sehingga jumlah kolom Weka bisa melebihi Words to Keep.

(d) **Stemming selalu lowercase.** Stemmer (Sastrawi dan Snowball English) memaksa token menjadi huruf kecil, sehingga opsi Lowercase = off tidak berlaku saat stemming aktif. UI menampilkan catatan ini.

(e) **Daftar stopword bawaan memuat kata negasi** (mis. `tidak`, `bukan`, `belum`, `jangan`, `kurang`, `not`, `no`) dan beberapa kata sentimen/domain (`baik`, `good`, dst.). Ini sesuai keputusan pemilik (D2) dan **tidak diubah**; untuk analisis sentimen, pertimbangkan metode stopwords `None` atau daftar custom tanpa negasi.

Batasan tambahan yang perlu diketahui (bukan bagian butir a–e):
- Words to Keep bersifat global; tidak ada pemilihan per kelas (D2).
- Output ke UI berupa matriks dense; dataset sangat besar (puluhan ribu dokumen × ribuan kata) dapat berat di memori (D10).
- Tokenizer berbasis delimiter tidak memecah/membersihkan URL, mention, hashtag, atau angka berulang (mis. `seolah2`); tidak ada preset tokenizer tweet.
- Label UI "English (Porter)" sebenarnya Snowball English (Porter2).

---

---

## 📅 Kronologi & Status Pengembangan
*Branch yang digunakan: `Dija`*

### ✅ Fase 1: Registrasi Modal (100% Selesai)
Fase ini berfokus pada integrasi *routing* dan menu dropdown dalam ekosistem kerangka dasar Statify.
- Pendaftaran identifier `StringToWordVector` pada tipe komponen Modal utama (`modalTypes.ts`).
- Pengelompokan Modal pada kategori transformasi agar dikenali oleh Sidebar Container.
- Injeksi menu klik pada `TransformMenu.tsx`.
- Pendaftaran komponen nyata ke dalam `TransformRegistry.ts` menggunakan target `container: "sidebar"`.

### ✅ Fase 2: Pembangunan UI & Worker Skeleton (100% Selesai)
Fase arsitektural antarmuka pengguna *(User Interface)* berlandaskan arsitektur React-Tailwind.
- Implementasi desain arsitektur modular dengan struktur layout *"2-Tabs"* layaknya fitur `BinaryLogistic`.
- Pembuatan sub-komponen pemilihan kolom variabel berbasis filter nominal `VariablesTab.tsx`.
- Pembuatan antarmuka seluruh parameter konfigurasi algoritma teks `OptionsTab.tsx` yang bersifat responsif *(Radio buttons, min-max input)*.
- Pengikatan *state management* (Data flow ekosistem variabel & opsi UI) secara menyeluruh melalui Hook `useStringToWordVector.ts`.
- Penyusunan kerangka file ekstrusi `vectorizer.worker.js` (Web Worker) yang meminimalisir interupsi *thread* utama JavaScript dalam perlintasan RAM.
  - *Catatan Tahap 1:* `vectorizer.worker.js` hanyalah stub dan sudah dihapus (S7). Worker yang aktif adalah `stringToWord.processor.ts`.

### ✅ Fase 3: Pembuatan Mesin Rust & WebAssembly (100% Selesai)
Fase pembuatan mesin inti yang mengeksekusi ekstraksi dengan kecepatan native.
- **[Selesai]** Inisialisasi Environment: Pembuatan manifest dependensi `Cargo.toml`.
- **[Selesai]** Skeleton WASM Bindgen: Pembuatan fungsi inti pengolah `process_text_data` dan struct spesifikasi `VectorizerConfig` di `src/lib.rs`.
- **[Selesai]** Pipeline **Tokenisasi** di `src/tokenizer.rs`.
- **[Selesai]** Penyusunan map **Stopwords** di `src/stopwords.rs`.
- **[Selesai]** Logic engine pemisah sintaks **Stemming** di `src/stemmer.rs`.
- **[Selesai]** Logic utama pengumpul statistik matriks kata di `src/vectorizer.rs`.
- *Catatan Tahap 1:* modul `tokenizer`, `stopwords`, `stemmer`, `ngram`, `vectorizer`, `validator` kini berada di crate `frontend/public/workers/TextAnalytics/statify-text-core` (CORE); `STWV/rust/src/lib.rs` hanya pembungkus WASM tipis. Rumus vektorisasi lama pada kronologi ini sudah digantikan oleh tabel rumus di "Status Terkini".

### ✅ Fase 4: Integrasi & Build Automation (100% Selesai)
Fase integrasi hasil rakitan Rust kembali kepada Statify.
- **[Selesai]** Pembaruan skrip otomatis `build-wasm.sh` untuk menerjemahkan kode karat menjadi memori `.wasm`.
  - *Catatan Tahap 1:* blok STWV pada `build-wasm.sh` baru benar-benar ditambahkan di S7 (AUDIT_REPORT F15).
- **[Selesai]** Penyambungan fungsi Web Worker pemanggil `ArrayBuffer` dari berkas `wasm_bg.wasm`.
- **[Selesai]** Pengujian dan Unit Testing NLP Logics.
  - *Catatan Tahap 1:* pada saat fase ini ditulis belum ada test otomatis (AUDIT_REPORT F14). Test Rust dan jest baru ditambahkan pada Tahap 1 (S1–S6, S8); lihat bagian "Test".
- **[Selesai]** *End-to-End* output: Memastikan kalkulasi matriks berhasil menambahkan kolom baru ke dalam *DataGrid* utama pengguna Statify.

### ✅ Fase 5: Penambahan Fitur "Words to Keep" mirip WEKA (100% Selesai)
Fase optimasi dimensi kosakata dan penambahan opsi prioritas penyimpanan kata.
- **[Selesai]** UI Integration: Menambahkan opsi *Words to Keep* di bawah metode vektorisasi dengan nilai default 1000.
- **[Selesai]** Vektor/Matriks Penyesuaian Prioritas: Mengubah prioritas perangkingan kata yang disimpan berdasarkan metode yang dipilih (Boolean menggunakan Document Frequency, TF-IDF menggunakan rerata TF-IDF, Natural TF menggunakan frekuensi total).
- **[Selesai]** Rust WASM Update: Implementasi logika kalkulasi skor kepentingan kata, pengurutan, pemotongan kosakata (*truncation*), dan penyusunan ulang kolom secara alfabetis di `rust/src/vectorizer.rs`.
- **[Selesai]** Re-compile: Sukses kompilasi ulang WebAssembly untuk runtime client-side.

### ✅ Fase 6: Tahap 1 Perbaikan STWV (PLAN_FIX S1–S9)
Perbaikan berdasarkan `AUDIT_REPORT.md`; branch `dija-v2`. Ringkasan per fase (detail di `plan-reports/`):
- **[Selesai] S1** Ekstraksi crate CORE + characterization test.
- **[Selesai] S2** Pipeline sekali-inisialisasi, error sebagai objek `{code, message}`, enum konfigurasi, `INVALID_STOPWORDS`.
- **[Selesai] S3** Preset rumus (Weka/scikit-learn/Custom), normalisasi, `minTermFreq`, Words to Keep 0 = semua, df satu pass.
- **[Selesai] S4** API `fit` / `transform` / `fit_transform`, `TextVectorizerModel` (resep), `CsrMatrix` (untuk Tahap 2).
- **[Selesai] S5** Perbaikan hook (baris kosong tidak dibuang, normalisasi error, reset hasil), `config.ts`, `types.ts`.
- **[Selesai] S6** OptionsTab: preset, Min term frequency, validasi n-gram.
- **[Selesai] S7** Blok STWV di `build-wasm.sh`, stub worker dihapus.
- **[Selesai] S8** Build WASM + uji manual oleh pemilik; alur UI disederhanakan (OK / Reset / Cancel, Vector Column Name, ringkasan di Output Viewer).
- **[Selesai] S9** Verifikasi lintas laporan dan dokumentasi ini.

