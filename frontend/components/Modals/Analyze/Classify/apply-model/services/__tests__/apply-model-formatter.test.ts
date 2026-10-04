// AGENTS.md §6.6, §5.6/PLAN.md §1 — test formatter Apply Model (PLAN.md Fase 16).
// Fixture raw result = hasil D1 + D3 + actual Play (angka disalin dari PLAN.md §1).

import type { Table } from "@/types/Table";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import { ApplyModelOutputDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import {
  transformApplyModelResult,
  type ApplyModelFormatterContext,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;

function cloneRaw(): ApplyModelRawResult {
  return JSON.parse(JSON.stringify(rawFixture)) as ApplyModelRawResult;
}

const context: ApplyModelFormatterContext = {
  sourceLabel: "File: nb-model-v1_1.json",
  savedColumns: [
    { column: "Predicted value", finalName: "NB_PredictedValue", type: "STRING", measure: "nominal" },
    { column: "Max probability", finalName: "NB_PredictedProbability", type: "NUMERIC", measure: "scale" },
    { column: "Probability of No", finalName: "NB_Probability_No", type: "NUMERIC", measure: "scale" },
    { column: "Probability of Yes", finalName: "NB_Probability_Yes", type: "NUMERIC", measure: "scale" },
  ],
};

const allFlags = { ...ApplyModelOutputDefault };

function getTable(tables: Table[], key: string): Table {
  const found = tables.find((table) => table.key === key);
  if (!found) throw new Error(`Tabel ${key} tidak ditemukan`);
  return found;
}

function getRow(table: Table, header: string, occurrence = 0) {
  const rows = table.rows.filter((row) => row.rowHeader[0] === header);
  const row = rows[occurrence];
  if (!row) throw new Error(`Baris ${header} tidak ditemukan di ${table.key}`);
  return row;
}

describe("transformApplyModelResult", () => {
  it("fixture + semua flag menghasilkan tujuh tabel dengan key kontrak (urut)", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);

    expect(tables.map((table) => table.key)).toEqual([
      "apply_model_summary",
      "apply_model_case_processing_summary",
      "apply_model_prediction_distribution",
      "apply_model_saved_variables",
      "evaluation_metrics",
      "evaluation_metrics_kappa",
      "confusion_matrix",
    ]);
  });

  it("Model Summary memuat baris Source dari context dan ringkasan model", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);
    const summary = getTable(tables, "apply_model_summary");

    expect(getRow(summary, "Source").value).toBe("File: nb-model-v1_1.json");
    expect(getRow(summary, "Algorithm").value).toBe("Naive Bayes");
    expect(getRow(summary, "Schema Version").value).toBe("1.1");
    expect(getRow(summary, "Trained At").value).toBe("2026-10-01T00:00:00.000Z");
    expect(getRow(summary, "Target").value).toBe("Play");
    expect(getRow(summary, "Classes").value).toBe("No, Yes");
    expect(getRow(summary, "Feature", 0).value).toBe("Outlook → Outlook (categorical)");
    expect(getRow(summary, "Feature", 1).value).toBe("Temp → Temp (numerical)");
    expect(getRow(summary, "Smoothing alpha").value).toBe("1");
    expect(getRow(summary, "Variance floor").value).toBe("0.000000001");
    expect(getRow(summary, "Validation (training)").value).toBe("Holdout 70% / 30%, seed 42");
  });

  it("Model Summary: model_type tak terdaftar memakai model_type apa adanya; trained_at null menjadi '-'", () => {
    const raw = cloneRaw();
    raw.model_summary.model_type = "decision_tree";
    raw.model_summary.trained_at = null;
    const { tables } = transformApplyModelResult(raw, allFlags, context);
    const summary = getTable(tables, "apply_model_summary");

    expect(getRow(summary, "Algorithm").value).toBe("decision_tree");
    expect(getRow(summary, "Trained At").value).toBe("-");
  });

  it("Case Processing Summary memuat angka D3 dan baris evaluasi", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);
    const cps = getTable(tables, "apply_model_case_processing_summary");

    expect(getRow(cps, "Total Rows").value).toBe(6);
    expect(getRow(cps, "Scored").value).toBe(5);
    expect(getRow(cps, "Not Scored (All Predictors Missing)").value).toBe(1);
    expect(getRow(cps, "Scored with ≥1 Missing Predictor").value).toBe(2);
    expect(getRow(cps, "Scored with ≥1 Unseen Category").value).toBe(2);
    expect(getRow(cps, "Evaluated").value).toBe(4);
    expect(getRow(cps, "Excluded (Actual Missing)").value).toBe(0);
    expect(getRow(cps, "Excluded (Actual Class Not in Model)").value).toBe(1);
  });

  it("Case Processing Summary tanpa evaluasi tidak memuat baris evaluasi", () => {
    const raw = cloneRaw();
    raw.evaluation = null;
    const { tables } = transformApplyModelResult(raw, allFlags, context);
    const cps = getTable(tables, "apply_model_case_processing_summary");

    expect(cps.rows).toHaveLength(5);
    expect(cps.rows.some((row) => row.rowHeader[0] === "Evaluated")).toBe(false);
  });

  it("Prediction Distribution: No (2, 40), Yes (3, 60), Not scored (1), Total (6)", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);
    const distribution = getTable(tables, "apply_model_prediction_distribution");

    expect(distribution.rows).toHaveLength(4);
    expect(getRow(distribution, "No").count).toBe(2);
    expect(getRow(distribution, "No").percent).toBe(40);
    expect(getRow(distribution, "Yes").count).toBe(3);
    expect(getRow(distribution, "Yes").percent).toBe(60);
    expect(getRow(distribution, "Not scored").count).toBe(1);
    expect(getRow(distribution, "Total").count).toBe(6);
  });

  it("Saved Variables memuat savedColumns dari context", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);
    const saved = getTable(tables, "apply_model_saved_variables");

    expect(saved.rows).toHaveLength(4);
    expect(getRow(saved, "Predicted value").finalName).toBe("NB_PredictedValue");
    expect(getRow(saved, "Predicted value").type).toBe("STRING");
    expect(getRow(saved, "Predicted value").measure).toBe("nominal");
    expect(getRow(saved, "Probability of Yes").finalName).toBe("NB_Probability_Yes");
  });

  it("tabel evaluasi: overall accuracy 0.75, kappa 0.5, matrix [[1,1],[0,2]]", () => {
    const { tables } = transformApplyModelResult(cloneRaw(), allFlags, context);
    const metrics = getTable(tables, "evaluation_metrics");
    const kappa = getTable(tables, "evaluation_metrics_kappa");
    const confusion = getTable(tables, "confusion_matrix");

    expect(getRow(metrics, "Overall Accuracy").accuracy).toBe(0.75);
    expect(getRow(metrics, "No").precision).toBe(1);
    expect(getRow(metrics, "No").recall).toBe(0.5);
    expect(getRow(metrics, "Yes").f1).toBe(0.8);
    expect(getRow(kappa, "Cohen's Kappa (overall)").value).toBe(0.5);

    expect(getRow(confusion, "No").No).toBe("1 (25%)");
    expect(getRow(confusion, "No").Yes).toBe("1 (25%)");
    expect(getRow(confusion, "No").total).toBe(2);
    expect(getRow(confusion, "Yes").No).toBe("0 (0%)");
    expect(getRow(confusion, "Yes").Yes).toBe("2 (50%)");
    expect(getRow(confusion, "Total").total).toBe(4);
  });

  it("flag dimatikan: hanya Saved Variables yang tersisa (selalu ada)", () => {
    const { tables } = transformApplyModelResult(
      cloneRaw(),
      {
        ModelSummary: false,
        CaseProcessingSummary: false,
        PredictionDistribution: false,
        EvaluationMetrics: false,
        ConfusionMatrix: false,
      },
      context
    );

    expect(tables.map((table) => table.key)).toEqual(["apply_model_saved_variables"]);
  });

  it("ConfusionMatrix off: metrik tetap ada, confusion_matrix tidak", () => {
    const { tables } = transformApplyModelResult(
      cloneRaw(),
      { ...allFlags, ConfusionMatrix: false },
      context
    );
    const keys = tables.map((table) => table.key);

    expect(keys).toContain("evaluation_metrics");
    expect(keys).toContain("evaluation_metrics_kappa");
    expect(keys).not.toContain("confusion_matrix");
  });

  it("evaluation null: tidak ada tabel evaluasi walau flag dicentang", () => {
    const raw = cloneRaw();
    raw.evaluation = null;
    const { tables } = transformApplyModelResult(raw, allFlags, context);

    expect(tables.map((table) => table.key)).toEqual([
      "apply_model_summary",
      "apply_model_case_processing_summary",
      "apply_model_prediction_distribution",
      "apply_model_saved_variables",
    ]);
  });
});
