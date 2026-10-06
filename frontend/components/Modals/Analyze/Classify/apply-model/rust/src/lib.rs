// Crate Apply Model (Statify) — berdiri sendiri, tidak berbagi kode dengan
// crate lain. Struktur folder mengikuti pola `naive-bayes/rust` dan
// `nearest-neighbor/rust` (AGENTS.md §7.1):
//   models/   — struct konfigurasi, data mentah, payload, hasil.
//   scoring/  — kontrak scorer + registry (`build_scorer`) dan scorer per
//               algoritma (saat ini hanya Naive Bayes).
//   stats/    — statistik pasca-scoring generik (value label, posterior,
//               ringkasan, evaluasi, salinan classification_table NB).
//   utils/    — konversi tipe & error umum (salinan NB).
//   wasm/     — binding yang diekspos ke JS.
//
// Revisi v2 (AGENTS_V2.md V13): pengecualian aturan P6 ("salin, jangan import
// lintas crate") KHUSUS teks — preprocessing resep & likelihood Text dipakai
// dari path dependency `statify-text-core` (`scoring/text.rs`). Kode yang
// tetap disalin dari NB v1 (value_label, classification_table, error,
// log_gaussian_density/safe_ln) tidak berubah dan header sumbernya dipertahankan.
pub mod models;
pub mod scoring;
pub mod stats;
pub mod utils;
pub mod wasm;
