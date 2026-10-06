# AGENTS_V2.md — Kontrak Naive Bayes v2 (Text & Mixed) dan Apply Model v2

Dokumen ini adalah **kontrak kerja yang mengikat** untuk pengembangan **Naive Bayes v2** (upgrade di tempat pada
`naive-bayes/`) dan **Apply Model v2** (upgrade di tempat pada `apply-model/`). Rencana langkah demi langkah ada di
`PLAN_V2.md` (folder yang sama).

Hierarki dokumen: **AGENTS_V2.md > PLAN_V2.md > `naive-bayes/AGENTS.md` & `apply-model/AGENTS.md`**. Bila ada konflik,
dokumen ini yang berlaku. Bagian v1 yang tidak disinggung di sini tetap berlaku apa adanya.

Notasi path: `NB/` = `frontend/components/Modals/Analyze/Classify/naive-bayes/`, `AM/` = `.../Classify/apply-model/`,
`STWV/` = `frontend/components/Modals/Transform/StringToWordVector/`, `CORE/` = `frontend/rust-crates/statify-text-core/`.

Prasyarat: **Tahap 1 (`STWV/PLAN_FIX.md`) selesai**, terutama API `CORE` §3.4 (`fit`, `transform`, `TextVectorizerModel`, `CsrMatrix`).

---

## 0. Keputusan pemilik proyek (tidak boleh diubah agent)

| ID | Keputusan |
|---|---|
| V1 | NB v2 adalah **pengembangan menu Naive Bayes yang sudah ada** (bukan menu baru). AM v2 juga upgrade di tempat. |
| V2 | Tab Variables: **Target** + tiga kelompok prediktor — **Numeric (Covariates)**, **Categorical (Factors)**, **Text Features**. Text Features punya dua sumber **saling eksklusif**: **Raw Text Variable** (maks. 1 kolom teks mentah, diproses di tab baru *Text Preprocessing*) atau **Word-Vector Variables** (kolom hasil STWV/vektor lain). Satu kolom hanya boleh berada di satu tempat. |
| V3 | Text Features dapat dipakai bersama mode **Exclude** maupun **Candidates**. Pada mode Exclude, yang otomatis dikeluarkan hanya: target, isi Excluded, Raw Text Variable, Word-Vector Variables, variabel `unknown`. Variabel STRING lain **tetap ikut** seperti v1. |
| V4 | Tidak ada deteksi otomatis kolom vektor berdasarkan nama. Peringatan non-blokir berbasis data (§3.4). Panel Available Variables mendapat **kotak filter** + tombol **"Select All (filtered)"**. |
| V5 | Likelihood dipilih **per kelompok**; override **per variabel** hanya untuk Numeric. Numeric: `gaussian` (default) / `gaussian_minstd`. Categorical: `categorical`. Text: `multinomial` (default) / `bernoulli` / `complement`. **Complement hanya boleh bila model hanya berisi Text Features.** |
| V6 | Alpha per kelompok: Categorical (`SmoothingAlpha`, default 1, field v1 dipertahankan) dan Text (`TextAlpha`, default 1). Gaussian tanpa alpha. |
| V7 | Leakage: jalur Raw Text → vektorisasi di-*fit* hanya pada data latih tiap holdout/fold; model final di-*fit* pada seluruh data valid dan resepnya diekspor. Jalur Word-Vector → cukup catatan peringatan. |
| V8 | Export: schema **`1.1` tetap persis seperti sekarang** bila model setara v1 (tanpa Text Features dan tanpa `gaussian_minstd`). Selain itu schema **`2.0`**. Hasil v1 (test & angka) tidak boleh berubah. |
| V9 | Output kelompok Text: tabel **Top-k kata paling berpengaruh per kelas** (default k = 100) + aksi **Download CSV** (tabel lengkap) dan **Copy (TSV)**; bila TSV > 5 MB tampilkan toast yang menyarankan download. |
| V10 | AM v2: fitur Text jalur Word-Vector yang kolomnya tidak ditemukan di dataset **diisi 0** + info di ringkasan (pengecualian aturan K4 AM, **hanya untuk kelompok Text**). Model jalur Raw Text menerima input **Raw Text Variable** dan memakai resep model. |
| V11 | AM K5: teks mentah kosong/null dihitung sebagai prediktor missing. Baris yang semua prediktornya missing tidak diprediksi; bila masih ada prediktor lain, teks kosong = vektor nol. |
| V12 | Rumus Gaussian min-std ala Weka, Complement tanpa prior, skor Top-k: dikunci di §6. |
| V13 | Mesin preprocessing teks tunggal: crate `CORE` dipakai NB, AM, dan STWV (path dependency). Matematika likelihood Text juga diletakkan di `CORE` (modul `nb_text`) agar NB dan AM identik. Ini **menggantikan** aturan AM P6 ("salin, jangan import lintas crate") khusus untuk teks. |
| V14 | Satu working tree, branch `dija-v2`; agent tanpa git; build WASM manual oleh pemilik. |

