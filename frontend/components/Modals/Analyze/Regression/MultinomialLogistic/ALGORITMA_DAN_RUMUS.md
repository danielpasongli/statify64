# Algoritma dan Rumus Modul Multinomial Logistic

Dokumen ini merangkum algoritma, rumus, dan alur komputasi yang dipakai pada modul Multinomial Logistic di proyek ini.

## 1. Gambaran Umum Pipeline

Alur utama perhitungan di WASM adalah:

1. Parsing konfigurasi dan data input dari JavaScript.
2. Menyusun design matrix X dan metadata kategori.
3. Estimasi parameter dengan Newton-Raphson + step-halving.
4. Menghitung statistik turunan:
   - log-likelihood model penuh dan null
   - standard error, Wald, p-value
   - pseudo R-square
   - goodness-of-fit
   - classification table
   - likelihood ratio tests per efek
5. Serialisasi hasil ke struktur output untuk UI.

## 2. Struktur Model Multinomial Logit

Misal variabel dependen punya J kategori, dengan satu kategori referensi r.
Untuk setiap kategori j != r:

- Linear predictor:

$$
\eta_{ij} = x_i^T \beta_j
$$

- Kategori referensi:

$$
\eta_{ir} = 0
$$

- Probabilitas softmax:

$$
\pi_{ij} = \frac{\exp(\eta_{ij})}{\sum_{m=1}^{J} \exp(\eta_{im})}
$$

Implementasi menggunakan log-sum-exp shift untuk stabilitas numerik:

$$
\pi_{ij} = \frac{\exp(\eta_{ij} - \max_m \eta_{im})}{\sum_{m=1}^{J} \exp(\eta_{im} - \max_m \eta_{im})}
$$

## 3. Persiapan Data dan Design Matrix

### 3.1 Kategori dependen

- Kategori unik dependen diurutkan.
- Referensi dipilih dari config:
  - first
  - last
  - custom value

### 3.2 Design matrix X

Jika include_intercept aktif, maka kolom konstanta 1 ditambahkan.

$$
X = [1, x_1, x_2, ..., x_p]
$$

Jika tidak, hanya kovariat/prediktor asli.

### 3.3 Bobot kasus

Jika weights tidak diberikan, default tiap observasi bernilai 1.

## 4. Fungsi Log-Likelihood

Untuk observasi i dan kategori j:

- n_i = bobot observasi i
- n_{ij} = n_i jika y_i = j, selain itu 0

Log-likelihood:

$$
\ell(\beta) = \sum_i \sum_j n_{ij} \log(\pi_{ij})
$$

Di implementasi, ini ekuivalen dengan menjumlahkan log probabilitas kategori aktual untuk tiap observasi.

## 5. Estimasi Parameter: Newton-Raphson

### 5.1 Inisialisasi parameter

Intercept awal mengikuti pendekatan SPSS-like berbasis proporsi marginal:

$$
\beta_{j0}^{(0)} = \log\left(\frac{p_j}{p_r}\right),\quad
p_j = \frac{\sum_i n_{ij}}{\sum_i n_i}
$$

Koefisien slope awal = 0.

### 5.2 Gradient (score function)

Untuk parameter kategori j (non-referensi), prediktor s:

$$
\frac{\partial \ell}{\partial \beta_{js}} = \sum_i x_{is}(n_{ij} - n_i\pi_{ij})
$$

### 5.3 Hessian

