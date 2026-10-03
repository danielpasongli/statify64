// AGENTS.md §3.5 — test aturan penamaan & tipe kolom output (Fase 4).
// Fixture model D1 (PLAN.md §1) dimuat dari berkas fixture Fase 2.

// Salinan setia `processVariableName` (FE/stores/useVariableStore.ts:29-59).
// Store asli tidak dimuat di Jest (menarik service/IndexedDB), jadi di-mock;
// logika penamaannya disalin agar hasil "Rain_Day" dan akhiran "_1" nyata.
jest.mock("@/stores/useVariableStore", () => {
  const reserved = new Set(["ALL", "AND", "BY", "EQ", "GE", "GT", "LE", "LT", "NE", "NOT", "OR", "TO", "WITH"]);
  return {
    processVariableName: (name: string, existingVariables: Array<{ name: string }>) => {
      if (!name) return { isValid: false, message: "Variable name cannot be empty" };
      let processedName = name.trim().replace(/\s+/g, "_");
      processedName = processedName.replace(/[^A-Za-z0-9._@#$]/g, "_");
      if (!/^[A-Za-z@#$]/.test(processedName)) processedName = "VAR_" + processedName;
      processedName = processedName.replace(/[._]+$/g, "");
      if (processedName.length > 64) processedName = processedName.slice(0, 64);
      if (reserved.has(processedName.toUpperCase())) processedName = "VAR_" + processedName;
      const existingNames = existingVariables.map((v) => v.name.toLowerCase());
      if (existingNames.includes(processedName.toLowerCase())) {
        let counter = 1;
        const base = processedName.slice(0, 60);
        let uniqueName = processedName;
        while (existingNames.includes(uniqueName.toLowerCase())) {
          uniqueName = `${base}_${counter}`;
          counter++;
        }
        processedName = uniqueName;
      }
      return { isValid: true, processedName };
    },
  };
});

import {
  getOutputColumnSpecs,
  resolveFinalOutputNames,
  resolvePredictedColumnType,
  validateCustomOutputNames,
  validateNamePrefix,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelSaveRules";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { ApplyModelSaveDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelSaveTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

function loadDescriptor(): ModelDescriptor {
  const result = naiveBayesModelAdapter.validate(JSON.parse(JSON.stringify(nbModelV11)));
  if (!result.ok) throw new Error("Fixture D1 harus valid");
  return result.descriptor;
}

function makeSave(overrides: Partial<ApplyModelSaveTabType> = {}): ApplyModelSaveTabType {
  return {
    ...JSON.parse(JSON.stringify(ApplyModelSaveDefault)),
    ...overrides,
  } as ApplyModelSaveTabType;
}

function makeVariable(name: string, columnIndex: number): Variable {
  return {
    columnIndex,
    name,
    type: "STRING",
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 64,
    align: "left",
    measure: "nominal",
    role: "input",
  };
}

describe("getOutputColumnSpecs", () => {
  const descriptor = loadDescriptor();

  it("D1 + default save → predicted dan max probability", () => {
    const specs = getOutputColumnSpecs(descriptor, makeSave(), naiveBayesModelAdapter);
    expect(specs.map((s) => s.requestedName)).toEqual(["NB_PredictedValue", "NB_PredictedProbability"]);
    expect(specs.map((s) => s.key)).toEqual(["predicted", "maxProbability"]);
  });

  it("kolom predicted bertipe STRING nominal untuk kelas No/Yes", () => {
    const [predicted] = getOutputColumnSpecs(descriptor, makeSave(), naiveBayesModelAdapter);
    expect(predicted).toMatchObject({
      type: "STRING",
      measure: "nominal",
      decimals: 0,
      width: 64,
      align: "left",
      label: "Predicted value (Naive Bayes, target Play)",
    });
  });

  it("kolom max probability: NUMERIC scale 4 desimal", () => {
    const specs = getOutputColumnSpecs(descriptor, makeSave(), naiveBayesModelAdapter);
    expect(specs[1]).toMatchObject({
      type: "NUMERIC",
      measure: "scale",
      decimals: 4,
      width: 12,
      align: "right",
      label: "Predicted probability of predicted class",
    });
  });

  it("SaveClassProbabilities menambah satu kolom per kelas sesuai urutan kelas", () => {
    const specs = getOutputColumnSpecs(descriptor, makeSave({ SaveClassProbabilities: true }), naiveBayesModelAdapter);
    expect(specs.map((s) => s.requestedName)).toEqual([
      "NB_PredictedValue",
      "NB_PredictedProbability",
      "NB_Probability_No",
      "NB_Probability_Yes",
    ]);
    expect(specs[2].key).toBe("class:No");
    expect(specs[3].key).toBe("class:Yes");
    expect(specs[2]).toMatchObject({
      type: "NUMERIC",
      measure: "scale",
      decimals: 4,
      width: 12,
      align: "right",
      label: "Predicted probability of No",
    });
  });

  it("SaveMaxProbability=false → hanya predicted (urutan tetap bila class probs aktif)", () => {
    const onlyPredicted = getOutputColumnSpecs(descriptor, makeSave({ SaveMaxProbability: false }), naiveBayesModelAdapter);
    expect(onlyPredicted.map((s) => s.key)).toEqual(["predicted"]);

    const withClass = getOutputColumnSpecs(
      descriptor,
      makeSave({ SaveMaxProbability: false, SaveClassProbabilities: true }),
      naiveBayesModelAdapter,
    );
    expect(withClass.map((s) => s.key)).toEqual(["predicted", "class:No", "class:Yes"]);
  });

  it("NamePrefix kustom menggantikan prefix default adapter", () => {
    const specs = getOutputColumnSpecs(
      descriptor,
      makeSave({ NamePrefix: "Model1", SaveClassProbabilities: true }),
      naiveBayesModelAdapter,
    );
    expect(specs.map((s) => s.requestedName)).toEqual([
      "Model1_PredictedValue",
      "Model1_PredictedProbability",
      "Model1_Probability_No",
      "Model1_Probability_Yes",
    ]);
  });

  it("UseCustomNames=true memakai nama kustom (termasuk per kelas)", () => {
    const save = makeSave({
      SaveClassProbabilities: true,
      UseCustomNames: true,
      CustomNames: {
        PredictedValue: "Pred",
        MaxProbability: "PMax",
        ClassProbabilities: { No: "PNo", Yes: "PYes" },
      },
    });
    const specs = getOutputColumnSpecs(descriptor, save, naiveBayesModelAdapter);
    expect(specs.map((s) => s.requestedName)).toEqual(["Pred", "PMax", "PNo", "PYes"]);
  });

  it("UseCustomNames=true dengan field null/tidak ada TIDAK jatuh ke default", () => {
    const save = makeSave({
      SaveClassProbabilities: true,
      UseCustomNames: true,
      CustomNames: {
        PredictedValue: null,
        MaxProbability: "PMax",
        ClassProbabilities: { No: null },
      },
    });
    const specs = getOutputColumnSpecs(descriptor, save, naiveBayesModelAdapter);
    expect(specs.map((s) => s.requestedName)).toEqual(["", "PMax", "", ""]);
  });

  it("UseCustomNames=false mengabaikan CustomNames", () => {
    const save = makeSave({
      UseCustomNames: false,
      CustomNames: { PredictedValue: "Pred", MaxProbability: "PMax", ClassProbabilities: {} },
    });
    const specs = getOutputColumnSpecs(descriptor, save, naiveBayesModelAdapter);
    expect(specs.map((s) => s.requestedName)).toEqual(["NB_PredictedValue", "NB_PredictedProbability"]);
  });

  it("kelas numerik membuat kolom predicted NUMERIC", () => {
    const numericDescriptor: ModelDescriptor = { ...descriptor, classes: ["0.5", "1.25"] };
    const [predicted] = getOutputColumnSpecs(numericDescriptor, makeSave(), naiveBayesModelAdapter);
    expect(predicted).toMatchObject({ type: "NUMERIC", decimals: 2, width: 12, align: "right", measure: "nominal" });
  });
});

describe("resolvePredictedColumnType", () => {
  it('["1","2","10"] → NUMERIC, decimals 0, width 12, right', () => {
    expect(resolvePredictedColumnType(["1", "2", "10"])).toEqual({
      type: "NUMERIC",
      decimals: 0,
      width: 12,
      align: "right",
    });
  });

  it('["0.5","1.25"] → NUMERIC, decimals 2', () => {
    expect(resolvePredictedColumnType(["0.5", "1.25"])).toEqual({
      type: "NUMERIC",
      decimals: 2,
      width: 12,
      align: "right",
    });
  });

  it('["-1","2.5"] → NUMERIC, decimals 1 (angka negatif dikenali)', () => {
    expect(resolvePredictedColumnType(["-1", "2.5"])).toMatchObject({ type: "NUMERIC", decimals: 1 });
  });

  it('["No","Yes"] → STRING, decimals 0, width 64, left', () => {
    expect(resolvePredictedColumnType(["No", "Yes"])).toEqual({
      type: "STRING",
      decimals: 0,
      width: 64,
      align: "left",
    });
  });

  it('["1","A"] → STRING (tidak semua kelas numerik)', () => {
    expect(resolvePredictedColumnType(["1", "A"]).type).toBe("STRING");
  });

  it('["1.","2"] → STRING (format angka tidak memenuhi pola)', () => {
    expect(resolvePredictedColumnType(["1.", "2"]).type).toBe("STRING");
  });
});

describe("validateCustomOutputNames", () => {
  const spec = (name: string, key: "predicted" | "maxProbability" = "predicted") => ({ key, requestedName: name });

  it("nama valid → tanpa issue", () => {
    expect(validateCustomOutputNames([spec("Pred"), spec("PMax", "maxProbability")])).toEqual([]);
  });

  it('nama "" → AM_E_NAME_EMPTY (detail = key kolom)', () => {
    expect(validateCustomOutputNames([spec("")])).toEqual([
      { code: "AM_E_NAME_EMPTY", severity: "error", detail: "predicted" },
    ]);
  });

  it("nama hanya spasi → AM_E_NAME_EMPTY", () => {
    expect(validateCustomOutputNames([spec("   ", "maxProbability")])).toEqual([
      { code: "AM_E_NAME_EMPTY", severity: "error", detail: "maxProbability" },
    ]);
  });

  it('"1abc" → AM_E_NAME_INVALID', () => {
    expect(validateCustomOutputNames([spec("1abc")])).toEqual([
      { code: "AM_E_NAME_INVALID", severity: "error", detail: "1abc" },
    ]);
  });

  it("65 karakter → AM_E_NAME_TOO_LONG", () => {
    const longName = "a".repeat(65);
    expect(validateCustomOutputNames([spec(longName)])).toEqual([
      { code: "AM_E_NAME_TOO_LONG", severity: "error", detail: longName },
    ]);
  });

  it("64 karakter masih valid", () => {
    expect(validateCustomOutputNames([spec("a".repeat(64))])).toEqual([]);
  });

  it('"with" → AM_E_NAME_RESERVED (case-insensitive)', () => {
    expect(validateCustomOutputNames([spec("with")])).toEqual([
      { code: "AM_E_NAME_RESERVED", severity: "error", detail: "with" },
    ]);
    expect(validateCustomOutputNames([spec("Not")])[0].code).toBe("AM_E_NAME_RESERVED");
  });

  it('"abc" dan "ABC" → AM_E_NAME_DUPLICATE pada nama kedua', () => {
    expect(validateCustomOutputNames([spec("abc"), spec("ABC", "maxProbability")])).toEqual([
      { code: "AM_E_NAME_DUPLICATE", severity: "error", detail: "ABC" },
    ]);
  });

  it("mengumpulkan semua issue dari beberapa nama", () => {
    const issues = validateCustomOutputNames([spec(""), spec("1abc", "maxProbability")]);
    expect(issues.map((i) => i.code)).toEqual(["AM_E_NAME_EMPTY", "AM_E_NAME_INVALID"]);
  });

  it("daftar kosong → tanpa issue", () => {
    expect(validateCustomOutputNames([])).toEqual([]);
  });
});

describe("validateNamePrefix", () => {
  it("null → tanpa issue (pakai default adapter)", () => {
    expect(validateNamePrefix(null)).toEqual([]);
  });

  it('"NB" valid', () => {
    expect(validateNamePrefix("NB")).toEqual([]);
  });

  it('"" → AM_E_NAME_EMPTY', () => {
    expect(validateNamePrefix("")).toEqual([{ code: "AM_E_NAME_EMPTY", severity: "error", detail: "prefix" }]);
  });

  it('"1abc" → AM_E_NAME_INVALID', () => {
    expect(validateNamePrefix("1abc")).toEqual([{ code: "AM_E_NAME_INVALID", severity: "error", detail: "1abc" }]);
  });

  it("65 karakter → AM_E_NAME_TOO_LONG", () => {
    const longName = "b".repeat(65);
    expect(validateNamePrefix(longName)).toEqual([{ code: "AM_E_NAME_TOO_LONG", severity: "error", detail: longName }]);
  });

  it('"with" → AM_E_NAME_RESERVED', () => {
    expect(validateNamePrefix("with")).toEqual([{ code: "AM_E_NAME_RESERVED", severity: "error", detail: "with" }]);
  });

  it("tidak pernah menghasilkan AM_E_NAME_DUPLICATE", () => {
    expect(validateNamePrefix("abc").some((i) => i.code === "AM_E_NAME_DUPLICATE")).toBe(false);
  });
});

describe("resolveFinalOutputNames", () => {
  it("tanpa bentrok → nama akhir = nama diminta, adjusted kosong", () => {
    const result = resolveFinalOutputNames(["NB_PredictedValue", "NB_PredictedProbability"], []);
    expect(result.finalNames).toEqual(["NB_PredictedValue", "NB_PredictedProbability"]);
    expect(result.adjusted).toEqual([]);
  });

  it('kelas "Rain Day" → NB_Probability_Rain Day menjadi NB_Probability_Rain_Day', () => {
    const descriptor: ModelDescriptor = { ...loadDescriptor(), classes: ["Rain Day", "Sunny"] };
    const specs = getOutputColumnSpecs(descriptor, makeSave({ SaveClassProbabilities: true }), naiveBayesModelAdapter);
    const requested = specs.map((s) => s.requestedName);
    expect(requested).toContain("NB_Probability_Rain Day");

    const result = resolveFinalOutputNames(requested, []);
    expect(result.finalNames).toContain("NB_Probability_Rain_Day");
    expect(result.adjusted).toEqual([{ requested: "NB_Probability_Rain Day", final: "NB_Probability_Rain_Day" }]);
  });

  it("variabel dataset sudah ada NB_PredictedValue → NB_PredictedValue_1 + entri adjusted", () => {
    const result = resolveFinalOutputNames(
      ["NB_PredictedValue", "NB_PredictedProbability"],
      [makeVariable("NB_PredictedValue", 0)],
    );
    expect(result.finalNames).toEqual(["NB_PredictedValue_1", "NB_PredictedProbability"]);
    expect(result.adjusted).toEqual([{ requested: "NB_PredictedValue", final: "NB_PredictedValue_1" }]);
  });

  it("bentrok dengan variabel dataset tidak peka huruf besar/kecil", () => {
    const result = resolveFinalOutputNames(["NB_PredictedValue"], [makeVariable("nb_predictedvalue", 0)]);
    expect(result.finalNames).toEqual(["NB_PredictedValue_1"]);
  });

  it("dua nama yang sama diproses berurutan dengan daftar yang tumbuh", () => {
    const result = resolveFinalOutputNames(["Dup", "Dup", "dup"], []);
    expect(result.finalNames).toEqual(["Dup", "Dup_1", "dup_2"]);
    expect(result.adjusted).toEqual([
      { requested: "Dup", final: "Dup_1" },
      { requested: "dup", final: "dup_2" },
    ]);
  });

  it("nama kosong (tak bisa diproses) dikembalikan apa adanya tanpa melempar", () => {
    const result = resolveFinalOutputNames([""], []);
    expect(result.finalNames).toEqual([""]);
    expect(result.adjusted).toEqual([]);
  });
});
