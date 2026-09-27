import { Variable } from "@/types/Variable";
import { LocationInteraction } from "../types/ordinal";

export interface FactorLevelMetadata {
  variableName: string;
  levelValue: string;
  levelLabel?: string;
  isReference: boolean;
  isRedundant: boolean;
  parameterName: string;
  activeColumnIndex: number | null;
}

export interface FactorLevelSummary {
  variableName: string;
  levels: string[];
  referenceLevel: string;
  levelLabels: Record<string, string>;
}

export interface BuildOrdinalPlumDesignMatrixInput {
  rows: Array<Record<string, any>>;
  factors: Variable[];
  allFactors?: Variable[];
  covariates: Variable[];
  interactions: LocationInteraction[];
  getRowValue: (row: any, columnIndex: number) => unknown;
  toNumberOrThrow: (value: unknown, label: string) => number;
}

export interface BuildOrdinalPlumDesignMatrixResult {
  locationDesignMatrix: number[][];
  locationTermNames: string[];
  interactionColumnCounts: Record<string, number>;
  factorLevelMetadata: FactorLevelMetadata[];
  factorLevelSummaries: FactorLevelSummary[];
  referenceCategories: Record<string, string>;
  warnings: string[];
  activeParameterCount: number;
}

const normalizeLevelKey = (value: unknown) => String(value);

const getVariableKey = (variable: Variable) => {
  if (typeof variable.columnIndex === "number") {
    return `col:${variable.columnIndex}`;
  }
  return `name:${variable.name}`;
};

const buildValueLabelOrder = (variable: Variable): Array<string | number> => {
  if (!Array.isArray(variable.values) || variable.values.length === 0) {
    return [];
  }
  return variable.values.map((entry) => entry.value);
};

const buildValueLabelMap = (variable: Variable): Record<string, string> => {
  if (!Array.isArray(variable.values) || variable.values.length === 0) {
    return {};
  }
  return variable.values.reduce<Record<string, string>>((acc, entry) => {
    acc[normalizeLevelKey(entry.value)] = entry.label;
    return acc;
  }, {});
};

export const extractOrdinalDependentCategories = (
  values: unknown[],
  variable?: Variable | null
): Array<string | number> => {
  const explicitOrder = variable ? buildValueLabelOrder(variable) : [];
  const hasExplicitOrder = explicitOrder.length > 0;
  const seen = new Set<string | number>();
  const ordered: Array<string | number> = [];

  if (explicitOrder.length > 0) {
    for (const value of explicitOrder) {
      if (value === null || value === undefined || value === "") continue;
      if (seen.has(value)) continue;
      seen.add(value);
      ordered.push(value);
    }
  }

  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const normalized = typeof value === "number" && Number.isFinite(value)
      ? value
      : String(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }

  if (hasExplicitOrder) {
    return ordered;
  }

  const allNumeric = ordered.every((v) => typeof v === "number" && Number.isFinite(v));
  if (allNumeric) {
    return [...ordered].sort((a, b) => Number(a) - Number(b));
  }

  return ordered.map((value) => String(value)).sort((a, b) => a.localeCompare(b));
};

export const extractFactorLevelsForPlum = (
  values: unknown[],
  variable: Variable
): FactorLevelSummary => {
  const explicitOrder = buildValueLabelOrder(variable);
  const hasExplicitOrder = explicitOrder.length > 0;
  const labelMap = buildValueLabelMap(variable);
  const seen = new Set<string>();
  const ordered: string[] = [];

  if (explicitOrder.length > 0) {
    for (const value of explicitOrder) {
      if (value === null || value === undefined || value === "") continue;
      const key = normalizeLevelKey(value);
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
  }

  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const key = normalizeLevelKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }

  const allNumeric = ordered.every((value) => Number.isFinite(Number(value)));
  const sorted = hasExplicitOrder
    ? ordered
    : (allNumeric
      ? [...ordered].sort((a, b) => Number(a) - Number(b))
      : [...ordered].sort((a, b) => a.localeCompare(b)));

  const referenceLevel = sorted.length > 0 ? sorted[sorted.length - 1] : "";

  return {
    variableName: variable.name,
    levels: sorted,
    referenceLevel,
    levelLabels: labelMap,
  };
};

