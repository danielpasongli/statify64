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
    independentVariables: Variable[],
    data: DataRow[],
    selectedPeriod: any,
    autoSelect: boolean,
    maxP: number,
    maxQ: number,
    selectionCriterion: "aic" | "bic" | "hq",
    pOrder: number,
    qOrders: number[],
    saveLongRun: boolean,
    saveShortRun: boolean,
    onClose: () => void
) => {
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);
    const { addLog, addAnalytic, addStatistic } = useResultStore();

    const handleAnalyzes = async () => {
        if (dependentVariable.length === 0 || independentVariables.length === 0) {
            setErrorMsg("Please select both dependent and independent variables");
            return;
        }

        setIsCalculating(true);
        setErrorMsg(null);

        try {

            // Extract Y and X data, ensuring no missing values in any row (Listwise Deletion)
            const yVar = dependentVariable[0];
            const yData: number[] = [];
            const xDataArrays: number[][] = independentVariables.map(() => []);
            const validRowIndices: number[] = [];

            let rIdx = 0;
            for (const row of data) {
                const yValue = row[yVar.columnIndex];
                if (yValue === null || yValue === undefined || isNaN(Number(yValue))) {
                    rIdx++;
                    continue;
                }

                let rowValid = true;
                const xVals = [];
                for (const xVar of independentVariables) {
                    const xValue = row[xVar.columnIndex];
                    if (xValue === null || xValue === undefined || isNaN(Number(xValue))) {
                        rowValid = false;
                        break;
                    }
                    xVals.push(Number(xValue));
                }

                if (rowValid) {
                    yData.push(Number(yValue));
                    xVals.forEach((val, idx) => {
                        xDataArrays[idx].push(val);
                    });
                    validRowIndices.push(rIdx);
                }
                rIdx++;
            }

            // Validate data
            const nObs = yData.length;
            if (nObs < 10) {
                throw new Error("Insufficient data points (minimum 10 required)");
            }

            // Flatten X data
            const xFlat: number[] = [];
            for (const xArray of xDataArrays) {
                xFlat.push(...xArray);
            }

            console.log(`Running ARDL Analysis (AutoSelect=${autoSelect}) with ${nObs} observations`);
            console.time("Statify ARDL Execution Time");
            
            // Ensure qOrders matches number of X variables
            const qOrdersArray = qOrders.length === independentVariables.length 
                ? qOrders 
                : Array(independentVariables.length).fill(qOrders[0] || 1);
            
            const client = getTimeSeriesWorker();

            client.onMessage(async (e) => {
                const { status, result, error } = e.data;
                
                if (status === "success") {
                    console.timeEnd("Statify ARDL Execution Time");
                    console.log("ARDL Results:", result);
                    
                    toast.success("ARDL estimation completed!");
                    
                    try {
                        const tables = [];
                        
                        // 0. Unrestricted ARDL Main Model (EViews Baseline Model)
                        if (result.unrestrictedModel) {
                            const u = result.unrestrictedModel;
                            const uRows = u.varNames.map((vName: string, idx: number) => ({
                                var: vName,
                                coef: u.coefficients[idx],
                                se: u.stdErrors[idx],
                                tstat: u.tStats[idx],
                                prob: u.pValues[idx]
                            }));

                            tables.push({
                                title: `Unrestricted ARDL Equation (Selected model: ${result.selectedModelName}${result.evaluatedModelsCount > 0 ? ` via ${result.selectionCriterion}` : ''})`,
                                columnHeaders: [
                                    { header: "Variable", key: "var" },
                                    { header: "Coefficient", key: "coef" },
                                    { header: "Std. Error", key: "se" },
                                    { header: "t-Statistic", key: "tstat" },
                                    { header: "Prob.", key: "prob" }
                                ],
                                rows: uRows,
                                footer: `R-squared: ${u.diagnostics?.rSquared ?? ''} | Adjusted R-squared: ${u.diagnostics?.adjRSquared ?? ''} | F-statistic: ${u.diagnostics?.fStatistic ?? ''} | Included observations: ${u.effObs ?? ''}`
                            });

                            if (u.diagnostics) {
                                const d = u.diagnostics;
                                tables.push({
                                    title: "Unrestricted ARDL Fit & Diagnostics",
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
                                        { col1: "Prob(F-statistic)", val1: d.probFStatistic, col2: "Evaluated Models", val2: result.evaluatedModelsCount || 1 }
                                    ]
                                });
                            }
                        }

                        // 1. Long Run Equation
                        const longRunRows = [];
                        longRunRows.push({
                            var: "C (Intercept)",
                            coef: result.longRun.coefficients[0],
                            se: result.longRun.stdErrors[0],
                            tstat: result.longRun.tStats[0],
                            prob: result.longRun.pValues[0]
                        });
                        for (let i = 0; i < independentVariables.length; i++) {
                            longRunRows.push({
                                var: independentVariables[i].name,
                                coef: result.longRun.coefficients[i + 1],
                                se: result.longRun.stdErrors[i + 1],
                                tstat: result.longRun.tStats[i + 1],
                                prob: result.longRun.pValues[i + 1]
                            });
                        }
                        tables.push({
                            title: `Long Run Equation: ${yVar.name} ~ C + ${independentVariables.map(v => v.name).join(" + ")}`,
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
                        const isCointegrated = result.cointegration.isCointegrated;
                        tables.push({
                            title: "Cointegration Test (ADF on Residuals)",
                            columnHeaders: [
                                { header: "Statistic", key: "col" },
                                { header: "Value", key: "val" }
                            ],
                            rows: [
                                { col: "ADF Statistic", val: result.cointegration.statistic },
                                { col: "p-value", val: result.cointegration.pValue },
                                { col: "Result", val: isCointegrated ? "Cointegrated" : "Not Cointegrated" }
                            ]
                        });
                        
                        // 3. Short Run ARDL Table
                        const srRows = [];
                        let srVarIdx = 0;
                        srRows.push({
                            var: "C (Intercept)",
                            coef: result.shortRun.coefficients[srVarIdx],
                            se: result.shortRun.stdErrors[srVarIdx],
                            tstat: result.shortRun.tStats[srVarIdx],
                            prob: result.shortRun.pValues[srVarIdx]
                        });
                        srVarIdx++;
                        
                        srRows.push({
                            var: "ECT(-1)",
                            coef: result.shortRun.coefficients[srVarIdx],
                            se: result.shortRun.stdErrors[srVarIdx],
                            tstat: result.shortRun.tStats[srVarIdx],
                            prob: result.shortRun.pValues[srVarIdx]
                        });
                        srVarIdx++;

                        const actualP = result.selectedP !== undefined ? result.selectedP : pOrder;
                        const actualQ = result.selectedQ !== undefined 
                            ? (Array.isArray(result.selectedQ) ? result.selectedQ : [result.selectedQ])
                            : qOrdersArray;

                        // Lags of D(Y)
                        for (let i = 1; i <= actualP; i++) {
                            srRows.push({
                                var: `D(${yVar.name}(-${i}))`,
                                coef: result.shortRun.coefficients[srVarIdx],
                                se: result.shortRun.stdErrors[srVarIdx],
                                tstat: result.shortRun.tStats[srVarIdx],
                                prob: result.shortRun.pValues[srVarIdx]
                            });
                            srVarIdx++;
                        }

                        // Lags of D(X)
                        for (let k = 0; k < independentVariables.length; k++) {
                            const qVal = actualQ[k] !== undefined ? actualQ[k] : 1;
                            for (let j = 0; j <= qVal; j++) {
                                const lagSuffix = j === 0 ? "" : `(-${j})`;
                                srRows.push({
                                    var: `D(${independentVariables[k].name}${lagSuffix})`,
                                    coef: result.shortRun.coefficients[srVarIdx],
                                    se: result.shortRun.stdErrors[srVarIdx],
                                    tstat: result.shortRun.tStats[srVarIdx],
                                    prob: result.shortRun.pValues[srVarIdx]
                                });
                                srVarIdx++;
                            }
                        }

                        let srFormulaStr = `D(${yVar.name}) ~ C + ECT(-1)`;
                        if (actualP > 0) srFormulaStr += ` + D(${yVar.name}) lags`;
                        srFormulaStr += ` + D(Xs) lags`;

                        tables.push({
                            title: `Short Run ARDL-ECM: ${srFormulaStr}`,
                            columnHeaders: [
                                { header: "Variable", key: "var" },
                                { header: "Coefficient", key: "coef" },
                                { header: "Std. Error", key: "se" },
                                { header: "t-Statistic", key: "tstat" },
                                { header: "Prob.", key: "prob" }
                            ],
                            rows: srRows,
                            footer: `R-squared: ${result.shortRun.rSquared} | Adjusted R-squared: ${result.shortRun.adjRSquared} | F-statistic: ${result.shortRun.fStat}`
                        });

                        if (result.shortRun?.diagnostics) {
                            const d = result.shortRun.diagnostics;
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

                        // 4. Classical Assumptions
                        const diag = result.diagnostics;
                        tables.push({
                            title: "Classical Assumptions Tests (Short-Run Residuals)",
                            columnHeaders: [
                                { header: "Test", key: "test" },
                                { header: "Statistic", key: "stat" },
                                { header: "Prob.", key: "prob" },
                                { header: "Conclusion", key: "conc" }
                            ],
                            rows: [
                                { 
                                    test: "Normality (Jarque-Bera)", 
                                    stat: diag.jarqueBera.stat, 
                                    prob: diag.jarqueBera.prob,
                                    conc: parseFloat(diag.jarqueBera.prob) > 0.05 ? "Normal distribution" : "Not normal"
                                },
                                { 
                                    test: "Autocorrelation (Breusch-Godfrey LM)", 
                                    stat: diag.breuschGodfrey.stat, 
                                    prob: diag.breuschGodfrey.prob,
                                    conc: parseFloat(diag.breuschGodfrey.prob) > 0.05 ? "No Autocorrelation" : "Autocorrelation detected"
                                },
                                { 
                                    test: "Heteroskedasticity (Breusch-Pagan)", 
                                    stat: diag.breuschPagan.stat, 
                                    prob: diag.breuschPagan.prob,
                                    conc: parseFloat(diag.breuschPagan.prob) > 0.05 ? "Homoskedastic" : "Heteroskedastic"
                                }
                            ]
                        });

                        // 4.5. Correlogram of Residuals Table (EViews Residual Diagnostics)
                        if (result.correlogram && result.correlogram.length > 0) {
                            tables.push({
                                title: "Correlogram of Residuals (Autocorrelation & Partial Correlation)",
                                columnHeaders: [
                                    { header: "Lag", key: "lag" },
                                    { header: "Autocorrelation (AC)", key: "ac" },
                                    { header: "Partial Correlation (PAC)", key: "pac" },
                                    { header: "Q-Stat", key: "qStat" },
                                    { header: "Prob.", key: "prob" }
                                ],
                                rows: result.correlogram,
                                footer: "Q-Stat is Ljung-Box Q statistic for residual white noise test. Prob is Chi-Square p-value."
                            });
                        }

                        // 5. Interpretation
                        const ectP = parseFloat(result.shortRun.pValues[1]);
                        const ectC = parseFloat(result.shortRun.coefficients[1]);
                        let ecmInterp = "The ECT(-1) coefficient is ";
                        if (ectC < 0 && ectP < 0.05) {
                            ecmInterp += "negative and statistically significant, indicating that there is a valid long-run equilibrium relationship and error correction occurs.";
                        } else {
                            ecmInterp += "NOT negative and significant, suggesting that short-run deviations do not reliably correct towards the long-run equilibrium.";
                        }
                        
                        tables.push({
                            title: "Automated Interpretation",
                            columnHeaders: [{ header: "Insight", key: "insight" }],
                            rows: [
                                { insight: `The Cointegration Test (ADF) shows that the variables are ${isCointegrated ? 'cointegrated, implying a valid long-run relationship.' : 'NOT cointegrated (p > 0.05). Proceed with caution.'}` },
                                { insight: ecmInterp },
                                { insight: "Examine the Short Run ARDL-ECM table and Correlogram to interpret short-term dynamic effects and residual white noise." }
                            ]
                        });

                        const charts = [];
                        
                        // Actual vs Fitted & Residuals Chart (EViews Graphics)
                        if (result.unrestrictedModel?.fitted && result.unrestrictedModel?.actual) {
                            const actData = result.unrestrictedModel.actual;
                            const fitData = result.unrestrictedModel.fitted;
                            const resData = result.unrestrictedModel.residuals;

                            // Chart 1: Actual vs Fitted (Multiple Line Chart - long format)
                            const actFitData: Array<{ category: string; subcategory: string; value: number }> = [];
                            actData.forEach((a: number, i: number) => {
                                actFitData.push({
                                    category: String(i + 1),
                                    subcategory: "Actual",
                                    value: Number(a.toFixed(4))
                                });
                                actFitData.push({
                                    category: String(i + 1),
                                    subcategory: "Fitted",
                                    value: Number(fitData[i].toFixed(4))
                                });
                            });

                            const actualFittedChart = ChartService.createChartJSON({
                                chartType: "Multiple Line Chart",
                                chartData: actFitData,
                                chartVariables: { x: ["index"], y: ["Actual", "Fitted"] },
                                chartMetadata: { 
                                    title: `Actual vs Fitted Plot (${result.selectedModelName})`, 
                                    subtitle: `Dependent Variable: ${yVar.name}` 
                                },
                                chartConfig: { 
                                    axisLabels: { x: "Observation", y: yVar.name },
                                    chartColor: ["#d97706", "#16a34a"]
                                }
                            });
                            charts.push(actualFittedChart);

                            // Chart 2: Residuals Plot (Line Chart - category/value format)
                            const resLineData = resData.map((r: number, i: number) => ({
                                category: String(i + 1),
                                value: Number(r.toFixed(4))
                            }));

                            const residualsChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: resLineData,
                                chartVariables: { x: ["index"], y: ["Residual"] },
                                chartMetadata: { 
                                    title: `Residuals Plot (${result.selectedModelName})`, 
                                    subtitle: "Unrestricted ARDL Residuals" 
                                },
                                chartConfig: { 
                                    axisLabels: { x: "Observation", y: "Residual" },
                                    chartColor: ["#2563eb"]
                                }
                            });
                            charts.push(residualsChart);
                        } else if (result.residuals) {
                            const resLineData = result.residuals.map((val: number, i: number) => ({
                                category: String(i + 1),
                                value: Number(val.toFixed(4))
                            }));

                            const residualsChart = ChartService.createChartJSON({
                                chartType: "Line Chart",
                                chartData: resLineData,
                                chartVariables: { x: ["index"], y: ["residual"] },
                                chartMetadata: { title: "Residuals Plot", subtitle: "ARDL Model" },
                                chartConfig: { axisLabels: { x: "Time", y: "Residual" } }
                            });
                            charts.push(residualsChart);
                        }

                        // Chart 3: ACF & PACF Correlogram Chart (Multiple Line Chart - long format)
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
                                    title: "Residual Correlogram Plot (ACF & PACF)", 
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
                                    label: `Long-Run Residuals - ARDL`,
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

                            if (saveShortRun && result.shortRun?.residuals) {
                                const resNumber = findNextNumber("RES_SR");
                                const varIndex = currentVarCount + addedVarsCount;
                                
                                varsForStore.push({
                                    name: `RES_SR_${resNumber}`,
                                    label: `Short-Run ARDL-ECM Residuals - ARDL`,
                                    type: "NUMERIC" as const,
                                    width: 12,
                                    decimals: 5,
                                    measure: "scale" as const,
                                    columnIndex: varIndex,
                                    values: []
                                });
                                
                                const maxLagVal = Math.max(pOrder, ...qOrdersArray);
                                const startIdx = maxLagVal + 1;
                                
                                const srResids = result.shortRun.residuals;
                                srResids.forEach((val: number, i: number) => {
                                    const origRowIdx = validRowIndices[startIdx + i];
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
                        const logMsg = `ARDL: ${yVar.name} vs X Variables`;
                        const logId = await addLog({ log: logMsg });
                        const analyticId = await addAnalytic(logId, { title: "ARDL Analysis", note: `p=${pOrder}, q=[${qOrdersArray}]` });

                        await addStatistic(analyticId, {
                            title: "ARDL Output",
                            output_data: JSON.stringify({ tables, charts }),
                            components: "ArdlAnalysis",
                            description: "Auto-Regressive Distributed Lag results"
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

            client.post({
                type: "ARDL",
                payload: {
                    y: yData,
                    x: xFlat,
                    n_vars: independentVariables.length,
                    p: pOrder,
                    q: qOrdersArray,
                    autoSelect,
                    maxP,
                    maxQ,
                    selectionCriterion
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
            setErrorMsg(errorMessage);
            toast.error(`ARDL Estimation Failed: ${errorMessage}`);
            console.error("ARDL estimation error:", error);
            setIsCalculating(false);
        }
    };

    return {
        errorMsg,
        isCalculating,
        handleAnalyzes,
    };
};
