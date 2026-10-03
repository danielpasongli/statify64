# VERIFY-PROMPT.md — Instruksi Verifikasi Implementasi Apply Model

**Tanggal dibuat:** 2026-10-03  
**Target:** Claude Opus (recommended)  
**Output:** lihat `VERIFY-RESULT.md` (folder ini)

---

## RINGKAS

Buatkan verifikasi **komprehensif** implementasi menu Apply Model di folder ini, dengan membandingkan setiap file kode terhadap kontrak mengikat di `AGENTS.md` dan rencana bertahap di `PLAN.md`.

Output: laporan terstruktur per fase (0–17) dengan status, bukti, dan rekomendasi.

---

## PERAN KAMU

Kamu adalah **senior software architect** spesialis full-stack TypeScript + Rust/WASM.

Tugasmu:
1. **Validasi Kontrak** — Pastikan setiap keputusan K1–K11 dan prinsip P1–P7 di `AGENTS.md` tercapai dalam kode
2. **Validasi Rencana** — Verifikasi setiap fase PLAN.md (0–17) dikerjakan persis seperti ditulis
3. **Tulis Laporan** — Format terstruktur, per fase, dengan bukti spesifik (nama file, baris kode, snippet)
4. **Rekomendasi** — Jika ada gap, jelaskan apa yang perlu diperbaiki & urgensinya

---

## KONTEKS PROYEK

**Nama Proyek:** Statify  
**Jenis:** Aplikasi analisis data desktop (Next.js frontend + Rust/WASM backend)  
**Modul yang dikerjakan:** Menu Apply Model → Analyze Modal → Classify Tab  
**Lokasi kode:** `frontend/components/Modals/Analyze/Classify/apply-model/`

**Dokumen Kontrak (WAJIB BACA):**
- `AGENTS.md` (57 KB) — Desain & keputusan pemilik produk yang **mengikat**
- `PLAN.md` (37 KB) — Rencana implementasi 17 fase bertahap

**Referensi Modul Lain:**
- `naive-bayes/` — Modul NB yang sudah selesai (pola implementasi)
- `nearest-neighbor/` — Modul KNN (untuk perbandingan UI pattern)

---

## INSTRUKSI DETAIL

### 1. **Baca Dokumen Kontrak**

Pahami:
- **Keputusan K1–K11** di `AGENTS.md` §0 — ini adalah hard constraints
- **Prinsip P1–P7** di `AGENTS.md` §2 — ini adalah design guidelines
- **Kontrak Data** di `AGENTS.md` §3 — tipe TypeScript, adapter, mapping rules
- **Validasi & Kode Error** di `AGENTS.md` §4 — 15 kode error yang harus konsisten TS/Rust
- **Scoring Naïve Bayes** di `AGENTS.md` §5 — formula probabilitas harus sama dengan NB
- **Data Fixture D1–D3** di `PLAN.md` §1 — ini adalah **source of truth** untuk hasil test

---

### 2. **Validasi Setiap Kategori**

#### **A. Keputusan K1–K11 (AGENTS.md §0)**

| # | Topik | Checklist |
|---|---|---|
| K1 | 3 sumber model | ❓ File upload loader ada? ❓ Result store integration ada? ❓ Builtin catalog (empty) ada? |
| K2 | NB export schema 1.1 | ❓ `NB/rust/src/stats/save.rs` punya `class_counts` & `class_totals`? ❓ Version bump? ❓ WASM rebuild? |
| K3 | Dedicated Rust crate | ❓ Folder `apply-model/rust/` ada? ❓ Cargo.toml standalone? ❓ WASM worker independen? |
| K4 | Feature mapping | ❓ Auto-match exact + case-insensitive + manual override ada? ❓ Role/measure mismatch blocking ada? |
| K5 | All-missing rows skip | ❓ Baris dengan semua predictor missing → output empty, tercatat di summary? |
| K6 | Output columns | ❓ Predicted value (auto NUMERIC/STRING) ada? ❓ Max prob (optional, default ON)? ❓ Per-class prob (optional, default OFF)? ❓ Names editable? |
| K7 | Output Viewer | ❓ Model Summary ada? ❓ Case Processing Summary ada? ❓ Prediction Distribution ada? ❓ Confusion matrix (jika target mapped)? |
| K8 | Validasi 2-lapis | ❓ TS validasi model saat load (untuk UI)? ❓ Rust validasi ulang saat scoring? ❓ Kode error sama (AM_E_*)? |
| K9 | Dataset aktif | ❓ Pakai dataset yang terbuka di Statify? ❓ Semua baris (sampai last valid)? |
| K10 | Penempatan UI | ❓ Menu di Analyze → Classify → setelah Naive Bayes? ❓ Separator ada? ❓ Sidebar 40% width? ❓ IndexedDB key "ApplyModel"? ❓ Labels EN, messages ID? |
| K11 | Read-only NB doc | ❓ `NB/AGENTS.md` tidak diubah (kecuali Fase 0)? ❓ Apply Model tidak edit NB lagi? |

