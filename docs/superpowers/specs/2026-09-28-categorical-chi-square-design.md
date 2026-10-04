# Desain Mesin Uji Chi-Square Kategorik

## Tujuan

Menyediakan implementasi mandiri untuk Uji Kebebasan Pearson Chi-Square dan Uji Kesamaan Proporsi Binomial/Multinomial yang digunakan oleh Crosstabs. Implementasi menerima pasangan kategori yang sudah lolos pemeriksaan missing dari Crosstabs, membentuk tabel kontingensi, lalu menghitung seluruh statistik pengujian.

## Batas modul

- `crosstabs.js` tetap menangani aturan aplikasi yang sudah ada: membaca variabel, mengenali tanggal, mendeteksi user-missing, dan menyesuaikan bobot per kasus.
- `categoricalChiSquare.js` menangani bagian statistik: kategori unik, tabel kontingensi, total marginal, expected count, statistik Pearson, derajat bebas, p-value, diagnostik expected count, jenis uji proporsi, dan keputusan pada alpha tertentu.
- Tampilan, formatter, serta interpretasi yang sudah ada tetap menggunakan kontrak hasil `chiSquare.pearson`.
- Modul Chi-Square satu sampel pada `NonparametricTests` tidak diubah karena merupakan goodness-of-fit yang berbeda.

## Antarmuka

Modul diekspos sebagai `self.CategoricalChiSquare` agar dapat digunakan oleh Web Worker klasik dan sebagai `module.exports` untuk pengujian Jest.

### `buildContingencyTable(rowValues, columnValues, weights, cellAdjustment)`

Menerima dua array kategori dengan panjang sama, bobot opsional, dan penyesuaian sel `none`, `round`, atau `truncate`. Hasilnya memuat `rowCategories`, `columnCategories`, `observed`, `rowTotals`, `columnTotals`, dan `total`.

### `calculatePearsonChiSquare(observed, alpha)`

Menerima matriks kontingensi persegi panjang berisi frekuensi nonnegatif. Hasilnya mempertahankan properti lama `value`, `df`, `pValue`, dan `expectedDiagnostics`, serta menambahkan `expectedCounts`, `alpha`, `significant`, dan `decision`.

### `chiSquareIndependenceTest(observed, alpha)`

Memanggil mesin Pearson dan memberi metadata `testType: "independence"` serta hipotesis kebebasan.

### `binomialProportionTest(observed, alpha)`

Mensyaratkan tepat dua kategori hasil atau dua kolom. Fungsi memakai mesin Pearson yang sama dan memberi metadata `testType: "binomial-proportion-homogeneity"`.

### `multinomialProportionTest(observed, alpha)`

Mensyaratkan sedikitnya tiga kategori hasil atau tiga kolom. Fungsi memakai mesin Pearson yang sama dan memberi metadata `testType: "multinomial-proportion-homogeneity"`.

## Rumus

Untuk tabel berukuran `R x C`:

```text
E_ij = (n_i. x n_.j) / N
X^2  = sum_i sum_j ((O_ij - E_ij)^2 / E_ij)
df   = (R - 1)(C - 1)
p    = P(ChiSquare_df >= X^2)
```

Keputusan adalah `reject` jika `p < alpha`, selain itu `fail-to-reject`. P-value dihitung menggunakan regularized incomplete gamma tanpa menambah dependensi.

## Validasi

- Matriks harus memiliki sedikitnya dua baris dan dua kolom.
- Semua baris harus memiliki jumlah kolom yang sama.
- Frekuensi harus berupa bilangan berhingga dan tidak negatif.
- Total setiap baris dan kolom harus lebih dari nol.
- Alpha harus berada pada interval terbuka `(0, 1)`.
- Uji binomial membutuhkan tepat dua kolom.
- Uji multinomial membutuhkan sedikitnya tiga kolom.

## Integrasi

`crosstabs.worker.js` memuat `categoricalChiSquare.js` sebelum `crosstabs.js`. Inisialisasi Crosstabs mengirim kategori valid dan bobot ke `buildContingencyTable()`. `getPearsonChiSquare()` mendelegasikan perhitungan kepada `chiSquareIndependenceTest()` sehingga kontrak keluaran lama tetap kompatibel.

## Pengujian

- Unit test tabel 2x2 dengan nilai Pearson `2` dan `df = 1`.
- Unit test tabel proporsi binomial 4x2.
- Unit test tabel proporsi multinomial 3x3.
- Unit test pembentukan tabel dari label string dan bobot.
- Unit test validasi matriks, alpha, serta jumlah kategori.
- Integration test worker untuk memastikan Crosstabs memakai mesin baru.
- Regression test Crosstabs dan formatter yang sudah ada.

