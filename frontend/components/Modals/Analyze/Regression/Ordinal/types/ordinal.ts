import { Variable } from "@/types/Variable";

// Interface untuk opsi utama (pemilihan variabel)
export interface OrdinalOptions {
  dependent: Variable | null;
  factors: Variable[];
  covariates: Variable[];
}

// Interface untuk tab Location
export interface LocationInteraction {
  kind: "interaction";
  id: string;
  name: string;
  variables: Variable[];
}

export type LocationModelTerm = Variable | LocationInteraction;

export interface OrdinalLocationParams {
  locationModel: LocationModelTerm[];
}

// Interface untuk tab Scale
export interface OrdinalScaleParams {
  scaleModel: Variable[];
}

// Interface untuk tab Options (sesuaikan dengan gambar OptionsTab.jpeg)
export interface OrdinalOptionsParams {
  maxIterations: number;
  maxStepHalving: number;
  logLikelihoodConvergence: number;
  parameterConvergence: number;
  confidenceInterval: number;
  delta: number;
  singularityTolerance: number;
  linkFunction:
    | "Logit"
    | "Probit"
    | "Complementary Log-Log"
    | "Cauchit"
    | "Negative Log-Log";
}

// Interface untuk tab Output (sesuaikan dengan gambar OutputTab.jpeg)
export interface OrdinalOutputParams {
  display: {
    goodnessOfFit: boolean;
    summaryStatistics: boolean;
    parameterEstimates: boolean;
    asymptoticCovariance: boolean;
    asymptoticCorrelation: boolean;
    cellInformation: boolean;
    testOfParallelLines: boolean;
    iterationHistory: boolean;
    iterationHistoryStep: number;
    printIterationHistory: boolean;
    iterationHistoryEvery: number;
  };
  savedVariables: {
    predictedResponseCategory: boolean;
    estimatedResponseProbabilities: boolean;
    predictedCategoryProbability: boolean;
    actualCategoryProbability: boolean;
  };
  printLogLikelihood: "Including" | "Excluding";
}

export interface AnalysisSection {
  id: string;
  title: string;
  data: any;
  description?: string;
  type: "table" | "text";
  note?: string;
}

export type PlumLinkFunction =
  | "logit"
  | "probit"
  | "complementary_log_log"
  | "negative_log_log"
  | "cauchit";

export type PlumModelType = "location_only" | "general";

export type PlumScaleType = "unity" | "non_constant";

export type PlumEstimationMethod = "fisher_scoring" | "newton_raphson";

export interface PlumLocationSpec {
  variables: string[];
  parameterName: "beta";
  thresholdName: "theta";
}

export interface PlumVariableSpec {
  name: string;
  columnIndex: number;
  type?: string;
  label?: string;
  valueLabels?: Array<{ value: string | number; label: string }>;
}

export interface PlumFactorLevelMetadata {
  variableName: string;
  levelValue: string;
  levelLabel?: string;
  isReference: boolean;
  isRedundant: boolean;
  parameterName: string;
  activeColumnIndex: number | null;
}

export interface PlumScaleSpec {
  scaleType: PlumScaleType;
  variables: string[];
  parameterName: "tau";
}

export interface PlumEstimationOptions {
  method: PlumEstimationMethod;
  maxIterations: number;
  maxStepHalving?: number;
  logLikelihoodConvergence?: number;
  parameterConvergence?: number;
  confidenceInterval?: number;
  delta?: number;
  singularityTolerance?: number;
}

export interface PlumOutputOptions {
  modelChiSquare?: boolean;
  pseudoRSquares?: boolean;
  parameterEstimates?: boolean;
  covarianceMatrix?: boolean;
  asymptoticCovariance?: boolean;
  asymptoticCorrelation?: boolean;
  residuals?: boolean;
  goodnessOfFit?: boolean;
  summaryStatistics?: boolean;
  testOfParallelLines?: boolean;
  iterationHistory?: boolean;
  iterationHistoryStep?: number;
  printIterationHistory?: boolean;
  iterationHistoryEvery?: number;
  cellInformation?: boolean;
  predictedResponseCategory?: boolean;
  estimatedResponseProbabilities?: boolean;
  predictedCategoryProbability?: boolean;
  actualCategoryProbability?: boolean;
  printLogLikelihood?: "Including" | "Excluding";
}

export interface IterationHistoryRow {
  iteration: number;
  stepHalvings: number;
  minus2LogLikelihood: number;
  threshold: number[];
  location: number[];
  scale: number[];
}

export interface IterationHistoryMeta {
  linkFunction: string;
  iterationHistoryEvery: number;
  thresholdNames: string[];
  locationNames: string[];
  scaleNames: string[];
  lastAbsChangeMinus2LogLikelihood?: number | null;
  lastMaxAbsChangeParameters?: number | null;
  converged: boolean;
}

export interface OrdinalPlumPayload {
  procedure: "PLUM";
  version: "plum-v1";
  weights?: number[];
  dependent?: PlumVariableSpec | null;
  factors?: PlumVariableSpec[];
  covariates?: PlumVariableSpec[];
  factorLevelMetadata?: PlumFactorLevelMetadata[];
  response: {
    variable: string;
    orderedCategories: Array<string | number>;
    categoryCount: number;
  };
  model: {
    modelType: PlumModelType;
    linkFunction: PlumLinkFunction;
    parameterVector: Array<"theta" | "beta" | "tau">;
  };
  location: PlumLocationSpec;
  scale: PlumScaleSpec;
  estimation: PlumEstimationOptions;
  output: PlumOutputOptions;
  frequencyWeightVariable?: string | null;
}
