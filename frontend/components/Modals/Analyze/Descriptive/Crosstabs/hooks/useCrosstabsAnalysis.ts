import { useState, useCallback, useRef, useEffect } from 'react';
import { useVariableStore } from '@/stores/useVariableStore';
import { useResultStore } from '@/stores/useResultStore';
import { useAnalysisData } from '@/hooks/useAnalysisData';
import type { CrosstabsAnalysisParams } from '../types';
import { formatCaseProcessingSummary, formatCrosstabulationTable, formatChiSquareTestsTable } from '../utils/formatters';
import type { WorkerClient } from '@/utils/workerClient';
import { createPooledWorkerClient } from '@/utils/workerClient';
import type { Variable } from '@/types/Variable';
import type { NonintegerWeightsType } from '../types';

// === Helper: Build SPSS-style command log =================================
const buildCrosstabsLog = (
  rowVar: Variable,
  colVar: Variable,
  opts: CrosstabsAnalysisParams['options'],
): string => {
  const lines: string[] = [];

  // 1) Base command & table specification
  lines.push('CROSSTABS');
  lines.push(`  /TABLES=${rowVar.name} BY ${colVar.name}`);

  // 2) FORMAT – saat ini default mengikuti SPSS (AVALUE TABLES)
  lines.push('  /FORMAT=AVALUE TABLES');

  // 3) CELLS – tentukan statistik yang dipilih
  const cellTokens: string[] = [];
  const { cells, residuals } = opts;

  if (cells.observed) cellTokens.push('COUNT');
  if (cells.expected) cellTokens.push('EXPECTED');
  if (cells.row) cellTokens.push('ROW');
  if (cells.column) cellTokens.push('COLUMN');
  if (cells.total) cellTokens.push('TOTAL');

  if (residuals.unstandardized) cellTokens.push('RESID');
  if (residuals.standardized) cellTokens.push('SRESID');
  if (residuals.adjustedStandardized) cellTokens.push('ASRESID');

  if (cellTokens.length > 0) {
    lines.push(`  /CELLS=${cellTokens.join(' ')}`);
  }

    if (opts.statistics?.chiSquare) {
        lines.push('  /STATISTICS=CHISQ');
    }

  // 4) COUNT – penyesuaian bobot non-integer
  const countMapping: Record<NonintegerWeightsType, string> = {
    roundCell: 'ROUND CELL',
    roundCase: 'ROUND CASE',
    truncateCell: 'TRUNCATE CELL',
    truncateCase: 'TRUNCATE CASE',
    noAdjustment: '',
  };
  const countToken = countMapping[opts.nonintegerWeights];
  if (countToken) {
    lines.push(`  /COUNT ${countToken}`);
  }

  // 5) Hidesmallcounts
  if (cells.hideSmallCounts) {
    const threshold = typeof cells.hideSmallCountsThreshold === 'number' && cells.hideSmallCountsThreshold > 0
      ? cells.hideSmallCountsThreshold
      : 2;
    lines.push(`  /HIDESMALLCOUNTS COUNT=${threshold}`);
  }

  // Tambahkan titik pada baris terakhir sesuai konvensi sintaks SPSS
  if (lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]  }.`;
  }

  return lines.join('\n');
};

export const useCrosstabsAnalysis = (params: CrosstabsAnalysisParams, onClose: () => void) => {
    const [isCalculating, setIsCalculating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Keep reference to the pooled worker client so we can terminate / reuse
    const workerClientRef = useRef<WorkerClient<any, any> | null>(null);

    const { data, weights } = useAnalysisData();
    const { variables } = useVariableStore();
    const { addLog, addAnalytic, addStatistic } = useResultStore();

    const runAnalysis = useCallback(async () => {
        const { rowVariables, columnVariables, options } = params;

        if (rowVariables.length === 0 || columnVariables.length === 0) {
            return;
        }

        setIsCalculating(true);
        setError(null);

        // Acquire a pooled worker for crosstabs analyses
        const workerClient = createPooledWorkerClient('crosstabs');
        workerClientRef.current = workerClient;

        let resultCount = 0;
        let totalJobs = 0;

        const variablePairs: { rowVar: Variable, colVar: Variable }[] = [];
        for (const rowVar of rowVariables) {
            for (const colVar of columnVariables) {
                variablePairs.push({ rowVar, colVar });
            }
        }
        totalJobs = variablePairs.length;

        const handleWorkerMessage = async (eventData: any) => {
            const { variableName, status, results, error: workerError } = eventData;

            resultCount++;
            const [rowVarName, colVarName] = (variableName ?? '').split(' * ');
            const pair = variablePairs.find(p => p.rowVar.name === rowVarName && p.colVar.name === colVarName);

            if (status === 'error') {
                console.error(`Worker error for ${variableName}:`, workerError);
                setError((prev) => prev ? `${prev}\n${variableName}: ${workerError}` : `${variableName}: ${workerError}`);
            } else if (pair) {
                try {
                    const { rowVar, colVar } = pair;
                    const crosstabParams = {
                        ...params,
                        rowVariables: [rowVar],
                        columnVariables: [colVar]
                    };
                    const logMsg = buildCrosstabsLog(rowVar, colVar, options);
                    const logId = await addLog({ log: logMsg });

                    const analyticId = await addAnalytic(logId, {
                        title: "Crosstabs",
                        note: `Crosstabulation for ${rowVar.label || rowVar.name} by ${colVar.label || colVar.name}`
                    });

                    const caseProcessingSummary = formatCaseProcessingSummary(results, crosstabParams);
                    const crosstabulationTable = formatCrosstabulationTable(results, crosstabParams);
                    const chiSquareTable = formatChiSquareTestsTable(results, crosstabParams);

                    // Pisahkan Case Processing dan Crosstabs menjadi dua statistik terpisah

                    // Statistik 1: Case Processing Summary
                    if (caseProcessingSummary !== null && analyticId) {
                        await addStatistic(analyticId, {
                            title: `Case Processing: ${rowVar.label || rowVar.name} by ${colVar.label || colVar.name}`,
                            output_data: JSON.stringify({
                                tables: [{
                                    title: caseProcessingSummary.title,
                                    columnHeaders: caseProcessingSummary.columnHeaders,
                                    rows: caseProcessingSummary.rows
                                }]
                            }),
                            components: "Case Processing",
                            description: "Case processing summary statistics"
                        });
                    }

                    // Statistik 2: Crosstab Results
                    if (crosstabulationTable !== null && analyticId) {
                        await addStatistic(analyticId, {
                            title: `Crosstabs: ${rowVar.label || rowVar.name} by ${colVar.label || colVar.name}`,
                            output_data: JSON.stringify({
                                tables: [{
                                    title: crosstabulationTable.title,
                                    columnHeaders: crosstabulationTable.columnHeaders,
                                    rows: crosstabulationTable.rows
                                }]
                            }),
                            components: "Crosstabs",
                            description: "Crosstabulation results"
                        });
                    }

                    if (chiSquareTable !== null && analyticId) {
                        await addStatistic(analyticId, {
                            title: `Chi-Square Tests: ${rowVar.label || rowVar.name} by ${colVar.label || colVar.name}`,
                            output_data: JSON.stringify({
                                tables: [{
                                    title: chiSquareTable.title,
                                    columnHeaders: chiSquareTable.columnHeaders,
                                    rows: chiSquareTable.rows,
                                    footer: chiSquareTable.footer,
                                }]
                            }),
                            components: "Chi-Square Tests",
                            description: chiSquareTable.description?.join('\n') || ''
                        });
                    }
                } catch (e) {
                    const err = e instanceof Error ? e.message : String(e);
                    console.error("Crosstabs Analysis UI Error:", err);
                    setError((prev) => prev ? `${prev}\nUI Error: ${err}` : `UI Error: ${err}`);
                }
            }

            if (resultCount === totalJobs) {
                setIsCalculating(false);
                if (!error) onClose();
                // Release the worker back to the pool
                workerClient.terminate();
                workerClientRef.current = null;
            }
        };

        const handleWorkerError = (err: ErrorEvent) => {
            console.error("Worker instantiation error:", err);
            setError(`Failed to load the analysis worker. ${err.message}`);
            setIsCalculating(false);
            workerClient.terminate();
            workerClientRef.current = null;
        };

        workerClient.onMessage(handleWorkerMessage);
        workerClient.onError(handleWorkerError);

        variablePairs.forEach(({ rowVar, colVar }) => {
            const rowVariable = variables.find((v: Variable) => v.name === rowVar.name);
            const colVariable = variables.find((v: Variable) => v.name === colVar.name);

            if (!rowVariable || !colVariable) {
                setError(`Variable definition not found for ${rowVar.name} or ${colVar.name}`);
                return;
            }

            const requiredVars = [
                { name: rowVar.name, index: rowVariable.columnIndex },
                { name: colVar.name, index: colVariable.columnIndex }
            ];

            const analysisData = data.map((d: any[]) => {
                const rowObject: { [key: string]: any } = {};
                requiredVars.forEach(v => {
                    rowObject[v.name] = d[v.index];
                });
                return rowObject;
            });

            workerClient.post({
                analysisType: 'crosstabs',
                variable: { row: rowVariable, col: colVariable },
                data: analysisData,
                weights,
                options,
            });
        });
    }, [params, data, weights, variables, addLog, addAnalytic, addStatistic, onClose, error]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (workerClientRef.current) {
                workerClientRef.current.terminate();
                workerClientRef.current = null;
            }
        };
    }, []);

    return { runAnalysis, isCalculating, error };
};
