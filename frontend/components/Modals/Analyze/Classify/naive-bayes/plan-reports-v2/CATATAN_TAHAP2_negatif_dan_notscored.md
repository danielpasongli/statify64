# Catatan untuk agent Tahap 2 — nilai negatif Text & baris "NotScored"

Asal: keputusan pemilik setelah Fase N2 (butir 2 dan 3). Dokumen ini BUKAN bagian PLAN_V2/AGENTS_V2; ia
menambah rincian untuk fase N1, N3a, N3b, A2, A3 dan melengkapi (tanpa menggantinya) AGENTS_V2 §5.2, §10.3–10.4.
Bila ada konflik, AGENTS_V2 tetap yang berlaku dan tandai sebagai KEPUTUSAN TERBUKA di laporan.

## 1. Nilai negatif pada fitur Text: tetap DITOLAK, pesan WAJIB menyebut nama kolom

### Latar belakang (mengapa bisa negatif)
Keluaran STWV dan `CORE::transform` (jalur Raw Text) selalu ≥ 0. Nilai negatif hanya mungkin di jalur **Word-Vector**,
karena slot itu menerima variabel NUMERIC apa pun, misalnya: kolom yang sudah distandarisasi (z-score), hasil
PCA/SVD, embedding kata, skor sentimen −1..1, kode missing angka (−1, −999), kolom yang ikut terpilih lewat
"Select All (filtered)" secara tidak sengaja, atau (di Apply Model) dataset baru yang kolomnya bernama sama
tetapi sudah diproses dengan cara lain. Pada Multinomial/Complement total hitungan negatif membuat `θ ≤ 0` sehingga
`ln` tidak terdefinisi (hasil diam-diam salah); karena itu semua likelihood Text menolaknya secara seragam.

### Aturan (berlaku untuk N1 dan A2; CORE `nb_text` tidak memvalidasi)
1. Validasi dilakukan SEBELUM memanggil `CORE::nb_text::train`/`score_rows`.
2. Pesan error **wajib menyebut nama kolom pertama yang bernilai negatif**, dan sebaiknya jumlah kolom bermasalah:
   - NB (kode `NB_E_TEXT_NEGATIVE`): `NB_E_TEXT_NEGATIVE: Kolom vektor teks '{kolom}' berisi nilai negatif (total {n} kolom bermasalah). Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0. Periksa apakah kolom ini bukan vektor kata (mis. hasil standardisasi/PCA atau kode missing seperti -1) lalu keluarkan dari Word-Vector Variables.`
   - AM (kode `AM_E_TEXT_NEGATIVE`): pesan serupa, memakai nama kolom model (`model.text.columns[i]`) dan, bila tersedia, nama kolom dataset yang terpetakan; awali dengan kode (pola v1).
   Pesan lama di AGENTS_V2 §5.2 ("Kolom vektor teks berisi nilai negatif; ...") dianggap diperluas, bukan diganti: kalimat intinya tetap ada.
3. Nilai `null`/non-finite tetap menjadi 0 (bukan negatif). Pecahan (mis. TF-IDF) diperbolehkan.
4. `NB/services/naive-bayes-error-messages.ts` (N5) memetakan prefiks kode ke pesan ramah dan **meneruskan nama kolom** dari pesan Rust (jangan membuangnya).
5. Test wajib: (a) satu kolom negatif → error memuat nama kolomnya; (b) beberapa kolom negatif → nama kolom pertama + jumlah; (c) tidak ada negatif → tidak error; (d) di AM, kolom yang tidak terpetakan (zero-filled) tidak diperiksa.

## 2. Baris "NotScored" (V11) ditentukan oleh A2 dan N3a, BUKAN oleh CORE

`CORE::nb_text::score_rows` tidak tahu konsep "baris missing": ia selalu mengembalikan kontribusi untuk setiap baris
(Multinomial/Complement: baris nol → 0; Bernoulli: baris nol → Σ_t A_ct, yang informatif). Karena itu:

1. **Penentuan baris NotScored dilakukan di pemanggil**, sesuai AGENTS_V2 V11/§10.4: teks mentah kosong/null/whitespace dihitung prediktor missing;
   baris yang SEMUA prediktornya missing tidak diprediksi (NotScored); bila masih ada prediktor lain (Numeric/Categorical), teks kosong = vektor nol dan baris tetap diskor.
   Jalur vector: teks dianggap missing bila semua kolom terpetakan bernilai `null`; kolom yang diisi 0 karena tidak terpetakan tidak dihitung sebagai "ada nilai".
2. **Ini bukan inkonsistensi:** dua perilaku berbeda yang tampak di CORE sengaja ada — (a) Multinomial/Complement dengan baris nol menghasilkan skor = prior saja (atau nol untuk Complement tanpa prior), (b) Bernoulli dengan baris nol tetap menghasilkan `Σ A_ct`. Pemanggil TIDAK boleh menyeragamkan keduanya dan TIDAK boleh menambahkan filter "baris nol" ke CORE.
3. **Complement tanpa prior:** model hanya-Text Complement dengan baris kosong dan tanpa prediktor lain → baris itu NotScored (tidak ada informasi); jangan menampilkan skor 0 sebagai prediksi.
4. **A2 wajib menuliskan aturan ini eksplisit** (komentar kode + bagian di `AM/rust` yang relevan) dan menyertakan test: raw kosong + prediktor lain → diprediksi; raw kosong tanpa prediktor lain → NotScored; vector semua kolom terpetakan null → missing; vector semua kolom tidak terpetakan → missing (bukan sekadar nol).
5. **N3a** memakai aturan yang sama untuk evaluasi (holdout/k-fold) agar skor NB = skor AM (P-V3); ringkasan Case Processing Summary menghitung baris yang dibuang karena target missing terpisah dari baris NotScored karena prediktor missing.
