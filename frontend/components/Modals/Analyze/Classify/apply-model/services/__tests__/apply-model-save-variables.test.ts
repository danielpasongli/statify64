// AGENTS.md §3.5, §6.6 — test penulisan kolom output Apply Model (PLAN.md
// Fase 17). `useVariableStore` di-mock; hasil fixture Fase 16 (D1 + D3).

import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import type { ApplyModelSaveTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import {
  getOutputColumnSpecs,
  type OutputColumnSpec,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import type { Variable } from "@/types/Variable";

const mockAddVariables = jest.fn();
const mockStoreState: { variables: Variable[]; addVariables: jest.Mock } = {
  variables: [],
  addVariables: mockAddVariables,
};
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: { getState: jest.fn(() => mockStoreState) },
  processVariableName: (name: string) => ({ isValid: true, processedName: name }),
}));

import {
  buildOutputColumns,
  saveApplyModelVariables,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-save-variables";

const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as unknown;

const FINAL_NAMES = [
  "NB_PredictedValue",
  "NB_PredictedProbability",
  "NB_Probability_No",
  "NB_Probability_Yes",
];

function d1Specs(): OutputColumnSpec[] {
  const validation = validateAnyModel(nbModelV11);
  if (!validation.ok) throw new Error("fixture D1 harus valid");
  const save = JSON.parse(JSON.stringify(ApplyModelDefault.save)) as ApplyModelSaveTabType;
  save.SaveClassProbabilities = true;
  return getOutputColumnSpecs(validation.descriptor, save, naiveBayesModelAdapter);
}

function makeVariable(name: string, columnIndex: number): Variable {
  return { name, columnIndex } as Variable;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.variables = [];
});

describe("buildOutputColumns", () => {
  it("D1 + per-class prob ON: 4 definisi berurutan dengan atribut §3.5", () => {
    const { definitions } = buildOutputColumns(rawFixture, d1Specs(), FINAL_NAMES, 3);

    expect(definitions.map((d) => d.name)).toEqual(FINAL_NAMES);
    expect(definitions.map((d) => d.columnIndex)).toEqual([3, 4, 5, 6]);

    const predicted = definitions[0];
    expect(predicted.type).toBe("STRING");
    expect(predicted.measure).toBe("nominal");
    expect(predicted.width).toBe(64);
    expect(predicted.decimals).toBe(0);
    expect(predicted.align).toBe("left");
    expect(predicted.label).toBe("Predicted value (Naive Bayes, target Play)");

    for (const probability of definitions.slice(1)) {
      expect(probability.type).toBe("NUMERIC");
      expect(probability.measure).toBe("scale");
      expect(probability.width).toBe(12);
      expect(probability.decimals).toBe(4);
      expect(probability.align).toBe("right");
    }

    for (const definition of definitions) {
      expect(definition.columns).toBe(64);
      expect(definition.values).toEqual([]);
      expect(definition.missing).toBeNull();
      expect(definition.role).toBe("none");
    }
  });

  it("nilai sel sesuai tabel PLAN.md §1 dan baris 5 (index 4) dilewati", () => {
    const { updates } = buildOutputColumns(rawFixture, d1Specs(), FINAL_NAMES, 3);
    const cell = (row: number, col: number) =>
      updates.find((u) => u.row === row && u.col === col)?.value;

    // Baris 1..6 -> row 0..5; kolom 3..6.
    expect([0, 1, 2, 3, 5].map((row) => cell(row, 3))).toEqual(["No", "Yes", "Yes", "Yes", "No"]);
    expect([0, 1, 2, 3, 5].map((row) => cell(row, 4))).toEqual([1, 0.9967, 0.9921, 0.6, 1]);
    expect([0, 1, 2, 3, 5].map((row) => cell(row, 5))).toEqual([1, 0.0033, 0.0079, 0.4, 1]);
    expect([0, 1, 2, 3, 5].map((row) => cell(row, 6))).toEqual([0, 0.9967, 0.9921, 0.6, 0]);

    expect(updates.some((u) => u.row === 4)).toBe(false);
    expect(updates).toHaveLength(5 * 4);
  });

  it("kelas numerik: predicted NUMERIC ditulis sebagai Number(label)", () => {
    const raw = JSON.parse(JSON.stringify(rawFixture)) as ApplyModelRawResult;
    raw.model_summary.classes = ["0", "1"];
    raw.predictions.predicted = ["1", null, "0"];
    const specs: OutputColumnSpec[] = [
      {
        key: "predicted",
        requestedName: "NB_PredictedValue",
        label: "Predicted value",
        type: "NUMERIC",
        measure: "nominal",
        decimals: 0,
        width: 12,
        align: "right",
      },
    ];

    const { definitions, updates } = buildOutputColumns(raw, specs, ["NB_PredictedValue"], 0);

    expect(definitions[0].type).toBe("NUMERIC");
    expect(updates).toEqual([
      { row: 0, col: 0, value: 1 },
      { row: 2, col: 0, value: 0 },
    ]);
  });

  it("jumlah nama akhir tidak sejajar dengan specs -> AM_E_PAYLOAD", () => {
    expect(() => buildOutputColumns(rawFixture, d1Specs(), ["Satu"], 0)).toThrow(/^AM_E_PAYLOAD/);
  });

  it("kelas pada spec tidak ada di hasil -> AM_E_PAYLOAD", () => {
    const raw = JSON.parse(JSON.stringify(rawFixture)) as ApplyModelRawResult;
    raw.model_summary.classes = ["No"];
    raw.predictions.class_probabilities = [raw.predictions.class_probabilities[0]];
    expect(() => buildOutputColumns(raw, d1Specs(), FINAL_NAMES, 0)).toThrow(/^AM_E_PAYLOAD/);
  });
});

describe("saveApplyModelVariables", () => {
  it("memanggil addVariables SATU kali; kolom baru dimulai setelah columnIndex terbesar", async () => {
    mockStoreState.variables = [
      makeVariable("Outlook", 0),
      makeVariable("Temp", 1),
      makeVariable("Play", 2),
    ];

    await saveApplyModelVariables(rawFixture, d1Specs(), FINAL_NAMES);

    expect(mockAddVariables).toHaveBeenCalledTimes(1);
    const [definitions, updates] = mockAddVariables.mock.calls[0] as [
      Partial<Variable>[],
      Array<{ row: number; col: number; value: string | number }>,
    ];
    expect(definitions.map((d) => d.columnIndex)).toEqual([3, 4, 5, 6]);
    expect(updates.every((u) => u.col >= 3)).toBe(true);
  });

  it("dataset tanpa variabel -> kolom dimulai dari index 0", async () => {
    await saveApplyModelVariables(rawFixture, d1Specs(), FINAL_NAMES);

    const [definitions] = mockAddVariables.mock.calls[0] as [Partial<Variable>[]];
    expect(definitions.map((d) => d.columnIndex)).toEqual([0, 1, 2, 3]);
  });
});
