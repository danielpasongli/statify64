# Laporan Perbaikan Kecil N1 + N2 (temuan N1-2 dan N2-1 dari REVIEW-G1)

## Status: SELESAI — terverifikasi oleh pemilik (2026-10-04)
Edit hanya pada dua file yang diizinkan. Tidak ada ekspektasi test yang ada diubah. Tanpa git, tanpa cargo add/update, tanpa wasm-pack.

## Perubahan
1. **N1-2 — `rust/src/wasm/constructor.rs`** (gaya CRLF dipertahankan).
   Tepat setelah payload Text diparse ditambahkan guard sementara: bila `text_payload` bukan `TextPayload::None`,
   galat dicatat ke `error_collector` dengan kunci `"constructor.text"` dan konstruktor mengembalikan
   `Err(string_to_js_error(...))` dengan pesan:
   `Fitur Text belum didukung oleh build Naive Bayes ini (menunggu Fase N3a/N3b).`
   Blok diberi komentar penanda `=== GUARD SEMENTARA ... HAPUS di Fase N3a ===` dan `=== AKHIR GUARD SEMENTARA ===`.
   Payload v1 (`undefined`/`null` → `TextPayload::None`) melewati guard tanpa efek, jadi perilaku v1 identik.
   Guard memakai `matches!` (tidak membutuhkan `PartialEq` pada `TextPayload`).
2. **N2-1 — `frontend/rust-crates/statify-text-core/tests/nb_text.rs`**
   Test baru `top_k_tiebreak_memakai_nama_term_bukan_indeks`: `golden_train(Multinomial)`, nama term
   `["a","z","y","x","b"]`, `top_k(&params, &names, 5)`; ekspektasi urutan indeks kelas neg = `[4,3,2,1,0]`
   (indeks 4 skor tertinggi; indeks 1,2,3 seri → urut nama x,y,z → 3,2,1; indeks 0 terakhir).
   Test lain tidak disentuh.

## Test (dijalankan pemilik di Windows)
- CORE `cargo test`: characterization 15, **nb_text 13/13** (termasuk `top_k_tiebreak_memakai_nama_term_bukan_indeks`), s2 16, s3 25, s4 22 — semua lulus.
- NB `cargo test`: **112/112 lulus** (94 v1 + 18 baru). Ini menutup N1-1 (putaran 2 yang tertunda): perbaikan 3 ekspektasi dan pesan `NB_E_TEXT_NEGATIVE` terkonfirmasi. Angka "98 test lama" di `N1.md` keliru (N1-6); yang benar 94 v1 + 18 baru = 112.
- NB `cargo check --target wasm32-unknown-unknown`: sukses.
- Guard N1-2 tidak punya test native (constructor butuh `JsValue`); baru teruji saat uji WASM (B1).

## Perintah yang sudah dijalankan pemilik (referensi)
```bash
# CORE (harapan: nb_text 13/13, test lain tidak berubah)
cd frontend/rust-crates/statify-text-core
cargo test

# NB (harapan: 112 test lulus; guard tidak punya test native karena constructor butuh JsValue)
cd frontend/components/Modals/Analyze/Classify/naive-bayes/rust
cargo test
cargo check --target wasm32-unknown-unknown
```

## Catatan untuk N3a
Hapus blok guard di `constructor.rs` (cari `GUARD SEMENTARA`) saat `text_payload`/`config_v2` mulai dikonsumsi `run_analysis`.

## Keputusan pemilik atas REVIEW-G1 (2026-10-04) dan catatan fase berikutnya
Semua rekomendasi disetujui pemilik. Tidak ada keputusan terbuka tersisa; yang tinggal adalah pekerjaan.

