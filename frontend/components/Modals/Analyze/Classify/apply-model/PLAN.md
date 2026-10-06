# PLAN.md — Rencana Implementasi Menu Apply Model

Dokumen ini adalah rencana kerja bertahap untuk `frontend/components/Modals/Analyze/Classify/apply-model/`. Kontrak desainnya ada di `AGENTS.md` (folder yang sama). **Tidak ada kode implementasi di sini.** Singkatan path (`FE/`, `NB/`, `KNN/`, `AM/`) sama dengan `AGENTS.md`.

Cara pakai:

- Kerjakan **satu fase per sesi**, berurutan. Fase berikutnya baru boleh dimulai setelah semua kriteria selesai fase sebelumnya terpenuhi.
- Setelah fase selesai, ubah judul fase menjadi `### Fase N — ... ✅` dan tulis laporan singkat sesuai `AGENTS.md` §9.5.
- Bila sebuah langkah tidak bisa dikerjakan persis seperti tertulis, **berhenti dan tanya** (`AGENTS.md` §9.3). Jangan improvisasi.

---

## 0. Keputusan yang membentuk plan ini

1. Semua keputusan K1–K11 di `AGENTS.md` §0.
2. **Urutan:** prasyarat NB (schema 1.1) → fondasi TS (tipe, adapter, aturan murni) → engine Rust bertahap → wiring menu & UI → services & integrasi → regresi. Berbeda dari NB (UI dulu dengan stub), karena di Apply Model logika validasi/mapping (TS) dan scoring (Rust) adalah inti yang paling berisiko; UI baru dibangun setelah kontrak datanya teruji.
3. **Registrasi menu dipindah lebih awal** (Fase 11, sebelum tab-tab UI), supaya setiap fase UI bisa diverifikasi manual di browser — pola yang sama dengan NB Fase 0.
4. **Build WASM manual** (tidak lewat `build-wasm.sh`), pola NB `PLAN.md` §0.2: `wasm-pack build --target web --release` lalu salin `rust/pkg/*` ke `FE/public/workers/Classify/<Nama>/pkg/`, lalu bump query `?v=`.
5. **Toolchain Rust.** Bila agent tidak punya `cargo`/`wasm-pack`/akses crates.io, langkah `cargo test` dan `wasm-pack build` **didelegasikan ke pemilik produk**: agent berhenti, menulis perintah persisnya, dan menunggu hasil (pola NB Fase 12/14/17).

## 1. Data uji standar

**D1 — Fixture model `nb-model-v1_1.json`** (dipakai TS & Rust). Nilai persis (model 6-baris NB, `AGENTS.md` §5.6):

```json
{
  "schema_version": "1.1",
  "model_type": "naive_bayes",
  "trained_at": "2026-10-01T00:00:00.000Z",
  "target": { "name": "Play", "classes": ["No", "Yes"], "class_priors": [0.5, 0.5], "class_counts": [3, 3] },
  "features": [
    { "name": "Outlook", "role": "categorical", "categories": ["Overcast", "Rain", "Sunny"],
      "distribution": { "No": [0.5, 0.16666666666666666, 0.3333333333333333],
                        "Yes": [0.16666666666666666, 0.3333333333333333, 0.5] },
      "class_totals": { "No": 3, "Yes": 3 } },
    { "name": "Temp", "role": "numerical",
      "mean": { "No": 84.0, "Yes": 72.0 },
      "variance": { "No": 18.666666666666668, "Yes": 2.6666666666666665 } }
  ],
  "smoothing_alpha": 1.0,
  "variance_floor": 1e-9,
  "feature_order": ["Outlook", "Temp"],
  "label_mapping": { "No": 0, "Yes": 1 },
  "validation_config": { "method": "holdout", "training_percentage": 70, "holdout_percentage": 30, "folds": null, "seed": 42 },
  "missing_value_policy": "x",
  "unseen_category_policy": "x"
}
```

**D2 — Fixture `nb-model-v1_0.json`:** sama dengan D1, tetapi `schema_version: "1.0"`, tanpa `target.class_counts` dan tanpa `class_totals`.

**D3 — Dataset uji apply (6 baris)**, variabel: `Outlook` (STRING, nominal), `Temp` (NUMERIC, scale), `Play` (STRING, nominal; actual target):

| Baris | Outlook | Temp | Play |
|---|---|---|---|
| 1 | Overcast | 85 | No |
| 2 | Sunny | 71 | Yes |
| 3 | Foggy | 72 | Yes |
| 4 | Sunny | *(kosong)* | No |
| 5 | *(kosong)* | *(kosong)* | Yes |
| 6 | *(kosong)* | 80 | Maybe |

Hasil yang diharapkan dengan D1 (`AGENTS.md` §5.6, T1–T6):

| Baris | NB_PredictedValue | NB_PredictedProbability | NB_Probability_No | NB_Probability_Yes |
|---|---|---|---|---|
| 1 | No | 1.0000 | 1.0000 | 0.0000 |
| 2 | Yes | 0.9967 | 0.0033 | 0.9967 |
| 3 | Yes | 0.9921 | 0.0079 | 0.9921 |
| 4 | Yes | 0.6000 | 0.4000 | 0.6000 |
| 5 | *(kosong)* | *(kosong)* | *(kosong)* | *(kosong)* |
| 6 | No | 1.0000 | 1.0000 | 0.0000 |

Ringkasan yang diharapkan: total 6, scored 5, not scored 1, scored with missing predictor 2 (baris 4 & 6), scored with unseen category 2 (baris 3 & 6). Distribusi: No 2 (40%), Yes 3 (60%), Not scored 1. Evaluasi: evaluated 4 (baris 1–4), excluded not scored 1 (baris 5), excluded actual unknown class 1 (baris 6, "Maybe"). Confusion matrix (actual × predicted, urutan No, Yes): `[[1, 1], [0, 2]]`, overall accuracy 0.75.

---

## BAGIAN A — Prasyarat di modul Naive Bayes

### Fase 0 — Export Naive Bayes schema 1.1 ✅

