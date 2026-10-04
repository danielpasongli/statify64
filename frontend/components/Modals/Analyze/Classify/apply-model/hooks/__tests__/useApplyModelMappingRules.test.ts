// AGENTS.md §3.4 — test aturan pemetaan variabel (Fase 3).
// Pola makeVariable: NB/hooks/__tests__/useNaiveBayesValidation.test.ts.

import {
  autoMapFeatures,
  getEligibleActualTargetVariables,
  getEligibleVariablesForFeature,
  validateMapping,
} from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type { Variable } from "@/types/Variable";

// Fixture D1 dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

function getD1Descriptor(): ModelDescriptor {
  const result = naiveBayesModelAdapter.validate(nbModelV11);
  if (!result.ok) {
    throw new Error("Fixture D1 harus valid");
  }
  return result.descriptor;
}

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

function makeDescriptor(
  features: ModelDescriptor["features"],
  targetName = "Play"
): ModelDescriptor {
  return {
    modelType: "naive_bayes",
    algorithmLabel: "Naive Bayes",
    schemaVersion: "1.1",
    trainedAt: null,
    targetName,
    classes: ["No", "Yes"],
    features,
    summaryRows: [],
    warnings: [],
  };
}

function error(code: ApplyModelIssue["code"], detail: string): ApplyModelIssue {
  return { code, severity: "error", detail };
}

// Variabel dataset D3 (PLAN.md §1): Outlook STRING nominal, Temp NUMERIC
// scale, Play STRING nominal.
function d3Variables(): Variable[] {
  return [
    makeVariable("Outlook", "nominal", "STRING"),
    makeVariable("Temp", "scale", "NUMERIC"),
    makeVariable("Play", "nominal", "STRING"),
  ];
}

describe("autoMapFeatures + validateMapping — D1 dengan variabel D3", () => {
  it("memetakan Outlook & Temp, actual Play, tanpa issue", () => {
    const descriptor = getD1Descriptor();
    const variables = d3Variables();

    const result = autoMapFeatures(descriptor, variables);

    expect(result.FeatureMapping).toEqual({ Outlook: "Outlook", Temp: "Temp" });
    expect(result.ActualTargetVar).toBe("Play");
    expect(
      validateMapping(
        descriptor,
        result.FeatureMapping,
        result.ActualTargetVar,
        variables
      )
    ).toEqual([]);
  });

  it("nama huruf kecil (outlook) tetap terpetakan", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
      makeVariable("Play", "nominal", "STRING"),
    ];

    const result = autoMapFeatures(descriptor, variables);

    expect(result.FeatureMapping).toEqual({ Outlook: "outlook", Temp: "Temp" });
    expect(
      validateMapping(
        descriptor,
        result.FeatureMapping,
        result.ActualTargetVar,
        variables
      )
    ).toEqual([]);
  });

  it("OUTLOOK dan outlook sekaligus (ambigu) -> null + AM_E_MAP_UNMAPPED", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("OUTLOOK", "nominal", "STRING"),
      makeVariable("outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
      makeVariable("Play", "nominal", "STRING"),
    ];

    const result = autoMapFeatures(descriptor, variables);

    expect(result.FeatureMapping).toEqual({ Outlook: null, Temp: "Temp" });
    expect(
      validateMapping(
        descriptor,
        result.FeatureMapping,
        result.ActualTargetVar,
        variables
      )
    ).toEqual([error("AM_E_MAP_UNMAPPED", "Outlook")]);
  });

  it("nama persis menang atas kandidat case-insensitive", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("outlook", "nominal", "STRING"),
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
    ];

    expect(autoMapFeatures(descriptor, variables).FeatureMapping).toEqual({
      Outlook: "Outlook",
      Temp: "Temp",
    });
  });

  it("Temp ber-measure nominal -> AM_E_MAP_ROLE_MISMATCH (detail nama fitur)", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "nominal"),
      makeVariable("Play", "nominal", "STRING"),
    ];
    const result = autoMapFeatures(descriptor, variables);

    expect(
      validateMapping(
        descriptor,
        result.FeatureMapping,
        result.ActualTargetVar,
        variables
      )
    ).toEqual([error("AM_E_MAP_ROLE_MISMATCH", "Temp")]);
  });

  it("fitur categorical dipetakan ke variabel scale -> AM_E_MAP_ROLE_MISMATCH", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "scale"),
      makeVariable("Temp", "scale"),
    ];

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        null,
        variables
      )
    ).toEqual([error("AM_E_MAP_ROLE_MISMATCH", "Outlook")]);
  });

  it("Temp ber-measure unknown -> AM_E_MAP_MEASURE_UNKNOWN (detail nama variabel)", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "unknown"),
    ];

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        null,
        variables
      )
    ).toEqual([error("AM_E_MAP_MEASURE_UNKNOWN", "Temp")]);
  });

  it("Temp scale bertipe STRING -> AM_E_MAP_NUMERIC_TYPE (detail nama fitur)", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale", "STRING"),
    ];

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        null,
        variables
      )
    ).toEqual([error("AM_E_MAP_NUMERIC_TYPE", "Temp")]);
  });

  it("variabel yang dipetakan sudah terhapus -> AM_E_MAP_VAR_NOT_FOUND (detail nama variabel)", () => {
    const descriptor = getD1Descriptor();
    const variables = [makeVariable("Outlook", "nominal", "STRING")];

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "TempHilang" },
        null,
        variables
      )
    ).toEqual([error("AM_E_MAP_VAR_NOT_FOUND", "TempHilang")]);
  });

  it("fitur tanpa key di mapping diperlakukan belum dipetakan", () => {
    const descriptor = getD1Descriptor();

    expect(
      validateMapping(descriptor, { Outlook: "Outlook" }, null, d3Variables())
    ).toEqual([error("AM_E_MAP_UNMAPPED", "Temp")]);
  });
});

