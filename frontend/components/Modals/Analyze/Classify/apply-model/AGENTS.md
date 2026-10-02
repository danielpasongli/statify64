# AGENTS.md — Menu Analyze → Classify → Apply Model

Dokumen ini adalah **kontrak kerja yang mengikat** untuk siapa pun (manusia atau agent) yang mengimplementasikan menu **Apply Model** di `frontend/components/Modals/Analyze/Classify/apply-model/`. Bila kode menyimpang dari dokumen ini tanpa revisi dokumen yang disetujui pemilik produk, anggap itu **bug desain**, bukan variasi yang sah.

Dokumen ini murni desain & kontrak. **Tidak ada kode implementasi di sini.** Urutan kerja langkah-demi-langkah ada di `PLAN.md` (folder yang sama).

Konvensi rujukan path di dokumen ini:

- `FE/` = `frontend/`
- `NB/` = `frontend/components/Modals/Analyze/Classify/naive-bayes/`
- `KNN/` = `frontend/components/Modals/Analyze/Classify/nearest-neighbor/`
- `AM/` = `frontend/components/Modals/Analyze/Classify/apply-model/` (folder menu ini)

---

## 0. Keputusan pemilik produk (dasar seluruh kontrak)

Keputusan berikut sudah dikonfirmasi dan **tidak boleh** diubah oleh agent pelaksana:

| # | Topik | Keputusan |
|---|---|---|
| K1 | Sumber model | Tiga sumber: (a) file JSON yang di-upload pengguna, (b) model hasil run Naive Bayes yang tersimpan di result store / Output Viewer, (c) model bawaan Statify (katalog; isinya dibuat belakangan — saat ini katalog **kosong**). |
| K2 | Schema export Naive Bayes | Export NB dinaikkan ke **schema `1.1`**: tambah `target.class_counts` dan `class_totals` per fitur categorical di `NB/rust/src/stats/save.rs`, lalu WASM NB di-build ulang. Apply Model tetap menerima file `1.0` (lihat §4.4). |
| K3 | Engine scoring | **Crate Rust/WASM baru** milik Apply Model + worker-nya sendiri (seragam dengan pola modul Classify lain). |
| K4 | Pemetaan variabel | Auto-match berdasarkan nama (persis, lalu case-insensitive bila unik) + override manual per fitur. Ketidakcocokan peran/measure **diblokir**. Semua fitur wajib dipetakan. |
| K5 | Baris tanpa prediktor | Baris yang **seluruh** prediktornya missing → **tidak diprediksi** (semua kolom output kosong), dihitung di ringkasan. |
| K6 | Kolom output | Predicted value (selalu), max probability (opsional, default ON), probabilitas per kelas (opsional, default OFF). Prefix bisa diubah; **setiap nama kolom bisa diedit pengguna**. Bentrok nama dengan variabel yang sudah ada → akhiran otomatis via `processVariableName` + pemberitahuan. Kolom predicted bertipe NUMERIC bila semua nama kelas numerik, selain itu STRING; measure nominal. |
| K7 | Output Viewer | Ringkasan model + Case Processing Summary + distribusi prediksi; **plus** confusion matrix & metrik akurasi bila pengguna memetakan variabel target sebenarnya (opsional). Memakai ulang builder tabel dari formatter NB. |
| K8 | Validasi kompatibilitas | Ketat: `model_type` harus terdaftar di registry, `schema_version` harus didukung, konsistensi internal dicek (toleransi 1e-6). Setiap kegagalan punya kode error. |
| K9 | Dataset sasaran | Dataset **aktif** (yang sedang terbuka di Statify), **semua baris** (sampai baris terakhir yang berisi data pada variabel yang dipetakan). |
| K10 | Penempatan UI | Analyze → Classify → "Apply Model" setelah "Naive Bayes", dipisah `MenubarSeparator`. Sidebar kanan dengan **lebar 40%** (sama dengan NB/KNN). Key IndexedDB `"ApplyModel"`. Bahasa: label UI bahasa Inggris, toast/pesan error bahasa Indonesia (sama dengan NB). |
| K11 | Dokumen NB | `NB/AGENTS.md` sudah diperbarui sekali (revisi Apply Model) agar sinkron dengan kode & schema 1.1. Pembaruan ini **khusus kasus ini**; agent pelaksana Apply Model **tidak** boleh mengedit `NB/AGENTS.md` lagi. |

---

## 1. Tujuan & Ruang Lingkup

**Tujuan.** Menyediakan menu yang menerapkan model klasifikasi **yang sudah dilatih** ke dataset aktif untuk menghasilkan prediksi per baris, menulis hasilnya sebagai variabel baru di Data View, dan menampilkan ringkasan di Output Viewer. Saat ini hanya algoritma **Naive Bayes** (`model_type: "naive_bayes"`) yang didukung, tetapi arsitekturnya (registry adapter di TS + registry scorer di Rust) harus memungkinkan algoritma lain ditambahkan **tanpa refactor** — cukup menambah satu adapter TS + satu scorer Rust + satu baris registrasi di masing-masing sisi.

**In-scope (wajib):**

1. Memuat model dari tiga sumber (K1) dan memvalidasinya (K8).
2. Menampilkan ringkasan model yang dimuat (target, kelas, fitur + perannya, parameter).
3. Pemetaan fitur model → variabel dataset (auto + manual), opsional memetakan variabel target sebenarnya.
4. Scoring Naive Bayes di Rust/WASM, konsisten dengan `NB/rust/src/stats/prediction.rs` (lihat §5).
5. Menulis kolom output ke dataset aktif (K6).
6. Output Viewer: Model Summary, Case Processing Summary, Prediction Distribution, dan (jika target sebenarnya dipetakan) Evaluation Metrics + Cohen's Kappa + Confusion Matrix.
7. Persistensi form via IndexedDB, Reset, Cancel, mode bantuan (Help).
8. Perubahan export NB ke schema `1.1` (K2) — satu-satunya perubahan di folder `NB/` yang diizinkan, terbatas pada daftar file di §7.2.
9. Infrastruktur katalog model bawaan (K1c) dengan katalog **kosong**.

**Out-of-scope (dilarang tanpa revisi dokumen ini):**

- Melatih model apa pun (training tetap di menu NB).
- Algoritma selain Naive Bayes (hanya titik ekstensinya yang disiapkan).
- Mengisi katalog model bawaan dengan model sungguhan (pekerjaan terpisah nanti).
- Menimpa (overwrite) variabel yang sudah ada di dataset. Apply Model **selalu** membuat variabel baru.
- Filter/subset baris, bobot kasus (case weights), threshold/cut-off probabilitas kustom, prior kustom.
- Menangani user-defined missing values (`Variable.missing`). Konsisten dengan NB: `getVarDefs` (`FE/hooks/useVariable.ts:158`) selalu mengirim `missing: []`, jadi hanya sel kosong/NaN yang dianggap missing.
- Mengekspor ulang model, mengedit model, atau menggabungkan model.
- Value labels untuk kolom predicted (model tidak membawa value labels target).
- Format model lain (PMML, ONNX, dsb.).

---

## 2. Prinsip Desain yang Mengikat

P1. **Kontrak model = file JSON export NB.** Apply Model tidak memiliki format model sendiri. Skema yang dibaca adalah persis `ExportedModel` di `NB/rust/src/stats/save.rs` (schema `1.0` dan `1.1`). Nama field tidak boleh diubah.

P2. **Ekstensibilitas multi-algoritma lewat dua registry yang sejajar:**

- **TS:** `ClassifierModelAdapter` (lihat §3.2) di `AM/adapters/`. Registry memetakan `model_type` → adapter. Adapter bertanggung jawab atas validasi skema untuk UI, deskripsi model (fitur, kelas, peran) dan prefix nama kolom default.
- **Rust:** trait `ClassifierScorer` (lihat §5.1) di `AM/rust/src/scoring/`. Fungsi `build_scorer(model_json)` melakukan dispatch berdasarkan `model_type`.
- Seluruh komponen lain (UI, mapping, penulisan kolom, posterior, distribusi, evaluasi, output) **generik** dan hanya bergantung pada `ModelDescriptor` (TS) / `ClassifierScorer` (Rust). **Dilarang** menaruh `if (modelType === "naive_bayes")` di luar file adapter/scorer NB dan file registry.

P3. **Validasi dua lapis dengan kode error yang sama.** TS memvalidasi model saat dimuat (agar UI bisa menampilkan fitur); Rust memvalidasi ulang saat scoring (pengaman). Kedua sisi memakai daftar kode di §4.5 dan pesan Rust **selalu** diawali kode (`"AM_E_xxx: ..."`).

