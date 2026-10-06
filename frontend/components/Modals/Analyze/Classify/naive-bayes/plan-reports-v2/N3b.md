# Laporan Fase N3b — NB Rust: Raw Text anti-leakage (G3)

## Status: SELESAI
Diverifikasi pemilik pada toolchain asli: `cargo test` crate NB **169 lulus, 0 gagal** (158 lama + 11 baru N3b), `cargo check --target wasm32-unknown-unknown` bersih, `cargo test` `statify-text-core` hijau (15 + 13 + 16 + 25 + 22; crate tidak diubah). Sebelumnya hanya `rustfmt --check` yang bisa dijalankan di sandbox (tanpa akses crates.io).

Prasyarat: laporan N3a (SELESAI, 158 test hijau pada build asli, disetujui pemilik), N1, N2, dan `CATATAN_TAHAP2_negatif_dan_notscored.md` sudah dibaca. N3a menyatakan serah-terima: pakai `build_v2_context` dan `train_and_predict_v2`, ganti cabang penolakan raw, pertahankan urutan align → NotScored → CSR, iris baris dengan `slice_csr_rows`.

## Ringkasan perubahan
1. `stats/raw_text.rs` (BARU): `RawTextContext` (dokumen terselaras, config `Text`, resep model final), `build_raw_text_context` (fit model final di seluruh baris valid), `fit_split` (fit di data latih, transform latih dan uji), `SplitLabel` (Holdout / Fold n 1-based), dan pemetaan galat CORE ke kode NB.
2. Pemetaan galat (AGENTS_V2 §11): `EMPTY_VOCABULARY`/`EMPTY_INPUT` menjadi `NB_E_TEXT_EMPTY_VOCAB` (model final) atau `NB_E_TEXT_EMPTY_VOCAB_FOLD` (menyebut "fold ke-n" atau "holdout"). `INVALID_CONFIG`/`INVALID_REGEX`/`INVALID_STOPWORDS`/lainnya menjadi `NB_E_TEXT_CONFIG: [kode] pesan asli`. Config `Text` yang tidak dikirim juga menjadi `NB_E_TEXT_CONFIG`, tanpa fallback diam-diam.
3. `text_features.rs`: cabang penolakan raw N3a **diganti** (bukan jalur paralel). `build_text_feature_data_with_config` menjalankan align → missing dari payload mentah → fit model final raw (atau CSR vector). `build_text_feature_data` lama tetap ada (delegasi, config `None`). `build_v2_context` meneruskan `config_v2.text`.
4. `TextContext.raw: Option<RawTextContext>` dan `TrainedTextModel.recipe`. Hasil fit global pada `TextContext.data` hanya dipakai model final; evaluasi wajib lewat `prepare_split_text`.
5. `prepare_split_text`: raw memakai `raw_text::fit_split`, vector memakai `slice_csr_rows` dengan perilaku N3a yang sama persis. `train_and_predict_v2` tetap ada (delegasi dengan `SplitLabel::Unspecified`); logika pindah ke `train_and_predict_v2_split`.
6. `retrain_final_model_v2` mengisi `recipe` model final dari `RawTextContext::final_recipe`, siap diekspor N4 sebagai `text.recipe`.
7. `wasm/function.rs`: `evaluate_split` menerima `SplitLabel`. k-fold mengirim `Fold(fold_idx + 1)` dan holdout mengirim `Holdout`. Jalur v1 tidak berubah.
8. `stats/mod.rs`: hanya menambah `pub mod raw_text;`.
9. NotScored dan nilai negatif tidak diubah, tetap sama dengan AM: `text_row_missing` pada payload mentah (raw di-trim), `NB_E_TEXT_NEGATIVE` hanya untuk jalur vector. Skor NB = ln prior (hanya bila `uses_class_prior`) + `CORE::nb_text::score_rows`; dibuktikan pada test golden raw.
10. `NB_E_COMPLEMENT_MIXED` tetap ditegakkan di `build_v2_context` (`validate_text_model_setup`, N3a) sebelum fit; jalur raw lewat pintu yang sama, jadi Complement + predictor lain ditolak sebelum fit apa pun.

## File diubah / dibuat / dihapus (path lengkap)
Prefiks: `frontend/components/Modals/Analyze/Classify/naive-bayes/`
- Dibuat: `rust/src/stats/raw_text.rs`, `plan-reports-v2/N3b.md`
- Diubah (daftar fase): `rust/src/wasm/function.rs`, `rust/src/stats/mod.rs`
- Diubah (DI LUAR daftar fase, lihat KEPUTUSAN TERBUKA 1): `rust/src/stats/text_features.rs`
- Tidak diubah: `partition.rs` (tidak perlu), `Cargo.toml`/`Cargo.lock`, file TS.
- Dihapus: tidak ada (konstanta `RAW_TEXT_NOT_SUPPORTED_MESSAGE` dihapus dari `text_features.rs`). Cadangan file asli ada di `$HOME/n3b/backup/` pada VM perangkat (di luar folder terhubung). Gaya CRLF dipertahankan.