- **Tujuan:** file export NB memuat `target.class_counts` dan `class_totals` per fitur categorical, `schema_version: "1.1"`.
- **Prasyarat:** tidak ada.
- **File:**
  - `NB/rust/src/stats/save.rs` (ubah)
  - `NB/services/naive-bayes-analysis-formatter.ts` (ubah tipe saja)
  - `NB/services/naive-bayes-analysis.ts` (bump versi)
  - `FE/public/workers/Classify/NaiveBayes/naive-bayes.worker.js` (bump versi)
  - `FE/public/workers/Classify/NaiveBayes/pkg/*` (salin ulang hasil build)
- **Langkah:**
  1. Di `save.rs`, tambah field `pub class_counts: Vec<u64>` ke `ExportTarget`, diisi dari `model.class_priors.class_counts[class]` untuk setiap kelas dalam urutan `preprocessed.classes` (0 bila tidak ada).
  2. Tambah field `class_totals: HashMap<String, u64>` ke varian `ExportFeature::Categorical`. Nilai per kelas = jumlah `raw_count` di `model.categorical[name].per_class[class]` (0 bila fitur/kelas tidak ada). Komentar: "AGENTS.md NB §5.10 schema 1.1 — dipakai Apply Model untuk kategori tak dikenal (§5.9)".
  3. Ubah `schema_version` menjadi `"1.1"`.
  4. Update test yang ada: `exported_model_contains_all_required_fields_with_consistent_shape` assert `schema_version == "1.1"`, `target.class_counts == vec![1, 1]` (fixture 2 baris: No=1, Yes=1), dan `class_totals` fitur Outlook `{No:1, Yes:1}`. `missing_model_entry_for_predictor_does_not_panic`: `class_totals` fitur "Ghost" berisi 0 untuk tiap kelas.
  5. Tambah test baru `class_counts_and_class_totals_match_training_counts`: pakai dataset 6-baris (`case(...)` seperti `prediction.rs` tests), assert `class_counts == [3,3]` dan `class_totals == {No:3, Yes:3}`.
  6. Di `naive-bayes-analysis-formatter.ts`, ubah `target` di `NaiveBayesTrainedModelRaw` menjadi `{ name: string; classes: string[]; class_priors: number[]; class_counts?: number[] }`. Jangan ubah yang lain.
  7. (Pemilik produk) `cd NB/rust && cargo test && wasm-pack build --target web --release`, salin `NB/rust/pkg/*` → `FE/public/workers/Classify/NaiveBayes/pkg/`.
  8. Bump `NAIVE_BAYES_WASM_VERSION` dan dua query `?v=` di worker ke nilai baru yang sama (format `naive-bayes-real-YYYYMMDD<huruf>`).
- **Acuan:** `AGENTS.md` §0 K2, §4.4, §7.2 baris 1–4; `NB/AGENTS.md` §5.10.
- **Kriteria selesai:** `cargo test` di `NB/rust` hijau (termasuk test baru); `npx tsc --noEmit -p .` tanpa error baru; Jest NB tetap hijau.
- **Verifikasi:**
  - `cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes`.
  - Manual: jalankan Naive Bayes pada dataset apa pun → Output Viewer → Export Model → buka JSON: ada `"schema_version": "1.1"`, `target.class_counts` (Σ = jumlah kasus valid), dan `class_totals` pada setiap fitur categorical.
- **Dilarang:** mengubah rumus training/scoring NB, nama field lain, atau file NB selain daftar di atas.

---

## BAGIAN B — Fondasi TypeScript (tanpa UI)

### Fase 1 — Tipe, kode, dan default ✅

- **Tujuan:** semua tipe & konstanta kontrak tersedia.
- **Prasyarat:** Fase 0.
- **File (baru):** `AM/types/model-schema.ts`, `AM/types/apply-model.ts`, `AM/types/apply-model-worker.ts`, `AM/adapters/types.ts`, `AM/constants/apply-model-codes.ts`, `AM/constants/apply-model-default.ts`, `AM/constants/builtin-models.ts`, `AM/constants/__tests__/apply-model-default.test.ts`, `AM/constants/__tests__/apply-model-codes.test.ts`.
- **Langkah:**
  1. Salin tipe persis dari `AGENTS.md` §3.1, §3.2 (hanya tipe/interface, tanpa registry), §3.3, §3.6, §4.5 (tipe kode + `ApplyModelIssue`), §6.7.
  2. Tulis `APPLY_MODEL_MESSAGES` dengan satu kalimat bahasa Indonesia per kode (lima teks wajib di §4.5 harus persis).
  3. Tulis default per section sesuai §3.3; gabung jadi `ApplyModelDefault`.
  4. `BUILTIN_MODELS = []`.
- **Acuan:** `AGENTS.md` §3.1–3.3, §3.6, §4.5, §6.7.
- **Kriteria selesai & verifikasi:**
  - Test default: assert setiap nilai default (`SourceKind "file"`, `ModelJson null`, `SaveMaxProbability true`, `SaveClassProbabilities false`, `UseCustomNames false`, lima flag Output `true`, mapping `{}`).
  - Test kode: setiap anggota union kode punya entri non-kosong di `APPLY_MODEL_MESSAGES` (iterasi daftar kode yang diekspor sebagai array `ALL_APPLY_MODEL_CODES`), dan lima teks wajib persis.
  - `npx jest components/Modals/Analyze/Classify/apply-model` hijau; `npx tsc --noEmit -p .` tanpa error baru.
- **Dilarang:** logika validasi, komponen React, file Rust.

### Fase 2 — Adapter Naive Bayes & registry (validasi model di TS) ✅