P4. **Konsistensi angka dengan NB.** Rumus scoring, normalisasi label kategori, definisi missing, lantai log, dan tie-break **wajib** identik dengan NB (rujukan baris di §5). Bila ada keraguan, perilaku NB yang benar.

P5. **Komputasi di Rust, orkestrasi & I/O store di TS.** Rust tidak menyentuh store; TS tidak menghitung probabilitas. Penamaan kolom & penulisan ke dataset dilakukan TS.

P6. **Crate Rust berdiri sendiri.** `AM/rust` adalah crate wasm-pack independen (pola NB, lihat `NB/PLAN.md` §1). Kode yang dibutuhkan dari NB (`classification_table.rs`, `utils/error.rs`, struct `VariableDefinition`/`DataRecord`) **disalin** ke crate ini dengan header komentar sumbernya — **bukan** di-import lintas crate.

P7. **Folder referensi read-only.** `KNN/`, `NB/` (kecuali daftar §7.2), dan komponen bersama tidak boleh diubah. Import **read-only** dari modul NB yang disebut eksplisit di §7.3 diizinkan.

---

## 3. Kontrak Data (TypeScript)

### 3.1 Skema model yang dimuat (`AM/types/model-schema.ts`)

Tipe berikut adalah representasi TS dari `ExportedModel` (`NB/rust/src/stats/save.rs:139-159`). Field bertanda **(1.1)** hanya wajib bila `schema_version === "1.1"`.

```ts
export type NaiveBayesSchemaVersion = "1.0" | "1.1";

export type NaiveBayesExportValidationConfig = {
  method: "holdout" | "kfold";
  training_percentage: number | null;
  holdout_percentage: number | null;
  folds: number | null;
  seed: number | null;
};

export type NaiveBayesExportCategoricalFeature = {
  name: string;
  role: "categorical";
  categories: string[];                       // urutan = index probabilitas
  distribution: Record<string, number[]>;     // class -> prob per kategori (sudah smoothing)
  class_totals?: Record<string, number>;      // (1.1) class -> jumlah baris kelas itu saat training
};

export type NaiveBayesExportNumericalFeature = {
  name: string;
  role: "numerical";
  mean: Record<string, number>;               // class -> mean
  variance: Record<string, number>;           // class -> variance (SUDAH melalui variance floor)
};

export type NaiveBayesExportFeature =
  | NaiveBayesExportCategoricalFeature
  | NaiveBayesExportNumericalFeature;

export type NaiveBayesExportedModel = {
  schema_version: NaiveBayesSchemaVersion;
  model_type: "naive_bayes";
  trained_at: string;                         // ISO 8601
  target: {
    name: string;
    classes: string[];                        // urutan alfabetis (byte-wise) dari NB
    class_priors: number[];                   // sejajar index dengan classes
    class_counts?: number[];                  // (1.1) sejajar index dengan classes, integer >= 0
  };
  features: NaiveBayesExportFeature[];
  smoothing_alpha: number;                    // > 0
  variance_floor: number;                     // > 0
  feature_order: string[];
  label_mapping: Record<string, number>;
  validation_config: NaiveBayesExportValidationConfig;
  missing_value_policy: string;
  unseen_category_policy: string;
};
```

Field yang **wajib ada** di kedua versi: semua field di atas kecuali yang bertanda `?`. Field tambahan yang tidak dikenal **diabaikan** (bukan error).

### 3.2 Adapter, descriptor, dan registry (`AM/adapters/`)

```ts
// AM/adapters/types.ts
export type FeatureRole = "categorical" | "numerical";

export type ModelFeatureDescriptor = {
  name: string;          // nama fitur di model
  role: FeatureRole;     // menentukan measure variabel dataset yang boleh dipetakan (§3.4)
};

export type ModelDescriptor = {
  modelType: string;           // mis. "naive_bayes"
  algorithmLabel: string;      // mis. "Naive Bayes"
  schemaVersion: string;
  trainedAt: string | null;
  targetName: string;
  classes: string[];
  features: ModelFeatureDescriptor[];       // urutan = feature_order model
  summaryRows: Array<{ label: string; value: string }>; // baris tambahan untuk Model Summary
  warnings: ApplyModelWarningCode[];        // mis. AM_W_LEGACY_SCHEMA untuk NB 1.0
};

export type ModelValidationResult =
  | { ok: true; model: unknown; descriptor: ModelDescriptor }
  | { ok: false; errors: ApplyModelIssue[] };

export interface ClassifierModelAdapter {
  modelType: string;                        // kunci registry, sama persis dengan field model_type
  algorithmLabel: string;
  supportedSchemaVersions: readonly string[];
  defaultOutputPrefix: string;              // "NB" untuk Naive Bayes
  resultStoreSource?: {                     // bagaimana menemukan model ini di result store
    componentKey: string;                   // Statistic.components, NB: "Export Model"
    payloadKey: string;                     // key di output_data, NB: "naiveBayesTrainedModel"
  };
  validate(raw: unknown): ModelValidationResult;
}
```

```ts
// AM/adapters/registry.ts
export const CLASSIFIER_MODEL_ADAPTERS: Record<string, ClassifierModelAdapter>;
export function getModelAdapter(modelType: string): ClassifierModelAdapter | null;
export function validateAnyModel(raw: unknown): ModelValidationResult; // cek objek & model_type, lalu delegasi ke adapter
```

Isi awal registry: **hanya** `naive_bayes` → `naiveBayesModelAdapter` (`AM/adapters/naive-bayes-adapter.ts`).

### 3.3 State form (`AM/types/apply-model.ts`)

```ts
export type ApplyModelSourceKind = "file" | "resultStore" | "builtin";

export type ApplyModelModelTabType = {
  SourceKind: ApplyModelSourceKind;   // default "file"
  SourceRef: string | null;           // file: nama file; resultStore: String(statistic.id); builtin: entry.id
  SourceLabel: string | null;         // teks tampilan, lihat §6.3
  ModelJson: unknown | null;          // model mentah yang SUDAH lolos validate(); null = belum ada model
};

export type ApplyModelVariablesTabType = {
  FeatureMapping: Record<string, string | null>; // nama fitur model -> nama variabel dataset
  ActualTargetVar: string | null;                // opsional, untuk evaluasi
};

export type ApplyModelSaveTabType = {
  SaveMaxProbability: boolean;        // default true
  SaveClassProbabilities: boolean;    // default false
  NamePrefix: string | null;          // null = pakai adapter.defaultOutputPrefix
  UseCustomNames: boolean;            // default false
  CustomNames: {
    PredictedValue: string | null;
    MaxProbability: string | null;
    ClassProbabilities: Record<string, string | null>; // class -> nama
  };
};

export type ApplyModelOutputTabType = {
  ModelSummary: boolean;              // default true
  CaseProcessingSummary: boolean;     // default true
  PredictionDistribution: boolean;    // default true
  EvaluationMetrics: boolean;         // default true, hanya berlaku bila ActualTargetVar terisi
  ConfusionMatrix: boolean;           // default true, hanya berlaku bila ActualTargetVar terisi
};

export type ApplyModelType = {
  model: ApplyModelModelTabType;
  variables: ApplyModelVariablesTabType;
  save: ApplyModelSaveTabType;
  output: ApplyModelOutputTabType;
};

export type ApplyModelContainerProps = { onClose: () => void };
```

Default disimpan di `AM/constants/apply-model-default.ts` sebagai `ApplyModelModelDefault`, `ApplyModelVariablesDefault`, `ApplyModelSaveDefault`, `ApplyModelOutputDefault`, digabung menjadi `ApplyModelDefault` (pola `NB/constants/naive-bayes-default.ts`). Semua record/array default **kosong** (`{}`), semua `string | null` default `null`.

### 3.4 Aturan pemetaan variabel (mapping)

**Auto-map** (`autoMapFeatures(descriptor, variables)`; dijalankan setiap kali model baru dimuat dan saat dataset berubah):

1. Untuk setiap fitur: cari variabel dataset yang `name === feature.name` (persis). Jika ada → petakan.
2. Jika tidak ada: cari variabel yang `name.toLowerCase() === feature.name.toLowerCase()`. Jika tepat **satu** → petakan; jika 0 atau >1 → `null`.
3. Auto-map **tidak** memeriksa measure; hasilnya tetap divalidasi (langkah validasi di bawah) sehingga mismatch tampil sebagai error.
4. Satu variabel dataset tidak boleh dipakai oleh dua fitur; jika auto-map menghasilkan duplikat (hanya mungkin pada match case-insensitive), fitur kedua dan seterusnya di-set `null`.
5. `ActualTargetVar` auto-map: variabel dengan nama sama dengan `descriptor.targetName` (persis, lalu case-insensitive unik), **hanya jika** measure-nya nominal/ordinal dan tidak dipakai di `FeatureMapping`. Jika tidak → `null`.

