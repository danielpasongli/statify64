# README_V2 — Naive Bayes v2 (Text & Mixed) dan Apply Model v2

Panduan singkat pengguna dan catatan teknis untuk **Naive Bayes v2** (menu *Analyze → Classify → Naive Bayes*) dan
**Apply Model v2** (*Analyze → Classify → Apply Model*). Ditulis pada Fase V1 (`PLAN_V2.md`, 2026-10-05).

Dokumen kontrak yang mengikat tetap `AGENTS_V2.md` (folder ini) > `PLAN_V2.md` > `AGENTS.md` (NB) dan
`../apply-model/AGENTS.md` (AM). Bila README ini berbeda dengan kontrak, kontrak yang berlaku. Bukti verifikasi per butir
ada di `plan-reports-v2/V1.md`.

Notasi path: `NB/` = folder ini, `AM/` = `../apply-model/`, `STWV/` = `frontend/components/Modals/Transform/StringToWordVector/`,
`CORE/` = `frontend/public/workers/TextAnalytics/statify-text-core/`.

---

## 1. Apa yang baru di v2

| Fitur | Ringkas |
|---|---|
| Text Features | Kelompok prediktor baru di tab **Variables**: **Raw Text Variable** (maks. 1 kolom STRING) atau **Word-Vector Variables** (kolom NUMERIC, mis. hasil String To Word Vector). Keduanya saling eksklusif. |
| Tab **Text Preprocessing** | Pengaturan tokenisasi, stopword, stemming, n-gram, TF/IDF/normalisasi, Words to Keep untuk Raw Text. Memakai ulang panel opsi STWV (mesin yang sama: crate `CORE`). Aktif hanya bila Raw Text Variable terisi. |
| Likelihood per kelompok | Numeric: `Gaussian` / `Gaussian (Weka min. std)` (+ override per variabel). Categorical: `Categorical` (Smoothing Alpha v1). Text: `Multinomial` / `Bernoulli` / `Complement` (+ `Text Alpha (smoothing)`). |
| Anti-leakage jalur Raw Text | Kosakata/IDF di-*fit* hanya pada data latih tiap holdout/fold; model final di-*fit* pada seluruh data valid dan resepnya ikut diekspor. |
| Text Feature Table | Top-k kata paling berpengaruh per kelas + **Download CSV** (tabel lengkap) dan **Copy (TSV)**. |
| Export schema 2.0 | Model setara v1 tetap diekspor **schema 1.1 persis seperti v1**. Model dengan Text atau `gaussian_minstd` diekspor **schema 2.0** (blok `text`, `likelihood` per fitur). |
| Apply Model v2 | Memuat schema 1.0/1.1/2.0; model Raw Text memakai resep model (teks baru diproses identik); model Word-Vector memetakan kolom berdasarkan nama, kolom yang tidak ditemukan diisi 0. |

Hasil v1 (angka, tabel, export 1.1) tidak berubah untuk konfigurasi tanpa Text Features dan tanpa min-std.

---

## 2. Kapan memakai Raw Text dan kapan Word-Vector

| Pertanyaan | Raw Text Variable | Word-Vector Variables |
|---|---|---|
| Bentuk data yang dimasukkan | Satu kolom teks mentah (STRING), mis. `Text Tweet`. | Banyak kolom angka ≥ 0 (hitungan/TF/TF-IDF), mis. kolom `VEC_*` hasil *Transform → String To Word Vector*. |
| Siapa yang memproses teks | Naive Bayes sendiri (tab Text Preprocessing). | Sudah diproses sebelumnya (STWV atau alat lain). |
| Kebocoran data saat evaluasi (holdout/k-fold) | **Tidak ada**: kosakata/IDF di-*fit* ulang di data latih tiap split. | **Ada (kecil)**: kosakata/IDF dihitung STWV dari SEMUA dokumen, termasuk yang nanti menjadi data uji. Peringatan W-LEAK ditampilkan. |
| Menerapkan ke data baru (Apply Model) | **Disarankan.** Resep (kosakata, stopword final, IDF, rata-rata norma) ikut diekspor, sehingga teks baru diproses identik dengan saat latih. | Dataset baru harus sudah punya kolom bernama sama. Bila STWV dijalankan ulang pada data baru, kosakata/IDF/normalisasi dihitung **dari data baru** (bukan dari data latih), sehingga nilai kolom tidak setara dengan saat latih (lihat §6). |
| Jumlah kolom di dataset | Tidak menambah kolom. | Menambah satu kolom per term; ribuan kolom membuat UI berat (lihat §7 butir 1). |
| Kapan dipilih | Default untuk analisis teks dan untuk hasil skripsi yang ingin bebas leakage. | Bila vektor sudah dibuat di luar NB dan ingin dipakai apa adanya, atau ingin membandingkan dengan pipeline lain. |