#### **B. Prinsip P1–P7 (AGENTS.md §2)**

| # | Prinsip | Checklist |
|---|---|---|
| P1 | Kontrak = NB JSON | ❓ Format model baru tidak dibuat? ❓ Pakai `ExportedModel` dari NB? ❓ Nama field tidak diubah? |
| P2 | Multi-algoritma registry | ❓ `ClassifierModelAdapter` di `adapters/`? ❓ TS registry ada (`adapters/registry.ts`)? ❓ Rust trait `ClassifierScorer` ada? ❓ Dispatch berdasarkan `model_type`? |
| P3 | Validasi 2-lapis + kode error | ❓ TS adapter punya `validate()`? ❓ Rust scorer punya validasi? ❓ Kode error format `AM_E_xxx` konsisten? ❓ Pesan Rust diawali kode (`"AM_E_xxx: ..."`)?  |
| P4 | Konsistensi angka NB | ❓ Formula probabilitas sama dengan `NB/rust/src/stats/prediction.rs`? ❓ Smoothing alpha, variance floor sama? ❓ Tie-break logic sama? |
| P5 | Rust komputasi, TS orkestrasi | ❓ Rust hitung probabilitas saja? ❓ TS tulis ke dataset & I/O? ❓ Rust tidak sentuh store? |
| P6 | Crate Rust standalone | ❓ `apply-model/rust/` adalah crate wasm-pack independen? ❓ Utility dari NB disalin (bukan import cross-crate)? ❓ Ada komentar sumber? |
| P7 | Folder read-only | ❓ `KNN/` tidak diubah? ❓ `NB/` tidak diubah (kecuali Fase 0)? ❓ Import hanya dari modul NB yang listed (§7.3)? |

#### **C. Kontrak Data (AGENTS.md §3)**

| Item | File | Checklist |
|---|---|---|
| Tipe model schema | `types/model-schema.ts` | ❓ `NaiveBayesExportedModel` dengan semua field (1.0 & 1.1)? ❓ `NaiveBayesFeature` (numerical & categorical)? ❓ Tipe support schema_version "1.0" & "1.1"? |
| Tipe Apply Model | `types/apply-model.ts` | ❓ `SourceKind`, `ApplyModelForm`, `ApplyModelState` ada? ❓ `FeatureMapping`, `OutputColumnConfig` ada? |
| Adapter interface | `adapters/types.ts` | ❓ `ClassifierModelAdapter` dengan method `validate()`, `getDescriptor()`, `getDefaultPrefix()` ada? |
| Validator | `adapters/naive-bayes-adapter.ts` | ❓ `validate()` implementasi langkah 1–12 §4.3 persis? ❓ Semua kode error `AM_E_*` tercakup? |
| Registry | `adapters/registry.ts` | ❓ `getAdapterForModelType()` ada? ❓ `validateAnyModel()` ada? |
| Mapping rules | `hooks/useApplyModelMappingRules.ts` | ❓ `autoMapFeatures()` implementasi §3.4 langkah 1–5? ❓ `validateMapping()` tabel §3.4 tercakup? |

#### **D. Error Codes (AGENTS.md §4.5)**

Wajib ada di TS (`adapters/naive-bayes-adapter.test.ts`) & Rust (`apply-model/rust/src/`):

