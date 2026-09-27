import { useState } from "react";
import type { Variable } from "@/types/Variable";
import type { DataRow } from "@/types/Data";
import type { CellUpdate } from "@/stores/useDataStore";
import { toast } from "sonner";
import { ChartService } from "@/services/chart/ChartService";
import { useResultStore } from "@/stores/useResultStore";
import { useVariableStore } from "@/stores/useVariableStore";
import { getTimeSeriesWorker } from "@/utils/timeseriesWorkerPool";

export const useAnalyzeHook = (
    dependentVariable: Variable[],
    independentVariable: Variable[],
    data: DataRow[],
    selectedPeriod: any,
    maxLagADF: number,
    maxLagECM: number,
    saveLongRun: boolean,
    saveShortRun: boolean,
    onClose: () => void
) => {
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const { addLog, addAnalytic, addStatistic } = useResultStore();

    const handleAnalyzes = async () => {
        if (dependentVariable.length === 0 || independentVariable.length === 0) {
            setErrorMsg("Please select both dependent and independent variables");
            return;
        }

        setIsCalculating(true);
        setErrorMsg(null);

        try {

            // Extract Y and X data, ensuring no missing values in any row
            const yVar = dependentVariable[0];
            const yData: number[] = [];
            const xData: number[] = [];
            const n_vars = independentVariable.length;
            const validRowIndices: number[] = [];

            let rIdx = 0;
            for (const row of data) {
                const yValue = row[yVar.columnIndex];
                if (yValue === null || yValue === undefined || isNaN(Number(yValue))) {
                    rIdx++;
                    continue; // Skip rows with missing Y
                }

                let xRowValid = true;
                const xRowValues = [];
                for (const xVar of independentVariable) {
                    const xValue = row[xVar.columnIndex];
                    if (xValue === null || xValue === undefined || isNaN(Number(xValue))) {
                        xRowValid = false;
                        break;
                    }
                    xRowValues.push(Number(xValue));
                }

                if (xRowValid) {
                    yData.push(Number(yValue));
                    xData.push(...xRowValues);
                    validRowIndices.push(rIdx);
                }
                rIdx++;
            }

            if (yData.length < 10) {
                throw new Error("Insufficient data points (minimum 10 required)");
            }

            console.log(`Running ECM Analysis with ${yData.length} observations`);
            console.time("Statify ECM Execution Time");

            const client = getTimeSeriesWorker();

            client.post({
                type: "ECM",
                payload: {
                    y: yData,
                    x: xData,
                    n_vars: n_vars,
                    max_lag_adf: maxLagADF,
                    max_lag_ecm: maxLagECM
                }
            });

            client.onMessage(async (e) => {
                const { status, result, error } = e.data;
                
                if (status === "success") {
                    console.timeEnd("Statify ECM Execution Time");
                    console.log("ECM Results:", result);
                    
                    const isCointegrated = result.cointegration.isCointegrated;
                    toast.success("ECM estimation completed!");
                    
                    try {
                        const tables = [];
                        
                        // 1. Long Run Table
                        const longRunRows = [];
                        longRunRows.push({
                            var: "C (Intercept)",
                            coef: result.longRun.coefficients[0],
                            se: result.longRun.stdErrors[0],
                            tstat: result.longRun.tStats[0],
                            prob: result.longRun.pValues[0]
                        });
                        for (let i = 0; i < independentVariable.length; i++) {
                            longRunRows.push({
                                var: independentVariable[i].name,
                                coef: result.longRun.coefficients[i + 1],
                                se: result.longRun.stdErrors[i + 1],
                                tstat: result.longRun.tStats[i + 1],
                                prob: result.longRun.pValues[i + 1]
                            });
                        }

                        tables.push({
                            title: `Long Run Regression: ${yVar.name} ~ C + ${independentVariable.map(v => v.name).join(" + ")}`,
                            columnHeaders: [
                                { header: "Variable", key: "var" },
                                { header: "Coefficient", key: "coef" },
                                { header: "Std. Error", key: "se" },
                                { header: "t-Statistic", key: "tstat" },
                                { header: "Prob.", key: "prob" }
                            ],
                            rows: longRunRows,
                            footer: `R-squared: ${result.longRun.rSquared} | Adjusted R-squared: ${result.longRun.adjRSquared} | F-statistic: ${result.longRun.fStat}`
                        });

                        if (result.longRun?.diagnostics) {
                            const d = result.longRun.diagnostics;
                            tables.push({
                                title: "Long Run Fit & Diagnostics",
                                columnHeaders: [
                                    { header: "Statistic", key: "col1" },
                                    { header: "Value", key: "val1" },
                                    { header: "Statistic", key: "col2" },
                                    { header: "Value", key: "val2" }
                                ],
                                rows: [
                                    { col1: "R-squared", val1: d.rSquared, col2: "Mean dependent var", val2: d.meanDependentVar },
                                    { col1: "Adjusted R-squared", val1: d.adjRSquared, col2: "S.D. dependent var", val2: d.sdDependentVar },
                                    { col1: "S.E. of regression", val1: d.seRegression, col2: "Akaike info criterion", val2: d.aic },
                                    { col1: "Sum squared resid", val1: d.sumSquaredResid, col2: "Schwarz criterion", val2: d.bic },
                                    { col1: "Log likelihood", val1: d.logLikelihood, col2: "Hannan-Quinn criter.", val2: d.hq },
                                    { col1: "F-statistic", val1: d.fStatistic, col2: "Durbin-Watson stat", val2: d.durbinWatson },
                                    { col1: "Prob(F-statistic)", val1: d.probFStatistic, col2: "", val2: "" }
                                ]
                            });
                        }

                        // 2. Cointegration Test Table
                        tables.push({
                            title: "Cointegration Test (ADF on Residuals)",
                            columnHeaders: [
                                { header: "Statistic", key: "col" },
                                { header: "Value", key: "val" }
                            ],
                            rows: [
                                { col: "ADF Statistic", val: result.cointegration.adfStat },
                                { col: "p-value", val: result.cointegration.pValue },
                                { col: "Result", val: isCointegrated ? "Cointegrated" : "Not Cointegrated" }
                            ]
                        });
                        
                        // 3. Short Run ECM Table
                        const ecmRows = [];
                        ecmRows.push({
                            var: "C (Intercept)",
                            coef: result.ecm.coefficients[0],
                            se: result.ecm.stdErrors[0],
                            tstat: result.ecm.tStats[0],
                            prob: result.ecm.pValues[0]
                        });
                        ecmRows.push({
                            var: "ECT(-1)",
                            coef: result.ecm.coefficients[1],
                            se: result.ecm.stdErrors[1],
                            tstat: result.ecm.tStats[1],
                            prob: result.ecm.pValues[1]
                        });
                        for (let i = 0; i < independentVariable.length; i++) {
                            ecmRows.push({
                                var: `D(${independentVariable[i].name})`,
                                coef: result.ecm.coefficients[i + 2],
                                se: result.ecm.stdErrors[i + 2],
                                tstat: result.ecm.tStats[i + 2],
                                prob: result.ecm.pValues[i + 2]
                            });
                        }

                        tables.push({
                            title: `Short Run (ECM): D(${yVar.name}) ~ C + ECT(-1) + ${independentVariable.map(v => "D(" + v.name + ")").join(" + ")}`,
                            columnHeaders: [
                                { header: "Variable", key: "var" },
                                { header: "Coefficient", key: "coef" },
                                { header: "Std. Error", key: "se" },
                                { header: "t-Statistic", key: "tstat" },
                                { header: "Prob.", key: "prob" }
                            ],
                            rows: ecmRows,
                            footer: `R-squared: ${result.ecm.rSquared} | Adjusted R-squared: ${result.ecm.adjRSquared} | F-statistic: ${result.ecm.fStat}`
                        });

                        if (result.ecm?.diagnostics) {
                            const d = result.ecm.diagnostics;
                            tables.push({
                                title: "Short Run ECM Fit & Diagnostics",
                                columnHeaders: [
                                    { header: "Statistic", key: "col1" },
                                    { header: "Value", key: "val1" },
                                    { header: "Statistic", key: "col2" },
                                    { header: "Value", key: "val2" }
                                ],
                                rows: [
                                    { col1: "R-squared", val1: d.rSquared, col2: "Mean dependent var", val2: d.meanDependentVar },
                                    { col1: "Adjusted R-squared", val1: d.adjRSquared, col2: "S.D. dependent var", val2: d.sdDependentVar },
                                    { col1: "S.E. of regression", val1: d.seRegression, col2: "Akaike info criterion", val2: d.aic },
                                    { col1: "Sum squared resid", val1: d.sumSquaredResid, col2: "Schwarz criterion", val2: d.bic },
                                    { col1: "Log likelihood", val1: d.logLikelihood, col2: "Hannan-Quinn criter.", val2: d.hq },
                                    { col1: "F-statistic", val1: d.fStatistic, col2: "Durbin-Watson stat", val2: d.durbinWatson },
                                    { col1: "Prob(F-statistic)", val1: d.probFStatistic, col2: "", val2: "" }
                                ]
                            });
                        }

                        // 4. Classical Assumptions Table
                        tables.push({
                            title: "Classical Assumptions (Residual Diagnostics)",
                            columnHeaders: [
                                { header: "Test", key: "test" },
                                { header: "Statistic", key: "stat" },
                                { header: "Prob.", key: "prob" },
                                { header: "Interpretation", key: "interp" }
                            ],
                            rows: [
                                { 
                                    test: "Normality (Jarque-Bera)", 
                                    stat: result.diagnostics.jarqueBera.stat, 
                                    prob: result.diagnostics.jarqueBera.prob,
                                    interp: parseFloat(result.diagnostics.jarqueBera.prob) > 0.05 ? "Normal" : "Not Normal"
                                },
                                { 
                                    test: "Autocorrelation (Breusch-Godfrey LM)", 
                                    stat: result.diagnostics.breuschGodfrey.stat, 
                                    prob: result.diagnostics.breuschGodfrey.prob,
                                    interp: parseFloat(result.diagnostics.breuschGodfrey.prob) > 0.05 ? "No Autocorrelation" : "Autocorrelation Present"
                                },
                                { 
                                    test: "Heteroskedasticity (Breusch-Pagan)", 
                                    stat: result.diagnostics.breuschPagan.stat, 
                                    prob: result.diagnostics.breuschPagan.prob,
                                    interp: parseFloat(result.diagnostics.breuschPagan.prob) > 0.05 ? "Homoskedastic" : "Heteroskedastic"
                                }
                            ]
                        });

                        // 5. Correlogram of ECM Residuals Table
                        if (result.correlogram && result.correlogram.length > 0) {
                            tables.push({
                                title: "Correlogram of ECM Residuals (ACF & PACF)",
                                columnHeaders: [
                                    { header: "Lag", key: "lag" },
                                    { header: "Autocorrelation (AC)", key: "ac" },
                                    { header: "Partial Correlation (PAC)", key: "pac" },
                                    { header: "Q-Stat", key: "qStat" },
                                    { header: "Prob.", key: "pValue" }
                                ],
                                rows: result.correlogram.map((item: any) => ({
                                    lag: item.lag,
                                    ac: item.ac,
                                    pac: item.pac,
                                    qStat: item.qStat,
                                    pValue: item.prob
                                })),
                                footer: "Ljung-Box Q-statistic tests for null hypothesis of zero autocorrelation up to lag k."
                            });
                        }

                        // 6. Interpretations Summary
                        const ectCoef = parseFloat(result.ecm.coefficients[1]);
                        const ectProb = parseFloat(result.ecm.pValues[1]);
                        
                        let ecmInterpretation = "";
                        if (ectCoef < 0 && ectProb < 0.05) {
                            ecmInterpretation = `ECM is valid. The Error Correction Term (ECT) is negative and significant (p = ${ectProb.toFixed(4)}), indicating adjustment towards long-run equilibrium at a speed of ${Math.abs(ectCoef * 100).toFixed(2)}% per period.`;
                        } else if (ectCoef >= 0) {
                            ecmInterpretation = `ECM might not be valid. ECT is positive (Coef = ${ectCoef.toFixed(4)}). A valid ECM requires a negative ECT to pull the system back to equilibrium.`;
                        } else {
                            ecmInterpretation = `ECM is not statistically significant because ECT is negative but has a p-value > 0.05 (p = ${ectProb.toFixed(4)}).`;
                        }

                        tables.push({
                            title: "Model Interpretation",
                            columnHeaders: [
                                { header: "Component", key: "col" },
                                { header: "Description", key: "val" }
                            ],
                            rows: [
                                { col: "Cointegration", val: isCointegrated ? "Variables are cointegrated (Long-run relationship exists)." : "Variables are NOT cointegrated." },
                                { col: "Short-Run ECM", val: ecmInterpretation }
                            ]
                        });

                        const charts = [];

                        if (result.longRun?.residuals?.length > 0) {
                            const resData = result.longRun.residuals.map((val: number, i: number) => ({
                                category: String(i + 1),
                                value: val
                            }));
                            const residualsChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: resData,
                                chartMetadata: { title: "Equilibrium Error (Residuals)", subtitle: "Long Run" },
                                chartConfig: { axisLabels: { x: "Time", y: "Residual" } }
                            });
                            charts.push(residualsChart);
                        }

                        if (result.ecm?.residuals?.length > 0) {
                            const ecmResData = result.ecm.residuals.map((val: number, i: number) => ({
                                category: String(i + 1),
                                value: val
                            }));
                            const ecmResidualsChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: ecmResData,
                                chartMetadata: { title: "ECM Residuals", subtitle: "Short Run" },
                                chartConfig: { axisLabels: { x: "Time", y: "Residual" } }
                            });
                            charts.push(ecmResidualsChart);
                        }

                        // ACF & PACF Correlogram Chart for ECM
                        if (result.correlogram && result.correlogram.length > 0) {
                            const acfPacfData: Array<{ category: string; subcategory: string; value: number }> = [];
                            result.correlogram.forEach((item: any) => {
                                acfPacfData.push({
                                    category: String(item.lag),
                                    subcategory: "ACF",
                                    value: parseFloat(item.ac)
                                });
                                acfPacfData.push({
                                    category: String(item.lag),
                                    subcategory: "PACF",
                                    value: parseFloat(item.pac)
                                });
                            });

                            const correlogramChart = ChartService.createChartJSON({
                                chartType: "Multiple Line Chart",
                                chartData: acfPacfData,
                                chartVariables: { x: ["lag"], y: ["ACF", "PACF"] },
                                chartMetadata: { 
                                    title: "ECM Residual Correlogram Plot (ACF & PACF)", 
                                    subtitle: "Autocorrelation & Partial Correlation by Lag" 
                                },
                                chartConfig: { 
                                    axisLabels: { x: "Lag", y: "Correlation" },
                                    chartColor: ["#2563eb", "#dc2626"]
                                }
                            });
                            charts.push(correlogramChart);
                        }

                        // Save residuals if requested
                        if (saveLongRun || saveShortRun) {
                            const currentVarCount = useVariableStore.getState().variables.length;
                            const existingVars = useVariableStore.getState().variables.map(v => v.name);
                            
                            const findNextNumber = (prefix: string) => {
                                const pattern = new RegExp(`^${prefix}_(\\d+)$`);
                                let maxNum = 0;
                                existingVars.forEach(name => {
                                    const match = name.match(pattern);
                                    if (match) {
                                        const num = parseInt(match[1], 10);
                                        if (num > maxNum) maxNum = num;
                                    }
                                });
                                return maxNum + 1;
                            };

                            const varsForStore: Partial<Variable>[] = [];
                            const aggregatedUpdates: CellUpdate[] = [];
                            let addedVarsCount = 0;

                            if (saveLongRun && result.longRun?.residuals) {
                                const resNumber = findNextNumber("RES_LR");
                                const varIndex = currentVarCount + addedVarsCount;
                                
                                varsForStore.push({
                                    name: `RES_LR_${resNumber}`,
                                    label: `Long-Run Residuals - ECM`,
                                    type: "NUMERIC" as const,
                                    width: 12,
                                    decimals: 5,
                                    measure: "scale" as const,
                                    columnIndex: varIndex,
                                    values: []
                                });
                                
                                const lrResids = result.longRun.residuals;
                                lrResids.forEach((val: number, i: number) => {
                                    const origRowIdx = validRowIndices[i];
                                    if (origRowIdx !== undefined) {
                                        aggregatedUpdates.push({
                                            row: origRowIdx,
                                            col: varIndex,
                                            value: Number(val.toFixed(5)),
                                        });
                                    }
                                });
                                addedVarsCount++;
                            }

                            if (saveShortRun && result.ecm?.residuals) {
                                const resNumber = findNextNumber("RES_SR");
                                const varIndex = currentVarCount + addedVarsCount;
                                
                                varsForStore.push({
                                    name: `RES_SR_${resNumber}`,
                                    label: `Short-Run ECM Residuals - ECM`,
                                    type: "NUMERIC" as const,
                                    width: 12,
                                    decimals: 5,
                                    measure: "scale" as const,
                                    columnIndex: varIndex,
                                    values: []
                                });
                                
                                const ecmResids = result.ecm.residuals;
                                ecmResids.forEach((val: number, i: number) => {
                                    const origRowIdx = validRowIndices[1 + i]; // short-run starts at index 1 in ECM
                                    if (origRowIdx !== undefined) {
                                        aggregatedUpdates.push({
                                            row: origRowIdx,
                                            col: varIndex,
                                            value: Number(val.toFixed(5)),
                                        });
                                    }
                                });
                                addedVarsCount++;
                            }

                            if (varsForStore.length > 0) {
                                await useVariableStore.getState().addVariables(varsForStore, aggregatedUpdates);
                                toast.success("Residuals saved to dataset successfully!");
                            }
                        }

                        // Dispatch
                        const logMsg = `ECM: ${yVar.name} vs ${independentVariable.map(v => v.name).join(", ")}`;
                        const logId = await addLog({ log: logMsg });
                        const analyticId = await addAnalytic(logId, { title: "ECM Analysis", note: "Error Correction Model" });

                        await addStatistic(analyticId, {
                            title: "ECM Output",
                            output_data: JSON.stringify({ tables, charts }),
                            components: "EcmAnalysis",
                            description: "Cointegration and Error Correction results"
                        });
                        
                        setTimeout(() => {
                            onClose();
                            client.release();
                        }, 1500);

                    } catch (err) {
                        console.error("Processing Error", err);
                        setErrorMsg("Failed to process results.");
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

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            setErrorMsg(errorMessage);
            toast.error(`ECM Estimation Failed: ${errorMessage}`);
            console.error("ECM estimation error:", error);
            setIsCalculating(false);
        }
    };

    return {
        errorMsg,
        isCalculating,
        handleAnalyzes,
    };
};