---

## 1. Ruang lingkup

**Masuk:** semua butir V1–V13; persistensi form v2 (IndexedDB key `"NaiveBayes"` tetap, data lama digabung dengan default);
Case Processing Summary menampilkan baris info Text; Attribute Distribution Table v1 tetap untuk Numeric/Categorical.

**Tidak masuk:** lebih dari 1 Raw Text Variable; wordsToKeep per-kelas; deteksi otomatis vektor; pembobotan kasus;
kernel density untuk Numeric; perubahan menu Transform/STWV (Tahap 1 sudah final).

---

## 2. Prinsip mengikat

- **P-V1 Regresi nol untuk v1.** Seluruh test v1 yang ada (NB TS, NB Rust, AM TS, AM Rust) harus tetap hijau **tanpa mengubah ekspektasinya**. Konfigurasi setara v1 menghasilkan JSON export identik (kecuali `trained_at`).
- **P-V2 Satu sumber kebenaran.** Preprocessing teks hanya lewat `CORE::fit/transform`; likelihood Text hanya lewat `CORE::nb_text`. NB dan AM **tidak** boleh punya implementasi sendiri.
- **P-V3 Konsistensi NB ↔ AM.** Skor baris AM untuk model 2.0 harus sama dengan skor NB saat evaluasi (toleransi 1e-9), dibuktikan dengan golden test §6.7 di kedua crate.
- **P-V4 Fungsi v1 yang dikunci tetap dikunci:** `preprocess_data.rs::data_value_to_label`/`is_missing_value`, `classification_table.rs`, dan rumus v1 di `prediction.rs` untuk Gaussian/Categorical.
- **P-V5 Data besar.** Kelompok Text dapat berisi ribuan kolom; gunakan `CsrMatrix` di Rust, hindari operasi O(rows × kolom) di main thread UI selain yang disebut §3.4 (dengan sampling).

---

## 3. Kontrak UI NB v2

### 3.1 Urutan tab
`Variables` · `Text Preprocessing` (aktif hanya bila Raw Text Variable terisi; selain itu tampil disabled dengan tooltip) · `Options` · `Validation` · `Output`.

### 3.2 Tab Variables
- Panel kiri (Available Variables): kotak **Filter** (case-insensitive, mencocokkan nama atau label, mendukung awalan seperti `VEC_`) + tombol **Select All (filtered)** yang menyorot semua variabel hasil filter (multi-highlight), lalu dapat dipindah sekaligus dengan tombol panah/drag ke target mana pun.
- Panel kanan: `Target`; blok mode v1 (`Exclude` atau `Candidate Factors` + `Candidate Covariates`, aturan v1 tetap); blok baru **Text Features** dengan dua slot:
  - `Raw Text Variable` (maks. 1; hanya variabel bertipe `STRING`),
  - `Word-Vector Variables` (tak terbatas; hanya variabel bertipe `NUMERIC`).
  Memasukkan variabel ke salah satu slot mengosongkan slot lainnya dan mengembalikan isinya ke panel kiri (pola transisi mode v1).