**Validasi mapping** (`validateMapping(descriptor, mapping, actualTargetVar, variables)` → `ApplyModelIssue[]`):

| Kondisi | Kode |
|---|---|
| Fitur belum dipetakan (`null`/tidak ada key) | `AM_E_MAP_UNMAPPED` |
| Variabel yang dipetakan tidak ada di dataset | `AM_E_MAP_VAR_NOT_FOUND` |
| Satu variabel dipetakan ke >1 fitur | `AM_E_MAP_DUPLICATE` |
| Variabel ber-measure `unknown` | `AM_E_MAP_MEASURE_UNKNOWN` |
| Fitur `categorical` ↔ variabel `scale`, atau fitur `numerical` ↔ variabel `nominal`/`ordinal` | `AM_E_MAP_ROLE_MISMATCH` |
| Fitur `numerical` ↔ variabel bertipe `STRING` | `AM_E_MAP_NUMERIC_TYPE` |
| `ActualTargetVar` tidak ada di dataset | `AM_E_ACTUAL_NOT_FOUND` |
| `ActualTargetVar` measure bukan nominal/ordinal | `AM_E_ACTUAL_MEASURE` |
| `ActualTargetVar` juga dipakai sebagai prediktor | `AM_E_ACTUAL_IS_PREDICTOR` |

Pemetaan peran ↔ measure (satu-satunya aturan, sama dengan `NB/rust/src/stats/preprocess_data.rs:153-190`): `nominal`/`ordinal` ↔ `categorical`; `scale` ↔ `numerical`.

### 3.5 Kolom output (save) dan aturan penamaan

Kolom yang ditulis, urutan penulisan tetap:

| Kolom | Ditulis bila | Nama default (sebelum diproses) | type | measure | decimals | label |
|---|---|---|---|---|---|---|
| Predicted value | selalu | `${P}_PredictedValue` | lihat bawah | nominal | lihat bawah | `Predicted value (${algorithmLabel}, target ${targetName})` |
| Max probability | `SaveMaxProbability` | `${P}_PredictedProbability` | NUMERIC | scale | 4 | `Predicted probability of predicted class` |
| Prob. per kelas (satu kolom per kelas, urutan `descriptor.classes`) | `SaveClassProbabilities` | `${P}_Probability_${class}` | NUMERIC | scale | 4 | `Predicted probability of ${class}` |

`P` = `NamePrefix ?? adapter.defaultOutputPrefix` (NB: `"NB"`).

**Tipe kolom predicted** (`resolvePredictedColumnType(classes)`):

- Jika **setiap** kelas cocok regex `^-?\d+(\.\d+)?$` → `type: "NUMERIC"`, nilai ditulis sebagai `Number(label)`, `decimals` = jumlah digit pecahan terbanyak di antara kelas (0 bila semua bilangan bulat), `width: 12`, `align: "right"`.
- Selain itu → `type: "STRING"`, nilai ditulis sebagai string label apa adanya, `decimals: 0`, `width: 64`, `align: "left"`.
- Kolom probabilitas: `width: 12`, `align: "right"`. Semua kolom baru: `columns: 64`, `values: []`, `missing: null`, `role: "none"` (pola `KNN/services/nearest-neighbor-analysis.ts:288-304`).

**Nama kustom.** Bila `UseCustomNames === true`, nama yang dipakai adalah `CustomNames.*`; field yang `null`/kosong **tidak** jatuh ke default — itu error validasi. Bila `false`, `CustomNames` diabaikan (tetap disimpan).

**Validasi nama kustom** (`validateCustomOutputNames`, hanya untuk kolom yang akan ditulis), sama dengan aturan di `KNN/hooks/useNearestNeighborSaveRules.ts:85-130` (konstanta **disalin**, bukan di-import):

| Kondisi | Kode |
|---|---|
| Kosong setelah trim | `AM_E_NAME_EMPTY` |
| Tidak cocok `^[A-Za-z@#$][A-Za-z0-9._@#$]*$` | `AM_E_NAME_INVALID` |
| Panjang > 64 | `AM_E_NAME_TOO_LONG` |
| Kata cadangan (`ALL AND BY EQ GE GT LE LT NE NOT OR TO WITH`, case-insensitive) | `AM_E_NAME_RESERVED` |
| Sama (case-insensitive) dengan nama kolom baru lain | `AM_E_NAME_DUPLICATE` |

`NamePrefix` (bila tidak `null`) divalidasi dengan aturan yang sama kecuali `AM_E_NAME_DUPLICATE`.

**Resolusi nama akhir** (`resolveFinalOutputNames(requestedNames, existingVariables)`): proses nama satu per satu, berurutan, dengan `processVariableName` (`FE/stores/useVariableStore.ts:29-59`) terhadap daftar `existingVariables + nama-nama akhir sebelumnya`. Ini **identik** dengan yang dilakukan `addVariables` (`FE/stores/useVariableStore.ts:305-330`), sehingga preview di UI = hasil sesungguhnya. Bila nama akhir ≠ nama yang diminta → warning `AM_W_NAME_ADJUSTED` (ditampilkan di tab Save dan di toast sukses). Nama default yang memuat karakter tidak valid (mis. kelas `"Rain Day"`) juga dirapikan oleh fungsi yang sama.

### 3.6 Payload worker & hasil mentah (`AM/types/apply-model-worker.ts`)

**Payload `postMessage`:**

```ts
export type ApplyModelWorkerPayload = {
  predictors: Record<string, string | number | null>[][];  // satu slice per fitur, urutan descriptor.features
  predictorDefs: unknown[][];                               // getVarDefs, urutan sama
  mapping: Array<{ feature: string; variable: string }>;    // urutan sama dengan predictors
  actual: Record<string, string | number | null>[][];      // [] atau satu slice
  actualDefs: unknown[][];                                  // [] atau satu defs
  model: unknown;                                           // ModelJson apa adanya
};
```

Semua slice diambil dengan **satu** panggilan `getSlicedData({ selectedVariables: [...mappedVars, actual?] })` lalu dipotong, supaya panjang baris semua slice identik (`getMaxIndex` dihitung sekali, `FE/hooks/useVariable.ts:34-118`).

**Hasil mentah dari Rust (`ApplyModelRawResult`):**

```ts
export type ApplyModelRawResult = {
  model_summary: {
    model_type: string;
    schema_version: string;
    trained_at: string | null;
    target_name: string;
    classes: string[];
    features: Array<{ name: string; role: "categorical" | "numerical"; mapped_variable: string }>;
    parameters: Array<{ label: string; value: string }>;   // NB: Smoothing alpha, Variance floor, Validation (training)
    legacy_unseen_handling: boolean;                        // true bila schema 1.0
  };
  case_processing_summary: {
    total_rows: number;
    scored_rows: number;
    not_scored_all_missing: number;
    rows_with_missing_predictor: number;    // >=1 prediktor missing tapi tetap diprediksi
    rows_with_unseen_category: number;      // >=1 kategori tak dikenal
  };
  prediction_distribution: {
    classes: string[];
    counts: number[];          // sejajar classes
    percentages: number[];     // terhadap scored_rows, 0..100; 0 bila scored_rows = 0
    not_scored: number;
  };
  predictions: {
    predicted: Array<string | null>;               // panjang = total_rows
    max_probability: Array<number | null>;         // dibulatkan 4 desimal
    class_probabilities: Array<Array<number | null>>; // [classIdx][row], dibulatkan 4 desimal
  };
  evaluation: null | {
    evaluated_rows: number;
    excluded_actual_missing: number;
    excluded_actual_unknown_class: number;
    excluded_not_scored: number;
    confusion_matrix: NaiveBayesConfusionMatrixRaw;     // tipe dari NB formatter
    evaluation_metrics: NaiveBayesEvaluationMetricsRaw; // tipe dari NB formatter
  };
  warnings: Array<{ code: ApplyModelWarningCode; count: number; message: string }>;
};
```

Respons worker mengikuti pola NB (`FE/public/workers/Classify/NaiveBayes/naive-bayes.worker.js`): `{ success: true, data: ApplyModelRawResult, errors: string }` atau `{ success: false, error: string }`.

---

## 4. Validasi Model & Daftar Kode

### 4.1 Pemuatan

- **File:** hanya `.json`, ukuran ≤ **10 MB** (`AM_E_FILE_TOO_LARGE`), dibaca sebagai teks UTF-8, `JSON.parse` gagal → `AM_E_PARSE`.
- **Result store:** model diambil dari `Statistic.output_data[adapter.resultStoreSource.payloadKey]` (string JSON di-parse dulu bila perlu); gagal parse → `AM_E_PARSE`.
- **Bawaan:** `fetch(entry.path)`; gagal jaringan/status ≠ 200 → `AM_E_BUILTIN_FETCH`; gagal parse → `AM_E_PARSE`.
- Setelah dimuat, **semua sumber** lewat `validateAnyModel` yang sama.