export const encodeTreatmentContrastsForPlum = (
  value: unknown,
  levels: string[],
  referenceLevel: string
): number[] => {
  const key = normalizeLevelKey(value);
  const coding: number[] = [];

  for (const level of levels) {
    if (level === referenceLevel) continue;
    coding.push(key === level ? 1 : 0);
  }

  return coding;
};

interface EncodedTermColumn {
  name: string;
  value: number;
}

const buildFactorColumnName = (variableName: string, level: string) => `${variableName}=${level}`;

const encodeVariableForRow = (
  row: Record<string, any>,
  variable: Variable,
  factorSummaryByKey: Map<string, FactorLevelSummary>,
  getRowValue: (row: any, columnIndex: number) => unknown,
  toNumberOrThrow: (value: unknown, label: string) => number
): EncodedTermColumn[] => {
  const summary = factorSummaryByKey.get(getVariableKey(variable));
  const value = getRowValue(row, variable.columnIndex);

  if (!summary) {
    return [{
      name: variable.name,
      value: toNumberOrThrow(value, variable.name),
    }];
  }

  const coding = encodeTreatmentContrastsForPlum(value, summary.levels, summary.referenceLevel);
  const activeLevels = summary.levels.filter((level) => level !== summary.referenceLevel);

  return activeLevels.map((level, index) => ({
    name: buildFactorColumnName(summary.variableName, level),
    value: coding[index] ?? 0,
  }));
};

const buildVariableColumnTemplate = (
  variable: Variable,
  factorSummaryByKey: Map<string, FactorLevelSummary>
): EncodedTermColumn[] => {
  const summary = factorSummaryByKey.get(getVariableKey(variable));

  if (!summary) {
    return [{ name: variable.name, value: 1 }];
  }

  return summary.levels
    .filter((level) => level !== summary.referenceLevel)
    .map((level) => ({
      name: buildFactorColumnName(summary.variableName, level),
      value: 1,
    }));
};

const buildInteractionColumns = (encodedVariables: EncodedTermColumn[][]): EncodedTermColumn[] => {
  return encodedVariables.reduce<EncodedTermColumn[]>(
    (columns, variableColumns) => {
      const nextColumns: EncodedTermColumn[] = [];
      for (const left of columns) {
        for (const right of variableColumns) {
          nextColumns.push({
            name: left.name ? `${left.name}*${right.name}` : right.name,
            value: left.value * right.value,
          });
        }
      }
      return nextColumns;
    },
    [{ name: "", value: 1 }]
  );
};

export const buildPlumParameterMetadata = (
  factorSummaries: FactorLevelSummary[],
  currentColumnOffset: number
): { metadata: FactorLevelMetadata[]; nextOffset: number } => {
  const metadata: FactorLevelMetadata[] = [];
  let offset = currentColumnOffset;

  for (const summary of factorSummaries) {
    for (const level of summary.levels) {
      const isReference = level === summary.referenceLevel;
      const isRedundant = isReference;
      const parameterName = `[${summary.variableName} = ${level}]`;
      metadata.push({
        variableName: summary.variableName,
        levelValue: level,
        levelLabel: summary.levelLabels[level],
        isReference,
        isRedundant,
        parameterName,
        activeColumnIndex: isReference ? null : offset,
      });
      if (!isReference) {
        offset += 1;
      }
    }
  }

  return { metadata, nextOffset: offset };
};