- Satu variabel hanya boleh ada di satu tempat (Target, Excluded, Factors, Covariates, Raw Text, Word-Vector).

### 3.3 Predictor efektif (menggantikan `getEffectivePredictors` v1)
- Mode `exclude`: semua variabel `measure !== "unknown"` dikurangi target, `ExcludedVar`, `RawTextVar`, `TextVectorVars`. Peran Numeric/Categorical dari `measure` (v1).
- Mode `candidates`: `CandidateFactors ∪ CandidateCovariates` (v1).
- Text: `RawTextVar` atau `TextVectorVars` (bukan bagian daftar predictor Numeric/Categorical).
- Tombol OK aktif bila target terisi **dan** (predictor efektif tidak kosong **atau** Text Features terisi).

### 3.4 Peringatan non-blokir (ditampilkan di bawah panel kanan, tidak menghalangi OK)
- **W-VEC:** dihitung atas variabel Numeric efektif (mode Exclude maupun Covariates). Sampel maksimal 1.000 baris pertama. Sebuah kolom "mirip vektor kata" bila semua nilai non-missing ≥ 0 **dan** > 50% nilai non-missing = 0. Bila jumlah kolom tersebut ≥ 20 → pesan:
  `Terdeteksi {n} kolom numerik yang tampak seperti vektor kata. Pindahkan ke Text Features agar memakai Multinomial NB.`
- **W-STR:** untuk tiap variabel STRING di predictor efektif (Categorical), sampel maksimal 5.000 baris; bila jumlah nilai unik non-missing ≥ 50% dari jumlah baris non-missing → pesan:
  `Kolom '{nama}' tampak seperti teks bebas atau ID. Keluarkan atau masukkan ke Text Features.`
- **W-LEAK:** bila `TextSource === "vector"` → `Kosakata/IDF kolom vektor dihitung di luar Naive Bayes, sehingga hasil evaluasi dapat sedikit optimis.`
- Perhitungan peringatan dibungkus `useMemo`, hanya dijalankan ulang bila daftar variabel terkait berubah.

### 3.5 Tab Text Preprocessing
Memakai ulang komponen `STWV/OptionsTab.tsx` dan tipe/validasi `STWV/config.ts` (impor read-only; **tidak menyalin**). State disimpan di `formData.text` (tipe `StwvConfig`, default `STWV_DEFAULT_CONFIG`). Validasi memakai `validateStwvConfig`.

### 3.6 Tab Options
- Blok **Numeric**: radio grup `Gaussian` / `Gaussian (Weka min. std)`; tabel override per variabel Numeric efektif (kolom: Variable, Likelihood = "Group default" | Gaussian | Gaussian (Weka min. std)); bila > 50 variabel tampilkan filter. Override yang menunjuk variabel yang tidak lagi Numeric dibuang otomatis.
- Blok **Categorical**: likelihood `Categorical` (satu opsi, read-only) + `Smoothing alpha` (field v1 `SmoothingAlpha`, validasi v1: > 0, ≤ 999).
- Blok **Text** (aktif bila Text Features terisi): radio `Multinomial` / `Bernoulli` / `Complement` + `Text smoothing alpha` (`TextAlpha`, > 0, ≤ 999). `Complement` disabled (dengan tooltip) bila ada predictor Numeric/Categorical efektif; bila pilihan tersimpan `complement` tetapi kemudian ada predictor lain → error validasi yang memblokir OK.

### 3.7 Tab Output
Checkbox v1 tetap + `Text Feature Table` (default ON, aktif bila Text Features terisi) + input `Top-k terms per class` (`TextTopK`, bilangan bulat 1–1000, default 100).

---

## 4. Tipe form TS (tambahan pada `NB/types/naive-bayes.ts`)

