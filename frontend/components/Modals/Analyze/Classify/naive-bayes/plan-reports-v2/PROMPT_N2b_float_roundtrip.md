# Prompt Fase N2b — `float_roundtrip` pada CORE (fase kecil, G1)

Asal: keputusan pemilik (butir 1) setelah Fase N2; lihat juga `STWV/plan-reports/CATATAN_TAHAP2_float_roundtrip.md`.
Fase ini tidak ada di PLAN_V2; jalankan SEBELUM N3b/A2 (boleh paralel dengan N0, N1, N5, A1 karena file yang disentuh tidak tumpang tindih).

## Prompt (tempel ke agent)

```
# PERAN
Kamu adalah agent implementasi untuk proyek skripsi "Statify" (Next.js + TypeScript + Rust/WASM).
Kamu bekerja di working tree yang SAMA dengan agent lain yang berjalan paralel, di branch dija-v2.

# TUGAS
Kerjakan HANYA Fase N2b — aktifkan fitur `float_roundtrip` pada serde_json di crate statify-text-core
agar f64 kembali bit-per-bit setelah to_string -> from_str.

# BACA DULU (urut)
1. frontend/components/Modals/Transform/StringToWordVector/plan-reports/CATATAN_TAHAP2_float_roundtrip.md (seluruhnya)
2. frontend/components/Modals/Analyze/Classify/naive-bayes/plan-reports-v2/N2.md (bagian "Catatan untuk fase berikutnya" butir 4)
3. frontend/rust-crates/statify-text-core/Cargo.toml
4. frontend/rust-crates/statify-text-core/tests/s4_fit_transform.rs (helper assert_csr_hampir / assert_csr_identik dan test model_json_roundtrip_menghasilkan_transform_identik)

# FILE MILIK FASE (hanya ini)
- frontend/rust-crates/statify-text-core/Cargo.toml
- frontend/rust-crates/statify-text-core/tests/s4_fit_transform.rs
- frontend/rust-crates/statify-text-core/Cargo.lock — hanya bila berubah OTOMATIS karena fitur; jangan diedit manual.
- frontend/components/Modals/Analyze/Classify/naive-bayes/plan-reports-v2/N2b.md (laporan)

# LANGKAH
1. Cargo.toml: ubah `serde_json = "1.0"` menjadi `serde_json = { version = "1.0", features = ["float_roundtrip"] }`. Tidak ada perubahan lain.
2. tests/s4_fit_transform.rs, test `model_json_roundtrip_menghasilkan_transform_identik`:
   - bandingkan `idf` dan `avg_doc_norm` secara EKSAK (assert_eq!), bukan toleransi 1e-12;
   - ganti kedua pemanggilan `assert_csr_hampir(...)` dengan `assert_csr_identik(...)`;
   - hapus helper `assert_csr_hampir` (dan komentarnya) bila sudah tidak terpakai.
   Jangan mengubah test lain, jangan mengubah rumus/perilaku, jangan menyentuh src/.
3. Jangan menjalankan: git apa pun, cargo update, cargo add, npm install, wasm-pack, formatter seluruh repo.
4. Jalankan HANYA bila toolchain tersedia (cargo test di crate ini). Bila cargo/jaringan tidak tersedia, JANGAN mencari jalan pintas:
   tulis perintahnya di laporan untuk dijalankan pemilik.

# KRITERIA SELESAI
- Cargo.toml memuat fitur float_roundtrip; tidak ada dependensi baru; Cargo.lock tidak diedit manual.
- Test round-trip kembali EKSAK (assert_eq!/assert_csr_identik) dan tidak ada helper mati.
- Komentar kode Bahasa Indonesia; test lama lain tidak berubah.

# LAPORAN (plan-reports-v2/N2b.md)
Status; ringkasan perubahan; file diubah (path lengkap); apakah Cargo.lock berubah otomatis (bila terdeteksi);
hasil test atau "tidak dijalankan: <alasan>"; risiko; perintah untuk pemilik (blok kode, komentar Indonesia).

# PENUTUP
Akhiri dengan ringkasan 3-5 baris dan path laporan. Jangan menawarkan commit.
```

## Perintah untuk pemilik setelah fase selesai
```bash
# Test crate CORE (round-trip harus eksak)
cd frontend/rust-crates/statify-text-core
cargo test
cd -

# Pastikan pembungkus STWV masih terkompilasi dengan fitur baru
cd frontend/components/Modals/Transform/StringToWordVector/rust
cargo check
cd -
```
Dampak yang diketahui: parsing float sedikit lebih lambat dan ukuran WASM mungkin naik sedikit; hanya crate yang bergantung pada CORE (STWV, dan NB/AM bila memakai CORE) yang terpengaruh. Laporkan bila `Cargo.lock` berubah otomatis.
