# Laporan Fase N2b — `float_roundtrip` pada CORE (G1)

## Status: SELESAI (terverifikasi oleh pemilik)

## Ringkasan perubahan
1. `Cargo.toml`: `serde_json = "1.0"` menjadi `serde_json = { version = "1.0", features = ["float_roundtrip"] }`. Tidak ada perubahan lain.
2. `tests/s4_fit_transform.rs`, test `model_json_roundtrip_menghasilkan_transform_identik`:
   - `idf` dan `avg_doc_norm` dibandingkan EKSAK dengan `assert_eq!` (bukan toleransi 1e-12);
   - kedua pemanggilan `assert_csr_hampir` diganti `assert_csr_identik`;
   - helper `assert_csr_hampir` beserta komentarnya dihapus (tidak terpakai lagi).
3. Tidak ada perubahan pada `src/`, rumus, atau test lain. Tidak ada dependensi baru.

## File diubah (path lengkap)
- `frontend/rust-crates/statify-text-core/Cargo.toml`
- `frontend/rust-crates/statify-text-core/tests/s4_fit_transform.rs`
- `frontend/components/Modals/Analyze/Classify/naive-bayes/plan-reports-v2/N2b.md` (laporan ini)

## Cargo.lock
Tidak berubah: `git status Cargo.lock` di `statify-text-core` menunjukkan "working tree clean" setelah `cargo test`. Tidak ada entri dependensi baru karena `float_roundtrip` hanya fitur tanpa dependensi tambahan. (Status `Cargo.lock` milik STWV/rust tidak dilaporkan pemilik; cek bila perlu dengan `git status` di folder itu.)

## Hasil test (dijalankan pemilik, Windows, toolchain lokal)
- `cargo test` di `frontend/rust-crates/statify-text-core`: SEMUA HIJAU.
  - characterization 15/15, nb_text 12/12, s2_pipeline 16/16, s3_formulas 25/25, s4_fit_transform 22/22.
  - `model_json_roundtrip_menghasilkan_transform_identik` lulus dengan perbandingan EKSAK (`assert_eq!` / `assert_csr_identik`), jadi f64 kembali bit-per-bit.
  - Kompilasi memakai `serde_json v1.0.151`.
- `cargo check` di `StringToWordVector/rust`: sukses (memakai `serde_json v1.0.149` dari lock STWV sendiri; fitur baru terbawa lewat CORE).

## Risiko (sisa)
- Parsing float sedikit lebih lambat; ukuran WASM mungkin naik sedikit. Belum diukur (build WASM tidak dijalankan di fase ini).
- Versi `serde_json` berbeda antar-lock (CORE 1.0.151, STWV 1.0.149). Tidak bermasalah karena fitur ada di kedua versi, tetapi jangan `cargo update` hanya demi menyamakan.

## Catatan untuk fase berikutnya
1. Setiap crate pembungkus baru (NB v2, AM v2) yang bergantung pada CORE otomatis mendapat `float_roundtrip` lewat penyatuan fitur Cargo; tidak perlu mengulang pengaturan ini. Bila pembungkus punya `serde_json` sendiri, fitur tetap aktif selama CORE ikut terkompilasi di build yang sama.
2. Jaminan bit-per-bit berlaku untuk jalur string JSON di sisi Rust. Serialisasi Rust (shortest round-trip) dan `JSON.parse` di JavaScript sudah akurat; jalur objek WASM (`serde_wasm_bindgen`) memang tidak terpengaruh.
3. Test yang menyimpan/memuat `TextVectorizerModel` lewat string JSON (export model NB, AM v2 memuat resep) kini boleh memakai perbandingan eksak; jangan memakai toleransi 1e-12 lagi untuk model.
4. Ukuran/kecepatan WASM: ukur sekali saat build WASM berikutnya yang memang dijalankan (mis. N3b/A2), tidak perlu fase khusus.
5. Tidak ada keputusan terbuka dari fase ini.

## Perintah untuk pemilik (sudah dijalankan; untuk referensi)
```bash
# Test crate CORE (round-trip harus eksak)
cd frontend/rust-crates/statify-text-core
cargo test
git status Cargo.lock
cd -

# Pastikan pembungkus STWV masih terkompilasi dengan fitur baru
cd frontend/components/Modals/Transform/StringToWordVector/rust
cargo check
cd -
```