```ts
export type NaiveBayesTextSource = "none" | "raw" | "vector";
export type NaiveBayesNumericLikelihood = "gaussian" | "gaussian_minstd";
export type NaiveBayesTextLikelihood = "multinomial" | "bernoulli" | "complement";

export type NaiveBayesMainType = {
  /* field v1 tetap */
  TextSource: NaiveBayesTextSource;            // default "none" (diturunkan dari isi slot, tetap disimpan)
  RawTextVar: string | null;                   // default null
  TextVectorVars: string[] | null;             // default null
};
export type NaiveBayesOptionsType = {
  /* field v1 tetap; SmoothingAlpha = alpha Categorical */
  NumericLikelihood: NaiveBayesNumericLikelihood;                         // default "gaussian"
  NumericLikelihoodOverrides: Record<string, NaiveBayesNumericLikelihood>; // default {}
  TextLikelihood: NaiveBayesTextLikelihood;                               // default "multinomial"
  TextAlpha: number;                                                      // default 1
};
export type NaiveBayesOutputType = {
  /* field v1 tetap */
  TextFeatureTable: boolean;   // default true
  TextTopK: number;            // default 100
};
export type NaiveBayesType = { main; options; validation; output; text: StwvConfig }; // text default STWV_DEFAULT_CONFIG
```
Data IndexedDB lama digabung dalam-dalam (deep merge per section) dengan default saat dimuat.

---

## 5. Payload worker & config Rust

### 5.1 Payload TS → worker → Rust (tambahan pada payload v1)
```ts
type NaiveBayesTextPayload =
  | { source: "none" }
  | { source: "raw"; variable: string; values: (string | null)[] }          // sejajar baris target yang dikirim
  | { source: "vector"; columns: string[]; values: (number | null)[][] };    // values[row][i] sejajar columns
```
Worker meneruskan `text` sebagai argumen baru konstruktor `NaiveBayesAnalysis(..., text)`. `config` (JSON) mendapat field baru dari §4 dengan nama yang sama (PascalCase seperti v1) + `Text` = hasil `toRustConfig(formData.text)` (snake_case, kontrak `CORE` §3.1). Field baru di Rust memakai `#[serde(default)]` sehingga payload v1 tetap valid.

### 5.2 Aturan data Text
- `raw`: `null`/kosong → dokumen `""`. Baris dengan target missing dibuang (aturan v1) sebelum fit.
- `vector`: `null`/non-finite → `0`. Nilai negatif → error `NB_E_TEXT_NEGATIVE` ("Kolom vektor teks berisi nilai negatif; Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0."). Nilai pecahan (mis. TF-IDF) diperbolehkan.
- Nama kolom vektor = nama "term" untuk keperluan output dan export.

---

## 6. Rumus (dikunci)

Notasi: kelas `c`, `K` = jumlah kelas, `V` = jumlah term, `x_dt` = nilai term `t` di dokumen `d` (hasil `CORE::transform` untuk raw, nilai kolom untuk vector), `α` = `TextAlpha`.

### 6.1 Multinomial
`N_ct = Σ_{d∈c} x_dt`, `N_c = Σ_t N_ct`, `θ_ct = (N_ct + α) / (N_c + α·V)`.
`L_ct = ln θ_ct`. Kontribusi skor: `Σ_t x_dt · L_ct`.

### 6.2 Bernoulli (binarisasi `b_dt = 1` bila `x_dt > 0`)
`n_ct` = jumlah dokumen kelas `c` dengan `b=1`, `n_c` = jumlah dokumen kelas `c`, `p_ct = (n_ct + α) / (n_c + 2α)`.
`L_ct = ln p_ct`, `A_ct = ln(1 − p_ct)`. Kontribusi: `Σ_t [ b_dt·L_ct + (1 − b_dt)·A_ct ]` (seluruh `V` term, termasuk yang absen).

### 6.3 Complement (sklearn `ComplementNB(norm=False)`)
`C_ct = Σ_{d∉c} x_dt`, `θ̃_ct = (C_ct + α) / (Σ_t C_ct + α·V)`, `L_ct = −ln θ̃_ct`.
Skor kelas = `Σ_t x_dt · L_ct` **tanpa prior** bila `K ≥ 2` (bila `K = 1` tambahkan `ln prior`). Hanya sah bila tidak ada predictor Numeric/Categorical.