Ringkasnya: **pakai Raw Text** kecuali ada alasan khusus memakai vektor yang sudah jadi.

Catatan: kolom teks di jalur Raw Text dikirim **apa adanya** (tidak melalui `parseFloat`), jadi tweet seperti
`"2 paslon sama-sama bagus"` tidak berubah menjadi angka 2. Sel kosong, `null`, atau berisi spasi saja dianggap teks kosong.

---

## 3. Memilih likelihood

### Text (tab Options → bagian Text)
| Pilihan | Rumus ringkas (AGENTS_V2 §6) | Kapan dipakai |
|---|---|---|
| **Multinomial** (default) | `θ_ct = (N_ct + α)/(N_c + α·V)`; skor `Σ_t x_dt·ln θ_ct` | Pilihan umum untuk hitungan kata/TF/TF-IDF. Nilai pecahan diperbolehkan. |
| **Bernoulli** | `p_ct = (n_ct + α)/(n_c + 2α)`; memakai ada/tidaknya kata, termasuk kata yang **absen** | Teks pendek (tweet) di mana kehadiran kata lebih penting daripada frekuensinya. Teks kosong tetap memberi skor (Σ ln(1−p)). |
| **Complement** | bobot dari kelas komplemen, `−ln θ̃_ct`, **tanpa prior** (K ≥ 2) | Kelas tidak seimbang. **Hanya boleh bila model hanya berisi Text Features** (tanpa Numeric/Categorical); opsi ini disabled bila ada prediktor lain. Case Processing Summary memberi catatan bahwa prior tidak dipakai. |

`Text Alpha (smoothing)`: > 0 dan ≤ 999 (default 1). Kolom vektor bernilai negatif ditolak (`NB_E_TEXT_NEGATIVE`, menyebut nama kolom).

### Numeric (bagian Numeric)
- **Gaussian** (default): sama persis dengan v1 (variance floor 1e-9).
- **Gaussian (Weka min. std)**: varians kelas minimum `(presisi/6)²`, presisi = jarak rata-rata nilai unik terurut atribut
  di data latih split (0,01 bila < 2 nilai unik). Mencegah varians ≈ 0 (mis. kelas dengan nilai identik) mendominasi skor.
  Hasil hanya berbeda bila varians kelas < `min_var`. Memaksa export schema 2.0. Bisa diatur per variabel lewat tabel
  override (`Group default` / `Gaussian` / `Gaussian (Weka min. std)`); ada filter bila > 50 variabel.

### Categorical
- **Categorical** dengan `Smoothing Alpha` (field v1, > 0, ≤ 999). Tidak berubah dari v1.

Model campuran: skor total = `ln prior + Σ Numeric + Σ Categorical + kontribusi Text` (AGENTS_V2 §6.5).

---

## 4. Langkah pakai singkat

### 4.1 Naive Bayes dengan Raw Text
1. *Analyze → Classify → Naive Bayes* → tab **Variables**: Target = label (nominal/ordinal); **Raw Text Variable** = kolom teks.
   Kolom lain boleh tetap menjadi prediktor Numeric/Categorical (mode Exclude atau Candidates seperti v1).
