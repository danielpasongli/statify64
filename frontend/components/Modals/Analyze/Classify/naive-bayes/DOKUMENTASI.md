# Dokumentasi Modul Naive Bayes (v1 + v2 Text & Mixed)

**Lokasi kode:** `frontend/components/Modals/Analyze/Classify/naive-bayes/`
**Menu:** *Analyze → Classify → Naive Bayes* (panel sidebar kanan)
**Mesin:** Rust/WASM (`rust/`), Web Worker `frontend/public/workers/Classify/NaiveBayes/naive-bayes.worker.js`,
crate teks bersama `frontend/public/workers/TextAnalytics/statify-text-core` (**CORE**)
**Versi WASM:** `naive-bayes-v2-20261005a`

Dokumen ini ditulis untuk tiga pembaca sekaligus:

| Bagian | Untuk siapa | Isi |
|---|---|---|
| [A. Panduan pengguna](#a-panduan-pengguna) | Pengguna Statify | Fungsi menu, langkah pakai, arti setiap tab/opsi, cara membaca output, export, galat |
| [B. Landasan teori & metodologi](#b-landasan-teori--metodologi-bahan-skripsi) | Penulisan skripsi | Teorema Bayes, model campuran, rumus setiap likelihood, validasi, metrik, contoh angka, keterbatasan |
| [C. Dokumentasi teknis](#c-dokumentasi-teknis-pengembang) | Pengembang | Arsitektur, struktur file, payload, kontrak hasil, schema export, kode galat, test, build |

Dokumen kontrak yang mengikat: `AGENTS_V2.md` (v2) > `PLAN_V2.md` > `AGENTS.md` (v1). Ringkasan singkat v2 ada di
`README_V2.md`; bukti verifikasi per butir di `plan-reports-v2/V1.md`.

---

## A. Panduan pengguna

### A.1 Apa yang dilakukan menu ini?

Menu Naive Bayes **melatih dan mengevaluasi** model klasifikasi Naive Bayes dari dataset yang sedang terbuka. Satu model
dapat menggabungkan tiga jenis prediktor:

| Kelompok | Contoh | Cara dimodelkan |
|---|---|---|
| **Numeric** (Covariates, measure `scale`) | umur, skor | Distribusi Gaussian per kelas |
| **Categorical** (Factors, measure `nominal`/`ordinal`) | jenis kelamin, kota | Frekuensi kategori per kelas (Laplace smoothing) |
| **Text Features** (v2) | isi tweet, kolom `VEC_*` | Multinomial / Bernoulli / Complement Naive Bayes |

Hasilnya: tabel ringkasan kasus, distribusi atribut, metrik evaluasi, confusion matrix, tabel kata paling berpengaruh
(bila ada teks), dan tombol **Export Model** (file JSON) yang bisa dipakai menu **Apply Model** untuk memprediksi data
baru. Menu ini sendiri tidak menulis prediksi ke dataset.

### A.2 Urutan tab

`Variables` · `Text Preprocessing` · `Options` · `Validation` · `Output`

Tab **Text Preprocessing** hanya aktif bila **Raw Text Variable** terisi (bila tidak, tampil abu-abu dengan tooltip).
Footer: **OK**, **Reset**, **Cancel**. Pengaturan terakhir disimpan otomatis (IndexedDB, key `"NaiveBayes"`) dan
dimuat lagi saat panel dibuka; bila daftar variabel dataset berubah, form direset ke default.

### A.3 Tab Variables

Panel kiri **Available Variables** (bisa diurutkan menurut nama/measure) dilengkapi:

- kotak **Filter** (tidak membedakan huruf besar/kecil, mencocokkan nama atau label; mis. ketik `VEC_`),
- tombol **Select All (filtered)**, Select All Nominal, Select All Continuous,
- sorotan banyak variabel: klik, Ctrl+klik (tambah/kurang), Shift+klik (rentang),
- penghitung "N shown, M selected".

Variabel dipindahkan dengan tombol panah di samping setiap kotak, seret-lepas (bisa banyak sekaligus), atau klik ganda.

Panel kanan:

| Kotak | Isi yang diterima |
|---|---|
| **Target / Label** | Tepat satu variabel `nominal`/`ordinal` (kelas yang diprediksi; multikelas didukung). |
| **Variables to Exclude** | Mode *Exclude*: semua variabel lain (kecuali `unknown`) otomatis menjadi prediktor, kecuali yang dimasukkan di sini. |
| **Candidate Factors / Categorical Features** | Mode *Candidates*: hanya variabel `nominal`/`ordinal`. |
| **Candidate Covariates / Numerical Features** | Mode *Candidates*: hanya variabel `scale`. |
| **Raw Text Variable** (blok Text Features) | Maks. 1 variabel bertipe `STRING` berisi teks mentah. |
| **Word-Vector Variables** (blok Text Features) | Banyak variabel `NUMERIC` (mis. kolom hasil String to Word Vector). |

Aturan:

- Satu variabel hanya boleh berada di satu kotak.
- Mode Exclude dan Candidates saling eksklusif: mengisi salah satu mengosongkan yang lain (isinya kembali ke panel kiri).
- Raw Text dan Word-Vector juga saling eksklusif dengan cara yang sama.
- Pada mode Exclude, yang otomatis dikeluarkan hanya target, isi Excluded, Raw Text, Word-Vector, dan variabel
  `unknown`. **Variabel STRING lain tetap ikut** sebagai prediktor kategorik (perilaku v1).
- Variabel ber-measure `unknown` tidak bisa dipakai; perbaiki measure-nya di Variable View.
- Tombol OK aktif bila target terisi **dan** (ada prediktor Numeric/Categorical **atau** Text Features terisi).

Peringatan non-blokir di bawah panel kanan:

| Kode | Muncul bila | Pesan |
|---|---|---|
| W-VEC | ≥ 20 kolom Numeric efektif tampak seperti vektor kata (semua nilai ≥ 0 dan > 50% nol; sampel 1.000 baris) | "Terdeteksi {n} kolom numerik yang tampak seperti vektor kata. Pindahkan ke Text Features agar memakai Multinomial NB." |
| W-STR | Kolom STRING prediktor punya nilai unik ≥ 50% (sampel 5.000 baris) | "Kolom '{nama}' tampak seperti teks bebas atau ID. Keluarkan atau masukkan ke Text Features." |
| W-LEAK | Word-Vector Variables terisi | "Kosakata/IDF kolom vektor dihitung di luar Naive Bayes, sehingga hasil evaluasi dapat sedikit optimis." |

**Raw Text atau Word-Vector?**

| | Raw Text Variable | Word-Vector Variables |
|---|---|---|
| Data | Satu kolom teks mentah | Banyak kolom angka ≥ 0 hasil STWV/alat lain |
| Pra-pemrosesan | Di tab Text Preprocessing | Sudah dilakukan sebelumnya |
| Kebocoran data saat evaluasi | Tidak ada (kosakata di-fit ulang per split) | Ada sedikit (W-LEAK) |
| Apply Model ke data baru | Resep ikut diekspor, teks baru diproses identik | Hanya nama kolom; IDF/normalisasi bisa tidak setara bila STWV diulang di data baru |
| Rekomendasi | **Default untuk analisis teks** | Bila vektor sudah jadi dan ingin dipakai apa adanya |

Kolom teks Raw Text dikirim apa adanya: tweet seperti "2 paslon sama-sama bagus" tidak berubah menjadi angka 2. Sel
kosong/spasi dianggap teks kosong.

### A.4 Tab Text Preprocessing (v2)

Memakai panel yang sama dengan menu *Transform → String to Word Vector* (tanpa Vector Column Name): Lowercase,
Stopwords Removal, Stemming (Indonesian Sastrawi / English), Tokenizer (Word / N-gram 1–5), Delimiters, Formula standard
(Weka / scikit-learn / Custom), TF, IDF, Normalization, Words to Keep, Min term frequency. Penjelasan setiap opsi dan
rumusnya ada di `../../../Transform/StringToWordVector/DOKUMENTASI.md` bagian A.4 dan B.4. Galat konfigurasi
ditampilkan di tab ini dan menahan pindah tab/OK.

### A.5 Tab Options

| Blok | Pilihan | Keterangan |
|---|---|---|
| **Numeric** | `Gaussian` (default) / `Gaussian (Weka min. std)` | Berlaku untuk semua variabel Numeric. Tabel override per variabel (kolom **Variable**, **Likelihood** = `Group default` / Gaussian / Gaussian (Weka min. std)); muncul filter bila > 50 variabel. |
| **Categorical** | `Likelihood: Categorical` (tetap) + **Smoothing Alpha** | Alpha Laplace, > 0 dan ≤ 999, default 1. |
| **Text** (aktif bila Text Features terisi) | `Multinomial` (default) / `Bernoulli` / `Complement` + **Text Alpha (smoothing)** | Complement hanya bisa dipilih bila model **hanya** berisi Text Features; selain itu disabled dengan tooltip. Bila tersimpan Complement lalu ditambah prediktor lain, OK diblokir (`NB_E_COMPLEMENT_MIXED`). Text Alpha > 0, ≤ 999, default 1. |

Panduan memilih: lihat B.4–B.6. Singkatnya: Multinomial untuk umum; Bernoulli untuk teks pendek di mana ada/tidaknya kata
lebih penting; Complement untuk kelas tidak seimbang (model hanya-Text). Gaussian (Weka min. std) mencegah varians kelas
yang hampir nol mendominasi skor.

### A.6 Tab Validation

| Opsi | Default | Keterangan |
|---|---|---|
| **Validation Method** | Training and Holdout Partition | Atau **Cross-Validation Folds** (saling eksklusif). |
| Holdout Settings: Training % | 70 | 1–99; Holdout % = 100 − Training % (read-only). Pembagian **stratified** per kelas. |
| Cross-Validation Settings: Folds | 10 | ≥ 1 dan ≤ min(jumlah baris, anggota kelas terkecil). Stratified. |
| **Use random seed** + Seed | off | 0–4.294.967.295 (Mersenne Twister). Isi agar hasil dapat diulang persis (mis. 42). Tanpa seed hasil acak berubah tiap run. |

Metrik evaluasi berasal dari data holdout (atau gabungan prediksi semua fold). Tabel distribusi atribut, tabel kata, dan
model yang diekspor berasal dari **model final** yang dilatih ulang pada **seluruh** baris valid.

### A.7 Tab Output

| Checkbox | Default |
|---|---|
| Case Processing Summary | ON |
| Attribute Distribution Table | ON |
| Model Evaluation Metrics | ON |
| Confusion Matrix | ON |
| Text Feature Table (blok Text Features) | ON, aktif bila Text Features terisi |
| Top-k terms per class | 100 (bilangan bulat 1–1000) |

### A.8 Membaca output (Output Viewer, judul "Naive Bayes Analysis Result")

**Case Processing Summary** — Total Instances, Valid Instances, Excluded (Target Missing), Target Variable, Attribute
Variables, Validation Scenario. Bila ada Text Features ditambah:

- `Text features`: `Raw text: 'Text Tweet' (V terms)` atau `Word vectors: n columns`,
- `Text likelihood`, `Text alpha`,
- `Not Scored (All Predictors Missing)`: baris yang semua prediktornya kosong (tidak diprediksi saat evaluasi),
- `Note`: catatan W-LEAK (jalur vector) atau "tanpa prior" (Complement).

**Attribute Distribution Table** (gaya Weka) — hanya Numeric/Categorical:

- Categorical: per kategori, per kelas: raw count, smoothed count (`count + α`), probability, total.
- Numeric: mean dan std dev per kelas (std dev setelah variance floor / min-std). Catatan
  `Numerical likelihood: ...` muncul bila min-std dipakai.

**Model Evaluation Metrics** — per kelas: Accuracy (one-vs-rest), Precision, Recall, F1-Score; baris Macro Average,
Weighted Average, Micro Average, Overall Accuracy. **Cohen's Kappa** ditampilkan sebagai satu angka overall.

**Confusion Matrix** — baris = kelas sebenarnya, kolom = prediksi (`Actual \ Predicted`), dengan count, total, dan
persentase terhadap total.

**Text Feature Table** (v2) — per kelas, `Rank | Term | Score | Log weight | Count` untuk top-k kata. *Score* positif
besar berarti kata itu jauh lebih khas untuk kelas tersebut dibanding kelas lain. Tombol:

- **Download CSV** → `Naive_Bayes_Text_Features.csv`, berisi semua term × kelas
  (`term,class,count,log_weight,probability,score`), UTF-8 dengan BOM agar karakter Indonesia terbaca di Excel.
- **Copy (TSV)** → salin ke clipboard; bila > 5 MB muncul "Tabel terlalu besar untuk disalin; gunakan Download CSV."

**Export Model** — isi nama file (default `Naive_Bayes_Model_Export.json`) lalu unduh. File memuat nilai/label kategori
asli dataset (bisa sensitif). Schema **1.1** untuk model setara v1, **2.0** bila ada Text Features atau min-std.

### A.9 Pesan galat penting

| Kode/pesan | Arti dan tindakan |
|---|---|
| Pilih variabel target / minimal satu predictor | Lengkapi tab Variables. |
| Smoothing/Text Alpha, Training %, Folds, Seed, Top-k di luar rentang | Perbaiki nilai di tab terkait. |
| `NB_E_COMPLEMENT_MIXED` | Complement dipakai bersama Numeric/Categorical. Pilih Multinomial/Bernoulli atau keluarkan prediktor lain. |
| `NB_E_TEXT_NEGATIVE` | Kolom Word-Vector berisi nilai negatif (mis. hasil standardisasi/PCA, kode −1). Keluarkan kolom yang disebut. |
| `NB_E_TEXT_EMPTY_VOCAB_FOLD` | Kosakata kosong pada data latih holdout/fold ke-n. Longgarkan Text Preprocessing atau kurangi Folds. |
| `NB_E_TEXT_EMPTY_VOCAB` | Kosakata kosong pada seluruh data. |
| `NB_E_TEXT_CONFIG` | Konfigurasi Text Preprocessing tidak sah (meneruskan pesan asli, mis. regex salah). |
| Jumlah fold melebihi batas | Kurangi Folds. |

### A.10 Tips

- Selalu isi **seed** bila angka akan dikutip.
- Untuk tweet, mulai dari default Weka lalu bandingkan stopword/stemming Indonesia; perhatikan stopword bawaan memuat
  kata negasi (penting untuk sentimen).
- Hindari ribuan kolom Word-Vector (UI berat, pernah terjadi *Out of Memory* pada ±17 ribu kolom); pakai Raw Text atau
  batasi Words to Keep.
- Kolom ID atau teks bebas yang ikut sebagai prediktor kategorik (W-STR) biasanya merusak model; keluarkan.

---

## B. Landasan teori & metodologi (bahan skripsi)

### B.1 Teorema Bayes dan asumsi naif

Untuk kelas `c` dan vektor prediktor `x = (x₁,…,x_p)`:

```
P(c | x) = P(c) · P(x | c) / P(x)
```

Naive Bayes mengasumsikan prediktor **saling bebas bersyarat** pada kelas: `P(x | c) = Π_j P(x_j | c)`. Perhitungan
dilakukan dalam log agar stabil secara numerik:

```
s_c = ln P(c) + Σ_numeric ln f(x_j | c) + Σ_categorical ln P(x_j | c) + kontribusi Text
P(c | x) = exp(s_c − m) / Σ_k exp(s_k − m),   m = max_k s_k   (log-sum-exp)
ŷ = argmax_c s_c
```

Prior `P(c)` = proporsi kelas pada data latih. Bila skor seri, kelas pertama menurut urutan alfabetis (byte-wise)
yang menang. `ln` yang aman: `ln(p)` untuk `p > 0`, selain itu `ln(f64::MIN_POSITIVE)`.

### B.2 Prediktor Categorical (Laplace smoothing)

```
P(kategori k | c) = (n_kc + α) / (N_c + α·K)
```

`n_kc` = jumlah baris kelas `c` dengan kategori `k`, `N_c` = total baris kelas `c` pada atribut itu, `K` = jumlah
kategori, `α` = Smoothing Alpha. Nilai kosong diperlakukan sebagai kategori tersendiri `"(Missing)"`. Kategori yang
tidak pernah muncul di data latih suatu split mendapat `α / (N_c + α·K)` (bukan galat).

### B.3 Prediktor Numeric — Gaussian

```
ln f(x | c) = −½ ln(2π σ²_c) − (x − μ_c)² / (2 σ²_c)
σ²_c = max(varians populasi kelas c, VarianceFloor = 1e-9)
```

Nilai numerik kosong dilewati hanya untuk atribut itu (baris tidak dibuang).

**Gaussian (Weka min. std)** (v2, AGENTS_V2 §6.4): dari data latih split, ambil nilai unik terurut `u₁ < … < u_k` atribut
(semua kelas):

```
precision = (u_k − u₁) / (k − 1)   bila k ≥ 2, selain itu 0,01
min_var   = (precision / 6)²
σ²_c      = max(var_populasi_c, min_var, VarianceFloor)
```

Ini meniru batas bawah standar deviasi pada Weka `NaiveBayes` (tanpa meniru pembulatan nilai ke presisi). Tujuannya:
kelas dengan nilai identik tidak menghasilkan varians ≈ 0 yang membuat log-likelihood ekstrem.

Contoh (golden §6.7): atribut `x`, kelas A `[1,1,1]`, kelas B `[3,5]`. Nilai unik `{1,3,5}` → precision = 2,
min_var = 0,111111. Varians A = max(0, 0,111111) = 0,111111; B = max(1, 0,111111) = 1. Log-likelihood kelas A di
`x = 3`: **−17,820326** (min-std) dibanding **−1.999.999.990,557305** dengan floor 1e-9 v1.

### B.4 Fitur Text — Multinomial NB

Notasi: `x_dt` = nilai term `t` di dokumen `d` (hitungan/TF/TF-IDF), `V` = jumlah term, `α` = Text Alpha.

```
N_ct = Σ_{d∈c} x_dt,   N_c = Σ_t N_ct
θ_ct = (N_ct + α) / (N_c + α·V),   L_ct = ln θ_ct
kontribusi(d, c) = Σ_t x_dt · L_ct
```

### B.5 Fitur Text — Bernoulli NB

`b_dt = 1` bila `x_dt > 0`. `n_ct` = jumlah dokumen kelas `c` yang memuat `t`, `n_c` = jumlah dokumen kelas `c`.

```
p_ct = (n_ct + α) / (n_c + 2α),   L_ct = ln p_ct,   A_ct = ln(1 − p_ct)
kontribusi(d, c) = Σ_t [ b_dt·L_ct + (1 − b_dt)·A_ct ]   (seluruh V term, termasuk yang absen)
```

Dihitung efisien sebagai `Σ_t A_ct + Σ_{t: b=1} (L_ct − A_ct)`. Dokumen kosong tetap memberi kontribusi `Σ_t A_ct`.

### B.6 Fitur Text — Complement NB

Setara `sklearn.naive_bayes.ComplementNB(norm=False)`:

```
C_ct = Σ_{d∉c} x_dt
θ̃_ct = (C_ct + α) / (Σ_t C_ct + α·V),   L_ct = −ln θ̃_ct
skor_c = Σ_t x_dt · L_ct      (TANPA prior bila K ≥ 2)
```

Bobot dihitung dari kelas komplemen sehingga lebih stabil pada kelas tidak seimbang. Karena tidak memakai prior dan
skalanya berbeda, Complement **hanya sah bila model hanya berisi fitur Text**.

### B.7 Skor kata paling berpengaruh (Top-k)

```
score_ct = L_ct − mean_{c'≠c} L_c't      (K = 1: score = L_ct)
```

Diurutkan menurun per kelas; seri → term alfabetis. Untuk Bernoulli `L = ln p`; untuk Complement `L = −ln θ̃`.
`probability` di CSV = `exp(L)` (Complement: `θ̃ = exp(−L)`).

### B.8 Contoh perhitungan Text (golden AGENTS_V2 §6.7)

Data latih, kosakata `[makan, nasi, saya, suka, tidak]`:

```
X = [[1,1,1,1,0]  y = pos
     [0,1,1,1,1]  y = neg
     [3,0,0,0,0]] y = pos
```

α = 1, prior neg = 1/3, pos = 2/3. Dokumen uji "makan nasi enak" → `x = [1,1,0,0,0]` (kata `enak` tidak dikenal,
diabaikan). Kelas terurut `[neg, pos]`.

Multinomial, kelas pos: `N_pos = [4,1,1,1,0]`, total 7, penyebut 7 + 5 = 12.
`θ_pos,makan = 5/12` → `L = −0,875469`; `θ_pos,nasi = 2/12` → `L = −1,791759`.
Skor pos = ln(2/3) + (−0,875469) + (−1,791759) = −0,405465 − 2,667228 = **−3,072693**.
Kelas neg: `N_neg = [0,1,1,1,1]`, penyebut 4 + 5 = 9; `L_makan = ln(1/9) = −2,197225`, `L_nasi = ln(2/9) = −1,504077`;
skor neg = ln(1/3) − 3,701302 = **−4,799914**. P(pos) = 1 / (1 + e^(−4,799914+3,072693)) = **0,849057**.

| Likelihood | `L` neg | `L` pos | Skor `[neg, pos]` | P(pos) |
|---|---|---|---|---|
| Multinomial | `[-2.197225,-1.504077,-1.504077,-1.504077,-1.504077]` | `[-0.875469,-1.791759,-1.791759,-1.791759,-2.484907]` | `[-4.799914, -3.072693]` | 0,849057 |
| Bernoulli | `[-1.098612,-0.405465,-0.405465,-0.405465,-0.405465]` | `[-0.287682,-0.693147,-0.693147,-0.693147,-1.386294]` | `[-5.898527, -3.060271]` | 0,944708 |
| Complement | `[0.875469,1.791759,1.791759,1.791759,2.484907]` | `[2.197225,1.504077,1.504077,1.504077,1.504077]` | `[2.667228, 3.701302]` | 0,737705 |

Angka dihasilkan dengan scikit-learn 1.9.1 dan diuji otomatis (toleransi 1e-6) di CORE, crate NB, dan crate Apply Model,
serta dicocokkan lewat UI (uji manual B1 "Uji G").

### B.9 Contoh perhitungan model campuran v1

Model 6 baris (test `six_row_model`, α = 1, floor 1e-9): kelas `No`/`Yes` (prior 0,5/0,5); `Outlook` categorical
(`No: Overcast 0,5, Rain 1/6, Sunny 1/3`; `Yes: 1/6, 1/3, 0,5`); `Temp` numeric (`No: μ=84, σ²=56/3`; `Yes: μ=72, σ²=8/3`).
Baris uji `Outlook = Overcast`, `Temp = 85`:

```
s_No  = ln 0,5 + ln 0,5 + [−½ ln(2π·56/3) − (85−84)²/(2·56/3)] = −0,693147 − 0,693147 − 2,382308 − 0,026786 = −3,795388
s_Yes = ln 0,5 + ln(1/6) + [−½ ln(2π·8/3) − (85−72)²/(2·8/3)]  = −35,581760
→ P(No) ≈ 1,0000, prediksi No
```

Angka ini identik dengan skor yang diuji di Apply Model (`AM/AGENTS.md` §5.6 baris T1), bukti NB dan Apply Model memakai
rumus yang sama.

### B.10 Validasi dan pencegahan kebocoran data

- **Holdout** dan **k-fold** keduanya *stratified* (proporsi kelas dipertahankan), generator acak Mersenne Twister dengan
  seed opsional dipakai untuk seluruh operasi acak satu run.
- Metrik dihitung dari baris uji. Model final (untuk tabel atribut, tabel kata, export) dilatih ulang pada seluruh baris
  valid.
- **Jalur Raw Text (anti-leakage, AGENTS_V2 §7):** untuk setiap holdout/fold,
  `resep = CORE::fit(dokumen_latih)`, `X_latih = transform(resep, dokumen_latih)`, `X_uji = transform(resep, dokumen_uji)`;
  likelihood Text dilatih di `X_latih` dan dipakai menskor `X_uji`. Kata yang hanya ada di data uji tidak masuk kosakata
  split itu, dan IDF hanya dari data latih. Model final di-fit pada seluruh data valid dan resepnya diekspor.
- **Jalur Word-Vector:** nilai kolom dipakai apa adanya; karena kosakata/IDF dihitung STWV dari seluruh data, evaluasi
  dapat sedikit optimis (dicatat sebagai W-LEAK).

### B.11 Data hilang

| Kasus | Perlakuan |
|---|---|
| Target kosong | Baris dibuang (dilaporkan "Excluded (Target Missing)"). |
| Categorical kosong | Kategori `"(Missing)"`. |
| Numeric kosong | Atribut itu dilewati untuk baris tersebut. |
| Teks kosong/spasi | Dianggap prediktor hilang; bila masih ada prediktor lain, teks = vektor nol (Multinomial/Complement: kontribusi 0; Bernoulli: Σ A_ct). |
| Semua prediktor hilang (model ber-Text) | Baris ikut pelatihan tetapi tidak diskor saat evaluasi ("Not Scored"). |

### B.12 Metrik evaluasi

Dari confusion matrix (baris actual, kolom predicted), per kelas `c`: Precision = TP/(TP+FP), Recall = TP/(TP+FN),
F1 = 2PR/(P+R), Accuracy one-vs-rest = (TP+TN)/total. Agregat: macro (rata-rata sederhana), weighted (dibobot
support), micro (dari total TP/FP/FN), overall accuracy = Σ diagonal / total. Cohen's Kappa
`κ = (p_o − p_e)/(1 − p_e)` dengan `p_o` akurasi teramati dan `p_e` akurasi harapan dari marginal.

### B.13 Keterbatasan (untuk dicantumkan)

1. Asumsi independensi bersyarat jarang terpenuhi penuh, terutama untuk kata yang saling berkorelasi (n-gram).
2. Jalur Word-Vector memiliki kebocoran data kecil (B.10) dan tidak membawa resep ke data baru.
3. Complement tidak dapat digabung dengan prediktor non-teks.
4. Tokenizer default tidak menangani kekhasan tweet (hashtag, mention, URL); stopword bawaan membuang negasi.
5. Ribuan kolom Word-Vector berat di UI (keterbatasan teknis, bukan statistik).
6. Hasil acak tanpa seed tidak dapat diulang persis.

---

## C. Dokumentasi teknis (pengembang)

### C.1 Arsitektur

```
dialogs/naive-bayes-main.tsx (container, tab, IndexedDB "NaiveBayes", mergeWithDefaults)
 ├─ components/variables-tab.tsx  + components/dataset-variable-list.tsx (filter, multi-select)
 ├─ dialogs/text-preprocessing.tsx (impor read-only STWV/OptionsTab + STWV/config)
 ├─ dialogs/options.tsx · dialogs/validation.tsx · dialogs/output.tsx
 └─ hooks/useNaiveBayesValidation.ts (getEffectivePredictors, validasi OK/tab) · hooks/useNaiveBayesTextRules.ts (W-VEC/W-STR/W-LEAK)
        │ OK → services/naive-bayes-analysis.ts::analyzeNaiveBayes
        │   slicedData = [target, ...predictors, ...kolom Word-Vector]; rawTextValues langsung dari useDataStore.data
        │   config = buildNaiveBayesWorkerConfig(formData)   (+ Text = toRustConfig(text) hanya untuk raw)
        │   text   = buildNaiveBayesTextPayload(...)          (none | raw | vector)
        ▼ postMessage({ target, predictors, targetDefs, predictorsDefs, config, text })
public/workers/Classify/NaiveBayes/naive-bayes.worker.js  (?v=naive-bayes-v2-20261005a)
        ▼ new NaiveBayesAnalysis(target, predictors, targetDefs, predictorsDefs, config, text)
rust/src/wasm/constructor.rs → function.rs::run_analysis
   preprocess (buang target missing, align Text) → partition (stratified, MT seed)
   → per split: train (numeric/categorical/text via CORE::nb_text) → predict → classification_table
   → model final → save.rs (export 1.1/2.0), attribute_distribution, case_summary, text_feature_table
        ▼ get_formatted_results()
services/naive-bayes-analysis-formatter.ts (Raw → Table[]) → services/naive-bayes-analysis-output.ts (useResultStore)
   → Output Viewer: komponen "Text Feature Table" (components/text-feature-table-output.tsx), "Export Model"
```

Registry output: `frontend/components/Output/Statistics/index.tsx` (`"Text Feature Table"`, `"Export Model"`).
Lebar sidebar: `frontend/app/dashboard/layout.tsx` (sama dengan KNN, 40%).

### C.2 Struktur file

| File | Tanggung jawab |
|---|---|
| `types/naive-bayes.ts` | Tipe form (`main`, `options`, `validation`, `output`, `text: StwvConfig`), tipe payload Text. |
| `constants/naive-bayes-default.ts` | Default + `mergeWithDefaults(saved)` (deep merge data IndexedDB lama). |
| `dialogs/naive-bayes-main.tsx` | Container, tab, guard pindah tab (`getTabLeaveError`), `buildRawTextValues`, reset, OK. |
| `components/variables-tab.tsx` | Tata letak dua panel sendiri (bukan `VariableListManager`); `NAIVE_BAYES_ZONE_RULES`, `moveVariables`, `reorderWithin`. |
| `components/dataset-variable-list.tsx` | Panel kiri: `filterVariablesByText`, Select All (filtered), Shift/Ctrl, drag multi. |
| `dialogs/text-preprocessing.tsx` | Pembungkus `STWV/OptionsTab` + `validateStwvConfig`. |
| `dialogs/options.tsx` | Blok Numeric/Categorical/Text, `pruneNumericOverrides`. |
| `dialogs/validation.tsx`, `dialogs/output.tsx` | Tab Validation dan Output. |
| `hooks/useNaiveBayesValidation.ts` | `getEffectivePredictors` (satu-satunya sumber), `getEffectiveTextSource`, `getTextColumnNames`, `getNumericInputError`, hook validasi. |
| `hooks/useNaiveBayesTextRules.ts` | `detectVectorLikeColumns`, `detectFreeTextStrings`, `getLeakageNote`, `useNaiveBayesTextWarnings` (`useMemo`). |
| `services/naive-bayes-analysis.ts` | `analyzeNaiveBayes`, `buildNaiveBayesWorkerConfig`, `buildNaiveBayesTextPayload`, `splitNaiveBayesDataVariables`, `NAIVE_BAYES_WASM_VERSION`. |
| `services/naive-bayes-analysis-formatter.ts` | Tipe hasil mentah (`NaiveBayesRawResult`, model 1.x/2.0) → `Table[]`. |
| `services/naive-bayes-analysis-output.ts` | Menulis log/analytic/statistic ke Output Viewer. |
| `services/naive-bayes-error-messages.ts` | `getUserFriendlyNaiveBayesError` (prefiks kode `NB_E_*` dicek sebelum pola v1). |
| `components/export-model-action.tsx`, `export-model-output.tsx` | Tombol & input nama file export. |
| `components/text-feature-table-output.tsx` | Tabel Top-k, Download CSV (BOM, CRLF), Copy TSV (batas 5 MB). |

Rust (`rust/src/`):

| File | Isi |
|---|---|
| `models/config.rs` | Config v1 + `*V2` (`NumericLikelihood`, `TextLikelihood`, `TextSource`, `TextAlpha`, `TextTopK`, `Text: Option<TextVectorizerConfig>`); semua `serde(default)`. |
| `models/data.rs` | `AnalysisData`, `TextPayload` (`none`/`raw`/`vector`, tag `source`), `vector_to_csr` (null→0, negatif → `NB_E_TEXT_NEGATIVE`). |
| `stats/preprocess_data.rs` | Pembersihan, `data_value_to_label`/`is_missing_value` (**dikunci**, disalin AM), `kept_row_indices`, `align_text_payload`. |
| `stats/partition.rs`, `mersenne_twister.rs` | Stratified holdout/k-fold, MT19937. |
| `stats/class_prior.rs`, `categorical_distribution.rs`, `numerical_distribution.rs` | Parameter model (termasuk `gaussian_minstd_min_variance`). |
| `stats/training.rs`, `prediction.rs` | Pelatihan & skor (rumus v1 Gaussian/Categorical **dikunci**). |
| `stats/text_features.rs` | Integrasi Text (vector & raw), `text_row_missing`, NotScored, validasi Complement/alpha/shape. |
| `stats/raw_text.rs` | Fit per holdout/fold (`fit_split`), model final + resep, pemetaan galat CORE. |
| `stats/classification_table.rs` | Confusion matrix & metrik (**dikunci**, disalin AM). |
| `stats/attribute_distribution.rs`, `case_summary.rs`, `text_feature_table.rs` | Tabel output. |
| `stats/save.rs` | Export (`ExportedModel` 1.1, `ExportedModelV2`, `export_requires_schema_2`). |
| `wasm/constructor.rs`, `wasm/function.rs` | Kelas WASM `NaiveBayesAnalysis`, `run_analysis`, serialisasi hasil. |

### C.3 Payload ke worker dan config Rust

```ts
// AGENTS_V2 §5.1
type NaiveBayesTextPayload =
  | { source: "none" }
  | { source: "raw"; variable: string; values: (string | null)[] }        // sejajar baris target
  | { source: "vector"; columns: string[]; values: (number | null)[][] };  // values[row][i]
```

`config` (PascalCase seperti v1) berisi section `main`, `options`, `validation`, `output` + field v2
(`TextSource` efektif, `RawTextVar`, `TextVectorVars`, `NumericLikelihood`, `NumericLikelihoodOverrides`,
`TextLikelihood`, `TextAlpha`, `TextFeatureTable`, `TextTopK`) dan `Text` = `toRustConfig(formData.text)` (snake_case,
kontrak CORE) **hanya** untuk jalur raw (selain itu `null`). Field internal v1: `MissingValuePolicy "exclude"`,
`UnseenCategoryPolicy "smoothing"`, `VarianceFloor 1e-9`.

Aturan penting:

- Kolom Raw Text **tidak** lewat `getSlicedData`/`parseCellValue` (yang memakai `parseFloat`), melainkan
  `useDataStore.data[row][columnIndex]` (`buildRawTextValues`). Spasi saja → `null`. Tanpa `rawTextValues` →
  `NB_E_TEXT_RAW_MISSING`.
- Di Rust urutannya wajib: `align_text_payload` (buang baris target-missing) → tentukan NotScored dari payload mentah →
  `vector_to_csr`. Negatif di baris yang dibuang tidak menggagalkan analisis.
- Rust hanya memakai `text.source` dari payload sebagai sumber kebenaran.

### C.4 Bentuk hasil Text (dikunci Fase N8/N4)

```ts
text_feature_table: {
  likelihood, classes, k,
  top:  Record<class, { term, score, log_weight, count }[]>,
  full: { term, class, count, log_weight, probability, score }[]   // semua term × kelas
}
case_processing_summary.text_features: { description, likelihood, alpha, uses_class_prior, leakage_note, class_prior_note }
case_processing_summary.not_scored_rows, not_scored_rows   // hanya bila ada Text
```

`count` = `N_ct` (Multinomial) / `n_ct` (Bernoulli) / `C_ct` (Complement). Semua kunci baru `skip_serializing_if`,
sehingga JSON hasil run v1 tidak berubah.

### C.5 Schema export

- **1.1** (v1, persis seperti sebelum v2) bila tidak ada Text dan tidak ada `gaussian_minstd`: `schema_version`,
  `model_type: "naive_bayes"`, `trained_at`, `target {name, classes (alfabetis), class_priors, class_counts}`,
  `features` (categorical: `categories`, `distribution{class: prob[]}`, `class_totals`; numerical: `mean{class}`,
  `variance{class}` setelah floor), `feature_order`, `smoothing_alpha`, `variance_floor`, `validation_config`,
  `missing_value_policy`, `unseen_category_policy`.
- **2.0** bila ada Text atau min-std: semua field 1.1 + `likelihood` per fitur, `min_variance` (null untuk gaussian), dan
  blok `text` (`null` eksplisit bila tanpa Text):

```jsonc
"text": {
  "source": "raw" | "vector", "likelihood": "multinomial" | "bernoulli" | "complement", "alpha": 1,
  "terms": [...],                       // raw = recipe.vocabulary; vector = nama kolom
  "raw_variable": "Text Tweet" | null,  // wajib untuk raw
  "columns": [...] | null,              // wajib untuk vector
  "log_weights": {"neg": [...], "pos": [...]},
  "log_weights_absent": {...} | null,   // hanya bernoulli
  "class_term_counts": {...},
  "uses_class_prior": true | false,     // false hanya complement K ≥ 2
  "recipe": TextVectorizerModel | null  // wajib untuk raw (CORE)
}
```

`feature_order` hanya berisi fitur Numeric/Categorical. Model hanya-Text punya `feature_order` dan `features` kosong.

### C.6 Kode galat NB

`NB_E_TEXT_NEGATIVE` (nama kolom pertama + jumlah kolom), `NB_E_TEXT_EMPTY_VOCAB_FOLD` (menyebut holdout/fold ke-n),
`NB_E_TEXT_EMPTY_VOCAB`, `NB_E_COMPLEMENT_MIXED`, `NB_E_TEXT_CONFIG` (`[kode CORE] pesan asli`), `NB_E_TEXT_SHAPE`
(bentuk payload/matriks tidak konsisten; belum punya pesan ramah TS), `NB_E_TEXT_RAW_MISSING` (TS). Pemetaan ramah di
`services/naive-bayes-error-messages.ts`; galat run ber-Text datang lewat galat konstruktor WASM.

### C.7 Prinsip yang mengikat

- **Regresi nol v1:** konfigurasi tanpa Text dan tanpa min-std menghasilkan angka dan export identik dengan v1
  (dibuktikan snapshot `snapshot_export_v1_six_row_model_identik_kecuali_trained_at` di `save.rs`).
- **Satu sumber kebenaran:** preprocessing teks hanya lewat `CORE::fit/transform`; likelihood Text hanya lewat
  `CORE::nb_text` (dipakai juga Apply Model), sehingga skor NB = skor Apply Model (toleransi 1e-9).
- Fungsi terkunci: `data_value_to_label`, `is_missing_value`, `classification_table.rs`, rumus v1 di `prediction.rs`.
- Jangan mengubah `VariableListManager`, `ui/*`, atau store global dari modul ini.

### C.8 Test

| Lapisan | Lokasi | Hasil terakhir (2026-10-05) |
|---|---|---|
| Rust NB | `rust/src/**` (modul `tests`, `tests_n3a`, `tests_n4`, `raw_text::tests`, dll.) | 203 lulus |
| Rust CORE | `frontend/public/workers/TextAnalytics/statify-text-core/tests/` | 91 lulus |
| Jest NB | `hooks/__tests__/`, `components/__tests__/`, `services/__tests__/` | 12 suite / 191 lulus |

```bash
cd frontend/components/Modals/Analyze/Classify/naive-bayes/rust && cargo test
# Jest HARUS dari folder frontend (jest.config.ts di root repo usang)
cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes --coverage=false
npx tsc --noEmit -p frontend   # baseline 43 error di modul lain, nol di naive-bayes
```

### C.9 Build WASM (PowerShell, dari root repo)

```powershell
cd frontend\components\Modals\Analyze\Classify\naive-bayes\rust ; wasm-pack build --target web --release ; cd ..\..\..\..\..\..\..
$src = "frontend\components\Modals\Analyze\Classify\naive-bayes\rust\pkg"
$dst = "frontend\public\workers\Classify\NaiveBayes\pkg"
Copy-Item -Force "$src\wasm.js","$src\wasm_bg.wasm","$src\wasm.d.ts","$src\wasm_bg.wasm.d.ts" $dst
```

Salin hanya empat berkas itu (jangan `pkg/.gitignore`/`package.json`). Setelah mengganti `pkg`, naikkan
`NAIVE_BAYES_WASM_VERSION` (`services/naive-bayes-analysis.ts`) dan dua query `?v=` di worker. Ukuran `wasm_bg.wasm`
saat ini ±1,8 MB (738 kB terkompresi) karena stemmer & kamus Sastrawi di CORE.

### C.10 Keterbatasan teknis yang diketahui

1. Ribuan kolom Word-Vector (±17 ribu) membuat tab Variables berat dan pernah *Out of Memory*: daftar tanpa
   virtualisasi, peringatan dihitung ulang, payload vector padat `baris × kolom`. Usulan perbaikan "N9" ditunda.
2. Double-click pertama pada panel kiri mengisi Target tanpa cek measurement (meniru v1).
3. Slot Word-Vector hanya menerima tipe `NUMERIC` (bukan subtipe angka lain).
4. Tidak ada test otomatis untuk worker `.js` dan deserialisasi `serde_wasm_bindgen` (terbukti lewat uji manual B1).
5. CSV Text Feature Table tidak menetralkan sel berawalan `= + - @`; memakai CRLF.
6. Waktu k-fold Raw Text + stemming Indonesia belum diukur (fit teks diulang tiap fold).

### C.11 Riwayat singkat

- **v1:** model campuran Gaussian + Categorical, holdout/k-fold stratified, export 1.0 → 1.1 (untuk Apply Model).
- **v2 (2026-10, `PLAN_V2.md`):** N0 dokumen, N1 config/payload Rust, N2 `CORE::nb_text`, N5 tipe/validasi TS,
  N3a min-std + Text vector, N6 tab Variables, N7 Options/Text Preprocessing/Output, N3b Raw Text anti-leakage,
  N8 formatter/Text Feature Table, N4 export 2.0, I1 integrasi worker, B1 build & uji manual, V1 verifikasi.
  Laporan lengkap di `plan-reports-v2/`.