### 6.4 Gaussian min-std (Weka)
Untuk tiap atribut Numeric dengan `gaussian_minstd`, dari **data latih split tersebut** (semua kelas): ambil nilai unik terurut `u_1 < … < u_k`.
`precision = (u_k − u_1)/(k − 1)` bila `k ≥ 2`, selain itu `0.01`. `min_var = (precision/6)²`.
Variance kelas = `max(var_populasi_c, min_var, VarianceFloor)`. Densitas & log-likelihood sama dengan v1 (`prediction.rs`). Pembulatan nilai ke presisi **tidak** ditiru.

### 6.5 Skor total
`s_c = ln prior_c + Σ numeric + Σ categorical + kontribusi Text` (kecuali Complement §6.3). Posterior, argmax, tie-break, dan `safe_ln` mengikuti v1.

### 6.6 Skor Top-k (output)
`score_ct = L_ct − mean_{c'≠c} L_c't` (bila `K = 1`: `score = L_ct`). Per kelas urutkan menurun, tie → term alfabetis. Untuk Bernoulli `L` = `ln p`; untuk Complement `L` = `−ln θ̃`.

### 6.7 Golden test (wajib di `CORE::nb_text`, NB, dan AM)
Data latih (hitungan kata, kosakata `[makan, nasi, saya, suka, tidak]`):
```
X = [[1,1,1,1,0],   y = pos
     [0,1,1,1,1],   y = neg
     [3,0,0,0,0]]   y = pos
```
`α = 1`, prior = proporsi kelas. Dokumen uji `"makan nasi enak"` → `x = [1,1,0,0,0]` (`enak` OOV). Kelas terurut `[neg, pos]`.

| Likelihood | `L` (baris neg; baris pos) | skor gabungan `[neg, pos]` | P(pos) |
|---|---|---|---|
| Multinomial | `[-2.197225,-1.504077,-1.504077,-1.504077,-1.504077]`; `[-0.875469,-1.791759,-1.791759,-1.791759,-2.484907]` | `[-4.799914, -3.072693]` | 0.849057 |
| Bernoulli | `[-1.098612,-0.405465,-0.405465,-0.405465,-0.405465]`; `[-0.287682,-0.693147,-0.693147,-0.693147,-1.386294]` | `[-5.898527, -3.060271]` | 0.944708 |
| Complement | `[0.875469,1.791759,1.791759,1.791759,2.484907]`; `[2.197225,1.504077,1.504077,1.504077,1.504077]` | `[2.667228, 3.701302]` | 0.737705 |

(Dihasilkan dengan scikit-learn 1.9.1; toleransi 1e-6.)
Gaussian min-std: atribut `x`, kelas A `[1,1,1]`, kelas B `[3,5]` → `precision = 2`, `min_var = 0.111111`; var A = 0.111111, var B = 1.0; log-likelihood A di `x=3` = **−17.820326** (dengan floor 1e-9 v1: −1999999990.557305).

---

## 7. Prosedur validasi jalur Raw Text (anti-leakage)

Untuk setiap evaluasi (holdout atau tiap fold):
1. `model_text = CORE::fit(docs_latih, cfg_text)`; `X_latih = transform(model_text, docs_latih)`; `X_uji = transform(model_text, docs_uji)`.
2. Latih likelihood Text di `X_latih`; skor `X_uji`.
3. Bila kosakata fold kosong (`EMPTY_VOCABULARY`) → error ramah pengguna `NB_E_TEXT_EMPTY_VOCAB_FOLD` (sebut nomor fold).
Model final: `fit` pada seluruh baris valid → resep diekspor (`text.recipe`). Jalur `vector` tidak melakukan fit (nilai dipakai apa adanya).

---

## 8. Export model schema 2.0