### 4.2 Validasi umum (`validateAnyModel`)

1. Bukan objek JSON (null/array/primitive) → `AM_E_NOT_OBJECT`.
2. `model_type` tidak ada / bukan string → `AM_E_MODEL_TYPE_MISSING`.
3. `model_type` tidak ada di registry → `AM_E_MODEL_TYPE_UNSUPPORTED`.
4. Delegasi ke `adapter.validate(raw)`.

### 4.3 Validasi adapter Naive Bayes

Dicek berurutan; semua error dikumpulkan (bukan berhenti di error pertama), kecuali langkah 1–2 yang menghentikan validasi.

1. `schema_version` tidak di `["1.0","1.1"]` → `AM_E_SCHEMA_VERSION_UNSUPPORTED` (stop).
2. Field wajib (§3.1) tidak ada → `AM_E_FIELD_MISSING` (detail: path field) (stop).
3. Tipe field salah (mis. `classes` bukan array string) → `AM_E_FIELD_TYPE`.
4. `classes` kosong → `AM_E_CLASSES_EMPTY`; ada duplikat → `AM_E_CLASSES_DUPLICATE`.
5. `class_priors.length !== classes.length` → `AM_E_PRIORS_LENGTH`; ada nilai di luar [0,1] atau tidak finite, atau `|Σ priors − 1| > 1e-6` → `AM_E_PRIORS_INVALID`.
6. `smoothing_alpha` atau `variance_floor` tidak finite atau ≤ 0 → `AM_E_PARAM_INVALID`.
7. `feature_order` kosong, berisi duplikat, atau tidak sama (sebagai himpunan & panjang) dengan `features[].name` → `AM_E_FEATURE_ORDER_MISMATCH`.
8. `features[].role` bukan `categorical`/`numerical` → `AM_E_ROLE_INVALID`.
9. Categorical: `categories` kosong/duplikat → `AM_E_CATEGORIES_INVALID`; `distribution` tidak punya key untuk setiap kelas → `AM_E_DISTRIBUTION_CLASS_MISSING`; panjang array ≠ jumlah kategori → `AM_E_DISTRIBUTION_LENGTH`; ada nilai di luar (0,1] atau tidak finite, atau `|Σ − 1| > 1e-6` per kelas → `AM_E_DISTRIBUTION_SUM`.
10. Numerical: `mean`/`variance` tidak punya key untuk setiap kelas → `AM_E_GAUSSIAN_CLASS_MISSING`; mean tidak finite atau variance tidak finite / ≤ 0 → `AM_E_GAUSSIAN_INVALID`.
11. Khusus `1.1`: `target.class_counts` tidak ada / panjang ≠ jumlah kelas / bukan integer ≥ 0 → `AM_E_COUNTS_INVALID`; `Σ class_counts = 0` → `AM_E_COUNTS_INVALID`; `|class_priors[i] − class_counts[i]/Σ| > 1e-6` → `AM_E_COUNTS_INCONSISTENT`; categorical `class_totals` tidak ada / tidak punya key untuk setiap kelas / bukan integer ≥ 0 → `AM_E_CLASS_TOTALS_INVALID`.
12. Khusus `1.0`: valid, tetapi `descriptor.warnings` berisi `AM_W_LEGACY_SCHEMA`.

Rust (§5.2) menjalankan **ulang** langkah 1–11 dengan kode yang sama.

### 4.4 Kompatibilitas schema 1.0 vs 1.1

| Aspek | 1.0 | 1.1 |
|---|---|---|
| Kategori dikenal | probabilitas dari `distribution` | sama |
| Kategori **tak dikenal** (termasuk `"(Missing)"` bila tidak ada di `categories`) | kontribusi fitur ini **dilewati** untuk baris tsb + warning `AM_W_UNSEEN_SKIPPED_LEGACY` | `alpha / (class_totals[c] + alpha * K)`, persis `NB/rust/src/stats/prediction.rs:119-160` |
| UI | banner peringatan di tab Model: "Model ini memakai format lama (1.0) ..." | — |

### 4.5 Daftar lengkap kode (`AM/constants/apply-model-codes.ts`)

```ts
export type ApplyModelErrorCode =
  | "AM_E_PARSE" | "AM_E_FILE_TOO_LARGE" | "AM_E_BUILTIN_FETCH" | "AM_E_NOT_OBJECT"
  | "AM_E_MODEL_TYPE_MISSING" | "AM_E_MODEL_TYPE_UNSUPPORTED" | "AM_E_SCHEMA_VERSION_UNSUPPORTED"
  | "AM_E_FIELD_MISSING" | "AM_E_FIELD_TYPE" | "AM_E_CLASSES_EMPTY" | "AM_E_CLASSES_DUPLICATE"
  | "AM_E_PRIORS_LENGTH" | "AM_E_PRIORS_INVALID" | "AM_E_PARAM_INVALID" | "AM_E_FEATURE_ORDER_MISMATCH"
  | "AM_E_ROLE_INVALID" | "AM_E_CATEGORIES_INVALID" | "AM_E_DISTRIBUTION_CLASS_MISSING"
  | "AM_E_DISTRIBUTION_LENGTH" | "AM_E_DISTRIBUTION_SUM" | "AM_E_GAUSSIAN_CLASS_MISSING"
  | "AM_E_GAUSSIAN_INVALID" | "AM_E_COUNTS_INVALID" | "AM_E_COUNTS_INCONSISTENT" | "AM_E_CLASS_TOTALS_INVALID"
  | "AM_E_MAP_UNMAPPED" | "AM_E_MAP_VAR_NOT_FOUND" | "AM_E_MAP_DUPLICATE" | "AM_E_MAP_MEASURE_UNKNOWN"
  | "AM_E_MAP_ROLE_MISMATCH" | "AM_E_MAP_NUMERIC_TYPE"
  | "AM_E_ACTUAL_NOT_FOUND" | "AM_E_ACTUAL_MEASURE" | "AM_E_ACTUAL_IS_PREDICTOR"
  | "AM_E_NAME_EMPTY" | "AM_E_NAME_INVALID" | "AM_E_NAME_TOO_LONG" | "AM_E_NAME_RESERVED" | "AM_E_NAME_DUPLICATE"
  | "AM_E_NO_MODEL" | "AM_E_NO_ROWS" | "AM_E_PAYLOAD" | "AM_E_WORKER";

export type ApplyModelWarningCode =
  | "AM_W_LEGACY_SCHEMA" | "AM_W_UNSEEN_SKIPPED_LEGACY" | "AM_W_UNSEEN_CATEGORY"
  | "AM_W_ROWS_NOT_SCORED" | "AM_W_ACTUAL_UNKNOWN_CLASS" | "AM_W_NAME_ADJUSTED"
  | "AM_W_NO_RESULT_STORE_MODELS" | "AM_W_BUILTIN_EMPTY";

export type ApplyModelIssue = {
  code: ApplyModelErrorCode | ApplyModelWarningCode;
  severity: "error" | "warning";
  detail?: string;         // mis. path field, nama fitur, nama kolom
};

export const APPLY_MODEL_MESSAGES: Record<ApplyModelErrorCode | ApplyModelWarningCode, string>;
```

`APPLY_MODEL_MESSAGES` berisi kalimat bahasa Indonesia untuk pengguna awam, satu per kode. Placeholder `{detail}` diganti `issue.detail`. Contoh wajib (teks lain bebas tapi harus spesifik):

- `AM_E_MODEL_TYPE_UNSUPPORTED`: "Jenis model \"{detail}\" belum didukung oleh Apply Model."
- `AM_E_SCHEMA_VERSION_UNSUPPORTED`: "Versi format model \"{detail}\" tidak didukung. Versi yang didukung: 1.0, 1.1."
- `AM_E_MAP_ROLE_MISMATCH`: "Fitur \"{detail}\" tidak cocok dengan measurement level variabel yang dipilih."
- `AM_E_NO_ROWS`: "Dataset aktif tidak berisi baris data pada variabel yang dipetakan."
- `AM_W_LEGACY_SCHEMA`: "Model ini memakai format lama (1.0). Kategori yang tidak dikenal akan dilewati saat prediksi. Ekspor ulang model dari menu Naive Bayes untuk hasil yang konsisten."

Pesan dari Rust berbentuk `"AM_E_XXX: <detail bebas>"`; `getUserFriendlyApplyModelError` (§6.6) mengambil kode di depan `:` dan memetakannya lewat `APPLY_MODEL_MESSAGES`, fallback ke pesan generik.

---

## 5. Algoritma Scoring (Rust)

### 5.1 Trait & registry scorer

