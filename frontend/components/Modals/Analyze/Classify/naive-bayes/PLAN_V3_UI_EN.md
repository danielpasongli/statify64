# PLAN_V3_UI_EN.md — Pembersihan teks UI, UI full English, dan interpretasi output

Rencana kerja untuk agent implementasi (Claude Sonnet, effort medium) yang berjalan **paralel** di satu working tree
(branch `dija-v2`). Cakupan: **String to Word Vector (STWV)**, **Naive Bayes (NB)**, **Apply Model (AM)**, dan crate
teks bersama **CORE**.

Notasi path: `STWV/` = `frontend/components/Modals/Transform/StringToWordVector/`,
`NB/` = `frontend/components/Modals/Analyze/Classify/naive-bayes/`, `AM/` = `.../Classify/apply-model/`,
`CORE/` = `frontend/rust-crates/statify-text-core/`. Laporan fase ditulis ke `NB/plan-reports-v3/<ID>.md`.

> **Status dokumen: DISETUJUI pemilik (2026-10-05).** Seluruh keputusan §0 (E1–E7) dikonfirmasi tanpa perubahan.
> Untuk teks yang terlihat pengguna, dokumen ini lebih tinggi hierarkinya daripada `AGENTS_V2.md`, `AGENTS.md` (NB/AM),
> dan `STWV/PLAN_FIX.md` (lihat E5).

---

## 0. Keputusan pemilik (DIKONFIRMASI 2026-10-05)

| ID | Keputusan | Keputusan final |
|---|---|---|
| E1 | Cakupan menu | Hanya STWV, NB, AM (+ CORE). Menu lain (KNN, Discriminant, dll.) **tidak** disentuh. |
| E2 | Bahasa | **Semua teks yang terlihat pengguna** berbahasa Inggris: label, tooltip, teks bantuan, placeholder, toast, pesan validasi, pesan galat (termasuk yang berasal dari Rust/CORE), peringatan, judul/catatan/deskripsi Output Viewer, isi log. **Komentar kode** dan dokumen pengembang (`*.md`) tetap Bahasa Indonesia. |
| E3 | Kode galat di UI | Kalimat utama ramah pengguna dalam bahasa Inggris, kode internal ditampilkan di akhir dalam kurung: `... (NB_E_TEXT_NEGATIVE)`. Kode **tidak** ditampilkan di awal kalimat. STWV mengikuti pola yang sama (bukan `[KODE] pesan`). |
| E4 | Interpretasi | Setiap item Output Viewer milik ketiga menu mendapat `description` berupa HTML **otomatis, deterministik (berbasis templat + angka hasil), berbahasa Inggris**, yang tetap bisa diedit pengguna lewat tombol Edit. Tidak memakai AI/LLM saat runtime. |
| E5 | Kontrak lama yang mengunci teks Indonesia | Dokumen ini **menggantikan** penguncian teks pada `AGENTS_V2.md` §3.4 (W-VEC/W-STR/W-LEAK), §5.2 dan `CATATAN_TAHAP2` §1 (pesan negatif), §9 (toast 5 MB), §10.2 (ringkasan kolom vektor), `AM/AGENTS.md` K10 & §4.5 (pesan Indonesia), dan `STWV/PLAN_FIX.md` §3.3 ("pesan Bahasa Indonesia"). Teks pengganti = §3 dokumen ini. **Struktur, kode galat, angka, dan rumus tidak berubah.** |
| E6 | Ekspektasi test | Agent **boleh** mengubah ekspektasi test yang hanya menguji **teks** (string pesan/label/catatan). Ekspektasi angka, struktur, kode galat, dan perilaku **tidak boleh** diubah. Setiap perubahan dicatat di laporan. |
| E7 | Build WASM | Pesan Rust berubah → WASM STWV, NB, AM wajib di-build ulang oleh pemilik (Fase B). TS harus tetap bisa mengurai format pesan Rust lama **dan** baru selama masa transisi. |

---

## 1. Aturan kerja agent (berlaku untuk SEMUA fase)

1. Kerjakan **hanya** fase yang ditugaskan dan **hanya** file di "File milik fase" (§4). Butuh file lain → berhenti untuk file itu dan catat di laporan.
2. **Dilarang:** perintah `git` apa pun; `npm install`/`npm ci`/`yarn`/`pnpm add`; `cargo add`/`cargo update`; `wasm-pack`; menyalin hasil build ke `wasm-output/` atau `public/workers/*/pkg/`; formatter/linter `--fix` seluruh folder.
3. **Boleh:** `cargo test` / `cargo check` di crate milik fase; `cd frontend && npx jest <path test milik fase> --coverage=false` (**jest wajib dari folder `frontend`**, `jest.config.ts` di root repo usang); `npx tsc --noEmit -p frontend` (baseline 43 error di modul lain). Bila toolchain tidak tersedia, tulis perintahnya di laporan; jangan mencari jalan pintas.
4. Jangan mengubah angka, rumus, struktur data, kode galat, atau perilaku. Fase ini hanya teks + interpretasi.
5. Tidak boleh ada `any` baru di TS dan tidak boleh ada `unwrap()` pada data pengguna di Rust.
6. Jangan menghapus komentar penjelas; komentar boleh tetap Bahasa Indonesia dan boleh merujuk dokumen (`AGENTS.md §x`). **Larangannya hanya pada teks yang sampai ke pengguna.**
7. Test lain yang gagal karena teks yang diubah fase paralel lain: **jangan diperbaiki**, catat di laporan (Fase X1 yang membereskan).
8. Laporan ke `NB/plan-reports-v3/<ID>.md` dengan format §6.

