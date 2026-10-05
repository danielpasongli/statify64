// naive-bayes-analysis-formatter.ts
//
// Mengubah struktur mentah hasil analisis Naive Bayes (baik dari stub JSON
// Fase 7 maupun nanti dari WASM — bentuknya sengaja disamakan sejak awal,
// lihat PLAN.md Fase 7.2) menjadi `Table[]` yang dipahami output viewer
// aplikasi (types/Table.ts), mengikuti pola
// `nearest-neighbor-analysis-formatter.ts`.
//
// Skema angka/istilah di sini wajib konsisten dengan AGENTS.md §5.

import type { Table, ResultJson } from "@/types/Table";

/* =========================
   TIPE STRUKTUR MENTAH
   (bentuk yang disepakati dipakai stub JSON Fase 7 maupun payload WASM nanti)
========================= */

export type NaiveBayesValidationScenario = {
  method: "holdout" | "kfold";
  training_percentage: number | null;
  holdout_percentage: number | null;
  folds: number | null;
  seed: number | null;
};

export type NaiveBayesCaseProcessingSummaryRaw = {
  total_instances: number;
  valid_instances: number;
  excluded_target_missing: number;
  target_variable: string;
  attribute_variables: string[];
  validation_scenario: NaiveBayesValidationScenario;
};

export type NaiveBayesCategoricalPerClass = {
  class: string;
  raw_count: number;
  smoothed_count: number;
  probability: number;
  total: number;
};

export type NaiveBayesCategoricalAttribute = {
  name: string;
  role: "categorical";
  classes: string[];
  categories: Array<{
    category: string;
    per_class: NaiveBayesCategoricalPerClass[];
  }>;
};

export type NaiveBayesNumericalAttribute = {
  name: string;
  role: "numerical";
  classes: string[];
  numeric: {
    per_class: Array<{ class: string; mean: number; std_dev: number }>;
  };
};

export type NaiveBayesAttributeDistributionRaw =
  | NaiveBayesCategoricalAttribute
  | NaiveBayesNumericalAttribute;

