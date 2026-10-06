// AGENTS.md §3.1 — representasi TS dari `ExportedModel`
// (NB/rust/src/stats/save.rs:139-159). Nama field TIDAK boleh diubah (P1).
// Field bertanda (1.1) hanya wajib bila `schema_version === "1.1"`.
// (v2) Untuk schema "2.0" field bertanda (1.1) juga wajib (AGENTS_V2.md §8).
// AGENTS_V2.md §8 — schema "2.0" menambah `features[].likelihood`/`min_variance`
// dan blok `text`. Model 1.0/1.1 tetap valid tanpa field tambahan tersebut.

export type NaiveBayesSchemaVersion = "1.0" | "1.1" | "2.0";

export type NaiveBayesExportValidationConfig = {
  method: "holdout" | "kfold";
  training_percentage: number | null;
  holdout_percentage: number | null;
  folds: number | null;
  seed: number | null;
};

export type NaiveBayesExportCategoricalFeature = {
  name: string;
  role: "categorical";
  likelihood?: "categorical"; // (2.0) selalu "categorical"
  categories: string[]; // urutan = index probabilitas
  distribution: Record<string, number[]>; // class -> prob per kategori (sudah smoothing)
  class_totals?: Record<string, number>; // (1.1) class -> jumlah baris kelas itu saat training
};

export type NaiveBayesNumericLikelihood = "gaussian" | "gaussian_minstd";

export type NaiveBayesExportNumericalFeature = {
  name: string;
  role: "numerical";
  likelihood?: NaiveBayesNumericLikelihood; // (2.0) default "gaussian" bila tidak ada
  mean: Record<string, number>; // class -> mean
  variance: Record<string, number>; // class -> variance (SUDAH melalui variance floor / min-std)
  min_variance?: number | null; // (2.0) null bila gaussian; > 0 bila gaussian_minstd
};

export type NaiveBayesExportFeature =
  | NaiveBayesExportCategoricalFeature
  | NaiveBayesExportNumericalFeature;

// ---------------------------------------------------------------------------
// Schema 2.0 — blok Text (AGENTS_V2.md §8)
// ---------------------------------------------------------------------------

export type NaiveBayesTextSourceKind = "raw" | "vector";
export type NaiveBayesTextLikelihood = "multinomial" | "bernoulli" | "complement";

// Konfigurasi resep (CORE/src/config.rs, snake_case, PLAN_FIX §3.1). Validasi
// isi konfigurasi dilakukan oleh CORE saat `transform`, bukan oleh adapter TS.
export type TextVectorizerRecipeConfig = {
  lowercase: boolean;
  stopwords_method: string;
  custom_stopwords?: string | null;
  stemming_method: string;
  delimiters: string;
  ngram_min: number;
  ngram_max: number;
  formula_standard?: string;
  tf_method: string;
  idf_method: string;
  normalization?: string;
  words_to_keep: number;
  min_term_freq?: number;
};

// "Resep" `TextVectorizerModel` dari CORE (PLAN_FIX §3.4).
export type TextVectorizerRecipe = {
  recipe_version: string;
  config: TextVectorizerRecipeConfig;
  resolved_stopwords: string[];
  vocabulary: string[]; // urutan kolom
  idf: number[]; // sejajar vocabulary
  doc_freq: number[]; // sejajar vocabulary
  n_docs: number;
  avg_doc_norm: number | null;
};

export type NaiveBayesExportText = {
  source: NaiveBayesTextSourceKind;
  likelihood: NaiveBayesTextLikelihood;
  alpha: number; // > 0
  terms: string[]; // urutan indeks parameter; raw = recipe.vocabulary; vector = nama kolom
  raw_variable: string | null; // wajib bila source = raw
  columns: string[] | null; // wajib bila source = vector (sama dengan terms)
  log_weights: Record<string, number[]>; // class -> L_ct
  log_weights_absent: Record<string, number[]> | null; // class -> A_ct, hanya bernoulli
  class_term_counts: Record<string, number[]>; // N_ct / n_ct / C_ct
  uses_class_prior: boolean; // false hanya complement dengan K >= 2
  recipe: TextVectorizerRecipe | null; // wajib bila source = raw
};

export type NaiveBayesExportedModel = {
  schema_version: NaiveBayesSchemaVersion;
  model_type: "naive_bayes";
  trained_at: string; // ISO 8601
  target: {
    name: string;
    classes: string[]; // urutan alfabetis (byte-wise) dari NB
    class_priors: number[]; // sejajar index dengan classes
    class_counts?: number[]; // (1.1) sejajar index dengan classes, integer >= 0
  };
  features: NaiveBayesExportFeature[]; // (2.0) boleh kosong bila `text` terisi
  smoothing_alpha: number; // > 0
  variance_floor: number; // > 0
  feature_order: string[]; // (2.0) hanya fitur Numeric/Categorical; boleh kosong bila `text` terisi
  label_mapping: Record<string, number>;
  validation_config: NaiveBayesExportValidationConfig;
  missing_value_policy: string;
  unseen_category_policy: string;
  text?: NaiveBayesExportText | null; // (2.0) null/tidak ada = tanpa fitur Text
};
