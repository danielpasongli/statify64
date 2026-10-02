// AGENTS.md §3.6 — payload worker & hasil mentah dari Rust.
// Import tipe NB bersifat read-only (AGENTS.md §7.3).

import type {
  NaiveBayesConfusionMatrixRaw,
  NaiveBayesEvaluationMetricsRaw,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";
import type { ApplyModelWarningCode } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

export type ApplyModelWorkerPayload = {
  predictors: Record<string, string | number | null>[][]; // satu slice per fitur, urutan descriptor.features
  predictorDefs: unknown[][]; // getVarDefs, urutan sama
  mapping: Array<{ feature: string; variable: string }>; // urutan sama dengan predictors
  actual: Record<string, string | number | null>[][]; // [] atau satu slice
  actualDefs: unknown[][]; // [] atau satu defs
  model: unknown; // ModelJson apa adanya
};

export type ApplyModelRawResult = {
  model_summary: {
    model_type: string;
    schema_version: string;
    trained_at: string | null;
    target_name: string;
    classes: string[];
    features: Array<{
      name: string;
      role: "categorical" | "numerical";
      mapped_variable: string;
    }>;
    parameters: Array<{ label: string; value: string }>; // NB: Smoothing alpha, Variance floor, Validation (training)
    legacy_unseen_handling: boolean; // true bila schema 1.0
  };
  case_processing_summary: {
    total_rows: number;
    scored_rows: number;
    not_scored_all_missing: number;
    rows_with_missing_predictor: number; // >=1 prediktor missing tapi tetap diprediksi
    rows_with_unseen_category: number; // >=1 kategori tak dikenal
  };
  prediction_distribution: {
    classes: string[];
    counts: number[]; // sejajar classes
    percentages: number[]; // terhadap scored_rows, 0..100; 0 bila scored_rows = 0
    not_scored: number;
  };
  predictions: {
    predicted: Array<string | null>; // panjang = total_rows
    max_probability: Array<number | null>; // dibulatkan 4 desimal
    class_probabilities: Array<Array<number | null>>; // [classIdx][row], dibulatkan 4 desimal
  };
  evaluation: null | {
    evaluated_rows: number;
    excluded_actual_missing: number;
    excluded_actual_unknown_class: number;
    excluded_not_scored: number;
    confusion_matrix: NaiveBayesConfusionMatrixRaw; // tipe dari NB formatter
    evaluation_metrics: NaiveBayesEvaluationMetricsRaw; // tipe dari NB formatter
  };
  warnings: Array<{
    code: ApplyModelWarningCode;
    count: number;
    message: string;
  }>;
};