```rust
// AM/rust/src/scoring/mod.rs
pub enum RowScore {
    NotScored,                     // seluruh prediktor missing (K5)
    Scored { log_scores: Vec<f64>, // sejajar classes()
             had_missing: bool,    // >=1 prediktor missing
             had_unseen: bool,     // >=1 kategori tak dikenal (dihitung atau dilewati)
             skipped_unseen: usize }, // jumlah kontribusi dilewati (hanya schema 1.0)
}

pub trait ClassifierScorer {
    fn model_type(&self) -> &str;
    fn schema_version(&self) -> &str;
    fn classes(&self) -> &[String];              // urutan dari model
    fn features(&self) -> &[FeatureSpec];        // FeatureSpec { name, role } urutan feature_order
    fn summary_parameters(&self) -> Vec<(String, String)>;
    fn is_legacy_unseen_handling(&self) -> bool; // NB: schema_version == "1.0"
    fn score_row(&self, values: &[DataValue]) -> RowScore; // values sejajar features()
}

pub fn build_scorer(model: &serde_json::Value) -> Result<Box<dyn ClassifierScorer>, String>;
// match model["model_type"]: "naive_bayes" => NaiveBayesScorer::from_json(model) ; lainnya => Err("AM_E_MODEL_TYPE_UNSUPPORTED: <type>")
```

Semua langkah setelah `score_row` (posterior, argmax, pembulatan, distribusi, evaluasi) ada di modul generik `AM/rust/src/stats/` dan **tidak** tahu algoritmanya.

### 5.2 `NaiveBayesScorer::from_json`

Deserialisasi ke struct yang mencerminkan §3.1, lalu jalankan validasi §4.3 langkah 1–11 (kode error sama, format `"AM_E_XXX: detail"`). Simpan per fitur categorical: `categories` + index map, `distribution[c]`, `K = categories.len()`, `class_totals[c]` (Option bila 1.0). Simpan per fitur numerical: `mean[c]`, `variance[c]`.

### 5.3 Normalisasi nilai sel (port dari NB, wajib identik)

Sumber: `NB/rust/src/stats/preprocess_data.rs:224-252`. Disalin ke `AM/rust/src/stats/value_label.rs`:

- `is_missing_value(v)`: `Null` → true; `Text(s)` → `s.trim().is_empty()`; `Number(n)` → `!n.is_finite()`; `Boolean` → false.
- `data_value_to_label(v)`: `Text(s)` → `s.trim()`; `Number(n)` → bila `n.fract()==0 && |n|<1e15` → `format!("{}", n as i64)` selain itu `n.to_string()`; `Boolean(b)` → `b.to_string()`; `Null` → `"(Missing)"`.
- Nilai numerik untuk fitur numerical: hanya `Number(n)` dengan `n.is_finite()`; selain itu dianggap missing (sama dengan `preprocess_data.rs:113-117`).
- Konstanta `MISSING_CATEGORY_LABEL = "(Missing)"`.

Nilai dari TS sudah melewati `parseCellValue` (`FE/hooks/useVariable.ts:22-32`) persis seperti saat training NB — **jangan** mem-parse ulang di Rust.

### 5.4 Skor per baris (`NaiveBayesScorer::score_row`)

Input: `values[i]` untuk fitur ke-i (urutan `feature_order`).

1. **Aturan K5:** bila **setiap** `values[i]` missing menurut `is_missing_value` (untuk fitur categorical maupun numerical) → `RowScore::NotScored`.
2. Untuk setiap kelas `c` (urutan `classes` model), `s_c = safe_ln(prior_c)`.
3. Fitur **numerical** dengan nilai finite `x`: `s_c += -0.5 * ln(2π·var_c) − (x − mean_c)² / (2·var_c)`, dengan `var_c = var_c.max(f64::MIN_POSITIVE)` (identik `prediction.rs:92-95`). Nilai missing → fitur dilewati, `had_missing = true`.
4. Fitur **categorical**: `cat = is_missing(v) ? "(Missing)" : data_value_to_label(v)`; bila missing → `had_missing = true`.
   - `cat` ada di `categories` → `p = distribution[c][idx]`.
   - `cat` tidak ada (unseen) → `had_unseen = true`; schema 1.1: `p = alpha / (class_totals[c] + alpha*K)` (penyebut selalu > 0 karena `alpha>0`, `K≥1`); schema 1.0: lewati fitur untuk **semua** kelas pada baris ini, `skipped_unseen += 1`.
   - `s_c += safe_ln(p)`.
5. `safe_ln(p) = p > 0 ? ln(p) : ln(f64::MIN_POSITIVE)` (identik `prediction.rs:163-169`).

Perbandingan string kategori **case-sensitive** dan persis setelah trim (sama dengan NB).

### 5.5 Posterior, kelas prediksi, pembulatan (generik, `AM/rust/src/stats/posterior.rs`)

- `m = max_c s_c`; `p_c = exp(s_c − m) / Σ_j exp(s_j − m)` (log-sum-exp).
- **Argmax & tie-break** (identik `prediction.rs:184-237`): iterasi kelas dalam urutan **byte-wise ascending** (`Vec<String>::sort()` pada salinan nama kelas), perbarui pemenang hanya bila `s_c > best` (strictly greater). Kelas pemenang = predicted.
- `max_probability = p_predicted`.
- Pembulatan output: `round4(x) = (x * 10000.0).round() / 10000.0` untuk `max_probability` dan setiap `class_probabilities`. Predicted **tidak** terpengaruh pembulatan (argmax dari skor mentah).
- Baris `NotScored`: `predicted = null`, `max_probability = null`, semua `class_probabilities = null`.

### 5.6 Contoh numerik acuan (wajib jadi unit test)

Model = model 6-baris dari test NB (`NB/rust/src/stats/prediction.rs`, fungsi `six_row_model`, alpha=1, variance_floor=1e-9), diekspresikan sebagai JSON schema 1.1:

- `classes = ["No","Yes"]`, `class_priors = [0.5, 0.5]`, `class_counts = [3, 3]`
- `Outlook` (categorical): `categories = ["Overcast","Rain","Sunny"]`; `distribution.No = [0.5, 1/6, 1/3]`; `distribution.Yes = [1/6, 1/3, 0.5]`; `class_totals = {No: 3, Yes: 3}`
- `Temp` (numerical): `mean = {No: 84, Yes: 72}`; `variance = {No: 56/3, Yes: 8/3}`
- `feature_order = ["Outlook","Temp"]`

| # | Outlook | Temp | s_No | s_Yes | P(No) | P(Yes) | Predicted |
|---|---|---|---|---|---|---|---|
| T1 | Overcast | 85 | -3.7953883096437977 | -35.581759809498536 | 1.0000 | 0.0000 | No |
| T2 | Sunny | 71 | -8.700853417751961 | -2.9831475208304266 | 0.0033 | 0.9967 | Yes |
| T3 | Foggy (unseen, 1.1) | 72 | -8.72435774116905 | -3.894259809498536 | 0.0079 | 0.9921 | Yes |
| T4 | Sunny | (missing) | -1.791759469228055 | -1.3862943611198906 | 0.4000 | 0.6000 | Yes |
| T5 | (missing) | (missing) | — | — | null | null | null (NotScored) |
| T6 | (missing → "(Missing)", unseen, 1.1) | 80 | -5.295786312597621 | -15.894259809498536 | 1.0000 | 0.0000 | No |
| T7 | Foggy (unseen, **1.0** → dilewati) | 72 | -6.932598271940995 | -2.102500340270481 | 0.0079 | 0.9921 | Yes |

Toleransi assert skor: `1e-9`; probabilitas mentah `1e-12`; nilai bulat 4 desimal dibandingkan persis. T1–T2 harus sama dengan skor yang sudah diuji di `prediction.rs` (bukti konsistensi dengan NB). T6 & T3 punya `had_unseen = true`; T4 & T6 `had_missing = true`; T7 `skipped_unseen = 1`.

### 5.7 Ringkasan & evaluasi (generik)