---

## 2. Aturan "teks bersih" (definisi kotor)

Teks yang terlihat pengguna **tidak boleh** memuat:

| Kategori | Contoh yang dilarang | Ganti dengan |
|---|---|---|
| Rujukan dokumen internal | `(AGENTS.md §5.10)`, `AGENTS_V2 §3.4`, `PLAN_FIX`, `§`, `per AGENTS.md §5.8` | Hapus, atau tulis alasannya dengan kalimat biasa |
| Nama fase/versi pengembangan | `Fase N4`, `v2`, `Revisi v2`, `Tahap 2`, `G1`, `B1`, `D3` | Hapus |
| Jargon implementasi | `payload`, `serde`, `WASM`, `worker`, `CORE`, `CSR`, `TextPayload`, nama fungsi/field (`rawTextValues`, `getSlicedData`, `TextTopK`) | Istilah pengguna: "analysis engine", "text column", "Top-k terms per class" |
| Kode peringatan internal sebagai label | `W-VEC`, `W-STR`, `W-LEAK` | Tidak ditampilkan; cukup kalimat peringatannya |
| Bahasa campuran | `Kolom vektor ...`, `Pilih variabel target`, `dari ... dianggap 0` | Bahasa Inggris (§3) |
| Kode galat di awal kalimat | `AM_E_MAP_UNMAPPED: Fitur ...`, `[EMPTY_VOCABULARY] ...` | `Feature "X" is not mapped to a dataset variable. (AM_E_MAP_UNMAPPED)` |
| Teks placeholder/debug | `TODO`, `stub`, `lorem`, `undefined`, `[object Object]`, `NaN` di tabel | Teks final atau `-` |

Gaya bahasa Inggris:

- Kalimat lengkap, jelas, tanpa singkatan internal. Sapaan netral (imperatif: "Select a target variable.").
- Label kontrol: *Title Case* untuk judul bagian/tab (mis. "Text Preprocessing"), *Sentence case* untuk opsi/kalimat.
- Angka: titik desimal; persentase 1 desimal (`74.1%`), metrik 3 desimal (`0.741`), probabilitas 4 desimal.
- Istilah baku (glosarium): *target variable*, *predictor*, *numeric (scale)*, *categorical (nominal/ordinal)*,
  *Text Features*, *Raw Text Variable*, *Word-Vector Variables*, *vocabulary*, *term*, *likelihood*, *smoothing alpha*,
  *holdout*, *k-fold cross-validation*, *not scored*, *unseen category*, *treated as 0*.

---

## 3. Teks kanonik (WAJIB dipakai persis; lintas fase)

Teks yang muncul di lebih dari satu fase dikunci di sini agar Rust dan TS identik.

### 3.1 Peringatan NB (TS `useNaiveBayesTextRules.ts` dan Rust `case_summary.rs`)

| Kunci | Teks |
|---|---|
| VEC_LIKE | `{n} numeric columns look like word vectors. Move them to Text Features to use a text likelihood such as Multinomial.` |
| FREE_TEXT | `Column '{name}' looks like free text or an ID. Exclude it or move it to Text Features.` |
| LEAKAGE | `The vocabulary and IDF of these vector columns were computed outside Naive Bayes on all rows, so evaluation results may be slightly optimistic.` |
| NO_PRIOR | `Complement Naive Bayes does not use class priors; class scores come from the text features only.` |

### 3.2 Pesan Rust yang diurai TS (format baru; TS wajib menerima format lama juga)

