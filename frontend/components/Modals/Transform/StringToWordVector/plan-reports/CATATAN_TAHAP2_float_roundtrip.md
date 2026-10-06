# Catatan untuk agent Tahap 2 — presisi f64 pada JSON model (`float_roundtrip`)

Asal: temuan Fase S4 (`S4.md`, bagian KEPUTUSAN TERBUKA no. 1). Dokumen ini BUKAN bagian PLAN_FIX/PLAN_V2/AGENTS_V2; pemilik yang memutuskan apakah dipakai.

## Masalah
`serde_json` tanpa fitur `float_roundtrip` tidak menjamin f64 kembali bit-per-bit setelah `to_string` → `from_str`. Contoh nyata: `avg_doc_norm` `1.1104084639816971` menjadi `1.1104084639816973` (selisih 1 ulp, ~1e-16). Jalur objek WASM (`serde_wasm_bindgen`) tidak terpengaruh.

## Kapan perlu dikerjakan
Kerjakan SEBELUM atau BERSAMAAN dengan langkah pertama Tahap 2 yang menyimpan/memuat `TextVectorizerModel` sebagai string JSON (mis. export model NB berisi resep, atau AM v2 memuat resep dari file). Bila Tahap 2 hanya memakai model di memori / lewat objek WASM, langkah ini boleh dilewati.

## Yang dilakukan
1. Ubah `frontend/rust-crates/statify-text-core/Cargo.toml`:
   ```toml
   serde_json = { version = "1.0", features = ["float_roundtrip"] }
   ```
   Tidak ada perubahan kode lain. Hanya crate `statify-text-core` dan crate yang bergantung padanya yang terpengaruh (saat ini hanya STWV; NB v2/AM v2 bila nanti memakainya). Crate Rust lain di repo tidak berubah. Dampak: parsing float sedikit lebih lambat, ukuran WASM mungkin naik sedikit. `Cargo.lock` dapat memperbarui entri fitur secara otomatis.
2. Di `CORE/tests/s4_fit_transform.rs`, test `model_json_roundtrip_menghasilkan_transform_identik`: kembalikan perbandingan ke EKSAK:
   - `idf` dan `avg_doc_norm`: `assert_eq!` (bukan toleransi 1e-12);
   - ganti `assert_csr_hampir(...)` dengan `assert_csr_identik(...)` (2 tempat);
   - hapus helper `assert_csr_hampir` bila tidak terpakai lagi.
3. Jalankan `cargo test` di `statify-text-core` dan `cargo check` di `STWV/rust` (dan crate NB/AM yang memakai CORE). Harapan: semua hijau, termasuk round-trip eksak.

## Aturan
- Hanya sentuh `CORE/Cargo.toml` dan test di atas untuk langkah ini; jangan ubah rumus/perilaku.
- Jangan `cargo update`; bila `Cargo.lock` berubah otomatis oleh `cargo test`, laporkan di laporan fase.
- Catat di laporan fase: fase mana yang menerapkan, hasil `cargo test`, dan bahwa test round-trip kembali eksak.