Bila V8 menuntut 2.0, struct export = struct 1.1 **ditambah**:
```jsonc
{
  "schema_version": "2.0",
  "model_type": "naive_bayes",
  // ... semua field 1.1 (target.class_counts wajib) ...
  "features": [
    { "name": "Umur", "role": "numerical", "likelihood": "gaussian_minstd",
      "mean": {"neg": 30.1, "pos": 28.4}, "variance": {"neg": 4.2, "pos": 0.11}, // SETELAH min-std & floor
      "min_variance": 0.111111 },                                               // null bila gaussian
    { "name": "Paslon", "role": "categorical", "likelihood": "categorical", /* field 1.1 */ }
  ],
  "text": null | {
    "source": "raw" | "vector",
    "likelihood": "multinomial" | "bernoulli" | "complement",
    "alpha": 1,
    "terms": ["makan", "nasi"],              // urutan indeks parameter; raw = recipe.vocabulary; vector = nama kolom
    "raw_variable": "Text Tweet" | null,     // wajib bila source = raw
    "columns": ["VEC_makan", "VEC_nasi"] | null, // wajib bila source = vector (sama dengan terms)
    "log_weights": { "neg": [..], "pos": [..] },        // L_ct
    "log_weights_absent": { "neg": [..], "pos": [..] } | null, // A_ct, hanya bernoulli
    "class_term_counts": { "neg": [..], "pos": [..] },  // N_ct (multinomial), n_ct (bernoulli), C_ct (complement)
    "uses_class_prior": true | false,                    // false hanya complement dengan K >= 2
    "recipe": TextVectorizerModel | null                 // wajib bila source = raw (CORE §3.4)
  }
}
```
Numeric `gaussian` di schema 2.0 tetap punya `"likelihood": "gaussian"`, `"min_variance": null`. `feature_order` hanya berisi fitur Numeric/Categorical (Text disimpan di blok `text`). Field 1.1 tidak berubah nama/arti.

---

## 9. Output NB v2

- Case Processing Summary: baris tambahan `Text features` = `Raw text: '{var}' ({V} terms)` atau `Word vectors: {n} columns`, `Text likelihood`, `Text alpha`; bila vector → baris catatan W-LEAK.
- Attribute Distribution Table v1: hanya Numeric/Categorical; kolom Numeric menambah keterangan likelihood bila `gaussian_minstd`.
- **Text Feature Table** (key komponen output baru `"Text Feature Table"`): per kelas, top-k baris `Rank | Term | Score | Log weight | Count`. Data lengkap (semua term × kelas) dibawa di `output_data` untuk aksi:
  - **Download CSV** nama default `Naive_Bayes_Text_Features.csv`, format panjang: `term,class,count,log_weight,probability,score` (`probability = exp(log_weight)`; untuk complement = `θ̃`, tulis `exp(−L)`), UTF-8 dengan BOM agar Excel membaca karakter Indonesia dengan benar.
  - **Copy (TSV)** format sama dengan tab; bila ukuran > 5 MB → toast `Tabel terlalu besar untuk disalin; gunakan Download CSV.`

---

## 10. Kontrak Apply Model v2

### 10.1 Pemuatan & validasi model
- `supportedSchemaVersions` adapter NB menjadi `["1.0", "1.1", "2.0"]`.
- Validasi 2.0 tambahan (kode baru di `AM/constants/apply-model-codes.ts`, ikuti konvensi penamaan & severity file tersebut):
  `AM_E_NB2_TEXT_SHAPE` (panjang `terms`, `log_weights[c]`, `class_term_counts[c]` tidak sama; `columns` ≠ panjang `terms`), `AM_E_NB2_TEXT_SOURCE` (`raw` tanpa `recipe`/`raw_variable`, atau `vector` tanpa `columns`), `AM_E_NB2_LIKELIHOOD` (nilai tak dikenal), `AM_E_NB2_COMPLEMENT_MIXED` (complement dengan fitur non-text).
- Ringkasan model menampilkan: sumber teks, likelihood, jumlah term, alpha.

