# VERIFY-RESULT.md — Laporan Verifikasi Implementasi Apply Model

**Tanggal verifikasi:** 2026-10-03
**Diverifikasi oleh:** Claude (Cowork), model `claude-opus-5-5`
**Acuan mengikat:** `AGENTS.md` (K1–K11, P1–P7, §3–§7) dan `PLAN.md` (Fase 0–18, data uji D1–D3)
**Status keseluruhan:** ⚠️ **Perlu perbaikan kecil sebelum merge.** Ada 1 penyimpangan kontrak (K10, satu baris) dan masalah kebersihan git yang harus dibereskan sebelum commit. Logika inti (validasi, mapping, scoring, evaluasi, output) **lolos semua pemeriksaan**.

---

## RINGKASAN EKSEKUTIF

| Item | Hasil |
|---|---|
| Fase PLAN.md | **19 fase (0–18)**. Catatan: `VERIFY-PROMPT.md` menyebut "17 fase", padahal PLAN.md berisi Fase 0–18. |
| Fase yang lolos penuh | 0–10, 12–17 (17 fase) |
| Fase dengan temuan | 11 (separator menu K10), 18 (regresi manual S1–S8 belum bisa saya ulangi; ada masalah kebersihan git) |
| Blocker | **1**: separator menu tidak ada (K10 / §7.2 baris 7) |
| Warning | **5** (lihat Bagian D) |
| Info | **9** |
| Siap commit? | **Belum.** Dua langkah dulu: (1) tambah `<MenubarSeparator />` (1 baris), (2) `git add` seluruh folder `apply-model/` beserta worker/pkg, karena saat ini banyak file wajib masih *untracked*. Setelah itu siap. |

**Bukti terkuat:** WASM produksi (`public/workers/Classify/ApplyModel/pkg/wasm_bg.wasm`) saya jalankan langsung di Node dengan model D1/D2 dan dataset D3. Hasilnya **identik persis** dengan T1–T6, ringkasan D3, evaluasi (matrix `[[1,1],[0,2]]`, akurasi 0.75), dan T7 (schema 1.0). Fixture `apply-model-raw-result.json` juga identik dengan keluaran WASM sungguhan.

---

## METODE & BATASAN LINGKUNGAN

| Pemeriksaan | Cara | Hasil |
|---|---|---|
| Jest `apply-model/**` | Dijalankan di VM Linux pada folder Anda. `node_modules` terpasang untuk Windows, jadi resolver native Jest 30 (`unrs-resolver`) di-*shim* dengan resolver JS dan `next/jest` (SWC native) diganti `ts-jest`. Config sementara ada di luar repo. | ✅ **19 suite / 339 test PASS** (constants 13, adapters+hooks 175, services 77, dialogs 74) |
| Jest `naive-bayes/**` | Cara sama | ⚠️ 3 suite / 28 test: 26 pass, **2 fail**. Keduanya sudah ada sebelum Apply Model (lihat W4) |
| Type check | `tsc --noEmit` atas closure `apply-model/**` + `ClassifyRegistry.tsx`, `classify-menu.tsx`, `app/dashboard/layout.tsx` | ✅ 0 error kode. Satu-satunya error adalah tipe matcher jest-dom di file test, akibat config sementara saya (bukan bug). `tsc` seluruh proyek tidak sempat (batas waktu 3 menit per perintah di VM). |
| `cargo test` (AM & NB) | **Tidak bisa dijalankan.** VM tidak punya `cargo`; container cloud punya `cargo` tetapi crates.io diblokir (403). | ⏳ Belum direproduksi. Jumlah `#[test]` di crate AM = **117**, cocok dengan klaim Fase 18. Sebagai pengganti, WASM hasil build diuji end-to-end (di bawah). |
| WASM end-to-end | `pkg/wasm.js` + `wasm_bg.wasm` di-load dengan `initSync` di Node 22, lalu `new ApplyModelAnalysis(...)` dipanggil dengan payload D1/D2 + D3 | ✅ Identik dengan T1–T7 & ringkasan §1 |
| Paritas validasi TS ↔ Rust | Fuzz 1.710 mutasi D1/D2 (setiap path field × 15 nilai rusak). Kode error dari `naiveBayesModelAdapter.validate` dibandingkan dengan WASM | ✅ **0 selisih** di luar mutasi `model_type`. Mutasi itu memang ditangani registry/`validateAnyModel`, bukan adapter, dan ditangani setara di kedua sisi. |
| Rumus skor | Implementasi referensi independen (JS) untuk T1–T7 | ✅ Semua skor log cocok dengan tabel §5.6 (toleransi 1e-9) |
| ESLint | Timeout. `projectService` memuat seluruh proyek lewat filesystem mount. | ⏳ Belum direproduksi (Fase 18 mengklaim bersih) |
| Skenario manual S1–S8 | Butuh browser dan dev server | ⏳ Belum diverifikasi saya; perlu konfirmasi pemilik produk |