- **Tujuan:** `validateAnyModel(raw)` berfungsi untuk NB 1.0/1.1 dengan seluruh kode `AGENTS.md` §4.2–4.3.
- **Prasyarat:** Fase 1.
- **File (baru):** `AM/adapters/naive-bayes-adapter.ts`, `AM/adapters/registry.ts`, `AM/services/__fixtures__/nb-model-v1_1.json` (D1), `AM/services/__fixtures__/nb-model-v1_0.json` (D2), `AM/adapters/__tests__/naive-bayes-adapter.test.ts`, `AM/adapters/__tests__/registry.test.ts`.
- **Langkah:**
  1. Implementasikan `naiveBayesModelAdapter` (`modelType "naive_bayes"`, `algorithmLabel "Naive Bayes"`, `supportedSchemaVersions ["1.0","1.1"]`, `defaultOutputPrefix "NB"`, `resultStoreSource {componentKey: "Export Model", payloadKey: "naiveBayesTrainedModel"}`).
  2. `validate(raw)`: langkah 1–12 `AGENTS.md` §4.3 berurutan; kumpulkan semua issue; langkah 1–2 menghentikan validasi.
  3. Descriptor: `features` urut `feature_order`; `summaryRows` = `Smoothing alpha`, `Variance floor`, `Training validation` (mis. "Holdout 70% / 30%, seed 42" atau "10-fold, no seed"); `warnings` = `["AM_W_LEGACY_SCHEMA"]` bila 1.0.
  4. Registry & `validateAnyModel` sesuai §3.2 / §4.2.
- **Acuan:** `AGENTS.md` §2 P2–P3, §3.1–3.2, §4.2–4.4.
- **Kriteria selesai:** test mencakup minimal satu kasus per kode `AM_E_*` validasi model (`AM_E_NOT_OBJECT` s/d `AM_E_CLASS_TOTALS_INVALID`), dibuat dengan memodifikasi salinan D1/D2; D1 → `ok:true`, tanpa warning; D2 → `ok:true`, warning `AM_W_LEGACY_SCHEMA`; `model_type: "decision_tree"` → `AM_E_MODEL_TYPE_UNSUPPORTED` dengan `detail "decision_tree"`; field tambahan tak dikenal tidak membuat error.
- **Verifikasi:** `npx jest components/Modals/Analyze/Classify/apply-model/adapters` hijau.
- **Dilarang:** UI, loader, Rust; `if (modelType === ...)` di luar adapter/registry.

### Fase 3 — Aturan mapping variabel ✅

- **Tujuan:** `autoMapFeatures` dan `validateMapping` sesuai `AGENTS.md` §3.4.
- **Prasyarat:** Fase 2.
- **File (baru):** `AM/hooks/useApplyModelMappingRules.ts`, `AM/hooks/__tests__/useApplyModelMappingRules.test.ts`.
- **Langkah:**
  1. `autoMapFeatures(descriptor, variables): { FeatureMapping, ActualTargetVar }` — langkah 1–5 §3.4.
  2. `validateMapping(descriptor, mapping, actualTargetVar, variables): ApplyModelIssue[]` — tabel §3.4 (`detail` = nama fitur atau nama variabel).
  3. `getEligibleVariablesForFeature(role, variables)` dan `getEligibleActualTargetVariables(mapping, variables)` untuk dropdown UI.
- **Acuan:** `AGENTS.md` §3.4.
- **Kriteria selesai & verifikasi** (Jest, variabel dibuat dengan helper `makeVariable` pola `NB/hooks/__tests__/useNaiveBayesValidation.test.ts`):
  - D1 + variabel `Outlook`(nominal), `Temp`(scale), `Play`(nominal) → mapping `{Outlook:"Outlook", Temp:"Temp"}`, actual `"Play"`, tanpa issue.
  - `outlook` (huruf kecil) → tetap terpetakan; `OUTLOOK` + `outlook` sekaligus → `null` + `AM_E_MAP_UNMAPPED`.
  - `Temp` ber-measure nominal → `AM_E_MAP_ROLE_MISMATCH`; measure unknown → `AM_E_MAP_MEASURE_UNKNOWN`; `Temp` scale bertipe STRING → `AM_E_MAP_NUMERIC_TYPE`.
  - Satu variabel di dua fitur → `AM_E_MAP_DUPLICATE`; variabel terhapus → `AM_E_MAP_VAR_NOT_FOUND`.
  - Actual = variabel scale → `AM_E_ACTUAL_MEASURE`; actual = prediktor → `AM_E_ACTUAL_IS_PREDICTOR`; actual tidak ada → `AM_E_ACTUAL_NOT_FOUND`.
  - `Play` scale → auto-map actual menghasilkan `null`.
- **Dilarang:** komponen React, akses store.

### Fase 4 — Aturan penamaan & tipe kolom output, aturan Output ✅

- **Tujuan:** fungsi murni untuk §3.5 dan normalisasi checkbox §6.5.
- **Prasyarat:** Fase 2.
- **File (baru):** `AM/hooks/useApplyModelSaveRules.ts`, `AM/hooks/useApplyModelOutputRules.ts`, test masing-masing di `AM/hooks/__tests__/`.
- **Langkah:**
  1. `getOutputColumnSpecs(descriptor, save, adapter)` → daftar kolom berurutan `{ key: "predicted" | "maxProbability" | \`class:${c}\`, requestedName, label, type, measure, decimals, width, align }` (§3.5).
  2. `resolvePredictedColumnType(classes)` (§3.5).
  3. `validateCustomOutputNames(specs)` dan `validateNamePrefix(prefix)` (konstanta pola, panjang, kata cadangan **disalin** dari `KNN/hooks/useNearestNeighborSaveRules.ts:85-90`).
  4. `resolveFinalOutputNames(requestedNames, existingVariables)` memakai `processVariableName` dari `@/stores/useVariableStore`, berurutan dengan daftar yang tumbuh; return `{ finalNames, adjusted: Array<{requested, final}> }`.
  5. `normalizeCheckboxValue` dan `getEffectiveOutputFlags(output, hasActualTarget)` (Evaluation/Confusion dipaksa `false` bila tidak ada actual target).