2. Tab **Text Preprocessing**: atur tokenizer, stopword, stemming, n-gram, TF/IDF/normalisasi, Words to Keep.
3. Tab **Options**: pilih likelihood Text dan `Text Alpha (smoothing)`.
4. Tab **Validation**: holdout atau k-fold seperti v1. Isi seed (mis. **42**) agar hasil dapat diulang.
5. Tab **Output**: `Text Feature Table` (default ON) dan `Top-k terms per class` (1–1000, default 100). **OK**.
6. Output: Case Processing Summary (baris `Text features`, `Text likelihood`, `Text alpha`,
   `Not Scored (All Predictors Missing)`), tabel klasifikasi, Text Feature Table, dan **Export Model**.

### 4.2 Naive Bayes dengan Word-Vector
1. Buat kolom vektor: *Transform → String To Word Vector* (awalan kolom diatur di `Vector Column Name`, mis. `VEC_`).
2. Tab **Variables**: ketik `VEC_` di kotak **Filter** panel kiri → **Select All (filtered)** → pindahkan (panah atau seret)
   ke **Word-Vector Variables**. Peringatan W-LEAK muncul (tidak memblokir).
3. Lanjutkan seperti 4.1 langkah 3–6 (tab Text Preprocessing tetap disabled).

### 4.3 Apply Model
1. *Analyze → Classify → Apply Model* → tab **Model**: muat JSON hasil Export Model.
2. Tab **Variables**:
   - Model raw: blok **Raw Text Variable** (hanya variabel STRING), auto-map berdasarkan nama `raw_variable`.
   - Model vector: satu baris ringkasan `"{m} dari {V} kolom vektor ditemukan; {V−m} dianggap 0."` dan daftar kolom yang
     dianggap 0 (dapat dibuka, dimuat bertahap 200 nama). Kolom yang tidak ditemukan **tidak** memblokir OK.
3. **OK**. Model Summary memuat `Text source`, `Text likelihood`, dan `Text features zero-filled: {n}` (vector) atau
   `Rows with empty text: {n}` (raw).

Aturan baris (K5/V11): teks kosong/null/spasi = prediktor missing. Baris yang **semua** prediktornya missing tidak
diprediksi (**NotScored**); bila masih ada prediktor lain, teks kosong diperlakukan sebagai vektor nol dan baris tetap
diprediksi. Model vector yang **tidak punya satu pun** kolom cocok di dataset → semua baris NotScored, dengan peringatan
`AM_W_TEXT_ALL_ZERO_FILLED`.

---

## 5. Output dan export

- **Text Feature Table**: per kelas, `Rank | Term | Score | Log weight | Count`, dengan
  `score_ct = L_ct − mean_{c'≠c} L_c't` (urut menurun, seri → term alfabetis). `Count` = `N_ct` (Multinomial),
  `n_ct` (Bernoulli), atau `C_ct` (Complement).
- **Download CSV** (`Naive_Bayes_Text_Features.csv`): format panjang `term,class,count,log_weight,probability,score`,
  UTF-8 dengan BOM, baris CRLF. `probability = exp(log_weight)` (Complement: `θ̃ = exp(−L)`).
- **Copy (TSV)**: format yang sama dengan tab; bila > 5 MB muncul toast `Tabel terlalu besar untuk disalin; gunakan Download CSV.`
- **Attribute Distribution Table**: hanya Numeric/Categorical; catatan `Numerical likelihood: ...` bila min-std.
- **Export Model**: schema `1.1` bila setara v1; schema `2.0` bila ada Text atau `gaussian_minstd` (blok `text` berisi
  `source`, `likelihood`, `alpha`, `terms`, `log_weights`, `log_weights_absent` (Bernoulli), `class_term_counts`,
  `uses_class_prior`, dan `recipe` + `raw_variable` (raw) atau `columns` (vector); `text: null` eksplisit bila tanpa Text).

---

## 6. Batasan jalur Word-Vector (penting untuk skripsi)