**Catatan proses:** satu `git status` dari VM meninggalkan `.git/index.lock` kosong (VM tidak boleh menghapus file). File itu sudah saya hapus setelah Anda memberi izin, jadi repo kembali normal. Tidak ada file kode yang saya ubah. Arsip sementara `temp/am-verify-snapshot.tgz` juga sudah dihapus.

**Tentang `VERIFY-PROMPT.md`:** beberapa nama di prompt tidak ada di AGENTS.md, misalnya kode `AM_E_SCHEMA_VERSION_MISSING`, `AM_E_TARGET_MISSING`, `AM_E_FEATURES_INVALID_TYPE`, `AM_E_FEATURE_NAME_DUPLICATE`, `AM_W_MISSING_PREDICTOR`, fungsi `getAdapterForModelType`/`getDescriptor()`/`getDefaultPrefix()`, dan tipe `ApplyModelForm`/`ApplyModelState`. Karena AGENTS.md yang mengikat, verifikasi memakai nama di AGENTS.md (§3.2, §4.5). Kode yang ada sudah benar mengikuti AGENTS.md.

---

## BAGIAN A — VALIDASI KONTRAK (AGENTS.md)

### Keputusan K1–K11

| # | Status | Temuan & bukti |
|---|---|---|
| K1 Tiga sumber model | ✅ | `services/model-loader.ts`: `loadModelFromFile` (cek `.json`, ≤10 MB → `AM_E_FILE_TOO_LARGE`, `AM_E_PARSE`), `listResultStoreModels` (urut id menurun, `loadResults()` sekali bila `logs` kosong, statistic rusak dilewati), `loadModelFromResultStore`, `loadBuiltinModel` (`fetch`, `res.ok`, cek `model_type === entry.modelType`). `constants/builtin-models.ts`: `BUILTIN_MODELS = []`. Semua sumber lewat `validateAnyModel`. |
| K2 Export NB schema 1.1 | ✅ | Commit `35495bea`: `save.rs` menambah `ExportTarget.class_counts: Vec<u64>` dan `Categorical.class_totals: HashMap<String,u64>` (Σ `raw_count`), `schema_version "1.1"`, test lama diperbarui, test baru `class_counts_and_class_totals_match_training_counts`. Formatter NB: `class_counts?: number[]`. `NAIVE_BAYES_WASM_VERSION` → `naive-bayes-real-20261002a`, worker di-bump, `wasm_bg.wasm` di-build ulang. |
| K3 Crate Rust/WASM sendiri | ✅ | `apply-model/rust/` (crate `wasm`, wasm-pack), worker `public/workers/Classify/ApplyModel/apply-model.worker.js`. `pkg/` di public identik byte-per-byte dengan `rust/pkg/` dan di-build (23:38) setelah perubahan `.rs` terakhir (23:32). |
| K4 Pemetaan variabel | ✅ | `hooks/useApplyModelMappingRules.ts`: exact → case-insensitive unik, duplikat → `null`, actual hanya nominal/ordinal & bukan prediktor. `validateMapping` mencakup 9 kode §3.4. Lapis kedua di Rust: `AM_E_MAP_ROLE_MISMATCH` (`wasm/function.rs`, `validate_payload`). |
| K5 Baris tanpa prediktor | ✅ | `score_row` → `RowScore::NotScored` bila semua `is_missing_value`; output `null`, `not_scored_all_missing`, warning `AM_W_ROWS_NOT_SCORED`. WASM: baris 5 D3 = `null`, count 1. |
| K6 Kolom output | ✅ | `hooks/useApplyModelSaveRules.ts`: urutan predicted → max prob → per kelas, default ON/OFF benar, `resolvePredictedColumnType` (regex §3.5, decimals, width 12/64), `resolveFinalOutputNames` memakai `processVariableName` dengan daftar yang tumbuh (identik `addVariables`). `apply-model-save-variables.ts`: satu `addVariables`, sel `null` dilewati, tanpa `updateCells`. |
| K7 Output Viewer | ✅ | `apply-model-formatter.ts`: 4 tabel AM + `buildEvaluationMetricsTables`/`buildConfusionMatrixTable` NB. `apply-model-output.ts`: `components` unik `"Apply Model …"`, tidak memakai `"Case Processing Summary"`/`"Export Model"`. |
| K8 Validasi ketat berkode | ✅ | TS `naive-bayes-adapter.ts` (langkah 1–12) dan Rust `scoring/naive_bayes.rs::validate_model` (langkah 1–11), toleransi 1e-6 di kedua sisi. Paritas fuzz 0 selisih. Satu kode di luar daftar: `AM_E_SERIALIZE` (W3). |
| K9 Dataset aktif | ✅ | `applyModel` memakai `useDataStore.getState().data` dan **satu** `getSlicedData` untuk prediktor + actual. |
| K10 Penempatan UI | ❌ **sebagian** | ✅ `ModalApplyModel` setelah `ModalNaiveBayes`, kategori Analyze, judul "Apply Model"; lazy import & preferensi `"sidebar"`; `layout.tsx` kondisi lebar 40%; IndexedDB `"ApplyModel"`; label EN, toast/pesan ID. ❌ **`classify-menu.tsx` baris 43–44: item "Apply Model" ditempel langsung setelah "Naive Bayes" tanpa `MenubarSeparator`.** K10 & §7.2 baris 7 mewajibkan separator. |
| K11 NB/AGENTS.md | ✅ | Diubah hanya di commit Fase 0 (`35495bea`). Tidak ada perubahan lain di folder NB di working tree. |

