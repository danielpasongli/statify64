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
pub mod models;
pub mod scoring;
pub mod stats;
pub mod utils;
pub mod wasm;
