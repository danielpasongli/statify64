# Laporan Fase B — Build WASM & uji manual
## Status: MENUNGGU PEMILIK (fase ini dikerjakan pemilik; agent tidak membangun WASM dan tidak menjalankan uji manual)

Fase B menurut PLAN_V3_UI_EN §5 adalah fase **PEMILIK** (G4). Aturan keras agent melarang `wasm-pack` dan menyalin build ke
`wasm-output/` / `public/workers/*/pkg/`, serta uji manual butuh browser dengan WASM baru. Karena itu berkas ini berisi
**perintah build, checklist uji manual PLAN §5, dan hasil pemeriksaan statis**. Kolom hasil dikosongkan untuk diisi pemilik
(Fase V membaca berkas ini sebagai prasyarat). Tidak ada berkas kode yang diubah oleh agent pada fase ini.

## Ringkasan perubahan
1. Tidak ada perubahan kode. Satu-satunya berkas yang dibuat: laporan ini.
2. Prasyarat terpenuhi: laporan S1, C1, R1, R2, T1, T2, I1, I2, X1 ada; X1 melaporkan versi cache `...-v3-20261005a` sudah dinaikkan.
3. Pemeriksaan statis ketiga hal yang diminta pemilik (lihat bagian "Pemeriksaan statis") lulus di sumber.
4. Temuan penting: `wasm_bg.wasm` NB dan AM di `public/workers/Classify/*/pkg/` bertanggal 2026-10-05 07:18, **lebih lama** daripada perubahan Rust R1/R2 (laporan 09:17–09:18). Artinya build yang terpasang saat ini masih berisi pesan lama; build ulang memang wajib.
5. `temp/_c1_core.tgz` (35 KB) masih ada; dihapus manual oleh pemilik (lihat checklist).

## File diubah / dibuat (path lengkap)
- `frontend/components/Modals/Analyze/Classify/naive-bayes/plan-reports-v3/B.md` (dibuat)

## Tabel teks lama → baru
Tidak berlaku (tidak ada teks yang diubah).

## Test
Tidak ada yang dijalankan agent pada fase ini. Hasil test otomatis sebelumnya (dari X1, dilaporkan pemilik): cargo CORE/NB/AM hijau,
`cargo check wasm32` NB & AM sukses, `tsc` = 43 error (baseline), jest 826/830 lalu 4 ekspektasi teks diperbaiki (harapan 830/830, belum dijalankan ulang).

## Pemeriksaan statis (sumber, bukan hasil runtime)
| Hal yang diminta | Lokasi di sumber | Teks di sumber | Catatan |
|---|---|---|---|
| Pesan CORE "vocabulary kosong" English | `frontend/rust-crates/statify-text-core/src/vectorizer.rs:132,143` | `The vocabulary is empty after text preprocessing. Try using fewer stopwords or changing the stemming setting.` / `The vocabulary is empty after applying the minimum term frequency. Try lowering the minimum term frequency.` | STWV: `formatStwvError.ts` menaruh kode di akhir `(EMPTY_VOCABULARY)`. Pesan ini baru tampil setelah WASM **STWV** dibangun ulang. |
| Catatan min-std Rust di Attribute Distribution | `naive-bayes/rust/src/stats/attribute_distribution.rs:266` | `Gaussian with a minimum standard deviation floor (Weka-style); minimum variance = {v}` | Baru tampil setelah WASM **NB** dibangun ulang. |
| Baris AM `Word-Vector Columns` | `apply-model/services/apply-model-formatter.ts:57-59`, kalimat di `apply-model-interpretation.ts:106-110` | `{m} of {V} vector columns found; {V−m} treated as 0.` | Murni TS (tidak butuh WASM), tampil untuk model berbasis vektor. |

## Pemenuhan "Kriteria selesai"
- [ ] WASM STWV, NB, AM dibangun ulang — **tugas pemilik** (perintah di bawah).
- [ ] Hard refresh dilakukan — tugas pemilik.
- [ ] Checklist uji manual di bawah terisi semua — tugas pemilik.
- [ ] `temp/_c1_core.tgz` dihapus — tugas pemilik (manual).

## Checklist uji manual PLAN §5 (isi hasil: OK / GAGAL + catatan)
Semua teks yang terlihat pengguna harus English; kode galat ada di AKHIR kalimat dalam kurung.

### 1. Setiap tab berbahasa English
| Menu | Tab / area | Hasil |
|---|---|---|
| STWV | Variables, Options (semua grup), tombol OK/Reset/Cancel, toast sukses `{n} vector columns were added to the dataset.` | |
| NB | Variables, Text Preprocessing, Options, Validation, Output, panel kiri, toast | |
| AM | Model, Variables, Save, Output, Help, loader, toast | |

### 2. Setiap item Output Viewer punya Description (HTML English, tidak ada `undefined`/`NaN`, bisa diedit lewat Edit)
| Menu | Item | Hasil |
|---|---|---|
| STWV | Ringkasan (Executed), Processing Summary, Settings, Vocabulary | |
| NB | Case Processing Summary, Attribute Distribution Table, Model Evaluation Metrics, Cohen's Kappa, Confusion Matrix, Text Feature Table, Export Model | |
| AM | Model Summary, Case Processing Summary, Prediction Distribution, Saved Variables, Evaluation Metrics / Kappa / Confusion Matrix (bila berlabel) | |