### Prinsip P1–P7

| # | Status | Bukti |
|---|---|---|
| P1 Kontrak = JSON NB | ✅ | `types/model-schema.ts` identik §3.1 (nama field tidak diubah). Rust membaca `serde_json::Value` dengan nama field sama. Field tak dikenal diabaikan (diuji). |
| P2 Dua registry sejajar | ✅ | TS `adapters/registry.ts` (`CLASSIFIER_MODEL_ADAPTERS`, `getModelAdapter` aman terhadap `"constructor"`, `validateAnyModel`). Rust `scoring/mod.rs` (`ClassifierScorer`, `RowScore`, `build_scorer` dispatch). Grep: **tidak ada** `"naive_bayes"`/`modelType ===` di luar adapter/scorer/registry (kecuali tipe literal & test). Modul `stats/` generik. |
| P3 Validasi 2 lapis, kode sama | ✅ (⚠️ W3) | Semua 22 kode validasi model punya test di TS **dan** Rust. Pesan Rust selalu `"AM_E_XXX: detail"`, digabung `" | "`. `getUserFriendlyApplyModelError` mem-parse kode di depan `:`. |
| P4 Konsistensi angka NB | ✅ | `log_gaussian_density` & `safe_ln` identik `NB/prediction.rs:92-95,163-169`. `value_label.rs` identik `preprocess_data.rs:28,224-252`. Unseen 1.1 = `alpha/(class_totals+alpha·K)` (sama dengan `categorical_probability` NB). Tie-break byte-wise + strictly greater identik `predict_case`. T1/T2 sama dengan angka test NB. |
| P5 Rust hitung, TS orkestrasi | ✅ | Rust tidak menyentuh store. TS tidak menghitung probabilitas (hanya `Number(label)` & penulisan sel). |
| P6 Crate berdiri sendiri | ✅ (ℹ️ I2) | Cargo.toml: dependency identik NB. `classification_table.rs` = salinan utuh NB (diff hanya header). `models/data.rs` = NB:10-111. `utils/error.rs` & `converter.rs` isinya identik NB, tetapi header komentarnya menyebut KNN sebagai sumber. |
| P7 Folder referensi read-only | ✅ | Di luar AM hanya file §7.2 yang berubah (NB di commit Fase 0; 5 file wiring di index; worker/pkg ApplyModel baru). Import dari NB hanya 2 tipe + 2 builder formatter (§7.3); **tidak ada** import dari KNN. ⚠️ Ada perubahan tak terkait di `Regression/Ordinal/*` (W2). |

