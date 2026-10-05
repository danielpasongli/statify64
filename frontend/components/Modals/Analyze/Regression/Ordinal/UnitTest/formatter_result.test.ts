import "@testing-library/jest-dom";
import { formatOrdinalResult } from "../services/formatter";

describe("White-Box: Formatter Output (formatOrdinalResult)", () => {
  it("Path 1: Result kosong atau undefined", () => {
    const formatted = formatOrdinalResult(null);
    expect(formatted.sections).toEqual([]);
  });

  it("Path 2: Result minimum tanpa parameter estimates & matriks kovarians", () => {
    const minResult = {
      modelFitting: {
        modelMinus2LogLikelihood: 45.2,
        chiSquare: 12.3,
        df: 2,
        sig: 0.002,
      },
      outputOptions: {
        parameterEstimates: false,
        asymptoticCovariance: false,
        asymptoticCorrelation: false,
      },
    };
    const formatted = formatOrdinalResult(minResult);
    expect(formatted.sections.length).toBe(0);
    const hasParamSection = formatted.sections.some((s) => s.title.includes("Parameter Estimates"));
    expect(hasParamSection).toBe(false);
  });

  it("Path 3: Result lengkap dengan parameter estimates", () => {
    const fullResult = {
      parameterEstimates: [
        {
          group: "Threshold",
          variable: "[y = 1]",
          estimate: -1.25,
          stdError: 0.35,
          wald: 12.8,
          df: 1,
          sig: 0.0003,
          lower: -1.93,
          upper: -0.56,
        },
      ],
      outputOptions: {
        parameterEstimates: true,
        asymptoticCovariance: false,
      },
      estimationOptions: {
        confidenceInterval: 95,
      },
    };
    const formatted = formatOrdinalResult(fullResult);
    const paramSection = formatted.sections.find((s) => s.title.includes("Parameter Estimates"));
    expect(paramSection).toBeDefined();
  });

  it("Path 4: Result dengan Asymptotic Covariance & Correlation Matrices", () => {
    const matrixResult = {
      parameterEstimates: [
        { group: "Location", variable: "x1", estimate: 0.5 },
      ],
      covarianceMatrix: [[0.04]],
      correlationMatrix: [[1.0]],
      outputOptions: {
        parameterEstimates: true,
        asymptoticCovariance: true,
        asymptoticCorrelation: true,
      },
    };
    const formatted = formatOrdinalResult(matrixResult);
    const covSection = formatted.sections.find((s) => s.title.includes("Covariance"));
    const corrSection = formatted.sections.find((s) => s.title.includes("Correlation"));
    expect(covSection).toBeDefined();
    expect(corrSection).toBeDefined();
  });
});
