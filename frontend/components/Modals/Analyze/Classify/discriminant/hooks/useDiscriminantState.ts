import { useCallback, useEffect, useState } from "react";
import { getSlicedData, getVarDefs } from "@/hooks/useVariable";
import type { DiscriminantType, DiscriminantMainType } from "@/components/Modals/Analyze/Classify/discriminant/types/discriminant";
import { DiscriminantDefault } from "@/components/Modals/Analyze/Classify/discriminant/constants/discriminant-default";
import { clearFormData, getFormData, saveFormData } from "@/hooks/useIndexedDB";
import { saveDiscriminantResult, saveDiscriminantAssumptions } from "@/components/Modals/Analyze/Classify/discriminant/services/store";
import { saveDiscriminantVariables } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-save";
import { exportDiscriminantModelXml } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-xml-export";
import { validateDiscriminantInput } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-validation";
import { toast } from "sonner";
import { Variable } from "@/types/Variable";

export type DiscriminantValueUnion = string | number | boolean | string[] | null;

/** What the analysis sends to the engine (the worker message, or the main-thread call). */
type EngineMessage = {
    group_data: unknown;
    independent_data: unknown;
    selection_data: unknown;
    strata_data?: unknown;
    group_data_defs: unknown;
    independent_data_defs: unknown;
    selection_data_defs: unknown;
    config_data: DiscriminantType;
};

/** The engine's reply, in the shape discriminant.worker.js posts back. */
type EngineReply =
    | { type: "SUCCESS"; payload: { formattedResults: any; log: unknown; errors: unknown } }
    | { type: "ERROR"; error: string };

const WASM_BASE = "/workers/Classify/Discriminant/pkg/";

type SlicedColumns = ReturnType<typeof getSlicedData>;

/**
 * Pad the sliced columns to one common length. getSlicedData stops each slice at the
 * last row holding a value in *its own* variables, so the grouping column can end
 * before the predictors do: cases without a group code at the end of the file (e.g.
 * bankloan's prospective customers) would never reach the engine, which counts cases
 * by the grouping column. Padded rows are empty cells, so those cases count as
 * missing group codes and are classified as ungrouped cases, as in SPSS. `names`
 * are each slice's variables in slice order (getSlicedData keeps that order).
 */
export function padSlices(slices: Array<{ columns: SlicedColumns; names: string[] }>): SlicedColumns[] {
    const length = Math.max(0, ...slices.flatMap(({ columns }) => columns.map((column) => column.length)));
    return slices.map(({ columns, names }) =>
        columns.map((column, k) => {
            const padded = column.slice();
            while (padded.length < length) padded.push({ [names[k]]: null });
            return padded;
        })
    );
}

/**
 * Developer switch for the responsiveness test (Web Worker vs main thread). With
 * `localStorage.setItem("discriminant.noWorker", "1")` in the browser console the
 * analysis runs on the main thread, so the page freezes while it computes; remove
 * the key to go back to the worker. Read on every run, no reload needed.
 */
function isWorkerDisabled(): boolean {
    try {
        return typeof window !== "undefined" && window.localStorage.getItem("discriminant.noWorker") === "1";
    } catch {
        return false;
    }
}

/**
 * Run the engine on the main thread, doing what discriminant.worker.js does, and
 * return the same reply it would post. The WASM call itself is synchronous and
 * blocks the page until it returns.
 */
async function runEngineOnMainThread(message: EngineMessage): Promise<EngineReply> {
    try {
        const wasm = await import(/* webpackIgnore: true */ `${WASM_BASE}wasm.js`);
        await wasm.default({ module_or_path: `${WASM_BASE}wasm_bg.wasm` });

        // Let the browser paint the loading state before the synchronous call
        // takes over the main thread.
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

        const analysis = new wasm.DiscriminantAnalysis(
            message.group_data,
            message.independent_data,
            message.selection_data,
            message.group_data_defs,
            message.independent_data_defs,
            message.selection_data_defs,
            message.config_data,
            message.strata_data
        );
        const formattedResults = analysis.get_formatted_results();
        const log = analysis.get_all_log();
        const errors = analysis.get_all_errors();
        analysis.free();
        return { type: "SUCCESS", payload: { formattedResults, log, errors } };
    } catch (error) {
        const detail = (error as { message?: string })?.message || String(error);
        return { type: "ERROR", error: detail };
    }
}

