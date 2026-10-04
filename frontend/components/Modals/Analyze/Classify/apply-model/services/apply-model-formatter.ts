// AGENTS.md §6.6 — mengubah `ApplyModelRawResult` (dari Rust) menjadi
// `Table[]` untuk Output Viewer. Tabel evaluasi memakai builder NB secara
// read-only (AGENTS.md §7.3).

import type { ResultJson, Table } from "@/types/Table";
import { getModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ApplyModelOutputTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import {
  buildConfusionMatrixTable,
  buildEvaluationMetricsTables,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";

export type ApplyModelSavedColumn = {
  column: string;
  finalName: string;
  type: string;
  measure: string;
};

export type ApplyModelFormatterContext = {
  sourceLabel: string;
  savedColumns: ApplyModelSavedColumn[];
};

// Disalin dari NB/services/naive-bayes-analysis-formatter.ts (formatNumber,
// tidak diekspor di sana): angka diformat 3 desimal.
const formatNumber = (value: number, decimals = 3): number =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;

const keyValueHeaders = [
  { header: "", key: "label" },
  { header: "Value", key: "value" },
];

export function buildApplyModelSummaryTable(
  raw: ApplyModelRawResult["model_summary"],
  sourceLabel: string
): Table {
  const algorithmLabel = getModelAdapter(raw.model_type)?.algorithmLabel ?? raw.model_type;

  return {
    key: "apply_model_summary",
    title: "Model Summary",
    columnHeaders: keyValueHeaders,
    rows: [
      { rowHeader: ["Source"], value: sourceLabel },
      { rowHeader: ["Algorithm"], value: algorithmLabel },
      { rowHeader: ["Schema Version"], value: raw.schema_version },
      { rowHeader: ["Trained At"], value: raw.trained_at ?? "-" },
      { rowHeader: ["Target"], value: raw.target_name },
      { rowHeader: ["Classes"], value: raw.classes.join(", ") },
      ...raw.features.map((feature) => ({
        rowHeader: ["Feature"],
        value: `${feature.name} → ${feature.mapped_variable} (${feature.role})`,
      })),
      ...raw.parameters.map((parameter) => ({
        rowHeader: [parameter.label],
        value: parameter.value,
      })),
    ],
  };
}

export function buildApplyModelCaseProcessingSummaryTable(
  raw: ApplyModelRawResult["case_processing_summary"],
  evaluation: ApplyModelRawResult["evaluation"]
): Table {
  const rows: Table["rows"] = [
    { rowHeader: ["Total Rows"], value: raw.total_rows },
    { rowHeader: ["Scored"], value: raw.scored_rows },
    { rowHeader: ["Not Scored (All Predictors Missing)"], value: raw.not_scored_all_missing },
    { rowHeader: ["Scored with ≥1 Missing Predictor"], value: raw.rows_with_missing_predictor },
    { rowHeader: ["Scored with ≥1 Unseen Category"], value: raw.rows_with_unseen_category },
  ];

  if (evaluation) {
    rows.push(
      { rowHeader: ["Evaluated"], value: evaluation.evaluated_rows },
      { rowHeader: ["Excluded (Actual Missing)"], value: evaluation.excluded_actual_missing },
      {
        rowHeader: ["Excluded (Actual Class Not in Model)"],
        value: evaluation.excluded_actual_unknown_class,
      }
    );
  }

  return {
    key: "apply_model_case_processing_summary",
    title: "Case Processing Summary",
    columnHeaders: keyValueHeaders,
    rows,
  };
}

export function buildApplyModelPredictionDistributionTable(
  raw: ApplyModelRawResult["prediction_distribution"]
): Table {
  const scored = raw.counts.reduce((sum, count) => sum + count, 0);

  return {
    key: "apply_model_prediction_distribution",
    title: "Prediction Distribution",
    columnHeaders: [
      { header: "Predicted Class", key: "class" },
      { header: "Count", key: "count" },
      { header: "Percent of Scored", key: "percent" },
    ],
    rows: [
      ...raw.classes.map((className, index) => ({
        rowHeader: [className],
        count: raw.counts[index] ?? 0,
        percent: formatNumber(raw.percentages[index] ?? 0),
      })),
      { rowHeader: ["Not scored"], count: raw.not_scored, percent: null },
      { rowHeader: ["Total"], count: scored + raw.not_scored, percent: null },
    ],
  };
}

export function buildApplyModelSavedVariablesTable(
  savedColumns: ApplyModelSavedColumn[]
): Table {
  return {
    key: "apply_model_saved_variables",
    title: "Saved Variables",
    columnHeaders: [
      { header: "Column", key: "column" },
      { header: "Final Name", key: "finalName" },
      { header: "Type", key: "type" },
      { header: "Measure", key: "measure" },
    ],
    rows: savedColumns.map((saved) => ({
      rowHeader: [saved.column],
      finalName: saved.finalName,
      type: saved.type,
      measure: saved.measure,
    })),
  };
}

/**
 * Tabel Output Viewer sesuai tab Output (§6.5/§6.6). Saved Variables selalu
 * dibangun; evaluasi hanya bila `raw.evaluation` ada dan flag dicentang.
 */
export function transformApplyModelResult(
  raw: ApplyModelRawResult,
  outputFlags: ApplyModelOutputTabType,
  context: ApplyModelFormatterContext
): ResultJson {
  const tables: Table[] = [];

  if (outputFlags.ModelSummary) {
    tables.push(buildApplyModelSummaryTable(raw.model_summary, context.sourceLabel));
  }

  if (outputFlags.CaseProcessingSummary) {
    tables.push(
      buildApplyModelCaseProcessingSummaryTable(raw.case_processing_summary, raw.evaluation)
    );
  }

  if (outputFlags.PredictionDistribution) {
    tables.push(buildApplyModelPredictionDistributionTable(raw.prediction_distribution));
  }

  tables.push(buildApplyModelSavedVariablesTable(context.savedColumns));

  if (raw.evaluation && outputFlags.EvaluationMetrics) {
    tables.push(...buildEvaluationMetricsTables(raw.evaluation.evaluation_metrics));
  }

  if (raw.evaluation && outputFlags.ConfusionMatrix) {
    tables.push(buildConfusionMatrixTable(raw.evaluation.confusion_matrix));
  }

  return { tables };
}
