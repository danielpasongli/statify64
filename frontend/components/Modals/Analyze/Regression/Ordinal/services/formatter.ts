import { AnalysisSection } from "../types/ordinal";
import { buildOrdinalFormatterContext } from "./formatter_context";
import { formatIterationHistory } from "./formatter_iteration_history";
import {
  formatCaseProcessingSummary,
  formatGoodnessOfFit,
  formatModelFittingInformation,
  formatPseudoRSquare,
} from "./formatter_model_summary";
import { formatParameterEstimates } from "./formatter_parameter";
import { formatParallelLines } from "./formatter_parallel_lines";
import { buildOrdinalPlumPayload } from "./formatter_payload";
import { formatSavedVariables } from "./formatter_saved_variables";
import { formatAsymptoticMatrix } from "./formatter_matrix";

export type { BuildOrdinalPlumPayloadInput } from "./formatter_payload";
export { buildOrdinalPlumPayload };

export const formatOrdinalResult = (result: any) => {
  const allSections: AnalysisSection[] = [];

  if (!result) return { sections: allSections };

  const context = buildOrdinalFormatterContext(result);
  const estimates = result.parameterEstimates || result.parameter_estimates;

  allSections.push(
    ...formatCaseProcessingSummary(context),
    ...formatModelFittingInformation(context),
    ...formatGoodnessOfFit(context),
    ...formatPseudoRSquare(context),
    ...formatSavedVariables(context),
  );

  if (
    context.wantParameterEstimates &&
    estimates &&
    Array.isArray(estimates) &&
    estimates.length > 0
  ) {
    const param = formatParameterEstimates(estimates, {
      linkFunctionNote: context.linkFunctionNote,
      confidenceInterval:
        context.estimationOptions.confidenceInterval ??
        context.estimationOptions.confidenceLevel ??
        result.estimationOptions?.confidenceInterval ??
        result.estimationOptions?.confidenceLevel,
    });
    if (param.sections) {
      allSections.push(...param.sections);
    }

    console.log("[ORDINAL][FORMATTER]", {
      parameterRows: estimates.length,
      hasRedundant: estimates.some((row: any) =>
        Boolean(row.isRedundant ?? row.is_redundant),
      ),
    });
  }

  const matrixEstimates = estimates && Array.isArray(estimates) ? estimates : [];
  if (context.wantAsymptoticCovariance && Array.isArray(result.covarianceMatrix || result.covariance_matrix)) {
    allSections.push(formatAsymptoticMatrix(matrixEstimates, result.covarianceMatrix || result.covariance_matrix, "covariance", context.linkFunctionNote));
  }
  if (context.wantAsymptoticCorrelation && Array.isArray(result.correlationMatrix || result.correlation_matrix)) {
    allSections.push(formatAsymptoticMatrix(matrixEstimates, result.correlationMatrix || result.correlation_matrix, "correlation", context.linkFunctionNote));
  }

  allSections.push(
    ...formatParallelLines(context),
    ...formatIterationHistory(context),
  );

  return { sections: allSections };
};