| # | Keputusan | Dikerjakan di |
|---|---|---|
| 1 | **N5-2:** kolom Raw Text dikirim sebagai string asli dari `useDataStore.data[row][columnIndex]`, BUKAN lewat `getSlicedData`/`parseCellValue` (`parseFloat` mengubah "3 kucing lucu" menjadi 3). `getSlicedData` tidak diubah; Numeric/Categorical tetap lewat jalur lama; sel null/kosong tetap `null`. Wajib bertes: "3 kucing lucu" dan "2024 pilkada seru" harus utuh. | **N7** (syarat wajib bertes) |
| 2 | **N5-1** pesan `NB_E_TEXT_NEGATIVE` memuat nama kolom + jumlah kolom (ekstrak `'([^']+)'` dan `total (\d+) kolom`), test pesan Rust asli untuk satu dan beberapa kolom. Sekalian **N5-4** (`TextSource` efektif di builder) dan **N5-6** (whitespace → `null`). | Tugas kecil berikutnya (sebelum N6/N7) |
| 3 | **N1-2 + N1-3 + N1-5 + N2-2:** hapus guard `GUARD SEMENTARA` di `constructor.rs`; sambungkan `text`/`config_v2` ke `run_analysis`; validasi `0 < alpha <= 999` sebelum `train`; urutan `align_text_payload` → NotScored dari payload mentah → `vector_to_csr` (komentar kode + test); `impl From<config::TextLikelihood> for nb_text::TextLikelihood`; model hanya-Text melewati penolakan "predictor kosong" di `preprocess_naive_bayes_data`; Rust hanya memakai `text.source` dari payload. | **N3a** |
| 4 | Tambah `NB_E_TEXT_SHAPE` ke AGENTS_V2 §11 dan `naive-bayes-error-messages.ts` (N1-4). Format pesan fold kosong: `NB_E_TEXT_EMPTY_VOCAB_FOLD: fold {n} ...` dan uji regex TS dengan pesan itu (N5-5). | Fase V1 (dokumen) / N3b + N5 lanjutan |
| 5 | Catat N2b di checklist PLAN_V2 §5 (N2-3). Tambah `AM_W_TEXT_ALL_ZERO_FILLED` dan `AM_I_TEXT_ZERO_FILLED` ke AGENTS_V2 §10.2 (A1-4). | Fase V1 |
| 6 | **N5-8:** perbaiki kode `getEffectivePredictors`/validasi agar pesan "predictor" muncul saat target kosong; ekspektasi test v1 tidak diubah. | Putaran N5 lanjutan / N7 |
| 7 | **A1-1:** pesan `AM_E_SCHEMA_VERSION_UNSUPPORTED` → "1.0, 1.1, 2.0"; empat test mengganti contoh versi tak didukung "2.0" → "3.0". Mengubah ekspektasi lama: catat di laporan A3 dan minta persetujuan pemilik. | **A3** |
| 8 | **A1-2/A1-3:** fixture AM diuji dengan toleransi 1e-6 (log_weights dibulatkan 6 desimal); uji 1e-9 hanya NB↔AM pada model hasil latih; validasi konsistensi `uses_class_prior` (complement K≥2 → false, selain itu true) dan sisanya ditolak di lapis kedua Rust. Juga NotScored (CATATAN_TAHAP2 §2) dan N5-6 sisi Rust (trim whitespace). | **A2** (boleh paralel sekarang) |

Aturan lintas fase: jangan rilis/merge hanya dengan Gelombang 1 (`tsc` penuh gagal di `naive-bayes-main.tsx` dan `options.test.tsx` sampai N7, temuan N5-3; N7 wajib memakai `mergeWithDefaults` dan `cloneNaiveBayesDefault` + `text`). Risiko belum teruji: serde tag internal `source` pada `TextPayload` dengan objek JS nyata (baru terbukti di uji WASM B1). Koreksi `N1.md` (N1-6): angka "98 test lama" yang benar 94 v1 + 18 baru = 112.

Urutan yang disarankan: (2) tugas kecil → A2 paralel → N3a (butir 3) → N6/N7 (butir 1, 6) → V1 (butir 4, 5) → A3 (butir 7).
