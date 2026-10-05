# Validasi presisi normalitas — 4 Oktober 2026

Perubahan memperbaiki fungsi distribusi normal dan peluang ekor atas untuk nilai-p Shapiro–Wilk. Statistik W tetap memakai AS R94. Sebanyak 18 baris log SW-DEBUG yang tersisa dihapus. Tidak ada dependensi internet baru pada aplikasi.

## Metode pembandingan

- Rujukan independen: SciPy 1.18.1, fungsi `scipy.stats.shapiro` dan `scipy.stats.norm`.
- 52 dataset: 33 sampel deterministik (normal, eksponensial, dan nilai berulang pada n=3, 4, 5, 6, 11, 12, 50, 500, 2000, 4999, 5000), 15 dataset acuan lama, dan 4 pilihan variabel pada workbook penelitian.
- Seed NumPy: 20261004.
- Workbook: `Dataset_Demo Statify.xlsx`; HR berarti Department = Human Resources.
- Peluang ekor normal diperiksa pada 371 titik z=0 sampai 37, dengan langkah 0,1.
- Galat relatif: |p_Statify / p_rujukan - 1|. Ukuran ini mencegah nilai palsu nol lolos karena toleransi absolut terlalu longgar.
- Statistik D Kolmogorov–Smirnov dibandingkan terhadap CDF normal SciPy dengan mean sampel dan simpangan baku ddof=1. Pembandingan ini tidak memvalidasi pendekatan nilai-p Lilliefors.

## Hasil aktual workbook

| Variabel | n | Nilai-p Statify | Nilai-p SciPy | Galat relatif |
|---|---:|---:|---:|---:|
| Age | 1470 | 2.0369239659084426e-14 | 2.0369239717091107e-14 | 2.847759e-9 |
| MonthlyIncome | 1470 | 4.4023938507488055e-37 | 4.402393857239505e-37 | 1.474357e-9 |
| Age-HR | 63 | 0.217604045204214 | 0.217604045975003 | 3.542163e-9 |
| HourlyRate-HR | 63 | 0.002895413358547767 | 0.0028954133838675292 | 8.744783e-9 |

Nilai-p MonthlyIncome sebelumnya bernilai nol pada commit d4ca2089; setelah perbaikan nilainya positif sebagaimana rujukan. Perbandingan ini dilakukan dengan menjalankan fungsi produksi di Node.js, bukan membaca angka tabel yang telah diformat di browser.

## Ringkasan seluruh dataset

- Maksimum galat absolut W: 4.21865654e-10.
- Maksimum galat relatif nilai-p Shapiro–Wilk: 1.30200346e-8.
- Maksimum galat absolut D: 1.11022302e-15.
- Maksimum galat relatif peluang ekor normal: 2.28261854e-13.
- Seluruh 52 dataset lolos batas pengujian W < 1e-7, galat relatif nilai-p < 1e-5, dan galat absolut D < 5e-13.
- Seluruh 371 titik peluang ekor lolos batas galat relatif < 5e-12.

Hasil tetap menggunakan aritmetika IEEE-754 Number; ini bukan aritmetika eksak. Peluang di bawah jangkauan representasi Number masih dapat menjadi nol. Selisih kecil W antarimplementasi dan pendekatan distribusi AS R94 juga tetap ada. Hasil yang dibandingkan di sini bukan keluaran SPSS.

## Mengulang pemeriksaan

Pengujian Jest terakhir: 16 suite, 324 tes lulus. Jumlah tersebut terdiri dari 299 tes yang sebelumnya dijalankan, 21 tes presisi baru, dan 4 tes normalitas lama dari suite tambahan `libs/__tests__/normalityTests.test.js`. Satu tes memori diperbaiki tanpa menambah jumlah skenario. Angka ini bukan jumlah skenario black-box dan bukan pengujian seluruh aplikasi.

Perintah dari folder `frontend`:

```powershell
npm.cmd test -- --runInBand --silent --verbose=false public/workers/DescriptiveStatistics/libs/normality/__tests__ public/workers/DescriptiveStatistics/libs/__tests__/normalityTests.test.js public/workers/CompareMeans/__tests__/bartlettWorker.input.test.js public/workers/CompareMeans/__tests__/black-box/bartlett.black-box.test.js public/workers/DescriptiveStatistics/libs/categoricalTests/__tests__/categoricalChiSquare.test.js
```

Skrip: `frontend/public/workers/DescriptiveStatistics/libs/normality/__tests__/verify-scipy-reference.py`.

Dengan Python yang memiliki scipy dan openpyxl serta Node.js tersedia:

```powershell
python frontend/public/workers/DescriptiveStatistics/libs/normality/__tests__/verify-scipy-reference.py "E:\Kuliah\STIS\SEM-7\Skripsi\Data Percobaan Sederhana\Dataset_Demo Statify.xlsx"
```

Tanpa argumen workbook, skrip memeriksa 48 dataset yang dapat direproduksi dari repositori. Paket Python hanya digunakan untuk pembandingan, tidak digunakan aplikasi atau worker.

Tes kebocoran memori diperbaiki agar mengukur memori tertahan setelah garbage collection dalam proses Node terpisah. Batas 10 MB tidak diubah; alokasi sementara sebelum garbage collection tidak dianggap sebagai kebocoran.

Rujukan:
- [Implementasi AS R94 R, swilk.c](https://github.com/wch/r-source/blob/trunk/src/library/stats/src/swilk.c)
- [Dokumentasi SciPy shapiro](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.shapiro.html)
