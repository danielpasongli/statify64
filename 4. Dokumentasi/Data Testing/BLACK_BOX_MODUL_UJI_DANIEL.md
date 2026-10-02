# 4.X Evaluasi Black-Box Testing

Pengujian *black-box* dilakukan untuk mengevaluasi kesesuaian keluaran modul pengujian statistik berdasarkan data masukan dan tindakan pengguna tanpa memeriksa tahapan perhitungan di dalam algoritma. Modul yang diuji meliputi uji normalitas Kolmogorov–Smirnov dengan koreksi Lilliefors, uji normalitas Shapiro–Wilk, uji homogenitas varians Bartlett, uji kebebasan Pearson Chi-Square, uji kesamaan proporsi binomial, dan uji kesamaan proporsi multinomial.

Pengujian dilakukan secara otomatis menggunakan Jest dan React Testing Library. Jest digunakan untuk menguji kontrak masukan dan keluaran fungsi statistik serta *worker*, sedangkan React Testing Library digunakan untuk menguji interaksi pengguna pada antarmuka. Pengujian dilaksanakan pada 2 Oktober 2026.

## 4.X.1 Perancangan Skenario Pengujian

Skenario pengujian dirancang menggunakan teknik berikut:

1. *Equivalence partitioning* untuk membagi masukan menjadi data valid dan tidak valid.
2. *Boundary value analysis* untuk menguji jumlah observasi minimum serta ukuran terbesar dataset evaluasi.
3. *Decision table testing* untuk memeriksa keputusan berdasarkan perbandingan nilai *p-value* dan tingkat signifikansi.
4. *User interface testing* untuk memeriksa opsi pengujian, pemilihan tujuan analisis, dan informasi persyaratan penggunaan.

Tingkat signifikansi yang digunakan pada skenario keputusan adalah:

\[
\alpha = 0{,}05
\]

Aturan keputusan yang digunakan adalah:

\[
\begin{aligned}
p\text{-value} < \alpha &\Rightarrow H_0 \text{ ditolak},\\
p\text{-value} \geq \alpha &\Rightarrow \text{gagal menolak } H_0.
\end{aligned}
\]

## 4.X.2 Hasil Pengujian Uji Normalitas

| ID | Skenario dan data masukan | Keluaran yang diharapkan | Hasil aktual | Status |
|---|---|---|---|---|
| N-BB-01 | Sepuluh observasi numerik valid | Hasil Kolmogorov–Smirnov dan Shapiro–Wilk tersedia | Kedua uji menghasilkan statistik, derajat bebas, dan *p-value* dengan derajat bebas 10 | Lulus |
| N-BB-02 | Dua observasi numerik | Kedua uji tidak dapat dilakukan | Kedua hasil bernilai `null` dan status analisis tidak berhasil | Lulus |
| N-BB-03 | Lima observasi dengan nilai yang sama | Data konstan ditangani tanpa menghasilkan statistik yang tidak sah | Kedua hasil bernilai `null` dan aplikasi tidak berhenti | Lulus |
| N-BB-04 | Sebanyak 1.470 observasi sesuai ukuran terbesar dataset evaluasi | Kolmogorov–Smirnov dan Shapiro–Wilk dapat dilakukan | Kedua uji tersedia dengan derajat bebas 1.470 | Lulus |
| N-BB-05 | Sembilan nilai 1 dan satu nilai 100 | Kedua uji menolak hipotesis normalitas | Kedua kesimpulan bernilai `reject-normality` | Lulus |
| N-BB-06 | Data numerik yang mendekati distribusi normal | Kedua uji gagal menolak hipotesis normalitas | Kedua kesimpulan bernilai `fail-to-reject-normality` | Lulus |
| N-BB-07 | Pengguna menyorot ikon informasi dan memilih opsi normalitas | Tujuan dan syarat penggunaan tampil serta opsi dapat dipilih | Informasi mengenai tujuan uji, variabel numerik, dan minimal tiga observasi tampil; perubahan *checkbox* diterima | Lulus |

Hasil pengujian menunjukkan bahwa modul normalitas mampu menerima data numerik valid, menangani jumlah observasi yang tidak mencukupi dan data konstan, serta memberikan keputusan sesuai nilai *p-value*. Informasi pada ikon **(i)** juga menjelaskan bahwa kedua uji digunakan untuk memeriksa distribusi normal pada satu variabel numerik dengan minimal tiga observasi valid.

