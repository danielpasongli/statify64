# AUDIT REPORT — StringToWordVector (Statify)

Tanggal audit: 2026-10-03 · Branch: `main` (HEAD `ac678360`) · Mode: **read-only** (tidak ada file lain yang diubah).

Notasi path:
- `STWV/` = `frontend/components/Modals/Transform/StringToWordVector/`
- `NB/` = `frontend/components/Modals/Analyze/Classify/naive-bayes/`
- `AM/` = `frontend/components/Modals/Analyze/Classify/apply-model/`

File di luar cakupan yang dibaca (beserta alasannya): `frontend/stores/useDataStore.ts` (`getVariableData`, `addVariableColumns`: cara kolom vektor ditulis ke dataset), `frontend/stores/useVariableStore.ts` (`processVariableName`: penamaan kolom `VEC_*`), `frontend/hooks/useVariable.ts` (`parseCellValue`: cara NB membaca sel), `build-wasm.sh` (klaim README), `frontend/public/workers/StringToWordVector/vectorizer.worker.js` (disebut di README), `dataset_untuk_text/*` (domain data uji).

---

## 1. Ringkasan eksekutif

Pipeline inti STWV (tokenize → stopword → stem → n-gram → TF/IDF → words-to-keep) berjalan di Rust/WASM dalam Web Worker. Rumusnya sebagian besar benar dan hasilnya deterministik. Masalah terbesarnya ada di **integrasi dengan dataset, Naive Bayes, dan Apply Model**, bukan di matematika vektornya. Lima risiko terbesar:

1. **Baris bergeser (Critical):** dokumen kosong/null dibuang sebelum vektorisasi, padahal matriks ditulis ulang mulai dari baris 0. Akibatnya vektor tidak lagi sejajar dengan label kelas.
2. **Pipeline tidak tersimpan (Critical):** kosakata, IDF, dan opsi tidak disimpan di mana pun. Apply Model tidak bisa mentransformasi teks baru secara identik, jadi alur "latih → terapkan ke data baru" tidak valid untuk teks.
3. **NB Gaussian + variance floor 1e-9 pada fitur kata yang jarang (High):** satu kata yang tidak pernah muncul di suatu kelas memberi log-likelihood ≈ −5×10⁸. Kata itu mendominasi prediksi sendirian.
4. **Error dari Rust tidak tampil (High):** Rust mengirim error sebagai *string* JSON, sedangkan UI membacanya sebagai objek `{code, message}`. Yang tampil hanya `[]` dan pesan kosong.
5. **Kebocoran data & stopword merusak sentimen (High):** kosakata, IDF, dan pemilihan kata dihitung dari seluruh data sebelum split NB. Selain itu, stopword bawaan membuang negasi (`tidak`, `bukan`, `not`, `no`), padahal dataset uji proyek adalah sentimen.

Test otomatis untuk STWV: **tidak ada** (baik TS maupun Rust), padahal README menyatakan unit testing "Selesai".

---

## 2. Peta arsitektur singkat

```
[UI] StringToWordVectorModal.tsx
   ├─ VariablesTab.tsx        → pilih 1 variabel (type STRING atau measure nominal)
   └─ OptionsTab.tsx          → config (lowercase, stopwords, stemming, tokenizer, delimiters, TF, IDF, wordsToKeep)
        │  state & orkestrasi: hooks/useStringToWordVector.ts
        ▼
runVectorizer():  getVariableData(var) → filter null/"" (!) → String() → rustConfig
        │  postMessage({data, config})
        ▼
[Worker] stringToWord.processor.ts → init() WASM → process_text_data(data, config)
        ▼
[Rust] lib.rs: validator → compile_regex (1x) → per dokumen:
        tokenizer (lowercase opsional) → stopwords::filter (parse JSON per dok)
        → stemmer::stem (Dictionary::new per dok) → ngram::generate
     → vectorizer.rs: vocab BTreeSet (A–Z) → [words_to_keep: skor Σtf×idf, truncate, sort A–Z]
        → df → idf → matriks dense N×V (Vec<Vec<f64>>)
        ▼  {vocabulary, matrix, stats}
saveToDataset(): kolom `VEC_<term>` (processVariableName) → dataStore.addVariableColumns
     (ditulis per rowIndex 0..N-1) → registerVariableMetadata (NUMERIC, scale)
        ▼
[NB] naive-bayes: VEC_* = covariate "scale" → Gaussian NB (variance floor 1e-9);
     kolom teks asli (STRING/nominal) ikut jadi factor bila mode "exclude"
     → Export JSON schema 1.1 (features, mean/variance, …) — TANPA metadata vektorisasi
        ▼
[AM] apply-model: muat JSON → auto-map fitur ke variabel dataset BERDASARKAN NAMA
     → scoring Rust. Tidak ada langkah transformasi teks. Pengguna harus menjalankan STWV
       ulang di data baru (kosakata/IDF baru, nama kolom bisa berbeda).
```

---

## 3. Tabel temuan

Urutan berdasarkan severity. Usaha: S (< ½ hari), M (1–2 hari), L (> 2 hari).

