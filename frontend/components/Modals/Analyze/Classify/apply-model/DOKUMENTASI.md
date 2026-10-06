# Dokumentasi Modul Apply Model (v1 + v2 Text)

**Lokasi kode:** `frontend/components/Modals/Analyze/Classify/apply-model/`
**Menu:** *Analyze → Classify → Apply Model* (setelah Naive Bayes; panel sidebar kanan, lebar 40%)
**Mesin:** crate Rust/WASM sendiri (`rust/`), Web Worker `frontend/public/workers/Classify/ApplyModel/apply-model.worker.js`,
crate teks bersama `frontend/public/workers/TextAnalytics/statify-text-core` (**CORE**)
**Versi WASM:** `apply-model-v2-20261005a`

Dokumen ini ditulis untuk tiga pembaca sekaligus:

| Bagian | Untuk siapa | Isi |
|---|---|---|
| [A. Panduan pengguna](#a-panduan-pengguna) | Pengguna Statify | Fungsi menu, langkah pakai, setiap tab, kolom hasil, output, galat |
| [B. Landasan teori & metodologi](#b-landasan-teori--metodologi-bahan-skripsi) | Penulisan skripsi | Konsep *scoring*, rumus, penanganan data hilang/kategori baru/teks, evaluasi, contoh angka, keterbatasan |
| [C. Dokumentasi teknis](#c-dokumentasi-teknis-pengembang) | Pengembang | Arsitektur, registry, struktur file, payload/hasil, validasi, kode, test, build |

Dokumen kontrak yang mengikat: `../naive-bayes/AGENTS_V2.md` (v2, §8 dan §10) > `../naive-bayes/PLAN_V2.md` >
`AGENTS.md` (v1). Riwayat v1 ada di `PLAN.md`; laporan v2 (A1–A3, I1, B1, V1) ada di `../naive-bayes/plan-reports-v2/`.

---

## A. Panduan pengguna

### A.1 Apa yang dilakukan menu ini?

Apply Model **menerapkan model klasifikasi yang sudah dilatih** ke dataset yang sedang terbuka. Untuk setiap baris,
menu ini menghitung kelas prediksi dan probabilitasnya, lalu:

- menulis hasilnya sebagai **variabel baru** di Data View (variabel lama tidak pernah ditimpa),
- menampilkan ringkasan di Output Viewer, dan
- bila Anda memilih variabel kelas sebenarnya, menghitung metrik akurasi dan confusion matrix.

Saat ini model yang didukung adalah **Naive Bayes** hasil **Export Model** menu Naive Bayes (schema 1.0, 1.1, dan 2.0),
termasuk model dengan fitur teks (Raw Text atau Word-Vector). Menu ini tidak melatih model.

Alur umum:

```
Naive Bayes (latih + Export Model)  ──JSON──▶  Apply Model (muat model → petakan variabel → OK)  ──▶  kolom prediksi + Output Viewer
```

### A.2 Tab dan tombol

Tab: **Model** · **Variables** · **Save** · **Output**. Tab Variables, Save, dan Output nonaktif sampai model berhasil
dimuat. Footer: **Help** (menampilkan teks bantuan di bawah setiap kontrol), **OK**, **Reset**, **Cancel**.
Pengaturan disimpan saat OK (IndexedDB, key `"ApplyModel"`), termasuk model yang dimuat. Bila dataset berubah, hanya
pemetaan variabel dan nama kolom kustom yang disusun ulang (model tetap).

### A.3 Tab Model

**Model Source** (pilih salah satu):

| Pilihan | Keterangan |
|---|---|
| **Upload file (.json)** | Pilih file hasil Export Model (maks. 10 MB). |
| **From Output Viewer** | Daftar model Naive Bayes yang pernah dilatih di sesi Statify ini (diambil dari hasil "Export Model" di Output Viewer), terbaru di atas. |
| **Statify built-in model** | Katalog model bawaan (saat ini masih kosong). |

Setelah model valid dimuat, tampil kartu **Model Summary**: Algorithm, Schema version, Trained at, Target, Classes,
Features (nama + peran), parameter tambahan, dan untuk model v2 bagian **Text features** (sumber teks, likelihood,
jumlah term, alpha; `Raw text variable: ...` atau `Word-vector columns: n` dengan daftar yang dapat dibuka). Model
hanya-teks menampilkan catatan, bukan tabel fitur kosong. Model schema 1.0 diberi peringatan "format lama".

Bila file tidak valid, daftar galat (kode `AM_E_...`) tampil dan model tidak dipakai.

### A.4 Tab Variables

**Variable Mapping** — tabel per fitur model: **Feature**, **Role** (categorical/numerical), **Dataset variable**
(hanya variabel dengan measure yang cocok; variabel yang sudah dipakai fitur lain nonaktif), **Status**.
Tombol **Auto-map by name** memetakan otomatis: nama persis, lalu nama tanpa beda huruf besar/kecil bila hanya ada satu
kandidat. Aturan wajib:

- categorical ↔ variabel `nominal`/`ordinal`; numerical ↔ variabel `scale` bukan STRING;
- setiap fitur Numeric/Categorical **wajib** dipetakan; satu variabel hanya untuk satu fitur.

**Raw Text Variable** (hanya untuk model jalur Raw Text) — pilih satu variabel `STRING` berisi teks mentah; diisi
otomatis bila ada kolom bernama sama dengan variabel teks saat latih. Wajib diisi.

**Word-Vector Columns** (hanya untuk model jalur Word-Vector) — kolom dicocokkan otomatis berdasarkan nama, tanpa
tabel per kolom. Tampil satu baris ringkasan, misalnya:

> `3 dari 5 kolom vektor ditemukan; 2 dianggap 0.`

Klik **Show columns treated as 0** untuk melihat daftar kolom yang tidak ditemukan (dimuat bertahap 200 nama). Kolom
yang tidak ditemukan **tidak menghalangi** OK; nilainya dianggap 0. Bila tidak ada satu pun kolom yang cocok, muncul
peringatan karena semua baris tidak akan bisa diprediksi.

**Actual target (optional)** — variabel kelas sebenarnya (`nominal`/`ordinal`, bukan prediktor). Bila diisi, Output
menampilkan metrik evaluasi dan confusion matrix.

### A.5 Tab Save — kolom yang ditulis

| Kolom | Ditulis bila | Nama default | Tipe |
|---|---|---|---|
| Predicted value | selalu | `NB_PredictedValue` | NUMERIC bila semua nama kelas berupa angka, selain itu STRING; measure nominal |
| Predicted probability (predicted class) | dicentang (default ON) | `NB_PredictedProbability` | NUMERIC, scale, 4 desimal |
| Predicted probability for each class | dicentang (default OFF) | `NB_Probability_<kelas>` | NUMERIC, scale, 4 desimal |

- **Name prefix** mengganti awalan `NB`.
- **Use custom names** membuat setiap nama bisa diedit (wajib diisi, maks. 64 karakter, diawali huruf/`@`/`#`/`$`, bukan
  kata cadangan seperti `AND`, `OR`, `TO`, tidak boleh kembar).
- Kolom **Final name** menampilkan nama akhir; bila bentrok dengan variabel yang sudah ada, nama otomatis diberi
  akhiran dan ditandai peringatan.
- Baris yang tidak diprediksi dibiarkan kosong pada semua kolom hasil.

### A.6 Tab Output

Checkbox (default ON): Model Summary, Case Processing Summary, Prediction Distribution, Evaluation metrics, Confusion
matrix. Dua yang terakhir hanya aktif bila **Actual target** diisi.

### A.7 Hasil di Output Viewer ("Apply Model Result")

| Tabel | Isi |
|---|---|
| **Model Summary** | Source, Algorithm, Schema version, Trained at, Target, Classes, pemetaan fitur (`fitur → variabel (role)`), parameter (Smoothing alpha, Variance floor, Validation). Model v2: `Text source`, `Text likelihood`, `Text Variable` (raw) atau `Word-Vector Columns: m of V mapped` dan `Text features zero-filled: n` (vector), `Rows with empty text: n` (raw). |
| **Case Processing Summary** | Total rows, Scored, Not scored (all predictors missing), Scored with ≥1 missing predictor, Scored with ≥1 unseen category; bila evaluasi: Evaluated, Excluded (actual missing), Excluded (actual class not in model). |
| **Prediction Distribution** | Jumlah dan persentase prediksi per kelas, baris Not scored, Total. |
| **Saved Variables** | Column, Final name, Type, Measure. |
| **Evaluation Metrics**, **Cohen's Kappa**, **Confusion Matrix** | Bila Actual target diisi; format sama dengan menu Naive Bayes. |

Toast sukses menyebut jumlah baris yang diprediksi dan nama kolom baru.

### A.8 Aturan baris yang tidak diprediksi

- Baris yang **semua** prediktornya kosong tidak diprediksi (**Not scored**); kolom hasilnya kosong.
- Baris dengan sebagian prediktor kosong tetap diprediksi dari prediktor yang ada.
- **Teks** kosong/spasi dihitung sebagai prediktor kosong. Bila masih ada prediktor lain, teks kosong diperlakukan
  sebagai dokumen tanpa kata dan baris tetap diprediksi. Model hanya-teks + teks kosong → Not scored.
- Model Word-Vector: teks dianggap kosong bila semua kolom vektor yang **ditemukan** bernilai kosong. Kolom yang diisi 0
  karena tidak ditemukan tidak dihitung sebagai "ada nilai".
- Kategori yang tidak pernah muncul saat latih (mis. kota baru) tidak menyebabkan galat (lihat B.3).

### A.9 Galat dan peringatan yang sering muncul

| Kode | Arti dan tindakan |
|---|---|
| `AM_E_PARSE`, `AM_E_FILE_TOO_LARGE`, `AM_E_NOT_OBJECT` | File bukan JSON valid / > 10 MB. |
| `AM_E_MODEL_TYPE_UNSUPPORTED`, `AM_E_SCHEMA_VERSION_UNSUPPORTED` | Bukan model Naive Bayes atau versi selain 1.0/1.1/2.0. |
| `AM_E_FIELD_MISSING`, `AM_E_FIELD_TYPE`, `AM_E_PRIORS_*`, `AM_E_DISTRIBUTION_*`, `AM_E_GAUSSIAN_*`, `AM_E_COUNTS_*` | Isi model rusak/diubah manual. Ekspor ulang dari menu Naive Bayes. |
| `AM_E_NB2_TEXT_SHAPE`, `AM_E_NB2_TEXT_SOURCE`, `AM_E_NB2_LIKELIHOOD`, `AM_E_NB2_COMPLEMENT_MIXED` | Blok teks model 2.0 tidak konsisten. |
| `AM_E_MAP_UNMAPPED`, `AM_E_MAP_ROLE_MISMATCH`, `AM_E_MAP_NUMERIC_TYPE`, `AM_E_MAP_DUPLICATE` | Perbaiki pemetaan di tab Variables. |
| `AM_E_MAP_RAW_TEXT_UNMAPPED`, `AM_E_MAP_RAW_TEXT_TYPE` | Raw Text Variable belum dipilih / bukan STRING. |
| `AM_E_TEXT_NEGATIVE` | Kolom vektor di dataset berisi nilai negatif (menyebut kolomnya). |
| `AM_E_NAME_*` | Nama kolom kustom tidak sah. |
| `AM_E_NO_ROWS` | Tidak ada baris data pada variabel yang dipetakan. |
| `AM_W_LEGACY_SCHEMA` | Model 1.0: kategori baru dilewati. Ekspor ulang untuk hasil konsisten. |
| `AM_W_ROWS_NOT_SCORED`, `AM_W_UNSEEN_CATEGORY`, `AM_W_ACTUAL_UNKNOWN_CLASS`, `AM_W_NAME_ADJUSTED` | Informasi jumlah baris tak diprediksi, kategori baru, kelas aktual tak dikenal, nama disesuaikan. |
| `AM_I_TEXT_ZERO_FILLED`, `AM_W_TEXT_ALL_ZERO_FILLED` | Sebagian / semua kolom vektor tidak ditemukan dan diisi 0. |

### A.10 Tips

- Untuk teks, gunakan model **Raw Text**: resep pra-pemrosesan ikut tersimpan sehingga teks baru diolah persis seperti
  saat latih. Model Word-Vector bergantung pada kolom `VEC_*` di dataset baru; bila kolom itu dibuat dengan menjalankan
  String to Word Vector ulang di data baru, kosakata/IDF/normalisasinya dihitung dari data baru (tidak setara dengan saat
  latih).
- Nama variabel di dataset baru sebaiknya sama dengan saat latih agar Auto-map bekerja.
- Kolom teks dibaca apa adanya (tidak diubah jadi angka), jadi teks seperti "2 paslon ..." aman.

---

## B. Landasan teori & metodologi (bahan skripsi)

### B.1 Konsep *scoring*

Model Naive Bayes yang diekspor menyimpan **parameter** hasil pelatihan: prior kelas, distribusi kategori per kelas,
mean/varians per kelas, dan (v2) bobot log per term. Apply Model tidak melatih ulang; ia menghitung skor log setiap
kelas untuk setiap baris baru memakai rumus yang **identik** dengan menu Naive Bayes (dibuktikan dengan test angka
acuan di kedua crate):

```
s_c = ln prior_c + Σ_numeric ln N(x_j; μ_jc, σ²_jc) + Σ_categorical ln P(x_j | c) + kontribusi Text
P(c | x) = exp(s_c − m) / Σ_k exp(s_k − m),  m = max_k s_k
ŷ = argmax_c s_c   (seri: kelas pertama menurut urutan alfabetis byte-wise; menang hanya bila lebih besar)
```

`safe_ln(p) = ln p` untuk `p > 0`, selain itu `ln(f64::MIN_POSITIVE)`. Probabilitas yang ditulis dibulatkan 4 desimal;
kelas prediksi ditentukan dari skor mentah.

### B.2 Normalisasi nilai sel (identik dengan Naive Bayes)

- Missing: sel kosong/spasi, angka tidak finit, `null`.
- Label kategori: teks di-*trim*; angka bulat ditulis tanpa desimal (`1.0` → `"1"`); nilai kosong → `"(Missing)"`.
- Pencocokan kategori peka huruf besar/kecil.

### B.3 Kategori baru (*unseen category*)

| Schema | Perlakuan |
|---|---|
| 1.1 / 2.0 | `P = α / (class_total_c + α·K)`, persis seperti Laplace smoothing saat evaluasi di Naive Bayes (memakai `class_totals` yang disimpan). |
| 1.0 | Kontribusi fitur itu dilewati untuk baris tersebut (model lama tidak menyimpan `class_totals`) + peringatan. |

### B.4 Fitur Text (v2)

- **Raw Text:** `x = CORE::transform(recipe, teks_baru)`. Resep memuat konfigurasi, daftar stopword final, kosakata,
  IDF, dan rata-rata norma dari pelatihan; tidak ada statistik yang dihitung ulang dari data baru, dan kata di luar
  kosakata diabaikan. Ini menjamin teks baru direpresentasikan pada ruang fitur yang sama dengan data latih.
- **Word-Vector:** kolom model dipetakan ke kolom dataset berdasarkan nama; kolom tak ditemukan diisi 0; `null`/non-finit
  → 0; nilai negatif → galat.
- Kontribusi dihitung dengan `CORE::nb_text::score_rows` memakai bobot model: Multinomial `Σ x·L`, Bernoulli
  `Σ [b·L + (1−b)·A]`, Complement `Σ x·L` **tanpa prior** (K ≥ 2). Rumus lengkap ada di
  `../naive-bayes/DOKUMENTASI.md` B.4–B.6.

### B.5 Contoh perhitungan acuan

**Model campuran v1** (`AGENTS.md` §5.6; model 6 baris, α = 1): kelas `No`/`Yes`, prior 0,5/0,5; `Outlook` categorical,
`Temp` numerical (`No: μ = 84, σ² = 56/3`; `Yes: μ = 72, σ² = 8/3`).

| Baris | Outlook | Temp | s_No | s_Yes | P(No) | P(Yes) | Prediksi |
|---|---|---|---|---|---|---|---|
| T1 | Overcast | 85 | −3,7954 | −35,5818 | 1,0000 | 0,0000 | No |
| T2 | Sunny | 71 | −8,7009 | −2,9831 | 0,0033 | 0,9967 | Yes |
| T3 | Foggy (baru, 1.1) | 72 | −8,7244 | −3,8943 | 0,0079 | 0,9921 | Yes |
| T4 | Sunny | (kosong) | −1,7918 | −1,3863 | 0,4000 | 0,6000 | Yes |
| T5 | (kosong) | (kosong) | – | – | – | – | Not scored |
| T6 | (kosong → "(Missing)", baru) | 80 | −5,2958 | −15,8943 | 1,0000 | 0,0000 | No |
| T7 | Foggy (baru, **1.0** → dilewati) | 72 | −6,9326 | −2,1025 | 0,0079 | 0,9921 | Yes |

Contoh T3: kategori "Foggy" tidak ada di model, maka `P = 1/(3 + 1·3) = 1/6` untuk kedua kelas (class_total 3, K = 3).

**Fitur Text** (golden AGENTS_V2 §6.7): model dilatih pada tiga dokumen ("saya suka makan nasi" pos, "saya tidak suka
nasi" neg, "makan makan makan" pos). Teks baru "makan nasi enak" (kata `enak` tidak dikenal) menghasilkan
P(pos) = **0,849057** (Multinomial), **0,944708** (Bernoulli), **0,737705** (Complement). Angka yang sama diuji di crate
Apply Model lewat jalur raw (resep CORE) maupun vector, dan skor Apply Model sama dengan skor Naive Bayes dengan
toleransi 1e-9.

### B.6 Evaluasi (bila Actual target diisi)

Baris dikecualikan bila tidak diprediksi, kelas aktualnya kosong, atau kelas aktualnya tidak ada di model. Sisanya
dibandingkan dengan prediksi: confusion matrix (baris actual, kolom predicted), Precision, Recall, F1, Accuracy per
kelas, macro/weighted/micro average, overall accuracy, dan Cohen's Kappa — memakai modul yang disalin persis dari
Naive Bayes.

### B.7 Keterbatasan (untuk dicantumkan)

1. Hanya algoritma Naive Bayes; arsitektur sudah siap untuk algoritma lain.
2. Model Word-Vector tidak membawa resep; kesetaraan nilai kolom di data baru menjadi tanggung jawab pengguna.
3. Kolom vektor yang tidak ditemukan diisi 0 (bukan diblokir), sehingga prediksi tetap jalan walau informasinya berkurang.
4. Nilai missing yang didefinisikan pengguna (`Variable.missing`) tidak dikenali; hanya sel kosong/NaN.
5. Tidak ada threshold probabilitas kustom, prior kustom, bobot kasus, atau filter baris.
6. Model schema 1.0 melewati kategori baru (tidak setara dengan evaluasi Naive Bayes).

---

## C. Dokumentasi teknis (pengembang)

### C.1 Arsitektur

```
dialogs/apply-model-main.tsx (container; IndexedDB "ApplyModel"; fingerprint dataset)
 ├─ dialogs/model-tab.tsx ──▶ services/model-loader.ts ──▶ adapters/registry.ts::validateAnyModel
 │                                                         └─ adapters/naive-bayes-adapter.ts (1.0/1.1/2.0)
 ├─ dialogs/variables-tab.tsx (+ collapsible-name-list.tsx) ──▶ hooks/useApplyModelMappingRules.ts
 ├─ dialogs/save-tab.tsx ──▶ hooks/useApplyModelSaveRules.ts
 ├─ dialogs/output-tab.tsx ──▶ hooks/useApplyModelOutputRules.ts
 └─ hooks/useApplyModelValidation.ts (isValid = model ada && tidak ada issue severity "error")
        │ OK → services/apply-model-analysis.ts::applyModel
        │   nama akhir kolom dihitung dulu; payload §3.6 + text (§10.3)
        ▼ postMessage
public/workers/Classify/ApplyModel/apply-model.worker.js (APPLY_MODEL_WASM_VERSION)
        ▼ new ApplyModelAnalysis(predictors, predictorDefs, mapping, actual, actualDefs, model, text)
rust/src/wasm/function.rs::run_apply_model_with_text
   scoring::build_scorer(model) → NaiveBayesScorer (validasi lapis kedua, scoring/text.rs untuk blok text)
   → per baris score_row_with_text → stats/posterior.rs → summary.rs → evaluation.rs (+ classification_table.rs)
        ▼ ApplyModelRawResult
services/apply-model-formatter.ts → services/apply-model-output.ts (Output Viewer)
services/apply-model-save-variables.ts → useVariableStore.addVariables (satu kali)
```

Prinsip: komputasi di Rust; orkestrasi, penamaan kolom, dan penulisan dataset di TS. Semua bagian selain adapter dan
scorer bersifat **generik** (tidak boleh ada `if (modelType === "naive_bayes")` di luarnya).

### C.2 Registry multi-algoritma

- **TS** (`adapters/types.ts`): `ClassifierModelAdapter { modelType, algorithmLabel, supportedSchemaVersions,
  defaultOutputPrefix, resultStoreSource?: { componentKey, payloadKey }, validate(raw) }` → `ModelDescriptor`
  (`targetName`, `classes`, `features[{name, role}]`, `summaryRows`, `warnings`, `text?`). Registry:
  `CLASSIFIER_MODEL_ADAPTERS = { naive_bayes }`. NB: prefix `"NB"`, `componentKey "Export Model"`,
  `payloadKey "naiveBayesTrainedModel"`, versi `["1.0","1.1","2.0"]`.
- **Rust** (`scoring/mod.rs`): trait `ClassifierScorer` (`classes`, `features`, `summary_parameters`,
  `is_legacy_unseen_handling`, `score_row`, default `text_model`/`score_row_with_text`); `build_scorer(model_json)`
  dispatch berdasarkan `model_type`. `RowScore = NotScored | Scored { log_scores, had_missing, had_unseen, skipped_unseen }`.

Menambah algoritma baru = satu adapter TS + satu scorer Rust + satu baris registrasi di masing-masing sisi.

### C.3 Struktur file

| File | Tanggung jawab |
|---|---|
| `types/model-schema.ts` | Tipe JSON model NB 1.0/1.1/2.0 (`NaiveBayesExportText`, `TextVectorizerRecipe`). |
| `types/apply-model.ts` | State form (`model`, `variables` + `RawTextVar`/`VectorMapping`, `save`, `output`). |
| `types/apply-model-worker.ts` | `ApplyModelWorkerPayload`, `ApplyModelTextPayload`, `ApplyModelRawResult`. |
| `constants/apply-model-codes.ts` | Semua kode `AM_E_*`/`AM_W_*`/`AM_I_*` + pesan Bahasa Indonesia; severity `error`/`warning`/`info`. |
| `constants/apply-model-default.ts`, `constants/builtin-models.ts` | Default form; katalog bawaan (kosong). |
| `adapters/*` | Registry, adapter NB (validasi langkah 1–13, descriptor). |
| `hooks/useApplyModelMappingRules.ts` | `autoMapFeatures`, `validateMapping`, `summarizeVectorMapping`, `formatVectorMappingSummary`, `getEligibleActualTargetVariables`. |
| `hooks/useApplyModelSaveRules.ts` | Spesifikasi kolom output, validasi nama, `resolveFinalOutputNames`, `resolvePredictedColumnType`. |
| `hooks/useApplyModelOutputRules.ts`, `hooks/useApplyModelValidation.ts` | Checkbox output; validasi terpusat. |
| `dialogs/*` | UI (container, tab Model/Variables/Save/Output, `collapsible-name-list`). |
| `services/model-loader.ts` | Muat dari file (≤ 10 MB) / result store / bawaan → `validateAnyModel`. |
| `services/apply-model-analysis.ts` | `applyModel`, payload, `readRawTextValues`, `APPLY_MODEL_WASM_VERSION`. |
| `services/apply-model-formatter.ts`, `apply-model-output.ts` | Hasil → tabel → Output Viewer (components unik `"Apply Model ..."`). |
| `services/apply-model-save-variables.ts` | Definisi variabel + `CellUpdate[]`, panggil `addVariables` sekali. |
| `services/apply-model-error-messages.ts` | `getUserFriendlyApplyModelError` (kode `AM_E_[A-Z0-9_]+` di depan pesan). |
| `services/__fixtures__/` | Fixture model (v1.0, v1.1, v2.0 raw/vector golden) + export nyata uji manual B1. |

Rust (`rust/src/`):

| File | Isi |
|---|---|
| `models/payload.rs` | Payload (+ `TextPayload { source, mapped_columns, values }`, `TextValues` *untagged* raw/vector). |
| `models/data.rs`, `models/result.rs` | Struktur data & hasil. |
| `scoring/naive_bayes.rs` | `NaiveBayesScorer` (parsing 1.0/1.1/2.0, validasi lapis kedua, `score_row_inner`, K5). |
| `scoring/text.rs` | Validasi blok `text` (§10.1), `TextModel::prepare` (raw → `CORE::transform`; vector → CSR zero-fill), skor via `CORE::nb_text`. |
| `stats/value_label.rs` | Salinan `is_missing_value`/`data_value_to_label` NB (header sumber). |
| `stats/posterior.rs`, `summary.rs`, `evaluation.rs`, `classification_table.rs` | Generik: posterior, ringkasan, evaluasi (salinan NB). |
| `wasm/constructor.rs`, `wasm/function.rs` | Kelas WASM `ApplyModelAnalysis` (argumen ke-7 `text` opsional), `run_apply_model_with_text`. |
| `tests/text_scoring.rs` | 39 test v2 (golden raw/vector, K5, negatif, validasi). |

### C.4 Payload dan hasil

```ts
type ApplyModelWorkerPayload = {
  predictors: Record<string, string | number | null>[][]; // satu slice per fitur, urutan descriptor.features
  predictorDefs: unknown[][];
  mapping: Array<{ feature: string; variable: string }>;
  actual: Record<string, string | number | null>[][];     // [] atau satu slice
  actualDefs: unknown[][];
  model: unknown;                                          // JSON model apa adanya
  text?: ApplyModelTextPayload;                            // hanya bila model punya Text
};
type ApplyModelTextPayload =
  | { source: "raw"; values: (string | null)[] }
  | { source: "vector"; mapped_columns: number[]; values: (number | null)[][] }; // indeks ke model.text.columns
```

- Semua slice diambil dengan satu `getSlicedData` agar panjang baris sama. Teks raw dibaca langsung dari data (tanpa
  `parseFloat`); kosong/spasi → `null`. Jumlah baris raw = maks(baris slice lain, baris teks terakhir berisi + 1).
- Model tanpa Text: kunci `text` tidak ada (payload v1 identik). Model dengan Text tanpa payload → `AM_E_PAYLOAD`.
- Respons worker: `{ success: true, data: ApplyModelRawResult }` atau `{ success: false, error }`.

`ApplyModelRawResult` berisi `model_summary` (termasuk `parameters` label/nilai — v2 menambah `Text source`,
`Text likelihood`, `Text features zero-filled`, `Rows with empty text`), `case_processing_summary`,
`prediction_distribution`, `predictions` (`predicted`, `max_probability`, `class_probabilities[kelas][baris]`,
dibulatkan 4 desimal), `evaluation` (null bila tanpa actual), `warnings`.

### C.5 Validasi model (dua lapis, kode sama)

TS (`naive-bayes-adapter.ts`) saat dimuat, Rust (`naive_bayes.rs`/`text.rs`) saat scoring:

1. `schema_version` ∈ {1.0, 1.1, 2.0} (stop), 2. field wajib (stop), 3. tipe field, 4. kelas kosong/duplikat,
5. prior (panjang, rentang, Σ = 1 ± 1e-6), 6. `smoothing_alpha`/`variance_floor` > 0, 7. `feature_order` (boleh kosong
hanya untuk model 2.0 hanya-Text), 8. role, 9. distribusi categorical (Σ = 1 ± 1e-6), 10. Gaussian (varians > 0),
11. 1.1/2.0: `class_counts` & `class_totals` konsisten, 12. 2.0: `likelihood` per fitur, `min_variance` untuk
`gaussian_minstd`, 13. 2.0: blok `text` — panjang `terms`/`log_weights`/`class_term_counts`/`columns`
(`AM_E_NB2_TEXT_SHAPE`), raw butuh `recipe` + `raw_variable` dan vector butuh `columns` (`AM_E_NB2_TEXT_SOURCE`),
likelihood dikenal dan `uses_class_prior` konsisten (Complement K ≥ 2 = false, lainnya true) (`AM_E_NB2_LIKELIHOOD`),
Complement tidak boleh bersama fitur lain (`AM_E_NB2_COMPLEMENT_MIXED`). Rust menambah pemeriksaan tanda/finit
`log_weights`, `terms` unik, `recipe.vocabulary == terms`, panjang `idf`/`doc_freq`.

Pesan Rust selalu berbentuk `"AM_E_XXX: detail"`.

### C.6 Penulisan kolom

`resolveFinalOutputNames` memproses nama berurutan dengan `processVariableName` terhadap variabel yang ada + nama
sebelumnya (identik dengan `addVariables`, sehingga pratinjau = hasil). `saveApplyModelVariables` membentuk definisi
(`columns 64`, `role none`, `missing null`, width 12/64) dan `CellUpdate[]` (sel `null` dilewati), lalu memanggil
`useVariableStore.getState().addVariables(defs, updates)` **sekali**. Variabel lama tidak pernah diubah.

### C.7 Test

| Lapisan | Lokasi | Hasil terakhir (2026-10-05) |
|---|---|---|
| Rust AM | `rust/src/**` (unit) + `rust/tests/text_scoring.rs` | 117 + 39 = 156 lulus |
| Jest AM | `adapters/`, `constants/`, `hooks/`, `dialogs/`, `services/` `__tests__` | 25 suite / 430 lulus |

Test penting: contoh numerik T1–T7 (§B.5, toleransi skor 1e-9), golden Text raw & vector (1e-6; NB↔AM 1e-9),
K5/V11 (teks kosong, vector semua null, semua kolom tak terpetakan), negatif, validasi 2.0, UI 2.500 kolom vektor.

```bash
cd frontend/components/Modals/Analyze/Classify/apply-model/rust && cargo test
# Jest HARUS dari folder frontend
cd frontend && npx jest components/Modals/Analyze/Classify/apply-model --coverage=false
```

### C.8 Build WASM (PowerShell, dari root repo)

```powershell
cd frontend\components\Modals\Analyze\Classify\apply-model\rust ; wasm-pack build --target web --release ; cd ..\..\..\..\..\..\..
$src = "frontend\components\Modals\Analyze\Classify\apply-model\rust\pkg"
$dst = "frontend\public\workers\Classify\ApplyModel\pkg"
Copy-Item -Force "$src\wasm.js","$src\wasm_bg.wasm","$src\wasm.d.ts","$src\wasm_bg.wasm.d.ts" $dst
```

Setelah mengganti `pkg`, naikkan `APPLY_MODEL_WASM_VERSION` di `services/apply-model-analysis.ts` **dan** di worker
(nilainya harus sama). Ukuran `wasm_bg.wasm` ±1,6 MB (649 kB terkompresi) karena CORE.

### C.9 Batas modul dan larangan

- Apply Model boleh mengimpor read-only modul NB tertentu (tipe & builder tabel formatter NB). Kode Rust NB yang
  dibutuhkan **disalin** dengan header sumber (P6), kecuali teks yang memakai CORE lewat path dependency (V13).
- Fungsi yang disalin dari NB (`data_value_to_label`, `is_missing_value`, `classification_table`, rumus Gaussian/
  Categorical, tie-break) harus tetap identik dengan NB.
- Komponen bersama (`VariableListManager`, `ui/*`, store global) dan `components` Output Viewer milik NB tidak boleh
  dipakai ulang namanya (pakai `"Apply Model ..."`).

### C.10 Keterbatasan teknis yang diketahui

1. Payload vector padat `baris × kolom terpetakan`; dataset dengan ribuan kolom berat di memori.
2. Deserialisasi `serde_wasm_bindgen` payload Text hanya teruji lewat uji manual (B1 Uji 4–5), bukan test otomatis.
3. Export nyata dari uji manual tersimpan di `services/__fixtures__/` dengan nama tidak baku dan belum dipakai test
   adapter (usulan tindak lanjut V1).
4. Katalog model bawaan masih kosong.

### C.11 Riwayat singkat

- **v1 (`PLAN.md`):** schema NB 1.1, adapter/registry, mapping, scoring Rust, kolom output, evaluasi.
- **v2 (`../naive-bayes/PLAN_V2.md`):** A1 schema 2.0 & mapping Text, A2 scorer 2.0 memakai CORE, A3 UI & payload Text,
  I1 worker meneruskan `text`, B1 build & uji manual (Uji 4 raw, Uji 5 vector, Uji F validator), V1 verifikasi.
