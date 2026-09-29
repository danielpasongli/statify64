# Crosstabs Library — Dokumentasi Rumus & Perilaku

Library ini menghitung tabulasi silang dua variabel (baris × kolom) dengan dukungan bobot, missing, dan tanggal. Menghasilkan contingency table, expected counts, residuals, dan persentase baris/kolom/total.

## Dependensi & Sumber Perhitungan
- Utils internal: `checkIsMissing`, `isNumeric`, `isDateString`, `dateStringToSpssSeconds`, `spssSecondsToDateString`, `toSPSSFixed` (di `../utils/utils.js`).
- Mesin statistik kategorik: `../categoricalTests/categoricalChiSquare.js`.
- Tidak menggunakan library statistik eksternal.

## Penanganan Tipe Data
- numeric/string/date didukung sebagai kategori baris/kolom.
- Kategori teks dapat digunakan langsung tanpa recode menjadi angka.
- Spasi pada awal dan akhir kategori dibuang; kategori kosong dicatat sebagai missing.
- Penulisan huruf besar dan kecil tetap dibedakan agar isi data tidak diubah diam-diam.
- String tanggal `dd-mm-yyyy` dikonversi ke SPSS seconds untuk konsistensi pengurutan/kunci, lalu dikembalikan ke format tanggal untuk tampilan.

## Inisialisasi Tabel
- Kategori unik baris/kolom disortir numerik bila memungkinkan; jika tidak, diurutkan leksikografis (opsi localeCompare dengan numeric).
- Tabel `R × C` diisi dengan jumlah bobot pada setiap sel.
- Bobot non-integer dapat disesuaikan via opsi:
  - `nonintegerWeights = 'roundCase'|'truncateCase'` pada level kasus
  - `nonintegerWeights = 'roundCell'|'truncateCell'` pada level sel (setelah agregasi)

## Statistik Sel & Ringkasan
Diberikan `f_ij` = bobot pada sel (i,j), `rowTotals[i]`, `colTotals[j]`, dan \( W = \sum_{i,j} f_{ij} \).
- Expected count (untuk tampilan): \( E_{ij}^{\text{disp}} = \text{roundEven}(\tfrac{\text{rowTotals}[i]\cdot \text{colTotals}[j]}{W}, 1\text{ desimal}) \)
- Residual: \( r_{ij} = f_{ij} - E_{ij}^{\text{exact}} \) dengan \( E_{ij}^{\text{exact}} = \tfrac{\text{rowTotals}[i]\cdot \text{colTotals}[j]}{W} \)
- Standardized residual: \( \dfrac{f_{ij} - E_{ij}^{\text{exact}}}{\sqrt{E_{ij}^{\text{exact}}}} \)
- Adjusted residual: \( \dfrac{f_{ij} - E_{ij}^{\text{exact}}}{\sqrt{E_{ij}^{\text{exact}} (1 - p_i)(1 - q_j)}} \) dengan \( p_i = \text{rowTotals}[i]/W \), \( q_j = \text{colTotals}[j]/W \)
- Row percent: \( 100 \cdot f_{ij}/\text{rowTotals}[i] \)
- Column percent: \( 100 \cdot f_{ij}/\text{colTotals}[j] \)
- Total percent: \( 100 \cdot f_{ij}/W \)

Ringkasan yang dikembalikan berisi:
- `rows`, `cols`, `totalCases (= W)`, `valid`, `missing`, `rowCategories`, `colCategories`, `rowTotals`, `colTotals`.

## Uji Chi-Square dan Proporsi

`categoricalChiSquare.js` membentuk tabel kontingensi dan menghitung:

- Uji Kebebasan Pearson Chi-Square;
- Uji Kesamaan Proporsi Binomial untuk tepat dua kategori hasil;
- Uji Kesamaan Proporsi Multinomial untuk minimal tiga kategori hasil.

Ketiga konteks memakai statistik Pearson yang sama:

\[ \chi^2 = \sum_{i,j} \dfrac{(f_{ij} - E_{ij})^2}{E_{ij}}, \qquad df = (R-1)(C-1). \]

Perbedaannya terletak pada hipotesis dan konteks penarikan kesimpulan. Modul juga menghitung p-value, expected count eksak, keputusan pada alpha, dan diagnostik aturan expected count.

## Ringkasan Sumber Perhitungan
- Tabel kontingensi dan pengujian kategorik: `../categoricalTests/categoricalChiSquare.js`.
- Statistik sel untuk tampilan: `crosstabs.js`.
- Utilitas tanggal, missing, dan pembulatan tampilan: `../utils/utils.js`.
- Chi-Square goodness-of-fit satu sampel pada menu Nonparametric Tests merupakan modul terpisah.

Urutan fungsi utama pada mesin kategorik adalah:

1. `normalizeCategoryValue()` membersihkan nilai kategori mentah.
2. `buildContingencyTable()` membentuk matriks observed dan total marginal.
3. `calculatePearsonChiSquare()` menghitung expected count, statistik, df, dan p-value.
4. `chiSquareIndependenceTest()`, `binomialProportionTest()`, atau
   `multinomialProportionTest()` menambahkan hipotesis sesuai tujuan pengujian.

## Batasan & Catatan
- Expected untuk tampilan dibulatkan ke 1 desimal dengan kebijakan "bankers rounding" (`toSPSSFixed`); perhitungan residual memakai nilai eksak yang tidak dibulatkan.
- Kategori dapat campuran numerik/teks; algoritme pengurutan mencoba numerik terlebih dulu, lalu fallback ke urutan string natural.