| Kode | Format baru (Rust) | Diurai TS |
|---|---|---|
| `NB_E_TEXT_NEGATIVE` | `NB_E_TEXT_NEGATIVE: Text vector column '{col}' contains negative values ({n} column(s) affected). Multinomial, Bernoulli and Complement Naive Bayes require values >= 0. Check that the column is a real word vector (not a standardized/PCA column or a missing-value code such as -1) and remove it from Word-Vector Variables.` | nama `/'([^']+)'/`, jumlah `/\((\d+) column/` **atau** lama `/total (\d+) kolom/` |
| `NB_E_TEXT_EMPTY_VOCAB_FOLD` | `NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of fold {n}. Relax the Text Preprocessing settings (e.g. Words to Keep, Min term frequency, stopwords) or use fewer folds.` / `... of the holdout split. ...` | nomor fold `/fold[\s_]*(?:ke)?[\s\-#:_]*(\d+)/i` (sudah ada, tetap) |
| `NB_E_TEXT_EMPTY_VOCAB` | `NB_E_TEXT_EMPTY_VOCAB: The text vocabulary is empty after preprocessing all rows. Relax the Text Preprocessing settings.` | prefiks |
| `NB_E_COMPLEMENT_MIXED` | `NB_E_COMPLEMENT_MIXED: Complement Naive Bayes can only be used when the model contains Text Features only, but this model also has {k} numeric/categorical predictor(s).` | prefiks |
| `NB_E_TEXT_SHAPE` | `NB_E_TEXT_SHAPE: {detail dalam bahasa Inggris}` | prefiks (pesan ramah baru wajib ada) |
| `AM_E_TEXT_NEGATIVE` (detail) | `{col}` atau `{col} ({n} columns affected)` | `/^(.*?) \((\d+) columns affected\)$/` **atau** lama `/^(.*?) \(total (\d+) kolom bermasalah\)$/` |
| CORE `TextError.message` | Kalimat bahasa Inggris (kode tetap: `EMPTY_INPUT`, `INVALID_CONFIG`, `INVALID_REGEX`, `INVALID_STOPWORDS`, `EMPTY_VOCABULARY`, `INVALID_DATA`, `SERIALIZE_ERROR`) | diteruskan apa adanya |

### 3.3 Pesan ramah TS (contoh nada; daftar lengkap disusun fase pemilik file)

| Kode | Teks ramah |
|---|---|
| `NB_E_TEXT_NEGATIVE` | `Text vector column '{col}' contains negative values{ and N more column(s)}. Text likelihoods require values >= 0; remove it from Word-Vector Variables. (NB_E_TEXT_NEGATIVE)` |
| `NB_E_TEXT_EMPTY_VOCAB_FOLD` | `No words are left in the training data of fold {n} after text preprocessing. Relax the Text Preprocessing settings or use fewer folds. (NB_E_TEXT_EMPTY_VOCAB_FOLD)` |
| `NB_E_TEXT_SHAPE` | `The text data does not match the dataset rows. Re-select the text variables and run the analysis again. (NB_E_TEXT_SHAPE)` |
| `AM_E_MAP_UNMAPPED` | `Feature "{detail}" is not mapped to a dataset variable. (AM_E_MAP_UNMAPPED)` |
| `AM_I_TEXT_ZERO_FILLED` / ringkasan vektor | `{m} of {V} vector columns found; {V−m} treated as 0.` |
| Toast > 5 MB | `The table is too large to copy. Use Download CSV instead.` |
| STWV sukses | `{n} vector columns were added to the dataset.` |

### 3.4 Spesifikasi interpretasi (`description`)

Setiap `description` adalah string HTML pendek (60–220 kata) dengan pola berikut; paragraf yang tidak relevan dihilangkan:

```html
<p><strong>What this shows.</strong> ...</p>
<p><strong>How to read it.</strong> ...</p>
<p><strong>Key findings.</strong> ... (berbasis angka hasil run ini)</p>
<p><strong>Note.</strong> ... (peringatan/keterbatasan, hanya bila relevan)</p>
```

Aturan teknis:

- Dibangun oleh **fungsi murni** `describe<Output>(raw, context): string` di file interpretasi per modul (pola
  `Classify/nearest-neighbor/services/nearest-neighbor-analysis-interpretation.ts`, tetapi berbahasa Inggris dan tanpa `any`).
- Semua nilai dari data di-*escape* HTML (`& < > "`). Hanya tag `<p>`, `<strong>`, `<em>`, `<ul>`, `<li>`.
- Tahan data hilang: field tidak ada/NaN → kalimat generik tanpa angka (tidak pernah `undefined`/`NaN`).
- Format angka sesuai §2. Tidak ada klaim di luar data (tidak boleh "model ini bagus untuk produksi").
- Ambang interpretasi yang dipakai (tulis apa adanya di teks bila dipakai):
  - Cohen's Kappa (Landis & Koch, 1977): < 0 *poor*, 0–0.20 *slight*, 0.21–0.40 *fair*, 0.41–0.60 *moderate*, 0.61–0.80 *substantial*, 0.81–1 *almost perfect*.
  - **No-information rate (NIR)** = proporsi kelas terbanyak pada data evaluasi (dari confusion matrix). Bandingkan dengan overall accuracy; bila accuracy ≤ NIR + 0.01 tulis bahwa model belum lebih baik dari menebak kelas mayoritas.
  - Ketidakseimbangan kelas bila rasio kelas terkecil/terbesar < 0.5 → sarankan memperhatikan macro F1/recall per kelas.
  - Sebut kelas dengan recall terendah dan pasangan salah klasifikasi terbanyak (actual → predicted).