### Kontrak Data (§3) & kode (§4.5)

| Item | Status | Catatan |
|---|---|---|
| `types/model-schema.ts` | ✅ | Persis §3.1 (1.0 & 1.1, `class_counts?`, `class_totals?`). |
| `types/apply-model.ts` + `constants/apply-model-default.ts` | ✅ | Persis §3.3; default diuji. |
| `types/apply-model-worker.ts` ↔ `rust/src/models/result.rs` | ✅ | Nama field snake_case sama. Serializer `serialize_maps_as_objects(true)` + `serialize_missing_as_null(true)`: diverifikasi, `confusion_matrix` keluar sebagai objek biasa (bukan `Map`) dan `None` sebagai `null`. |
| `adapters/types.ts` | ✅ | Persis §3.2. |
| `constants/apply-model-codes.ts` | ✅ | 43 kode error + 8 warning persis §4.5, `ALL_APPLY_MODEL_CODES`, lima teks wajib persis. Pesan warning Rust identik dengan teks TS. |
| Payload worker §3.6 | ✅ | Worker mendestrukturisasi 6 field; constructor WASM 6 argumen (`wasm.d.ts`). |

---

## BAGIAN B — VALIDASI RENCANA (PLAN.md)

| Fase | Status | Temuan / bukti |
|---|---|---|
| **0** Export NB 1.1 | ✅ | Lihat K2. `cargo test` NB tidak bisa saya ulang (crates.io diblokir); test baru ada di kode. Jest NB: hanya 2 kegagalan lama (W4). |
| **1** Tipe, kode, default | ✅ | Commit `439b118b`; 2 suite/13 test PASS. |
| **2** Adapter & registry | ✅ | Langkah 1–12 berurutan, langkah 1–2 stop. Descriptor `summaryRows` (Smoothing alpha, Variance floor, Training validation), warning `AM_W_LEGACY_SCHEMA` untuk 1.0. D1 ok, D2 ok + warning, `decision_tree` → `UNSUPPORTED` detail benar. |
| **3** Aturan mapping | ✅ | Semua kasus PLAN tercakup di test (`outlook`, `OUTLOOK`+`outlook`, role/measure/type, duplikat, var hilang, actual). |
| **4** Penamaan & output rules | ✅ | `NB_PredictedValue`/`NB_PredictedProbability`/`NB_Probability_<c>`, `Rain Day` → `Rain_Day`, `_1`, 5 kode nama, `getEffectiveOutputFlags`. |
| **5** Model loader | ✅ | Semua kriteria PLAN diuji (file/.txt/11 MB/`{bad`, result store, `loadResults` sekali, built-in 404/ok). |
| **6** Scaffold crate & worker | ✅ | Struktur §7.1 lengkap; dummy sudah diganti di Fase 10 (sesuai rencana). |
| **7** Value label & `from_json` | ✅ | 6 test value_label; ≥8 kasus error berkode. `score_row` tidak pernah `unimplemented`. |
| **8** `score_row` | ✅ | Test `t1`…`t7` dengan skor §5.6 + flag; nilai diverifikasi ulang secara independen. |
| **9** Posterior & ringkasan | ✅ | `normalize_log_scores` (log-sum-exp + pengaman seragam), `argmax_with_tie_break`, `round4`. WASM D1+D3: total 6/scored 5/not scored 1/missing 2/unseen 2, distribusi 40/60, warning sesuai. D2: `AM_W_UNSEEN_SKIPPED_LEGACY` = 2, baris 3 = 0.9921. `AM_E_PAYLOAD` & `AM_E_NO_ROWS` terverifikasi lewat WASM. |
| **10** Evaluasi & WASM final | ✅ | WASM: evaluated 4, excluded not scored 1, unknown class 1, missing 0, matrix `[[1,1],[0,2]]`, `grand_total 4`, akurasi 0.75, kappa 0.5. Salinan `classification_table.rs` utuh. Versi `apply-model-20261003a` sama di TS & worker. |
| **11** Wiring & skeleton | ❌ **sebagian** | Lima perubahan §7.2 (5–9) benar, **kecuali separator menu** (blocker B1). |
| **12** Tab Model | ✅ | 3 radio, upload `accept=".json,application/json"`, Select result store dengan label §6.2, built-in disabled + teks `AM_W_BUILTIN_EMPTY`, kartu ringkasan + banner kuning, error berikon `AlertCircle`, model lama tidak tertimpa saat gagal. |
| **13** Tab Variables | ✅ | Tabel Feature/Role/Dataset variable/Status, opsi difilter role, variabel terpakai disabled, "Auto-map by name", actual target opsional, tanpa `VariableListManager`. |
| **14** Tab Save & Output | ✅ | Checkbox predicted (checked+disabled), prefix (placeholder adapter), custom names editable, kolom Final name + ikon `AM_W_NAME_ADJUSTED`. Output: 5 checkbox, evaluasi/confusion disabled + teks "Requires an actual target variable (Variables tab)." |
| **15** Validasi, OK/Reset/Help, persistensi | ✅ | `useApplyModelValidation` (fungsi murni + `useMemo`). OK disabled bila invalid, validasi ulang saat klik, `toast.promise` dengan 3 teks §6.1. Reset → default + `clearFormData` + toast. Fingerprint disalin dari NB:48-52. Dataset berubah hanya mereset `variables` + `save.CustomNames`. |
| **16** Formatter, output, error | ✅ | Fixture raw-result **identik** dengan keluaran WASM nyata. 3 suite PASS. |
| **17** Penulisan kolom & orkestrator | ✅ | Urutan: specs+final names → payload (1× `getSlicedData`) → worker → `resultApplyModel` → `saveApplyModelVariables`; mengembalikan `{scoredRows, finalNames, warnings}`. |
| **18** Regresi | ⚠️ | Jest AM hijau (direproduksi). Jest NB 2 fail lama (direproduksi, sama dengan catatan Fase 18). cargo/eslint/S1–S8 belum bisa saya ulang. Lihat W1 untuk git. |