## Test
- Perintah yang dijalankan (pemilik, Windows): `cargo test` → 169 lulus / 0 gagal; `cargo test raw_text` → 11 lulus; `cargo check --target wasm32-unknown-unknown` → bersih; `cargo test` di `statify-text-core` → hijau.
- Test baru (semua di `stats/raw_text.rs`, modul `tests`):
  - `t18_kata_yang_hanya_ada_di_data_uji_tidak_masuk_kosakata_split` (T18: kata hanya di data uji tidak ada di kosakata holdout, tetapi ada di model final).
  - `t18_jalur_evaluasi_text_features_memakai_fit_split_bukan_matriks_global` (T18 lewat `build_v2_context` + `prepare_split_text`).
  - `model_final_raw_golden_log_weights_dan_skor_sama_dengan_ln_prior_plus_score_rows` (3 dokumen golden, label pos/neg/pos, config Weka default: `log_weights` Multinomial §6.7; skor [-4.799914, -3.072693]; P(pos) 0.849057; `recipe` terisi).
  - `kfold_raw_dengan_seed_tetap_deterministik` dan `holdout_raw_berjalan_dan_menghasilkan_evaluasi` (lewat `run_analysis`).
  - `kosakata_fold_kosong_menghasilkan_kode_fold_dengan_nomor_fold`, `kosakata_model_final_kosong_menghasilkan_kode_empty_vocab`.
  - `konfigurasi_tidak_valid_diteruskan_sebagai_nb_e_text_config`, `konfigurasi_text_tidak_dikirim_ditolak_bukan_fallback_diam_diam`.
  - `teks_raw_kosong_tanpa_prediktor_lain_notscored_dan_tidak_masuk_evaluasi`, `baris_target_missing_ikut_terbuang_dari_dokumen_raw`.
- Test N3a yang diubah (ekspektasi obsolete karena fase ini memang menggantikan penolakan raw), di `stats/text_features.rs`:
  - `payload_raw_ditolak_sampai_n3b_dan_none_tidak_menghasilkan_data` diganti nama menjadi `payload_raw_tanpa_konfigurasi_ditolak_dan_none_tidak_menghasilkan_data`; sekarang mengharapkan `NB_E_TEXT_CONFIG`, bukan pesan "belum didukung".
  - `end_to_end_sumber_teks_diambil_dari_payload_bukan_dari_config`: bagian akhirnya sekarang mengharapkan prefiks `NB_E_TEXT_CONFIG`.
  - 3 literal `TextContext { .. }` di test N3a diberi `raw: None` (hanya konstruksi, tanpa perubahan ekspektasi).
- Regresi v1 / N3a: tidak ada perubahan perilaku jalur v1 maupun vector; 158 test lama (setelah dua perubahan di atas) + 11 test baru semuanya hijau.

## Pemenuhan "Kriteria selesai"
- [x] Fit pipeline teks per holdout/fold, bukan global: `text_features.rs:460` (`prepare_split_text`) → `raw_text::fit_split`; dipakai `train_and_predict_v2_split` (`text_features.rs:517`); test T18.
- [x] Model final fit pada seluruh data valid + resep: `raw_text::build_raw_text_context` (`raw_text.rs:141`), resep dilampirkan di `text_features.rs:447`; test `model_final_raw_golden_*`.
- [x] Titik masuk `build_v2_context` + `train_and_predict_v2`; cabang penolakan diganti: `text_features.rs:308`.
- [x] Urutan align → NotScored → CSR dipertahankan: `build_text_feature_data_with_config`.
- [x] Irisan baris dengan `slice_csr_rows` (vector) dan indeks yang sama untuk dokumen raw (`pick_docs`).
- [x] Galat CORE ke kode §11: `raw_text.rs` `map_core_error`; test kosakata/config.
- [x] Aturan NotScored dan negatif sama dengan AM; skor = ln prior + `score_rows`: test golden dan NotScored raw.
- [x] `NB_E_COMPLEMENT_MIXED` tetap di Rust (lapis kedua): `validate_text_model_setup` di `build_v2_context`, diuji oleh test N3a `end_to_end_alpha_tidak_valid_dan_complement_campuran_ditolak`.
- [x] "Test hijau": 169/169 pada build asli (lihat Test).

