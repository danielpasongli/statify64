// AGENTS.md §6.6 — menulis tabel Apply Model ke result store (Output Viewer).
// Pola: NB/services/naive-bayes-analysis-output.ts.

import type { Table } from "@/types/Table";
import { useResultStore } from "@/stores/useResultStore";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import { getModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type {
  ApplyModelSavedColumn,
  ApplyModelTextMappingInfo,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";
import {
  describeApplyModelCaseProcessingSummary,
  describeApplyModelCohensKappa,
  describeApplyModelConfusionMatrix,
  describeApplyModelEvaluationMetrics,
  describeApplyModelPredictionDistribution,
  describeApplyModelSavedVariables,
  describeApplyModelSummary,
  readTrainingPriors,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-interpretation";

export type ApplyModelFormattedResult = {
  tables: Table[];
};

export type ApplyModelResultPayload = {
  formattedResult: ApplyModelFormattedResult;
  rawResult: ApplyModelRawResult;
  formData: ApplyModelType;
  finalNames: string[];
};


// Interpretasi otomatis (PLAN_V3_UI_EN §3.4) dihitung dari hasil mentah + tabel yang
// sudah diformat, sehingga struktur payload `resultApplyModel` tidak berubah.

/** Baris tabel -> teks (kosong bila bukan string/angka). */
const cellText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** Kolom tersimpan dibaca dari tabel Saved Variables yang sudah dibangun formatter. */
function readSavedColumns(tables: Table[]): ApplyModelSavedColumn[] {
  const table = tables.find((candidate) => candidate.key === "apply_model_saved_variables");
  return (table?.rows ?? []).map((row) => ({
    column: cellText(row.rowHeader?.[0]),
    finalName: cellText(row.finalName),
    type: cellText(row.type),
    measure: cellText(row.measure),
  }));
}

/** Pemetaan fitur Text untuk interpretasi ringkasan model; undefined untuk model tanpa Text. */
function readTextMapping(
  tables: Table[],
  rawResult: ApplyModelRawResult,
  formData: ApplyModelType
): ApplyModelTextMappingInfo | undefined {
  const source = rawResult.model_summary.parameters.find(
    (parameter) => parameter.label === "Text source"
  )?.value;

  if (source === "raw") {
    return {
      source: "raw",
      modelVariable: null,
      datasetVariable: formData.variables.RawTextVar ?? "-",
    };
  }
  if (source === "vector") {
    const summary = tables.find((candidate) => candidate.key === "apply_model_summary");
    const row = summary?.rows.find((candidate) => candidate.rowHeader?.[0] === "Word-Vector Columns");
    const match = /^(\d+) of (\d+) vector columns found/.exec(cellText(row?.value));
    if (match) {
      return { source: "vector", mappedColumns: Number(match[1]), totalColumns: Number(match[2]) };
    }
  }
  return undefined;
}

export async function resultApplyModel({
  formattedResult,
  rawResult,
  formData,
}: ApplyModelResultPayload) {
  const { addLog, addAnalytic, addStatistic } = useResultStore.getState();

  const findTable = (key: string) => {
    const foundTable = formattedResult.tables.find((table) => table.key === key);
    return foundTable ? JSON.stringify({ tables: [foundTable] }) : null;
  };

  const logId = await addLog({ log: "Apply Model" });

  const analyticId = await addAnalytic(logId, {
    title: "Apply Model Result",
    note: "",
  });

  // PENTING: `components` wajib unik. JANGAN memakai "Case Processing Summary"
  // atau "Export Model" — keduanya sudah terdaftar sebagai komponen khusus di
  // components/Output/Statistics/index.tsx dan akan salah dirender (§6.6).
  const addTable = async (
    key: string,
    title: string,
    components: string,
    description = title
  ) => {
    const outputData = findTable(key);
    if (!outputData) return;
    await addStatistic(analyticId, {
      title,
      description,
      output_data: outputData,
      components,
    });
  };

  if (formData.output.ModelSummary) {
    await addTable(
      "apply_model_summary",
      "Model Summary",
      "Apply Model Summary",
      describeApplyModelSummary(rawResult.model_summary, {
        sourceLabel: formData.model.SourceLabel,
        algorithmLabel: getModelAdapter(rawResult.model_summary.model_type)?.algorithmLabel,
        textMapping: readTextMapping(formattedResult.tables, rawResult, formData),
      })
    );
  }

  if (formData.output.CaseProcessingSummary) {
    await addTable(
      "apply_model_case_processing_summary",
      "Case Processing Summary",
      "Apply Model Case Processing Summary",
      describeApplyModelCaseProcessingSummary(
        rawResult.case_processing_summary,
        rawResult.evaluation,
        rawResult.model_summary
      )
    );
  }

  if (formData.output.PredictionDistribution) {
    await addTable(
      "apply_model_prediction_distribution",
      "Prediction Distribution",
      "Apply Model Prediction Distribution",
      describeApplyModelPredictionDistribution(
        rawResult.prediction_distribution,
        readTrainingPriors(formData.model.ModelJson)
      )
    );
  }

  // Saved Variables selalu ditambahkan (tidak digerbang tab Output).
  await addTable(
    "apply_model_saved_variables",
    "Saved Variables",
    "Apply Model Saved Variables",
    describeApplyModelSavedVariables(readSavedColumns(formattedResult.tables))
  );

  if (formData.output.EvaluationMetrics) {
    await addTable(
      "evaluation_metrics",
      "Model Evaluation Metrics",
      "Apply Model Evaluation Metrics",
      describeApplyModelEvaluationMetrics(rawResult.evaluation)
    );
    await addTable(
      "evaluation_metrics_kappa",
      "Cohen's Kappa",
      "Apply Model Cohen's Kappa",
      describeApplyModelCohensKappa(rawResult.evaluation)
    );
  }

  if (formData.output.ConfusionMatrix) {
    await addTable(
      "confusion_matrix",
      "Confusion Matrix",
      "Apply Model Confusion Matrix",
      describeApplyModelConfusionMatrix(rawResult.evaluation)
    );
  }
}
