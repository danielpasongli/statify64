// AGENTS.md §6.6 — test penulisan Output Viewer Apply Model (PLAN.md Fase 16).
// `useResultStore` di-mock (pola KNN/services/__tests__/nearest-neighbor-analysis.test.ts).

import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import { transformApplyModelResult } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";

const mockAddLog = jest.fn();
const mockAddAnalytic = jest.fn();
const mockAddStatistic = jest.fn();
jest.mock("@/stores/useResultStore", () => ({
  useResultStore: {
    getState: jest.fn(() => ({
      addLog: mockAddLog,
      addAnalytic: mockAddAnalytic,
      addStatistic: mockAddStatistic,
    })),
  },
}));

import { resultApplyModel } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-output";

const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;

const FINAL_NAMES = [
  "NB_PredictedValue",
  "NB_PredictedProbability",
  "NB_Probability_No",
  "NB_Probability_Yes",
];

const context = {
  sourceLabel: "File: nb-model-v1_1.json",
  savedColumns: FINAL_NAMES.map((name) => ({
    column: name,
    finalName: name,
    type: "NUMERIC",
    measure: "scale",
  })),
};

type StatisticArg = { title: string; components: string; output_data: string };

function cloneRaw(): ApplyModelRawResult {
  return JSON.parse(JSON.stringify(rawFixture)) as ApplyModelRawResult;
}

function makeFormData(
  output: Partial<ApplyModelType["output"]> = {}
): ApplyModelType {
  const formData = JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;
  formData.output = { ...formData.output, ...output };
  return formData;
}

async function run(
  output: Partial<ApplyModelType["output"]> = {},
  raw: ApplyModelRawResult = cloneRaw()
) {
  const formData = makeFormData(output);
  const formattedResult = transformApplyModelResult(raw, formData.output, context);
  await resultApplyModel({
    formattedResult,
    rawResult: raw,
    formData,
    finalNames: FINAL_NAMES,
  });
}

function statisticArgs(): StatisticArg[] {
  return mockAddStatistic.mock.calls.map((call: unknown[]) => call[1] as StatisticArg);
}

function components(): string[] {
  return statisticArgs().map((arg) => arg.components);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddLog.mockResolvedValue(11);
  mockAddAnalytic.mockResolvedValue(22);
  mockAddStatistic.mockResolvedValue(33);
});

describe("resultApplyModel", () => {
  it("membuat log 'Apply Model' dan analytic 'Apply Model Result'", async () => {
    await run();

    expect(mockAddLog).toHaveBeenCalledTimes(1);
    expect(mockAddLog).toHaveBeenCalledWith({ log: "Apply Model" });
    expect(mockAddAnalytic).toHaveBeenCalledTimes(1);
    expect(mockAddAnalytic).toHaveBeenCalledWith(11, {
      title: "Apply Model Result",
      note: "",
    });
    expect(mockAddStatistic.mock.calls.every((call: unknown[]) => call[0] === 22)).toBe(true);
  });

  it("semua flag dicentang: tujuh statistic dengan components unik dan berurutan", async () => {
    await run();

    expect(components()).toEqual([
      "Apply Model Summary",
      "Apply Model Case Processing Summary",
      "Apply Model Prediction Distribution",
      "Apply Model Saved Variables",
      "Apply Model Evaluation Metrics",
      "Apply Model Cohen's Kappa",
      "Apply Model Confusion Matrix",
    ]);
    expect(new Set(components()).size).toBe(7);
  });

  it("output_data berisi tepat satu tabel dengan key yang sesuai", async () => {
    await run();

    const keys = statisticArgs().map(
      (arg) => (JSON.parse(arg.output_data) as { tables: Array<{ key: string }> }).tables.map((t) => t.key)
    );
    expect(keys).toEqual([
      ["apply_model_summary"],
      ["apply_model_case_processing_summary"],
      ["apply_model_prediction_distribution"],
      ["apply_model_saved_variables"],
      ["evaluation_metrics"],
      ["evaluation_metrics_kappa"],
      ["confusion_matrix"],
    ]);
  });

  it("uncheck ConfusionMatrix: addStatistic tidak dipanggil untuk 'Apply Model Confusion Matrix'", async () => {
    await run({ ConfusionMatrix: false });

    expect(components()).not.toContain("Apply Model Confusion Matrix");
    expect(components()).toContain("Apply Model Evaluation Metrics");
    expect(components()).toHaveLength(6);
  });

  it("uncheck EvaluationMetrics: metrik dan Kappa tidak ditulis", async () => {
    await run({ EvaluationMetrics: false });

    expect(components()).not.toContain("Apply Model Evaluation Metrics");
    expect(components()).not.toContain("Apply Model Cohen's Kappa");
    expect(components()).toContain("Apply Model Confusion Matrix");
  });

  it("semua flag opsional off: Saved Variables tetap ditulis", async () => {
    await run({
      ModelSummary: false,
      CaseProcessingSummary: false,
      PredictionDistribution: false,
      EvaluationMetrics: false,
      ConfusionMatrix: false,
    });

    expect(components()).toEqual(["Apply Model Saved Variables"]);
  });

  it("tanpa evaluasi (raw.evaluation null): tidak ada statistic evaluasi, tidak error", async () => {
    const raw = cloneRaw();
    raw.evaluation = null;
    await run({}, raw);

    expect(components()).toEqual([
      "Apply Model Summary",
      "Apply Model Case Processing Summary",
      "Apply Model Prediction Distribution",
      "Apply Model Saved Variables",
    ]);
  });

  it("tidak pernah memakai components 'Case Processing Summary' atau 'Export Model'", async () => {
    await run();

    expect(components()).not.toContain("Case Processing Summary");
    expect(components()).not.toContain("Export Model");
  });
});
