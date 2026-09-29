import type { CrosstabsAnalysisParams, CrosstabsWorkerResult } from '../../types';
import type { ColumnHeader, FormattedTable, TableRowData } from '../helpers';
import { buildChiSquareDescription } from './interpretation';

const formatExactNumber = (value: number | null | undefined): string =>
  Number.isFinite(value) ? String(value) : '';

const getVariableName = (
  variable: { label?: string; name?: string } | undefined,
  fallback: string,
): string => {
  if (variable?.label?.trim()) return variable.label;
  return variable?.name ?? fallback;
};

export const formatChiSquareTestsTable = (
  result: CrosstabsWorkerResult,
  params: CrosstabsAnalysisParams,
): FormattedTable | null => {
  if (!params.options.statistics?.chiSquare) return null;

  const pearson = result?.chiSquare?.pearson;
  if (!pearson) return null;
  const proportion = result?.chiSquare?.proportion;

  const columnHeaders: ColumnHeader[] = [
    { header: '', key: 'rh1' },
    { header: 'Value', key: 'value' },
    { header: 'df', key: 'df' },
    { header: 'Asymp. Sig. (2-sided)', key: 'sig' },
  ];

  const rows: TableRowData[] = [
    {
      rowHeader: ['Pearson Chi-Square'],
      value: formatExactNumber(pearson.value),
      df: String(pearson.df),
      sig: formatExactNumber(pearson.pValue),
    },
    {
      rowHeader: ['N of Valid Cases'],
      value: String(result.summary?.valid ?? ''),
      df: '',
      sig: '',
    },
  ];

  const diagnostics = pearson.expectedDiagnostics;
  const footer: string[] = [];
  if (diagnostics) {
    footer.push(
      `${diagnostics.cellsUnder5} cells (${formatExactNumber(diagnostics.percentCellsUnder5)}%) have expected count less than 5.`,
    );
    if (diagnostics.minExpectedCount !== null) {
      footer.push(`The minimum expected count is ${formatExactNumber(diagnostics.minExpectedCount)}.`);
    }
  }

  return {
    title: 'Chi-Square Tests',
    columnHeaders,
    rows,
    footer: footer.length > 0 ? footer : undefined,
    description: buildChiSquareDescription({
      rowName: getVariableName(params.rowVariables[0], 'variabel baris'),
      columnName: getVariableName(params.columnVariables[0], 'variabel kolom'),
      outcomeCategoryCount: proportion?.outcomeCategoryCount
        ?? result.summary?.colCategories?.length
        ?? 0,
      value: proportion?.value ?? pearson.value,
      df: proportion?.df ?? pearson.df,
      pValue: proportion?.pValue ?? pearson.pValue,
      sampleSize: result.summary?.valid,
      diagnostics,
    }),
  };
};
