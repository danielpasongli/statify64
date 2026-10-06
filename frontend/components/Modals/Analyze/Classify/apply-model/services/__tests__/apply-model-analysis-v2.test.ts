// AGENTS_V2.md §10.2–10.3 — test payload Apply Model v2 (Fase A3).
// Pola mock sama dengan apply-model-analysis.test.ts: store & Worker di-mock.
// Model: fixture 2.0 raw (variabel teks "Teks") dan vector (kolom VEC_makan ... VEC_tidak).

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
  applyModel,
  readRawTextValues,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-analysis";

const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as unknown;
const nbModelRaw = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-raw.json") as unknown;
const nbModelVector = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-vector.json") as unknown;

type WorkerReply =
  | { success: true; data: ApplyModelRawResult; errors: string }
  | { success: false; error: string };

const workerState: {
  reply: WorkerReply;
  payloads: ApplyModelWorkerPayload[];
} = {
  reply: { success: true, data: rawFixture, errors: "No errors occurred." },
  payloads: [],
};

class MockWorker {
  onmessage: ((event: { data: WorkerReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  postMessage(payload: ApplyModelWorkerPayload): void {
    workerState.payloads.push(payload);
    setTimeout(() => this.onmessage?.({ data: workerState.reply }), 0);
  }

  terminate(): void {
    // tidak ada yang perlu dibersihkan
  }
}

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

function makeForm(
  modelJson: unknown,
  variablesTab: Partial<ApplyModelType["variables"]>
): ApplyModelType {
  const formData = JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;
  formData.model = {
    SourceKind: "file",
    SourceRef: "model.json",
    SourceLabel: "File: model.json",
    ModelJson: modelJson,
  };
  formData.variables = { ...formData.variables, ...variablesTab };
  formData.save.SaveClassProbabilities = false;
  return formData;
}

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as unknown as { Worker: unknown }).Worker = MockWorker;
  workerState.reply = { success: true, data: rawFixture, errors: "No errors occurred." };
  workerState.payloads = [];
  mockAddLog.mockResolvedValue(1);
  mockAddAnalytic.mockResolvedValue(10);
  mockAddStatistic.mockResolvedValue(undefined);
  mockAddVariables.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Jalur raw
// ---------------------------------------------------------------------------

const RAW_VARIABLES: Variable[] = [
  makeVariable("Teks", 0, "nominal", "STRING"),
  makeVariable("Sentimen", 1, "nominal", "STRING"),
];

describe("applyModel v2 — jalur Raw Text", () => {
  it("payload text.raw: teks apa adanya (tanpa parseFloat), kosong/spasi -> null; prediktor v1 kosong", async () => {
    const data = [
      ["3 kucing lucu", "pos"],
      ["makan nasi enak", "neg"],
      ["   ", "pos"],
      ["", "neg"],
    ];
    mockStoreState.variables = RAW_VARIABLES;

    await applyModel({
      formData: makeForm(nbModelRaw, { RawTextVar: "Teks", ActualTargetVar: "Sentimen" }),
      variables: RAW_VARIABLES,
      dataVariables: data,
    });

    const payload = workerState.payloads[0];
    expect(payload.text).toEqual({
      source: "raw",
      values: ["3 kucing lucu", "makan nasi enak", null, null],
    });
    expect(payload.predictors).toEqual([]);
    expect(payload.mapping).toEqual([]);
    expect(payload.actual).toHaveLength(1);
    expect(payload.actual[0]).toHaveLength(4);
    expect(payload.actual[0][0]).toEqual({ Sentimen: "pos" });
    expect(payload.model).toBe(nbModelRaw);
  });

  it("tanpa actual target: panjang teks = baris terakhir yang berisi (tanpa slice sama sekali)", async () => {
    const data = [["satu", ""], ["", ""], ["tiga", ""], ["", ""]];
    mockStoreState.variables = RAW_VARIABLES;

    await applyModel({
      formData: makeForm(nbModelRaw, { RawTextVar: "Teks", ActualTargetVar: null }),
      variables: RAW_VARIABLES,
      dataVariables: data,
    });

    const payload = workerState.payloads[0];
    expect(payload.text).toEqual({ source: "raw", values: ["satu", null, "tiga"] });
    expect(payload.actual).toEqual([]);
    expect(payload.actualDefs).toEqual([]);
  });

  it("RawTextVar belum dipilih -> AM_E_MAP_RAW_TEXT_UNMAPPED dengan nama variabel model; worker tidak dibuat", async () => {
    await expect(
      applyModel({
        formData: makeForm(nbModelRaw, { RawTextVar: null }),
        variables: RAW_VARIABLES,
        dataVariables: [["a", "pos"]],
      })
    ).rejects.toThrow("AM_E_MAP_RAW_TEXT_UNMAPPED: Teks");
    expect(workerState.payloads).toHaveLength(0);
  });

  it("seluruh kolom teks kosong (tanpa actual) -> AM_E_NO_ROWS", async () => {
    await expect(
      applyModel({
        formData: makeForm(nbModelRaw, { RawTextVar: "Teks" }),
        variables: RAW_VARIABLES,
        dataVariables: [["", ""], ["  ", ""]],
      })
    ).rejects.toThrow("AM_E_NO_ROWS");
  });

  it("baris ringkasan model memuat pemetaan 'Text Variable' (sisi TS)", async () => {
    mockStoreState.variables = RAW_VARIABLES;
    await applyModel({
      formData: makeForm(nbModelRaw, { RawTextVar: "Teks", ActualTargetVar: "Sentimen" }),
      variables: RAW_VARIABLES,
      dataVariables: [["a", "pos"]],
    });

    const summary = mockAddStatistic.mock.calls
      .map((call) => call[1] as { components: string; output_data: string })
      .find((arg) => arg.components === "Apply Model Summary");
    const rows = (JSON.parse(summary?.output_data ?? "{}") as {
      tables: Array<{ rows: Array<{ rowHeader: string[]; value: string }> }>;
    }).tables[0].rows;
    expect(rows.find((row) => row.rowHeader[0] === "Text Variable")?.value).toBe(
      "Teks → Teks (raw text)"
    );
  });
});

// ---------------------------------------------------------------------------
// Jalur vector
// ---------------------------------------------------------------------------

const VECTOR_VARIABLES: Variable[] = [
  makeVariable("VEC_makan", 0, "scale", "NUMERIC"),
  makeVariable("VEC_nasi", 1, "scale", "NUMERIC"),
  makeVariable("VEC_saya", 2, "scale", "NUMERIC"),
  makeVariable("Sentimen", 3, "nominal", "STRING"),
];

describe("applyModel v2 — jalur Word-Vector", () => {
  it("3 dari 5 kolom terpetakan: mapped_columns = indeks model, values sejajar, non-angka -> null", async () => {
    const data = [
      ["1", "1", "1", "pos"],
      ["", "2", "x", "neg"],
    ];
    mockStoreState.variables = VECTOR_VARIABLES;

    await applyModel({
      formData: makeForm(nbModelVector, {
        VectorMapping: {
          VEC_makan: "VEC_makan",
          VEC_nasi: "VEC_nasi",
          VEC_saya: "VEC_saya",
          VEC_suka: null,
          VEC_tidak: null,
        },
        ActualTargetVar: "Sentimen",
      }),
      variables: VECTOR_VARIABLES,
      dataVariables: data,
    });

    const payload = workerState.payloads[0];
    expect(payload.text).toEqual({
      source: "vector",
      mapped_columns: [0, 1, 2],
      values: [
        [1, 1, 1],
        [null, 2, null],
      ],
    });
    expect(payload.predictors).toEqual([]);
    // Actual tetap slice terakhir, setelah kolom vektor.
    expect(payload.actual[0][0]).toEqual({ Sentimen: "pos" });
    expect(payload.actual[0][1]).toEqual({ Sentimen: "neg" });
  });

  it("mapped_columns mengikuti indeks kolom model walau pemetaan berselang-seling", async () => {
    mockStoreState.variables = VECTOR_VARIABLES;

    await applyModel({
      formData: makeForm(nbModelVector, {
        VectorMapping: {
          VEC_makan: null,
          VEC_nasi: "VEC_nasi",
          VEC_saya: null,
          VEC_suka: "VEC_saya",
          VEC_tidak: null,
        },
      }),
      variables: VECTOR_VARIABLES,
      dataVariables: [["9", "5", "7", "pos"]],
    });

    const payload = workerState.payloads[0];
    expect(payload.text).toEqual({
      source: "vector",
      mapped_columns: [1, 3],
      values: [[5, 7]],
    });
    expect(payload.actual).toEqual([]);
  });

  it("semua kolom tak terpetakan & tanpa fitur lain: baris tetap dihitung, values kosong per baris", async () => {
    mockStoreState.variables = VECTOR_VARIABLES;

    await applyModel({
      formData: makeForm(nbModelVector, {
        VectorMapping: {
          VEC_makan: null,
          VEC_nasi: null,
          VEC_saya: null,
          VEC_suka: null,
          VEC_tidak: null,
        },
      }),
      variables: VECTOR_VARIABLES,
      dataVariables: [["1", "", "", ""], ["2", "", "", ""]],
    });

    const payload = workerState.payloads[0];
    expect(payload.text).toEqual({ source: "vector", mapped_columns: [], values: [[], []] });
    expect(payload.predictors).toEqual([]);
  });

  it("baris ringkasan model memuat 'Word-Vector Columns' (m dari V terpetakan)", async () => {
    mockStoreState.variables = VECTOR_VARIABLES;
    await applyModel({
      formData: makeForm(nbModelVector, {
        VectorMapping: {
          VEC_makan: "VEC_makan",
          VEC_nasi: "VEC_nasi",
          VEC_saya: "VEC_saya",
          VEC_suka: null,
          VEC_tidak: null,
        },
      }),
      variables: VECTOR_VARIABLES,
      dataVariables: [["1", "1", "1", "pos"]],
    });

    const summary = mockAddStatistic.mock.calls
      .map((call) => call[1] as { components: string; output_data: string })
      .find((arg) => arg.components === "Apply Model Summary");
    const rows = (JSON.parse(summary?.output_data ?? "{}") as {
      tables: Array<{ rows: Array<{ rowHeader: string[]; value: string }> }>;
    }).tables[0].rows;
    expect(rows.find((row) => row.rowHeader[0] === "Word-Vector Columns")?.value).toBe(
      "3 of 5 vector columns found; 2 treated as 0."
    );
  });
});

// ---------------------------------------------------------------------------
// Regresi v1 & helper
// ---------------------------------------------------------------------------

describe("applyModel v2 — regresi v1 dan helper", () => {
  it("model v1: payload tidak memiliki key `text` (payload v1 tidak berubah)", async () => {
    const variables = [
      makeVariable("Outlook", 0, "nominal", "STRING"),
      makeVariable("Temp", 1, "scale", "NUMERIC"),
      makeVariable("Play", 2, "nominal", "STRING"),
    ];
    mockStoreState.variables = variables;

    await applyModel({
      formData: makeForm(nbModelV11, {
        FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
        ActualTargetVar: "Play",
      }),
      variables,
      dataVariables: [["Sunny", "71", "Yes"]],
    });

    const payload = workerState.payloads[0];
    expect("text" in payload).toBe(false);
    expect(payload.predictors).toHaveLength(2);
  });

  it("readRawTextValues: tidak memakai parseFloat, memotong ekor kosong, mengisi sampai minLength", () => {
    const data = [["12 hari"], [""], ["akhir"], [""], [""]];
    expect(readRawTextValues(data, 0, 0)).toEqual(["12 hari", null, "akhir"]);
    expect(readRawTextValues(data, 0, 5)).toEqual(["12 hari", null, "akhir", null, null]);
    expect(readRawTextValues(data, 0, 7)).toHaveLength(7);
    expect(readRawTextValues([], 0, 0)).toEqual([]);
  });
});