### 3. Galat utama: pesan English, kode di akhir
| Pemicu | Teks yang diharapkan (awal kalimat) | Kode di akhir | Hasil |
|---|---|---|---|
| NB: kolom vektor bernilai negatif | `Text vector column '<nama>' contains negative values...` | `(NB_E_TEXT_NEGATIVE)` | |
| NB: Complement + prediktor numerik/kategorik | `Complement Naive Bayes can only be used when the model contains Text Features only...` | `(NB_E_COMPLEMENT_MIXED)` | |
| NB: kosakata fold kosong (preprocessing terlalu ketat + k-fold) | `No words are left in the training data of fold {n} after text preprocessing...` | `(NB_E_TEXT_EMPTY_VOCAB_FOLD)` | |
| STWV: kosakata kosong (mis. semua kata terbuang oleh stopword / min term frequency) | `The vocabulary is empty after ...` (pesan CORE English) | `(EMPTY_VOCABULARY)` | |
| AM: fitur model tak terpetakan | `Feature "<nama>" is not mapped to a dataset variable.` | `(AM_E_MAP_UNMAPPED)` | |

### 4. Tiga hal yang paling perlu dicek (permintaan pemilik)
- [ ] Pesan STWV "vocabulary kosong" dan pesan CORE sudah English (parser TS meneruskan apa adanya, kode di akhir).
- [ ] Catatan min-std dari Rust (`Gaussian with a minimum standard deviation floor ...`) tampil di note **Attribute Distribution** (jalankan NB dengan prediktor numerik; bila yang tampil teks lama/Indonesia, WASM NB belum terganti).
- [ ] Baris AM `Word-Vector Columns` berbunyi `m of V vector columns found; V−m treated as 0.` (mis. `3 of 5 vector columns found; 2 treated as 0.`).

## KEPUTUSAN TERBUKA / risiko
1. Dua deskripsi kebijakan di `naive-bayes/rust/src/stats/save.rs:53,58` masih Indonesia karena masuk JSON export (snapshot v1). Tampil hanya di berkas export. Perlu keputusan pemilik (dari X1, butir 1).
2. Label S1 yang masih terbuka (tombol "Target Variable:" di STWV VariablesTab, toast n=1 bentuk tunggal, ambang 10% dokumen vektor nol) belum diputuskan.
3. Jest ketiga modul belum terbukti 830/830 setelah perbaikan 4 ekspektasi teks (X1 putaran 2); jalankan sebelum Fase V.
4. Bila setelah hard refresh teks Rust masih lama: cek (a) berkas `pkg` benar-benar tertimpa (tanggal `wasm_bg.wasm` baru), (b) DevTools → Network: `wasm_bg.wasm?v=...-v3-20261005a` termuat, (c) matikan cache / Disable cache saat DevTools terbuka. STWV tidak memakai `?v=`, jadi periksa `wasm-output/statify_string_to_word_bg.wasm` bertanggal baru.

## Perintah untuk pemilik (PowerShell; jalankan dari root repo `statify64`)
```powershell
# 1) STWV -> hasil langsung ke wasm-output/ (sama dengan blok STWV di build-wasm.sh)
cd frontend\components\Modals\Transform\StringToWordVector\rust
wasm-pack build --target web --out-dir ..\wasm-output --release
cd ..\..\..\..\..\..

# 2) NB -> salin 4 berkas pkg (jangan salin pkg\.gitignore / package.json)
cd frontend\components\Modals\Analyze\Classify\naive-bayes\rust
wasm-pack build --target web --release
cd ..\..\..\..\..\..\..
$src = "frontend\components\Modals\Analyze\Classify\naive-bayes\rust\pkg"
$dst = "frontend\public\workers\Classify\NaiveBayes\pkg"
Copy-Item -Force "$src\wasm.js","$src\wasm_bg.wasm","$src\wasm.d.ts","$src\wasm_bg.wasm.d.ts" $dst

# 3) AM -> sama
cd frontend\components\Modals\Analyze\Classify\apply-model\rust
wasm-pack build --target web --release
cd ..\..\..\..\..\..\..
$src = "frontend\components\Modals\Analyze\Classify\apply-model\rust\pkg"
$dst = "frontend\public\workers\Classify\ApplyModel\pkg"
Copy-Item -Force "$src\wasm.js","$src\wasm_bg.wasm","$src\wasm.d.ts","$src\wasm_bg.wasm.d.ts" $dst

# 4) Hapus berkas sementara dari fase C1 (manual)
Remove-Item temp\_c1_core.tgz

# 5) Jalankan ulang jest ketiga modul (harapan 830/830)
cd frontend
npx jest components/Modals/Analyze/Classify/naive-bayes components/Modals/Analyze/Classify/apply-model components/Modals/Transform/StringToWordVector --coverage=false

# 6) Restart dev server bila perlu, lalu hard refresh browser: Ctrl+Shift+R
```
