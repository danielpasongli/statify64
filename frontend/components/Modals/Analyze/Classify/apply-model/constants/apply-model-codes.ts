// AGENTS.md §4.5 — daftar kode error/warning Apply Model + pesan pengguna.
// Placeholder `{detail}` diganti `issue.detail` oleh pemanggil.

export type ApplyModelErrorCode =
  | "AM_E_PARSE" | "AM_E_FILE_TOO_LARGE" | "AM_E_BUILTIN_FETCH" | "AM_E_NOT_OBJECT"
  | "AM_E_MODEL_TYPE_MISSING" | "AM_E_MODEL_TYPE_UNSUPPORTED" | "AM_E_SCHEMA_VERSION_UNSUPPORTED"
  | "AM_E_FIELD_MISSING" | "AM_E_FIELD_TYPE" | "AM_E_CLASSES_EMPTY" | "AM_E_CLASSES_DUPLICATE"
  | "AM_E_PRIORS_LENGTH" | "AM_E_PRIORS_INVALID" | "AM_E_PARAM_INVALID" | "AM_E_FEATURE_ORDER_MISMATCH"
  | "AM_E_ROLE_INVALID" | "AM_E_CATEGORIES_INVALID" | "AM_E_DISTRIBUTION_CLASS_MISSING"
  | "AM_E_DISTRIBUTION_LENGTH" | "AM_E_DISTRIBUTION_SUM" | "AM_E_GAUSSIAN_CLASS_MISSING"
  | "AM_E_GAUSSIAN_INVALID" | "AM_E_COUNTS_INVALID" | "AM_E_COUNTS_INCONSISTENT" | "AM_E_CLASS_TOTALS_INVALID"
  | "AM_E_MAP_UNMAPPED" | "AM_E_MAP_VAR_NOT_FOUND" | "AM_E_MAP_DUPLICATE" | "AM_E_MAP_MEASURE_UNKNOWN"
  | "AM_E_MAP_ROLE_MISMATCH" | "AM_E_MAP_NUMERIC_TYPE"
  | "AM_E_ACTUAL_NOT_FOUND" | "AM_E_ACTUAL_MEASURE" | "AM_E_ACTUAL_IS_PREDICTOR"
  | "AM_E_NAME_EMPTY" | "AM_E_NAME_INVALID" | "AM_E_NAME_TOO_LONG" | "AM_E_NAME_RESERVED" | "AM_E_NAME_DUPLICATE"
  | "AM_E_NO_MODEL" | "AM_E_NO_ROWS" | "AM_E_PAYLOAD" | "AM_E_WORKER";

export type ApplyModelWarningCode =
  | "AM_W_LEGACY_SCHEMA" | "AM_W_UNSEEN_SKIPPED_LEGACY" | "AM_W_UNSEEN_CATEGORY"
  | "AM_W_ROWS_NOT_SCORED" | "AM_W_ACTUAL_UNKNOWN_CLASS" | "AM_W_NAME_ADJUSTED"
  | "AM_W_NO_RESULT_STORE_MODELS" | "AM_W_BUILTIN_EMPTY";

export type ApplyModelIssue = {
  code: ApplyModelErrorCode | ApplyModelWarningCode;
  severity: "error" | "warning";
  detail?: string; // mis. path field, nama fitur, nama kolom
};

// Daftar semua kode (urutan = urutan union di atas). Dipakai test untuk
// memastikan setiap kode punya entri di APPLY_MODEL_MESSAGES.
export const ALL_APPLY_MODEL_CODES: ReadonlyArray<
  ApplyModelErrorCode | ApplyModelWarningCode
