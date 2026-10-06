// AGENTS_V2.md §10.2 — test pemetaan fitur Text (Fase A1).
// Kolom vektor yang tidak ditemukan = info (AM_I_TEXT_ZERO_FILLED), bukan error.

// Store variabel di-mock: `useApplyModelSaveRules` (diimpor lewat validasi) mengimpor
// `processVariableName`, yang tidak dipakai di sini (pola useApplyModelValidation.test.ts).
jest.mock("@/stores/useVariableStore", () => ({
  processVariableName: jest.fn(),
}));

import {
  autoMapFeatures,
  formatVectorMappingSummary,
  getEligibleActualTargetVariables,
  summarizeVectorMapping,
  validateMapping,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import { computeApplyModelValidation } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelValidation";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import type { Variable } from "@/types/Variable";

const nbModelRaw = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-raw.json") as Record<string, unknown>;
const nbModelVector = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-vector.json") as Record<string, unknown>;
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

function makeVariable(
  name: string,
  measure: Variable["measure"],
  type: Variable["type"] = "NUMERIC"
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

function descriptorOf(model: unknown): ModelDescriptor {
  const result = naiveBayesModelAdapter.validate(model);
  if (!result.ok) {
    throw new Error(`Fixture harus valid: ${JSON.stringify(result.errors)}`);
  }
  return result.descriptor;
}

const codes = (issues: ApplyModelIssue[]) => issues.map((i) => i.code);

describe("Raw text — auto-map & validasi", () => {
  const descriptor = descriptorOf(nbModelRaw);

  it("auto-map nama persis; actual target ikut dipetakan", () => {
    const variables = [
      makeVariable("Teks", "nominal", "STRING"),
      makeVariable("Sentimen", "nominal", "STRING"),
    ];
    const result = autoMapFeatures(descriptor, variables);
    expect(result.RawTextVar).toBe("Teks");
    expect(result.VectorMapping).toBeUndefined();
    expect(result.FeatureMapping).toEqual({});
    expect(result.ActualTargetVar).toBe("Sentimen");
    expect(
      validateMapping(descriptor, result.FeatureMapping, result.ActualTargetVar, variables, {
        RawTextVar: result.RawTextVar,
      })
    ).toEqual([]);
  });

  it("auto-map case-insensitive unik; ambigu -> null", () => {
    const unik = autoMapFeatures(descriptor, [makeVariable("teks", "nominal", "STRING")]);
    expect(unik.RawTextVar).toBe("teks");
    const ambigu = autoMapFeatures(descriptor, [
      makeVariable("TEKS", "nominal", "STRING"),
      makeVariable("teks", "nominal", "STRING"),
    ]);
    expect(ambigu.RawTextVar).toBeNull();
  });

  it("tidak terpetakan -> AM_E_MAP_RAW_TEXT_UNMAPPED (detail raw_variable model)", () => {
    const issues = validateMapping(descriptor, {}, null, [makeVariable("X", "nominal", "STRING")], {
      RawTextVar: null,
    });
    expect(issues).toEqual([
      { code: "AM_E_MAP_RAW_TEXT_UNMAPPED", severity: "error", detail: "Teks" },
    ]);
    // tanpa argumen teks sama sekali pun dianggap belum dipetakan
    expect(codes(validateMapping(descriptor, {}, null, []))).toEqual([
      "AM_E_MAP_RAW_TEXT_UNMAPPED",
    ]);
  });

  it("variabel bertipe NUMERIC -> AM_E_MAP_RAW_TEXT_TYPE", () => {
    const issues = validateMapping(
      descriptor,
      {},
      null,
      [makeVariable("Teks", "scale", "NUMERIC")],
      { RawTextVar: "Teks" }
    );
    expect(issues).toEqual([
      { code: "AM_E_MAP_RAW_TEXT_TYPE", severity: "error", detail: "Teks" },
    ]);
  });

  it("variabel sudah terhapus -> AM_E_MAP_VAR_NOT_FOUND", () => {
    const issues = validateMapping(descriptor, {}, null, [], { RawTextVar: "Hilang" });
    expect(issues).toEqual([
      { code: "AM_E_MAP_VAR_NOT_FOUND", severity: "error", detail: "Hilang" },
    ]);
  });

  it("variabel teks tidak boleh jadi actual target", () => {
    const variables = [makeVariable("Teks", "nominal", "STRING")];
    const issues = validateMapping(descriptor, {}, "Teks", variables, { RawTextVar: "Teks" });
    expect(codes(issues)).toContain("AM_E_ACTUAL_IS_PREDICTOR");
    expect(getEligibleActualTargetVariables({}, variables, { RawTextVar: "Teks" })).toEqual([]);
  });
});

describe("Vector — auto-map, zero-filled, validasi", () => {
  const descriptor = descriptorOf(nbModelVector);
  // 3 dari 5 kolom model ada di dataset (satu beda huruf besar/kecil).
  const variables = [
    makeVariable("VEC_makan", "scale"),
    makeVariable("vec_nasi", "scale"),
    makeVariable("VEC_saya", "scale"),
    makeVariable("Lain", "scale"),
  ];

  it("auto-map vector 3 dari 5 kolom -> 2 zero-filled, valid", () => {
    const result = autoMapFeatures(descriptor, variables);
    expect(result.RawTextVar).toBeUndefined();
    expect(result.VectorMapping).toEqual({
      VEC_makan: "VEC_makan",
      VEC_nasi: "vec_nasi",
      VEC_saya: "VEC_saya",
      VEC_suka: null,
      VEC_tidak: null,
    });

    const summary = summarizeVectorMapping(descriptor, result.VectorMapping);
    expect(summary).toEqual({
      total: 5,
      mapped: 3,
      zeroFilled: ["VEC_suka", "VEC_tidak"],
    });
    expect(formatVectorMappingSummary(summary)).toBe(
      "3 of 5 vector columns found; 2 treated as 0."
    );

    const issues = validateMapping(
      descriptor,
      result.FeatureMapping,
      result.ActualTargetVar,
      variables,
      { VectorMapping: result.VectorMapping }
    );
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues).toEqual([
      { code: "AM_I_TEXT_ZERO_FILLED", severity: "info", detail: "2" },
    ]);
  });

  it("tidak ada kolom ditemukan tetap tidak memblokir (hanya info)", () => {
    const result = autoMapFeatures(descriptor, [makeVariable("Lain", "scale")]);
    expect(Object.values(result.VectorMapping ?? {})).toEqual([null, null, null, null, null]);
    const issues = validateMapping(descriptor, {}, null, [makeVariable("Lain", "scale")], {
      VectorMapping: result.VectorMapping,
    });
    // Model vektor tanpa fitur lain: semua baris NotScored -> peringatan, tetap bukan error.
    expect(issues).toEqual([
      { code: "AM_W_TEXT_ALL_ZERO_FILLED", severity: "warning" },
      { code: "AM_I_TEXT_ZERO_FILLED", severity: "info", detail: "5" },
    ]);
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("sebagian kolom ditemukan -> tidak ada peringatan semua-zero-filled", () => {
    const issues = validateMapping(descriptor, {}, null, [makeVariable("VEC_makan", "scale")], {
      VectorMapping: { VEC_makan: "VEC_makan" },
    });
    expect(codes(issues)).not.toContain("AM_W_TEXT_ALL_ZERO_FILLED");
  });

  it("semua kolom tak terpetakan tetapi ada fitur lain -> tanpa peringatan (baris tetap diskor)", () => {
    const withFeature: ModelDescriptor = {
      ...descriptor,
      features: [{ name: "Umur", role: "numerical" }],
    };
    const vars = [makeVariable("Umur", "scale")];
    const issues = validateMapping(withFeature, { Umur: "Umur" }, null, vars, {
      VectorMapping: {},
    });
    expect(codes(issues)).not.toContain("AM_W_TEXT_ALL_ZERO_FILLED");
    expect(codes(issues)).toContain("AM_I_TEXT_ZERO_FILLED");
  });

  it("computeApplyModelValidation: peringatan semua-zero-filled tidak memblokir OK", () => {
    const out = computeApplyModelValidation(
      {
        ...ApplyModelDefault,
        model: { ...ApplyModelDefault.model, ModelJson: nbModelVector },
        variables: { FeatureMapping: {}, ActualTargetVar: null, VectorMapping: {} },
      },
      []
    );
    expect(out.validation.isValid).toBe(true);
    expect(codes(out.validation.issues)).toContain("AM_W_TEXT_ALL_ZERO_FILLED");
  });

  it("semua kolom ditemukan -> tanpa issue sama sekali", () => {
    const all = ["makan", "nasi", "saya", "suka", "tidak"].map((t) =>
      makeVariable(`VEC_${t}`, "scale")
    );
    const result = autoMapFeatures(descriptor, all);
    expect(validateMapping(descriptor, {}, null, all, { VectorMapping: result.VectorMapping })).toEqual([]);
  });

  it("kolom ditemukan tetapi bertipe STRING -> AM_E_MAP_NUMERIC_TYPE (detail nama kolom model)", () => {
    const vars = [makeVariable("VEC_makan", "nominal", "STRING")];
    const issues = validateMapping(descriptor, {}, null, vars, {
      VectorMapping: { VEC_makan: "VEC_makan" },
    });
    expect(issues).toContainEqual({
      code: "AM_E_MAP_NUMERIC_TYPE",
      severity: "error",
      detail: "VEC_makan",
    });
  });

  it("variabel dataset hilang -> AM_E_MAP_VAR_NOT_FOUND", () => {
    const issues = validateMapping(descriptor, {}, null, [], {
      VectorMapping: { VEC_makan: "Hilang" },
    });
    expect(issues).toContainEqual({
      code: "AM_E_MAP_VAR_NOT_FOUND",
      severity: "error",
      detail: "Hilang",
    });
  });

  it("variabel yang sama untuk dua kolom model -> AM_E_MAP_DUPLICATE sekali", () => {
    const issues = validateMapping(descriptor, {}, null, [makeVariable("A", "scale")], {
      VectorMapping: { VEC_makan: "A", VEC_nasi: "A" },
    });
    expect(issues.filter((i) => i.code === "AM_E_MAP_DUPLICATE")).toHaveLength(1);
  });

  it("auto-map kolom model yang menunjuk variabel sama -> kolom kedua null", () => {
    const result = autoMapFeatures(descriptor, [
      makeVariable("VEC_makan", "scale"),
      makeVariable("vec_MAKAN", "scale"),
    ]);
    // 'VEC_makan' persis ada; kolom lain tidak sama -> null; tidak ada duplikat.
    expect(result.VectorMapping?.VEC_makan).toBe("VEC_makan");
    const used = Object.values(result.VectorMapping ?? {}).filter((v) => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("Kompatibilitas v1 — hasil auto-map tidak berubah", () => {
  it("model 1.1: hasil hanya FeatureMapping + ActualTargetVar (tanpa key teks)", () => {
    const descriptor = descriptorOf(nbModelV11);
    const result = autoMapFeatures(descriptor, [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
      makeVariable("Play", "nominal", "STRING"),
    ]);
    expect(Object.keys(result).sort()).toEqual(["ActualTargetVar", "FeatureMapping"]);
  });
});

describe("computeApplyModelValidation — model 2.0", () => {
  function form(model: unknown, variables: ApplyModelType["variables"]): ApplyModelType {
    return {
      ...ApplyModelDefault,
      model: { ...ApplyModelDefault.model, ModelJson: model },
      variables,
    };
  }

  it("vector dengan kolom zero-filled -> isValid true, info tetap tercatat", () => {
    const variables = [makeVariable("VEC_makan", "scale")];
    const out = computeApplyModelValidation(
      form(nbModelVector, {
        FeatureMapping: {},
        ActualTargetVar: null,
        VectorMapping: { VEC_makan: "VEC_makan" },
      }),
      variables
    );
    expect(out.validation.isValid).toBe(true);
    expect(out.firstErrorMessage).toBeNull();
    expect(out.validation.issues).toContainEqual({
      code: "AM_I_TEXT_ZERO_FILLED",
      severity: "info",
      detail: "4",
    });
  });

  it("raw tanpa pemetaan -> isValid false dengan pesan variabel teks", () => {
    const out = computeApplyModelValidation(
      form(nbModelRaw, { FeatureMapping: {}, ActualTargetVar: null }),
      [makeVariable("Teks", "nominal", "STRING")]
    );
    expect(out.validation.isValid).toBe(false);
    expect(out.firstErrorMessage).toBe('The raw text variable "Teks" is not mapped to a dataset variable. (AM_E_MAP_RAW_TEXT_UNMAPPED)');
  });

  it("raw terpetakan -> isValid true", () => {
    const out = computeApplyModelValidation(
      form(nbModelRaw, { FeatureMapping: {}, ActualTargetVar: null, RawTextVar: "Teks" }),
      [makeVariable("Teks", "nominal", "STRING")]
    );
    expect(out.validation.isValid).toBe(true);
  });
});
