// AGENTS.md §6.6 — menulis tabel Apply Model ke result store (Output Viewer).
// Pola: NB/services/naive-bayes-analysis-output.ts.

import type { Table } from "@/types/Table";
import { useResultStore } from "@/stores/useResultStore";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";

export type ApplyModelFormattedResult = {
  tables: Table[];
};

export type ApplyModelResultPayload = {
  formattedResult: ApplyModelFormattedResult;
  rawResult: ApplyModelRawResult;
  formData: ApplyModelType;
  finalNames: string[];
};

export async function resultApplyModel({
  formattedResult,
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
    await addTable("apply_model_summary", "Model Summary", "Apply Model Summary");
  }

  if (formData.output.CaseProcessingSummary) {
    await addTable(
      "apply_model_case_processing_summary",
      "Case Processing Summary",
      "Apply Model Case Processing Summary"
    );
  }

  if (formData.output.PredictionDistribution) {
    await addTable(
      "apply_model_prediction_distribution",
      "Prediction Distribution",
      "Apply Model Prediction Distribution"
    );
  }

  // Saved Variables selalu ditambahkan (tidak digerbang tab Output).
  await addTable(
    "apply_model_saved_variables",
    "Saved Variables",
    "Apply Model Saved Variables"
  );

  if (formData.output.EvaluationMetrics) {
    await addTable(
      "evaluation_metrics",
      "Model Evaluation Metrics",
      "Apply Model Evaluation Metrics"
    );
    await addTable(
      "evaluation_metrics_kappa",
      "Cohen's Kappa",
      "Apply Model Cohen's Kappa",
      "Cohen's Kappa (overall)"
    );
  }

  if (formData.output.ConfusionMatrix) {
    await addTable(
      "confusion_matrix",
      "Confusion Matrix",
      "Apply Model Confusion Matrix"
    );
  }
}