1. **Leakage evaluasi (W-LEAK, temuan T5 B1).** Kosakata dan IDF kolom `VEC_*` dihitung STWV dari seluruh dokumen sebelum
   split NB. Informasi data uji ikut membentuk fitur latih, sehingga akurasi holdout/k-fold dapat sedikit terlalu optimis.
   Jalur Raw Text tidak memiliki masalah ini. Catatan ini tampil di tab Variables dan Case Processing Summary.
2. **Menerapkan ke data baru.** Model vector hanya menyimpan nama kolom (`columns`), bukan resep STWV. Bila pengguna
   menjalankan STWV ulang pada dataset baru, **kosakata, IDF, dan normalisasi dihitung dari data baru**, bukan dari data
   latih. Akibatnya: (a) nilai TF-IDF/normalisasi kolom bernama sama tidak setara dengan saat latih; (b) kata yang tidak ada
   di data baru tidak menjadi kolom dan diisi 0; (c) kata baru yang tidak ada di model diabaikan; (d) pemilihan
   `Words to Keep` berbeda. Hanya konfigurasi tanpa IDF dan tanpa normalisasi (TF mentah/biner) yang nilainya setara per
   dokumen. Untuk penerapan ke data baru, pakai model **Raw Text**.
3. **Nilai negatif** (hasil standardisasi, PCA, kode missing −1) ditolak, baik di NB (`NB_E_TEXT_NEGATIVE`) maupun AM
   (`AM_E_TEXT_NEGATIVE`), dengan nama kolom pertama dan jumlah kolom bermasalah.
4. **Hanya tipe `NUMERIC`** yang diterima slot Word-Vector Variables (subtipe angka lain seperti COMMA/DOT tidak).

---

## 7. Keterbatasan yang diketahui

1. **Ribuan kolom Word-Vector (T1, DITUNDA ke usulan fase N9).** Dengan ±17.454 kolom `VEC_*` tab Variables sangat berat,
   drag & drop lambat, dan tab Chrome pernah crash *Out of Memory*. Penyebab dugaan: daftar variabel dirender penuh tanpa
   virtualisasi, peringatan dihitung ulang tiap perubahan form, dan payload vector berbentuk matriks padat
   (`baris × kolom`, mis. 900 × 17.454 ≈ 15,7 juta sel) yang dikirim ke worker. **Batas praktis yang disarankan:** gunakan
   Raw Text untuk kosakata besar, atau batasi `Words to Keep`/jumlah kolom VEC jauh di bawah itu (mis. ≤ 1.000–5.000
   kolom; angka pasti belum diukur). Raw Text tidak terdampak.
2. **Noise tokenizer pada tweet (T3).** Pemisah default Weka `[\s.,;:'"()?!]+` tidak memisah `#`, `@`, `<`, `/`, `-`,
   sehingga kosakata memuat `#hashtag`, `@mention`, potongan URL (`//bit`, `https`), simbol (`&`, `->`, `<clapping`), dan
   angka. Ini perilaku Weka-default, bukan bug. Konfigurasi yang disarankan untuk tweet ada di §8.
3. **Stopword bawaan membuang negasi.** Daftar stopword Indonesia memuat `tidak`, `bukan`, `belum`, dan sejenisnya
   (AUDIT STWV F06). Untuk analisis sentimen, pertimbangkan `Stopwords Removal = Custom` tanpa kata negasi, atau `None`.
4. **CSV Text Feature Table:** sel berawalan `=`, `+`, `-`, `@` tidak dinetralkan (risiko *formula injection* bila dibuka
   di Excel; keputusan pemilik N8); baris memakai CRLF; pada Excel ber-*locale* Indonesia pemisah daftar bisa `;`, sehingga
   klik ganda menampilkan semua kolom di satu kolom. Solusi: *Data → From Text/CSV*, delimiter koma.
5. **Ukuran WASM naik** karena crate `CORE` (stemmer + kamus Sastrawi): NB 265 KB → 1.843.051 B (±1,8 MB), AM 273 KB →
   1.626.940 B (±1,6 MB). Ukuran transfer terkompresi yang terlihat di DevTools: **NB 738 kB, AM 649 kB** (Uji 0 B1).
   Diterima pemilik; di-cache browser lewat query `?v=`.