- **Acuan:** `AGENTS.md` §3.5, §6.5.
- **Kriteria selesai & verifikasi** (Jest):
  - D1, default save → nama `["NB_PredictedValue","NB_PredictedProbability"]`; dengan `SaveClassProbabilities` → tambah `NB_Probability_No`, `NB_Probability_Yes`.
  - Kelas `["1","2","10"]` → NUMERIC decimals 0; `["0.5","1.25"]` → NUMERIC decimals 2; `["No","Yes"]` → STRING width 64; `["1","A"]` → STRING.
  - Kelas `"Rain Day"` → requested `NB_Probability_Rain Day` → final `NB_Probability_Rain_Day`.
  - Variabel dataset sudah ada `NB_PredictedValue` → final `NB_PredictedValue_1` + entri `adjusted`.
  - Nama kustom `""` → `AM_E_NAME_EMPTY`; `"1abc"` → `AM_E_NAME_INVALID`; 65 karakter → `AM_E_NAME_TOO_LONG`; `"with"` → `AM_E_NAME_RESERVED`; dua nama `abc`/`ABC` → `AM_E_NAME_DUPLICATE`.
  - `getEffectiveOutputFlags` tanpa actual → Evaluation & Confusion `false`.
- **Dilarang:** memanggil `addVariables`; komponen React.

### Fase 5 — Pemuat model (file, Output Viewer, bawaan) ✅

- **Tujuan:** `AM/services/model-loader.ts` sesuai `AGENTS.md` §4.1 & §6.6.
- **Prasyarat:** Fase 2.
- **File (baru):** `AM/services/model-loader.ts`, `AM/services/__tests__/model-loader.test.ts`.
- **Langkah:**
  1. `loadModelFromFile(file: File)`: cek ekstensi `.json` (case-insensitive) & ukuran ≤ 10 MB, `file.text()`, `JSON.parse`, `validateAnyModel`. `sourceRef = file.name`, `sourceLabel` §6.3.
  2. `listResultStoreModels()`: §6.6 (urut id statistic menurun). Item: `{ statisticId, label, modelType, trainedAt }`. Statistic yang gagal parse **dilewati** (tidak error).
  3. `loadModelFromResultStore(statisticId)`: ambil statistic, parse, validasi.
  4. `loadBuiltinModel(entryId)`: cari di `BUILTIN_MODELS`, `fetch(entry.path)`, cek `res.ok`, parse, validasi; pastikan `model.model_type === entry.modelType` (bila beda → `AM_E_MODEL_TYPE_UNSUPPORTED`).
- **Acuan:** `AGENTS.md` §4.1, §6.3, §6.6, §6.7.
- **Kriteria selesai & verifikasi** (Jest; `useResultStore` di-mock seperti `KNN/services/__tests__/nearest-neighbor-analysis.test.ts` me-mock store; `global.fetch` di-mock):
  - File D1 → ok; file `.txt` → `AM_E_PARSE`; file 11 MB (mock `size`) → `AM_E_FILE_TOO_LARGE`; isi `"{bad"` → `AM_E_PARSE`.
  - Result store berisi 1 statistic `"Export Model"` (output_data string JSON berisi D1) + 1 statistic lain → `listResultStoreModels` mengembalikan 1 item; `loadModelFromResultStore` → ok.
  - `logs` kosong → `loadResults` dipanggil tepat sekali.
  - Built-in: katalog di-mock berisi 1 entri, fetch 404 → `AM_E_BUILTIN_FETCH`; fetch D1 → ok.
- **Dilarang:** komponen React, menulis ke store.

---

## BAGIAN C — Engine Rust/WASM

### Fase 6 — Scaffold crate, payload, worker dummy ✅

- **Tujuan:** pipeline TS → worker → WASM → TS tersambung dengan hasil dummy, sebelum ada statistik.
- **Prasyarat:** Fase 1.
- **File (baru):** `AM/rust/Cargo.toml`, `AM/rust/src/lib.rs`, `AM/rust/src/{models,scoring,stats,utils,wasm}/mod.rs`, `AM/rust/src/models/{data.rs,payload.rs,result.rs}`, `AM/rust/src/utils/{error.rs,converter.rs}`, `AM/rust/src/wasm/{constructor.rs,function.rs}`, `FE/public/workers/Classify/ApplyModel/apply-model.worker.js`, `FE/public/workers/Classify/ApplyModel/pkg/*`.
- **Langkah:**
  1. `Cargo.toml`: salin `NB/rust/Cargo.toml`, ubah `description` menjadi "Project Rust-Wasm Statify - Apply Model."; dependency **identik**.
  2. `models/data.rs`: salin `DataRecord`, `DataValue`, `ValueLabel`, `VariableType`, `VariableAlign`, `VariableMeasure`, `VariableRole`, `VariableDefinition` dari `NB/rust/src/models/data.rs:10-111` (header komentar sumber).
  3. `models/payload.rs`: `MappingEntry { feature: String, variable: String }`.
  4. `models/result.rs`: struct serde untuk `ApplyModelRawResult` persis `AGENTS.md` §3.6 (nama field snake_case sama).
  5. `utils/`: salin `error.rs` & `converter.rs` dari NB.
  6. `wasm/constructor.rs`: `#[wasm_bindgen] pub struct ApplyModelAnalysis` dengan constructor 6 argumen (`AGENTS.md` §7.1), parse semua `JsValue` (model sebagai `serde_json::Value`), simpan; `get_formatted_results()` mengembalikan `ApplyModelRawResult` dummy (semua angka 0, array kosong) dan `get_all_errors()`.
  7. Worker: tiru `naive-bayes.worker.js`; destrukturisasi `{ predictors, predictorDefs, mapping, actual, actualDefs, model }`; versi `?v=apply-model-dummy-YYYYMMDDa`.
  8. (Pemilik produk) `cd AM/rust && wasm-pack build --target web --release`, salin `pkg/*` ke `FE/public/workers/Classify/ApplyModel/pkg/`.
- **Acuan:** `AGENTS.md` §2 P5–P6, §3.6, §7.1.
- **Kriteria selesai & verifikasi:** `cargo build` dan `wasm-pack build` sukses; manual di console browser (dev server jalan): buat `new Worker("/workers/Classify/ApplyModel/apply-model.worker.js?v=...", {type:"module"})`, `postMessage` payload D1 + slice kosong → `onmessage` menerima `{success:true, data:{...dummy}}`.
- **Dilarang:** logika scoring; import lintas crate.

### Fase 7 — Normalisasi nilai & parsing/validasi model NB di Rust ✅