export interface UseDiscriminantStateResult {
    formData: DiscriminantType;
    updateFormData: <T extends keyof DiscriminantType>(
        section: T,
        field: keyof DiscriminantType[T],
        value: DiscriminantType[T][keyof DiscriminantType[T]] | DiscriminantValueUnion
    ) => void;
    executeAnalysis: (mainData: DiscriminantMainType) => Promise<void>;
    /** Pre-run checks (variables, Define Range, non-empty groups); message or `null`. */
    validateInput: (mainData: DiscriminantMainType) => string | null;
    /** Run only the assumption checks and push their output immediately. */
    runAssumptions: (mainData: DiscriminantMainType) => Promise<void>;
    resetFormData: () => Promise<void>;
    isLoading: boolean;
    error: string | null;
}

export const useDiscriminantState = (
    variables: Variable[],
    dataVariables: string[][]
): UseDiscriminantStateResult => {
    const [formData, setFormData] = useState<DiscriminantType>({
        ...DiscriminantDefault,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load saved form data from IndexedDB on mount
    useEffect(() => {
        const loadFormData = async () => {
            try {
                const savedData = await getFormData("Discriminant");
                if (savedData) {
                    const { id, ...formDataWithoutId } = savedData;
                    // Merge with defaults so sections added after this data was
                    // saved (e.g. `assumptions`) are always present.
                    setFormData({
                        ...DiscriminantDefault,
                        ...(formDataWithoutId as DiscriminantType),
                    });
                } else {
                    setFormData({ ...DiscriminantDefault });
                }
            } catch (err) {
                console.error("Failed to load form data:", err);
            }
        };
        loadFormData();
    }, []);

    // Keep Bootstrap Variables up-to-date with current variables
    useEffect(() => {
        setFormData((prev) => {
            const independentVars = prev.main.IndependentVariables
                ? [...prev.main.IndependentVariables]
                : [];
            const usedVariables = [
                prev.main.GroupingVariable,
                ...independentVars,
                prev.main.SelectionVariable,
            ];
            const updatedVariables = variables
                .filter((v) => !usedVariables.includes(v.name))
                .map((v) => v.name);
            return {
                ...prev,
                bootstrap: { ...prev.bootstrap, Variables: updatedVariables },
            };
        });
    }, [
        formData.main.IndependentVariables,
        formData.main.GroupingVariable,
        formData.main.SelectionVariable,
        variables,
    ]);

    const updateFormData = useCallback(
        <T extends keyof DiscriminantType>(
            section: T,
            field: keyof DiscriminantType[T],
            value: DiscriminantType[T][keyof DiscriminantType[T]] | string | number | boolean | string[] | null
        ) => {
            setFormData((prev) => ({
                ...prev,
                [section]: {
                    ...prev[section],
                    [field]: value,
                },
            }));
        },
        []
    );

    const resetFormData = useCallback(async () => {
        try {
            await clearFormData("Discriminant");
            setFormData({ ...DiscriminantDefault });
        } catch (err) {
            console.error("Failed to clear form data:", err);
        }
    }, []);

    const validateInput = useCallback(
        (mainData: DiscriminantMainType) =>
            validateDiscriminantInput(dataVariables, variables, { ...formData, main: mainData }),
        [formData, dataVariables, variables]
    );

    const executeAnalysis = useCallback(
        async (mainData: DiscriminantMainType) => {
            setIsLoading(true);
            setError(null);

            try {
                const newFormData: DiscriminantType = {
                    ...formData,
                    main: mainData,
                };

                await saveFormData("Discriminant", newFormData);

                // The assumption checks always run with the full analysis, so their
                // tables appear even when the user never opened the Assumptions tab.
                const configData: DiscriminantType = {
                    ...newFormData,
                    assumptions: {
                        Multicollinearity: true,
                        MultivariateNormality: true,
                        UnivariateNormality: true,
                    },
                };

                const GroupingVariable = mainData.GroupingVariable
                    ? [mainData.GroupingVariable]
                    : [];
                const IndependentVariables = mainData.IndependentVariables || [];
                const SelectionVariable = mainData.SelectionVariable
                    ? [mainData.SelectionVariable]
                    : [];
                // Bootstrap strata variables: the engine stratifies by their
                // crossed cells, so their values have to travel with the data.
                const StrataVariables = (
                    configData.bootstrap?.StrataVariables || []
                ).filter((name) => !!name && name.trim() !== "");

                const slicedDataForGrouping = getSlicedData({
                    dataVariables,
                    variables,
                    selectedVariables: GroupingVariable,
                });
                const slicedDataForIndependent = getSlicedData({
                    dataVariables,
                    variables,
                    selectedVariables: IndependentVariables,
                });
                const slicedDataForSelection = getSlicedData({
                    dataVariables,
                    variables,
                    selectedVariables: SelectionVariable,
                });
                const slicedDataForStrata = getSlicedData({
                    dataVariables,
                    variables,
                    selectedVariables: StrataVariables,
                });
                const [groupData, independentData, selectionData, strataData] = padSlices([
                    { columns: slicedDataForGrouping, names: GroupingVariable },
                    { columns: slicedDataForIndependent, names: IndependentVariables },
                    { columns: slicedDataForSelection, names: SelectionVariable },
                    { columns: slicedDataForStrata, names: StrataVariables },
                ]);

                const varDefsForGrouping = getVarDefs(variables, GroupingVariable);
                const varDefsForIndependent = getVarDefs(variables, IndependentVariables);
                const varDefsForSelection = getVarDefs(variables, SelectionVariable);

                const message: EngineMessage = {
                    group_data: groupData,
                    independent_data: independentData,
                    selection_data: selectionData,
                    strata_data: strataData,
                    group_data_defs: varDefsForGrouping,
                    independent_data_defs: varDefsForIndependent,
                    selection_data_defs: varDefsForSelection,
                    config_data: configData
                };

                // The engine's reply, from the worker or from the main-thread run.
                const handleReply = async (reply: EngineReply) => {
                    if (reply.type === "SUCCESS") {
                        const { formattedResults, errors } = reply.payload;

                        // The WASM error collector always returns a summary string;
                        // "No errors occurred." is its empty state. Anything else means
                        // some tables could not be computed, or were computed under a
                        // condition the user must know about (entries whose context
                        // starts with "Warning", e.g. a singular matrix).
                        if (typeof errors === "string" && errors.trim() !== "No errors occurred.") {
                            console.warn("Analysis warnings:", errors);
                            toast.warning("Discriminant analysis reported errors or warnings", {
                                description: errors,
                            });
                        }

                        await saveDiscriminantResult(formattedResults);

                        // Save-dialog side effects. These run after the output is
                        // stored so a failure here still leaves the user with their
                        // results; each reports its own problem and does not abort
                        // the other.
                        try {
                            const created = await saveDiscriminantVariables(
                                dataVariables,
                                variables,
                                formattedResults,
                                configData
                            );
                            if (created.length > 0) {
                                toast.success(`Saved to dataset: ${created.join(", ")}`);
                            }
                        } catch (saveErr) {
                            console.error("[Discriminant] Failed to save variables:", saveErr);
                            const detail =
                                saveErr instanceof Error ? saveErr.message : String(saveErr);
                            toast.error(`Failed to save variables: ${detail}`);
                        }

                        if (configData.save.ExportXml) {
                            try {
                                const fileName = exportDiscriminantModelXml(
                                    formattedResults,
                                    configData
                                );
                                toast.success(`Model information exported to ${fileName}`);
                            } catch (xmlErr) {
                                console.error("[Discriminant] Failed to export model XML:", xmlErr);
                                const detail =
                                    xmlErr instanceof Error ? xmlErr.message : String(xmlErr);
                                toast.error(`Failed to export model XML: ${detail}`);
                            }
                        }

                        setIsLoading(false);
                    } else {
                        const workerError = reply.error;
                        console.error("[Discriminant] Worker Error:", workerError);
                        // The dialog may already be closed when the worker replies, so
                        // the inline Alert alone is not enough — surface it as a toast.
                        toast.error(`Discriminant analysis failed: ${workerError || "Unknown worker error"}`);
                        setError(workerError || "Unknown worker error");
                        setIsLoading(false);
                    }
                };

                // Responsiveness test: run on the main thread instead of the worker.
                if (isWorkerDisabled()) {
                    console.warn(
                        "[Discriminant] Web Worker disabled (localStorage discriminant.noWorker = 1): running on the main thread."
                    );
                    await handleReply(await runEngineOnMainThread(message));
                    return;
                }

                // Create WebWorker and send it the data
                const worker = new Worker('/workers/Classify/Discriminant/discriminant.worker.js', { type: 'module' });
                worker.postMessage(message);

                // Handle worker response
                worker.onmessage = async (e) => {
                    try {
                        await handleReply(e.data as EngineReply);
                    } finally {
                        worker.terminate();
                    }
                };

                // Handle worker errors
                worker.onerror = (err) => {
                    console.error("[Discriminant] Worker Execution Error:", err);
                    const detail = err.message
                        ? `${err.message} (${err.filename || "unknown"}:${err.lineno || 0}:${err.colno || 0})`
                        : String(err);
                    toast.error(`Discriminant analysis failed: ${detail}`);
                    setError(`Worker Error: ${detail}`);
                    setIsLoading(false);
                    worker.terminate();
                };

            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                setError(message);
                console.error("Discriminant analysis failed:", err);
                setIsLoading(false);
            }
        },
        [formData, dataVariables, variables]
    );

    // Run ONLY the assumption checks and push their output to the result store,
    // without running (or saving) the full discriminant analysis. Resolves when
    // the worker finishes so the caller can drive its own loading/success state.
    const runAssumptions = useCallback(
        async (mainData: DiscriminantMainType) => {
            const validationError = validateInput(mainData);
            if (validationError || !mainData.GroupingVariable) {
                throw new Error(validationError ?? "Please select a Grouping Variable.");
            }

            // Lightweight config: force all three assumption checks on and skip
            // the heavy/method-specific work (stepwise, bootstrap). Assumptions
            // are method-independent, so this is safe and fast.
            const configData: DiscriminantType = {
                ...formData,
                main: { ...mainData, Together: true, Stepwise: false },
                bootstrap: { ...formData.bootstrap, PerformBootStrapping: false },
                assumptions: {
                    Multicollinearity: true,
                    MultivariateNormality: true,
                    UnivariateNormality: true,
                },
            };

            const GroupingVariable = [mainData.GroupingVariable];
            const IndependentVariables = mainData.IndependentVariables || [];
            const SelectionVariable = mainData.SelectionVariable ? [mainData.SelectionVariable] : [];

            const slicedDataForGrouping = getSlicedData({ dataVariables, variables, selectedVariables: GroupingVariable });
            const slicedDataForIndependent = getSlicedData({ dataVariables, variables, selectedVariables: IndependentVariables });
            const slicedDataForSelection = getSlicedData({ dataVariables, variables, selectedVariables: SelectionVariable });
            const [groupData, independentData, selectionData] = padSlices([
                { columns: slicedDataForGrouping, names: GroupingVariable },
                { columns: slicedDataForIndependent, names: IndependentVariables },
                { columns: slicedDataForSelection, names: SelectionVariable },
            ]);
            const varDefsForGrouping = getVarDefs(variables, GroupingVariable);
            const varDefsForIndependent = getVarDefs(variables, IndependentVariables);
            const varDefsForSelection = getVarDefs(variables, SelectionVariable);

            const message: EngineMessage = {
                group_data: groupData,
                independent_data: independentData,
                selection_data: selectionData,
                group_data_defs: varDefsForGrouping,
                independent_data_defs: varDefsForIndependent,
                selection_data_defs: varDefsForSelection,
                config_data: configData,
            };

            // Responsiveness test: run on the main thread instead of the worker.
            if (isWorkerDisabled()) {
                const reply = await runEngineOnMainThread(message);
                if (reply.type !== "SUCCESS") {
                    throw new Error(reply.error || "Unknown engine error");
                }
                await saveDiscriminantAssumptions(reply.payload.formattedResults);
                return;
            }

            await new Promise<void>((resolve, reject) => {
                const worker = new Worker('/workers/Classify/Discriminant/discriminant.worker.js', { type: 'module' });
                worker.postMessage(message);

                worker.onmessage = async (e) => {
                    const { type, payload, error: workerError } = e.data;
                    if (type === "SUCCESS") {
                        try {
                            await saveDiscriminantAssumptions(payload.formattedResults);
                            resolve();
                        } catch (err) {
                            reject(err instanceof Error ? err : new Error(String(err)));
                        } finally {
                            worker.terminate();
                        }
                    } else {
                        worker.terminate();
                        reject(new Error(workerError || "Unknown worker error"));
                    }
                };

                worker.onerror = (err) => {
                    worker.terminate();
                    reject(new Error(err.message || "Worker error"));
                };
            });
        },
        [formData, dataVariables, variables, validateInput]
    );

    return {
        formData,
        updateFormData,
        executeAnalysis,
        validateInput,
        runAssumptions,
        resetFormData,
        isLoading,
        error,
    };
};