### Fixture D1–D3 (source of truth)

| Baris | Diharapkan (PLAN §1) | WASM nyata | Status |
|---|---|---|---|
| 1 | No, 1.0000, 1.0000/0.0000 | No, 1, [1, 0] | ✅ |
| 2 | Yes, 0.9967, 0.0033/0.9967 | Yes, 0.9967, [0.0033, 0.9967] | ✅ |
| 3 | Yes, 0.9921, 0.0079/0.9921 | Yes, 0.9921, [0.0079, 0.9921] | ✅ |
| 4 | Yes, 0.6000, 0.4000/0.6000 | Yes, 0.6, [0.4, 0.6] | ✅ |
| 5 | kosong | null, null, [null, null] | ✅ |
| 6 | No, 1.0000, 1.0000/0.0000 | No, 1, [1, 0] | ✅ |

`nb-model-v1_1.json` = D1 persis; `nb-model-v1_0.json` = D2 (tanpa `class_counts`/`class_totals`).

---

## BAGIAN C — REGRESI & TESTING

| Perintah | Hasil |
|---|---|
| Jest `apply-model/**` | ✅ 19 suite, 339 test, semua PASS |
| Jest `naive-bayes/**` | ⚠️ 3 suite / 28 test: 26 pass, 2 fail (lama, bukan dari AM — W4) |
| `tsc --noEmit` (closure AM + wiring) | ✅ 0 error kode |
| `cargo test` AM / NB | ⏳ Tidak bisa dijalankan di lingkungan saya; 117 `#[test]` AM terdaftar. **Mohon jalankan lokal.** |
| ESLint `--max-warnings=0` | ⏳ Timeout di VM; mohon jalankan lokal |
| WASM end-to-end D1/D2 + D3 | ✅ Identik T1–T7 & §1 |
| Paritas validasi TS↔Rust (fuzz 1.710 kasus) | ✅ 0 selisih |

