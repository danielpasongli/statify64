// AGENTS.md §3.6, §6.6 — test orkestrator Apply Model (PLAN.md Fase 17).
// `useVariableStore` & `useResultStore` di-mock, `Worker` di-mock dan
// mengembalikan fixture Fase 16. Data uji: D1 (model) + D3 (dataset), PLAN.md §1.

import type { Variable } from "@/types/Variable";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type {
  ApplyModelRawResult,
  ApplyModelWorkerPayload,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";

const mockAddVariables = jest.fn();
const mockStoreState: { variables: Variable[]; addVariables: jest.Mock } = {
  variables: [],
  addVariables: mockAddVariables,
};
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: { getState: jest.fn(() => mockStoreState) },
  processVariableName: (name: string, existingVariables: Array<{ name: string }>) => {
    const existingNames = existingVariables.map((v) => v.name.toLowerCase());
    let processedName = name;
    let counter = 1;
    while (existingNames.includes(processedName.toLowerCase())) {
      processedName = `${name}_${counter}`;
      counter++;
    }
    return { isValid: true, processedName };
  },
}));

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

import {
  APPLY_MODEL_WASM_VERSION,
  applyModel,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-analysis";

const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as unknown;

// ---------------------------------------------------------------------------
// Worker mock
// ---------------------------------------------------------------------------

type WorkerReply =
  | { success: true; data: ApplyModelRawResult; errors: string }
  | { success: false; error: string };

const workerState: {
  reply: WorkerReply;
  constructed: Array<{ url: string; options: unknown }>;
  payloads: ApplyModelWorkerPayload[];
  terminate: jest.Mock;
} = {
  reply: { success: true, data: rawFixture, errors: "No errors occurred." },
  constructed: [],
  payloads: [],
  terminate: jest.fn(),
};

class MockWorker {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  constructor(url: string, options?: unknown) {
    workerState.constructed.push({ url, options });
  }

  postMessage(payload: ApplyModelWorkerPayload): void {
    workerState.payloads.push(payload);
    setTimeout(() => this.onmessage?.({ data: workerState.reply }), 0);
  }

  terminate(): void {
    workerState.terminate();
  }
}

// ---------------------------------------------------------------------------
// Data uji D3 & form
// ---------------------------------------------------------------------------

function makeVariable(
  name: string,
  columnIndex: number,
  measure: Variable["measure"],
  type: Variable["type"]
): Variable {
  return {
    columnIndex,
    name,
    type,
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure,
    role: "input",
  };
}

function makeD3Variables(): Variable[] {
  return [
    makeVariable("Outlook", 0, "nominal", "STRING"),
    makeVariable("Temp", 1, "scale", "NUMERIC"),
    makeVariable("Play", 2, "nominal", "STRING"),
  ];
}

// Baris 1-6 PLAN.md §1 (sel kosong = "").
const D3_DATA: string[][] = [
  ["Overcast", "85", "No"],
  ["Sunny", "71", "Yes"],
  ["Foggy", "72", "Yes"],
  ["Sunny", "", "No"],
  ["", "", "Yes"],
  ["", "80", "Maybe"],
];

function makeFormData(overrides: { actual?: string | null; classProbabilities?: boolean } = {}): ApplyModelType {
  const formData = JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;
  formData.model = {
    SourceKind: "file",
    SourceRef: "nb-model-v1_1.json",
    SourceLabel: "File: nb-model-v1_1.json",
    ModelJson: nbModelV11,
  };
  formData.variables = {
    FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
    ActualTargetVar: overrides.actual === undefined ? "Play" : overrides.actual,
  };
  formData.save.SaveClassProbabilities = overrides.classProbabilities ?? true;
  return formData;
}

type AddVariablesCall = [
  Array<Partial<Variable>>,
  Array<{ row: number; col: number; value: string | number }>,
];

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { Worker: unknown }).Worker = MockWorker;
  workerState.reply = { success: true, data: rawFixture, errors: "No errors occurred." };
  workerState.constructed = [];
  workerState.payloads = [];
  mockStoreState.variables = makeD3Variables();
  mockAddLog.mockResolvedValue(1);
  mockAddAnalytic.mockResolvedValue(10);
  mockAddStatistic.mockResolvedValue(undefined);
  mockAddVariables.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe("applyModel — skenario D1 + D3", () => {
  it("addVariables dipanggil sekali; definisi & nilai sesuai PLAN.md §1", async () => {
    const summary = await applyModel({
      formData: makeFormData(),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    expect(mockAddVariables).toHaveBeenCalledTimes(1);
    const [definitions, updates] = mockAddVariables.mock.calls[0] as AddVariablesCall;

    expect(definitions.map((d) => d.name)).toEqual([
      "NB_PredictedValue",
      "NB_PredictedProbability",
      "NB_Probability_No",
      "NB_Probability_Yes",
    ]);
    expect(definitions.map((d) => d.columnIndex)).toEqual([3, 4, 5, 6]);

    const predicted = definitions.find((d) => d.name === "NB_PredictedValue");
    expect(predicted?.type).toBe("STRING");
    expect(predicted?.measure).toBe("nominal");
    expect(predicted?.width).toBe(64);

    // Baris 5 (index 4) tidak punya update untuk kolom mana pun.
    expect(updates.some((u) => u.row === 4)).toBe(false);

    // Probabilitas baris 2 (index 1) = 0.9967 (kolom 4 = NB_PredictedProbability).
    expect(updates.find((u) => u.row === 1 && u.col === 4)?.value).toBe(0.9967);
    expect(updates.find((u) => u.row === 1 && u.col === 3)?.value).toBe("Yes");

    expect(summary.scoredRows).toBe(5);
    expect(summary.finalNames).toEqual(definitions.map((d) => d.name));
    expect(summary.warnings).toEqual(rawFixture.warnings);
  });

  it("payload worker: 2 prediktor, mapping Outlook/Temp, actual Play, model apa adanya", async () => {
    await applyModel({
      formData: makeFormData(),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    expect(workerState.payloads).toHaveLength(1);
    const payload = workerState.payloads[0];

    expect(payload.predictors.length).toBe(2);
    expect(payload.predictorDefs.length).toBe(2);
    expect(payload.mapping).toEqual([
      { feature: "Outlook", variable: "Outlook" },
      { feature: "Temp", variable: "Temp" },
    ]);
    expect(payload.mapping[0].feature).toBe("Outlook");
    expect(payload.predictors[0]).toHaveLength(6);
    expect(payload.predictors[0][0]).toEqual({ Outlook: "Overcast" });
    expect(payload.predictors[1][0]).toEqual({ Temp: 85 });
    expect(payload.predictors[1][3]).toEqual({ Temp: null });

    expect(payload.actual).toHaveLength(1);
    expect(payload.actual[0]).toHaveLength(6);
    expect(payload.actual[0][5]).toEqual({ Play: "Maybe" });
    expect(payload.actualDefs).toHaveLength(1);
    expect(payload.model).toBe(nbModelV11);
  });

  it("worker dibuat sebagai module dengan URL ber-versi; di-terminate setelah balasan", async () => {
    await applyModel({
      formData: makeFormData(),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    expect(workerState.constructed).toEqual([
      {
        url: `/workers/Classify/ApplyModel/apply-model.worker.js?v=${APPLY_MODEL_WASM_VERSION}`,
        options: { type: "module" },
      },
    ]);
    expect(workerState.terminate).toHaveBeenCalledTimes(1);
  });

  it("urutan: worker -> resultApplyModel (addLog) -> addVariables", async () => {
    await applyModel({
      formData: makeFormData(),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    expect(mockAddLog).toHaveBeenCalledWith({ log: "Apply Model" });
    expect(mockAddLog.mock.invocationCallOrder[0]).toBeLessThan(
      mockAddVariables.mock.invocationCallOrder[0]
    );

    const components = mockAddStatistic.mock.calls.map(
      (call) => (call[1] as { components: string }).components
    );
    expect(components).toContain("Apply Model Saved Variables");
    expect(components).toContain("Apply Model Confusion Matrix");
  });

  it("tabel Saved Variables memuat nama akhir kolom", async () => {
    await applyModel({
      formData: makeFormData(),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    const saved = mockAddStatistic.mock.calls
      .map((call) => call[1] as { components: string; output_data: string })
      .find((arg) => arg.components === "Apply Model Saved Variables");
    expect(saved).toBeDefined();
    const table = (JSON.parse(saved?.output_data ?? "{}") as {
      tables: Array<{ rows: Array<{ rowHeader: string[]; finalName: string }> }>;
    }).tables[0];
    expect(table.rows.map((row) => row.finalName)).toEqual([
      "NB_PredictedValue",
      "NB_PredictedProbability",
      "NB_Probability_No",
      "NB_Probability_Yes",
    ]);
    expect(table.rows[0].rowHeader).toEqual(["Predicted value"]);
  });

  it("tanpa actual target: actual & actualDefs dikirim kosong", async () => {
    await applyModel({
      formData: makeFormData({ actual: null }),
      variables: makeD3Variables(),
      dataVariables: D3_DATA,
    });

    const payload = workerState.payloads[0];
    expect(payload.actual).toEqual([]);
    expect(payload.actualDefs).toEqual([]);
    expect(payload.predictors.length).toBe(2);
  });

  it("nama bentrok dengan variabel yang ada -> nama akhir disesuaikan & dipakai di kolom", async () => {
    const existing = [...makeD3Variables(), makeVariable("NB_PredictedValue", 3, "nominal", "STRING")];
    mockStoreState.variables = existing;

    const summary = await applyModel({
      formData: makeFormData({ classProbabilities: false }),
      variables: existing,
      dataVariables: D3_DATA.map((row) => [...row, ""]),
    });

    expect(summary.finalNames).toEqual(["NB_PredictedValue_1", "NB_PredictedProbability"]);
    const [definitions] = mockAddVariables.mock.calls[0] as AddVariablesCall;
    expect(definitions.map((d) => d.name)).toEqual(summary.finalNames);
    expect(definitions.map((d) => d.columnIndex)).toEqual([4, 5]);
  });
});

describe("applyModel — kegagalan", () => {
  it("worker mengembalikan success:false -> reject dengan pesan worker; tidak menulis apa pun", async () => {
    workerState.reply = { success: false, error: "AM_E_PAYLOAD: predictors tidak sejajar" };

    await expect(
      applyModel({
        formData: makeFormData(),
        variables: makeD3Variables(),
        dataVariables: D3_DATA,
      })
    ).rejects.toThrow("AM_E_PAYLOAD: predictors tidak sejajar");

    expect(mockAddLog).not.toHaveBeenCalled();
    expect(mockAddVariables).not.toHaveBeenCalled();
    expect(workerState.terminate).toHaveBeenCalledTimes(1);
  });

  it("fitur belum dipetakan -> AM_E_MAP_UNMAPPED tanpa membuat worker", async () => {
    const formData = makeFormData();
    formData.variables.FeatureMapping = { Outlook: "Outlook", Temp: null };

    await expect(
      applyModel({ formData, variables: makeD3Variables(), dataVariables: D3_DATA })
    ).rejects.toThrow("AM_E_MAP_UNMAPPED: Temp");

    expect(workerState.constructed).toHaveLength(0);
    expect(mockAddVariables).not.toHaveBeenCalled();
  });

  it("dataset kosong -> AM_E_NO_ROWS tanpa membuat worker", async () => {
    await expect(
      applyModel({ formData: makeFormData(), variables: makeD3Variables(), dataVariables: [] })
    ).rejects.toThrow("AM_E_NO_ROWS");

    expect(workerState.constructed).toHaveLength(0);
  });

  it("tanpa model -> AM_E_NO_MODEL", async () => {
    const formData = makeFormData();
    formData.model.ModelJson = null;

    await expect(
      applyModel({ formData, variables: makeD3Variables(), dataVariables: D3_DATA })
    ).rejects.toThrow("AM_E_NO_MODEL");
  });

  it("model tidak valid -> kode error pertama dari validasi", async () => {
    const formData = makeFormData();
    formData.model.ModelJson = { model_type: "svm" };

    await expect(
      applyModel({ formData, variables: makeD3Variables(), dataVariables: D3_DATA })
    ).rejects.toThrow("AM_E_MODEL_TYPE_UNSUPPORTED: svm");
  });
});