- **Tujuan:** `value_label.rs` dan `NaiveBayesScorer::from_json` (validasi lapis kedua).
- **Prasyarat:** Fase 6.
- **File:** `AM/rust/src/stats/value_label.rs` (baru), `AM/rust/src/scoring/mod.rs` (isi: `FeatureSpec`, `FeatureRole`, `RowScore`, trait, `build_scorer`), `AM/rust/src/scoring/naive_bayes.rs` (baru; `score_row` sementara `unimplemented` **tidak boleh** — kembalikan `RowScore::NotScored` dengan komentar `// Fase 8`).
- **Langkah:**
  1. Salin `is_missing_value`, `data_value_to_label`, `format_number_label`, `MISSING_CATEGORY_LABEL` dari `NB/rust/src/stats/preprocess_data.rs:28,224-252` (+ header sumber), plus `numeric_value(v) -> Option<f64>`.
  2. `NaiveBayesScorer::from_json`: deserialisasi + validasi `AGENTS.md` §4.3 langkah 1–11 dengan pesan `"AM_E_XXX: detail"`.
  3. `build_scorer`: cek objek & `model_type` (§4.2), dispatch.
- **Acuan:** `AGENTS.md` §4.2–4.4, §5.1–5.3.
- **Kriteria selesai & verifikasi** (`cargo test`):
  - `data_value_to_label`: `Number(1.0)→"1"`, `Number(1.5)→"1.5"`, `Text(" Sunny ")→"Sunny"`, `Boolean(true)→"true"`; `is_missing_value`: `Null`, `Text("  ")`, `Number(NaN)` → true.
  - D1 (sebagai string JSON di test, `serde_json::from_str`) → Ok, `classes == ["No","Yes"]`, 2 fitur, `is_legacy_unseen_handling() == false`; D2 → Ok, legacy `true`.
  - Minimal 8 kasus error: `model_type` hilang, `"decision_tree"`, `schema_version "2.0"`, priors panjang salah, distribution sum 0.9, variance 0, `class_counts` hilang di 1.1, `class_totals` kelas hilang — setiap pesan diawali kode yang benar.
- **Dilarang:** posterior/argmax (Fase 9).

### Fase 8 — `score_row` Naive Bayes (contoh numerik) ✅

- **Tujuan:** skor log per kelas sesuai `AGENTS.md` §5.4.
- **Prasyarat:** Fase 7.
- **File:** `AM/rust/src/scoring/naive_bayes.rs` (ubah).
- **Langkah:**
  1. Implementasikan langkah 1–5 §5.4 persis, termasuk flag `had_missing`, `had_unseen`, `skipped_unseen`.
  2. `log_gaussian_density` dan `safe_ln` disalin dari `NB/rust/src/stats/prediction.rs:92-95,163-169` (+ header sumber).
- **Acuan:** `AGENTS.md` §5.4, §5.6.
- **Kriteria selesai & verifikasi** (`cargo test`): test T1–T7 dari tabel §5.6 (skor toleransi `1e-9`, flag tepat; T5 → `NotScored`); T1 & T2 identik dengan angka di test `prediction.rs`.
- **Dilarang:** normalisasi posterior di file ini.

### Fase 9 — Posterior, prediksi, ringkasan, distribusi ✅

- **Tujuan:** pipeline generik di atas `ClassifierScorer`.
- **Prasyarat:** Fase 8.
- **File (baru):** `AM/rust/src/stats/posterior.rs`, `AM/rust/src/stats/summary.rs`; `AM/rust/src/wasm/function.rs` (ubah: `run_apply_model` tanpa evaluasi).
- **Langkah:**
  1. `posterior.rs`: `normalize_log_scores(&[f64]) -> Vec<f64>` (log-sum-exp), `argmax_with_tie_break(classes, scores) -> usize` (§5.5), `round4`.
  2. `summary.rs`: akumulasi `case_processing_summary` & `prediction_distribution` (§5.7) dan array `predictions`.
  3. `function.rs::run_apply_model(payload)`: validasi payload (§5.8), `build_scorer`, susun `values` per baris (urutan `mapping`), `score_row`, posterior, ringkasan, `warnings`; `evaluation: None` untuk sementara; `model_summary` dari scorer + `mapping`.
- **Acuan:** `AGENTS.md` §3.6, §5.5, §5.7, §5.8.
- **Kriteria selesai & verifikasi** (`cargo test`):
  - `normalize_log_scores([-8.700853417751961, -2.9831475208304266])` ≈ `[0.003276472969649914, 0.9967235270303499]` (1e-12); `[0.0, 0.0]` → `[0.5, 0.5]`; `[-1000.0, -1001.0]` tidak NaN.
  - Tie `[-1.0, -1.0]` dengan kelas `["b","a"]` → pemenang `"a"`.
  - `run_apply_model` dengan D1 + D3 (tanpa actual) → `predictions` & ringkasan persis tabel hasil D3 di §1 (`predicted`, `max_probability`, `class_probabilities`, total 6/scored 5/not scored 1/missing 2/unseen 2, distribusi No 2 = 40.0, Yes 3 = 60.0); `warnings` berisi `AM_W_ROWS_NOT_SCORED` count 1 dan `AM_W_UNSEEN_CATEGORY` count 2.
  - Dengan D2: baris 3 & 6 menghasilkan `AM_W_UNSEEN_SKIPPED_LEGACY` count 2, probabilitas baris 3 = 0.9921 (T7).
  - Payload mapping tidak sejajar → error `AM_E_PAYLOAD`; 0 baris → `AM_E_NO_ROWS`.
- **Dilarang:** evaluasi (Fase 10).

### Fase 10 — Evaluasi & binding WASM final ✅