- `total_rows` = panjang slice. `scored_rows` = baris `Scored`. `not_scored_all_missing` = baris `NotScored`. `rows_with_missing_predictor` / `rows_with_unseen_category` dihitung dari flag baris `Scored`.
- `prediction_distribution`: count per kelas (urutan `classes` model), `percentages = count / scored_rows * 100` (0 bila `scored_rows = 0`).
- **Evaluasi** hanya bila `actual` tidak kosong. Label actual memakai `is_missing_value` + `data_value_to_label` (§5.3). Baris dikecualikan bila: tidak diprediksi (`excluded_not_scored`), actual missing (`excluded_actual_missing`), actual tidak ada di `classes` model (`excluded_actual_unknown_class` + warning `AM_W_ACTUAL_UNKNOWN_CLASS`). Sisa baris → `compute_confusion_matrix(actual, predicted, classes)` dan `compute_evaluation_metrics` dari salinan `NB/rust/src/stats/classification_table.rs` (definisi: baris = actual, kolom = predicted, persentase sel terhadap grand total, Kappa overall saja). Serialisasi JSON identik dengan `evaluation_result_to_json` (`NB/rust/src/wasm/function.rs:249-299`) supaya cocok dengan `NaiveBayesConfusionMatrixRaw`/`NaiveBayesEvaluationMetricsRaw`.
- Bila `evaluated_rows = 0`, `evaluation` tetap diisi dengan matrix nol (bukan error) dan metrik yang dihasilkan modul salinan apa adanya (modul itu sudah menangani pembagian nol → 0.0).
- `warnings`: satu entri per kode dengan `count > 0`: `AM_W_ROWS_NOT_SCORED` (= not_scored_all_missing), `AM_W_UNSEEN_CATEGORY` (= rows_with_unseen_category, hanya 1.1), `AM_W_UNSEEN_SKIPPED_LEGACY` (= jumlah baris dengan skipped_unseen>0, hanya 1.0), `AM_W_ACTUAL_UNKNOWN_CLASS`.

### 5.8 Validasi payload di Rust

- `predictors.len() == predictorDefs.len() == mapping.len() == features().len()` dan `mapping[i].feature == features()[i].name`; selain itu `AM_E_PAYLOAD`.
- Measure di `predictorDefs[i]` harus cocok peran fitur (§3.4); selain itu `AM_E_MAP_ROLE_MISMATCH` (lapis kedua).
- `total_rows == 0` → `AM_E_NO_ROWS`.

---

## 6. Kontrak UI

### 6.1 Container (`AM/dialogs/apply-model-main.tsx`, export default `ApplyModelContainer`)

Mengikuti pola `NB/dialogs/naive-bayes-main.tsx` dengan perbedaan yang disebut eksplisit:

- Struktur: header (judul "Apply Model") → `Tabs` (`model`, `variables`, `save`, `output`) → footer.
- Footer: kiri tombol **Help** (`variant="ghost"`, ikon `CircleHelp`, toggle `helperMode`, `aria-pressed`, pola `KNN/dialogs/nearest-neighbor-main.tsx:416-424`); kanan **OK**, **Reset**, **Cancel**.
- Header **tidak** punya tombol close tambahan (tutup lewat Cancel / tombol close bawaan sidebar).
- Tab `variables`, `save`, `output` **disabled** selama `formData.model.ModelJson === null`.
- Saat `helperMode` true, tiap kontrol menampilkan teks bantuan singkat (`<p className="text-xs text-muted-foreground">`) di bawahnya. Teks bantuan didefinisikan sebagai konstanta di file tab masing-masing (bahasa Inggris).

**Perilaku tombol:**

| Tombol | Perilaku |
|---|---|
| OK | `disabled` bila `!validation.isValid` (§6.5). Saat klik: validasi ulang; jika gagal → `toast.error(pesan error pertama)`. Jika lolos: `closeModal(); onClose();` lalu `toast.promise(run(), {loading: "Menerapkan model ke dataset...", success: (summary) => "Prediksi selesai: N baris diprediksi. Kolom baru: A, B, C.", error: getUserFriendlyApplyModelError})`. `run()` = simpan form ke IndexedDB → `applyModel(...)` (§6.6). |
| Reset | State → `ApplyModelDefault` (deep clone), `activeTab = "model"`, `clearFormData("ApplyModel")`, `toast.success("Pengaturan Apply Model telah direset.")`. |
| Cancel | `closeModal(); onClose();` tanpa menyimpan. |
| Help | toggle `helperMode` (tidak dipersist). |

**Persistensi:** `getFormData("ApplyModel")` saat mount (gabung dengan default per section seperti NB); `saveFormData` hanya saat OK; payload yang disimpan menyertakan `_variablesFingerprint` (fungsi fingerprint **disalin** dari `NB/dialogs/naive-bayes-main.tsx:48-52`). `ModelJson` ikut dipersist.

**Dataset berubah** (fingerprint berbeda saat load, atau `variables` store berubah saat panel terbuka): **hanya** `variables` dan `save.CustomNames` direset ke default lalu auto-map dijalankan ulang terhadap model yang masih dimuat; `model` dan `output` dipertahankan; `toast.info("Dataset berubah — pemetaan variabel Apply Model disusun ulang.")`. (Berbeda dari NB yang mereset seluruh form, karena model tidak bergantung pada dataset.)

**Saat model baru berhasil dimuat:** `variables` direset lalu auto-map; `save` direset ke default (prefix & nama kustom tidak relevan untuk model lain); `output` dipertahankan.

### 6.2 Tab Model (`AM/dialogs/model-tab.tsx`)

- `RadioGroup` "Model Source": `Upload file (.json)` / `From Output Viewer` / `Statify built-in model`.
- **Upload:** `<input type="file" accept=".json,application/json">` + tombol "Choose file". Setelah dipilih: baca, validasi, tampilkan hasil.
- **From Output Viewer:** daftar (Select) model dari result store, dibangun oleh `listResultStoreModels()` (§6.6). Label tiap opsi: `"<log.log> › <analytic.title> — <trained_at>"`. Bila kosong → teks `AM_W_NO_RESULT_STORE_MODELS`.
- **Built-in:** Select dari `BUILTIN_MODELS` (`AM/constants/builtin-models.ts`). Bila katalog kosong → opsi radio tetap tampil, Select disabled, teks `AM_W_BUILTIN_EMPTY` ("Belum ada model bawaan Statify.").
- Mengganti radio **tidak** menghapus model yang sudah dimuat; model baru menggantikan hanya bila pemuatan dari sumber baru berhasil.
- **Kartu ringkasan model** (bila `ModelJson` ada): Algorithm, Schema version, Trained at, Target, Classes (dipisah koma), Features (tabel nama + role), baris `summaryRows`, dan banner kuning untuk setiap warning descriptor.
- Error validasi ditampilkan sebagai daftar di bawah kontrol (ikon `AlertCircle`, pola tab Variables KNN), dan model **tidak** disimpan ke state.

### 6.3 `SourceLabel`

- file → `"File: <nama file>"`
- resultStore → `"Output Viewer: <log.log> › <analytic.title> (#<statistic.id>)"`
- builtin → `"Built-in: <entry.label>"`

### 6.4 Tab Variables (`AM/dialogs/variables-tab.tsx`)

- Tabel: kolom **Feature**, **Role** (`categorical`/`numerical`), **Dataset variable** (Select berisi variabel dataset yang measure-nya cocok dengan role ditambah opsi `"— Not mapped —"`; variabel yang sudah dipakai fitur lain tampil disabled), **Status** (✓ atau pesan error kode §3.4).
- Tombol "Auto-map by name" → menjalankan ulang `autoMapFeatures` (menimpa pilihan manual).
- Bagian "Actual target (optional)": Select variabel nominal/ordinal yang tidak dipakai sebagai prediktor + opsi `"— None —"`; teks bantuan: evaluasi hanya ditampilkan bila diisi.
- **Tidak** memakai `VariableListManager` (bentuk mapping satu-ke-satu tidak cocok dengan drag-and-drop).

### 6.5 Tab Save (`AM/dialogs/save-tab.tsx`) dan Tab Output (`AM/dialogs/output-tab.tsx`)

**Save:**
- Checkbox "Predicted value" (checked & disabled), "Predicted probability (predicted class)", "Predicted probability for each class".
- Input "Name prefix" (placeholder = default adapter).
- Checkbox "Use custom names" → bila aktif, tabel nama per kolom yang akan ditulis menjadi editable (Input per baris); bila tidak aktif, tabel tampil read-only dengan nama default.
- Kolom "Final name" pada tabel: hasil `resolveFinalOutputNames` (preview), dengan ikon peringatan bila disesuaikan (`AM_W_NAME_ADJUSTED`).

**Output:** lima checkbox §3.3 (`normalizeCheckboxValue`: `"indeterminate"`/`undefined` → `false`, pola `KNN/hooks/useNearestNeighborOutputRules.ts`). "Evaluation metrics" & "Confusion matrix" disabled (tetap terlihat) bila `ActualTargetVar === null`, dengan teks "Requires an actual target variable (Variables tab)."

**Validasi terpusat** (`AM/hooks/useApplyModelValidation.ts`): `useApplyModelValidation(formData, variables)` → `{ validation: { isValid, issues }, firstErrorMessage }`. `isValid` = `ModelJson !== null` **dan** tidak ada issue `severity: "error"` dari: `validateAnyModel(ModelJson)`, `validateMapping`, `validateCustomOutputNames` (bila `UseCustomNames`), validasi `NamePrefix`.