> = [
  "AM_E_PARSE", "AM_E_FILE_TOO_LARGE", "AM_E_BUILTIN_FETCH", "AM_E_NOT_OBJECT",
  "AM_E_MODEL_TYPE_MISSING", "AM_E_MODEL_TYPE_UNSUPPORTED", "AM_E_SCHEMA_VERSION_UNSUPPORTED",
  "AM_E_FIELD_MISSING", "AM_E_FIELD_TYPE", "AM_E_CLASSES_EMPTY", "AM_E_CLASSES_DUPLICATE",
  "AM_E_PRIORS_LENGTH", "AM_E_PRIORS_INVALID", "AM_E_PARAM_INVALID", "AM_E_FEATURE_ORDER_MISMATCH",
  "AM_E_ROLE_INVALID", "AM_E_CATEGORIES_INVALID", "AM_E_DISTRIBUTION_CLASS_MISSING",
  "AM_E_DISTRIBUTION_LENGTH", "AM_E_DISTRIBUTION_SUM", "AM_E_GAUSSIAN_CLASS_MISSING",
  "AM_E_GAUSSIAN_INVALID", "AM_E_COUNTS_INVALID", "AM_E_COUNTS_INCONSISTENT", "AM_E_CLASS_TOTALS_INVALID",
  "AM_E_MAP_UNMAPPED", "AM_E_MAP_VAR_NOT_FOUND", "AM_E_MAP_DUPLICATE", "AM_E_MAP_MEASURE_UNKNOWN",
  "AM_E_MAP_ROLE_MISMATCH", "AM_E_MAP_NUMERIC_TYPE",
  "AM_E_ACTUAL_NOT_FOUND", "AM_E_ACTUAL_MEASURE", "AM_E_ACTUAL_IS_PREDICTOR",
  "AM_E_NAME_EMPTY", "AM_E_NAME_INVALID", "AM_E_NAME_TOO_LONG", "AM_E_NAME_RESERVED", "AM_E_NAME_DUPLICATE",
  "AM_E_NO_MODEL", "AM_E_NO_ROWS", "AM_E_PAYLOAD", "AM_E_WORKER",
  "AM_W_LEGACY_SCHEMA", "AM_W_UNSEEN_SKIPPED_LEGACY", "AM_W_UNSEEN_CATEGORY",
  "AM_W_ROWS_NOT_SCORED", "AM_W_ACTUAL_UNKNOWN_CLASS", "AM_W_NAME_ADJUSTED",
  "AM_W_NO_RESULT_STORE_MODELS", "AM_W_BUILTIN_EMPTY",
];

export const APPLY_MODEL_MESSAGES: Record<
  ApplyModelErrorCode | ApplyModelWarningCode,
  string