## 4.X.3 Hasil Pengujian Uji Homogenitas Bartlett

| ID | Skenario dan data masukan | Keluaran yang diharapkan | Hasil aktual | Status |
|---|---|---|---|---|
| B-BB-01 | Variabel numerik dengan faktor teks Kelas A, Kelas B, dan Kelas C | Statistik Bartlett dihasilkan dan label kelompok dipertahankan | Statistik = 0, derajat bebas = 2, *p-value* = 1, dan label kelompok asli tetap tampil | Lulus |
| B-BB-02 | Tiga kelompok dengan varians yang sama | Keputusan gagal menolak \(H_0\) | *p-value* \(\geq 0{,}05\) | Lulus |
| B-BB-03 | Tiga kelompok dengan varians yang berbeda jauh | Keputusan menolak \(H_0\) | *p-value* \(< 0{,}05\) | Lulus |
| B-BB-04 | Seluruh observasi berada dalam satu kelompok | Pengujian ditolak dengan keterangan jumlah kelompok tidak mencukupi | Sistem menghasilkan `lessThanTwoGroups` tanpa menghentikan *worker* | Lulus |
| B-BB-05 | Data mengandung nilai kosong dan nilai *missing* 999 | Kasus tidak valid dikeluarkan sebelum pengujian | Empat observasi valid tersisa, masing-masing dua pada kelompok A dan B | Lulus |
| B-BB-06 | Pengguna menyorot ikon informasi Bartlett | Tujuan dan persyaratan penggunaan ditampilkan | Informasi mengenai homogenitas varians, variabel uji numerik, faktor kategorik minimal dua kelompok, dan asumsi normalitas tampil | Lulus |
| B-BB-07 | Pengguna membuka Bartlett Test pada sidebar | Ikon informasi tampil di sebelah judul Bartlett Test | Ikon dengan label “Syarat penggunaan uji Bartlett” tampil pada header sidebar | Lulus |

Hasil pengujian menunjukkan bahwa faktor kategorik berbentuk teks dapat langsung digunakan. Sistem membentuk pemetaan kategori sementara untuk kebutuhan perhitungan tanpa mengubah data asli dan tanpa menambahkan kolom baru ke dalam dataset. Modul juga dapat menangani jumlah kelompok yang tidak mencukupi dan data *missing*.

## 4.X.4 Hasil Pengujian Uji Kebebasan Chi-Square dan Uji Kesamaan Proporsi

| ID | Skenario dan data masukan | Keluaran yang diharapkan | Hasil aktual | Status |
|---|---|---|---|---|
| C-BB-01 | Dua variabel kategorik berbentuk teks | Data diproses tanpa *recode* manual dan tanpa mengubah data asli | Tabel kontingensi terbentuk dengan label Desa A, Desa B, Miskin, dan Tidak miskin | Lulus |
| C-BB-02 | Tabel 2×2 dengan frekuensi `[[30,10],[10,30]]` | Keputusan menolak \(H_0\) kebebasan | `decision = reject`, hasil signifikan, dan *p-value* \(< 0{,}05\) | Lulus |
| C-BB-03 | Tabel 2×2 dengan frekuensi `[[20,20],[20,20]]` | Keputusan gagal menolak \(H_0\) kebebasan | `decision = fail-to-reject` dan *p-value* \(\geq 0{,}05\) | Lulus |
| P-BB-01 | Variabel hasil mempunyai dua kategori | Konteks uji proporsi binomial digunakan | `testType = binomial-proportion-homogeneity` dan jumlah kategori hasil = 2 | Lulus |
| P-BB-02 | Variabel hasil mempunyai tiga kategori | Konteks uji proporsi multinomial digunakan | `testType = multinomial-proportion-homogeneity` dan jumlah kategori hasil = 3 | Lulus |
| C-BB-04 | Dua kasus mempunyai kategori kosong | Kasus kosong dikeluarkan dan dicatat sebagai *missing* | Empat kasus valid dan dua kasus *missing* | Lulus |
| C-BB-05 | Variabel hasil hanya mempunyai satu kategori | Pengujian dinyatakan tidak tersedia tanpa membuat *worker* gagal | *Worker* berhasil, derajat bebas = 0, *p-value* = `null`, dan hasil proporsi = `null` | Lulus |
| C-BB-06 | Pengguna menyorot ikon informasi dan memilih Pearson Chi-Square | Informasi penggunaan tampil dan opsi Pearson Chi-Square dapat dipilih | Tujuan kedua uji, syarat data kategorik, serta ketentuan binomial dan multinomial tampil; perubahan *checkbox* diterima | Lulus |
| C-BB-07 | Pengguna memilih **Uji Kesamaan Proporsi** pada bagian Tujuan Pengujian | Sistem menerima tujuan pengujian proporsi | Pilihan diterima dengan nilai tujuan `proportion` | Lulus |