### 6.6 Services

| File | Fungsi | Tanggung jawab |
|---|---|---|
| `AM/services/model-loader.ts` | `loadModelFromFile(file)`, `listResultStoreModels()`, `loadModelFromResultStore(statisticId)`, `loadBuiltinModel(entryId)` | Membaca sumber → `validateAnyModel`. Return `{ ok, model, descriptor, sourceRef, sourceLabel } \| { ok:false, errors }`. `listResultStoreModels` membaca `useResultStore.getState().logs` (memanggil `loadResults()` sekali bila `logs` kosong), menelusuri `log.analytics[].statistics[]`, memilih statistic yang `components` sama dengan `resultStoreSource.componentKey` milik **salah satu** adapter terdaftar, parse `output_data`, ambil `payloadKey`. Urutan: terbaru dulu (id statistic menurun). |
| `AM/services/apply-model-analysis.ts` | `applyModel({ formData, variables, dataVariables })` | Hitung `getOutputColumnSpecs` + `resolveFinalOutputNames` **sebelum** worker dijalankan (nama akhir dipakai formatter & penulisan kolom). Bangun payload §3.6, jalankan worker `/workers/Classify/ApplyModel/apply-model.worker.js?v=${APPLY_MODEL_WASM_VERSION}` (`type: "module"`), lalu `resultApplyModel(...)` lalu `saveApplyModelVariables(...)`; return `{ scoredRows, finalNames, warnings }` untuk toast. |
| `AM/services/apply-model-save-variables.ts` | `buildOutputColumns(...)`, `saveApplyModelVariables(...)` | Bentuk definisi variabel (§3.5) + `CellUpdate[]` (sel `null` dilewati, pola `normalizeSavedValue` KNN), `nextColumnIndex = max(columnIndex)+1`, panggil `useVariableStore.getState().addVariables(defs, updates)` **satu kali**. Tidak pernah memanggil `updateCells` pada variabel lama. |
| `AM/services/apply-model-formatter.ts` | `transformApplyModelResult(raw, outputFlags, context)` dengan `context = { sourceLabel: string; savedColumns: Array<{ column: string; finalName: string; type: string; measure: string }> }` | `Table[]`: `apply_model_summary`, `apply_model_case_processing_summary`, `apply_model_prediction_distribution`, `apply_model_saved_variables`, dan (bila evaluasi ada & dicentang) hasil `buildEvaluationMetricsTables` + `buildConfusionMatrixTable` dari NB formatter. Angka diformat 3 desimal (pola `formatNumber` NB, disalin). |
| `AM/services/apply-model-output.ts` | `resultApplyModel({ formattedResult, rawResult, formData, finalNames })` | `addLog({log:"Apply Model"})` → `addAnalytic(logId, {title:"Apply Model Result", note:""})` → `addStatistic` per tabel tercentang. `components` wajib unik: `"Apply Model Summary"`, `"Apply Model Case Processing Summary"`, `"Apply Model Prediction Distribution"`, `"Apply Model Saved Variables"` (selalu ditambahkan), `"Apply Model Evaluation Metrics"`, `"Apply Model Cohen's Kappa"`, `"Apply Model Confusion Matrix"`. **Jangan** memakai `"Case Processing Summary"` atau `"Export Model"` (sudah terdaftar di `FE/components/Output/Statistics/index.tsx`). |
| `AM/services/apply-model-error-messages.ts` | `getUserFriendlyApplyModelError(error)` | Ambil kode `AM_E_*` di awal pesan → `APPLY_MODEL_MESSAGES`; pesan mengandung `worker`/`wasm`/`module` → `AM_E_WORKER`; fallback generik. |

Isi tabel output:

- **Model Summary:** baris Source, Algorithm, Schema version, Trained at, Target, Classes, Features (`nama → variabel (role)` per baris), parameter dari `model_summary.parameters`.
- **Case Processing Summary:** Total rows, Scored, Not scored (all predictors missing), Scored with ≥1 missing predictor, Scored with ≥1 unseen category; bila evaluasi: Evaluated, Excluded (actual missing), Excluded (actual class not in model).
- **Prediction Distribution:** baris per kelas (Count, Percent of scored), baris "Not scored", baris "Total".
- **Saved Variables:** Column, Final name, Type, Measure.

### 6.7 Katalog model bawaan (`AM/constants/builtin-models.ts`)

```ts
export type BuiltinModelEntry = {
  id: string;            // unik, kebab-case
  label: string;         // tampilan
  description: string;
  modelType: string;     // harus terdaftar di registry adapter
  path: string;          // URL publik, konvensi: "/models/classify/<id>.json" (file di FE/public/models/classify/)
};
export const BUILTIN_MODELS: readonly BuiltinModelEntry[] = []; // KOSONG — diisi di pekerjaan terpisah
```

---

## 7. Struktur Folder & Hubungan dengan Modul Lain

### 7.1 Struktur target `AM/`

```
apply-model/
├── AGENTS.md, PLAN.md
├── adapters/
│   ├── types.ts                      # §3.2 interface & descriptor
│   ├── naive-bayes-adapter.ts        # validasi §4.3 + descriptor NB
│   ├── registry.ts                   # CLASSIFIER_MODEL_ADAPTERS, getModelAdapter, validateAnyModel
│   └── __tests__/ (naive-bayes-adapter.test.ts, registry.test.ts)
├── constants/
│   ├── apply-model-default.ts        # §3.3
│   ├── apply-model-codes.ts          # §4.5 kode + APPLY_MODEL_MESSAGES
│   ├── builtin-models.ts             # §6.7
│   └── __tests__/apply-model-default.test.ts
├── types/
│   ├── model-schema.ts               # §3.1
│   ├── apply-model.ts                # §3.3
│   └── apply-model-worker.ts         # §3.6
├── hooks/
│   ├── useApplyModelMappingRules.ts  # autoMapFeatures, validateMapping
│   ├── useApplyModelSaveRules.ts     # default names, resolvePredictedColumnType, validateCustomOutputNames, resolveFinalOutputNames
│   ├── useApplyModelOutputRules.ts   # normalizeCheckboxValue, effectiveOutputFlags
│   ├── useApplyModelValidation.ts    # §6.5
│   └── __tests__/ (satu file test per hook)
├── services/
│   ├── model-loader.ts
│   ├── apply-model-analysis.ts
│   ├── apply-model-save-variables.ts
│   ├── apply-model-formatter.ts
│   ├── apply-model-output.ts
│   ├── apply-model-error-messages.ts
│   ├── __fixtures__/ (nb-model-v1_1.json, nb-model-v1_0.json, apply-model-raw-result.json)
│   └── __tests__/
├── dialogs/
│   ├── apply-model-main.tsx
│   ├── model-tab.tsx
│   ├── variables-tab.tsx
│   ├── save-tab.tsx
│   ├── output-tab.tsx
│   └── __tests__/
└── rust/
    ├── Cargo.toml                    # name = "wasm", dependency identik NB/rust/Cargo.toml
    └── src/
        ├── lib.rs                    # pub mod models; scoring; stats; utils; wasm;
        ├── models/ (mod.rs, data.rs [DataRecord, DataValue, VariableDefinition, VariableMeasure: salinan NB], payload.rs [MappingEntry], result.rs [ApplyModelRawResult serde])
        ├── scoring/ (mod.rs [RowScore, FeatureSpec, ClassifierScorer, build_scorer], naive_bayes.rs [model struct, from_json, validasi §4.3, score_row])
        ├── stats/ (mod.rs, value_label.rs §5.3, posterior.rs §5.5, summary.rs §5.7 [case summary, distribution], classification_table.rs [salinan NB], evaluation.rs §5.7)
        ├── utils/ (mod.rs, error.rs [salinan NB], converter.rs [salinan NB])
        └── wasm/ (mod.rs, constructor.rs [ApplyModelAnalysis], function.rs [run_apply_model, get_formatted_results, get_all_errors])
```

Hasil build: `FE/public/workers/Classify/ApplyModel/pkg/*` (disalin manual dari `AM/rust/pkg/`) + `FE/public/workers/Classify/ApplyModel/apply-model.worker.js`. Konstanta versi cache: `APPLY_MODEL_WASM_VERSION` di `apply-model-analysis.ts` dan query `?v=` di worker, format `apply-model-YYYYMMDD<huruf>`.

Kelas WASM: `ApplyModelAnalysis` dengan `constructor(predictors, predictorDefs, mapping, actual, actualDefs, model)`, method `get_formatted_results()` (→ `ApplyModelRawResult` via `serde_wasm_bindgen`) dan `get_all_errors()` (pola `NB/rust/src/wasm/constructor.rs`). Error fatal (validasi model/payload) dikembalikan sebagai `Err(JsValue)` dari constructor dengan pesan berkode.