```
AM_E_NOT_OBJECT
AM_E_SCHEMA_VERSION_MISSING
AM_E_SCHEMA_VERSION_UNSUPPORTED
AM_E_MODEL_TYPE_MISSING
AM_E_MODEL_TYPE_UNSUPPORTED
AM_E_TARGET_MISSING
AM_E_TARGET_INVALID_TYPE
AM_E_FEATURES_MISSING
AM_E_FEATURES_INVALID_TYPE
AM_E_FEATURE_NAME_DUPLICATE
AM_E_FEATURE_INVALID_SCHEMA
AM_E_CLASS_TOTALS_MISSING
AM_E_CLASS_TOTALS_INVALID
[plus warnings: AM_W_LEGACY_SCHEMA, AM_W_MISSING_PREDICTOR, AM_W_UNSEEN_CATEGORY]
```

---

### 3. **Validasi Setiap Fase (PLAN.md Bagian A–D)**

Gunakan template ini untuk setiap fase:

#### **Fase N — Nama Fase**
- **Status:** ✅ Complete | ⚠️ Partial | ❌ Blocked
- **Prasyarat terpenuhi?** (Ya/Tidak)
- **File yang seharusnya ada:**
  - [ ] File A (ada/tidak/incomplete)
  - [ ] File B
  - [ ] File C
- **Checklist langkah-langkah:**
  - [ ] Langkah 1: `file.ts` baris X–Y → implementasi Y
  - [ ] Langkah 2: test ada + cakupan Z
  - [ ] Langkah 3: `npx jest` pass
- **Temuan:**
  - (✅ Pro) Apa yang benar
  - (⚠️ Warning) Apa yang partial/perlu verifikasi
  - (❌ Issue) Apa yang hilang/salah
- **Bukti:**
  - File: `...`
  - Diff: `...` (snippet kecil jika ada masalah)
- **Rekomendasi:** apa yang perlu diperbaiki

---

### 4. **Fixture Data (PLAN.md §1)**

**KRITIS:** Hasil test harus match persis dengan D3 expected (T1–T6).

Periksa:
- ❓ Fixture `nb-model-v1_1.json` (D1) ada? Format persis?
- ❓ Fixture `nb-model-v1_0.json` (D2) ada? Legacy schema?
- ❓ Dataset test D3 (6 baris: Outlook, Temp, Play) ada?
- ❓ Test mengharapkan hasil T1–T6 (probabilitas ±0.0001)?

**Expected hasil T1–T6:**
```
Baris 1: Predicted=No, MaxProb=1.0000, Prob_No=1.0000, Prob_Yes=0.0000
Baris 2: Predicted=Yes, MaxProb=0.9967, Prob_No=0.0033, Prob_Yes=0.9967
Baris 3: Predicted=Yes, MaxProb=0.9921, Prob_No=0.0079, Prob_Yes=0.9921
Baris 4: Predicted=Yes, MaxProb=0.6000, Prob_No=0.4000, Prob_Yes=0.6000
Baris 5: (kosong — all predictors missing)
Baris 6: Predicted=No, MaxProb=1.0000, Prob_No=1.0000, Prob_Yes=0.0000
```

---

### 5. **Regresi Testing**

Pastikan module lain tetap hijau:

```bash
# TS Type Check
npx tsc --noEmit -p .

# Jest — seluruh Classify
npx jest components/Modals/Analyze/Classify/

# Jest — NB saja (pastikan tidak rusak)
npx jest components/Modals/Analyze/Classify/naive-bayes/

# Rust — NB (jika ada rebuild WASM)
cd frontend/components/Modals/Analyze/Classify/naive-bayes/rust && cargo test

# Rust — Apply Model (jika ada)
cd frontend/components/Modals/Analyze/Classify/apply-model/rust && cargo test
```

