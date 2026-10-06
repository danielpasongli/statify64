# Laporan Fase N3a — NB Rust: Gaussian min-std + integrasi Text (vector) (G2)

## Status

**SELESAI** — diverifikasi oleh pemilik pada toolchain asli: `cargo test` crate NB **158 lulus, 0 gagal** (112 baseline v1 + 46 test N3a), `cargo check --target wasm32-unknown-unknown` bersih (termasuk `wasm/function.rs` dan `wasm/constructor.rs`), dan `cargo test` di `statify-text-core` hijau (15 + 13 + 16 + 25 + 22 test). Sebelumnya hanya divalidasi di harness terisolasi; kini terkonfirmasi di build asli. Test/tsc sisi TypeScript tidak dijalankan karena tidak ada perubahan TS pada fase ini.

## Ringkasan perubahan

1. `numerical_distribution.rs`: `NumericLikelihoodSpec` + fungsi min-std ala Weka (precision=(u_k−u_1)/(k−1), k<2 → 0.01; min_var=(precision/6)²; var=max(var_pop, min_var, floor)). Golden min-std −17.820326 terpenuhi.
2. `training.rs`: field model baru (`min_variance`, info Text) dan `train_naive_bayes_model_v2`; jalur v1 tidak berubah.
3. `prediction.rs`: `predict_case_inner` dan `predict_case_with_text`; skor = ln prior (hanya bila `uses_class_prior`) + Numeric + Categorical + kontribusi Text.
4. `text_features.rs` (BARU): enum `From` NB↔CORE, `train_text_model` (via `nb_text::train`), `slice_csr_rows`, `build_text_feature_data`, `build_v2_context`, `retrain_final_model_v2`, `train_and_predict_v2`.
5. Validasi: 0<alpha≤999 sebelum `nb_text::train`, `NB_E_TEXT_NEGATIVE` (nama kolom + jumlah), `NB_E_COMPLEMENT_MIXED`, `NB_E_TEXT_SHAPE` (baru).
6. Urutan wajib: `align_text_payload` → NotScored dari TextPayload mentah → `vector_to_csr`; negatif di baris target-missing tidak menggagalkan analisis.
7. NotScored sesuai CATATAN_TAHAP2 §2 (hanya model ber-Text, semua prediktor missing; ikut training, keluar evaluasi), sama dengan AM. Teks raw di-trim (whitespace = missing); `text.source` dari payload.
8. `preprocess_data.rs`: `preprocess_naive_bayes_data_v2` melewati resolusi predictor bila Text terisi.
9. `constructor.rs`: guard sementara dihapus; `config_v2`/`text` diteruskan ke `run_analysis`.
10. `function.rs`: perluasan minimal (evaluate_split, signature `run_analysis`, konteks v2, `not_scored_rows` serde(skip), warning).

## File diubah / dibuat / dihapus

Path relatif ke `frontend/components/Modals/Analyze/Classify/naive-bayes/rust/src/`.

- Dibuat: `stats/text_features.rs`
- Diubah: `stats/numerical_distribution.rs`, `stats/training.rs`, `stats/prediction.rs`, `stats/mod.rs`
- Diubah (di luar daftar fase, diperlukan): `stats/preprocess_data.rs`, `wasm/constructor.rs`, `wasm/function.rs`
- Dihapus: tidak ada. Cadangan file asli ada di `$HOME/n3a/backup/` pada VM perangkat (di luar folder terhubung).

## Test

Semua test baru ada di modul `tests_n3a` (numerical_distribution, training, prediction, preprocess_data) dan `text_features::tests`. Harness: 46 lulus, 0 gagal. Cakupan:

- Golden min-std −17.820326; v2 Gaussian biasa == v1; model v1 tanpa Text/min_variance.
- Golden Text: Multinomial [-4.799914, -3.072693] P=0.849057; Bernoulli [-5.898527, -3.060271] P=0.944708; Complement [2.667228, 3.701302] P=0.737705.
- Skor NB == ln prior + `score_rows` (CORE); model campuran Numeric+Text = jumlah kontribusi.
- NotScored dari payload mentah (bukan CSR); teks missing dengan prediktor lain tetap diskor.
- Urutan indeks evaluasi menentukan baris Text (`slice_csr_rows`).
- Negatif: di baris target-missing tidak menggagalkan; di baris terpakai ditolak dengan nama kolom; shape salah; alpha tidak valid; Complement campuran.

Test asli crate NB: baseline v1 (112) tetap hijau, total 158 lulus pada build asli.

## Pemenuhan Kriteria selesai

- Gaussian min-std sesuai golden (−17.820326): terpenuhi (build asli).
- Text vector terintegrasi, kontribusi hanya lewat `CORE::nb_text`: terpenuhi; golden Multinomial/Bernoulli/Complement cocok.
- Guard sementara dihapus, `text`/`config_v2` diteruskan ke `run_analysis`: terpenuhi; `cargo check` wasm32 bersih.
- Regresi nol v1: terpenuhi (112 test lama hijau tanpa perubahan ekspektasi; v2 tanpa Text/Gaussian biasa == v1).

