# Laporan N5-fix — perbaikan Fase N5 berdasarkan REVIEW-G1 (N5-1, N5-2, N5-4, N5-5, N5-7)

## Status: SELESAI dan DIKONFIRMASI pemilik (putaran 1-4; N5 ditutup)
Jest asli dijalankan pemilik di Windows (`cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes/hooks --coverage=false`): **4 suite, 77 test: 76 lulus, 1 gagal**. Satu-satunya yang gagal adalah test v1 pra-eksisting `useNaiveBayesValidation › form kosong (default) -> isValid=false dengan pesan target & predictor` (menerima `["Pilih variabel target."]`; lihat N5-8 di REVIEW-G1 dan N5.md KEPUTUSAN TERBUKA 9). Test itu tidak diubah.

Catatan: sesi agent sendiri tidak bisa menjalankan jest (binding native Linux tidak ada, npm 403); verifikasi agent hanya `tsc` terbatas (0 error) dan shim jest (29 lulus).

## Ringkasan perubahan
1. **N5-1 (High)** `naive-bayes-error-messages.ts`: `NB_E_TEXT_NEGATIVE` mengekstrak nama kolom (`/'([^']+)'/`) dan jumlah (`/total (\d+) kolom/`), lalu menyusun pesan ramah: "Kolom vektor teks '{kolom}' berisi nilai negatif (total {n} kolom bermasalah). ... keluarkan dari Word-Vector Variables." Tanpa jumlah: nama kolom saja. Ekstraksi nama gagal: pesan umum lama.
2. **N5-2 (High)** `naive-bayes-analysis.ts`: field baru `rawTextValues?: ReadonlyArray<unknown>` pada `NaiveBayesAnalysisPayload`, diteruskan ke `buildNaiveBayesTextPayload(main, textSlices, rowCount, rawTextValues?)`. Jalur raw memakai `String(v)` (null/undefined/"" -> null) tanpa parseFloat dan tidak membaca `getSlicedData`. Jalur ekor `dataVariables` hanya untuk vector. Komentar kode menegaskan bahwa container (N7) wajib mengisi `rawTextValues` dari `useDataStore.data[row][columnIndex]`.
3. **N5-4** `buildNaiveBayesWorkerConfig`: `main.TextSource = getEffectiveTextSource(main)`.
4. **N5-5** regex fold: `/fold[\s_]*(?:ke)?[\s\-#:_]*(\d+)/i` menerima "fold 3", "fold ke-3", "fold ke 3", "fold #3".
5. **N5-7** fungsi murni baru `splitNaiveBayesDataVariables(dataVariables, main, variables)` (diekspor) mengembalikan `{targetNames, predictorNames, textNames, targetSlices, predictorSlices, textSlices, rowCount}`; `analyzeNaiveBayes` memakainya.
6. Komentar `getTextColumnNames` di `useNaiveBayesValidation.ts` diperbarui (raw tidak lewat `dataVariables`); tidak ada perubahan logika di file itu.

## Tambahan putaran 2 (butir 3 dan 4, disetujui pemilik)
- **N5-6:** builder raw mengubah teks berisi spasi saja (spasi/tab/newline) menjadi `null`; teks bermakna dikirim apa adanya (tidak di-trim). Rust (N3a/A2) tetap wajib men-trim (pertahanan ganda).
- **Kode galat baru `NB_E_TEXT_RAW_MISSING`:** dilempar `buildNaiveBayesTextPayload` bila raw tanpa `rawTextValues`; dipetakan di `naive-bayes-error-messages.ts` ke pesan ramah ("Data teks mentah untuk Raw Text Variable tidak tersedia ...").
- Test baru di `naiveBayesPayload.test.ts`: spasi-saja -> null dan tidak di-trim; pemetaan `NB_E_TEXT_RAW_MISSING`. Verifikasi agent: tsc terbatas 0 error, shim 31 lulus. **Jest asli putaran 2 belum dijalankan pemilik** (ekspektasi: 78 test, 77 lulus, 1 gagal pra-eksisting).
- Butir 3 dan 4 pada "Pembahasan yang masih terbuka" di bawah kini SELESAI.

