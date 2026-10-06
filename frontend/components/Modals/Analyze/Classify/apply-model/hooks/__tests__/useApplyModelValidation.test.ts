// AGENTS.md §6.5 — test validasi terpusat (PLAN.md Fase 15).
// Store variabel di-mock: `useApplyModelSaveRules` mengimpor
// `processVariableName`, yang tidak dipakai validasi ini.

jest.mock("@/stores/useVariableStore", () => ({
  processVariableName: jest.fn(),
}));

import { renderHook } from "@testing-library/react";
import {
  computeApplyModelValidation,
  formatApplyModelIssueMessage,
  useApplyModelValidation,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelValidation";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

// Fixture D1 dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

function makeVariable(
  name: string,
  measure: Variable["measure"],
  type: Variable["type"]
): Variable {
  return {
    columnIndex: 0,
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

// Dataset D3 (PLAN.md §1).
function makeD3Variables(): Variable[] {
  return [
    makeVariable("Outlook", "nominal", "STRING"),
    makeVariable("Temp", "scale", "NUMERIC"),
    makeVariable("Play", "nominal", "STRING"),
  ];
}

function cloneDefault(): ApplyModelType {
  return JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;
}

// Form valid: model D1 + mapping otomatis D3 + actual Play.
function makeValidForm(): ApplyModelType {
  const form = cloneDefault();
  form.model.ModelJson = JSON.parse(JSON.stringify(nbModelV11));
  form.variables = {
    FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
    ActualTargetVar: "Play",
  };
  return form;
}

function codesOf(issues: ApplyModelIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("computeApplyModelValidation", () => {
  it("tanpa model → isValid false dan AM_E_NO_MODEL", () => {
    const { validation, firstErrorMessage } = computeApplyModelValidation(
      cloneDefault(),
      makeD3Variables()
    );

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toEqual(["AM_E_NO_MODEL"]);
    expect(firstErrorMessage).toBe(APPLY_MODEL_MESSAGES.AM_E_NO_MODEL);
  });

  it("D1 + mapping valid → isValid true, tanpa issue, tanpa pesan error", () => {
    const { validation, firstErrorMessage } = computeApplyModelValidation(
      makeValidForm(),
      makeD3Variables()
    );

    expect(validation.isValid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(firstErrorMessage).toBeNull();
  });

  it("nama kustom invalid (\"1abc\") → isValid false dengan AM_E_NAME_INVALID", () => {
    const form = makeValidForm();
    form.save.UseCustomNames = true;
    form.save.CustomNames = {
      PredictedValue: "1abc",
      MaxProbability: "Prob_OK",
      ClassProbabilities: {},
    };

    const { validation, firstErrorMessage } = computeApplyModelValidation(
      form,
      makeD3Variables()
    );

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toEqual(["AM_E_NAME_INVALID"]);
    expect(firstErrorMessage).toBe(
      APPLY_MODEL_MESSAGES.AM_E_NAME_INVALID.replace("{detail}", "1abc")
    );
  });

  it("nama kustom valid → isValid true", () => {
    const form = makeValidForm();
    form.save.UseCustomNames = true;
    form.save.CustomNames = {
      PredictedValue: "Pred_Play",
      MaxProbability: "Prob_Play",
      ClassProbabilities: {},
    };

    expect(
      computeApplyModelValidation(form, makeD3Variables()).validation.isValid
    ).toBe(true);
  });

  it("UseCustomNames false → CustomNames invalid diabaikan", () => {
    const form = makeValidForm();
    form.save.UseCustomNames = false;
    form.save.CustomNames = {
      PredictedValue: "1abc",
      MaxProbability: "",
      ClassProbabilities: {},
    };

    expect(
      computeApplyModelValidation(form, makeD3Variables()).validation.isValid
    ).toBe(true);
  });

  it("nama kustom null saat UseCustomNames true → AM_E_NAME_EMPTY (tidak jatuh ke default)", () => {
    const form = makeValidForm();
    form.save.UseCustomNames = true;

    const { validation } = computeApplyModelValidation(form, makeD3Variables());

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toEqual([
      "AM_E_NAME_EMPTY",
      "AM_E_NAME_EMPTY",
    ]);
  });

  it("NamePrefix invalid → isValid false dengan AM_E_NAME_INVALID; prefix valid → true", () => {
    const invalid = makeValidForm();
    invalid.save.NamePrefix = "1X";
    const invalidResult = computeApplyModelValidation(
      invalid,
      makeD3Variables()
    );
    expect(invalidResult.validation.isValid).toBe(false);
    expect(codesOf(invalidResult.validation.issues)).toEqual([
      "AM_E_NAME_INVALID",
    ]);

    const valid = makeValidForm();
    valid.save.NamePrefix = "XY";
    expect(
      computeApplyModelValidation(valid, makeD3Variables()).validation.isValid
    ).toBe(true);
  });

  it("fitur belum dipetakan → isValid false dengan AM_E_MAP_UNMAPPED", () => {
    const form = makeValidForm();
    form.variables.FeatureMapping = { Outlook: "Outlook", Temp: null };

    const { validation, firstErrorMessage } = computeApplyModelValidation(
      form,
      makeD3Variables()
    );

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toEqual(["AM_E_MAP_UNMAPPED"]);
    expect(firstErrorMessage).toBe(
      APPLY_MODEL_MESSAGES.AM_E_MAP_UNMAPPED.replace("{detail}", "Temp")
    );
  });

  it("actual target = prediktor → isValid false dengan AM_E_ACTUAL_IS_PREDICTOR", () => {
    const form = makeValidForm();
    form.variables.ActualTargetVar = "Outlook";

    const { validation } = computeApplyModelValidation(
      form,
      makeD3Variables()
    );

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toContain("AM_E_ACTUAL_IS_PREDICTOR");
  });

  it("actual target kosong (null) tetap valid", () => {
    const form = makeValidForm();
    form.variables.ActualTargetVar = null;

    expect(
      computeApplyModelValidation(form, makeD3Variables()).validation.isValid
    ).toBe(true);
  });

  it("model_type tidak terdaftar → isValid false dengan AM_E_MODEL_TYPE_UNSUPPORTED", () => {
    const form = makeValidForm();
    form.model.ModelJson = { ...nbModelV11, model_type: "svm" };

    const { validation, firstErrorMessage } = computeApplyModelValidation(
      form,
      makeD3Variables()
    );

    expect(validation.isValid).toBe(false);
    expect(codesOf(validation.issues)).toEqual(["AM_E_MODEL_TYPE_UNSUPPORTED"]);
    expect(firstErrorMessage).toBe(
      APPLY_MODEL_MESSAGES.AM_E_MODEL_TYPE_UNSUPPORTED.replace("{detail}", "svm")
    );
  });
});

describe("formatApplyModelIssueMessage", () => {
  it("mengganti {detail} dan mengosongkannya bila detail tidak ada", () => {
    expect(
      formatApplyModelIssueMessage({
        code: "AM_E_SCHEMA_VERSION_UNSUPPORTED",
        severity: "error",
        detail: "3.0",
      })
    ).toBe(
      "The model format version \"3.0\" is not supported. Supported versions: 1.0, 1.1, 2.0. (AM_E_SCHEMA_VERSION_UNSUPPORTED)"
    );
    expect(
      formatApplyModelIssueMessage({ code: "AM_E_NO_ROWS", severity: "error" })
    ).toBe(APPLY_MODEL_MESSAGES.AM_E_NO_ROWS);
  });
});

describe("useApplyModelValidation", () => {
  it("membungkus fungsi murni: valid → invalid saat form berubah", () => {
    const variables = makeD3Variables();
    const { result, rerender } = renderHook(
      ({ form }: { form: ApplyModelType }) =>
        useApplyModelValidation(form, variables),
      { initialProps: { form: cloneDefault() } }
    );
    expect(result.current.validation.isValid).toBe(false);

    rerender({ form: makeValidForm() });
    expect(result.current.validation.isValid).toBe(true);
    expect(result.current.firstErrorMessage).toBeNull();

    const broken = makeValidForm();
    broken.save.UseCustomNames = true;
    broken.save.CustomNames.PredictedValue = "with";
    broken.save.CustomNames.MaxProbability = "Prob_OK";
    rerender({ form: broken });
    expect(result.current.validation.isValid).toBe(false);
    expect(codesOf(result.current.validation.issues)).toEqual([
      "AM_E_NAME_RESERVED",
    ]);
  });
});