Konten minimum per output:

| Modul | Output | "Key findings" minimal |
|---|---|---|
| STWV | Ringkasan (Executed) | jumlah dokumen, ukuran kosakata, jumlah kolom, prefiks |
| STWV | Processing Summary | dokumen vektor nol (jumlah & %), waktu proses; *Note*: kosakata/IDF dari seluruh dataset, tidak ada resep |
| STWV | Settings | standar rumus + TF/IDF/normalisasi dalam kalimat (mis. "word counts without IDF"), stopword/stemming |
| STWV | Vocabulary | 5 term dengan dokumen non-nol terbanyak; batas 200 baris tampil |
| NB | Case Processing Summary | valid vs total, baris dibuang (target kosong), skenario validasi, fitur teks (sumber, jumlah term), not scored |
| NB | Attribute Distribution Table | cara membaca smoothed count/probabilitas & mean/SD; atribut numerik dengan beda mean antar kelas terbesar (dalam satuan SD gabungan); kategori dengan rasio probabilitas antar kelas terbesar; catatan min-std bila ada |
| NB | Model Evaluation Metrics | overall accuracy vs NIR, macro/weighted F1, kelas recall terendah, ketidakseimbangan |
| NB | Cohen's Kappa | nilai + kategori Landis & Koch |
| NB | Confusion Matrix | diagonal benar (jumlah & %), salah klasifikasi terbanyak |
| NB | Text Feature Table | 3 term teratas per kelas, arti Score/Log weight, likelihood & alpha; *Note* LEAKAGE bila vector |
| NB | Export Model | isi file, schema 1.1/2.0 artinya, peringatan data sensitif, cara pakai di Apply Model |
| AM | Model Summary | algoritma, schema, target & kelas, jumlah fitur terpetakan, sumber teks |
| AM | Case Processing Summary | scored vs total (%), not scored, baris dengan prediktor hilang/kategori baru, baris teks kosong |
| AM | Prediction Distribution | kelas terbanyak & proporsinya; bandingkan dengan prior pelatihan bila tersedia di model |
| AM | Saved Variables | arti setiap kolom yang ditulis, nama akhir yang disesuaikan |
| AM | Evaluation Metrics / Kappa / Confusion Matrix | sama dengan NB (pakai ulang fungsi NB, §4 I2) + jumlah baris dikecualikan |

---

## 4. Peta gelombang dan kepemilikan file

```
Gelombang 1 (paralel, 7 agent): S1 · C1 · R1 · R2 · T1 · T2 · I1
Gelombang 2 (1 agent):          I2   (memakai fungsi evaluasi dari I1)
Gelombang 3 (1 agent):          X1   integrasi: versi WASM, test lintas fase, sapu bersih
Gelombang 4 (pemilik):          B    build WASM STWV/NB/AM + uji manual
Gelombang 5 (1 agent):          V    verifikasi akhir + pembaruan dokumentasi
```