---

## BAGIAN D — KESIMPULAN & REKOMENDASI

### Blocker (wajib sebelum merge)

**B1 — Separator menu hilang (K10, §7.2 baris 7).**
File `frontend/components/Modals/Analyze/Classify/classify-menu.tsx`, antara baris 43 (`</MenubarItem>` Naive Bayes) dan 44 (`<MenubarItem` Apply Model). Perbaikan satu baris:

```tsx
                    Naive Bayes
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem
                    onClick={() => openModal(ModalType.ModalApplyModel)}
                >
                    Apply Model
                </MenubarItem>
                <MenubarSeparator />
```

### Warning (sebaiknya dibereskan)

1. **W1 — Kebersihan git (wajib sebelum commit).** Riwayat hanya berisi commit Fase 0 & 1. Fase 2–18 tercampur: sebagian di index (`A`/`AM`/`MM`), banyak file **untracked** (`??`), antara lain `dialogs/model-tab.tsx`, `variables-tab.tsx`, `save-tab.tsx`, `output-tab.tsx`, seluruh `hooks/*.ts`, seluruh `services/*.ts` (kecuali fixture D1/D2), `rust/src/scoring/naive_bayes.rs`, `rust/src/stats/{posterior,summary,evaluation,classification_table,value_label}.rs`, dan semua test `__tests__/` di hooks/services/dialogs. Bila hanya isi index yang di-commit, `apply-model-main.tsx` akan mengimpor file yang tidak ada di commit. → Jalankan `git add frontend/components/Modals/Analyze/Classify/apply-model frontend/public/workers/Classify/ApplyModel`, lalu periksa `git status`. Putuskan juga apakah file verifikasi (`VERIFY-*.md`, `README-VERIFICATION.md`, `VERIFICATION-SETUP-COMPLETE.txt`, `COMMIT-MESSAGE-TEMPLATE.md`) ikut di-commit. (`Cargo.lock` dan `rust/target/` memang di-ignore oleh `.gitignore` repo.)
2. **W2 — Perubahan tak terkait di working tree.** `Regression/Ordinal/services/formatter_utils.ts`, `services/syntaxGenerator.ts`, dan `types/ordinal.ts` (mis. `cellInformation?: boolean;` dikomentari). Ini di luar §7.2. Jangan ikutkan di commit Apply Model, dan pastikan `tsc` seluruh proyek tetap bersih.
3. **W3 — Kode error di luar kontrak.** `rust/src/wasm/function.rs:48` memakai `"AM_E_SERIALIZE: …"`, yang tidak ada di §4.5. Akibatnya pengguna hanya mendapat pesan generik. Saran: pakai `AM_E_WORKER` (atau revisi AGENTS.md bila kode baru memang diinginkan).
4. **W4 — 2 test NB gagal (lama).** `useNaiveBayesValidation.test.ts` "form kosong…" dan `options.test.tsx` "shows error for value > 999" (`getByText(/maksimum 999/i)` cocok 2 elemen). Saya reproduksi. File-file ini tidak berubah sejak Fase 0, jadi bukan regresi Apply Model. Sebaiknya dicatat sebagai tiket NB terpisah (AGENTS.md §9.4: jangan diperbaiki di sini).
5. **W5 — Verifikasi yang belum bisa saya ulang.** `cargo test` (AM 117 test & NB), ESLint `--max-warnings=0`, `tsc` seluruh proyek, dan skenario manual S1–S8. Mohon dijalankan lokal sebelum push. WASM yang sudah di-build sudah terbukti benar.

