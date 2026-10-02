import "@testing-library/jest-dom";
import { buildOrdinalPlumPayload } from "../services/formatter_payload";
import type { BuildOrdinalPlumPayloadInput } from "../services/formatter_payload";

import type { Variable } from "@/types/Variable";

const createMockVariable = (overrides: Partial<Variable> & { name: string; columnIndex: number }): Variable => ({
  tempId: `temp-${overrides.columnIndex}`,
  // name: overrides.name,
  // columnIndex: overrides.columnIndex,
  type: "NUMERIC",
  width: 8,
  decimals: 2,
  label: overrides.name.toUpperCase(),
  values: [],
  missing: null,
  columns: 8,
  align: "right",
  measure: "scale",
  role: "input",
  ...overrides,
});

describe("White-Box: Payload Worker (buildOrdinalPlumPayload)", () => {
  const baseInput: BuildOrdinalPlumPayloadInput = {
    options: {
      dependent: createMockVariable({ id: 0, name: "y", columnIndex: 0, measure: "ordinal" }),
      factors: [createMockVariable({ id: 1, name: "f1", columnIndex: 1, measure: "nominal" })],
      covariates: [createMockVariable({ id: 2, name: "x1", columnIndex: 2, measure: "scale" })],
    },
    locationParams: {
      locationModel: [],
    },
    scaleParams: {
      scaleModel: [],
    },
    optionParams: {
      linkFunction: "Logit",
      maxIterations: 50,
      maxStepHalving: 5,
      logLikelihoodConvergence: 1e-6,
      parameterConvergence: 1e-6,
      confidenceInterval: 95,
      delta: 0,
      singularityTolerance: 1e-8,
    },
    outputParams: {
      display: {
        goodnessOfFit: true,
        summaryStatistics: true,
        parameterEstimates: true,
        asymptoticCovariance: false,
        asymptoticCorrelation: false,
        // cellInformation: false,
        testOfParallelLines: true,
        iterationHistory: false,
        iterationHistoryStep: 1,
        printIterationHistory: false,
        iterationHistoryEvery: 1,
      },
      savedVariables: {
        predictedResponseCategory: true,
        estimatedResponseProbabilities: false,
        predictedCategoryProbability: false,
        actualCategoryProbability: false,
      },
      printLogLikelihood: "Including",
    },
    data: [
      [1, 1, 10.5],
      [2, 1, 12.0],
      [3, 2, 15.2],
    ],
  };

  it("Path 1: Default Location Model dari Factors & Covariates, Scale Unity", () => {
    const payload = buildOrdinalPlumPayload(baseInput);
    expect(payload.procedure).toBe("PLUM");
    // expect(payload.scale.scaleType).toBe("unity");
    expect(payload.model.parameterVector).toEqual(["theta", "beta"]);
    expect(payload.location.variables).toEqual(["f1", "x1"]);
  });

  it("Path 2: Custom Location Model yang eksplisit", () => {
    const input: BuildOrdinalPlumPayloadInput = {
      ...baseInput,
      locationParams: {
        locationModel: [
          createMockVariable({ id: 2, name: "x1", columnIndex: 2, measure: "scale" }),
        ],
      },
    };
    const payload = buildOrdinalPlumPayload(input);
    expect(payload.location.variables).toEqual(["x1"]);
    expect(payload.model.parameterVector).toEqual(["theta", "beta"]);
  });

  // it("Path 3: Scale Model Non-Constant (menambahkan tau ke parameterVector)", () => {
  //   const input: BuildOrdinalPlumPayloadInput = {
  //     ...baseInput,
  //     scaleParams: {
  //       scaleModel: [
  //         createMockVariable({ id: 2, name: "x1", columnIndex: 2, measure: "scale" }),
  //       ],
  //     },
  //   };
  //   const payload = buildOrdinalPlumPayload(input);
  //   expect(payload.scale.scaleType).toBe("non_constant");
  //   expect(payload.model.parameterVector).toEqual(["theta", "beta", "tau"]);
  // });

  it("Path 4: Response data kosong / Dependent tidak terpilih", () => {
    const input: BuildOrdinalPlumPayloadInput = {
      ...baseInput,
      options: {
        dependent: null,
        factors: [],
        covariates: [],
      },
      data: [],
    };
    const payload = buildOrdinalPlumPayload(input);
    expect(payload.dependent).toBeNull();
    expect(payload.response.variable).toBe("");
    expect(payload.response.categoryCount).toBe(0);
  });
});