## Putaran 3 (tugas kecil N5-1, N5-4, N5-6 sesuai "Keputusan pemilik" N1N2-fix.md butir 2)
Ketiga butir sudah terkode dari putaran 1-2; putaran ini menyelaraskan dengan format Rust asli dan menambah test.
- **Cek format Rust** (`rust/src/models/data.rs::text_negative_message`): `NB_E_TEXT_NEGATIVE: Kolom vektor teks '{kolom}' berisi nilai negatif (total {n} kolom bermasalah). Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0. Periksa ...`. Varian satu kolom memakai bentuk yang sama (n = 1). Regex `/'([^'"'"']+)'/` dan `/total (\d+) kolom/` cocok.
- **N5-1:** kalimat inti pada pesan ramah (dan fallback) diubah dari "... Complement Naive Bayes memerlukan nilai ≥ 0" menjadi "**Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0**" agar persis kalimat inti AGENTS_V2 §5.2. Tidak ada test lama yang menegaskan teks lama. Input test lama di `naiveBayesPayload.test.ts` (pesan negatif satu kolom dan beberapa kolom) diperkuat ke pesan Rust asli lengkap (ekspektasi tetap, hanya input diperpanjang). File test baru `services/__tests__/naive-bayes-error-messages.test.ts` (5 test): (a) satu kolom, (b) beberapa kolom (nama pertama + jumlah), nama kolom bersepasi/angka, nama kolom berisi kata "fold"/"predictor"/"target" tidak tertangkap pesan v1, (c) fallback untuk format tak dikenal tanpa melempar galat.
- **N5-4:** `main.TextSource = getEffectiveTextSource(main)` sudah ada di `buildNaiveBayesWorkerConfig` (test config sudah ada). Test baru untuk payload: tersimpan "raw" + slot kosong -> `none`; tersimpan "raw" + slot vector -> `vector`; tersimpan "vector" + slot kosong -> `none`.
- **N5-6:** normalisasi whitespace -> `null` sudah ada; test baru dengan nilai persis permintaan: `"   "`, `"\t\n"` -> null; `"  halo  "` dan `"3 kucing lucu"` utuh. Cara baca data (`getSlicedData`/`parseCellValue`) tidak diubah.
- **Catatan lingkup:** prompt putaran ini meminta N5-2, N5-5, N5-7 TIDAK dikerjakan, tetapi ketiganya sudah dikerjakan dan dikonfirmasi pemilik pada putaran 1 (jest 76/77 hijau). Tidak saya batalkan (membatalkan berarti mengubah/menghapus test yang sudah hijau). Mohon konfirmasi pemilik bila ingin dicabut; N7 tetap bertanggung jawab mengisi `rawTextValues`.
- **Hasil:** `tsc` terbatas (file N5, 5 file test termasuk yang baru) **0 error**; shim jest untuk `naiveBayesPayload.test.ts` + test error-messages baru: **38 lulus, 0 gagal**. Jest asli putaran 3 **belum dijalankan** (VM agent tidak bisa). `tsc` penuh tidak dijalankan (terlalu lama di mount ini); error pra-eksisting N5-3 (`naive-bayes-main.tsx`, `options.test.tsx`) milik N7 tidak disentuh. Test v1 "form kosong" (N5-8) tetap gagal, tidak diubah.
- **Perintah pemilik:** `cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes --coverage=false` (ekspektasi: test hooks 78+ lulus dengan 1 gagal pra-eksisting, ditambah suite `naive-bayes-error-messages` 5 lulus), lalu `cd .. && npx tsc --noEmit -p frontend`.