| Fase | Isi | File milik fase |
|---|---|---|
| **S1** STWV TS | UI, validasi, toast, galat, Output Viewer + interpretasi STWV | `STWV/*.tsx`, `STWV/config.ts`, `STWV/types.ts`, `STWV/constants/formula-standards.ts`, `STWV/hooks/**`, `STWV/utils/**`, `STWV/stringToWord.processor.ts`, `STWV/__tests__/**`, `STWV/utils/describeStwvOutput.ts` (baru) |
| **C1** CORE Rust | Pesan `TextError` ke bahasa Inggris | `CORE/src/**`, `CORE/tests/**`, `STWV/rust/src/lib.rs` (pesan saja) |
| **R1** NB Rust | Pesan galat `NB_E_*` (§3.2), catatan output (`case_summary.rs`, `attribute_distribution.rs`), teks peringatan Rust | `NB/rust/src/**` |
| **R2** AM Rust | Pesan `AM_E_*`/detail, `warnings[].message`, label `model_summary.parameters` bila Indonesia | `AM/rust/src/**`, `AM/rust/tests/**` |
| **T1** NB TS UI | Semua tab, panel variabel, peringatan, validasi, toast, pesan galat ramah | `NB/dialogs/**`, `NB/components/variables-tab.tsx`, `NB/components/dataset-variable-list.tsx`, `NB/hooks/**`, `NB/services/naive-bayes-analysis.ts` (teks saja, bukan konstanta versi), `NB/services/naive-bayes-error-messages.ts`, `NB/constants/**`, `NB/components/__tests__/{options,variables-tab,raw-text-payload}.test.*`, `NB/services/__tests__/naive-bayes-error-messages.test.ts` |
| **I1** NB output | Pembersihan judul/catatan tabel + interpretasi semua output NB | `NB/services/naive-bayes-analysis-formatter.ts`, `NB/services/naive-bayes-analysis-output.ts`, `NB/services/naive-bayes-interpretation.ts` (baru), `NB/components/text-feature-table-output.tsx`, `NB/components/export-model-action.tsx`, `NB/components/export-model-output.tsx`, `NB/components/__tests__/export-model-action.test.tsx`, `NB/services/__tests__/{naive-bayes-analysis-output,naive-bayes-text-feature-formatter,text-feature-table-output}.test.*`, `NB/services/__tests__/naive-bayes-interpretation.test.ts` (baru) |
| **T2** AM TS UI | Semua tab, kode & pesan, auto-map/validasi, toast, loader | `AM/constants/**`, `AM/dialogs/**`, `AM/hooks/**`, `AM/adapters/**`, `AM/services/model-loader.ts`, `AM/services/apply-model-analysis.ts` (teks saja), `AM/services/apply-model-error-messages.ts`, `AM/services/apply-model-save-variables.ts`, test terkait di `__tests__` folder-folder tsb. kecuali milik I2 |
| **I2** AM output | Pembersihan tabel + interpretasi semua output AM | `AM/services/apply-model-formatter.ts`, `AM/services/apply-model-output.ts`, `AM/services/apply-model-interpretation.ts` (baru), `AM/services/__tests__/{apply-model-formatter,apply-model-formatter-v2,apply-model-output}.test.ts`, `AM/services/__tests__/apply-model-interpretation.test.ts` (baru) |
| **X1** Integrasi | Konstanta versi WASM + `?v=` worker; perbaikan **teks** test lintas fase yang gagal; sapu bersih §2 | `NAIVE_BAYES_WASM_VERSION` di `NB/services/naive-bayes-analysis.ts`, `APPLY_MODEL_WASM_VERSION` di `AM/services/apply-model-analysis.ts`, `frontend/public/workers/Classify/NaiveBayes/naive-bayes.worker.js`, `frontend/public/workers/Classify/ApplyModel/apply-model.worker.js`, semua file `__tests__`/`tests` ketiga modul (teks saja); file lain hanya untuk sisa teks kotor yang ditemukan sapu bersih, dengan catatan di laporan |
| **V** Verifikasi | Cek akhir + dokumentasi | `STWV/DOKUMENTASI.md`, `STWV/README.md`, `NB/DOKUMENTASI.md`, `NB/README_V2.md`, `AM/DOKUMENTASI.md`, `NB/plan-reports-v3/V.md` |

Catatan dependensi gelombang 1:

- **R1 ↔ T1** dan **R2 ↔ T2** terhubung lewat format pesan §3.2. Keduanya bekerja paralel karena format dikunci di sini; T1/T2 wajib menerima format lama **dan** baru.
- **T1 ↔ I1**: `getLeakageNote` (T1) dan catatan output (I1) memakai teks LEAKAGE §3.1. I1 memanggil fungsi, bukan menyalin teks.
- **S1 ↔ T1**: tab Text Preprocessing NB memakai `STWV/OptionsTab.tsx` dan `validateStwvConfig` milik S1. Test NB yang mengunci pesan STWV dibereskan X1.
- **I1 → I2**: I1 wajib mengekspor dari `NB/services/naive-bayes-interpretation.ts` minimal:
  `describeEvaluationMetrics(metrics: NaiveBayesEvaluationMetricsRaw, confusion?: NaiveBayesConfusionMatrixRaw): string`,
  `describeCohensKappa(kappa: number | null | undefined): string`,
  `describeConfusionMatrix(confusion: NaiveBayesConfusionMatrixRaw): string`. I2 mengimpornya (read-only).

---

## 5. Fase

### S1 — STWV TS: teks bersih, English, interpretasi *(G1)*
**Tugas:** (1) inventaris semua string yang terlihat pengguna di file milik fase (label, tooltip, placeholder, catatan UI seperti "Stemming always lowercases...", galat validasi `validateStwvConfig`, `validateColumnPrefix`, `EMPTY_DATA_ERROR`, pesan hook/toast, `normalizeWorkerError`, teks Output Viewer termasuk `note` tabel); (2) terjemahkan/bersihkan sesuai §2–§3; tampilkan galat dengan pola E3; (3) buat `utils/describeStwvOutput.ts` dan isi `description` setiap statistic di `writeStwvOutput.ts` sesuai §3.4; (4) perbarui test teks + test baru interpretasi (angka golden 3 dokumen PLAN_FIX §3.6 sebagai input).
**Kriteria selesai:** tidak ada teks Indonesia/rujukan internal yang terlihat pengguna di file milik fase (bukti: daftar grep di laporan); semua test STWV hijau; interpretasi teruji untuk kasus normal, semua dokumen kosong sebagian, dan data hilang.

