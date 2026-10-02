
import { useState } from "react";
import type { Variable } from "@/types/Variable";
import type { DataRow } from "@/types/Data";
import { toast } from "sonner";
import { useResultStore } from "@/stores/useResultStore";
import { getTimeSeriesWorker } from "@/utils/timeseriesWorkerPool";

export const useAnalyzeHook = (
    selectedVariables: Variable[],
    data: DataRow[],
    lags: number,
    onClose: () => void
) => {
    const { addLog, addAnalytic, addStatistic } = useResultStore();
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    const handleAnalyze = async () => {
        if (selectedVariables.length === 0) {
            setErrorMsg("Please select a residual variable");
            return;
        }

        setIsCalculating(true);
        setErrorMsg(null);

        try {
            // Extract data for selected variable
            const variable = selectedVariables[0];
            const residuals: number[] = [];

            for (const row of data) {
                const value = row[variable.columnIndex];
                if (value !== null && value !== undefined && !isNaN(Number(value))) {
                    residuals.push(Number(value));
                }
            }

            if (residuals.length < 10) {
                throw new Error("Insufficient data points (minimum 10 required)");
            }

            console.log(`Running ARCH-LM Test with ${residuals.length} residuals and ${lags} lags`);
            console.time("Statify ARCH-LM Execution Time");

            const client = getTimeSeriesWorker();

            client.onMessage(async (e) => {
                const { status, result, error } = e.data;
                
                if (status === "success") {
                    console.timeEnd("Statify ARCH-LM Execution Time");
                    console.log(`ARCH-LM Results:`, result);
                    
                    toast.success(`ARCH-LM Test completed!`);
                    
                    try {
                        // Prepare Visualization Data (Squared Residuals Scatter/Correlogram placeholder)
                        // Note: Correlogram logic would go here if we calculated ACF of e^2
                        
                        // Dispatch Results
                        const logMsg = `Homoscedasticity Test (ARCH-LM) on ${variable.name}`;
                        const logId = await addLog({ log: logMsg });
                        const analyticId = await addAnalytic(logId, { title: `ARCH-LM Test`, note: `Lags=${lags}` });

                        const n = residuals.length;
                        const mean = residuals.reduce((a, b) => a + b, 0) / n;
                        const variance = residuals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
                        const stdDev = Math.sqrt(variance);
                        const isHomo = result.isHomoscedastic;

                        const tables = [
                            {
                                title: `ARCH-LM Test: ${variable.name} (Lags = ${lags})`,
                                columnHeaders: [
                                    { header: "Test", key: "test" },
                                    { header: "Statistic", key: "stat" },
                                    { header: "Prob.", key: "prob" },
                                    { header: "df1 / df2", key: "df" },
                                    { header: "Result", key: "result" }
                                ],
                                rows: [
                                    {
                                        test: "F-statistic",
                                        stat: result.fStatistic,
                                        prob: result.fPValue,
                                        df: `F(${lags}, ${residuals.length - 2 * lags - 1})`,
                                        result: isHomo ? "Homoscedastic" : "Heteroscedastic (ARCH effects present)"
                                    },
                                    {
                                        test: "Obs*R-squared",
                                        stat: result.statistic,
                                        prob: result.pValue,
                                        df: `Chi-Square(${lags})`,
                                        result: isHomo ? "Homoscedastic" : "Heteroscedastic (ARCH effects present)"
                                    }
                                ]
                            },
                            {
                                title: "Residual Statistics",
                                columnHeaders: [
                                    { header: "Statistic", key: "stat" },
                                    { header: "Value", key: "val" }
                                ],
                                rows: [
                                    { stat: "Count (N)", val: n },
                                    { stat: "Mean", val: mean.toFixed(6) },
                                    { stat: "Std. Deviation", val: stdDev.toFixed(6) },
                                    { stat: "Minimum", val: Math.min(...residuals).toFixed(6) },
                                    { stat: "Maximum", val: Math.max(...residuals).toFixed(6) }
                                ]
                            },
                            {
                                title: "Interpretation",
                                columnHeaders: [
                                    { header: "Component", key: "comp" },
                                    { header: "Description", key: "desc" }
                                ],
                                rows: [
                                    { comp: "H0 (Null Hypothesis)", desc: "No ARCH effects — residuals are homoscedastic" },
                                    { comp: "Decision", desc: isHomo ? `Fail to reject H0 (p-value > 0.05). No significant ARCH effects detected.` : `Reject H0 (p-value < 0.05). Significant ARCH effects detected.` },
                                    { comp: "Recommendation", desc: isHomo ? "Residuals appear homoscedastic. ARCH/GARCH modeling may not be necessary." : "Consider ARCH/GARCH models to capture volatility clustering in the residuals." }
                                ]
                            }
                        ];

                        await addStatistic(analyticId, {
                            title: `ARCH-LM Test Output`,
                            output_data: JSON.stringify({ tables, charts: [] }),
                            components: "HomoscedasticityTest",
                            description: `Result of ARCH-LM Test`
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
                    toast.error(`Test Failed: ${error}`);
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
                type: "ARCH_LM", 
                payload: {
                    residuals: residuals,
                    lags: lags
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
        handleAnalyze,
    };
};