export type NaiveBayesEvaluationMetricsRaw = {
  classes: string[];
  per_class: Array<{
    class: string;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
  macro_avg: { precision: number; recall: number; f1: number };
  weighted_avg: { precision: number; recall: number; f1: number };
  micro_avg: { precision: number; recall: number; f1: number };
  overall_accuracy: number;
  cohens_kappa: number;
};

export type NaiveBayesConfusionMatrixRaw = {
  classes: string[];
  matrix: number[][];
  row_totals: number[];
  col_totals: number[];
  grand_total: number;
  percentages: number[][];
};

export type NaiveBayesTrainedModelRaw = {
  schema_version: string;
  model_type: string;
  trained_at: string;
  target: {
    name: string;
    classes: string[];
    class_priors: number[];
    class_counts?: number[];
  };
  features: unknown[];
  smoothing_alpha: number;
  variance_floor: number;
  feature_order: string[];
  label_mapping: Record<string, number>;
  validation_config: NaiveBayesValidationScenario;
  missing_value_policy: string;
  unseen_category_policy: string;
};

export type NaiveBayesRawResult = {
  case_processing_summary?: NaiveBayesCaseProcessingSummaryRaw;
  attribute_distribution?: NaiveBayesAttributeDistributionRaw[];
  evaluation_metrics?: NaiveBayesEvaluationMetricsRaw;
  confusion_matrix?: NaiveBayesConfusionMatrixRaw;
  trained_model?: NaiveBayesTrainedModelRaw;
};

const formatNumber = (value: number, decimals = 3): number =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;

const describeValidationScenario = (
  scenario: NaiveBayesValidationScenario
): string => {
  if (scenario.method === "holdout") {
    return `Training/Holdout split (${scenario.training_percentage}% / ${scenario.holdout_percentage}%)${
      scenario.seed !== null ? `, seed ${scenario.seed}` : ""
    }`;
  }
  return `${scenario.folds}-fold cross-validation${
    scenario.seed !== null ? `, seed ${scenario.seed}` : ""
  }`;
};

/**
 * Case Processing Summary (AGENTS.md §5.4): total instance, valid, dibuang
 * karena target missing, target, daftar atribut, dan skenario validasi.
 */
export function buildCaseProcessingSummaryTable(
  raw: NaiveBayesCaseProcessingSummaryRaw
): Table {
  return {
    key: "case_processing_summary",
    title: "Case Processing Summary",
    columnHeaders: [
      { header: "", key: "label" },
      { header: "Value", key: "value" },
    ],
    rows: [
      { rowHeader: ["Total Instances"], value: raw.total_instances },
      { rowHeader: ["Valid Instances"], value: raw.valid_instances },
      {
        rowHeader: ["Excluded (Target Missing)"],
        value: raw.excluded_target_missing,
      },
      { rowHeader: ["Target Variable"], value: raw.target_variable },
      {
        rowHeader: ["Attribute Variables"],
        value: raw.attribute_variables.join(", "),
      },
      {
        rowHeader: ["Validation Scenario"],
        value: describeValidationScenario(raw.validation_scenario),
      },
    ],
  };
}

/**
 * Attribute Distribution Table gaya WEKA (AGENTS.md §5.8): kategorik ->
 * sub-baris per kategori dengan raw count, smoothed count, probability,
 * total per kelas; numerik -> mean & std dev per kelas (tanpa weighted sum).
 */
export function buildAttributeDistributionTable(
  attributes: NaiveBayesAttributeDistributionRaw[]
): Table {
  const classes = attributes[0]?.classes ?? [];

  const columnHeaders = [
    { header: "Attribute", key: "attribute" },
    { header: "Category / Stat", key: "categoryStat" },
    ...classes.map((className) => ({
      header: className,
      key: className,
    })),
  ];

  const rows = attributes.flatMap((attribute) => {
    if (attribute.role === "categorical") {
      return attribute.categories.map((category) => {
        const row: Table["rows"][number] = {
          rowHeader: [attribute.name, category.category],
        };
        category.per_class.forEach((perClass) => {
          row[perClass.class] =
            `${perClass.raw_count} / ${perClass.smoothed_count} (${formatNumber(
              perClass.probability * 100,
              1
            )}%) of ${perClass.total}`;
        });
        return row;
      });
    }

    const meanRow: Table["rows"][number] = {
      rowHeader: [attribute.name, "Mean"],
    };
    const stdDevRow: Table["rows"][number] = {
      rowHeader: [attribute.name, "Std. Dev."],
    };
    attribute.numeric.per_class.forEach((perClass) => {
      meanRow[perClass.class] = formatNumber(perClass.mean);
      stdDevRow[perClass.class] = formatNumber(perClass.std_dev);
    });
    return [meanRow, stdDevRow];
  });

  return {
    key: "attribute_distribution_table",
    title: "Attribute Distribution Table",
    columnHeaders,
    rows,
    note:
      "Categorical cells show raw count / smoothed count (percentage) of class total. Numerical rows show mean and standard deviation (no weighted sum, per AGENTS.md §5.8).",
  };
}

/**
 * Model Evaluation Metrics (AGENTS.md §5.6): per kelas Accuracy, Precision,
 * Recall, F1, plus agregat macro/weighted/micro average dan overall
 * accuracy dalam satu tabel; Cohen's Kappa ditampilkan terpisah sebagai satu
 * angka overall (bukan per kelas).
 */
export function buildEvaluationMetricsTables(
  raw: NaiveBayesEvaluationMetricsRaw
): Table[] {
  const metricsColumnHeaders = [
    { header: "", key: "class" },
    { header: "Accuracy", key: "accuracy" },
    { header: "Precision", key: "precision" },
    { header: "Recall", key: "recall" },
    { header: "F1-Score", key: "f1" },
  ];

  const perClassRows = raw.per_class.map((row) => ({
    rowHeader: [row.class],
    accuracy: formatNumber(row.accuracy),
    precision: formatNumber(row.precision),
    recall: formatNumber(row.recall),
    f1: formatNumber(row.f1),
  }));

  const aggregateRows = [
    {
      rowHeader: ["Macro Average"],
      accuracy: null,
      precision: formatNumber(raw.macro_avg.precision),
      recall: formatNumber(raw.macro_avg.recall),
      f1: formatNumber(raw.macro_avg.f1),
    },
    {
      rowHeader: ["Weighted Average"],
      accuracy: null,
      precision: formatNumber(raw.weighted_avg.precision),
      recall: formatNumber(raw.weighted_avg.recall),
      f1: formatNumber(raw.weighted_avg.f1),
    },
    {
      rowHeader: ["Micro Average"],
      accuracy: null,
      precision: formatNumber(raw.micro_avg.precision),
      recall: formatNumber(raw.micro_avg.recall),
      f1: formatNumber(raw.micro_avg.f1),
    },
    {
      rowHeader: ["Overall Accuracy"],
      accuracy: formatNumber(raw.overall_accuracy),
      precision: null,
      recall: null,
      f1: null,
    },
  ];

  const metricsTable: Table = {
    key: "evaluation_metrics",
    title: "Model Evaluation Metrics",
    columnHeaders: metricsColumnHeaders,
    rows: [...perClassRows, ...aggregateRows],
  };

  const kappaTable: Table = {
    key: "evaluation_metrics_kappa",
    title: "Cohen's Kappa",
    columnHeaders: [
      { header: "", key: "label" },
      { header: "Value", key: "value" },
    ],
    rows: [
      { rowHeader: ["Cohen's Kappa (overall)"], value: formatNumber(raw.cohens_kappa) },
    ],
    note: "Cohen's Kappa is an overall statistic — it is not broken down per class (AGENTS.md §5.6).",
  };

  return [metricsTable, kappaTable];
}

/**
 * Confusion Matrix (AGENTS.md §5.7): baris = actual, kolom = predicted,
 * dengan count, total (baris/kolom/grand total), dan persentase.
 */
export function buildConfusionMatrixTable(
  raw: NaiveBayesConfusionMatrixRaw
): Table {
  const columnHeaders = [
    { header: "Actual \\ Predicted", key: "actual" },
    ...raw.classes.map((className) => ({ header: className, key: className })),
    { header: "Total", key: "total" },
  ];

  const rows = raw.classes.map((actualClass, rowIndex) => {
    const row: Table["rows"][number] = { rowHeader: [actualClass] };
    raw.classes.forEach((predictedClass, colIndex) => {
      const count = raw.matrix[rowIndex]?.[colIndex] ?? 0;
      const percentage = raw.percentages[rowIndex]?.[colIndex] ?? 0;
      row[predictedClass] = `${count} (${formatNumber(percentage, 1)}%)`;
    });
    row.total = raw.row_totals[rowIndex] ?? 0;
    return row;
  });

  const totalRow: Table["rows"][number] = { rowHeader: ["Total"] };
  raw.classes.forEach((className, colIndex) => {
    totalRow[className] = raw.col_totals[colIndex] ?? 0;
  });
  totalRow.total = raw.grand_total;
  rows.push(totalRow);

  return {
    key: "confusion_matrix",
    title: "Confusion Matrix",
    columnHeaders,
    rows,
  };
}

/**
 * Mengubah seluruh hasil mentah Naive Bayes menjadi `ResultJson` (Table[])
 * sesuai output yang dicentang di tab Output (AGENTS.md §4.3). Tabel yang
 * tidak dicentang tidak ikut dibangun.
 */
export function transformNaiveBayesResult(
  raw: NaiveBayesRawResult,
  outputFlags: {
    CaseProcessingSummary: boolean;
    AttributeDistributionTable: boolean;
    ModelEvaluationMetrics: boolean;
    ConfusionMatrix: boolean;
  }
): ResultJson {
  const tables: Table[] = [];

  if (outputFlags.CaseProcessingSummary && raw.case_processing_summary) {
    tables.push(buildCaseProcessingSummaryTable(raw.case_processing_summary));
  }

  if (
    outputFlags.AttributeDistributionTable &&
    raw.attribute_distribution?.length
  ) {
    tables.push(buildAttributeDistributionTable(raw.attribute_distribution));
  }

  if (outputFlags.ModelEvaluationMetrics && raw.evaluation_metrics) {
    tables.push(...buildEvaluationMetricsTables(raw.evaluation_metrics));
  }

  if (outputFlags.ConfusionMatrix && raw.confusion_matrix) {
    tables.push(buildConfusionMatrixTable(raw.confusion_matrix));
  }

  return { tables };
}