### C1 — CORE Rust: pesan galat English *(G1)*
**Tugas:** terjemahkan semua `TextError::new(code, message)` dan pesan `format!` yang bisa sampai ke pengguna di `CORE/src/**` dan `STWV/rust/src/lib.rs`; kode tidak berubah. Perbarui test yang mengunci teks pesan (hanya teks). Jangan ubah rumus/urutan/angka.
**Kriteria selesai:** `cargo test` CORE hijau (91 test); `cargo check` di `STWV/rust` sukses; daftar pesan lama → baru di laporan.

### R1 — NB Rust: pesan & catatan English *(G1)*
**Tugas:** pesan `NB_E_*` persis §3.2; pesan galat lain yang sampai ke pengguna (validasi, `error_collector`, kosakata fold "holdout"/"fold n"); catatan output (`leakage_note` = LEAKAGE, `class_prior_note` = NO_PRIOR, `likelihood_note` min-std) bersih dan English; deskripsi `Raw text: '{var}' ({V} terms)` tetap. Perbarui test teks.
**Kriteria selesai:** `cargo test` NB hijau (203); `cargo check --target wasm32-unknown-unknown` sukses; snapshot export v1 tetap identik (teks export tidak berubah).

### R2 — AM Rust: pesan English *(G1)*
**Tugas:** semua pesan `AM_E_*: detail` (detail English), detail negatif §3.2, `warnings[].message`, baris `model_summary.parameters` (label sudah English; periksa nilai). Perbarui test teks.
**Kriteria selesai:** `cargo test` AM hijau (117 + 39); `cargo check --target wasm32-unknown-unknown` sukses; contoh numerik T1–T7 tidak berubah.

### T1 — NB TS UI: English & bersih *(G1)*
**Tugas:** semua teks di tab Variables/Text Preprocessing (pembungkus)/Options/Validation/Output, panel kiri (filter, tombol, penghitung), peringatan §3.1, pesan validasi (`useNaiveBayesValidation`, `getNumericInputError`, `getTabLeaveError`, `options.tsx`, `output.tsx`), toast container, `naive-bayes-error-messages.ts` (semua kode §3.2–§3.3 termasuk `NB_E_TEXT_SHAPE` dan `NB_E_TEXT_RAW_MISSING`; parser terima format lama & baru; pesan v1 lama juga diterjemahkan). Perbarui test teks + test parser format baru.
**Kriteria selesai:** test NB milik fase hijau; tidak ada teks Indonesia/rujukan internal terlihat pengguna di file milik fase.

### I1 — NB output: bersih + interpretasi *(G1)*
**Tugas:** (1) bersihkan judul/`note`/teks tabel di formatter (mis. `per AGENTS.md §5.8`, `(AGENTS.md §5.6)`), teks `export-model-*`, komponen Text Feature Table (toast/tombol/keterangan); (2) buat `naive-bayes-interpretation.ts` dengan fungsi per output (§3.4) termasuk tiga fungsi ekspor untuk I2; (3) isi `description` setiap statistic di `naive-bayes-analysis-output.ts` dengan hasil fungsi itu; (4) test unit interpretasi: data golden (confusion matrix 2 kelas, kappa di setiap rentang Landis & Koch, kelas tidak seimbang, accuracy ≤ NIR, data hilang/NaN tidak bocor ke HTML, escape HTML pada nama kelas `<b>`).
**Kriteria selesai:** test NB milik fase hijau; setiap statistic NB punya `description` non-kosong berbahasa Inggris; tidak ada `AGENTS`/`§` di teks keluaran.

### T2 — AM TS UI: English & bersih *(G1)*
**Tugas:** `APPLY_MODEL_MESSAGES` seluruhnya English (pola E3 di tampilan), teks tab Model/Variables/Save/Output dan teks Help, ringkasan kolom vektor §3.3, toast container & `applyModel`, loader, `getUserFriendlyApplyModelError` (parser detail negatif lama & baru). Perbarui test teks.
**Kriteria selesai:** test AM milik fase hijau; tidak ada teks Indonesia/rujukan internal terlihat pengguna di file milik fase.

### I2 — AM output: bersih + interpretasi *(G2, setelah I1)*
**Tugas:** bersihkan teks formatter/output AM; buat `apply-model-interpretation.ts` (Model Summary, Case Processing Summary, Prediction Distribution, Saved Variables) dan pakai ulang tiga fungsi evaluasi I1; isi `description` setiap statistic di `apply-model-output.ts`; test unit (contoh T1–T7 AM §5.6 untuk ringkasan & distribusi, model raw/vector, evaluasi ada/tidak).
**Kriteria selesai:** test AM milik fase hijau; setiap statistic AM punya `description` English.