describe("validateMapping — duplikat", () => {
  it("satu variabel di dua fitur -> AM_E_MAP_DUPLICATE sekali (detail nama variabel)", () => {
    const descriptor = makeDescriptor([
      { name: "A", role: "categorical" },
      { name: "B", role: "categorical" },
    ]);
    const variables = [makeVariable("X", "nominal", "STRING")];

    expect(
      validateMapping(descriptor, { A: "X", B: "X" }, null, variables)
    ).toEqual([error("AM_E_MAP_DUPLICATE", "X")]);
  });

  it("auto-map case-insensitive yang menghasilkan duplikat: fitur kedua menjadi null", () => {
    const descriptor = makeDescriptor([
      { name: "Ab", role: "categorical" },
      { name: "aB", role: "categorical" },
    ]);
    const variables = [makeVariable("Ab", "nominal", "STRING")];

    expect(autoMapFeatures(descriptor, variables).FeatureMapping).toEqual({
      Ab: "Ab",
      aB: null,
    });
  });
});

describe("Actual target", () => {
  it("auto-map: Play ber-measure scale -> ActualTargetVar null", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
      makeVariable("Play", "scale"),
    ];

    const result = autoMapFeatures(descriptor, variables);

    expect(result.FeatureMapping).toEqual({ Outlook: "Outlook", Temp: "Temp" });
    expect(result.ActualTargetVar).toBeNull();
  });

  it("auto-map: variabel target sudah dipakai sebagai prediktor -> null", () => {
    const descriptor = makeDescriptor(
      [
        { name: "Outlook", role: "categorical" },
        { name: "Temp", role: "numerical" },
      ],
      "Outlook"
    );

    expect(
      autoMapFeatures(descriptor, d3Variables()).ActualTargetVar
    ).toBeNull();
  });

  it("auto-map: target dicocokkan case-insensitive bila unik", () => {
    const descriptor = getD1Descriptor();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale"),
      makeVariable("play", "ordinal", "STRING"),
    ];

    expect(autoMapFeatures(descriptor, variables).ActualTargetVar).toBe("play");
  });

  it("actual = variabel scale -> AM_E_ACTUAL_MEASURE", () => {
    const descriptor = getD1Descriptor();
    const variables = [...d3Variables(), makeVariable("Score", "scale")];

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        "Score",
        variables
      )
    ).toEqual([error("AM_E_ACTUAL_MEASURE", "Score")]);
  });

  it("actual = variabel prediktor -> AM_E_ACTUAL_IS_PREDICTOR", () => {
    const descriptor = getD1Descriptor();

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        "Outlook",
        d3Variables()
      )
    ).toEqual([error("AM_E_ACTUAL_IS_PREDICTOR", "Outlook")]);
  });

  it("actual tidak ada di dataset -> AM_E_ACTUAL_NOT_FOUND", () => {
    const descriptor = getD1Descriptor();

    expect(
      validateMapping(
        descriptor,
        { Outlook: "Outlook", Temp: "Temp" },
        "Hilang",
        d3Variables()
      )
    ).toEqual([error("AM_E_ACTUAL_NOT_FOUND", "Hilang")]);
  });
});

describe("getEligibleVariablesForFeature / getEligibleActualTargetVariables", () => {
  const variables = [
    makeVariable("Nom", "nominal", "STRING"),
    makeVariable("Ord", "ordinal"),
    makeVariable("Sc", "scale"),
    makeVariable("Unk", "unknown"),
  ];

  it("categorical -> nominal & ordinal saja", () => {
    expect(
      getEligibleVariablesForFeature("categorical", variables).map(
        (v) => v.name
      )
    ).toEqual(["Nom", "Ord"]);
  });

  it("numerical -> scale saja", () => {
    expect(
      getEligibleVariablesForFeature("numerical", variables).map((v) => v.name)
    ).toEqual(["Sc"]);
  });

  it("actual target -> nominal/ordinal yang tidak dipakai prediktor", () => {
    expect(
      getEligibleActualTargetVariables({ A: "Nom", B: null }, variables).map(
        (v) => v.name
      )
    ).toEqual(["Ord"]);
  });
});
