export interface OrdinalFormatterContext {
  result: any;
  outputOptions: Record<string, any>;
  estimationOptions: Record<string, any>;
  savedVariableOptions: Record<string, any>;
  linkFunctionLabel: string;
  linkFunctionNote: string;
  wantGoodnessOfFit: boolean;
  wantSummaryStatistics: boolean;
  wantParameterEstimates: boolean;
  wantAsymptoticCovariance: boolean;
  wantAsymptoticCorrelation: boolean;
  wantTestOfParallelLines: boolean;
  wantIterationHistory: boolean;
  savedVariableColumns: any[];
  hasSavedVariableRequest: boolean;
  hasSavedVariableResult: boolean;
}

export const normalizeLinkFunctionLabel = (value: any): string => {
  const raw = String(value || "Logit").trim();
  const normalized = raw.toLowerCase().replace(/[_\s]+/g, "-");
  switch (normalized) {
    case "probit":
      return "Probit";
    case "cloglog":
    case "complementary-log-log":
      return "Complementary Log-Log";
    case "nloglog":
    case "negative-log-log":
      return "Negative Log-Log";
    case "cauchit":
      return "Cauchit";
    case "logit":
    default:
      return "Logit";
  }
};

export const buildOrdinalFormatterContext = (
  result: any,
): OrdinalFormatterContext => {
  const outputOptions = result.outputOptions || result.output_options || {};
  const estimationOptions =
    result.estimationOptions || result.estimation_options || {};
  const readOutputFlag = (
    camelKey: string,
    snakeKey: string,
    defaultValue = true,
  ) => outputOptions[camelKey] ?? outputOptions[snakeKey] ?? defaultValue;

  const linkFunctionLabel = normalizeLinkFunctionLabel(
    estimationOptions.linkFunction ??
      estimationOptions.link_function ??
      result.iterationHistoryMeta?.linkFunction ??
      result.iteration_history_meta?.link_function,
  );
  const linkFunctionNote = `Link function: ${linkFunctionLabel}.`;
  const savedVariableOptions =
    result.savedVariableOptions ||
    result.saved_variable_options ||
    result.savedVariables?.options ||
    result.saved_variables?.options ||
    {};
  const savedVariableColumns = Array.isArray(result.savedVariables?.columns)
    ? result.savedVariables.columns.filter((column: any) => column?.name)
    : [];
  const hasSavedVariableResult = savedVariableColumns.length > 0;
  const hasSavedVariableRequest =
    hasSavedVariableResult ||
    [
      savedVariableOptions.predictedResponseCategory,
      savedVariableOptions.estimatedResponseProbabilities,
      savedVariableOptions.predictedCategoryProbability,
      savedVariableOptions.actualCategoryProbability,
      outputOptions.predictedResponseCategory,
      outputOptions.estimatedResponseProbabilities,
      outputOptions.predictedCategoryProbability,
      outputOptions.actualCategoryProbability,
    ].some(Boolean);

  return {
    result,
    outputOptions,
    estimationOptions,
    savedVariableOptions,
    linkFunctionLabel,
    linkFunctionNote,
    wantGoodnessOfFit: Boolean(
      readOutputFlag("goodnessOfFit", "goodness_of_fit"),
    ),
    wantSummaryStatistics: Boolean(
      readOutputFlag("summaryStatistics", "summary_statistics"),
    ),
    wantParameterEstimates: Boolean(
      readOutputFlag("parameterEstimates", "parameter_estimates"),
    ),
    wantAsymptoticCovariance: Boolean(
      readOutputFlag("asymptoticCovariance", "asymptotic_covariance", false),
    ),
    wantAsymptoticCorrelation: Boolean(
      readOutputFlag("asymptoticCorrelation", "asymptotic_correlation", false),
    ),
    wantTestOfParallelLines: Boolean(
      readOutputFlag("testOfParallelLines", "test_of_parallel_lines"),
    ),
    wantIterationHistory: Boolean(
      readOutputFlag(
        "printIterationHistory",
        "print_iteration_history",
        false,
      ) || readOutputFlag("iterationHistory", "iteration_history", true),
    ),
    savedVariableColumns,
    hasSavedVariableRequest,
    hasSavedVariableResult,
  };
};