### X1 — Integrasi *(G3, sendirian)*
**Tugas:** (1) jalankan seluruh jest STWV+NB+AM dan perbaiki **teks** test yang gagal akibat fase paralel; (2) sapu bersih seluruh file non-test ketiga modul + worker dengan grep §2 (pola di Lampiran A) dan bereskan sisa; (3) naikkan `NAIVE_BAYES_WASM_VERSION`, `APPLY_MODEL_WASM_VERSION`, dan `?v=` di kedua worker ke `...-v3-YYYYMMDDa` (hari kerja); (4) tulis perintah build B persis di laporan.
**Kriteria selesai:** jest ketiga modul hijau; `tsc` = baseline 43 error; hasil grep Lampiran A kosong untuk teks terlihat pengguna (sisa hanya komentar).

### B — Build WASM & uji manual *(G4, PEMILIK)*
Build STWV (`wasm-output/`), NB, dan AM (salin 4 berkas `pkg` dengan `Copy-Item -Force`, lihat `NB/README_V2.md` §10), hard refresh, lalu periksa: setiap tab ketiga menu berbahasa Inggris; setiap item Output Viewer punya Description yang masuk akal; picu galat utama (kolom vektor negatif, Complement + numerik, STWV kosakata kosong, AM kolom tak terpetakan) dan pastikan pesannya English dengan kode di akhir.

### V — Verifikasi & dokumentasi *(G5)*
**Tugas:** baca semua laporan v3; jalankan test yang diizinkan; ulangi grep Lampiran A; perbarui kutipan teks UI di ketiga `DOKUMENTASI.md`, `NB/README_V2.md`, `STWV/README.md` (dokumen tetap Bahasa Indonesia, kutipan UI English) dan tambahkan subbagian "Interpretasi otomatis" di bagian A tiap DOKUMENTASI.
**Kriteria selesai:** dokumentasi sesuai UI baru; laporan V berisi checklist E1–E7 dengan bukti.

---

## 6. Format laporan (`NB/plan-reports-v3/<ID>.md`)

```
# Laporan Fase <ID> — <judul>
## Status: SELESAI | SELESAI SEBAGIAN | DIBLOKIR
## Ringkasan perubahan (maks. 10 butir)
## File diubah / dibuat (path lengkap)
## Tabel teks lama → baru (string yang terlihat pengguna; boleh dikelompokkan)
## Test (perintah + hasil; test yang ekspektasi teksnya diubah: nama + alasan)
## Pemenuhan "Kriteria selesai" (checklist dengan bukti file:baris / nama test)
## KEPUTUSAN TERBUKA / risiko
## Perintah untuk pemilik (blok kode, komentar Bahasa Indonesia)
```

---

## 7. Prompt agent

### 7.1 Prompt dasar (tempel ke setiap agent, ganti `<ID>`)

```
Kamu adalah agent implementasi untuk proyek skripsi "Statify" (Next.js + TypeScript + Rust/WASM).
Kamu bekerja di working tree yang SAMA dengan agent lain yang berjalan paralel, di branch dija-v2.

TUGAS: kerjakan HANYA Fase <ID> dari
frontend/components/Modals/Analyze/Classify/naive-bayes/PLAN_V3_UI_EN.md.

LANGKAH WAJIB (urut):
1. Baca PLAN_V3_UI_EN.md seluruhnya (terutama §0 keputusan, §1 aturan, §2 teks bersih, §3 teks kanonik,
   §4 kepemilikan file, dan bagian Fase <ID>). Baca juga DOKUMENTASI.md modul terkait
   (STWV/NB/AM) bagian C untuk memahami arsitektur.
2. Bila fase ini punya prasyarat (I2 → I1; X1 → semua G1+G2; V → B), baca laporan prasyarat di
   naive-bayes/plan-reports-v3/. Bila tidak ada atau belum selesai, BERHENTI dan laporkan.
3. Baca semua "File milik fase" dan file yang memanggil/dipanggilnya sebelum mengubah apa pun.
4. Inventaris dulu: daftar setiap string yang TERLIHAT PENGGUNA di file milik fase (label, tooltip,
   placeholder, toast, pesan validasi/galat, judul/catatan/deskripsi output). Komentar kode BUKAN target.
5. Tulis rencana singkat (maks. 10 butir) di awal responsmu.
6. Implementasikan semua butir "Tugas" fase, memakai teks kanonik §3 PERSIS bila disebut.
7. Perbarui/tambah test. Ekspektasi yang boleh diubah HANYA ekspektasi teks (PLAN §0 E6).
8. Jalankan test yang diizinkan (PLAN §1.3). Perbaiki sampai hijau atau jelaskan kenapa tidak bisa.
9. Tulis laporan ke naive-bayes/plan-reports-v3/<ID>.md (format PLAN §6).

ATURAN KERAS:
- Ubah/buat HANYA file milik fase. Butuh file lain → jangan ubah, catat di laporan.
- DILARANG: perintah git apa pun; npm install/ci, yarn, pnpm add; cargo add/update; wasm-pack;
  menyalin build ke wasm-output/ atau public/workers/*/pkg/; formatter/linter --fix seluruh folder.
- Jest dijalankan dari folder frontend: cd frontend && npx jest <path> --coverage=false.
- Jangan mengubah angka, rumus, struktur data, kode galat, atau perilaku. Hanya teks + interpretasi.
- Teks yang terlihat pengguna: Bahasa Inggris, bersih (PLAN §2). Komentar kode & laporan: Bahasa Indonesia.
- Tidak boleh ada `any` baru di TS; tidak boleh ada unwrap() pada data pengguna di Rust.
- Test di luar fase yang gagal karena teks fase paralel: jangan diperbaiki, catat di laporan.
- Jangan mengedit PLAN_V3_UI_EN.md, AGENTS*.md, PLAN*.md.
- Bila dokumen ambigu: pilih tafsiran yang paling konservatif, lanjutkan, tandai "KEPUTUSAN TERBUKA".

PENUTUP: ringkasan 3–5 baris + path laporan. Jangan menawarkan commit.
```