| ID | Sev | Kat | Lokasi | Deskripsi | Dampak / skenario konkret | Bukti | Rekomendasi | Usaha | Status |
|---|---|---|---|---|---|---|---|---|---|
| F01 | **Critical** | B,C | `STWV/hooks/useStringToWordVector.ts:118-120`, `useDataStore.ts` `addVariableColumns` (±L466-469) | Nilai null/undefined/`""` dibuang sebelum dikirim ke Rust. Matriks hasilnya (N' < N baris) ditulis ke dataset per `rowIndex` mulai 0. | Dataset 5 baris dengan teks baris 3 kosong. Vektor dok-4 masuk ke baris 3, vektor dok-5 ke baris 4, dan baris 5 berisi `""`. Label `Sentiment` baris 3–5 dipasangkan dengan vektor yang salah, sehingga model NB dan metriknya keliru **tanpa ada peringatan**. | `.filter((v): v is string \| number => v !== null && v !== undefined && v !== "")` lalu `values: result.matrix.map(row => row[colIndex])`. Di store: `const value = colData.values?.[rowIndex] ?? "";` | Jangan buang baris. Kirim `""` untuk sel kosong (Rust sudah menghasilkan baris nol) **atau** simpan `rowIndexMap` lalu tulis per indeks asli. Validasi "semua kosong" cukup dilakukan di Rust (`validator.rs:17`). | S | TERVERIFIKASI |
| F02 | **Critical** | B,H | `STWV/hooks/useStringToWordVector.ts:201-259`; `NB/rust/src/stats/save.rs:147-167`; `AM/AGENTS.md` §3.4 | Konfigurasi pipeline (opsi, kosakata terurut, nilai IDF/df, N) tidak disimpan, baik di metadata variabel, di dataset, maupun di export model NB. Apply Model hanya memetakan fitur berdasarkan nama. | Data baru harus di-vektorisasi ulang dengan STWV. Akibatnya (a) kosakata baru berbeda, sehingga fitur model yang tidak ada di data baru membuat mapping `AM_E_MAP_UNMAPPED` memblokir proses; (b) IDF dihitung dari data baru, sehingga skala nilai berbeda dari data latih; (c) words-to-keep memilih kata lain. Hasil prediksi tidak sebanding dengan evaluasi. | `ExportedModel { schema_version, model_type, trained_at, target, features, smoothing_alpha, variance_floor, feature_order, label_mapping, validation_config, missing_value_policy, unseen_category_policy }`, tanpa field vektorisasi. `saveToDataset` hanya menulis kolom + `label: Vector of "${term}"`. | Tambahkan artefak **"text vectorizer model"** (`{version, config, vocabulary[], idf[], n_docs, source_variable, column_names[]}`). Simpan saat `saveToDataset` (mis. di result store/IndexedDB), lalu sediakan mode **"Apply fixed dictionary"** di STWV (setara Weka `FixedDictionaryStringToWordVector`) yang memakai kosakata dan IDF dari data latih. Idealnya NB export memuat `preprocessing` opsional agar AM bisa menjalankannya otomatis. | L | TERVERIFIKASI |
| F03 | **High** | B,A | `NB/rust/src/stats/numerical_distribution.rs:55-68`; `NB/rust/src/stats/prediction.rs:93-94`; `useStringToWordVector.ts:243` | Kolom VEC_* didaftarkan `measure: 'scale'`, sehingga NB memodelkannya sebagai **Gaussian**. Untuk kata yang tidak pernah muncul di kelas c, mean=0 dan var=max(0, 1e-9)=1e-9. Data seperti ini sparse dan non-negatif, jadi tidak cocok dengan asumsi Gaussian. | Simulasi: x=1 pada kata itu memberi `−0.5·ln(2π·1e-9) − 1/(2·1e-9) ≈ −499 999 990.6`, sedangkan x=0 memberi `+9.44`. Satu kata langka di dokumen uji langsung "memveto" kelas itu. Ini berlaku di evaluasi holdout/k-fold maupun di Apply Model. | `variance: raw_variance.max(variance_floor)`; `-0.5 * (2.0 * PI * variance).ln() - (x - mean).powi(2) / (2.0 * variance)`; `measure: 'scale' as const` | Jangka pendek: dokumentasikan agar output Boolean dipakai dan kolom diset `nominal` (menjadi Categorical NB, mirip Bernoulli), atau opsi STWV "output measure = nominal" untuk mode Boolean. Jangka menengah: varian **Multinomial NB** untuk count/TF-IDF, atau minimum std ala Weka (precision-based), dengan revisi `NB/AGENTS.md` §5.3 karena dokumen tersebut mengunci rumus. | M–L | TERVERIFIKASI (kode + simulasi) |
| F04 | **High** | E,F | `STWV/rust/src/error.rs:22-26`; `stringToWord.processor.ts:37-40`; `useStringToWordVector.ts:176-180`; `StringToWordVectorModal.tsx:86-87` | `AppError::to_js()` mengembalikan `JsValue::from_str(json)` (string). Worker meneruskan string itu apa adanya, lalu hook melakukan cast ke `AppError`. | Semua error Rust (`EMPTY_VOCABULARY`, `INVALID_CONFIG` n-gram min>max, `INVALID_REGEX` delimiter) tampil sebagai `[]` dengan pesan kosong. Pengguna tidak tahu apa yang salah. Error `init()` WASM (objek `Error`) juga tidak punya `code`. | `JsValue::from_str(&json)`; `self.postMessage({ status: 'error', payload: error });`; `setError(payload as AppError);` | Di worker: `const e = typeof error === 'string' ? safeJsonParse(error) : {code:'WASM_ERROR', message: String(error?.message ?? error)}`, atau di Rust kembalikan objek via `serde_wasm_bindgen::to_value(&self)`. Tambahkan fungsi pesan ramah pengguna seperti di NB. | S | TERVERIFIKASI (pembacaan kode) |
| F05 | **High** | A,B | `STWV/rust/src/vectorizer.rs:34-41, 53-132, 143-164` | Kosakata, df/IDF, dan seleksi `words_to_keep` dihitung dari **seluruh** dokumen sebelum NB membagi holdout/k-fold. | Kata yang hanya muncul di data uji ikut menjadi fitur, dan IDF memuat informasi data uji. Metrik evaluasi NB jadi bias optimis. Untuk skripsi, ini perlu disebut sebagai keterbatasan metodologi atau diperbaiki. | Loop `for doc_tokens in &processed` tanpa info split. | (a) Dokumentasikan secara eksplisit di UI/README. (b) Setelah F02: latih STWV di subset train, lalu apply fixed dictionary ke test. (c) Jangka panjang: "FilteredClassifier" (vektorisasi di dalam fold NB). | M–L | TERVERIFIKASI |
| F06 | **High** | A,F | `STWV/constants/stopwords.ts` (`INDONESIAN_STOPWORDS`, `ENGLISH_STOPWORDS`) | Daftar stopword berisi negasi dan kata sentimen: ID `tidak, bukan, belum, jangan, kurang, baik`; EN `not, no, nor, good`. Daftar EN (1298 kata) juga memuat kata domain seperti `computer, research, information, system, test, value, microsoft`. | Dataset uji proyek adalah sentimen (`dataset_tweet_sentiment_pilkada_DKI_2017`). "tidak puas" dan "puas" menjadi vektor yang sama, dan bigram tidak bisa menangkap negasi karena kata negasi sudah dibuang sebelum n-gram. | `grep` menemukan masing-masing 1× `"tidak"`, `"bukan"`, `"belum"`, `"jangan"`, `"kurang"`, `"baik"`, `"not"`, `"no"`, `"good"`. | Sediakan daftar "sentiment-safe" (tanpa negasi/intensifier) atau checkbox "Pertahankan kata negasi". Cantumkan sumber daftar (Tala? NLTK?) di file konstanta. | S | TERVERIFIKASI |
| F07 | **High** | B,E | `useStringToWordVector.ts:210-224`; `useVariableStore.ts:29-60` | Nama kolom `VEC_<term>` dibentuk lewat `processVariableName`: karakter non-ASCII/spasi jadi `_`, underscore/titik di akhir dibuang, dipotong 64 karakter, dan duplikat (case-insensitive) diberi sufiks `_1, _2` **berdasarkan urutan & variabel yang sudah ada**. | Apply Model melakukan auto-map **berdasarkan nama** (`AM/AGENTS.md` §3.4). Contoh: di data latih "café" → `VEC_caf`, "caf" → `VEC_caf_1`. Di data baru tanpa "café", "caf" → `VEC_caf`. Fitur model `VEC_caf` (café) ter-map ke kolom "caf" **tanpa error** (salah pasang senyap). Hal yang sama terjadi bila dataset baru sudah punya kolom `VEC_x`, atau saat "Tambahkan ke Dataset" diklik dua kali. | `processedName.replace(/[^A-Za-z0-9._@#$]/g, '_')`, `processedName.replace(/[._]+$/g, '')`, `uniqueName = \`${base}_${counter}\`` | Simpan mapping `term → column_name` di artefak vectorizer (F02) dan petakan AM melalui mapping tersebut, bukan lewat nama. Minimal: nama deterministik berbasis indeks (`VEC_0001`) + label = term. | M | TERVERIFIKASI (kode); skenario mis-mapping = analisis |
| F08 | Medium | D | `STWV/rust/src/lib.rs:80-98`; `stemmer.rs:14-18`; `stopwords.rs:19-29` | Plan (R3, Langkah 3) mengharuskan Dictionary Sastrawi & HashSet stopword dibuat **sekali**. Kode membuat `Dictionary::new()` + `Stemmer` **per dokumen** dan mem-parse JSON stopword (758/1298 kata) **per dokumen**. | Untuk N dokumen terjadi N kali parse JSON + N kali pembangunan HashSet + N kali inisialisasi kamus. Besarnya biaya `Dictionary::new()` belum diukur. | `let dict = sastrawi::Dictionary::new();` di dalam `stem()` yang dipanggil di closure `.map(\|doc\| …)`; `serde_json::from_str(json_str)` di dalam `filter()`. | Parse stopword dan buat stemmer sebelum loop, lalu teruskan referensinya. Tambah cache memo `HashMap<String,String>` untuk hasil stem. | S | TERVERIFIKASI (lokasi); dampak waktu = HIPOTESIS (perlu benchmark 1k/10k dok) |
| F09 | Medium | D | `vectorizer.rs:62-70, 85-103, 144-152, 166-194` | df dihitung dengan loop `vocabulary × dokumen` (O(N·V)), skor words-to-keep juga O(N·V_awal). Matriks dense `Vec<Vec<f64>>` dikirim ke JS sebagai array-of-arrays, lalu ditulis lagi kolom per kolom (`result.matrix.map(row => row[colIndex])` sebanyak V kali). | Contoh 10k tweet, V_awal≈30k: ~3×10⁸ lookup hash hanya untuk df+skor. Matriks 10k×1000 berisi 10⁷ angka JS (±80 MB+) dan disalin beberapa kali; `saveToDataset` berjalan di main thread. | `for (i, term) in vocabulary.iter().enumerate() { for doc_set in &doc_sets {` | Hitung df dalam satu pass per dokumen (iterasi token unik dok → `df[idx]+=1`). Hitung skor dari count map yang sama. Kirim output sparse (CSR: `indptr, indices, data`) atau `Float64Array` transferable. Bangun kolom di worker. | M | TERVERIFIKASI (kompleksitas); angka memori = HIPOTESIS |
| F10 | Medium | B | `NB/hooks/useNaiveBayesValidation.ts:53-58` | Mode `exclude` (default NB) memakai **semua** variabel non-`unknown` selain target. Kolom teks asli (STRING/nominal), `Id` (scale), dan kolom lain ikut menjadi prediktor. | Kolom teks menjadi factor dengan satu kategori per dokumen (overfit di training, unseen di evaluasi). `Id` menjadi Gaussian, sehingga model belajar dari urutan baris. Pengguna awam tidak sadar. | `return variables.filter((v) => v.measure !== "unknown").map((v) => v.name).filter((name) => name !== target && !excluded.has(name));` | Panduan di STWV/NB (atau peringatan di NB bila ada predictor STRING dengan kardinalitas ≈ N). Opsi STWV "set kolom sumber ke measure unknown/exclude". Perubahan di NB butuh revisi `NB/AGENTS.md`. | S–M | TERVERIFIKASI |
| F11 | Medium | A | `STWV/rust/src/lib.rs:87-88` | Bila parse stopword gagal, `unwrap_or_else(\|_\| vec![])` mengganti **seluruh token dokumen** dengan array kosong. Komentarnya menyebut "lewati filter". | Error stopword tertelan, lalu semua dokumen kosong sehingga muncul `EMPTY_VOCABULARY` dengan pesan menyesatkan. Saat ini laten karena frontend selalu memakai `JSON.stringify`. | `.unwrap_or_else(\|_\| vec![]); // fallback: lewati filter jika error parse` | Parse sekali di awal (F08) dan propagasikan `Err(INVALID_STOPWORDS)`. | S | TERVERIFIKASI |
| F12 | Medium | A,F,H | `stemmer.rs:21,29`; `OptionsTab.tsx:35-44`; Plan §1 | Stemmer selalu `.to_lowercase()`, sehingga opsi Lowercase=off diabaikan diam-diam saat stemming aktif. Plan mewajibkan "UI harus menampilkan peringatan ini", tetapi peringatan itu tidak ada. | Pengguna yang mematikan lowercase untuk NER tetap mendapat token lowercase. Selain itu, stopword hanya difilter **sebelum** stemming, sehingga hasil stem yang merupakan stopword tidak terbuang. | `stemmer.stem_word(&t.to_lowercase())`; tidak ada teks peringatan di OptionsTab. | Tampilkan catatan di UI. Opsional: re-filter stopword setelah stem. | S | TERVERIFIKASI |
| F13 | Medium | A,F | `vectorizer.rs:53-132`; `OptionsTab.tsx:240-246`; `useStringToWordVector.ts:160` | `wordsToKeep` bersifat global (tanpa per-class, tidak ada atribut kelas di UI), truncate ketat dengan tie-break alfabetis (Weka mempertahankan semua yang seri), dan tidak ada `minTermFreq`. Nilai 0/kosong dipaksa jadi 1000, sehingga "keep all" tidak mungkin dipilih. | Kelas minoritas kehilangan kata khasnya (Weka default per-class). Kata dengan skor sama di batas potong dibuang berdasarkan abjad (artefak). Nilai `idf` standar memberi skor 0 untuk kata yang muncul di semua dokumen, sehingga kata itu dibuang lebih dulu (perilaku ini tidak terdokumentasi). | `term_scores.truncate(words_to_keep);`, `parseInt(e.target.value) \|\| 1000`, `words_to_keep: config.wordsToKeep \|\| 1000` | Tambah opsi kelas (per-class), `minTermFreq`, dan "0 = semua". Pertahankan tie di batas (opsional, ikut Weka). | M | TERVERIFIKASI |
| F14 | Medium | G,H | Seluruh `STWV/`; `README.md` Fase 4 | Tidak ada satu pun test (tidak ada `#[cfg(test)]` di 8 file Rust, tidak ada `__tests__` TS, `git ls-files` tidak menemukan test terkait), padahal README berbunyi "[Selesai] Pengujian dan Unit Testing NLP Logics". | Regresi seperti F01/F04/F11 tidak akan tertangkap. | `git ls-files \| grep -i test \| grep -i "word\|vector\|stopword"` → kosong. | Lihat §7 untuk kasus uji konkret. | M | TERVERIFIKASI |
| F15 | Medium | H,E | `build-wasm.sh` (seluruh file); `README.md` Fase 4 | README menyatakan `build-wasm.sh` sudah diperbarui untuk STWV, padahal skrip hanya membangun Factor, TimeSeries, K-Means, Univariate, K-Medoids. `wasm-output/.gitignore` berisi `*` tetapi artefak di-*force add*. | Perubahan Rust bisa tidak ikut ter-build. Artefak saat ini (10-06-2026) **memuat** string `words_to_keep`, jadi kemungkinan sinkron, tetapi tidak ada mekanisme yang menjamin. | `grep -n "StringToWord" build-wasm.sh` → kosong; `.gitignore` = `*`. | Tambahkan blok `wasm-pack build --target web --out-dir ../wasm-output --release` di skrip. Bisa juga tambahkan fungsi `version()` di WASM yang dicek worker. | S | TERVERIFIKASI |
| F16 | Low | A,H | `vectorizer.rs:22-27` vs `:166-194`; `Rust_Implementation_Plan.md` R4, Langkah 6 | Doc-comment menyebut "Dilanjutkan dengan L2 normalization per baris", tetapi tidak ada normalisasi di kode. Plan (R4) meminta field `normalize: bool`, yang tidak ada di `VectorizerConfig`. | Klaim "kompatibel sklearn" tidak benar (sklearn default `norm='l2'`). Perbandingan di skripsi bisa keliru. | Tidak ada `sqrt`/`norm` di `vectorizer.rs`. | Implementasikan opsi `normalize: none \| l2 \| doc_length(Weka)` atau perbaiki komentar. | S | TERVERIFIKASI |
| F17 | Low | A | `vectorizer.rs:98,186` | Log TF memakai `1 + ln(c)` (SMART/sklearn sublinear), sedangkan Weka `TFTransform` memakai `log(1+f)`. IDF standar `ln(N/df)` membuat kolom kata yang ada di semua dokumen bernilai 0 semua. | Angka tidak bisa dibandingkan 1:1 dengan Weka meskipun UI "mirip Weka". Kolom nol ikut tersimpan dan memakan kuota words-to-keep (skor 0, terbuang paling akhir). | `"log" => if count > 0.0 { 1.0 + count.ln() }`, `"idf" => (n as f64 / d).ln()` | Dokumentasikan rumus di UI/README. Sediakan preset "Weka-compatible". | S | TERVERIFIKASI |
| F18 | Low | A,C | `useStringToWordVector.ts:55`; `tokenizer.rs:8-19` | Delimiter default `[\s.,;:'"()?!]+` (setara Weka) tidak memecah `- / # @ & … emoji`, URL, angka, atau "2" reduplikasi (`seolah2`). Apostrof sebagai delimiter memecah `don't` menjadi `don`, `t`, sehingga stopword `don't` tidak pernah cocok. | Pada data tweet, token seperti `#agussilvy`, `@sbyudhoyono`, `pmbenaran..jangan`(dipecah), dan `http…` membanjiri kosakata. Ini celah fitur, bukan bug. | Default di hook. | Sediakan preset tokenizer "tweet" (hapus URL/mention, normalisasi hashtag & angka-ulang) atau opsi regex token (bukan delimiter). | M | TERVERIFIKASI |
| F19 | Low | C,F | `OptionsTab.tsx:143-161`; `validator.rs:20-34` | Input n-gram tidak divalidasi di UI (atribut `max={10}` tidak menahan ketikan, `parseInt \|\| 1`). min>max baru ditolak Rust, dan errornya tidak tampil (F04). | max=50 menyebabkan ledakan jumlah n-gram/memori. min>max menghasilkan error kosong. | `parseInt(e.target.value) \|\| 1` | Clamp 1..5 dan validasi min≤max sebelum Run (pola `useXxxValidation`). | S | TERVERIFIKASI |
| F20 | Low | E,F | `useStringToWordVector.ts:41-61, 72-81, 201-259`; `StringToWordVectorModal.tsx:110-116` | Config tidak dipersist (modul lain memakai IndexedDB). `result` tetap ada setelah disimpan, sehingga tombol "Tambahkan ke Dataset" bisa diklik ulang dan menambah kolom duplikat `_1`. `selectedVariable` adalah snapshot, jadi bila kolom disisipkan/dihapus saat panel terbuka, `columnIndex` bisa basi. | Kolom ganda; berpotensi membaca kolom yang salah. | `setSelectedVariable(highlightedVariable)`; tidak ada `setResult(null)` setelah simpan. | Reset `result` setelah simpan, re-resolve variabel dari store berdasarkan `id` saat Run, dan persist config. | S | TERVERIFIKASI (duplikasi); kolom basi = HIPOTESIS (tergantung perilaku store saat insert kolom) |
| F21 | Low | E | `OptionsTab.tsx:10-13`; `useStringToWordVector.ts:12-25` vs `stringToWord.processor.ts:47-82` | `config: any`; tipe `VectorizerOutput`/`AppError` diduplikasi di dua file; metode TF/IDF berupa string bebas (Rust jatuh ke default diam-diam untuk nilai tak dikenal: `_ => count`, `_ => tokens`). | Typo nilai opsi tidak terdeteksi compiler maupun Rust. | `config: any`, `_ => count, // default raw` | Satu file `types.ts` dengan union literal. Rust memakai `enum` + `#[serde(rename_all)]` agar nilai tak dikenal ditolak. | S | TERVERIFIKASI |
| F22 | Low | F | `OptionsTab.tsx:190-193`; `vectorizer.rs:95,183` | Opsi TF "None" identik dengan "Boolean (0/1)" (`"none" \| "binary"`). | Dua opsi UI menghasilkan output yang sama, sehingga membingungkan saat menulis bab metodologi. | `"none" \| "binary" => if count > 0.0 { 1.0 } else { 0.0 }` | Hapus "None" atau ganti label menjadi "Presence (0/1)". | S | TERVERIFIKASI |
| F23 | Low | E,H | `frontend/public/workers/StringToWordVector/vectorizer.worker.js` | Worker stub mati (`result: []`) yang disebut README Fase 2. Worker yang dipakai adalah `STWV/stringToWord.processor.ts`. | Membingungkan pembaca/penguji. | `// Logic pemrosesan WASM akan ditambahkan di Langkah 4` | Hapus atau tandai deprecated, lalu perbarui README. | S | TERVERIFIKASI |

---

## 4. Ketidaksesuaian dokumen vs kode

| Dokumen | Klaim | Kode sebenarnya |
|---|---|---|
| `README.md` Fase 4 | `build-wasm.sh` sudah diperbarui untuk STWV | Tidak ada blok STWV di `build-wasm.sh` (F15) |
| `README.md` Fase 4 | "Pengujian dan Unit Testing NLP Logics" selesai | Tidak ada test sama sekali (F14) |
| `README.md` Fase 2 | Worker `vectorizer.worker.js` | Worker aktif `stringToWord.processor.ts`; file tersebut stub mati (F23) |
| `Rust_Implementation_Plan.md` R3 & Langkah 4 | Dictionary Sastrawi dibuat sekali di luar loop | Dibuat per dokumen (F08) |
| Plan Langkah 3 | HashSet stopword dibangun sekali | Parse JSON + HashSet per dokumen (F08) |
| Plan Langkah 3 (tabel error) | JSON stopword invalid → `AppError::InvalidStopwords` | Error ditelan lalu dokumen dikosongkan (F11) |
| Plan Langkah 7 & 8 | Error dikirim sebagai JSON `AppError` yang dapat ditampilkan Worker | Dikirim sebagai string; UI kosong (F04) |
| Plan §1 Lowercase | "UI harus menampilkan peringatan" stemmer memaksa lowercase | Tidak ada peringatan (F12) |
| Plan Langkah 6 | Metode: Binary, TF = count/total, IDF smooth sklearn, TF-IDF | Kode: TF {none, binary, raw, normalized, log} × IDF {none, idf, smooth}. Plan belum diperbarui |
| Plan R4 + doc-comment `vectorizer.rs` | L2 normalization (field `normalize`) | Tidak ada (F16) |
| Plan Langkah 6 | Kompatibel sklearn | Log TF `1+ln c` cocok dengan `sublinear_tf`, tetapi tanpa L2 hasilnya ≠ sklearn default (F16, F17) |
| `README.md` "mirip WEKA" | Words to Keep mirip Weka | Global (bukan per-class), tanpa minTermFreq, tie-break berbeda (F13) |
| `NB/AGENTS.md`, `AM/AGENTS.md` | Tidak menyebut STWV sama sekali | Alur teks → NB → AM tidak punya kontrak (F02, F03, F07) |

---

## 5. Fitur Weka StringToWordVector yang belum didukung

| Opsi Weka | Status di Statify | Prioritas untuk skripsi |
|---|---|---|
| Dictionary tetap / `FixedDictionaryStringToWordVector` / `dictionaryFile` | ❌ | **Tinggi**: syarat agar Apply Model valid (F02) |
| `doNotOperateOnPerClassBasis` + atribut kelas | ❌ (selalu global) | Tinggi bila kelas tidak seimbang (data sentimen) |
| `minTermFreq` | ❌ | Sedang (alat utama mengurangi noise tweet) |
| `normalizeDocLength` | ❌ | Sedang (TF-IDF tweet panjang bervariasi) |
| `TFTransform` = log(1+f) | ⚠️ beda rumus (`1+ln f`) | Rendah–Sedang (konsistensi bila dibandingkan dengan Weka) |
| `IDFTransform` = f·log(N/df) | ✅ ("Standard IDF") | — |
| `outputWordCounts` | ✅ (Natural TF) | — |
| `wordsToKeep` | ⚠️ global, truncate ketat | lihat F13 |
| `lowerCaseTokens` | ✅ (default ON, Weka default OFF) | — |
| `attributeIndices` (banyak kolom string sekaligus) | ❌ (1 variabel) | Rendah |
| `attributeNamePrefix` | ❌ (prefix `VEC_` hard-coded) | Rendah |
| `CharacterNGramTokenizer` | ❌ | Rendah |
| `periodicPruning` | ❌ | Rendah |
| Output sparse | ❌ (dense) | Sedang untuk skala ribuan dokumen (F09) |
| Stemmer/stopwords handler | ✅ (Sastrawi, Porter2 via `Algorithm::English`, daftar ID/EN/custom) | — |

Catatan: `rust_stemmers::Algorithm::English` adalah Snowball "English" (Porter2), bukan Porter klasik. Label UI "English (Porter)" sebaiknya diganti menjadi "English (Snowball/Porter2)".

---

## 6. Hal yang sudah baik (jangan diubah tanpa sengaja)

- Komputasi berat berjalan di **Web Worker + WASM**, sehingga UI tidak membeku saat vektorisasi (`stringToWord.processor.ts`, lazy init + `terminate` saat unmount).
- **Regex dikompilasi sekali** (`lib.rs:75`) dengan fallback bila kosong (`tokenizer.rs:25-29`).
- **Urutan pipeline benar**: n-gram dibuat setelah stemming (`lib.rs:91-94`).
- **Kosakata deterministik**: `BTreeSet` A–Z, dan tie-break skor alfabetis (`vectorizer.rs:35, 114-118`).
- IDF smooth benar secara rumus `ln((1+N)/(1+df))+1`, sehingga tidak ada pembagian nol. Normalized TF menjaga `total>0`.
- Validasi dasar Rust: dokumen kosong, semua whitespace, n-gram 0 atau min>max (`validator.rs`).
- Stopword dicocokkan **case-insensitive** tanpa mengubah token (`stopwords.rs:28,36`).
- Penamaan kolom memakai `processVariableName` (aman untuk SPSS, unik), dan **label** menyimpan term asli.
- Delimiter default identik dengan Weka `WordTokenizer`.
- Hasil simulasi 3 dokumen (lihat §7, T-F17) cocok dengan perhitungan manual.

---

## 7. Roadmap perbaikan & kasus uji

### Tahap 1 — Quick wins (≤ 2 hari)

| Perbaikan | Kasus uji yang disarankan |
|---|---|
| F01 Jangan buang baris kosong | **T1** data `["a b", null, "", "b c"]` → `matrix.length === 4`, baris 1 & 2 semua 0, dan setelah `saveToDataset` baris ke-3 dataset berisi vektor `"b c"`. **T2** semua `null` → error `EMPTY_INPUT` tampil. |
| F04 Error parsing | **T3** (jest, mock worker) payload `'{"code":"EMPTY_VOCABULARY","message":"x"}'` → UI menampilkan `[EMPTY_VOCABULARY]` dan `x`. **T4** Rust `ngram_min=3,max=2` → `code === "INVALID_CONFIG"`. **T5** delimiter `"[("` → `INVALID_REGEX`. |
| F11 Error stopword dipropagasi | **T6** Rust `custom_stopwords = Some("not json")` → `Err(INVALID_STOPWORDS)` (bukan `EMPTY_VOCABULARY`). |
| F08 Init sekali | **T7** benchmark `cargo bench`/`wasm` 5 000 dokumen dengan stemming ID: waktu sebelum vs sesudah. **T8** hasil identik sebelum/sesudah refactor (snapshot vocabulary + matrix). |
| F06 Daftar stopword | **T9** `"saya tidak suka"` dengan stopword ID → token `tidak` **dipertahankan** pada preset sentiment-safe. |
| F12, F19, F20, F22, F15, F23 | **T10** n-gram min>max → tombol Run disabled + pesan. **T11** klik "Tambahkan" 2× → kolom tidak terduplikasi. **T12** CI: `build-wasm.sh` menghasilkan `wasm-output/` tanpa diff. |

### Tahap 2 — Perbaikan inti (1–2 minggu)

| Perbaikan | Kasus uji yang disarankan |
|---|---|
| F02 + F07 Artefak vectorizer + mode "Apply fixed dictionary" | **T13** latih pada D_train = `["makan nasi","minum teh"]`, apply ke D_new = `["makan teh kopi"]` → kolom = kosakata latih persis (`makan, minum, nasi, teh`), `kopi` diabaikan (OOV), dan IDF memakai N=2 dari latih. **T14** D_new semuanya OOV → baris nol, tanpa error. **T15** urutan & nama kolom identik dengan artefak meskipun dataset baru sudah punya `VEC_teh`. |
| F03 Model NB yang cocok untuk teks | **T16** (Rust NB) fitur count, kelas A tidak pernah memuat kata w. Dokumen uji dengan w=1 dan 10 kata lain yang sangat mendukung A → prediksi tetap A (gagal di implementasi saat ini). **T17** bandingkan dengan Weka `NaiveBayesMultinomial` pada dataset 10-baris pilkada (toleransi 1e-6 untuk probabilitas). |
| F05 Tanpa leakage | **T18** kata yang hanya muncul di data holdout tidak ada di kosakata model. |
| F09 df satu pass + output sparse | **T19** 10k dokumen × V 30k selesai < X detik (target ditentukan dari benchmark), dengan memori puncak tercatat. **T20** hasil sparse → dense sama persis dengan versi lama. |
| F10 Peringatan prediktor teks di NB | **T21** dataset dengan kolom STRING unik per baris di mode exclude → muncul peringatan. |

### Tahap 3 — Peningkatan lanjutan

| Perbaikan | Kasus uji |
|---|---|
| F13 per-class wordsToKeep + minTermFreq + "0 = semua" | **T22** 2 kelas, wordsToKeep=1: setiap kelas menyumbang kata terbanyaknya (≤2 kolom). **T23** minTermFreq=2 → kata dengan frekuensi 1 hilang. |
| F16 L2 / normalizeDocLength | **T24** baris TF-IDF ber-L2 memiliki `Σv²=1` (toleransi 1e-12). Bandingkan dengan `sklearn.TfidfVectorizer(sublinear_tf=True)` pada 3 dokumen. |
| F17 preset Weka-compatible | **T25** cocok dengan output Weka `StringToWordVector -C -T -I` pada `dataset_inggris_testing.csv`. |
| F18 tokenizer tweet | **T26** `"@user cek http://x.co #Pilkada2017 seolah2"` → `["cek","pilkada2017","seolah"]` (sesuai aturan yang dipilih). |

**Hasil simulasi untuk referensi test (T-F17).** Dokumen: `["Saya suka makan nasi","Saya tidak suka nasi!","Makan, makan, makan"]`, config default (lowercase, tanpa stopword/stem, Log TF, Smooth IDF). Kosakata `[makan, nasi, saya, suka, tidak]`. Matriks:
```
[1.2877, 1.2877, 1.2877, 1.2877, 0.0   ]
[0.0,    1.2877, 1.2877, 1.2877, 1.6931]
[2.7023, 0.0,    0.0,    0.0,    0.0   ]
```
(`1.2877 = ln(4/3)+1`, `1.6931 = ln(4/2)+1`, `2.7023 = (1+ln 3)·1.2877`.) Dengan stopword ID aktif, kolom `tidak` hilang, sehingga dok-1 dan dok-2 menjadi hampir identik (ilustrasi F06).

---

## 8. Area yang tidak diperiksa & pertanyaan terbuka

**Tidak/kurang diperiksa:**
- Isi crate `sastrawi-rs` (kualitas stemming reduplikasi `berlari-lari`, kata tidak baku) dan biaya `Dictionary::new()`. Belum dilakukan benchmark runtime (F08/F09 bersifat analisis statis).
- `wasm-output/statify_string_to_word.js` (glue) hanya diperiksa keberadaan/sinkronisasinya, tidak dibaca baris per baris. Kompatibilitas `new URL('./…wasm', import.meta.url)` dengan konfigurasi Next.js/webpack proyek belum diverifikasi di browser.
- Kode NB/AM hanya dibaca pada titik integrasi (`getEffectivePredictors`, `numerical_distribution.rs`, `prediction.rs`, `save.rs`, dokumen AGENTS). UI NB/AM, formatter, dan ±60 test AM tidak diaudit, serta performa NB/AM dengan ±1 000 kolom VEC_* belum diukur (HIPOTESIS: tabel Attribute Distribution menjadi sangat panjang).
- `VariablesTab.tsx` hanya dibaca 60 baris pertama (bagian presentasional).
- Perilaku `dataService.getColumnData` (apakah mengembalikan baris kosong di ekor grid) tidak ditelusuri ke service/worker.

**Pertanyaan untuk pemilik proyek:**
1. Apakah skripsi menuntut alur **latih → terapkan ke data baru** untuk teks? Bila ya, F02/F07 menjadi syarat wajib.
2. Model NB mana yang ingin diklaim untuk teks: Gaussian (saat ini), Bernoulli/Categorical (Boolean + nominal), atau Multinomial? Ini memerlukan revisi `NB/AGENTS.md` §1/§5 yang saat ini mengunci "satu model campuran".
3. Apakah metrik evaluasi di skripsi harus bebas leakage (F05)? Bila tidak, minimal perlu dicantumkan sebagai keterbatasan.
4. Target kompatibilitas angka: **Weka** atau **sklearn**? Saat ini campuran (F16/F17).
5. Sumber daftar stopword ID/EN apa, dan bolehkah dimodifikasi (negasi)?
6. Skala dataset target (ratusan vs puluhan ribu tweet)? Jawaban ini menentukan urgensi F08/F09.

---

## 9. Status tindak lanjut

Ditambahkan pada Fase S9 (2026-10-04) setelah Tahap 1 (`PLAN_FIX.md` S1–S9) selesai. Bagian 1–8 di atas **tidak diubah** dan menggambarkan keadaan saat audit (2026-10-03). Rujukan: `README.md` ("Status Terkini", "Batasan yang diketahui") dan `plan-reports/S1.md`–`S9.md`. Keputusan pemilik D1–D11 ada di `PLAN_FIX.md` §0.

Arti status: **Selesai** = dikerjakan di Tahap 1; **Selesai sebagian** = sebagian dikerjakan, sisanya dijelaskan di kolom catatan; **Tidak dikerjakan (D2)** = sengaja tidak dikerjakan sesuai keputusan pemilik dan dicatat sebagai batasan; **Dipindah ke Tahap 2** = menjadi lingkup Naive Bayes v2 / Apply Model v2 (`naive-bayes/PLAN_V2.md`, `AGENTS_V2.md`).

| ID | Sev | Status | Fase | Catatan |
|---|---|---|---|---|
| F01 | Critical | Selesai | S5 | Sel kosong/null → `""` → vektor nol; baris tidak dibuang, sejajar dataset (D4). `utils/buildDocuments.ts`, `utils/buildColumnData.ts`; uji manual S8 skenario 2 lulus. |
| F02 | Critical | Tidak dikerjakan (D2); dipindah ke Tahap 2 | S4 (fondasi) | STWV tidak menyimpan resep (D3). Fondasi `TextVectorizerModel`, `fit`/`transform` ada di crate CORE untuk NB v2/AM v2. Dicatat sebagai Batasan (a) di README. |
| F03 | High | Dipindah ke Tahap 2 | – | Model NB untuk fitur teks (likelihood per kelompok) adalah lingkup NB v2; tidak ada perubahan di STWV. |
| F04 | High | Selesai | S2, S5 | Rust mengirim error sebagai objek `{code, message}` (`serde_wasm_bindgen`); `utils/normalizeWorkerError.ts` menormalkan semua bentuk error di worker dan hook. Uji manual S8 skenario 3 lulus. |
| F05 | High | Tidak dikerjakan (D2); dipindah ke Tahap 2 | – | Dicatat sebagai Batasan (b). Jalur Raw Text NB v2 melakukan fit hanya pada data latih tiap fold (AGENTS_V2 V7). |
| F06 | High | Tidak dikerjakan (D2) | – | Daftar stopword tidak diubah; negasi tetap ada. Dicatat sebagai Batasan (e). |
| F07 | High | Dipindah ke Tahap 2 | S8 (mitigasi parsial) | Pemetaan kolom lewat resep adalah lingkup Tahap 2. Mitigasi di STWV: awalan kolom dapat diatur ("Vector Column Name"); label kolom = kata asli; tombol hasil tidak dapat ditekan dua kali. Risiko salah-pasang karena `processVariableName` tetap ada. |
| F08 | Medium | Selesai | S2 | `Pipeline` membangun regex, set stopword, dan stemmer sekali per batch + cache memo. Benchmark T7 (5 000 dokumen) belum dijalankan; dampak waktu tetap hipotesis. |
| F09 | Medium | Selesai sebagian | S3, S4 | df, total count, dan skor dihitung satu pass; CSR tersedia untuk konsumen Rust. Output ke UI tetap dense (D10), jadi biaya memori dataset besar belum berubah. |
| F10 | Medium | Dipindah ke Tahap 2 | – | Pengecualian prediktor teks di mode Exclude diatur AGENTS_V2 V3 (NB v2). Tidak ada perubahan di STWV. |
| F11 | Medium | Selesai | S2 | JSON stopword rusak → `INVALID_STOPWORDS` (test T6). |
| F12 | Medium | Selesai sebagian | S6 | Catatan "Stemming always lowercases tokens…" tampil di OptionsTab; Batasan (d). Re-filter stopword setelah stem (opsional di temuan) tidak dikerjakan. |
| F13 | Medium | Selesai sebagian | S3, S6 | `minTermFreq` (D8), "0 = semua", rangking berdasarkan total kemunculan (D7). Per-kelas Tidak dikerjakan (D2). Truncate ketat dipertahankan, Batasan (c). |
| F14 | Medium | Selesai | S1–S6, S8 | Test Rust: 78 (15 + 16 + 25 + 22) di CORE; test jest: 79 pada 6 berkas. Klaim README "Unit Testing selesai" kini benar. |
| F15 | Medium | Selesai sebagian | S7 | Blok STWV ditambahkan di `build-wasm.sh`; build manual berhasil (laporan S7). Isu `.gitignore` `*` pada `wasm-output/` dan mekanisme `version()` tidak dikerjakan. |
| F16 | Low | Selesai | S3, S6 | Normalisasi `l1`/`l2`/`doc_length` sebagai opsi; preset scikit-learn raw/smooth/l2 = `TfidfVectorizer()` default (golden §3.6). |
| F17 | Low | Selesai | S3, S6 | Preset Weka: TF `log1p` = `ln(1+f)`, IDF standard `ln(N/df)`. Rumus terdokumentasi di UI (tooltip) dan README. |
| F18 | Low | Tidak dikerjakan (di luar D1) | – | Tidak ada preset tokenizer tweet. Dicatat sebagai batasan tambahan di README. Tidak ada keputusan pemilik eksplisit; lihat KEPUTUSAN TERBUKA di `plan-reports/S9.md`. |
| F19 | Low | Selesai | S6 | n-gram di-clamp 1..5, validasi min ≤ max, tombol OK nonaktif + pesan; Rust juga menolak (`INVALID_CONFIG`). |
| F20 | Low | Selesai sebagian | S5, S8 | Hasil direset setelah simpan, variabel di-resolve ulang saat Run (`VARIABLE_NOT_FOUND`); alur OK (S8) menulis kolom sekali. Persist konfigurasi tidak dikerjakan. |
| F21 | Low | Selesai | S2, S5, S6 | Satu `types.ts`; enum Rust (`INVALID_CONFIG` untuk nilai tak dikenal); `OptionsTab` bertipe tanpa `any`. |
| F22 | Low | Selesai | S6 | Opsi TF "None" dihapus dari UI; alias `none` → binary hanya untuk kompatibilitas JSON lama di Rust. |
| F23 | Low | Selesai | S7 | Stub `vectorizer.worker.js` dihapus; README diperbarui (S9). |

Ringkasan (23 temuan): 11 Selesai (F01, F04, F08, F11, F14, F16, F17, F19, F21, F22, F23); 5 Selesai sebagian (F09, F12, F13, F15, F20); 2 Tidak dikerjakan (D2) dengan kelanjutan di Tahap 2 (F02, F05); 1 Tidak dikerjakan (D2) (F06); 3 Dipindah ke Tahap 2 (F03, F07, F10); 1 Tidak dikerjakan di luar D1 (F18).
