// AGENTS.md §3.2, §4.2 — test registry adapter & `validateAnyModel` (Fase 2).

import {
  CLASSIFIER_MODEL_ADAPTERS,
  getModelAdapter,
  validateAnyModel,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelValidationResult } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelV10 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_0.json") as Record<string, unknown>;

type RawModel = Record<string, unknown>;

function clone(value: unknown): RawModel {
  return JSON.parse(JSON.stringify(value)) as RawModel;
}

function errorsOf(result: ModelValidationResult): ApplyModelIssue[] {
  if (result.ok) {
    throw new Error("Expected validation to fail, but it succeeded");
  }
  return result.errors;
}

function expectOk(
  result: ModelValidationResult
): asserts result is Extract<ModelValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(
      `Expected validation to succeed, got errors: ${JSON.stringify(result.errors)}`
    );
  }
}

describe("CLASSIFIER_MODEL_ADAPTERS & getModelAdapter (§3.2)", () => {
  it("isi awal registry hanya naive_bayes → naiveBayesModelAdapter", () => {
    expect(Object.keys(CLASSIFIER_MODEL_ADAPTERS)).toEqual(["naive_bayes"]);
    expect(CLASSIFIER_MODEL_ADAPTERS["naive_bayes"]).toBe(naiveBayesModelAdapter);
  });

  it('getModelAdapter("naive_bayes") mengembalikan adapter NB', () => {
    const adapter = getModelAdapter("naive_bayes");
    expect(adapter).toBe(naiveBayesModelAdapter);
    expect(adapter?.modelType).toBe("naive_bayes");
    expect(adapter?.algorithmLabel).toBe("Naive Bayes");
    expect(adapter?.supportedSchemaVersions).toEqual(["1.0", "1.1", "2.0"]);
    expect(adapter?.defaultOutputPrefix).toBe("NB");
  });

  it("model_type tidak terdaftar → null", () => {
    expect(getModelAdapter("decision_tree")).toBeNull();
    expect(getModelAdapter("")).toBeNull();
    expect(getModelAdapter("Naive_Bayes")).toBeNull(); // case-sensitive
  });

  it("kunci bawaan Object.prototype tidak dianggap terdaftar", () => {
    expect(getModelAdapter("constructor")).toBeNull();
    expect(getModelAdapter("toString")).toBeNull();
    expect(getModelAdapter("__proto__")).toBeNull();
    expect(getModelAdapter("hasOwnProperty")).toBeNull();
  });
});

describe("validateAnyModel (§4.2)", () => {
  it.each([[null], [undefined], [[1, 2, 3]], [[]], ["teks"], [42], [true]])(
    "%p → AM_E_NOT_OBJECT",
    (value) => {
      const errors = errorsOf(validateAnyModel(value));
      expect(errors).toEqual([{ code: "AM_E_NOT_OBJECT", severity: "error" }]);
    }
  );

  it("model_type tidak ada → AM_E_MODEL_TYPE_MISSING", () => {
    const model = clone(nbModelV11);
    delete model.model_type;
    expect(errorsOf(validateAnyModel(model))).toEqual([
      { code: "AM_E_MODEL_TYPE_MISSING", severity: "error" },
    ]);
  });

  it.each([[42], [null], [true], [["naive_bayes"]], [{ a: 1 }]])(
    "model_type bukan string (%p) → AM_E_MODEL_TYPE_MISSING",
    (modelType) => {
      const model = clone(nbModelV11);
      model.model_type = modelType;
      expect(errorsOf(validateAnyModel(model))).toEqual([
        { code: "AM_E_MODEL_TYPE_MISSING", severity: "error" },
      ]);
    }
  );

  it('model_type "decision_tree" → AM_E_MODEL_TYPE_UNSUPPORTED dengan detail "decision_tree"', () => {
    const model = clone(nbModelV11);
    model.model_type = "decision_tree";
    expect(errorsOf(validateAnyModel(model))).toEqual([
      {
        code: "AM_E_MODEL_TYPE_UNSUPPORTED",
        severity: "error",
        detail: "decision_tree",
      },
    ]);
  });

  it("model_type string kosong → AM_E_MODEL_TYPE_UNSUPPORTED (bukan MISSING)", () => {
    const model = clone(nbModelV11);
    model.model_type = "";
    expect(errorsOf(validateAnyModel(model))).toEqual([
      { code: "AM_E_MODEL_TYPE_UNSUPPORTED", severity: "error", detail: "" },
    ]);
  });

  it.each([["constructor"], ["toString"], ["__proto__"]])(
    'model_type "%s" (kunci Object.prototype) → AM_E_MODEL_TYPE_UNSUPPORTED',
    (modelType) => {
      const model = clone(nbModelV11);
      model.model_type = modelType;
      expect(errorsOf(validateAnyModel(model))).toEqual([
        { code: "AM_E_MODEL_TYPE_UNSUPPORTED", severity: "error", detail: modelType },
      ]);
    }
  );

  it("model NB valid (1.1) didelegasikan ke adapter NB, hasil identik", () => {
    const viaRegistry = validateAnyModel(nbModelV11);
    expectOk(viaRegistry);
    expect(viaRegistry.descriptor.modelType).toBe("naive_bayes");
    expect(viaRegistry.descriptor.schemaVersion).toBe("1.1");
    expect(viaRegistry.descriptor.warnings).toEqual([]);
    expect(viaRegistry).toEqual(naiveBayesModelAdapter.validate(nbModelV11));
  });

  it("model NB 1.0 didelegasikan dan membawa warning AM_W_LEGACY_SCHEMA", () => {
    const result = validateAnyModel(nbModelV10);
    expectOk(result);
    expect(result.descriptor.warnings).toEqual(["AM_W_LEGACY_SCHEMA"]);
  });

  it("error adapter NB diteruskan apa adanya (schema_version salah)", () => {
    const model = clone(nbModelV11);
    model.schema_version = "9.9";
    expect(errorsOf(validateAnyModel(model))).toEqual([
      { code: "AM_E_SCHEMA_VERSION_UNSUPPORTED", severity: "error", detail: "9.9" },
    ]);
  });
});