### 7.2 Tambahan per fase (tempel di bawah prompt dasar)

| Fase | Tambahan |
|---|---|
| S1 | `Fokus STWV TS. Pola interpretasi: lihat Classify/nearest-neighbor/services/nearest-neighbor-analysis-interpretation.ts (struktur saja; teksnya Indonesia dan memakai any — jangan ditiru). OptionsTab dan validateStwvConfig juga dipakai tab Text Preprocessing NB; jangan ubah props/signature.` |
| C1 | `Fokus CORE Rust. Pesan CORE diteruskan NB sebagai NB_E_TEXT_CONFIG: [KODE] pesan, jadi pesan harus berdiri sendiri dan jelas. Jangan ubah kode galat, rumus, atau urutan pipeline.` |
| R1 | `Fokus NB Rust. Pakai format §3.2 PERSIS (diurai T1 dengan regex). Teks LEAKAGE dan NO_PRIOR §3.1 PERSIS. Export JSON tidak boleh berubah (snapshot v1).` |
| R2 | `Fokus AM Rust. Detail AM_E_TEXT_NEGATIVE pakai format §3.2 PERSIS (diurai T2). Contoh numerik T1–T7 tidak boleh berubah.` |
| T1 | `Fokus NB TS UI. Parser pesan Rust wajib menerima format lama (Indonesia) DAN baru (§3.2) karena WASM baru dibangun pemilik belakangan. Jangan sentuh formatter/output/text-feature-table/export-model (milik I1) dan konstanta NAIVE_BAYES_WASM_VERSION (milik X1).` |
| I1 | `Fokus NB output. Ekspor describeEvaluationMetrics, describeCohensKappa, describeConfusionMatrix dengan signature di §4 (dipakai I2). Ambil teks LEAKAGE lewat getLeakageNote (milik T1), jangan salin.` |
| T2 | `Fokus AM TS UI. Parser detail AM_E_TEXT_NEGATIVE terima format lama & baru (§3.2). Jangan sentuh apply-model-formatter/output (milik I2) dan konstanta APPLY_MODEL_WASM_VERSION (milik X1).` |
| I2 | `Fokus AM output. Prasyarat: laporan I1 SELESAI. Impor tiga fungsi evaluasi dari NB/services/naive-bayes-interpretation.ts (read-only).` |
| X1 | `Fase integrasi, berjalan sendirian. Prasyarat: laporan S1, C1, R1, R2, T1, T2, I1, I2 ada. Hanya boleh mengubah teks test, konstanta versi, worker, dan sisa teks kotor hasil sapu bersih.` |
| V | `Prasyarat: hasil uji manual B dicatat pemilik di plan-reports-v3/B.md. Hanya mengubah dokumen.` |

---

## Lampiran A — Pola sapu bersih (grep)

```bash
# Jalankan dari frontend; abaikan baris komentar (//, /*, *, ///) saat menilai.
D="components/Modals/Transform/StringToWordVector components/Modals/Analyze/Classify/naive-bayes components/Modals/Analyze/Classify/apply-model rust-crates/statify-text-core/src public/workers/Classify/NaiveBayes public/workers/Classify/ApplyModel"
# 1) Rujukan internal di string
grep -rnE --include=*.{ts,tsx,rs,js} '["`][^"`]*(AGENTS|PLAN|§|Fase |Revisi|Tahap [0-9]|W-VEC|W-STR|W-LEAK)[^"`]*["`]' $D | grep -vE '__tests__|/tests/|/pkg/|target/'
# 2) Kata Indonesia umum di string
grep -rnE --include=*.{ts,tsx,rs,js} '["`][^"`]*\b(tidak|harus|Pilih|kolom|berhasil|gagal|Gagal|Memproses|Perhatikan|dianggap|Periksa|maksimum|minimal|wajib|kosong|belum|Kosakata|Terdeteksi|tampak|sudah|nilai|variabel|dari|untuk|dengan)\b[^"`]*["`]' $D | grep -vE '__tests__|/tests/|/pkg/|target/'
```