6. **Waktu k-fold Raw Text + stemming Indonesia** belum diukur (Uji D B1 ditunda). Fit teks diulang tiap fold (plus satu
   fit model final). Waktu muat/kompilasi WASM juga belum diukur (Uji E). Snippet Console untuk keduanya ada di
   `plan-reports-v2/B1.md` (Uji D, Uji E).
7. **Truncate Words to Keep ketat** (Weka menyimpan semua term yang seri; Statify memotong tepat di batas). Lihat README STWV.
8. **Tab Variables NB memakai tata letak dua panel sendiri**, bukan `VariableListManager` global (yang hanya mendukung satu
   sorotan dan dilarang diubah). Konsekuensi: tooltip per item, teks bantuan, dan tata letak vertikal khusus mobile milik
   komponen global tidak ada. **Double-click pertama** pada panel kiri tetap mengisi Target **tanpa** cek measurement (meniru
   v1); seret/panah ke Target memakai aturan nominal/ordinal.
9. **Tidak ada test otomatis** untuk worker `.js` dan deserialisasi `serde_wasm_bindgen` payload Text; keduanya terbukti
   lewat uji manual B1 (Uji 2–5).
10. **Galat `NB_E_TEXT_SHAPE`** (bentuk payload/matriks Text tidak konsisten) belum punya pesan ramah khusus di TS; tampil
    sebagai pesan generik. Kasus ini tidak terjadi lewat UI normal.

---

## 8. Konfigurasi yang disarankan untuk dataset tweet

Mulai dari default Weka (Word, Lowercase, tanpa stopword/stemming, TF raw, tanpa IDF/normalisasi, Words to Keep 1000),
lalu bandingkan variasi berikut dengan **seed tetap (42)** dan metode validasi yang sama:

- **Delimiters**: tambahkan karakter yang sering menempel di tweet, mis. `[\s.,;:'"()?!/<>&\-]+` (memisah potongan URL dan
  emoji teks; `#`/`@` sengaja tidak dipisah agar hashtag/mention tetap utuh). Uji dulu di STWV agar tahu kosakatanya.
- Bersihkan URL/mention di data sebelum analisis bila tidak relevan (di luar NB).
- **Stopwords Removal**: Indonesian (atau Custom tanpa kata negasi untuk sentimen, lihat §7 butir 3).
- **Stemming**: Indonesian (Sastrawi) — memperkecil kosakata, tetapi menambah waktu k-fold (§7 butir 6).
- **Likelihood**: bandingkan Multinomial dan Bernoulli; Complement bila kelas tidak seimbang dan model hanya-Text.
- **Words to Keep**: mulai 1.000–5.000.

Hasil acuan B1 (Uji 2, dataset tweet pilkada 900 baris, Raw Text, Multinomial, holdout 70%, Weka default):
akurasi **0,741**, kappa **0,481**, 270 baris uji. Uji ini tercatat `seed: null`; ulangi dengan seed 42 bila angka akan
dikutip dan perlu dapat diulang.

---

## 9. Kode galat dan peringatan baru

