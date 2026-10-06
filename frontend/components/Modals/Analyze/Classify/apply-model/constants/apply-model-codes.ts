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
  // v2 (AGENTS_V2.md §10.1–10.2, §10.4)
  | "AM_E_NB2_TEXT_SHAPE" | "AM_E_NB2_TEXT_SOURCE" | "AM_E_NB2_LIKELIHOOD" | "AM_E_NB2_COMPLEMENT_MIXED"
  | "AM_E_MAP_RAW_TEXT_UNMAPPED" | "AM_E_MAP_RAW_TEXT_TYPE" | "AM_E_TEXT_NEGATIVE"
  | "AM_E_ACTUAL_NOT_FOUND" | "AM_E_ACTUAL_MEASURE" | "AM_E_ACTUAL_IS_PREDICTOR"
  | "AM_E_NAME_EMPTY" | "AM_E_NAME_INVALID" | "AM_E_NAME_TOO_LONG" | "AM_E_NAME_RESERVED" | "AM_E_NAME_DUPLICATE"
  | "AM_E_NO_MODEL" | "AM_E_NO_ROWS" | "AM_E_PAYLOAD" | "AM_E_WORKER";

export type ApplyModelWarningCode =
  | "AM_W_LEGACY_SCHEMA" | "AM_W_UNSEEN_SKIPPED_LEGACY" | "AM_W_UNSEEN_CATEGORY"
  | "AM_W_ROWS_NOT_SCORED" | "AM_W_ACTUAL_UNKNOWN_CLASS" | "AM_W_NAME_ADJUSTED"
  | "AM_W_NO_RESULT_STORE_MODELS" | "AM_W_BUILTIN_EMPTY"
  | "AM_W_TEXT_ALL_ZERO_FILLED"; // v2 (AGENTS_V2.md §10.2, V10)

// v2 (AGENTS_V2.md §10.2): catatan informatif, tidak pernah memblokir OK.
export type ApplyModelInfoCode = "AM_I_TEXT_ZERO_FILLED";

export type ApplyModelIssue = {
  code: ApplyModelErrorCode | ApplyModelWarningCode | ApplyModelInfoCode;
  severity: "error" | "warning" | "info";
  detail?: string; // mis. path field, nama fitur, nama kolom
};

// Daftar semua kode (urutan = urutan union di atas). Dipakai test untuk
// memastikan setiap kode punya entri di APPLY_MODEL_MESSAGES.
export const ALL_APPLY_MODEL_CODES: ReadonlyArray<
  ApplyModelErrorCode | ApplyModelWarningCode | ApplyModelInfoCode
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
  "AM_E_NB2_TEXT_SHAPE", "AM_E_NB2_TEXT_SOURCE", "AM_E_NB2_LIKELIHOOD", "AM_E_NB2_COMPLEMENT_MIXED",
  "AM_E_MAP_RAW_TEXT_UNMAPPED", "AM_E_MAP_RAW_TEXT_TYPE", "AM_E_TEXT_NEGATIVE",
  "AM_E_ACTUAL_NOT_FOUND", "AM_E_ACTUAL_MEASURE", "AM_E_ACTUAL_IS_PREDICTOR",
  "AM_E_NAME_EMPTY", "AM_E_NAME_INVALID", "AM_E_NAME_TOO_LONG", "AM_E_NAME_RESERVED", "AM_E_NAME_DUPLICATE",
  "AM_E_NO_MODEL", "AM_E_NO_ROWS", "AM_E_PAYLOAD", "AM_E_WORKER",
  "AM_W_LEGACY_SCHEMA", "AM_W_UNSEEN_SKIPPED_LEGACY", "AM_W_UNSEEN_CATEGORY",
  "AM_W_ROWS_NOT_SCORED", "AM_W_ACTUAL_UNKNOWN_CLASS", "AM_W_NAME_ADJUSTED",
  "AM_W_NO_RESULT_STORE_MODELS", "AM_W_BUILTIN_EMPTY", "AM_W_TEXT_ALL_ZERO_FILLED",
  "AM_I_TEXT_ZERO_FILLED",
];