export const buildOrdinalPlumDesignMatrix = (
  input: BuildOrdinalPlumDesignMatrixInput
): BuildOrdinalPlumDesignMatrixResult => {
  const { rows, factors, allFactors, covariates, interactions, getRowValue, toNumberOrThrow } = input;
  const warnings: string[] = [];
  const locationTermNames: string[] = [];
  const interactionColumnCounts: Record<string, number> = {};
  const referenceCategories: Record<string, string> = {};

  const effectiveFactors = allFactors ?? factors;
  const factorSummaries: FactorLevelSummary[] = effectiveFactors.map((factor) => {
    const values = rows.map((row) => getRowValue(row, factor.columnIndex));
    const summary = extractFactorLevelsForPlum(values, factor);
    if (summary.levels.length < 2) {
      throw new Error(`Factor '${factor.name}' contains less than 2 categories.`);
    }
    referenceCategories[factor.name] = summary.referenceLevel;
    return summary;
  });
  const factorSummaryByKey = new Map(
    effectiveFactors.map((factor, index) => [getVariableKey(factor), factorSummaries[index]])
  );

  const levelWarningThreshold = Math.max(20, Math.floor(Math.sqrt(Math.max(rows.length, 1))));
  factorSummaries.forEach((summary) => {
    if (summary.levels.length > levelWarningThreshold) {
      warnings.push(
        `Factor '${summary.variableName}' memiliki ${summary.levels.length} level. Model dapat tidak stabil.`
      );
    }
  });

  const mainEffectFactorSummaries = factors
    .map((factor) => factorSummaryByKey.get(getVariableKey(factor)))
    .filter((summary): summary is FactorLevelSummary => Boolean(summary));

  let columnIndexOffset = covariates.length;
  const factorMetadataResult = buildPlumParameterMetadata(mainEffectFactorSummaries, columnIndexOffset);
  const factorLevelMetadata = factorMetadataResult.metadata;
  columnIndexOffset = factorMetadataResult.nextOffset;

  for (const covariate of covariates) {
    locationTermNames.push(covariate.name);
  }

  for (const summary of mainEffectFactorSummaries) {
    for (const level of summary.levels) {
      if (level === summary.referenceLevel) continue;
      locationTermNames.push(buildFactorColumnName(summary.variableName, level));
    }
  }

  for (const interaction of interactions) {
    const encodedVariables = interaction.variables.map((variable) =>
      buildVariableColumnTemplate(variable, factorSummaryByKey)
    );
    const interactionColumns = buildInteractionColumns(encodedVariables);
    interactionColumnCounts[interaction.id] = interactionColumns.length;
    interactionColumns.forEach((column) => locationTermNames.push(column.name));
  }

  const locationDesignMatrix = rows.map((row) => {
    const rowValues: number[] = [];

    for (const covariate of covariates) {
      const value = getRowValue(row, covariate.columnIndex);
      rowValues.push(toNumberOrThrow(value, covariate.name));
    }

    for (const summary of mainEffectFactorSummaries) {
      const factor = factors.find((f) => f.name === summary.variableName);
      if (!factor) continue;
      const value = getRowValue(row, factor.columnIndex);
      const coding = encodeTreatmentContrastsForPlum(value, summary.levels, summary.referenceLevel);
      rowValues.push(...coding);
    }

    for (const interaction of interactions) {
      const encodedVariables = interaction.variables.map((variable) =>
        encodeVariableForRow(row, variable, factorSummaryByKey, getRowValue, toNumberOrThrow)
      );
      const interactionColumns = buildInteractionColumns(encodedVariables);
      rowValues.push(...interactionColumns.map((column) => column.value));
    }

    return rowValues;
  });

  const activeParameterCount = locationTermNames.length;

  console.log("[ORDINAL][DESIGN_MATRIX][CONSTRUCTED]", {
    totalRows: rows.length,
    activeParameters: activeParameterCount,
    covariates: covariates.map((c) => c.name),
    factors: mainEffectFactorSummaries.map((f) => ({
      name: f.variableName,
      levels: f.levels,
      reference: f.referenceLevel,
    })),
    columnNames: locationTermNames,
    sampleFirstRow: locationDesignMatrix[0] ?? [],
  });

  return {
    locationDesignMatrix,
    locationTermNames,
    interactionColumnCounts,
    factorLevelMetadata,
    factorLevelSummaries: factorSummaries,
    referenceCategories,
    warnings,
    activeParameterCount,
  };
};