| Kode | Lapisan | Arti |
|---|---|---|
| W-VEC / W-STR / W-LEAK | NB UI (non-blokir) | ≥ 20 kolom Numeric tampak vektor kata / kolom STRING tampak teks bebas atau ID / catatan leakage jalur vector. |
| `NB_E_TEXT_NEGATIVE` | NB | Kolom Word-Vector berisi nilai negatif (menyebut kolom pertama + jumlah). |
| `NB_E_TEXT_EMPTY_VOCAB_FOLD` / `NB_E_TEXT_EMPTY_VOCAB` | NB | Kosakata kosong pada data latih holdout/fold ke-n / pada model final. Longgarkan Text Preprocessing. |
| `NB_E_COMPLEMENT_MIXED` | NB | Complement dipakai bersama prediktor Numeric/Categorical. |
| `NB_E_TEXT_CONFIG` | NB | Konfigurasi Text Preprocessing tidak sah (meneruskan kode CORE: `INVALID_CONFIG`/`INVALID_REGEX`/`INVALID_STOPWORDS`). |
| `NB_E_TEXT_SHAPE` | NB (Rust) | Bentuk payload/matriks Text tidak konsisten (tambahan N3a; belum tercantum di AGENTS_V2 §11). |
| `NB_E_TEXT_RAW_MISSING` | NB (TS) | Teks mentah Raw Text tidak tersedia (galat internal; tambahan N5-fix). |
| `AM_E_NB2_TEXT_SHAPE` / `_TEXT_SOURCE` / `_LIKELIHOOD` / `_COMPLEMENT_MIXED` | AM | Validasi blok `text` model 2.0. |
| `AM_E_MAP_RAW_TEXT_UNMAPPED` / `_TYPE` | AM | Raw Text Variable belum dipetakan / bukan STRING. |
| `AM_E_TEXT_NEGATIVE` | AM | Kolom vektor terpetakan berisi nilai negatif. |
| `AM_I_TEXT_ZERO_FILLED` (info) / `AM_W_TEXT_ALL_ZERO_FILLED` (peringatan) | AM | Sebagian / semua kolom vektor tidak ditemukan dan diisi 0 (dua kode ini tambahan A1; belum tercantum di AGENTS_V2 §10.2). |

---

## 10. Catatan untuk pengembang

- **Satu sumber kebenaran:** preprocessing teks hanya lewat `CORE::fit/transform`; likelihood Text hanya lewat
  `CORE::nb_text` (dipakai NB, AM, dan STWV lewat path dependency di masing-masing `Cargo.toml`).
- **Test (jalankan dari folder `frontend`, bukan root repo).** `jest.config.ts` di root repo adalah konfigurasi usang
  (alias `@/` tanpa `frontend/`, tanpa transform TSX); konfigurasi yang benar `frontend/jest.config.js`.
  ```bash
  cd frontend
  npx jest components/Modals/Analyze/Classify/naive-bayes components/Modals/Analyze/Classify/apply-model --coverage=false
  cd ..
  npx tsc --noEmit -p frontend   # baseline: 43 error di 18 file modul lain, nol di NB/AM/Output/workers
  ```
  Rust: `cargo test` di `CORE/`, `NB/rust`, `AM/rust`.
- **Baseline `tsc`:** 43 error di 18 file (nearest-neighbor test, Bartlett, Crosstabs, Explore, Frequencies, GLM
  multivariate, TwoRelatedSamples, ImportCsv/Excel, ChartBuilder, `jest.setup.ts`, stores) sudah ada sebelum v2 dan di
  luar lingkup Statify v2.
- **Build WASM (PowerShell).** `cp -f` pada `PLAN_V2.md` B1 tidak berlaku di PowerShell (ambigu `-Force`/`-Filter`).
  Pakai `Copy-Item -Force` dan salin hanya 4 berkas (jangan salin `pkg/.gitignore`/`package.json`):
  ```powershell
  cd frontend\components\Modals\Analyze\Classify\naive-bayes\rust ; wasm-pack build --target web --release ; cd ..\..\..\..\..\..\..
  $src = "frontend\components\Modals\Analyze\Classify\naive-bayes\rust\pkg"; $dst = "frontend\public\workers\Classify\NaiveBayes\pkg"
  Copy-Item -Force "$src\wasm.js","$src\wasm_bg.wasm","$src\wasm.d.ts","$src\wasm_bg.wasm.d.ts" $dst
  # Ulangi untuk apply-model (…\apply-model\rust\pkg -> frontend\public\workers\Classify\ApplyModel\pkg),
  # lalu bump ?v= di kedua worker + NAIVE_BAYES_WASM_VERSION / APPLY_MODEL_WASM_VERSION.
  ```
- Versi WASM saat ini: `naive-bayes-v2-20261005a`, `apply-model-v2-20261005a`.