## KEPUTUSAN TERBUKA / risiko

1. Kode `NB_E_TEXT_SHAPE` baru, belum terdokumentasi di PLAN/CATATAN; perlu didaftarkan.
2. `function.rs` dan `preprocess_data.rs` di luar daftar file fase (beririsan dengan N3b/N4 dan agent paralel); perubahan minimal — periksa konflik saat penggabungan.
3. Jalur Text `raw` ditolak sampai N3b; hanya `vector` diproses.
4. Bila Text terisi dan `run_analysis` menghasilkan None, dikembalikan Err ringkasan galat (tafsiran konservatif).
5. `not_scored_rows` ditandai `serde(skip)`: belum tampil di UI/hasil; perlu di-surface pada fase berikutnya.
6. Jalur `vector` memakai TF-IDF yang dihitung frontend atas seluruh data, sehingga k-fold/holdout berpotensi kebocoran statistik (IDF/kosakata) ke fold uji. Hanya jalur `raw` (fit per fold) yang bebas kebocoran.
7. Build WASM (`wasm-pack`) dan penyalinan ke `public/workers/*/pkg/` belum dilakukan (dilarang pada fase ini); frontend masih memakai pkg lama sampai langkah itu dijalankan pemilik.

## Pembaruan verifikasi

Hasil `cargo test` (158/158), `cargo check --target wasm32-unknown-unknown` dan `cargo test` statify-text-core dari pemilik dicatat di bagian Status. Risiko "kompilasi belum terverifikasi" pada versi sebelumnya sudah gugur.

## Keputusan pemilik (disetujui)

Seluruh rekomendasi pada KEPUTUSAN TERBUKA disetujui pemilik:

1. Kebocoran TF-IDF jalur `vector` diterima sebagai keterbatasan (dicatat di skripsi); N3b (`raw`) fit per fold.
2. N3b memakai fit/transform CORE per fold dengan `slice_csr_rows`.
3. N4 menampilkan jumlah NotScored di ringkasan kasus dan peringatan (sama dengan AM).
4. `NB_E_TEXT_SHAPE` didaftarkan di dokumen kode galat dan dipetakan di TypeScript.
5. Perubahan `function.rs`/`preprocess_data.rs` diterima; fase berikutnya membangun di atasnya dan memeriksa konflik.
6. Hasil `None` saat Text ada tetap berupa Err ringkasan galat.
7. Build WASM dan penyalinan pkg dijalankan setelah N3b/N4.

## Catatan untuk fase berikutnya

Tidak ada keputusan baru yang tertunda; berikut hanya catatan serah-terima.

- **N3b (jalur raw):** gunakan `text_features::build_v2_context` dan `train_and_predict_v2` sebagai titik masuk. Urutan wajib tetap `align_text_payload` → NotScored dari payload mentah → CSR. Fit pipeline teks per fold (bukan global) dan iris baris dengan `slice_csr_rows`. Saat ini payload `raw` ditolak di `build_text_feature_data`; ganti cabang itu, jangan buat jalur paralel.
- **N4 (hasil/UI):** `not_scored_rows` sudah dihitung di Rust tetapi `serde(skip)`; buka ke hasil sebagai jumlah di ringkasan kasus dan peringatan, sama dengan AM. Model Complement tanpa prior (K≥2) menyebabkan `uses_class_prior=false`: tabel prior kelas jangan ditampilkan menyesatkan untuk model tersebut.
- **Config min-std:** `NumericLikelihoodSpec` mendukung override per atribut (teruji), tetapi pemetaan dari config frontend ke spec perlu dipastikan di fase yang memegang konfigurasi.
- **Galat:** daftarkan `NB_E_TEXT_SHAPE` dan petakan di TypeScript (keputusan 4).
- **Build:** `wasm-pack build` dan salin ke `public/workers/*/pkg/` hanya setelah N3b/N4; sebelum itu UI memakai pkg lama.
- **Penggabungan:** `function.rs` dan `preprocess_data.rs` disentuh di luar daftar fase; periksa konflik dengan agent paralel dan jaga 158 test tetap hijau.

## Perintah untuk pemilik

```bash
# Sudah dijalankan pemilik dan hijau; ulangi bila ada perubahan lanjutan
cd frontend/components/Modals/Analyze/Classify/naive-bayes/rust
cargo test                                  # 158 lulus
cargo check --target wasm32-unknown-unknown

# Crate CORE (sudah hijau)
cd ../../../../../../../../rust-crates/statify-text-core
cargo test

# Nanti (setelah N3b/N4 selesai): bangun WASM dan salin ke public/workers/*/pkg/
# wasm-pack build ... (tidak dijalankan pada fase ini)
```