- **Tujuan:** confusion matrix & metrik bila actual target ada; WASM produksi.
- **Prasyarat:** Fase 9.
- **File:** `AM/rust/src/stats/classification_table.rs` (baru, salinan **utuh** `NB/rust/src/stats/classification_table.rs` termasuk test-nya, + header sumber), `AM/rust/src/stats/evaluation.rs` (baru), `AM/rust/src/wasm/{function.rs,constructor.rs}` (ubah), `FE/public/workers/Classify/ApplyModel/{apply-model.worker.js,pkg/*}`.
- **Langkah:**
  1. `evaluation.rs`: filter baris (§5.7), panggil `compute_confusion_matrix` + `compute_evaluation_metrics`, serialisasi ke bentuk JSON `evaluation_result_to_json` NB (`NB/rust/src/wasm/function.rs:249-299`).
  2. `run_apply_model`: isi `evaluation` bila `actual` tidak kosong; tambah warning `AM_W_ACTUAL_UNKNOWN_CLASS`.
  3. `constructor.rs`: jalankan `run_apply_model` di constructor (pola `NB/rust/src/wasm/constructor.rs`), kembalikan `Err(JsValue)` berkode bila gagal.
  4. (Pemilik produk) `cargo test` + `wasm-pack build`, salin `pkg/`; ganti versi worker ke `apply-model-YYYYMMDDa`.
- **Acuan:** `AGENTS.md` §5.7, §7.1.
- **Kriteria selesai & verifikasi** (`cargo test`): D1 + D3 + actual `Play` → `evaluated_rows 4`, `excluded_not_scored 1`, `excluded_actual_unknown_class 1`, `excluded_actual_missing 0`, matrix `[[1,1],[0,2]]`, `overall_accuracy 0.75`, `grand_total 4`; semua test salinan `classification_table.rs` hijau; `wasm-pack build` sukses; manual console worker dengan payload D1+D3 → `data.evaluation` terisi.
- **Dilarang:** mengubah isi salinan `classification_table.rs` selain header komentar.

---

## BAGIAN D — Wiring & UI

### Fase 11 — Wiring menu & skeleton container ✅

- **Tujuan:** menu "Apply Model" membuka sidebar 40% berisi skeleton 4 tab.
- **Prasyarat:** Fase 1.
- **File:** `FE/types/modalTypes.ts`, `Classify/ClassifyRegistry.tsx`, `Classify/classify-menu.tsx`, `FE/app/dashboard/layout.tsx`, `FE/hooks/useIndexedDB.ts` (semua ubah, persis `AGENTS.md` §7.2 baris 5–9); `AM/dialogs/apply-model-main.tsx` (baru, skeleton).
- **Langkah:**
  1. Lakukan lima perubahan wiring §7.2 (5–9). Di `ClassifyRegistry.tsx` gunakan pola lazy import NB (default export, tanpa `.then`).
  2. Skeleton container: header "Apply Model", 4 tab (`Model`, `Variables`, `Save`, `Output`) berisi placeholder "TODO", footer Help/OK(disabled)/Reset/Cancel; Cancel menutup (`closeModal(); onClose();`).
- **Acuan:** `AGENTS.md` §0 K10, §6.1, §7.2.
- **Kriteria selesai & verifikasi (manual):** Analyze → Classify → "Apply Model" (di bawah Naive Bayes, setelah separator) → sidebar kanan ±40% lebar, judul "Apply Model"; Cancel menutup tanpa error console; buka NB, KNN, Discriminant → perilaku & lebar tetap seperti sebelumnya; `npx tsc --noEmit -p .` lulus.
- **Dilarang:** logika tab; perubahan lain di file bersama.

### Fase 12 — Tab Model ✅

- **Tujuan:** pengguna bisa memuat model dari 3 sumber dan melihat ringkasannya.
- **Prasyarat:** Fase 5, Fase 11.
- **File:** `AM/dialogs/model-tab.tsx` (baru), `AM/dialogs/apply-model-main.tsx` (ubah), `AM/dialogs/__tests__/model-tab.test.tsx` (baru).
- **Langkah:**
  1. Bangun UI §6.2 memakai fungsi loader Fase 5. Props: `data: ApplyModelModelTabType`, `onModelLoaded(result)`, `showFieldHelp`.
  2. Container: `onModelLoaded` → set `model`, reset `variables` lalu `autoMapFeatures`, reset `save` (§6.1). Tab lain `disabled` selama `ModelJson === null`.
- **Acuan:** `AGENTS.md` §6.1–6.3, §6.7.
- **Kriteria selesai & verifikasi:**
  - RTL: upload D1 (mock `File`) → kartu ringkasan menampilkan "Naive Bayes", "1.1", "Play", "No, Yes", fitur Outlook (categorical) & Temp (numerical); upload D2 → banner `AM_W_LEGACY_SCHEMA`; upload JSON rusak → daftar error tampil & `ModelJson` tetap `null`; radio built-in → Select disabled + teks "Belum ada model bawaan Statify.".
  - Manual: jalankan NB dulu, lalu Apply Model → "From Output Viewer" menampilkan model itu dan bisa dimuat.
- **Dilarang:** mapping UI, menjalankan worker.

### Fase 13 — Tab Variables (mapping) ✅

- **Tujuan:** UI pemetaan §6.4.
- **Prasyarat:** Fase 3, Fase 12.
- **File:** `AM/dialogs/variables-tab.tsx` (baru), `AM/dialogs/apply-model-main.tsx` (ubah), `AM/dialogs/__tests__/variables-tab.test.tsx` (baru).
- **Langkah:** bangun tabel mapping + Select per fitur (opsi dari `getEligibleVariablesForFeature`), tombol "Auto-map by name", Select actual target; status per baris dari `validateMapping`.
- **Acuan:** `AGENTS.md` §3.4, §6.4.
- **Kriteria selesai & verifikasi:**
  - RTL: model D1 + variabel D3 → kedua fitur otomatis terpetakan & status ✓, actual = Play; ubah Temp ke "— Not mapped —" → status menampilkan pesan `AM_E_MAP_UNMAPPED`; Select Temp hanya berisi variabel scale.
  - Manual: dataset D3 dibuat di Data View, model D1 di-upload → mapping otomatis benar.
- **Dilarang:** `VariableListManager`; mengubah store variabel.

### Fase 14 — Tab Save & Tab Output ✅

