// Modul algoritma statistik Naive Bayes (Mersenne Twister, preprocessing,
// partition/k-fold, distribusi Gaussian & kategorik, prediksi, metrik
// evaluasi, dst. — lihat AGENTS.md §6) ditambahkan bertahap mulai Fase 9
// (PLAN.md Bagian B).
//
// Fase 9 ("Preprocessing data di Rust"): `preprocess_data` menerapkan
// kebijakan missing-value final AGENTS.md §5.4 (listwise untuk target,
// kategori "(Missing)" untuk kategorik, pengecualian per-atribut untuk
// numerik) dan memisahkan predictor menjadi factor/covariate dari
// `measure`.
//
// Fase 10 ("Stratified split + Mersenne Twister"): `mersenne_twister`
// berisi RNG MT19937 yang ditulis ulang di dalam crate ini sendiri (bukan
// diimpor lintas-crate dari `nearest-neighbor`, AGENTS.md §7); `partition`
// memakainya untuk stratified train/holdout split.
//
// Fase 11 ("Stratified K-Fold"): `partition` diperluas dengan stratified
// k-fold assignment + keputusan eksplisit "peringatan vs blokir keras"
// untuk jumlah fold berlebih (lihat komentar di kepala `partition.rs`).
//
// Fase 12 ("Training model: prior kelas, parameter Gaussian (covariate),
// frekuensi + smoothing (factor)"): `class_prior` menghitung prior kelas
// dari cases yang diberikan; `numerical_distribution` menghitung mean &
// variance (dengan variance floor) per covariate per kelas;
// `categorical_distribution` menghitung frekuensi + Laplace smoothing per
// factor per kelas; `training` menggabungkan ketiganya menjadi satu
// `TrainedModelParams`. Modul-modul ini murni fungsi statistik atas
// `PreprocessedCase` (Fase 9) — belum disambungkan ke partition (Fase
// 10/11) atau ke wasm/export (Fase 13-16).
//
// Fase 13 ("Prediksi / scoring + penanganan kategori tak dikenal"):
// `prediction` menghitung skor log-posterior (log prior + log-likelihood
// Gaussian untuk covariate + log-likelihood kategorik untuk factor) di
// atas `stats::training::TrainedModelParams`, lalu memilih kelas dengan
// skor tertinggi (argmax, tie-break deterministik alfabetis). Fokus khusus
// fase ini: kategori yang tidak pernah muncul di training (AGENTS.md §5.9)
// ditangani lewat smoothing (`alpha / (class_total + alpha *
// jumlah_kategori)`, populasi sama dengan yang dipakai kategori dikenal di
// `categorical_distribution.rs`) — bukan error/panic/NaN.
//
// Fase 14 ("Metrik evaluasi & Confusion Matrix"): `classification_table`
// menghitung confusion matrix (baris=actual, kolom=predicted, count/
// total/persentase, AGENTS.md §5.7) dan Model Evaluation Metrics (AGENTS.md
// §5.6) — precision/recall/F1/accuracy one-vs-rest per kelas, macro/
// weighted/micro average, overall accuracy, dan Cohen's Kappa HANYA
// sebagai satu angka overall (bukan per kelas — koreksi final ambiguitas
// draft spesifikasi awal, ditegaskan lagi lewat instruksi tugas Fase 14).
// Modul ini murni menghitung dari sepasang label actual/predicted yang
// sudah disiapkan pemanggil — belum disambungkan ke `prediction`/wasm
// (itu Fase 17, di luar cakupan Fase 14).
//
// Fase 15 ("Attribute Distribution Table & Case Processing Summary"):
// `attribute_distribution` membangun tabel gaya WEKA (AGENTS.md §5.8) dari
// `stats::training::TrainedModelParams` yang DIBERIKAN APA ADANYA oleh
// pemanggil — modul ini sengaja tidak menerima parameter fold/holdout
// apa pun, supaya tidak ada jalan bagi kode ini untuk diam-diam
// menghitung dari satu fold saja. Kebenaran "model yang dikirim adalah
// hasil retrain di SELURUH dataset" (AGENTS.md §5.5 — titik paling
// gampang salah di fase ini) adalah kontrak yang wajib dipenuhi
// PEMANGGIL, disambungkan nanti di Fase 16/17 (di luar cakupan Fase 15).
// `case_summary` merangkum Case Processing Summary (AGENTS.md §5.4) dari
// `PreprocessedData` (Fase 9) dan `ValidationConfig` (skenario validasi
// yang dikonfigurasi, apa adanya, bukan hasil partition aktual).
//
// Fase 16 ("Retrain model final, serialisasi JSON export, binding WASM
// lengkap"): `save` me-retrain model Naive Bayes di SELURUH dataset
// (AGENTS.md §5.5, terpisah dari model yang dipakai evaluasi holdout/
// k-fold) dan menyerialisasikannya ke struktur JSON export model sesuai
// skema AGENTS.md §5.10 (nama field dijaga persis — kontrak file yang
// mungkin dipakai ulang pengguna). Orkestrasi penuh (preprocessing ->
// evaluasi holdout/k-fold -> retrain final -> attribute distribution ->
// case summary -> export model) disambungkan di `wasm::function::
// run_analysis`, MENGGANTIKAN hasil hardcoded Fase 8 — di luar cakupan
// modul `stats` ini sendiri (lihat `wasm/function.rs`).
pub mod attribute_distribution;
pub mod case_summary;
pub mod categorical_distribution;
pub mod class_prior;
pub mod classification_table;
pub mod mersenne_twister;
pub mod numerical_distribution;
pub mod partition;
pub mod prediction;
pub mod preprocess_data;
// Fase N3b (PLAN_V2): jalur Raw Text anti-leakage (fit per holdout/fold,
// model final + resep). Lihat kepala `raw_text.rs`.
pub mod raw_text;
pub mod save;
// Fase N3a (PLAN_V2): integrasi fitur Text (jalur `vector`, lewat
// `statify_text_core::nb_text`) ke pelatihan/prediksi + Gaussian min-std
// (`numerical_distribution`). Lihat kepala `text_features.rs`.
pub mod text_features;
// Fase N4 (PLAN_V2): Text Feature Table (Top-k kata per kelas + data lengkap
// untuk CSV/TSV). Lihat kepala `text_feature_table.rs`.
pub mod text_feature_table;
pub mod training;
