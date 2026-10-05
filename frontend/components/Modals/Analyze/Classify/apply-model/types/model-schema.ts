// AGENTS.md §3.1 — representasi TS dari `ExportedModel`
// (NB/rust/src/stats/save.rs:139-159). Nama field TIDAK boleh diubah (P1).
// Field bertanda (1.1) hanya wajib bila `schema_version === "1.1"`.

export type NaiveBayesSchemaVersion = "1.0" | "1.1";

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
  categories: string[]; // urutan = index probabilitas
  distribution: Record<string, number[]>; // class -> prob per kategori (sudah smoothing)
  class_totals?: Record<string, number>; // (1.1) class -> jumlah baris kelas itu saat training
};

export type NaiveBayesExportNumericalFeature = {
  name: string;
  role: "numerical";
  mean: Record<string, number>; // class -> mean
  variance: Record<string, number>; // class -> variance (SUDAH melalui variance floor)
};

export type NaiveBayesExportFeature =
  | NaiveBayesExportCategoricalFeature
  | NaiveBayesExportNumericalFeature;

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
  features: NaiveBayesExportFeature[];
  smoothing_alpha: number; // > 0
  variance_floor: number; // > 0
  feature_order: string[];
  label_mapping: Record<string, number>;
  validation_config: NaiveBayesExportValidationConfig;
  missing_value_policy: string;
  unseen_category_policy: string;
};
