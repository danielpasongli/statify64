// Crate Naive Bayes (Statify) — berdiri sendiri, tidak berbagi kode dengan
// crate `nearest-neighbor` (PLAN.md §1: "Rust crate independen"). Struktur
// folder wajib mengikuti pola `nearest-neighbor/rust` (AGENTS.md §2 &
// §6): models/ (struct konfigurasi & data), stats/ (algoritma statistik,
// masih kosong di Fase 8), utils/ (konversi tipe & error umum), wasm/
// (binding yang diekspos ke JS).
pub mod models;
pub mod stats;
pub mod utils;
pub mod wasm;
