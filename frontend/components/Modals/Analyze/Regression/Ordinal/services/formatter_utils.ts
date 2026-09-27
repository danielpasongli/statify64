import { AnalysisSection } from "../types/ordinal";
import {
  PlumEstimationOptions,
  PlumLinkFunction,
  PlumModelType,
  PlumOutputOptions,
  PlumScaleType,
  OrdinalOutputParams,
  OrdinalOptionsParams,
  OrdinalPlumPayload,
} from "../types/ordinal";

export const createSection = (
  id: string,
  title: string,
  data: any,
  options?: {
    description?: string;
    note?: string;
  },
): AnalysisSection => {
  return {
    id,
    title,
    type: "table",
    data,
    description: options?.description,
    note: options?.note,
  };
};

// helper format angka
export const safeFixed = (
  val: number | undefined | null,
  digits = 3,
): string => {
  if (val === undefined || val === null || isNaN(val)) return ".";
  if (Math.abs(val) < 1e-9) return (0).toFixed(digits);
  const factor = 10 ** digits;
  const roundedMagnitude =
    Math.round((Math.abs(val) + Number.EPSILON) * factor) / factor;
  const rounded = val < 0 ? -roundedMagnitude : roundedMagnitude;
  return rounded.toFixed(digits);
};

export const fmtSig = (num: number | undefined | null): string => {
  if (num === undefined || num === null || isNaN(num)) return ".";
  return num < 0.001 ? "< .001" : num.toFixed(3);
};

const uniquePreserveOrder = (
  values: Array<string | number>,
): Array<string | number> => {
  const seen = new Set<string | number>();
  const ordered: Array<string | number> = [];
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
};

export const normalizeOrderedCategories = (
  values: Array<string | number>,
  explicitOrder?: Array<string | number>,
): Array<string | number> => {
  if (explicitOrder && explicitOrder.length > 0) {
    return uniquePreserveOrder(explicitOrder);
  }

  const uniqueValues = uniquePreserveOrder(values);
  const allNumeric = uniqueValues.every(
    (v) => typeof v === "number" && !isNaN(v),
  );
  if (allNumeric) {
    return [...uniqueValues].sort((a, b) => Number(a) - Number(b));
  }
  return uniqueValues;
};

export const normalizeLinkFunction = (link: string): PlumLinkFunction => {
  switch (link) {
    case "Probit":
      return "probit";
    case "Complementary Log-Log":
      return "complementary_log_log";
    case "Negative Log-Log":
      return "negative_log_log";
    case "Cauchit":
      return "cauchit";
    case "Logit":
    default:
      return "logit";
  }
};

export const inferScaleType = (scaleVariables: string[]): PlumScaleType => {
  return scaleVariables.length > 0 ? "non_constant" : "unity";
};

export const inferModelType = (scaleType: PlumScaleType): PlumModelType => {
  return scaleType === "non_constant" ? "general" : "location_only";
};

export const buildDefaultEstimationOptions = (
  params: OrdinalOptionsParams,
): PlumEstimationOptions => {
  return {
    method: "fisher_scoring",
    maxIterations: Number.isFinite(params.maxIterations)
      ? params.maxIterations
      : 100,
    maxStepHalving: params.maxStepHalving,
    logLikelihoodConvergence: params.logLikelihoodConvergence,
    parameterConvergence: params.parameterConvergence,
    confidenceInterval: params.confidenceInterval,
    delta: params.delta,
    singularityTolerance: params.singularityTolerance,
  };
};

export const buildDefaultOutputOptions = (
  params: OrdinalOutputParams,
): PlumOutputOptions => {
  const printIterationHistory = Boolean(
    params.display.printIterationHistory ?? params.display.iterationHistory,
  );
  const iterationHistoryEvery = Number(
    params.display.iterationHistoryEvery ??
      params.display.iterationHistoryStep ??
      1,
  );

  return {
    goodnessOfFit: params.display.goodnessOfFit,
    summaryStatistics: params.display.summaryStatistics,
    parameterEstimates: params.display.parameterEstimates,
    asymptoticCovariance: params.display.asymptoticCovariance,
    asymptoticCorrelation: params.display.asymptoticCorrelation,
    testOfParallelLines: params.display.testOfParallelLines,
    iterationHistory: printIterationHistory,
    iterationHistoryStep: iterationHistoryEvery,
    printIterationHistory,
    iterationHistoryEvery,
    cellInformation: params.display.cellInformation,
    predictedResponseCategory: params.savedVariables.predictedResponseCategory,
    estimatedResponseProbabilities:
      params.savedVariables.estimatedResponseProbabilities,
    predictedCategoryProbability:
      params.savedVariables.predictedCategoryProbability,
    actualCategoryProbability: params.savedVariables.actualCategoryProbability,
    printLogLikelihood: params.printLogLikelihood,
  };
};

export const validateOrdinalPayload = (
  payload: OrdinalPlumPayload,
): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!payload.response.variable) {
    errors.push("Response variable belum dipilih.");
  }

  if (payload.response.categoryCount < 3) {
    errors.push("Jumlah kategori response harus minimal 3.");
  }

  if (
    payload.response.orderedCategories.length !== payload.response.categoryCount
  ) {
    errors.push("Category count tidak konsisten dengan orderedCategories.");
  }

  if (payload.location.variables.length === 0) {
    errors.push("Minimal 1 variabel location diperlukan.");
  }

  if (payload.dependent && payload.factors && payload.covariates) {
    const dependentName = payload.dependent.name;
    if (payload.factors.some((v) => v.name === dependentName)) {
      errors.push("Dependent tidak boleh muncul di factors.");
    }
    if (payload.covariates.some((v) => v.name === dependentName)) {
      errors.push("Dependent tidak boleh muncul di covariates.");
    }
    const factorNames = new Set(payload.factors.map((v) => v.name));
    for (const cov of payload.covariates) {
      if (factorNames.has(cov.name)) {
        errors.push(
          "Variabel yang sama tidak boleh muncul di factors dan covariates.",
        );
        break;
      }
    }
  }

  if (!payload.model.linkFunction) {
    errors.push("Link function belum ditentukan.");
  }

  return { valid: errors.length === 0, errors };
};