## Hasil pemilik setelah putaran 3 (2026-10-04) — DIKONFIRMASI
- **Jest** (`cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes --coverage=false`): 7 suite, **98 test: 96 lulus, 2 gagal**. Semua test N5 hijau (`naiveBayesPayload` termasuk test N5-4/N5-6/NEGATIVE, `naive-bayes-error-messages` 5 lulus, `useNaiveBayesV2`, `useNaiveBayesTextRules`, `export-model-action`). Dua kegagalan, keduanya **pra-eksisting dan bukan regresi N5**:
  1. `useNaiveBayesValidation.test.ts` "form kosong (default) -> ... target & predictor" (N5-8, v1; butuh keputusan #6 di bawah).
  2. `components/__tests__/options.test.tsx` "shows error for value > 999": `getByText(/maksimum 999/i)` menemukan DUA elemen (teks bantuan "...maksimum 999." dan pesan galat "Smoothing Alpha maksimum 999"). Milik N7; sudah dicatat pra-eksisting di `apply-model/PLAN.md:430` (Fase 18) dan REVIEW-G1 N5-8. Perbaikan yang wajar ada di test (pakai `getAllByText`/pesan yang lebih spesifik) atau teks bantuan; keduanya di luar file milik N5, jadi tidak disentuh.
- **`npx tsc --noEmit -p frontend`:** 46 error di 20 file, **identik** dengan hasil sebelum putaran 2-3. Tidak ada error di file milik N5 (types, default, hooks, services, test-nya, termasuk file test baru). Satu-satunya error naive-bayes: 3 error N5-3 milik N7 (`options.test.tsx:6`, `naive-bayes-main.tsx:31` dan `:96`). 43 sisanya di modul lain (Bartlett, Crosstabs, Explore, Frequencies, GLM, ImportCsv/Excel, ChartBuilder, stores, dst.) dan tidak terkait.

## Keputusan yang masih terbuka / pekerjaan yang sudah disetujui tetapi belum dikerjakan
1. **N5-8 (disetujui pemilik, N1N2-fix.md butir 6):** pesan "predictor" saat target kosong. Usulan perubahan minimal di `useNaiveBayesValidation.ts`: bila `TargetVar` kosong dan mode `exclude`, anggap pemeriksaan predictor belum terpenuhi (tambahkan pesan predictor) karena predictor efektif belum bermakna tanpa target; `getEffectivePredictors` TIDAK diubah (test v1-nya tetap hijau); hanya memengaruhi pesan saat form sudah tidak valid. Ekspektasi test v1 tidak berubah.
2. **`options.test.tsx` "value > 999"** (N7): pilih salah satu: ubah selector test, atau bedakan teks bantuan. Rekomendasi: ubah selector test saat N7 menyentuh file itu (perubahan test pra-eksisting perlu persetujuan pemilik).
3. **N5-3 (N7):** `cloneNaiveBayesDefault` + load IndexedDB via `mergeWithDefaults` + `text`; literal Options di `options.test.tsx` diberi 4 field v2. Tidak ada keputusan baru.
4. **Konfirmasi pencabutan lingkup:** N5-2/N5-5/N5-7 dikerjakan lebih awal dan dibiarkan; tidak ada tindakan kecuali pemilik ingin mencabutnya.

## Putaran 4: N5-8 (keputusan #6 N1N2-fix.md, disetujui pemilik)
- **Kode:** `hooks/useNaiveBayesValidation.ts`: bila `TargetVar` kosong dan mode `exclude`, pesan predictor ditambahkan selama Text Features kosong (`predictorBelumBermakna`). `getEffectivePredictors` tidak diubah. Tidak ada perubahan ekspektasi test v1; test v1 "form kosong" kini seharusnya hijau.
- **Test baru** (`useNaiveBayesV2.test.ts`, 3 test): target kosong tanpa Text -> pesan target DAN predictor; target kosong + Text Features terisi -> hanya pesan target; target kosong pada mode candidates dengan kandidat terisi -> hanya pesan target.
- **Verifikasi agent:** `tsc` terbatas 0 error; hook dijalankan langsung dengan `useMemo` di-stub: form kosong -> 2 pesan (target + predictor); target kosong + vector -> hanya target; candidates terisi -> hanya target; target terisi tanpa exclude -> valid; semua predictor di-exclude -> pesan predictor. Jest asli belum dijalankan untuk putaran ini.
- **Ekspektasi pemilik:** `npx jest components/Modals/Analyze/Classify/naive-bayes --coverage=false` -> 101 test, 100 lulus, 1 gagal (`options.test.tsx` "value > 999", milik N7, pra-eksisting).
- Keputusan terbuka #1 di atas kini SELESAI. Butir N7 (options.test "> 999" selector, N5-3, `rawTextValues`) sengaja tidak dikerjakan: di luar file milik N5.

## Hasil pemilik setelah putaran 4 (2026-10-04) — DIKONFIRMASI, N5 DITUTUP
- **Jest** (`cd frontend && npx jest components/Modals/Analyze/Classify/naive-bayes --coverage=false`): 7 suite, **101 test: 100 lulus, 1 gagal**. Test v1 "form kosong" kini **hijau** (N5-8 selesai); 3 test N5-8 baru hijau. Satu-satunya kegagalan: `options.test.tsx` "shows error for value > 999" (milik N7, pra-eksisting, `getByText(/maksimum 999/i)` menemukan teks bantuan dan pesan galat sekaligus).
- `tsc` penuh tidak diulang setelah putaran 4 (perubahan hanya satu cabang kondisi di `useNaiveBayesValidation.ts`; `tsc` terbatas 0 error). Hasil penuh terakhir: 46 error/20 file, tanpa error di file N5.
- **Tidak ada keputusan terbuka tersisa untuk N5.** Seluruh temuan REVIEW-G1 bagian N5 yang berstatus tugas N5 sudah ditutup: N5-1, N5-2 (sisi N5; sisi container = N7), N5-4, N5-5 (regex; format pesan Rust = N3b), N5-6 (sisi TS; sisi Rust = A2/N3a), N5-7, N5-8. N5-3 milik N7.
- **Yang tersisa untuk fase lain (bukan N5):** N7: isi `rawTextValues`, `mergeWithDefaults`/`text` di container, 3 error `tsc` N5-3, selector test `options.test.tsx` "> 999" (perlu persetujuan pemilik karena mengubah test lama; sudah direkomendasikan `getAllByText`/selector spesifik). N3b: format `NB_E_TEXT_EMPTY_VOCAB_FOLD: fold {n} ...` + satu test dengan pesan Rust asli. N3a/A2: trim whitespace sisi Rust, NotScored. I1: worker meneruskan `text`, bump `NAIVE_BAYES_WASM_VERSION`. Jangan rilis Gelombang 1 sendirian sebelum N7.

## Keputusan yang saya ambil (mohon dikonfirmasi)
- **Raw tanpa `rawTextValues` melempar galat** ("rawTextValues wajib diisi ...") alih-alih mengirim teks kosong/terpotong. Konsekuensi: analisis jalur Raw Text akan gagal keras sampai N7 mengisi `rawTextValues`. Itu disengaja agar tidak ada data rusak diam-diam. Pesan ini akan tampil sebagai pesan generik di toast karena tidak punya kode `NB_E_*`.
- **Kontrak `dataVariables` berubah untuk raw:** kolom Raw Text TIDAK lagi di ekor `dataVariables`. N7 menyusun `[target, ...getEffectivePredictors]` (+ `getTextColumnNames` hanya untuk vector).
- `textNames` pada hasil pemisah kosong untuk raw (bukan `[RawTextVar]`).
- Panjang `values` raw mengikuti `rowCount` (dari kolom target); teks lebih panjang dipotong, lebih pendek diisi null.

## File diubah (relatif root repo, CRLF dipertahankan)
- `frontend/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-error-messages.ts`
- `frontend/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis.ts`
- `frontend/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation.ts` (komentar saja)
- `frontend/components/Modals/Analyze/Classify/naive-bayes/hooks/__tests__/naiveBayesPayload.test.ts`
- Dibuat: `.../plan-reports-v2/N5-fix.md`. Test v1 tidak disentuh.

## Test yang ditambah/diubah (`naiveBayesPayload.test.ts`)
- Raw: test lama diubah memakai `rawTextValues`; baru: "3 kucing lucu" dan "2024 pilkada seru" tetap utuh; slice `getSlicedData` basi diabaikan; tanpa `rawTextValues` melempar galat.
- Config: TextSource basi (raw->none, none->vector, vector->raw) diganti nilai efektif.
- Error NEGATIVE: input diganti pesan Rust asli; (a) satu kolom, (b) beberapa kolom (nama pertama + jumlah), (c) tanpa nama kolom tidak crash, plus tanpa jumlah.
- Fold: `it.each` untuk "fold 3", "fold ke-3", "Fold #3", "fold ke 12"; tanpa nomor tidak crash.
- `splitNaiveBayesDataVariables`: urutan `[target, ...predictor, ...text]`, tanpa target, tanpa predictor, raw (ekor diabaikan), `dataVariables` bukan array.

## Hasil
- **Jest (pemilik, 2026-10-04):** 76 lulus / 1 gagal (pra-eksisting, v1). Rincian per suite: `useNaiveBayesV2` 21 lulus, `useNaiveBayesTextRules` 11 lulus, `naiveBayesPayload` 29 lulus (13 sebelumnya + 16 baru), `useNaiveBayesValidation` 15 lulus + 1 gagal pra-eksisting.
- `tsc` terbatas oleh agent (file N5 + test): 0 error.
- `npx tsc --noEmit -p frontend` penuh: belum dijalankan ulang setelah perbaikan ini (hasil sebelumnya: 46 error di 20 file, hanya 3 terkait G1 dan semuanya milik N7).

## Pembahasan yang masih terbuka (butuh keputusan pemilik)
1. **Test v1 "form kosong"** (N5-8): ubah test, tambah pesan "predictor" saat target kosong, atau biarkan merah. Rekomendasi: biarkan sampai akhir v2, lalu putuskan satu kali; jangan dicampur ke fase v2.
2. **Raw tanpa `rawTextValues` = galat keras** (keputusan agent). Rekomendasi: pertahankan; N7 wajib mengisi dan menambah test container "3 kucing lucu".
3. ~~(SELESAI putaran 2)~~ **N5-6 teks spasi saja**: normalkan di builder (`trim() === ""` -> null) atau serahkan ke Rust (N3a/A2). Rekomendasi: normalkan di builder DAN pastikan Rust men-trim (pertahanan ganda; V11 menyebut whitespace = missing). Perubahan kecil pada file N5.
4. ~~(SELESAI putaran 2)~~ **Pesan galat raw tanpa `rawTextValues`** belum punya kode `NB_E_*`, jadi toast menampilkan pesan generik. Rekomendasi: beri kode (mis. `NB_E_TEXT_RAW_MISSING`) dan petakan di `naive-bayes-error-messages.ts` bila ingin pesan jelas.
5. **Format pesan fold dari Rust (N3b)**: samakan dengan `NB_E_TEXT_EMPTY_VOCAB_FOLD: fold {n} ...` dan tambah satu test dengan pesan Rust asli setelah N3b ada.

## Catatan untuk fase berikutnya
- **N7:** isi `rawTextValues` dari `useDataStore.data[row][columnIndex]` (urutan baris sama dengan kolom target; baris target-missing TIDAK dibuang di TS, Rust yang membuang); `slicedData` = `[target, ...getEffectivePredictors]` untuk raw, ditambah `getTextColumnNames` hanya untuk vector; perbaiki 3 error tsc (N5-3: `naive-bayes-main.tsx`, `options.test.tsx`) dengan `mergeWithDefaults`/`cloneNaiveBayesDefault` + `text`.
- **I1 (worker):** teruskan `text` dari `e.data` ke konstruktor `NaiveBayesAnalysis(..., text)`; bump `NAIVE_BAYES_WASM_VERSION`.
- **N3a:** percabangan sumber Text sebaiknya memakai `text.source` dari payload; `config.main.TextSource` kini sudah selalu efektif sehingga aman bila tetap dibaca.
- **A2:** pesan negatif AM (`AM_E_TEXT_NEGATIVE`) perlu pemetaan serupa di sisi Apply Model (nama kolom model + kolom dataset).
- **Gelombang 1 jangan dirilis sendiri** sampai N7 selesai (repo gagal type-check).

## Sisa risiko
- Test v1 "form kosong" tetap gagal (pra-eksisting, tidak diubah).
- N7 harus mengisi `rawTextValues` (dan menyesuaikan `slicedData`); selama belum, jalur Raw Text melempar galat.
- N5-6 (teks spasi saja) tidak ditangani; builder mengirim spasi apa adanya, bergantung N3a/A2 men-trim.
- Nama kolom yang mengandung tanda petik tunggal memotong ekstraksi nama pada pesan NEGATIVE (hanya sampai petik pertama).

## Perintah untuk pemilik
```bash
cd frontend
npx jest components/Modals/Analyze/Classify/naive-bayes/hooks --coverage=false
cd ..
npx tsc --noEmit -p frontend
```
Tambahan untuk N7: isi `rawTextValues` dari `useDataStore.data[row][columnIndex]` (urutan baris sama dengan kolom target) dan tambahkan test "3 kucing lucu" di tingkat container.