### Info (opsional)

- **I1** Nama container `ApplyModelMain` dengan props `BaseModalProps`; §6.1 menyebut `ApplyModelContainer` / `ApplyModelContainerProps`. Default export & perilaku sudah benar.
- **I2** Header `rust/src/utils/{error,converter}.rs` menyebut sumber `nearest-neighbor`, padahal isinya identik dengan salinan NB (P6 menyebut NB). Cukup perbaiki komentar.
- **I3** Komentar usang di `rust/src/lib.rs` ("masih kosong di Fase 6"), `utils/converter.rs` ("Fase 8 … hardcoded"), dan `models/result.rs` ("untuk Fase 6 … `None`").
- **I4** Label parameter berbeda antara tab Model (TS: "Training validation") dan Output Viewer (Rust: "Validation (training)"). Keduanya mengikuti dokumen (PLAN Fase 2 vs AGENTS §3.6), tetapi sebaiknya diseragamkan.
- **I5** Teks `AM_W_NO_RESULT_STORE_MODELS` menyebut "Naive Bayes" secara spesifik. Wajar selama hanya NB yang didukung.
- **I6** `AM_E_NO_ROWS` praktis hanya muncul bila dataset kosong. Bila kolom yang dipetakan seluruhnya kosong, `getSlicedData` tetap mengembalikan 1 baris (`getMaxIndex` → 0), sehingga hasilnya "1 baris not scored", bukan error. Perilaku ini konsisten dengan NB/KNN.
- **I7** `loadModelFromResultStore` mengembalikan `AM_E_NO_MODEL` bila statistic tidak ditemukan. Kasus ini tidak diatur dokumen, tetapi pilihan yang wajar.
- **I8** Tombol Help hanya berupa ikon (`aria-label="Toggle help"`), sesuai pola KNN:416-424.
- **I9** Instance WASM tidak di-`free()`. Tidak masalah karena worker di-`terminate()` setiap run.

---

## NEXT STEPS

1. Tambah `<MenubarSeparator />` di `classify-menu.tsx` (B1).
2. Ganti `AM_E_SERIALIZE` → `AM_E_WORKER` (W3), lalu `cargo test` + `wasm-pack build --target web --release`, salin `pkg/`, bump `APPLY_MODEL_WASM_VERSION` & worker ke `apply-model-20261003b`. (Atau tunda W3 ke iterasi berikut agar WASM tidak perlu di-build ulang.)
3. Jalankan lokal: `cd frontend/components/Modals/Analyze/Classify/apply-model/rust && cargo test`, `…/naive-bayes/rust && cargo test`, `cd frontend && npx eslint components/Modals/Analyze/Classify/apply-model --ext .ts,.tsx --max-warnings=0`, `npx tsc --noEmit -p .`.
4. Ulangi skenario manual S1–S8 (minimal S1, S2, S8 setelah perubahan menu).
5. `git add` seluruh `apply-model/` + `public/workers/Classify/ApplyModel/`; pastikan file `Regression/Ordinal/*` **tidak** ikut (W1, W2).
6. Commit (bisa memakai `COMMIT-MESSAGE-TEMPLATE.md`), lalu push & PR.
