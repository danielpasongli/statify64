// naive-bayes-analysis-output.ts
//
// Mengikuti pola persis `resultNearestNeighbor`: addLog -> addAnalytic ->
// addStatistic satu per tabel yang dicentang di tab Output, plus satu
// statistic khusus "Export Model" yang dipasang di output viewer setelah
// run sukses (AGENTS.md §4.3 — tombol Export Model bukan checkbox, hanya
// muncul di output viewer, bukan di tab Output/form).

import type { Table } from "@/types/Table";
import { useResultStore } from "@/stores/useResultStore";
import {
  getTrainedText,
  type NaiveBayesRawResult,
  type NaiveBayesTrainedModelRaw,
} from "./naive-bayes-analysis-formatter";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import { getEffectiveTextSource } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import {
  describeAttributeDistribution,
  describeCaseProcessingSummary,
  describeCohensKappa,
  describeConfusionMatrix,
  describeEvaluationMetrics,
  describeExportModel,
  describeTextFeatureTable,
} from "./naive-bayes-interpretation";

export type NaiveBayesFormattedResult = {
  tables: Table[];
};

export type NaiveBayesResultPayload = {
  formattedResult: NaiveBayesFormattedResult;
  rawResult: NaiveBayesRawResult;
  configData: NaiveBayesType;
};

export async function resultNaiveBayes({
  formattedResult,
  rawResult,
  configData,
}: NaiveBayesResultPayload) {
  const { addLog, addAnalytic, addStatistic } = useResultStore.getState();

  const findTable = (key: string) => {
    const foundTable = formattedResult.tables.find((table) => table.key === key);
    return foundTable ? JSON.stringify({ tables: [foundTable] }) : null;
  };

  const logId = await addLog({ log: "Naive Bayes Analysis" });

  const analyticId = await addAnalytic(logId, {
    title: "Naive Bayes Analysis Result",
    note: "",
  });

  if (configData.output.CaseProcessingSummary) {
    const caseProcessingSummary = findTable("case_processing_summary");
    if (caseProcessingSummary) {
      await addStatistic(analyticId, {
        title: "Case Processing Summary",
        description: describeCaseProcessingSummary(
          rawResult.case_processing_summary,
          getTrainedText(rawResult.trained_model)
        ),
        output_data: caseProcessingSummary,
        // PENTING: JANGAN pakai string persis "Case Processing Summary" di
        // sini. String ini dipakai sebagai key lookup ke registry komponen
        // React khusus (components/Output/Statistics/index.tsx), dan
        // "Case Processing Summary" SUDAH terdaftar di sana untuk modul
        // lain (dibuat untuk tabel dua-level row-header gaya
        // Multinomial/"Overall" grouping) — bentrok nama menyebabkan tabel
        // Naive Bayes dirender oleh komponen yang salah (ditemukan lewat
        // verifikasi manual). Nama unik di bawah membuatnya jatuh ke
        // generic DataTableRenderer, sama seperti Model Evaluation Metrics
        // & Confusion Matrix yang memang tidak terdaftar khusus.
        components: "Naive Bayes Case Processing Summary",
      });
    }
  }

  if (configData.output.AttributeDistributionTable) {
    const attributeDistributionTable = findTable("attribute_distribution_table");
    if (attributeDistributionTable) {
      await addStatistic(analyticId, {
        title: "Attribute Distribution Table",
        description: describeAttributeDistribution(rawResult.attribute_distribution ?? []),
        output_data: attributeDistributionTable,
        components: "Attribute Distribution Table",
      });
    }
  }

  if (configData.output.ModelEvaluationMetrics) {
    const evaluationMetrics = findTable("evaluation_metrics");
    const evaluationMetricsKappa = findTable("evaluation_metrics_kappa");
    if (evaluationMetrics) {
      await addStatistic(analyticId, {
        title: "Model Evaluation Metrics",
        description: rawResult.evaluation_metrics
          ? describeEvaluationMetrics(rawResult.evaluation_metrics, rawResult.confusion_matrix)
          : "Model Evaluation Metrics",
        output_data: evaluationMetrics,
        components: "Model Evaluation Metrics",
      });
    }
    if (evaluationMetricsKappa) {
      await addStatistic(analyticId, {
        title: "Cohen's Kappa",
        description: describeCohensKappa(rawResult.evaluation_metrics?.cohens_kappa),
        output_data: evaluationMetricsKappa,
        components: "Model Evaluation Metrics",
      });
    }
  }

  if (configData.output.ConfusionMatrix) {
    const confusionMatrix = findTable("confusion_matrix");
    if (confusionMatrix) {
      await addStatistic(analyticId, {
        title: "Confusion Matrix",
        description: rawResult.confusion_matrix
          ? describeConfusionMatrix(rawResult.confusion_matrix)
          : "Confusion Matrix",
        output_data: confusionMatrix,
        components: "Confusion Matrix",
      });
    }
  }

  // Text Feature Table (AGENTS_V2 §9 / V9). Opsi `TextFeatureTable` tetap
  // tersimpan true walau tidak ada Text Features, jadi tabel ini diabaikan bila
  // sumber Text efektif "none" atau Rust tidak mengirim `text_feature_table`.
  // `output_data` membawa tabel Top-k (`tables`, bisa dirender oleh renderer
  // generik) + struktur lengkap (`textFeatureTable`, untuk Download CSV/Copy TSV).
  if (
    configData.output.TextFeatureTable &&
    getEffectiveTextSource(configData.main) !== "none" &&
    rawResult.text_feature_table
  ) {
    const textFeatureTable = formattedResult.tables.find(
      (table) => table.key === "text_feature_table"
    );
    if (textFeatureTable) {
      await addStatistic(analyticId, {
        title: "Text Feature Table",
        description: describeTextFeatureTable(rawResult.text_feature_table, {
          alpha: rawResult.case_processing_summary?.text_features?.alpha ?? getTrainedText(rawResult.trained_model)?.alpha,
          source: getEffectiveTextSource(configData.main) === "vector" ? "vector" : "raw",
        }),
        output_data: JSON.stringify({
          tables: [textFeatureTable],
          textFeatureTable: rawResult.text_feature_table,
        }),
        components: "Text Feature Table",
      });
    }
  }

  // Export Model (AGENTS.md §4.3 & §5.10): bukan checkbox, selalu dipasang
  // di output viewer setelah run sukses selama model berhasil dilatih —
  // tidak digerbang oleh tab Output manapun.
  if (rawResult.trained_model) {
    await addStatistic(analyticId, {
      title: "Export Model",
      description: describeExportModel(rawResult.trained_model),
      output_data: JSON.stringify({
        naiveBayesTrainedModel: rawResult.trained_model satisfies NaiveBayesTrainedModelRaw,
      }),
      components: "Export Model",
    });
  }
}