$$
\frac{\partial^2 \ell}{\partial \beta_{js} \partial \beta_{j't}}
= -\sum_i n_i\pi_{ij}(\delta_{jj'} - \pi_{ij'})x_{is}x_{it}
$$

### 5.4 Update Newton-Raphson

$$
\beta^{(t+1)} = \beta^{(t)} - H^{-1}g
$$

dengan g = gradient dan H = Hessian.

### 5.5 Step-halving

Jika langkah Newton menurunkan log-likelihood, ukuran langkah dikurangi bertahap:

$$
\beta_{new} = \beta - \alpha H^{-1}g,\quad
\alpha \in \{1, 0.5, 0.25, ...\}
$$

Maksimal 5 kali pengurangan langkah (MXSTEP=5).

### 5.6 Kriteria konvergensi

Konvergen bila salah satu kondisi terpenuhi setelah iterasi awal:

- perubahan parameter maksimum kecil:

$$
\max |\beta^{(t+1)} - \beta^{(t)}| < pconverge
$$

- atau perubahan log-likelihood kecil (jika lconverge diaktifkan)
- atau maksimum skor kecil.

## 6. Matriks Informasi dan Varians-Kovarians

Matriks informasi observasi dihitung dari negatif Hessian di solusi akhir:

$$
I(\hat\beta) = -H(\hat\beta)
$$

Kemudian dihitung invers/generalized inverse dengan urutan fallback:

1. Cholesky pada matriks yang sudah disimetrikan.
2. Invers biasa.
3. Pseudoinverse berbasis SVD dengan cutoff relatif singularity.

Hasil invers dipakai sebagai matriks varians-kovarians parameter.

## 7. Standard Error, Wald, dan p-value

Untuk tiap parameter k:

- Standard error:

$$
SE_k = \sqrt{Var(\hat\beta_k)}
$$

- Statistik Wald:

$$
W_k = \left(\frac{\hat\beta_k}{SE_k}\right)^2
$$

- p-value Wald (aproksimasi \(\chi^2\) df=1):

$$
p_k = 1 - F_{\chi^2_1}(W_k)
$$

## 8. Exp(B) dan Confidence Interval

Odds ratio:

$$
\exp(B_k) = \exp(\hat\beta_k)
$$

Dengan level kepercayaan c, ambil:

$$
\alpha = 1-c,\quad z_{1-\alpha/2}
$$

Interval koefisien:

$$
CI_B = [\hat\beta_k - zSE_k,\; \hat\beta_k + zSE_k]
$$

Interval untuk Exp(B):

$$
CI_{\exp(B)} = [\exp(CI_{B,lower}),\; \exp(CI_{B,upper})]
$$

## 9. Statistik Kecocokan Model

### 9.1 Model chi-square (dibanding null model)

$$
\chi^2 = 2(\ell_{full} - \ell_{null})
$$

Derajat bebas yang dipakai modul:

$$
df = (J-1)(p-1)
$$

### 9.2 Null log-likelihood

Null LL dihitung dari frekuensi marginal kategori (dengan bobot):

$$
\ell_{null} = \sum_j n_j\log\left(\frac{n_j}{n}\right)
$$

## 10. Pseudo R-Square

Dihitung tiga metrik:

- Cox-Snell:

$$
R^2_{CS} = 1 - \exp\left(\frac{2}{n}(\ell_{null} - \ell_{full})\right)
$$

- Nagelkerke:

$$
R^2_N = \frac{R^2_{CS}}{1 - \exp\left(\frac{2}{n}\ell_{null}\right)}
$$

- McFadden:

$$
R^2_M = 1 - \frac{\ell_{full}}{\ell_{null}}
$$

## 11. Goodness-of-Fit (Pearson dan Deviance)

Modul menghitung GOF berdasarkan subpopulasi pola kovariat unik.

- Pearson:

$$
X^2 = \sum_i\sum_j \frac{(n_{ij} - n_i\pi_{ij})^2}{n_i\pi_{ij}}
$$

- Deviance:

$$
D = 2\sum_i\sum_j n_{ij}\log\left(\frac{n_{ij}}{n_i\pi_{ij}}\right)
$$

Derajat bebas:

$$
df = m(J-1) - (J-1)p
$$

Dengan m = jumlah pola kovariat unik.

## 11.1 Cell Probabilities (Observed and Predicted Frequencies)

Modul menghitung frekuensi teramati, frekuensi ekspektasi, residual Pearson, serta persentase teramati dan ekspektasi per subpopulasi $m$ dan kategori dependen $j$:

- **Observed Frequency ($O_{mj}$)**:
  $$O_{mj} = \sum_{i \in S_m, y_i = j} w_i$$

- **Predicted Frequency ($E_{mj}$)**:
  $$E_{mj} = \sum_{i \in S_m} w_i \pi_{ij}$$

- **Pearson Residual ($r_{mj}$)**:
  $$r_{mj} = \frac{O_{mj} - E_{mj}}{\sqrt{E_{mj}(1 - \hat{\pi}_{mj})}}$$
  dengan $\hat{\pi}_{mj} = \frac{E_{mj}}{N_m}$. Formula ini memperhitungkan varians multinomial $\text{Var}(O_{mj}) = N_m \hat{\pi}_{mj}(1 - \hat{\pi}_{mj}) = E_{mj}(1 - \hat{\pi}_{mj})$ sesuai spesifikasi SPSS NOMREG.

- **Observed Percentage**:
  $$\text{Observed \%} = \frac{O_{mj}}{N_m} \times 100\%$$

- **Predicted Percentage**:
  $$\text{Predicted \%} = \frac{E_{mj}}{N_m} \times 100\%$$

- **Penanganan Data Unweighted (Raw Data)**:
  Untuk data mentah unweighted (`!isWeightedAnalysis`), modul tidak menjalankan komputasi baris *cell probabilities* per observasi dan langsung menampilkan catatan berikut pada kartu output **Observed and Predicted Frequencies**:
  > *"Cell probabilities is not supported for raw data."*

dimana $N_m = \sum_j O_{mj}$ adalah total frekuensi teramati pada subpopulasi $m$.

## 12. Classification Table

Untuk setiap observasi:

1. Hitung probabilitas tiap kategori.
2. Prediksi kategori = argmax probabilitas.
3. Bangun confusion matrix observed vs predicted.

Overall accuracy:

$$
\text{Overall \%} = \frac{\text{jumlah prediksi benar}}{n} \times 100\%
$$

Category accuracy per kelas j:

$$
\text{Acc}_j = \frac{\text{confusion}_{jj}}{\sum_k \text{confusion}_{jk}} \times 100\%
$$

## 13. Likelihood Ratio Test per Efek

Untuk tiap efek prediktor:

1. Bentuk reduced model dengan menghapus kolom efek tersebut dari X.
2. Estimasi ulang reduced model.
3. Hitung statistik LR:

$$
LR = -2(\ell_{reduced} - \ell_{full})
$$

4. Hitung p-value dari distribusi \(\chi^2\) dengan df tertentu.

Pada implementasi ini, efek faktor dummy dikelompokkan berdasarkan nama dasar (contoh: Map=1, Map=2 menjadi Map).

Selain itu ditampilkan juga kriteria reduced model:

$$
-2LL_{reduced} = -2\ell_{reduced}
$$

$$
AIC_{reduced} = -2\ell_{reduced} + 2k_{reduced}
$$

$$
BIC_{reduced} = -2\ell_{reduced} + \ln(n)k_{reduced}
$$

## 14. Catatan Implementasi Penting

- Input numerik lebih robust karena parser menerima angka atau string angka.
- Penghitungan memakai bobot kasus jika tersedia.
- Probabilitas memakai log-sum-exp agar stabil numerik.
- Hessian direkomputasi pada beta final untuk konsistensi turunan statistik.
- Ada pengecekan separation (peringatan) mulai iterasi tertentu.

## 15. Lokasi Implementasi Kode

- Entry point WASM: src/lib.rs
- Persiapan data dan design matrix: src/stats/core.rs
- Estimasi parameter: src/stats/estimation.rs
- Newton-Raphson: src/stats/newton_raphson.rs
- Log-likelihood: src/stats/log_likelihood.rs
- Probabilitas softmax: src/stats/probabilities.rs
- Formatting output statistik: src/stats/format_results.rs
- Goodness-of-fit: src/stats/goodness_of_fit.rs
- Classification table: src/stats/classification.rs
- Likelihood ratio tests: src/stats/likelihood_ratio.rs
- Definisi config/data: src/models/config.rs
- Definisi output hasil: src/models/result.rs

## 16. Ringkasan Singkat

Modul ini mengimplementasikan multinomial logistic regression berbasis maximum likelihood dengan optimisasi Newton-Raphson yang distabilkan step-halving. Seluruh statistik utama (Wald, pseudo R-square, GOF, klasifikasi, dan LR test per efek) dihitung dari parameter final dan dikirim ke UI dalam format terstruktur camelCase.