- **Tujuan:** UI §6.5 (bagian Save & Output).
- **Prasyarat:** Fase 4, Fase 13.
- **File:** `AM/dialogs/save-tab.tsx`, `AM/dialogs/output-tab.tsx` (baru), `AM/dialogs/apply-model-main.tsx` (ubah), test RTL masing-masing.
- **Langkah:** Save: checkbox, prefix, "Use custom names", tabel nama (Requested / Final name) memakai `getOutputColumnSpecs`, `validateCustomOutputNames`, `resolveFinalOutputNames` (variabel dari `useVariableStore`). Output: lima checkbox + aturan disabled.
- **Acuan:** `AGENTS.md` §3.5, §6.5.
- **Kriteria selesai & verifikasi:**
  - RTL: D1 default → tabel berisi 2 baris (`NB_PredictedValue`, `NB_PredictedProbability`); centang per kelas → 4 baris; prefix `XY` → `XY_PredictedValue`; custom name kosong → error `AM_E_NAME_EMPTY` tampil; variabel `NB_PredictedValue` sudah ada → Final name `NB_PredictedValue_1` + ikon peringatan.
  - RTL Output: tanpa actual target → dua checkbox evaluasi disabled.
- **Dilarang:** menulis ke dataset.

### Fase 15 — Validasi terpusat, OK/Reset/Help, persistensi ✅

- **Tujuan:** perilaku container lengkap §6.1 (tanpa menjalankan analisis; OK memanggil fungsi `applyModel` placeholder yang hanya `console.info` payload-nya — diganti di Fase 17).
- **Prasyarat:** Fase 14.
- **File:** `AM/hooks/useApplyModelValidation.ts` (+ test), `AM/dialogs/apply-model-main.tsx` (ubah).
- **Langkah:**
  1. Hook §6.5.
  2. OK/Reset/Cancel/Help, load/save IndexedDB `"ApplyModel"` dengan `_variablesFingerprint`, reset parsial saat dataset berubah (§6.1).
- **Acuan:** `AGENTS.md` §6.1, §6.5.
- **Kriteria selesai & verifikasi:**
  - Jest hook: tanpa model → `isValid false`; D1 + mapping valid → `true`; tambah nama kustom invalid → `false`.
  - Manual: (a) OK disabled sebelum model dimuat; (b) muat D1, OK → panel tertutup, buka lagi → model & mapping masih ada; (c) Reset → semua default, tab Model aktif; (d) tambah variabel baru di Variable View saat panel terbuka → mapping disusun ulang, model tetap, toast info muncul; (e) Help → teks bantuan muncul/hilang.
- **Dilarang:** worker & penulisan dataset.

---

## BAGIAN E — Services & integrasi

### Fase 16 — Formatter, output viewer, pesan error ✅

- **Tujuan:** `ApplyModelRawResult` → tabel Output Viewer.
- **Prasyarat:** Fase 10, Fase 4.
- **File (baru):** `AM/services/apply-model-formatter.ts`, `AM/services/apply-model-output.ts`, `AM/services/apply-model-error-messages.ts`, `AM/services/__fixtures__/apply-model-raw-result.json` (hasil D1+D3+actual sesuai §1), test masing-masing.
- **Langkah:** implementasikan tiga baris tabel §6.6 (formatter, output, error-messages); evaluasi memakai `buildEvaluationMetricsTables` & `buildConfusionMatrixTable` dari NB (import read-only §7.3).
- **Acuan:** `AGENTS.md` §6.6, §7.3.
- **Kriteria selesai & verifikasi** (Jest, `useResultStore` di-mock):
  - Formatter dipanggil dengan `context = { sourceLabel: "File: nb-model-v1_1.json", savedColumns: [...] }` (`AGENTS.md` §6.6); tabel Model Summary memuat baris Source tersebut dan tabel Saved Variables memuat `savedColumns`.
  - Formatter: fixture + semua flag → tabel dengan key `apply_model_summary`, `apply_model_case_processing_summary`, `apply_model_prediction_distribution`, `apply_model_saved_variables`, `evaluation_metrics`, `evaluation_metrics_kappa`, `confusion_matrix`; distribusi berisi baris No (2, 40), Yes (3, 60), Not scored (1), Total (6).
  - Output: uncheck ConfusionMatrix → `addStatistic` tidak dipanggil untuk `"Apply Model Confusion Matrix"`; tidak ada `components` bernilai `"Case Processing Summary"` atau `"Export Model"`.
  - Error: `"AM_E_SCHEMA_VERSION_UNSUPPORTED: 2.0"` → teks §4.5 dengan "2.0"; `"Failed to load wasm module"` → pesan `AM_E_WORKER`; teks acak → pesan generik.
- **Dilarang:** menulis variabel ke dataset.

### Fase 17 — Penulisan kolom & orkestrator ✅

- **Tujuan:** OK menjalankan pipeline penuh.
- **Prasyarat:** Fase 15, Fase 16.
- **File:** `AM/services/apply-model-save-variables.ts`, `AM/services/apply-model-analysis.ts` (baru, + test), `AM/dialogs/apply-model-main.tsx` (ubah: ganti placeholder dengan `applyModel`).
- **Langkah:**
  1. `buildOutputColumns(raw, specs, finalNames, startColumnIndex)` → `{ definitions: Partial<Variable>[], updates: CellUpdate[] }` (§3.5; nilai NUMERIC predicted = `Number(label)`; `null` dilewati).
  2. `saveApplyModelVariables` → satu panggilan `addVariables`.
  3. `applyModel` sesuai §6.6 (payload §3.6 dengan satu `getSlicedData`), urutan: worker → `resultApplyModel` → `saveApplyModelVariables`; return ringkasan untuk toast sukses (§6.1).
- **Acuan:** `AGENTS.md` §3.5, §3.6, §6.1, §6.6.
- **Kriteria selesai & verifikasi:**
  - Jest (`useVariableStore`/`useResultStore` di-mock, `Worker` di-mock mengembalikan fixture Fase 16): `addVariables` dipanggil sekali; definisi `NB_PredictedValue` STRING nominal width 64; update baris 5 (index 4) tidak ada; nilai probabilitas baris 2 = 0.9967; payload `predictors.length === 2`, `mapping[0].feature === "Outlook"`.
  - Manual end-to-end dengan D3 + upload D1 + actual Play + per-class prob ON → Data View berisi 4 kolom baru dengan nilai persis tabel §1; Output Viewer menampilkan log "Apply Model" berisi tabel sesuai §1 (evaluated 4, accuracy 0.75).
