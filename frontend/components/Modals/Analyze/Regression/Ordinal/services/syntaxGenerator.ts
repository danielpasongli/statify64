import type {
  LocationModelTerm,
  OrdinalOptionsParams,
  OrdinalOutputParams,
} from "../types/ordinal";
import type { Variable } from "@/types/Variable";

interface OrdinalSyntaxOptions {
  dependent: Variable;
  factors: Variable[];
  covariates: Variable[];
  locationModel: LocationModelTerm[];
  scaleModel: Variable[];
  options: OrdinalOptionsParams;
  output: OrdinalOutputParams;
}

const isInteraction = (
  term: LocationModelTerm,
): term is Extract<LocationModelTerm, { kind: "interaction" }> =>
  typeof term === "object" && "kind" in term && term.kind === "interaction";

const formatValue = (value: number) => String(value);

const formatLocationTerm = (term: LocationModelTerm) =>
  isInteraction(term)
    ? term.variables.map((variable) => variable.name).join("*")
    : term.name;

const mapLinkFunction = (
  linkFunction: OrdinalOptionsParams["linkFunction"],
) => {
  const linkMap: Record<OrdinalOptionsParams["linkFunction"], string> = {
    Logit: "Logit",
    Probit: "Probit",
    "Complementary Log-Log": "CLogLog",
    "Negative Log-Log": "NLogLog",
    Cauchit: "Cauchit",
  };

  return linkMap[linkFunction];
};

const getPrintOptions = (output: OrdinalOutputParams["display"]) => {
  const printOptions: string[] = [];

  if (output.goodnessOfFit) printOptions.push("FIT");
  if (output.parameterEstimates) printOptions.push("PARAMETER");
  if (output.summaryStatistics) printOptions.push("SUMMARY");
  if (output.testOfParallelLines) printOptions.push("TPARALLEL");
  if (output.asymptoticCovariance) printOptions.push("ASYMP_COV");
  if (output.asymptoticCorrelation) printOptions.push("ASYMP_COR");
  if (output.cellInformation) printOptions.push("CELLINFO");
  if (output.printIterationHistory ?? output.iterationHistory) {
    printOptions.push("ITERATION");
  }

  return printOptions;
};

export const generateOrdinalRegressionSyntax = ({
  dependent,
  factors,
  covariates,
  locationModel,
  scaleModel,
  options,
  output,
}: OrdinalSyntaxOptions): string => {
  const factorNames = factors
    .map((variable) => variable.name)
    .filter(Boolean)
    .join(" ");
  const covariateNames = covariates
    .map((variable) => variable.name)
    .filter(Boolean)
    .join(" ");
  const locationTerms = locationModel.map(formatLocationTerm).filter(Boolean);
  const scaleTerms = scaleModel
    .map((variable) => variable.name)
    .filter(Boolean);
  const printOptions = getPrintOptions(output.display);

  const lines = [
    `PLUM ${dependent.name}${factorNames ? ` BY ${factorNames}` : ""}${
      covariateNames ? ` WITH ${covariateNames}` : ""
    }`,
    `  /CRITERIA=CIN(${formatValue(options.confidenceInterval)}) DELTA(${formatValue(
      options.delta,
    )}) LCONVERGE(${formatValue(options.logLikelihoodConvergence)}) MXITER(${formatValue(
      options.maxIterations,
    )}) MXSTEP(${formatValue(options.maxStepHalving)}) PCONVERGE(${formatValue(
      options.parameterConvergence,
    )}) SINGULAR(${formatValue(options.singularityTolerance)})`,
    `  /LINK=${mapLinkFunction(options.linkFunction)}`,
    `  /LOCATION=${locationTerms.join(" ")}`,
    `  /SCALE=${scaleTerms.join(" ")}`,
    `  /PRINT=${printOptions.join(" ")}.`,
  ];

  return lines.join("\n");
};

export default generateOrdinalRegressionSyntax;