### 7.2 File di luar `AM/` yang BOLEH diubah (daftar tertutup)

| # | File | Perubahan yang diizinkan |
|---|---|---|
| 1 | `NB/rust/src/stats/save.rs` | Schema 1.1: `ExportTarget.class_counts: Vec<u64>` (sejajar `classes`, dari `model.class_priors.class_counts`), `ExportFeature::Categorical.class_totals: HashMap<String, u64>` (per kelas = Σ `raw_count` dari `model.categorical[name].per_class[class]`), `schema_version: "1.1"`, update & tambah test. Tidak ada perubahan lain. |
| 2 | `NB/services/naive-bayes-analysis-formatter.ts` | Hanya tipe `NaiveBayesTrainedModelRaw`: tambah `target.class_counts?: number[]`. |
| 3 | `NB/services/naive-bayes-analysis.ts` | Hanya bump `NAIVE_BAYES_WASM_VERSION`. |
| 4 | `FE/public/workers/Classify/NaiveBayes/naive-bayes.worker.js` + `pkg/*` | Bump query `?v=` & salin ulang `pkg/` hasil build. |
| 5 | `FE/types/modalTypes.ts` | `ModalApplyModel = "ModalApplyModel"` di enum (setelah `ModalNaiveBayes`), kategori `ModalCategory.Analyze`, judul `"Apply Model"`. |
| 6 | `Classify/ClassifyRegistry.tsx` | Lazy import `apply-model/dialogs/apply-model-main` (default export), daftar di `CLASSIFY_MODAL_COMPONENTS`, preferensi `"sidebar"`. |
| 7 | `Classify/classify-menu.tsx` | `MenubarSeparator` + `MenubarItem` "Apply Model" setelah item "Naive Bayes" (sebelum separator ROC yang sudah ada). |
| 8 | `FE/app/dashboard/layout.tsx` | Tambah `\|\| topModalType === ModalType.ModalApplyModel` ke kondisi `isKNNModalOpen` (baris ±67-69). Tidak me-rename apa pun. |
| 9 | `FE/hooks/useIndexedDB.ts` | Tambah `\| "ApplyModel"` ke union `AnalysisType` (setelah `"NaiveBayes"`). |
| 10 | `FE/public/workers/Classify/ApplyModel/*` | File baru (worker + pkg). |
| 11 | `FE/public/models/classify/` | Folder baru boleh dibuat **hanya** bila diperlukan untuk test manual; tidak ada file model sungguhan di scope ini. |

### 7.3 Import read-only yang diizinkan

- `@/hooks/useVariable` (`getSlicedData`, `getVarDefs`), `@/hooks/useIndexedDB`, `@/hooks/useModal`.
- `@/stores/useVariableStore` (`useVariableStore`, `processVariableName`), `@/stores/useDataStore` (tipe `CellUpdate`), `@/stores/useResultStore`.
- `@/components/ui/*`, `lucide-react`, `sonner`.
- Dari NB **hanya**: tipe `NaiveBayesConfusionMatrixRaw`, `NaiveBayesEvaluationMetricsRaw` dan fungsi `buildEvaluationMetricsTables`, `buildConfusionMatrixTable` dari `NB/services/naive-bayes-analysis-formatter.ts`.
- **Dilarang** import apa pun dari `KNN/`.

### 7.4 Larangan

- Mengubah file di luar `AM/` selain daftar §7.2.
- Mengubah komponen/store/hook bersama (`VariableListManager`, `ui/*`, `useModal`, `useIndexedDB` selain union, `useVariableStore`, `useDataStore`, `useResultStore`, `Output/Statistics/index.tsx`).
- Menambah dependency npm atau crate di luar yang dipakai `NB/rust/Cargo.toml`.
- Menyimpang dari rumus §5 atau mengubah kode/teks wajib §4.5 tanpa revisi dokumen.
- Menambah fitur out-of-scope (§1).

---

## 8. Konvensi Kode & Pengujian

**Penamaan.** File kebab-case; komponen PascalCase; hook `useApplyModelXxx`; konstanta default `ApplyModelXxxDefault`; field state PascalCase (pola NB/KNN); field JSON hasil Rust snake_case. Semua import memakai alias `@/` dengan path absolut (pola NB). Komentar kepala file menyebut rujukan section AGENTS.md (mis. `// AGENTS.md §5.4`).

**TypeScript.** Tanpa `any` baru (pakai `unknown` + narrowing). Fungsi aturan di `hooks/` adalah fungsi murni yang bisa dites tanpa React; hook React hanya membungkusnya dengan `useMemo`.

**Rust.** Tanpa `unwrap()`/`expect()` di jalur non-test; error sebagai `Result<_, String>` berkode. Tidak ada `HashMap` yang menentukan urutan output (pakai urutan `classes`/`feature_order`).

**Pengujian (wajib per fase, lihat PLAN.md):**

- Jest: `cd frontend && npx jest components/Modals/Analyze/Classify/apply-model` harus hijau. Test berada di `__tests__/` di samping file yang diuji, nama `<file>.test.ts(x)`.
- Rust: `cd frontend/components/Modals/Analyze/Classify/apply-model/rust && cargo test` harus hijau; contoh numerik §5.6 wajib ada.
- Lint: `cd frontend && npx eslint components/Modals/Analyze/Classify/apply-model --ext .ts,.tsx --max-warnings=0`.
- Type check: `cd frontend && npx tsc --noEmit -p .` tanpa error baru dari folder `apply-model`.
- Build WASM: `wasm-pack build --target web --release` di `AM/rust` (dan `NB/rust` untuk Fase 0).

---

## 9. Aturan untuk Agent Pelaksana

1. Kerjakan **satu fase PLAN.md per sesi**, berurutan. Jangan mengerjakan sebagian fase berikutnya.
2. Sebelum menulis kode, baca section AGENTS.md yang dirujuk fase tersebut **dan** file referensi yang disebut.
3. **Berhenti dan tanya** pemilik produk bila:
   - kode yang ada berbeda dari klaim di dokumen ini (nama fungsi/field/baris tidak ditemukan);
   - perlu mengubah file di luar §7.2 atau menambah dependency;
   - sebuah test referensi (§5.6) tidak cocok dan penyebabnya bukan bug di kode baru;
   - toolchain Rust / `wasm-pack` / akses crates.io tidak tersedia — minta pemilik produk menjalankan `cargo test` / `wasm-pack build` dan melaporkan hasilnya;
   - ada keputusan desain yang tidak tercakup dokumen ini.
4. Jangan "memperbaiki" kode NB/KNN yang terlihat salah; laporkan saja.
5. Setiap akhir fase tulis laporan singkat: file yang diubah, hasil perintah verifikasi, penyimpangan (harus nol atau sudah disetujui), lalu centang fase di PLAN.md (`✅`).

---

## 10. Glosarium

| Istilah | Arti |
|---|---|
| Apply Model / scoring | Menerapkan model terlatih ke data untuk menghasilkan prediksi; tidak ada training. |
| Model JSON / export | File hasil tombol Export Model NB, struktur `ExportedModel` (§3.1). |
| Schema version | Field `schema_version` model; `1.0` (lama) atau `1.1` (dengan count). |
| Adapter (TS) | Objek per algoritma yang memvalidasi & mendeskripsikan model untuk UI (§3.2). |
| Scorer (Rust) | Implementasi trait `ClassifierScorer` per algoritma yang menghitung skor log per kelas (§5.1). |
| Registry | Peta `model_type` → adapter/scorer. |
| Descriptor | Ringkasan model yang algoritma-agnostik untuk UI (`ModelDescriptor`). |
| Feature / fitur | Variabel prediktor di model (`features[]`). |
| Role | `categorical` (dari nominal/ordinal) atau `numerical` (dari scale). |
| Mapping | Pasangan fitur model → variabel dataset aktif. |
| Actual target | Variabel dataset berisi kelas sebenarnya, opsional, untuk evaluasi. |
| Unseen category | Nilai kategori yang tidak ada di `categories` fitur tsb pada model. |
| `(Missing)` | Label kategori untuk nilai categorical yang kosong (konvensi NB). |
| Log-score | `ln(prior) + Σ ln(likelihood)` per kelas, belum dinormalisasi. |
| Posterior | Probabilitas kelas ternormalisasi hasil log-sum-exp. |
| Not scored | Baris yang seluruh prediktornya missing; tidak diprediksi (K5). |
| Result store | `useResultStore` — penyimpanan log/analytic/statistic Output Viewer, persisten. |
| Built-in model | Model bawaan Statify dari katalog `BUILTIN_MODELS`. |
| Final name | Nama kolom setelah `processVariableName` (bisa berbeda dari yang diminta). |