> = {
  // --- Pemuatan model (§4.1) ---
  AM_E_PARSE: "Isi model tidak dapat dibaca sebagai JSON yang valid.",
  AM_E_FILE_TOO_LARGE: "Ukuran file model melebihi batas 10 MB.",
  AM_E_BUILTIN_FETCH: "Model bawaan Statify gagal diunduh. Periksa koneksi lalu coba lagi.",

  // --- Validasi umum & adapter (§4.2–4.3) ---
  AM_E_NOT_OBJECT: "Isi model harus berupa objek JSON, bukan array atau nilai tunggal.",
  AM_E_MODEL_TYPE_MISSING: "Field \"model_type\" tidak ditemukan atau bukan teks pada model.",
  AM_E_MODEL_TYPE_UNSUPPORTED: "Jenis model \"{detail}\" belum didukung oleh Apply Model.",
  AM_E_SCHEMA_VERSION_UNSUPPORTED: "Versi format model \"{detail}\" tidak didukung. Versi yang didukung: 1.0, 1.1.",
  AM_E_FIELD_MISSING: "Field wajib \"{detail}\" tidak ditemukan pada model.",
  AM_E_FIELD_TYPE: "Field \"{detail}\" pada model memiliki tipe data yang salah.",
  AM_E_CLASSES_EMPTY: "Model tidak memiliki daftar kelas target.",
  AM_E_CLASSES_DUPLICATE: "Daftar kelas target pada model berisi nama kelas yang duplikat.",
  AM_E_PRIORS_LENGTH: "Jumlah nilai prior kelas tidak sama dengan jumlah kelas target.",
  AM_E_PRIORS_INVALID: "Nilai prior kelas harus berada di antara 0 dan 1 dan berjumlah 1.",
  AM_E_PARAM_INVALID: "Parameter \"{detail}\" pada model harus berupa bilangan lebih besar dari 0.",
  AM_E_FEATURE_ORDER_MISMATCH: "Urutan fitur (feature_order) tidak sesuai dengan daftar fitur pada model.",
  AM_E_ROLE_INVALID: "Fitur \"{detail}\" memiliki peran yang tidak dikenal; peran yang valid adalah categorical atau numerical.",
  AM_E_CATEGORIES_INVALID: "Daftar kategori fitur \"{detail}\" kosong atau berisi kategori yang duplikat.",
  AM_E_DISTRIBUTION_CLASS_MISSING: "Distribusi probabilitas fitur \"{detail}\" tidak memuat semua kelas target.",
  AM_E_DISTRIBUTION_LENGTH: "Jumlah probabilitas pada fitur \"{detail}\" tidak sama dengan jumlah kategorinya.",
  AM_E_DISTRIBUTION_SUM: "Probabilitas fitur \"{detail}\" tidak valid atau tidak berjumlah 1 untuk setiap kelas.",
  AM_E_GAUSSIAN_CLASS_MISSING: "Parameter mean atau variance fitur \"{detail}\" tidak memuat semua kelas target.",
  AM_E_GAUSSIAN_INVALID: "Nilai mean atau variance fitur \"{detail}\" tidak valid; variance harus lebih besar dari 0.",
  AM_E_COUNTS_INVALID: "Jumlah data per kelas (class_counts) pada model tidak ada atau tidak valid.",
  AM_E_COUNTS_INCONSISTENT: "Jumlah data per kelas (class_counts) tidak konsisten dengan prior kelas pada model.",
  AM_E_CLASS_TOTALS_INVALID: "Total data per kelas (class_totals) pada fitur \"{detail}\" tidak ada atau tidak valid.",

  // --- Pemetaan variabel (§3.4) ---
  AM_E_MAP_UNMAPPED: "Fitur \"{detail}\" belum dipetakan ke variabel dataset.",
  AM_E_MAP_VAR_NOT_FOUND: "Variabel \"{detail}\" yang dipetakan tidak ditemukan di dataset aktif.",
  AM_E_MAP_DUPLICATE: "Variabel \"{detail}\" dipetakan ke lebih dari satu fitur.",
  AM_E_MAP_MEASURE_UNKNOWN: "Variabel \"{detail}\" memiliki measurement level Unknown; ubah dulu di Variable View.",
  AM_E_MAP_ROLE_MISMATCH: "Fitur \"{detail}\" tidak cocok dengan measurement level variabel yang dipilih.",
  AM_E_MAP_NUMERIC_TYPE: "Fitur numerik \"{detail}\" harus dipetakan ke variabel bertipe numerik, bukan string.",
  AM_E_ACTUAL_NOT_FOUND: "Variabel target sebenarnya \"{detail}\" tidak ditemukan di dataset aktif.",
  AM_E_ACTUAL_MEASURE: "Variabel target sebenarnya \"{detail}\" harus bermeasure nominal atau ordinal.",
  AM_E_ACTUAL_IS_PREDICTOR: "Variabel target sebenarnya \"{detail}\" tidak boleh sama dengan variabel prediktor.",

  // --- Nama kolom output (§3.5) ---
  AM_E_NAME_EMPTY: "Nama kolom \"{detail}\" tidak boleh kosong.",
  AM_E_NAME_INVALID: "Nama kolom \"{detail}\" tidak valid; harus diawali huruf, @, #, atau $ dan hanya memuat huruf, angka, titik, garis bawah, @, #, atau $.",
  AM_E_NAME_TOO_LONG: "Nama kolom \"{detail}\" melebihi batas 64 karakter.",
  AM_E_NAME_RESERVED: "Nama kolom \"{detail}\" adalah kata cadangan dan tidak boleh dipakai.",
  AM_E_NAME_DUPLICATE: "Nama kolom \"{detail}\" dipakai lebih dari satu kali pada kolom hasil.",

  // --- Eksekusi (§5.8, §6.6) ---
  AM_E_NO_MODEL: "Belum ada model yang dimuat; muat model terlebih dahulu.",
  AM_E_NO_ROWS: "Dataset aktif tidak berisi baris data pada variabel yang dipetakan.",
  AM_E_PAYLOAD: "Data yang dikirim ke mesin prediksi tidak konsisten dengan model.",
  AM_E_WORKER: "Mesin prediksi gagal dijalankan. Muat ulang halaman lalu coba lagi.",

  // --- Warning ---
  AM_W_LEGACY_SCHEMA: "Model ini memakai format lama (1.0). Kategori yang tidak dikenal akan dilewati saat prediksi. Ekspor ulang model dari menu Naive Bayes untuk hasil yang konsisten.",
  AM_W_UNSEEN_SKIPPED_LEGACY: "Sebagian baris memiliki kategori yang tidak dikenal model (format 1.0), sehingga fitur tersebut dilewati saat prediksi.",
  AM_W_UNSEEN_CATEGORY: "Sebagian baris memiliki kategori yang tidak dikenal model dan dihitung dengan smoothing.",
  AM_W_ROWS_NOT_SCORED: "Sebagian baris tidak diprediksi karena seluruh variabel prediktornya kosong.",
  AM_W_ACTUAL_UNKNOWN_CLASS: "Sebagian baris dikeluarkan dari evaluasi karena kelas sebenarnya tidak dikenal oleh model.",
  AM_W_NAME_ADJUSTED: "Sebagian nama kolom disesuaikan otomatis karena bentrok atau tidak valid.",
  AM_W_NO_RESULT_STORE_MODELS: "Belum ada model Naive Bayes yang tersimpan di Output Viewer.",
  AM_W_BUILTIN_EMPTY: "Belum ada model bawaan Statify.",
};