Hasil pengujian menunjukkan bahwa sistem mampu membentuk tabel kontingensi secara langsung dari kategori berbentuk teks. Pilihan **Uji Kebebasan** digunakan ketika pengguna ingin memeriksa hubungan antara dua variabel kategorik. Pilihan **Uji Kesamaan Proporsi** digunakan ketika pengguna ingin membandingkan proporsi hasil pada beberapa kelompok. Pada tujuan kesamaan proporsi, dua kategori hasil diperlakukan sebagai uji proporsi binomial, sedangkan tiga atau lebih kategori hasil diperlakukan sebagai uji proporsi multinomial.

Penambahan pilihan tujuan pengujian tidak mengubah statistik Pearson Chi-Square yang dihitung dari tabel kontingensi. Pilihan tersebut menentukan hipotesis dan interpretasi yang disajikan kepada pengguna sehingga kesimpulan sesuai dengan tujuan analisis.

## 4.X.5 Ringkasan Hasil Pengujian

| Modul | Jumlah skenario | Lulus | Gagal |
|---|---:|---:|---:|
| Kolmogorov–Smirnov dan Shapiro–Wilk | 7 | 7 | 0 |
| Bartlett | 7 | 7 | 0 |
| Kebebasan Chi-Square dan proporsi binomial/multinomial | 9 | 9 | 0 |
| **Total** | **23** | **23** | **0** |

Persentase keberhasilan dihitung menggunakan:

\[
\text{Persentase keberhasilan}
=
\frac{\text{jumlah skenario lulus}}
{\text{jumlah seluruh skenario}}
\times 100\%
\]

\[
\text{Persentase keberhasilan}
=
\frac{23}{23}\times100\%
=
100\%
\]

Berdasarkan pelaksanaan pengujian, tujuh *test suite* berhasil dijalankan dengan 23 skenario lulus dan tidak terdapat skenario yang gagal. Hasil tersebut menunjukkan bahwa fungsi yang diuji telah memenuhi perilaku masukan dan keluaran yang dirancang, termasuk pemilihan tujuan pada menu Crosstabs dan penyajian informasi penggunaan melalui ikon **(i)**.

Pengujian *black-box* hanya mengevaluasi perilaku fungsional yang terlihat dari masukan dan keluaran modul. Ketepatan rumus, nilai antara, percabangan, dan setiap tahap perhitungan statistik dievaluasi secara terpisah melalui *white-box testing* serta perbandingan dengan perangkat lunak statistik rujukan.

## Lampiran Perintah Pengujian

Perintah berikut dijalankan dari direktori `frontend`:

```powershell
..\node_modules\.bin\jest.cmd --runInBand --verbose `
  public/workers/DescriptiveStatistics/libs/normality/__tests__/black-box/normality.black-box.test.js `
  public/workers/CompareMeans/__tests__/black-box/bartlett.black-box.test.js `
  public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/black-box/categorical.black-box.test.js `
  components/Modals/Analyze/Descriptive/Explore/__tests__/normality/black-box/NormalityOptions.test.tsx `
  components/Modals/Analyze/CompareMeans/BartlettTest/__tests__/black-box/BartlettInfo.test.tsx `
  components/Modals/Analyze/CompareMeans/BartlettTest/__tests__/black-box/BartlettSidebarHeader.test.tsx `
  components/Modals/Analyze/Descriptive/Crosstabs/__tests__/chiSquare/black-box/ChiSquareOptions.test.tsx
```