## KEPUTUSAN TERBUKA / risiko
1. **`text_features.rs` di luar daftar file fase.** Cabang penolakan raw ada di file itu (milik N3a), dan catatan pemilik serta handoff N3a eksplisit meminta cabang tersebut diganti, bukan dibuat jalur paralel. Perubahan dijaga minimal; `train_and_predict_v2` dan `build_text_feature_data` lama dipertahankan sebagai delegasi supaya pemanggil/test lain tidak rusak. Mohon cek konflik bila ada agent lain menyentuh file ini.
2. **Dua test N3a diubah ekspektasinya** (daftar di atas); keduanya menguji penolakan raw yang memang dihapus fase ini.
3. Galat CORE selain `EMPTY_*` (`INVALID_DATA` dll.) diteruskan sebagai `NB_E_TEXT_CONFIG: [kode] pesan`. Tafsiran konservatif karena §11 tidak mendefinisikan kode lain.
4. Fit global untuk model final dilakukan di awal (`build_v2_context`), sehingga kosakata kosong di seluruh data muncul sebagai `NB_E_TEXT_EMPTY_VOCAB` sebelum evaluasi dimulai. Biaya: satu fit tambahan di luar fit per fold.
5. Memori: `fit_split` meng-clone dokumen latih/uji per fold; `prepare_split_text` jalur vector meng-clone nama term per evaluasi. Dapat dioptimalkan bila dataset besar.
6. `not_scored_rows` masih `serde(skip)` dan export tetap schema 1.1 dengan peringatan "menunggu N4". Resep sudah tersedia di `TrainedTextModel::recipe` untuk N4. Dependensi `float_roundtrip` pada `serde_json` CORE sudah aktif (`Cargo.toml` CORE).
7. Build WASM belum dibuat; frontend masih memakai pkg lama sampai B1.

## Catatan untuk fase berikutnya
- **N4 (export/output):** resep model final ada di `TrainedModelParams.text.recipe` (`Some` hanya untuk raw), nama term di `text.terms`, nama variabel di `RawTextContext::variable` (ada di `V2Context.text.raw`; belum disalin ke model, N4 perlu menyalinnya untuk `raw_variable`). Baris Case Processing Summary `Raw text: '{var}' ({V} terms)`: V = `text.terms.len()` model final. Top-k dan `full` dari model final, BUKAN dari model per-fold. `not_scored_rows` masih `serde(skip)` di `function.rs`. `trained.recipe` model per-fold sengaja `None`.
- **N5/N8 (TS):** pastikan `naive-bayes-error-messages.ts` memetakan prefiks `NB_E_TEXT_EMPTY_VOCAB_FOLD` (memuat nomor fold), `NB_E_TEXT_EMPTY_VOCAB`, `NB_E_TEXT_CONFIG` (meneruskan kode CORE + pesan asli), `NB_E_TEXT_SHAPE`, dan meneruskan pesan apa adanya bila prefiks tidak dikenal. Galat Rust untuk run ber-Text datang lewat galat konstruktor, bukan `get_formatted_results`.
- **B1 (uji manual):** ukur waktu k-fold raw pada dataset tweet dengan stemming Indonesia (fit diulang tiap fold; cache stem CORE hanya per pemanggilan `fit`). Bila lambat, lihat keputusan 3 di bawah.
- **V1:** tambahkan test raw untuk Bernoulli/Complement end-to-end dan stemming per fold (test N3b hanya Multinomial lewat `run_analysis`).

## Keputusan pemilik (disetujui)
Seluruh rekomendasi disetujui pemilik:
1. Perubahan `text_features.rs` (di luar daftar fase) dan dua test N3a yang diperbarui diterima.
2. k-fold: kosakata kosong di satu fold menghentikan analisis dengan `NB_E_TEXT_EMPTY_VOCAB_FOLD` (fold tidak dilewati diam-diam).
3. Performa k-fold raw dengan stemming Indonesia diukur di B1; optimasi (tokenisasi sekali, fit per fold dari token) butuh perubahan API CORE dan menjadi fase tersendiri bila perlu.
4. Fit global di awal untuk model final diterima (tidak menimbulkan kebocoran).
5. Galat CORE selain kosakata kosong diteruskan sebagai `NB_E_TEXT_CONFIG: [kode] pesan`; pemetaan TS (N5) dipastikan tidak menelan kode CORE.

## Perintah yang harus dijalankan pemilik
```bash
# Jalankan test crate NB (158 test lama + 11 test baru N3b), dari root repo
cd frontend/components/Modals/Analyze/Classify/naive-bayes/rust
cargo test

# Hanya test modul baru
cargo test raw_text

# Pastikan target wasm32 tetap kompilasi (tanpa wasm-pack)
cargo check --target wasm32-unknown-unknown

# Crate CORE tidak diubah; jalankan hanya bila ingin memastikan
cd ../../../../../../rust-crates/statify-text-core
cargo test
```
Bila ada kegagalan kompilasi atau test, kirim keluarannya; kemungkinan titik rawan: impor `statify_text_core::{self as text_core, ...}` di `raw_text.rs` dan literal `TextContext` di test N3a.
