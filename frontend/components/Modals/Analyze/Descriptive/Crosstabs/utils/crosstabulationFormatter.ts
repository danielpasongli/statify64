import type { CrosstabsAnalysisParams, CrosstabsWorkerResult } from '../types';
import type { ColumnHeader, FormattedTable } from './helpers';
import type { Variable } from '@/types/Variable';

/**
 * Formats the main Crosstabulation table.
 */
export const formatCrosstabulationTable = (
  result: CrosstabsWorkerResult,
  params: CrosstabsAnalysisParams,
): FormattedTable | null => {
  if (!result?.summary || !result.contingencyTable) return null;

  const { rowCategories, colCategories, rowTotals, colTotals, totalCases } = result.summary;
  const counts = result.contingencyTable;

  // === Hide-small-counts options ===
  const { hideSmallCounts, hideSmallCountsThreshold } = params.options.cells;
  const suppressionThreshold = typeof hideSmallCountsThreshold === 'number' && hideSmallCountsThreshold > 0
    ? hideSmallCountsThreshold
    : 2; // fallback minimum ambang seperti di SPSS

  const rowVar = params.rowVariables[0];
  const colVar = params.columnVariables[0];

  // Helper untuk mendapatkan teks kategori (menggunakan value label jika ada)
  const getCategoryLabel = (variable: Variable, value: string | number): string => {
    const valObj = variable.values?.find(v => v.value === value);
    if (valObj?.label) return String(valObj.label);
    return String(value);
  };

  // For formatter output, always show specific variable names for clarity in statistical results
  const rowVarLabel = rowVar?.label || rowVar?.name || "Row Variable";
  const colVarLabel = colVar?.label || colVar?.name || "Column Variable";

  // Determine which cell statistics need to be displayed based on the user-selected options
  const selectedStats: Array<{
    type: 'observed' | 'expected' | 'rowPct' | 'colPct' | 'totPct' | 'unstdResid' | 'stdResid' | 'adjStdResid';
    label: string;
    compute: (obs: number, rowTot: number, colTot: number, grandTot: number) => string | number;
  }> = [];

  // Helper functions for percentage formatting
  const pct = (value: number): string => (isFinite(value) ? `${String(value * 100)}%` : '');

  // Helper untuk formatting desimal: satu posisi
  const dec = (value: number): string => {
    if (!isFinite(value)) return '';
    return String(value);
  };

  // Convert nullable numeric value to string | number for display
  const toDisplay = (val: number | string | null | undefined): string | number => {
    if (val === null || val === undefined) return '';
    return val;
  };

  // Observed counts
  if (params.options.cells.observed) {
    selectedStats.push({
      type: 'observed',
      label: 'Count',
      compute: (obs) => obs,
    });
  }
  // Expected counts
  if (params.options.cells.expected) {
    selectedStats.push({
      type: 'expected',
      label: 'Expected Count',
      compute: (_obs, rowTot, colTot, grandTot) => (rowTot * colTot) / grandTot,
    });
  }
  // Row percentages
  if (params.options.cells.row) {
    selectedStats.push({
      type: 'rowPct',
      // SPSS style: "% within <row variable label>"
      label: `% within ${rowVarLabel}`,
      compute: (obs, rowTot) => pct(obs / rowTot),
    });
  }
  // Column percentages
  if (params.options.cells.column) {
    selectedStats.push({
      type: 'colPct',
      // SPSS style: "% within <column variable label>"
      label: `% within ${colVarLabel}`,
      compute: (obs, _rowTot, colTot) => pct(obs / colTot),
    });
  }
  // Total percentages
  if (params.options.cells.total) {
    selectedStats.push({
      type: 'totPct',
      label: '% of Total',
      compute: (obs, _rowTot, _colTot, grandTot) => pct(obs / grandTot),
    });
  }

  // --- Residual statistics ---
  if (params.options.residuals?.unstandardized) {
    selectedStats.push({
      type: 'unstdResid',
      label: 'Residual',
      compute: () => 0, // placeholder, real calc handled inline
    });
  }

  if (params.options.residuals?.standardized) {
    selectedStats.push({
      type: 'stdResid',
      label: 'Standardized Residual',
      compute: () => 0,
    });
  }

  if (params.options.residuals?.adjustedStandardized) {
    selectedStats.push({
      type: 'adjStdResid',
      label: 'Adjusted Residual',
      compute: () => 0,
    });
  }

  // Fallback – if no statistic selected, default to observed counts so the table is not empty
  if (selectedStats.length === 0) {
    selectedStats.push({
      type: 'observed',
      label: 'Count',
      compute: (obs) => obs,
    });
  }

  // Ensure a predictable display order for statistics.
  // Project/UI expectation: when Row % is selected, it should be shown first
  // (affects both data section ordering and the first Total row labeling in tests).
  {
    const order: Record<string, number> = {
      rowPct: 0,
      observed: 1,
      expected: 2,
      colPct: 3,
      totPct: 4,
      unstdResid: 5,
      stdResid: 6,
      adjStdResid: 7,
    };
    selectedStats.sort((a, b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
  }

  // --- Build column headers ---
  let columnHeaders: ColumnHeader[] = [];
  const dynamicColumnHeaders: ColumnHeader[] = colCategories.map((catValue, idx) => ({
    header: getCategoryLabel(colVar, catValue),
    key: `c${idx + 1}`,
  }));

  // Row-header leaves
  if (selectedStats.length === 1) {
    // 2-level row header (statistic label merges across rows)
    columnHeaders = [
      { header: selectedStats[0].label, key: 'rh1' },
      { header: '', key: 'rh2' },
      { header: colVarLabel, children: dynamicColumnHeaders },
      { header: 'Total', key: 'total' },
    ];
  } else {
    // 3-level row header: Var → Category → Statistic
    columnHeaders = [
      { header: '', key: 'rh1' },
      { header: '', key: 'rh2' },
      { header: 'Statistic', key: 'rh3' },
      { header: colVarLabel, children: dynamicColumnHeaders },
      { header: 'Total', key: 'total' },
    ];
  }

  // --- Build data rows ---
  const dataRows: any[] = [];

  // Group rows by statistic first, then iterate row categories.
  selectedStats.forEach(stat => {
    rowCategories.forEach((catValue, rowIdx) => {
      const displayRowCat = getCategoryLabel(rowVar, catValue);
      const rowData: any = { rowHeader: selectedStats.length === 1 ? [null, displayRowCat] : [null, displayRowCat, stat.label] };
      colCategories.forEach((_, colIdx) => {
        const observed = counts[rowIdx][colIdx];
        const suppressed = hideSmallCounts && observed < suppressionThreshold;
        let value: string | number;
        if (suppressed) {
          if (stat.type === 'observed') {
            value = `<${suppressionThreshold}`;
          } else {
            value = `n<${suppressionThreshold}`;
          }
        } else {
          switch (stat.type) {
            case 'observed':
              value = observed;
              break;
            case 'expected':
              {
                const cs = result.cellStatistics?.[rowIdx]?.[colIdx];
                const exp = cs?.expected;
                const expectedVal =
                  exp !== null && exp !== undefined
                    ? (exp as number)
                    : (rowTotals[rowIdx] * colTotals[colIdx]) / totalCases;
                value = dec(expectedVal);
              }
              break;
            case 'rowPct':
              value = rowTotals[rowIdx] > 0 ? pct(observed / rowTotals[rowIdx]) : '0.0%';
              break;
            case 'colPct':
              value = colTotals[colIdx] > 0 ? pct(observed / colTotals[colIdx]) : '';
              break;
            case 'totPct':
              value = totalCases > 0 ? pct(observed / totalCases) : '';
              break;
            case 'unstdResid':
              {
                const cs = result.cellStatistics?.[rowIdx]?.[colIdx];
                const res = cs?.residual;
                const expectedVal = (rowTotals[rowIdx] * colTotals[colIdx]) / totalCases;
                const residVal =
                  res !== null && res !== undefined ? (res as number) : observed - expectedVal;
                value = dec(residVal);
              }
              break;
            case 'stdResid':
              {
                const cs = result.cellStatistics?.[rowIdx]?.[colIdx];
                const std = cs?.standardizedResidual;
                const stdVal =
                  std !== null && std !== undefined ? (std as number) : NaN;
                value = dec(stdVal);
              }
              break;
            case 'adjStdResid':
              {
                const cs = result.cellStatistics?.[rowIdx]?.[colIdx];
                const adj = cs?.adjustedResidual;
                const adjVal =
                  adj !== null && adj !== undefined ? (adj as number) : NaN;
                value = dec(adjVal);
              }
              break;
            default:
              value = '';
          }
        }
        rowData[`c${colIdx + 1}`] = value === null || value === undefined ? '' : String(value);
      });
      if (stat.type === 'observed') {
        rowData['total'] = String(rowTotals[rowIdx]);
      } else if (stat.type === 'rowPct') {
        rowData['total'] = '100.0%';
      } else if (stat.type === 'totPct') {
        rowData['total'] = totalCases > 0 ? pct(rowTotals[rowIdx] / totalCases) : '';
      } else if (stat.type === 'expected') {
        rowData['total'] = dec(rowTotals[rowIdx]);
      } else if (stat.type === 'colPct') {
        rowData['total'] = totalCases > 0 ? pct(rowTotals[rowIdx] / totalCases) : '';
      } else if (stat.type === 'unstdResid' || stat.type === 'stdResid' || stat.type === 'adjStdResid') {
        rowData['total'] = '';
      }
      dataRows.push(rowData);
    });
  });

  // Wrap dataRows under main row variable label
  const mainRow = {
    rowHeader: selectedStats.length === 1 ? [rowVarLabel, null] : [rowVarLabel, null, null],
    children: dataRows,
  };

  // --- Build grand-total rows ---
  const totalRows: any[] = [];
  const residualTypes = ['unstdResid', 'stdResid', 'adjStdResid']; // types that should not appear in Total rows
  selectedStats.forEach(stat => {
    // Skip residual related statistics for the grand-total rows as their values are always empty
    if (residualTypes.includes(stat.type)) return;
    const totalRow: any = { rowHeader: selectedStats.length === 1 ? ['Total', null] : ['Total', null, stat.label] };
    colCategories.forEach((_, colIdx) => {
      if (stat.type === 'observed') {
        totalRow[`c${colIdx + 1}`] = String(colTotals[colIdx]);
      } else if (stat.type === 'expected') {
        totalRow[`c${colIdx + 1}`] = String(colTotals[colIdx]); // expected = observed for marginal totals
      } else if (stat.type === 'rowPct') {
        totalRow[`c${colIdx + 1}`] = totalCases > 0 ? pct(colTotals[colIdx] / totalCases) : ''; // Show column percentage of total
      } else if (stat.type === 'colPct') {
        totalRow[`c${colIdx + 1}`] = '100.0%';
      } else if (stat.type === 'totPct') {
        totalRow[`c${colIdx + 1}`] = totalCases > 0 ? pct(colTotals[colIdx] / totalCases) : '';
      } else if (stat.type === 'unstdResid' || stat.type === 'stdResid' || stat.type === 'adjStdResid') {
         totalRow[`c${colIdx + 1}`] = '';
      }
    });

    if (stat.type === 'observed') {
      totalRow['total'] = String(totalCases);
    } else if (stat.type === 'expected') {
      totalRow['total'] = dec(totalCases);
    } else if (stat.type === 'rowPct') {
      totalRow['total'] = '100.0%';
    } else if (stat.type === 'colPct') {
      totalRow['total'] = '100.0%';
    } else if (stat.type === 'totPct') {
      totalRow['total'] = '100.0%';
    } else if (stat.type === 'unstdResid' || stat.type === 'stdResid' || stat.type === 'adjStdResid') {
       totalRow['total'] = '';
    }

    totalRows.push(totalRow);
  });

  const rows = [mainRow, ...totalRows];

  const title = `${rowVarLabel} * ${colVarLabel} Crosstabulation`;

  return { title, columnHeaders, rows };
};