- **Dilarang:** `updateCells` pada variabel yang sudah ada; perubahan worker/Rust.

### Fase 18 — Regresi penuh, dokumentasi, checklist ✅

- **Tujuan:** memastikan seluruh kontrak terpenuhi & tidak ada regresi.
- **Prasyarat:** Fase 17.
- **File:** tidak ada kode baru; hanya `AM/PLAN.md` (centang) dan perbaikan bug kecil yang ditemukan **di dalam `AM/`**.
- **Langkah & verifikasi:**
  1. Jalankan: Jest folder `apply-model` dan `naive-bayes`; `cargo test` di `AM/rust` dan `NB/rust`; eslint `--max-warnings=0` folder `apply-model`; `npx tsc --noEmit -p .`.
  2. Skenario manual:
     - S1: D1 upload + D3 → hasil §1 (sudah di Fase 17, ulangi).
     - S2: D2 (schema 1.0) → banner legacy, baris 3 prob 0.9921, warning `AM_W_UNSEEN_SKIPPED_LEGACY` di Output Viewer.
     - S3: jalankan NB nyata → Apply Model dari "From Output Viewer" pada dataset yang sama → kolom terbentuk tanpa error; jumlah scored = jumlah baris dengan ≥1 prediktor terisi.
     - S4: jalankan Apply Model dua kali → kolom kedua bernama `NB_PredictedValue_1` dst., toast menyebut nama akhir.
     - S5: custom names aktif dengan nama valid → nama dipakai persis.
     - S6: model `model_type` diubah manual jadi `"svm"` → error `AM_E_MODEL_TYPE_UNSUPPORTED`, OK tetap disabled.
     - S7: reload halaman → buka Apply Model → model & mapping masih ada.
     - S8: NB, KNN, Discriminant masih terbuka normal & lebar sidebar benar.
  3. Isi checklist akhir di bawah.
- **Dilarang:** fitur baru; mengubah file di luar `AM/` (kecuali yang sudah diubah di Fase 0/11 bila ada bug wiring — laporkan dulu).

---

## Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Lupa build/salin ulang `pkg/` setelah mengubah Rust (NB atau AM) | Browser memakai WASM lama, hasil tidak sesuai | Bump `?v=` setiap salin; verifikasi manual tiap fase Rust; Fase 0 & 10 eksplisit mendelegasikan build. |
| Normalisasi label kategori berbeda dari NB (mis. `1` vs `1.0`) | Kategori dikenal dianggap unseen → prediksi salah | Fungsi disalin persis (§5.3) + unit test di Fase 7; data selalu melewati `getSlicedData` yang sama. |
| Model schema 1.0 lama di result store | Perilaku unseen berbeda dari NB | Banner + warning `AM_W_LEGACY_SCHEMA`/`AM_W_UNSEEN_SKIPPED_LEGACY`; anjuran ekspor ulang. |
| `processVariableName` mengubah nama tanpa sepengetahuan pengguna | Pengguna bingung nama kolom | Preview "Final name" di tab Save + toast sukses menyebut nama akhir + tabel "Saved Variables". |
| Perubahan `layout.tsx` meregresi sidebar modal lain | Lebar sidebar modul lain salah | Perubahan satu kondisi `\|\|`; regresi S8. |
| Struktur `Log.analytics[].statistics[]` di result store tidak terisi setelah `loadResults` | Sumber "From Output Viewer" kosong | Test Fase 5 + verifikasi manual Fase 12; bila struktur berbeda → berhenti & tanya (§9.3). |
| Kardinalitas kelas tinggi + per-class probability | Banyak kolom baru | Default OFF; jumlah kolom terlihat di preview tab Save. |
| Dataset besar via `postMessage` | Lambat/memori | Pola sama dengan NB/KNN (risiko bawaan); dicatat, tidak dioptimasi di scope ini. |
| Toolchain Rust tidak tersedia untuk agent | Fase Rust macet | Delegasi eksplisit ke pemilik produk dengan perintah persis (§0.5). |
| Kategori bernilai literal `"(Missing)"` di data | Bercampur dengan kategori missing | Perilaku identik NB (diwarisi), dicatat; tidak diubah. |

---

## Checklist Akhir

- [x] Fase 0–18 bertanda ✅ dengan laporan.
- [x] Export NB menghasilkan schema 1.1 dengan `class_counts` & `class_totals`.
- [x] Ketiga sumber model berfungsi; katalog bawaan kosong menampilkan pesan yang benar.
- [x] Semua kode `AM_E_*`/`AM_W_*` punya pesan & minimal satu test pemicu (kecuali `AM_E_WORKER`, `AM_W_NO_RESULT_STORE_MODELS`, `AM_W_BUILTIN_EMPTY` yang diuji lewat UI/RTL).
- [x] Contoh numerik T1–T7 lulus di `cargo test`; hasil D3 di UI identik dengan §1.
- [x] Tidak ada `if (modelType === ...)` di luar adapter/scorer/registry.
- [x] Hanya file di `AGENTS.md` §7.2 yang berubah di luar `AM/` (cek `git status`/`git diff --stat`).
- [x] Jest, cargo test (AM & NB), eslint, tsc hijau. *(Catatan Fase 18: Jest `apply-model` 19 suite/339 test hijau; `cargo test` AM 117 & NB 94 hijau; eslint & tsc bersih. Jest `naive-bayes` memiliki 2 test gagal yang sudah ada di HEAD, tidak berasal dari Apply Model dan tidak diubah: `useNaiveBayesValidation.test.ts` "form kosong" — test mengharapkan pesan target & predictor, hook hanya mengembalikan "Pilih variabel target." (`useNaiveBayesValidation.ts:77-86`); `options.test.tsx` "shows error for value > 999" — `getByText(/maksimum 999/i)` cocok dengan dua elemen (`options.tsx:23` dan `:52`). Dilaporkan sebagai temuan, perbaikan di luar Fase 18.)*
- [x] Regresi S1–S8 lulus.
