
import { useState } from "react";
import type { Variable } from "@/types/Variable";
import type { DataRow } from "@/types/Data";
import { toast } from "sonner";
import { ChartService } from "@/services/chart/ChartService";
import { useResultStore } from "@/stores/useResultStore";
import { getTimeSeriesWorker } from "@/utils/timeseriesWorkerPool";

export const useAnalyzeHook = (
    selectedVariables: Variable[],
    data: DataRow[],
    selectedPeriod: any,
    pOrder: number,
    qOrder: number,
    modelType: string, // "GARCH", "EGARCH", "TGARCH", "ARCH"
    onClose: () => void
) => {
    const { addLog, addAnalytic, addStatistic } = useResultStore();
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const handleAnalyzes = async () => {
        if (selectedVariables.length === 0) {
            setErrorMsg("Please select at least one variable");
            return;
        }

        setIsCalculating(true);
        setErrorMsg(null);

        try {
            // Extract data for selected variable
            const variable = selectedVariables[0];
            const returns: number[] = [];

            for (const row of data) {
                const value = row[variable.columnIndex];
                if (value !== null && value !== undefined && !isNaN(Number(value))) {
                    returns.push(Number(value));
                }
            }

            if (returns.length < 10) {
                throw new Error("Insufficient data points (minimum 10 required)");
            }

            console.log(`Running ${modelType}(${pOrder},${qOrder}) with ${returns.length} observations`);
            console.time(`Statify ${modelType} Execution Time`);

            const client = getTimeSeriesWorker();

            client.onMessage(async (e) => {
                const { status, result, error } = e.data;
                
                if (status === "success") {
                    console.timeEnd(`Statify ${modelType} Execution Time`);
                    console.log(`${modelType} Results:`, result);
                    
                    toast.success(`${modelType} estimation completed!`);
                    
                    try {
                        // 1. Prepare Tables
                        const tables = [];
                        
                        // Parameter Tables
                        if (result.coefficients) {
                            // --- MEAN EQUATION TABLE ---
                            const meanRows = [];
                            meanRows.push({
                                rowHeader: ["C"],
                                coefficient: result.coefficients.mu,
                                stdError: result.coefficients.mu_se || "-",
                                tStat: result.coefficients.mu_z || "-",
                                pValue: result.coefficients.mu_p || "-"
                            });
                            
                            tables.push({
                                title: "Mean Equation",
                                columnHeaders: [
                                    { header: "Variable", key: "rowHeader" },
                                    { header: "Coefficient", key: "coefficient" },
                                    { header: "Std. Error", key: "stdError" },
                                    { header: "z-Statistic", key: "tStat" },
                                    { header: "Prob.", key: "pValue" }
                                ],
                                rows: meanRows,
                            });

                            // --- VARIANCE EQUATION TABLE ---
                            const varRows = [];
                            
                            // Omega (Variance Equation Constant)
                            if (result.coefficients.omega !== undefined) {
                                varRows.push({
                                    rowHeader: ["C"],
                                    coefficient: result.coefficients.omega,
                                    stdError: result.coefficients.omega_se || "-", 
                                    tStat: result.coefficients.omega_z || "-",
                                    pValue: result.coefficients.omega_p || "-" 
                                });
                            }

                            // Alpha terms (ARCH terms)
                            if (Array.isArray(result.coefficients.alpha)) {
                                result.coefficients.alpha.forEach((val: any, idx: number) => {
                                    const seVal = Array.isArray(result.coefficients.alpha_se) ? result.coefficients.alpha_se[idx] : "-";
                                    const zVal = Array.isArray(result.coefficients.alpha_z) ? result.coefficients.alpha_z[idx] : "-";
                                    const pVal = Array.isArray(result.coefficients.alpha_p) ? result.coefficients.alpha_p[idx] : "-";
                                    
                                    let label = `RESID(-${idx + 1})^2`;
                                    if (modelType === "EGARCH") {
                                        label = `|RESID(-${idx + 1})|/@SQRT(GARCH(-${idx + 1}))`;
                                    }
                                    
                                    varRows.push({
                                        rowHeader: [label],
                                        coefficient: val,
                                        stdError: seVal,
                                        tStat: zVal,
                                        pValue: pVal
                                    });
                                });
                            }

                            // Gamma terms (Asymmetry terms for EGARCH/TGARCH)
                            if (Array.isArray(result.coefficients.gamma)) {
                                result.coefficients.gamma.forEach((val: any, idx: number) => {
                                    const seVal = Array.isArray(result.coefficients.gamma_se) ? result.coefficients.gamma_se[idx] : "-";
                                    const zVal = Array.isArray(result.coefficients.gamma_z) ? result.coefficients.gamma_z[idx] : "-";
                                    const pVal = Array.isArray(result.coefficients.gamma_p) ? result.coefficients.gamma_p[idx] : "-";
                                    
                                    let label = `Gamma (${idx + 1})`;
                                    if (modelType === "EGARCH") {
                                        label = `RESID(-${idx + 1})/@SQRT(GARCH(-${idx + 1}))`;
                                    } else if (modelType === "TGARCH") {
                                        label = `RESID(-${idx + 1})^2 * (RESID(-${idx + 1})<0)`;
                                    }
                                    
                                    varRows.push({
                                        rowHeader: [label],
                                        coefficient: val,
                                        stdError: seVal,
                                        tStat: zVal,
                                        pValue: pVal
                                    });
                                });
                            }

                            // Beta terms (GARCH terms)
                            if (Array.isArray(result.coefficients.beta)) {
                                result.coefficients.beta.forEach((val: any, idx: number) => {
                                    const seVal = Array.isArray(result.coefficients.beta_se) ? result.coefficients.beta_se[idx] : "-";
                                    const zVal = Array.isArray(result.coefficients.beta_z) ? result.coefficients.beta_z[idx] : "-";
                                    const pVal = Array.isArray(result.coefficients.beta_p) ? result.coefficients.beta_p[idx] : "-";
                                    
                                    varRows.push({
                                        rowHeader: [`GARCH(-${idx + 1})`],
                                        coefficient: val,
                                        stdError: seVal,
                                        tStat: zVal,
                                        pValue: pVal
                                    });
                                });
                            }

                            tables.push({
                                title: "Variance Equation",
                                columnHeaders: [
                                    { header: "Variable", key: "rowHeader" },
                                    { header: "Coefficient", key: "coefficient" },
                                    { header: "Std. Error", key: "stdError" },
                                    { header: "z-Statistic", key: "tStat" },
                                    { header: "Prob.", key: "pValue" }
                                ],
                                rows: varRows,
                            });
                        }

                        // Diagnostics Table
                        if (result.diagnostics) {
                             tables.push({
                                title: "Diagnostics",
                                columnHeaders: [
                                    { header: "Statistic", key: "rowHeader" },
                                    { header: "Value", key: "value" }
                                ],
                                rows: [
                                    { rowHeader: ["R-squared"], value: result.diagnostics.rSquared },
                                    { rowHeader: ["Adjusted R-squared"], value: result.diagnostics.adjRSquared },
                                    { rowHeader: ["S.E. of regression"], value: result.diagnostics.seRegression },
                                    { rowHeader: ["Sum squared resid"], value: result.diagnostics.sumSquaredResid },
                                    { rowHeader: ["Log likelihood"], value: result.diagnostics.logLikelihood },
                                    { rowHeader: ["Durbin-Watson stat"], value: result.diagnostics.durbinWatson },
                                    { rowHeader: ["Mean dependent var"], value: result.diagnostics.meanDependentVar },
                                    { rowHeader: ["S.D. dependent var"], value: result.diagnostics.sdDependentVar },
                                    { rowHeader: ["Akaike info criterion"], value: result.diagnostics.aic },
                                    { rowHeader: ["Schwarz criterion"], value: result.diagnostics.bic },
                                    { rowHeader: ["Hannan-Quinn criter."], value: result.diagnostics.hq }
                                ]
                            });
                        }

                        // 2. Prepare Charts
                        const charts = [];
                        const varianceData: number[] = result.variance || [];
                        const residualsData: number[] = result.residuals || [];

                        if (varianceData.length > 0) {
                            const varianceChartData = varianceData.map((v, i) => ({
                                category: String(i + 1),
                                value: v
                            }));
                            const varianceChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: varianceChartData,
                                chartMetadata: {
                                    title: "Conditional Variance",
                                    subtitle: `${modelType} Process`
                                },
                                chartConfig: {
                                    axisLabels: { x: "Time", y: "Variance" }
                                }
                            });
                            charts.push(varianceChart);
                        }

                        if (residualsData.length > 0) {
                            const residualsChartData = residualsData.map((r, i) => ({
                                category: String(i + 1),
                                value: r
                            }));
                            const residualsChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: residualsChartData,
                                chartMetadata: {
                                    title: "Residuals",
                                    subtitle: `${modelType} Process`
                                },
                                chartConfig: {
                                    axisLabels: { x: "Time", y: "Residual" }
                                }
                            });
                            charts.push(residualsChart);
                        }

                        // 3. Dispatch Results directly to Output Output
                        const logMsg = `${modelType} Estimation on ${variable.name}`;
                        const logId = await addLog({ log: logMsg });
                        const analyticId = await addAnalytic(logId, { title: `${modelType} Results`, note: `p=${pOrder}, q=${qOrder}` });

                        await addStatistic(analyticId, {
                            title: `${modelType} Estimation Output`,
                            output_data: JSON.stringify({ tables, charts }),
                            components: "GarchAnalysis", // Reuse GarchAnalysis as the display structure is identical
                            description: `Estimation results for ${modelType} model`
                        });

                        // Close modal on success
                        onClose();

                    } catch (err) {
                        console.error("Error processing results:", err);
                        setErrorMsg("Error processing results for display.");
                    } finally {
                         client.release();
                         setIsCalculating(false);
                    }

                } else {
                    setErrorMsg(error || "Unknown worker error");
                    toast.error(`Estimation Failed: ${error}`);
                    client.release();
                    setIsCalculating(false);
                }
            });

            client.onError((err) => {
                console.error("Worker connection error:", err);
                setErrorMsg("Failed to connect to worker");
                setIsCalculating(false);
                client.release();
            });

            client.post({
                type: modelType, 
                payload: {
                    data: returns,
                    p: pOrder,
                    q: qOrder
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            setErrorMsg(errorMessage);
            toast.error(`Analysis Failed: ${errorMessage}`);
            console.error("Analysis error:", error);
            setIsCalculating(false);
        }
    };

    return {
        errorMsg,
        isCalculating,
        handleAnalyzes,
    };
};