Checklist:
- ❓ TS type check: 0 error baru?
- ❓ Jest apply-model/*: 100% pass?
- ❓ Jest NB: tetap hijau (no regression)?
- ❓ Rust: cargo test pass?

---

### 6. **Cross-File References**

Pastikan konsistensi:

| Dari | Ke | Konsistensi |
|---|---|---|
| `types/model-schema.ts` | `adapters/naive-bayes-adapter.ts` | Tipe field persis? |
| `adapters/naive-bayes-adapter.ts` | `adapters/registry.ts` | `model_type: "naive_bayes"` sama? |
| `adapters/naive-bayes-adapter.ts` | `hooks/useApplyModelMappingRules.ts` | Feature descriptor dipakai? |
| `hooks/useApplyModelMappingRules.ts` | `services/apply-model-service.ts` | Mapping validation result dipakai? |
| `services/apply-model-service.ts` | `apply-model/rust/src/` | Struct data yang dikirim ke Rust sesuai? |
| `apply-model/rust/src/` | `NB/rust/src/stats/prediction.rs` | Formula scoring sama persis? |
| Output columns naming | `types/apply-model.ts` K6 default | Prefix "NB_PredictedValue" etc konsisten? |
| IndexedDB key | `constants/apply-model-default.ts` | `"ApplyModel"` sama di mana-mana? |

---

## FORMAT LAPORAN AKHIR

Tulis hasil di `VERIFY-RESULT.md` (file ini juga di folder apply-model/).

**Struktur:**

```markdown
# VERIFY-RESULT.md — Laporan Verifikasi Implementasi Apply Model

**Tanggal Verifikasi:** 2026-10-03  
**Diverifikasi oleh:** Claude Opus  
**Status Keseluruhan:** ✅ Ready for merge / ⚠️ Needs review / ❌ Blocked

---

## RINGKAS EKSEKUTIF

- Total fase: X / 17
- Fase selesai: list
- Kritikalitas: 0 blocker / Y warning / Z info
- Siap untuk commit? Ya/Tidak, alasan

---

## BAGIAN A — VALIDASI KONTRAK (AGENTS.md)

### Keputusan K1–K11
[per K1, K2, ... dengan status ✅/⚠️/❌]

### Prinsip P1–P7
[per P1, P2, ... dengan status ✅/⚠️/❌]

### Kontrak Data
[tipe, adapter, mapping, error code — per bagian]

---

## BAGIAN B — VALIDASI RENCANA (PLAN.md)

### Fase 0: Export NB schema 1.1
- Status: [...]
- Temuan: [...]
- Bukti: [...]

### Fase 1: Tipe & default
- Status: [...]
- ...

[dst. Fase 2–17]

---

## BAGIAN C — REGRESI & TESTING

- TS type check: ✅ 0 error
- Jest apply-model/*: ✅ 100% pass
- Jest NB: ✅ no regression
- Rust cargo test: ✅ all pass / ⚠️ skipped / ❌ fail

---

## BAGIAN D — KESIMPULAN & REKOMENDASI

### Issue yang Harus Diperbaiki (Blocker)
1. [Issue A] — file X, baris Y — fix ini sebelum merge

### Issue yang Sebaiknya Diperbaiki (Warning)
1. [Warning B] — file X — tidak critical, tapi lebih baik

### Notes untuk Reviewer
- [Catatan khusus]

---

## NEXT STEPS

1. Perbaiki blocker (jika ada)
2. Review warning bersama tim
3. Generate commit message dari laporan ini
4. Run final test suite
5. Push & PR
```

---

## INSTRUKSI EKSEKUSI

1. **Baca dokumen ini** sepenuhnya
2. **Baca `AGENTS.md` + `PLAN.md`** (folder ini)
3. **Akses folder apply-model** dan baca kode aktual (setiap file .ts, .tsx, .rs)
4. **Validasi per kategori** (K1–K11, P1–P7, fase 0–17, fixture, regresi)
5. **Tulis laporan** di `VERIFY-RESULT.md` dengan bukti spesifik
6. **Beri rating** per item (✅/⚠️/❌)
7. **Tulis ringkas eksekutif** dengan kesimpulan go/no-go untuk commit

---

## CRITICAL NOTES

- **Jangan asumsikan.** Baca kode aktual dari file .ts, .tsx, .rs.
- **Toleransi nol untuk K1–K11 & P1–P7.** Jika menyimpang, catat sebagai bug desain (tidak bisa di-override).
- **Data fixture D1–D3 = source of truth.** Hasil scoring test harus match T1–T6 persis (probabilitas ±0.0001, atau 4 desimal).
- **Kode error harus sama di TS dan Rust.** Cek `APPLY_MODEL_MESSAGES` (TS) vs Rust error strings.
- **Cross-referensi aktif:** jika adapter pakai fungsi X, pastikan itu ada & sama dengan NB; jika output columns punya nama "NB_Predicted*", cek itu match K6 default.

---

## MULAI SEKARANG

Apakah kamu punya akses ke kode implementasi di folder ini, atau aku perlu stage/upload terlebih dahulu?

Jika sudah siap, mulai baca `AGENTS.md` dan `PLAN.md` di folder ini, lalu lanjut ke validasi per fase.

Laporan akhir akan masuk ke `VERIFY-RESULT.md`.
