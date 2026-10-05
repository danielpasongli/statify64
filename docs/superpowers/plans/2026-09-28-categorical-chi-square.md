# Categorical Chi-Square Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat mesin statistik mandiri untuk Uji Kebebasan Chi-Square dan Uji Kesamaan Proporsi Binomial/Multinomial, lalu mengintegrasikannya ke Crosstabs.

**Architecture:** Satu library worker baru memiliki seluruh operasi statistik kategorik dan diekspos melalui global worker serta CommonJS. Crosstabs mempertahankan pemeriksaan data khusus aplikasi, lalu mendelegasikan pembentukan tabel dan perhitungan Pearson ke library baru tanpa mengubah struktur hasil yang digunakan formatter.

**Tech Stack:** JavaScript Web Worker klasik, Jest, TypeScript/React formatter yang sudah ada.

**Spec:** `docs/superpowers/specs/2026-09-28-categorical-chi-square-design.md`

## Global Constraints

- Tidak menambah dependensi baru.
- Tidak mengubah modul statistik milik tim di luar Crosstabs.
- Mempertahankan properti hasil `value`, `df`, `pValue`, dan `expectedDiagnostics`.
- Seluruh komentar baru menggunakan bahasa Indonesia.
- Implementasi dilakukan pada branch `daniel-coba2`.

---

### Task 1: Mesin Pearson Chi-Square

**Files:**
- Create: `frontend/public/workers/DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js`
- Create: `frontend/public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

**Interfaces:**
- Consumes: matriks observed dan alpha.
- Produces: `calculatePearsonChiSquare(observed, alpha)`, `chiSquareIndependenceTest(observed, alpha)`, `binomialProportionTest(observed, alpha)`, dan `multinomialProportionTest(observed, alpha)`.

- [ ] **Step 1: Tulis test gagal untuk tabel 2x2**

```js
expect(api.calculatePearsonChiSquare([[3, 1], [1, 3]])).toMatchObject({
  value: 2,
  df: 1,
  decision: 'fail-to-reject',
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal karena modul belum tersedia**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

- [ ] **Step 3: Implementasikan validasi matriks, total marginal, expected count, statistik Pearson, distribusi gamma, dan p-value**

Implementasi mengembalikan kontrak pada spesifikasi dan menolak matriks tidak persegi panjang, nilai negatif, baris/kolom kosong, serta alpha di luar `(0,1)`.

- [ ] **Step 4: Tambahkan test gagal lalu implementasikan wrapper kebebasan, binomial, dan multinomial**

```js
expect(api.binomialProportionTest([[10, 20], [30, 40]]).testType)
  .toBe('binomial-proportion-homogeneity');
expect(() => api.binomialProportionTest([[1, 2, 3], [3, 2, 1]])).toThrow();
expect(api.multinomialProportionTest([[10, 20, 30], [20, 15, 25]]).testType)
  .toBe('multinomial-proportion-homogeneity');
```

- [ ] **Step 5: Jalankan unit test dan pastikan seluruhnya lulus**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

### Task 2: Pembentukan tabel kontingensi

**Files:**
- Modify: `frontend/public/workers/DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js`
- Modify: `frontend/public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

**Interfaces:**
- Consumes: `rowValues`, `columnValues`, bobot opsional, dan penyesuaian sel.
- Produces: `buildContingencyTable(rowValues, columnValues, weights, cellAdjustment)`.

- [ ] **Step 1: Tulis test gagal untuk kategori string, bobot, pengurutan, round, dan truncate**

```js
expect(api.buildContingencyTable(['B', 'A', 'A'], ['Y', 'X', 'Y'], [1, 2, 3], 'none')).toMatchObject({
  rowCategories: ['A', 'B'],
  columnCategories: ['X', 'Y'],
  observed: [[2, 3], [0, 1]],
  total: 6,
});
```

- [ ] **Step 2: Jalankan test dan pastikan gagal karena fungsi belum tersedia**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

- [ ] **Step 3: Implementasikan pembentukan kategori dan matriks menggunakan `Set` dan `Map`**

Fungsi memeriksa panjang array dan bobot, lalu menghitung total kembali setelah penyesuaian sel.

- [ ] **Step 4: Jalankan test dan pastikan seluruhnya lulus**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js`

### Task 3: Integrasi Crosstabs

**Files:**
- Modify: `frontend/public/workers/DescriptiveStatistics/crosstabs.worker.js`
- Modify: `frontend/public/workers/DescriptiveStatistics/libs/crosstabs/crosstabs.js`
- Modify: `frontend/public/workers/DescriptiveStatistics/libs/__tests__/crosstabs.test.js`
- Modify: `frontend/public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.test.js`
- Modify: `frontend/public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.matrix.test.js`

**Interfaces:**
- Consumes: `self.CategoricalChiSquare` dari Task 1 dan Task 2.
- Produces: hasil Crosstabs lama dengan tambahan metadata dari mesin baru.

- [ ] **Step 1: Tulis integration test gagal yang mengharapkan `testType: "independence"` dan `expectedCounts`**

```js
expect(payload.results.chiSquare.pearson.testType).toBe('independence');
expect(payload.results.chiSquare.pearson.expectedCounts).toEqual([[1, 1], [1, 1]]);
```

- [ ] **Step 2: Jalankan test dan pastikan gagal karena Crosstabs masih memakai implementasi lama**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.test.js`

- [ ] **Step 3: Muat library baru dan delegasikan pembentukan tabel serta Uji Pearson**

`crosstabs.worker.js` memuat library baru. `#initialize()` mengumpulkan pasangan kategori valid lalu memanggil `buildContingencyTable()`. `getPearsonChiSquare()` memanggil `chiSquareIndependenceTest()`.

- [ ] **Step 4: Jalankan seluruh test Crosstabs**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/__tests__/crosstabs.test.js public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.test.js public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.matrix.test.js components/Modals/Analyze/Descriptive/Crosstabs/__tests__/formatters.test.ts`

### Task 4: Verifikasi dan dokumentasi akhir

**Files:**
- Modify: `frontend/public/workers/DescriptiveStatistics/libs/crosstabs/README.md`

**Interfaces:**
- Consumes: API mesin kategorik yang sudah terintegrasi.
- Produces: dokumentasi lokasi algoritma, rumus, kontrak, dan cakupan pengujian.

- [ ] **Step 1: Dokumentasikan bahwa Crosstabs mendelegasikan algoritma ke `categoricalChiSquare.js`**

Dokumentasi mencantumkan ketiga konteks pengujian, rumus Pearson, validasi kategori, dan perbedaan dengan goodness-of-fit satu sampel.

- [ ] **Step 2: Jalankan suite target dan pemeriksaan status Git**

Run: `npm test -- --runInBand public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js public/workers/DescriptiveStatistics/libs/__tests__/crosstabs.test.js public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.test.js public/workers/DescriptiveStatistics/__tests__/crosstabs.worker.matrix.test.js components/Modals/Analyze/Descriptive/Crosstabs/__tests__/formatters.test.ts`

Run: `git diff --check`

- [ ] **Step 3: Commit perubahan pada branch percobaan**

```bash
git add docs/superpowers/specs/2026-09-28-categorical-chi-square-design.md docs/superpowers/plans/2026-09-28-categorical-chi-square.md frontend/public/workers/DescriptiveStatistics
git commit -m "feat: implement categorical chi-square engine"
```