### 10.2 Pemetaan
- Fitur Numeric/Categorical: aturan v1 (K4 tetap: wajib terpetakan).
- `text.source = "raw"`: field baru **Raw Text Variable** (hanya `STRING`), auto-map nama `raw_variable` (persis lalu case-insensitive unik). Wajib terisi → `AM_E_MAP_RAW_TEXT_UNMAPPED`; tipe salah → `AM_E_MAP_RAW_TEXT_TYPE`.
- `text.source = "vector"`: setiap `columns[i]` di-auto-map berdasarkan nama (persis lalu case-insensitive unik), **tanpa** tampilan per baris; UI menampilkan ringkasan `"{m} dari {V} kolom vektor ditemukan; {V−m} dianggap 0."` dengan daftar yang dapat dibuka. Kolom tidak ditemukan **tidak** memblokir (V10) dan dicatat sebagai info `AM_I_TEXT_ZERO_FILLED`. Kolom yang ditemukan tetapi bukan `NUMERIC` → `AM_E_MAP_NUMERIC_TYPE` (kode v1).

### 10.3 Payload AM v2 (tambahan)
```ts
type ApplyModelTextPayload =
  | null
  | { source: "raw"; values: (string | null)[] }
  | { source: "vector"; mapped_columns: number[] /* indeks ke model.text.columns */;
      values: (number | null)[][] /* [row][j] sejajar mapped_columns */ };
```

### 10.4 Scoring (Rust, `AM/rust` memakai `CORE`)
- Raw: `x = CORE::transform(model.text.recipe, docs)`; kontribusi §6.1–6.3 memakai `log_weights`/`log_weights_absent` dari model.
- Vector: kolom terpetakan → nilai (`null`/non-finite → 0, negatif → error baris `AM_E_TEXT_NEGATIVE`), kolom tidak terpetakan → 0.
- K5 (V11): teks dianggap missing bila raw `null`/kosong/whitespace, atau (vector) semua kolom terpetakan bernilai `null`. Kolom yang diisi 0 karena tidak terpetakan tidak dihitung sebagai "ada nilai".
- Fungsi skor Text **wajib** memanggil `CORE::nb_text` (P-V2). Golden §6.7 wajib diuji di crate AM.
- Ringkasan output menambah baris: `Text source`, `Text likelihood`, `Text features zero-filled: {n}` (vector), `Rows with empty text: {n}` (raw).

---

## 11. Kode error/peringatan NB baru

`NB_E_TEXT_NEGATIVE`, `NB_E_TEXT_EMPTY_VOCAB_FOLD`, `NB_E_TEXT_EMPTY_VOCAB` (model final), `NB_E_COMPLEMENT_MIXED`, `NB_E_TEXT_CONFIG` (meneruskan `INVALID_CONFIG`/`INVALID_REGEX`/`INVALID_STOPWORDS` dari `CORE` dengan pesan aslinya). Semua dipetakan ke pesan ramah pengguna di `NB/services/naive-bayes-error-messages.ts` (pola v1: string matching pada prefiks kode).

---

## 12. Larangan v2

- Jangan mengubah ekspektasi test v1 yang ada. Bila sebuah test v1 gagal, perbaiki kode, bukan test-nya (kecuali test itu menguji tipe yang memang diperluas — catat di laporan dan minta persetujuan pemilik).
- Jangan menyalin kode tokenizer/stemmer/vectorizer/likelihood Text ke NB atau AM — gunakan `CORE`.
- Jangan mengubah `STWV/` di Tahap 2 kecuali impor read-only `OptionsTab.tsx` dan `config.ts`.
- Jangan mengubah komponen bersama (`VariableListManager`, `ui/*`, store global) — fitur filter/Select All dibuat di `NB/components/dataset-variable-list.tsx`.
- File di luar `NB/`, `AM/`, `CORE/` hanya boleh diubah di fase Integrasi (PLAN_V2 Fase I1) dan hanya file yang tercantum di sana.