// Pesan galat ditampilkan sebagai kalimat Inggris yang ramah, dengan kode internal di
// akhir dalam kurung (PLAN_V3_UI_EN §0 E3), mis. `... (AM_E_MAP_UNMAPPED)`.
// Peringatan (AM_W_*) dan info (AM_I_*) tidak memakai akhiran kode.
const withCode = (code: ApplyModelErrorCode, text: string): string => `${text} (${code})`;

export const APPLY_MODEL_MESSAGES: Record<
  ApplyModelErrorCode | ApplyModelWarningCode | ApplyModelInfoCode,
  string
> = {
  // --- Pemuatan model ---
  AM_E_PARSE: withCode("AM_E_PARSE", "The model content could not be read as valid JSON."),
  AM_E_FILE_TOO_LARGE: withCode("AM_E_FILE_TOO_LARGE", "The model file is larger than the 10 MB limit."),
  AM_E_BUILTIN_FETCH: withCode("AM_E_BUILTIN_FETCH", "The built-in Statify model could not be downloaded. Check your connection and try again."),

  // --- Validasi umum & adapter ---
  AM_E_NOT_OBJECT: withCode("AM_E_NOT_OBJECT", "The model content must be a JSON object, not an array or a single value."),
  AM_E_MODEL_TYPE_MISSING: withCode("AM_E_MODEL_TYPE_MISSING", "The field \"model_type\" is missing from the model or is not text."),
  AM_E_MODEL_TYPE_UNSUPPORTED: withCode("AM_E_MODEL_TYPE_UNSUPPORTED", "The model type \"{detail}\" is not supported by Apply Model."),
  AM_E_SCHEMA_VERSION_UNSUPPORTED: withCode("AM_E_SCHEMA_VERSION_UNSUPPORTED", "The model format version \"{detail}\" is not supported. Supported versions: 1.0, 1.1, 2.0."),
  AM_E_FIELD_MISSING: withCode("AM_E_FIELD_MISSING", "The required field \"{detail}\" is missing from the model."),
  AM_E_FIELD_TYPE: withCode("AM_E_FIELD_TYPE", "The field \"{detail}\" in the model has the wrong data type."),
  AM_E_CLASSES_EMPTY: withCode("AM_E_CLASSES_EMPTY", "The model does not list any target classes."),
  AM_E_CLASSES_DUPLICATE: withCode("AM_E_CLASSES_DUPLICATE", "The target classes in the model contain duplicate class names."),
  AM_E_PRIORS_LENGTH: withCode("AM_E_PRIORS_LENGTH", "The number of class priors does not match the number of target classes."),
  AM_E_PRIORS_INVALID: withCode("AM_E_PRIORS_INVALID", "Class priors must be between 0 and 1 and sum to 1."),
  AM_E_PARAM_INVALID: withCode("AM_E_PARAM_INVALID", "The parameter \"{detail}\" in the model must be a number greater than 0."),
  AM_E_FEATURE_ORDER_MISMATCH: withCode("AM_E_FEATURE_ORDER_MISMATCH", "The feature order (feature_order) does not match the list of features in the model."),
  AM_E_ROLE_INVALID: withCode("AM_E_ROLE_INVALID", "The feature \"{detail}\" has an unknown role; valid roles are categorical or numerical."),
  AM_E_CATEGORIES_INVALID: withCode("AM_E_CATEGORIES_INVALID", "The category list of feature \"{detail}\" is empty or contains duplicate categories."),
  AM_E_DISTRIBUTION_CLASS_MISSING: withCode("AM_E_DISTRIBUTION_CLASS_MISSING", "The probability distribution of feature \"{detail}\" does not cover all target classes."),
  AM_E_DISTRIBUTION_LENGTH: withCode("AM_E_DISTRIBUTION_LENGTH", "The number of probabilities for feature \"{detail}\" does not match its number of categories."),
  AM_E_DISTRIBUTION_SUM: withCode("AM_E_DISTRIBUTION_SUM", "The probabilities of feature \"{detail}\" are invalid or do not sum to 1 for every class."),
  AM_E_GAUSSIAN_CLASS_MISSING: withCode("AM_E_GAUSSIAN_CLASS_MISSING", "The mean or variance of feature \"{detail}\" does not cover all target classes."),
  AM_E_GAUSSIAN_INVALID: withCode("AM_E_GAUSSIAN_INVALID", "The mean or variance of feature \"{detail}\" is invalid; variance must be greater than 0."),
  AM_E_COUNTS_INVALID: withCode("AM_E_COUNTS_INVALID", "The number of cases per class (class_counts) is missing or invalid in the model."),
  AM_E_COUNTS_INCONSISTENT: withCode("AM_E_COUNTS_INCONSISTENT", "The number of cases per class (class_counts) is inconsistent with the class priors in the model."),
  AM_E_CLASS_TOTALS_INVALID: withCode("AM_E_CLASS_TOTALS_INVALID", "The total per class (class_totals) of feature \"{detail}\" is missing or invalid."),

  // --- Pemetaan variabel ---
  AM_E_MAP_UNMAPPED: withCode("AM_E_MAP_UNMAPPED", "Feature \"{detail}\" is not mapped to a dataset variable."),
  AM_E_MAP_VAR_NOT_FOUND: withCode("AM_E_MAP_VAR_NOT_FOUND", "The mapped variable \"{detail}\" was not found in the active dataset."),
  AM_E_MAP_DUPLICATE: withCode("AM_E_MAP_DUPLICATE", "The variable \"{detail}\" is mapped to more than one feature."),
  AM_E_MAP_MEASURE_UNKNOWN: withCode("AM_E_MAP_MEASURE_UNKNOWN", "The variable \"{detail}\" has an Unknown measurement level; change it in Variable View first."),
  AM_E_MAP_ROLE_MISMATCH: withCode("AM_E_MAP_ROLE_MISMATCH", "Feature \"{detail}\" does not match the measurement level of the selected variable."),
  AM_E_MAP_NUMERIC_TYPE: withCode("AM_E_MAP_NUMERIC_TYPE", "The numerical feature \"{detail}\" must be mapped to a numeric variable, not a string variable."),

  // --- Schema 2.0 / fitur teks ---
  AM_E_NB2_TEXT_SHAPE: withCode("AM_E_NB2_TEXT_SHAPE", "The text feature parameters in the model are inconsistent (\"{detail}\"): the term list, weights or counts per class differ in length."),
  AM_E_NB2_TEXT_SOURCE: withCode("AM_E_NB2_TEXT_SOURCE", "The text feature block in the model is incomplete or its source is unknown (\"{detail}\"). A model trained on raw text needs its text preprocessing settings and text variable name; a model trained on word vectors needs a list of columns."),
  AM_E_NB2_LIKELIHOOD: withCode("AM_E_NB2_LIKELIHOOD", "The likelihood type or prior setting in the model is invalid ({detail})."),
  AM_E_NB2_COMPLEMENT_MIXED: withCode("AM_E_NB2_COMPLEMENT_MIXED", "A Complement Naive Bayes model can only contain text features, but this model also contains numerical or categorical features."),
  AM_E_MAP_RAW_TEXT_UNMAPPED: withCode("AM_E_MAP_RAW_TEXT_UNMAPPED", "The raw text variable \"{detail}\" is not mapped to a dataset variable."),
  AM_E_MAP_RAW_TEXT_TYPE: withCode("AM_E_MAP_RAW_TEXT_TYPE", "The raw text variable \"{detail}\" must be mapped to a string variable."),
  // {detail} diisi nama kolom (dan jumlah kolom lain) oleh getUserFriendlyApplyModelError.
  AM_E_TEXT_NEGATIVE: withCode("AM_E_TEXT_NEGATIVE", "Negative values were found in text vector column {detail}. Text likelihoods (Multinomial, Bernoulli and Complement) require values >= 0. Check that the column is a real word vector (not a standardized/PCA column or a missing-value code such as -1) and remove it from the mapping."),

  AM_E_ACTUAL_NOT_FOUND: withCode("AM_E_ACTUAL_NOT_FOUND", "The actual target variable \"{detail}\" was not found in the active dataset."),
  AM_E_ACTUAL_MEASURE: withCode("AM_E_ACTUAL_MEASURE", "The actual target variable \"{detail}\" must have a nominal or ordinal measurement level."),
  AM_E_ACTUAL_IS_PREDICTOR: withCode("AM_E_ACTUAL_IS_PREDICTOR", "The actual target variable \"{detail}\" cannot be the same as a predictor variable."),

  // --- Nama kolom output ---
  AM_E_NAME_EMPTY: withCode("AM_E_NAME_EMPTY", "The column name \"{detail}\" cannot be empty."),
  AM_E_NAME_INVALID: withCode("AM_E_NAME_INVALID", "The column name \"{detail}\" is invalid; it must start with a letter, @, #, or $ and contain only letters, digits, periods, underscores, @, #, or $."),
  AM_E_NAME_TOO_LONG: withCode("AM_E_NAME_TOO_LONG", "The column name \"{detail}\" is longer than 64 characters."),
  AM_E_NAME_RESERVED: withCode("AM_E_NAME_RESERVED", "The column name \"{detail}\" is a reserved word and cannot be used."),
  AM_E_NAME_DUPLICATE: withCode("AM_E_NAME_DUPLICATE", "The column name \"{detail}\" is used more than once among the result columns."),

  // --- Eksekusi ---
  AM_E_NO_MODEL: withCode("AM_E_NO_MODEL", "No model is loaded yet; load a model first."),
  AM_E_NO_ROWS: withCode("AM_E_NO_ROWS", "The active dataset has no data rows for the mapped variables."),
  AM_E_PAYLOAD: withCode("AM_E_PAYLOAD", "The data sent to the analysis engine does not match the model."),
  AM_E_WORKER: withCode("AM_E_WORKER", "The analysis engine failed to run. Reload the page and try again."),

  // --- Warning ---
  AM_W_LEGACY_SCHEMA: "This model uses the old format (1.0). Unknown categories are skipped during prediction. Export the model again from the Naive Bayes menu for consistent results.",
  AM_W_UNSEEN_SKIPPED_LEGACY: "Some rows have categories unknown to the model (format 1.0), so those features are skipped during prediction.",
  AM_W_UNSEEN_CATEGORY: "Some rows have categories unknown to the model; they are scored with smoothing.",
  AM_W_ROWS_NOT_SCORED: "Some rows were not scored because all of their predictor variables are empty.",
  AM_W_ACTUAL_UNKNOWN_CLASS: "Some rows were excluded from the evaluation because their actual class is not known to the model.",
  AM_W_NAME_ADJUSTED: "Some column names were adjusted automatically because they conflict with existing names or are invalid.",
  AM_W_NO_RESULT_STORE_MODELS: "No Naive Bayes models are saved in the Output Viewer yet.",
  AM_W_BUILTIN_EMPTY: "There are no built-in Statify models yet.",

  AM_W_TEXT_ALL_ZERO_FILLED: "None of the model's word-vector columns were found in the dataset, and the model has no other features. No rows will be scored. Check the vector column names in the dataset.",

  // --- Info ---
  AM_I_TEXT_ZERO_FILLED: "{detail} word-vector columns of the model were not found in the dataset and are treated as 0.",
};
