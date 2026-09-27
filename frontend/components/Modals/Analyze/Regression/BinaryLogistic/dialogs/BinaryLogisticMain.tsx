"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, HelpCircle } from "lucide-react";
import { toast } from "sonner";

// Stores & Hooks
import { useVariableStore } from "@/stores/useVariableStore";
import { useModalStore } from "@/stores/useModalStore";
import { useDataStore } from "@/stores/useDataStore";
import { useResultStore } from "@/stores/useResultStore";

// Tour Guide
import type { TabControlProps } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { useTourGuide } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { baseTourSteps } from "../hooks/tourConfig";
import { TourPopup, ActiveElementHighlight } from "@/components/Common/TourComponents";
import { AnimatePresence } from "framer-motion";

// Components
import { VariablesTab } from "./VariablesTab";
import { CategoricalTab } from "./CategoricalTab";
import { SaveTab } from "./SaveTab";
import { OptionsTab } from "./OptionsTab";
import { AssumptionChecksTab } from "./AssumptionChecksTab";

// Formatter
import { formatBinaryLogisticResult } from "../services/formatter";
import { formatAssumptionTests } from "../services/formatter_assumptions";

// Syntax Generator
import { generateLogisticRegressionSyntax } from "../services/syntaxGenerator";

// Timing instrumentation
import {
  startAnalysisRun,
  markDispatch,
  markWorkerResponse,
  markProcedureEnd,
  registerRenderCompletionTarget,
  type AnalysisRunContext,
} from "@/lib/analysisTiming";

// Types
import type { Variable } from "@/types/Variable";
import type { CellUpdate } from "@/stores/useDataStore";
import type {
  BinaryLogisticOptions,
  BinaryLogisticCategoricalParams,
  BinaryLogisticSaveParams,
  BinaryLogisticOptionsParams,
  BinaryLogisticAssumptionParams,
  LogisticResult,
  SavedPredictions} from "../types/binary-logistic";
import {
  DEFAULT_BINARY_LOGISTIC_OPTIONS,
  DEFAULT_BINARY_LOGISTIC_CATEGORICAL_PARAMS,
  DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS,
  DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS,
  DEFAULT_BINARY_LOGISTIC_ASSUMPTION_PARAMS,
  validateOptionsParams,
} from "../types/binary-logistic";

const findActualVariable = (
  currentVariables: Variable[],
  targetVar: Variable
): Variable | null => {
  let found = currentVariables.find((v) => v.id === targetVar.id);
  if (found) return found;

  if (targetVar.columnIndex !== undefined) {
    found = currentVariables.find((v) => v.columnIndex === targetVar.columnIndex);
    if (found) return found;
  }

  found = currentVariables.find((v) => v.name === targetVar.name);
  if (found) return found;

  return null;
};

export const BinaryLogisticMain = () => {
  const { closeModal } = useModalStore();
  const variablesFromStore = useVariableStore((state) => state.variables);

  const { data } = useDataStore();
  const { addLog, addAnalytic, addStatistic } = useResultStore();

  // --- STATE ---
  const [activeTab, setActiveTab] = useState("variables");
  const [isLoading, setIsLoading] = useState(false);

  // --- Help Tour ---
  const tabControl = useMemo<TabControlProps>(
    () => ({
      setActiveTab: (tab: string) => setActiveTab(tab),
      currentActiveTab: activeTab,
    }),
    [activeTab]
  );

  const { tourActive, currentStep, tourSteps, currentTargetElement, startTour, nextStep, prevStep, endTour } =
    useTourGuide(baseTourSteps, "dialog", tabControl);

  // Variable Selection State
  const { variables } = useVariableStore();
  const [availableVariables, setAvailableVariables] = useState<Variable[]>([]);
  const [highlightedVariable, setHighlightedVariable] =
    useState<Variable | null>(null);

  // Main Options State
  const [options, setOptions] = useState<BinaryLogisticOptions>(
    DEFAULT_BINARY_LOGISTIC_OPTIONS
  );

  const variableDetails = useMemo(() => {
    return variablesFromStore.reduce((acc, v) => {
      if (v.id !== undefined) {
        acc[v.id] = v;
      }
      return acc;
    }, {} as Record<number, Variable>);
  }, [variablesFromStore]);

  // Sub-Dialog Params State
  const [catParams, setCatParams] = useState<BinaryLogisticCategoricalParams>(
    DEFAULT_BINARY_LOGISTIC_CATEGORICAL_PARAMS
  );

  const [saveParams, setSaveParams] = useState<BinaryLogisticSaveParams>(
    DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS
  );

  const [optParams, setOptParams] = useState<BinaryLogisticOptionsParams>(
    DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS
  );

  const [assumptionParams, setAssumptionParams] =
    useState<BinaryLogisticAssumptionParams>(
      DEFAULT_BINARY_LOGISTIC_ASSUMPTION_PARAMS
    );

  // --- EFFECTS ---
  useEffect(() => {
    const selectedIds = new Set([
      options.dependent?.id,
      ...options.covariates.map((v) => v.id),
      ...options.factors.map((v) => v.id),
    ]);

    const filtered = variablesFromStore.filter((v) => !selectedIds.has(v.id));
    setAvailableVariables(filtered);
  }, [
    variablesFromStore,
    options.dependent,
    options.covariates,
    options.factors,
  ]);

  // --- HANDLERS ---
  const handleMoveToDependent = () => {
    if (highlightedVariable) {
      // Validasi: Cek apakah variabel adalah binary (hanya 2 nilai unik)
      const colIndex = highlightedVariable.columnIndex;
      if (colIndex !== undefined && data.length > 0) {
        // Ambil semua nilai dari kolom tersebut, filter missing values
        const columnValues = data
          .map((row) => row[colIndex])
          .filter((val) => val !== null && val !== undefined && val !== "");

        const uniqueValues = Array.from(new Set(columnValues));

        if (uniqueValues.length !== 2) {
          toast.error(
            `Variable "${highlightedVariable.label || highlightedVariable.name}" has ${uniqueValues.length} unique value(s). Dependent variable must have exactly 2 unique values (binary outcome).`
          );
          return;
        }
      }

      // Set dependent
      setOptions((prev) => ({ ...prev, dependent: highlightedVariable }));
      setHighlightedVariable(null);
    }
  };

  // --- MODIFIKASI: Auto-detect Nominal/Ordinal variables ---
  const handleMoveToCovariates = () => {
    if (highlightedVariable) {
      // 1. Tambahkan ke daftar Covariates
      setOptions((prev) => ({
        ...prev,
        covariates: [...prev.covariates, highlightedVariable],
      }));

      // 2. Cek apakah tipe datanya Nominal atau Ordinal (case-insensitive check)
      //    Jika ya, auto-check di tab Categorical dengan setting default Indicator(Last)
      const measure = highlightedVariable.measure?.toLowerCase();
      if (measure === "nominal" || measure === "ordinal") {
        setCatParams((prev) => {
          // Pastikan tidak duplikat
          if (!prev.covariates.includes(highlightedVariable.name)) {
            return {
              ...prev,
              covariates: [...prev.covariates, highlightedVariable.name],
              variableSettings: {
                ...prev.variableSettings,
                [highlightedVariable.name]: {
                  name: highlightedVariable.name,
                  contrast: "Indicator" as const,
                  referenceCategory: "Last" as const,
                },
              },
            };
          }
          return prev;
        });
      }

      setHighlightedVariable(null);
    }
  };

  const handleRemoveDependent = () => {
    setOptions((prev) => ({ ...prev, dependent: null }));
  };

  const handleRemoveCovariate = (variable: Variable) => {
    setOptions((prev) => ({
      ...prev,
      covariates: prev.covariates.filter((v) => v.id !== variable.id),
    }));
    setCatParams((prev) => ({
      ...prev,
      covariates: prev.covariates.filter((n) => n !== variable.name),
    }));
  };

  // --- DROP HANDLERS: Batch variable drop from drag-and-drop ---
  const handleDropToDependent = (vars: Variable[]) => {
    if (vars.length === 0) return;
    const varToDrop = vars[0]; // Only first variable for dependent

    // Validasi: Cek apakah variabel adalah binary (hanya 2 nilai unik)
    const colIndex = varToDrop.columnIndex;
    if (colIndex !== undefined && data.length > 0) {
      const columnValues = data
        .map((row) => row[colIndex])
        .filter((val) => val !== null && val !== undefined && val !== "");

      const uniqueValues = Array.from(new Set(columnValues));

      if (uniqueValues.length !== 2) {
        toast.error(
          `Variable "${varToDrop.label || varToDrop.name}" has ${uniqueValues.length} unique value(s). Dependent variable must have exactly 2 unique values (binary outcome).`
        );
        return;
      }
    }

    setOptions((prev) => ({ ...prev, dependent: varToDrop }));
    setHighlightedVariable(null);
  };

  const handleDropToCovariates = (vars: Variable[]) => {
    if (vars.length === 0) return;

    setOptions((prev) => {
      const existingIds = new Set(prev.covariates.map((v) => v.id));
      const additions = vars.filter((v) => !existingIds.has(v.id));
      return {
        ...prev,
        covariates: [...prev.covariates, ...additions],
      };
    });

    // Auto-detect Nominal/Ordinal for categorical tab
    vars.forEach((variable) => {
      const measure = variable.measure?.toLowerCase();
      if (measure === "nominal" || measure === "ordinal") {
        setCatParams((prev) => {
          if (!prev.covariates.includes(variable.name)) {
            return {
              ...prev,
              covariates: [...prev.covariates, variable.name],
              variableSettings: {
                ...prev.variableSettings,
                [variable.name]: {
                  name: variable.name,
                  contrast: "Indicator" as const,
                  referenceCategory: "Last" as const,
                },
              },
            };
          }
          return prev;
        });
      }
    });

    setHighlightedVariable(null);
  };

  // --- WORKER HELPER ---
  const runWorkerAction = (
    action: string,
    extraConfig = {},
    timingCtx?: AnalysisRunContext
  ) => {
    return new Promise((resolve, reject) => {
      // Validasi minimal untuk semua action
      if (
        (action === "run_binary_logistic" || action === "run_vif") &&
        options.covariates.length === 0
      ) {
        reject(new Error("Please select at least one covariate."));
        return;
      }

      if (!data || data.length === 0) {
        reject(new Error("No data available."));
        return;
      }

      const worker = new Worker(
        new URL(
          "/workers/Regression/binaryLogistic.worker.js",
          window.location.origin
        ),
        { type: "module" }
      );

      worker.onmessage = (event) => {
        const { type, payload, timing } = event.data;
        worker.terminate();
        if (type === "SUCCESS") {
          if (timingCtx) {
            markWorkerResponse(timingCtx);
            timingCtx.workerTiming = timing;
          }
          resolve(payload);
        } else reject(new Error(payload || "Worker error"));
      };

      worker.onerror = (error) => {
        worker.terminate();
        reject(error);
      };

      // Refresh variables from store: IDs may have shifted since `options` was
      // set (e.g. after a prior run saved predictions/residuals to the dataset).
      // Without this, stale IDs miss `variableDetails` entirely and every row
      // gets filtered out as "missing", see findActualVariable() above.
      const currentVariables = useVariableStore.getState().variables;

      const actualDependent = options.dependent
        ? findActualVariable(currentVariables, options.dependent)
        : null;
      const actualCovariates = options.covariates
        .map((c) => findActualVariable(currentVariables, c))
        .filter((v): v is Variable => v !== null);
      const actualFactors = options.factors
        .map((f) => findActualVariable(currentVariables, f))
        .filter((v): v is Variable => v !== null);

      if (options.dependent && !actualDependent) {
        reject(
          new Error(
            `Dependent variable "${options.dependent.name}" was not found in the dataset. Please reselect it.`
          )
        );
        return;
      }

      if (options.covariates.length > 0 && actualCovariates.length === 0) {
        reject(
          new Error(
            "None of the selected covariates were found in the dataset. Please reselect them."
          )
        );
        return;
      }

      const currentVariableDetails: Record<number, Variable> = {};
      currentVariables.forEach((v) => {
        if (v.id !== undefined) {
          currentVariableDetails[v.id] = v;
        }
      });

      // Prepare basic indices
      const depIndex = actualDependent
        ? currentVariables.findIndex((v) => v.id === actualDependent.id)
        : -1;

      const indepIndices = [
        ...actualCovariates.map((c) =>
          currentVariables.findIndex((v) => v.id === c.id)
        ),
        ...actualFactors.map((f) =>
          currentVariables.findIndex((v) => v.id === f.id)
        ),
      ].filter((idx) => idx !== -1);

      // Konfigurasi umum
      const analysisConfig = {
        dependent_index: depIndex,
        independent_indices: indepIndices,
        rows: data.length,
        cols: currentVariables.length,
        // ... (config lain tidak relevan untuk VIF/BT raw calc, tapi dikirim saja)
        ...extraConfig,
      };

      if (timingCtx) markDispatch(timingCtx);

      worker.postMessage({
        action,
        dependentId: actualDependent?.id, // Bisa null untuk VIF (tergantung worker)
        independentIds: [
          ...actualCovariates.map((v) => v.id),
          ...actualFactors.map((v) => v.id),
        ],
        data,
        variableDetails: currentVariableDetails,
        config: JSON.stringify(analysisConfig),
      });
    });
  };

  // --- HELPER: Save Predictions to Dataset ---
  /**
   * Saves the computed predictions, residuals, and influence statistics
   * as new variables to the dataset (following SPSS naming conventions)
   * 
   * Variable names are incremental: PRE_1, PRE_2, PRE_3, etc.
   * If PRE_1 exists, next one will be PRE_2, and so on.
   * 
   * REFACTORED: Uses batch addVariables for reliability
   * 
   * @param savedPredictions - The predictions data from Rust
   * @param yEncoding - Mapping of original label to 0/1 (e.g., {"Male": 0, "Female": 1})
   */
  const savePredictionsToDataset = async (
    savedPredictions: SavedPredictions,
    yEncoding?: Record<string, number>
  ) => {
    if (!savedPredictions?.rows?.length) {
      console.log("[Main] No saved predictions to process");
      return;
    }

    const { addVariables } = useVariableStore.getState();
    const storeVariables = useVariableStore.getState().variables;
    const variableNames = savedPredictions.variable_names;
    const rows = savedPredictions.rows;

    // Track existing variable names for uniqueness
    const existingVarNames = new Set(storeVariables.map(v => v.name.toUpperCase()));

    // Build reverse mapping: 0/1 -> original label (e.g., {0: "Male", 1: "Female"})
    const reverseYEncoding: Record<number, string> = {};
    if (yEncoding) {
      Object.entries(yEncoding).forEach(([label, value]) => {
        reverseYEncoding[value] = label;
      });
    }

    // Starting column index for new variables
    let nextColumnIndex = storeVariables.length;

    // Collect all variables and updates to add in batch
    const variablesToAdd: Partial<Variable>[] = [];
    const allCellUpdates: CellUpdate[] = [];

    /**
     * Helper: Generate unique incremental variable name
     * Given a prefix like "RES", finds the next available number
     */
    const getIncrementalVarName = (prefix: string): string => {
      let counter = 1;
      while (existingVarNames.has(`${prefix}_${counter}`.toUpperCase())) {
        counter++;
      }
      const name = `${prefix}_${counter}`;
      // Mark as used for subsequent calls
      existingVarNames.add(name.toUpperCase());
      return name;
    };

    /**
     * Helper: Queue a numeric variable for batch addition
     */
    const queueNumericVariable = (
      varNameFromRust: string | undefined,
      label: string,
      getValue: (row: (typeof rows)[0]) => number | undefined
    ): void => {
      if (!varNameFromRust) return;

      const values = rows.map((row) => getValue(row));
      // Skip if all values are undefined
      if (values.every((v) => v === undefined)) return;

      // Extract prefix from Rust variable name (e.g., "RES_1" -> "RES")
      const prefix = varNameFromRust.replace(/_\d+$/, '');
      const varName = getIncrementalVarName(prefix);

      const newVariable: Partial<Variable> = {
        columnIndex: nextColumnIndex,
        name: varName,
        type: "NUMERIC",
        width: 8,
        decimals: 5,
        label,
        values: [],
        missing: null,
        columns: 200,
        align: "right",
        measure: "scale",
        role: "none",
      };

      variablesToAdd.push(newVariable);

      // Prepare cell updates for this variable
      // NOTE: rowIndex is the position among ANALYZED cases (post listwise
      // deletion), not the dataset row. row.case_index is the original
      // dataset row the worker remapped it to - use that as the target.
      values.forEach((value, rowIndex) => {
        if (value !== undefined && !isNaN(value)) {
          allCellUpdates.push({
            row: rows[rowIndex]?.case_index ?? rowIndex,
            col: nextColumnIndex,
            value,
          });
        }
      });

      nextColumnIndex++;
    };

    /**
     * Helper: Queue predicted group variable (may be string type)
     */
    const queuePredictedGroupVariable = (): void => {
      const varNameFromRust = variableNames?.predicted_group;
      if (!varNameFromRust) return;

      const values = rows.map((row) => {
        if (row.predicted_group === undefined) return undefined;
        // Convert 0/1 back to original label if mapping exists
        if (Object.keys(reverseYEncoding).length > 0) {
          return reverseYEncoding[row.predicted_group] ?? row.predicted_group;
        }
        return row.predicted_group;
      });

      if (values.every((v) => v === undefined)) return;

      const varName = getIncrementalVarName("PGR");
      const hasStringLabels = Object.keys(reverseYEncoding).length > 0;

      const newVariable: Partial<Variable> = {
        columnIndex: nextColumnIndex,
        name: varName,
        type: hasStringLabels ? "STRING" : "NUMERIC",
        width: hasStringLabels ? 50 : 8,
        decimals: 0,
        label: "Predicted group membership",
        values: [],
        missing: null,
        columns: 200,
        align: hasStringLabels ? "left" : "right",
        measure: "nominal",
        role: "none",
      };

      variablesToAdd.push(newVariable);

      values.forEach((value, rowIndex) => {
        if (value !== undefined) {
          allCellUpdates.push({
            row: rows[rowIndex]?.case_index ?? rowIndex,
            col: nextColumnIndex,
            value,
          });
        }
      });

      nextColumnIndex++;
    };

    /**
     * Helper: Queue DfBeta variables (multiple variables, one per coefficient)
     */
    const queueDfBetaVariables = (): void => {
      if (!variableNames?.influence_dfbeta?.length) return;

      // DfBeta names from Rust look like "DFB0_1", "DFB1_1".
      // We extract the base name ("DFB0", "DFB1") and find the next available suffix.
      let dfbetaSuffix = 1;
      while (true) {
        const anyExists = variableNames.influence_dfbeta.some((rustName) => {
          const baseName = rustName.split('_')[0];
          return existingVarNames.has(`${baseName}_${dfbetaSuffix}`.toUpperCase());
        });
        if (!anyExists) break;
        dfbetaSuffix++;
      }

      for (let i = 0; i < variableNames.influence_dfbeta.length; i++) {
        const rustName = variableNames.influence_dfbeta[i];
        const baseName = rustName.split('_')[0]; // "DFB0" or "DFB1", etc.
        const varName = `${baseName}_${dfbetaSuffix}`;
        
        const isConstant = baseName === "DFB0";
        const paramIndex = baseName.replace("DFB", "");
        const label = isConstant ? "DfBeta for constant" : `DfBeta for B${paramIndex}`;
        
        const values = rows.map((row) => row.influence_dfbeta?.[i]);
        if (values.every((v) => v === undefined)) continue;

        existingVarNames.add(varName.toUpperCase());

        const newVariable: Partial<Variable> = {
          columnIndex: nextColumnIndex,
          name: varName,
          type: "NUMERIC",
          width: 8,
          decimals: 5,
          label,
          values: [],
          missing: null,
          columns: 200,
          align: "right",
          measure: "scale",
          role: "none",
        };

        variablesToAdd.push(newVariable);

        values.forEach((value, rowIndex) => {
          if (value !== undefined && !isNaN(value)) {
            allCellUpdates.push({
              row: rows[rowIndex]?.case_index ?? rowIndex,
              col: nextColumnIndex,
              value,
            });
          }
        });

        nextColumnIndex++;
      }
    };

    // --- Queue all variables in order ---

    // Predicted Values
    queueNumericVariable(
      variableNames?.predicted_probability,
      "Predicted probability",
      (row) => row.predicted_probability
    );
    queuePredictedGroupVariable();

    // Residuals
    queueNumericVariable(
      variableNames?.resid_unstandardized,
      "Unstandardized residual",
      (row) => row.resid_unstandardized
    );
    queueNumericVariable(
      variableNames?.resid_logit,
      "Logit residual",
      (row) => row.resid_logit
    );
    queueNumericVariable(
      variableNames?.resid_studentized,
      "Studentized residual",
      (row) => row.resid_studentized
    );
    queueNumericVariable(
      variableNames?.resid_standardized,
      "Standardized residual",
      (row) => row.resid_standardized
    );
    queueNumericVariable(
      variableNames?.resid_deviance,
      "Deviance residual",
      (row) => row.resid_deviance
    );

    // Influence Statistics
    queueNumericVariable(
      variableNames?.influence_cooks,
      "Cook's distance",
      (row) => row.influence_cooks
    );
    queueNumericVariable(
      variableNames?.influence_leverage,
      "Leverage value",
      (row) => row.influence_leverage
    );
    queueDfBetaVariables();

    // --- Execute batch addition ---
    if (variablesToAdd.length > 0) {
      console.log(`[Main] Adding ${variablesToAdd.length} saved prediction variables...`);
      try {
        // Step 1: Add variables WITHOUT updates (empty columns)
        // This avoids index conflicts during splice operations
        await addVariables(variablesToAdd, []);

        // Step 2: After variables are added, apply cell updates separately
        // The column indices should now be valid in the new structure
        if (allCellUpdates.length > 0) {
          console.log(`[Main] Applying ${allCellUpdates.length} cell updates...`);
          await useDataStore.getState().updateCells(allCellUpdates);
          await useDataStore.getState().saveData();
        }

        console.log("[Main] Saved predictions added to dataset successfully");
      } catch (error) {
        console.error("[Main] Error adding saved predictions:", error);
        throw error;
      }
    } else {
      console.log("[Main] No saved predictions to add");
    }
  };

  // --- ASSUMPTION HANDLERS (UPDATED TO USE FORMATTER) ---
  const handleRunVIF = async () => {
    try {
      if (!options.dependent)
        throw new Error("Dependent variable is required.");
      if (options.covariates.length < 2) {
        throw new Error("VIF requires at least two independent variables.");
      }

      const timingCtx = startAnalysisRun("BinaryLogistic:VIF");

      const payload: any = await runWorkerAction("run_vif", {}, timingCtx);

      console.log("VIF Payload form Worker:", payload); // Debugging

      markProcedureEnd(timingCtx, timingCtx.workerTiming);

      // Save log & analytic container
      const logId = await addLog({
        log: `REGRESSION VIF CHECK VARIABLES ${options.covariates
          .map((c) => c.name)
          .join(" ")}`,
      });
      const analyticId = await addAnalytic(logId, {
        title: "Multicollinearity Diagnostics (VIF)",
      });

      const formattedOutput = formatAssumptionTests(payload);

      registerRenderCompletionTarget(
        timingCtx,
        analyticId,
        formattedOutput.sections?.length ?? 0
      );

      // Save sections using loop
      if (formattedOutput.sections && formattedOutput.sections.length > 0) {
        for (const section of formattedOutput.sections) {
          const tableDataWithTitle = {
            ...section.data,
            title: section.title,
          };
          await addStatistic(analyticId, {
            title: section.title,
            description: section.description || "",
            output_data: JSON.stringify({ tables: [tableDataWithTitle] }),
            components: "Assumption Tests",
          });
        }
      } else {
        console.warn("Formatter returned no sections for VIF", formattedOutput);
      }
    } catch (err: any) {
      console.error(err);
      throw new Error(`Failed to run VIF check: ${  err.message}`);
    }
  };

  const handleRunBoxTidwell = async () => {
    try {
      if (!options.dependent)
        throw new Error("Dependent variable is required.");

      const timingCtx = startAnalysisRun("BinaryLogistic:BoxTidwell");

      const payload: any = await runWorkerAction("run_box_tidwell", {}, timingCtx);

      markProcedureEnd(timingCtx, timingCtx.workerTiming);

      // Save log & analytic container
      const logId = await addLog({
        log: `REGRESSION BOX-TIDWELL VARIABLES ${options.covariates
          .map((c) => c.name)
          .join(" ")}`,
      });
      const analyticId = await addAnalytic(logId, {
        title: "Linearity of Logit (Box-Tidwell)",
      });

      // === REUSE FORMATTER ===
      const mockResult = {
        assumption_tests: {
          box_tidwell: payload, // Payload dari worker adalah array BoxTidwellRow[]
        },
      } as Partial<LogisticResult> as LogisticResult;

      const formattedOutput = formatAssumptionTests(mockResult);

      registerRenderCompletionTarget(
        timingCtx,
        analyticId,
        formattedOutput.sections?.length ?? 0
      );

      for (const section of formattedOutput.sections) {
        const tableDataWithTitle = {
          ...section.data,
          title: section.title,
        };
        await addStatistic(analyticId, {
          title: section.title,
          description: section.description || "",
          output_data: JSON.stringify({ tables: [tableDataWithTitle] }),
          components: "Assumption Tests",
        });
      }
    } catch (err: any) {
      console.error(err);
      throw new Error(`Failed to run Box-Tidwell test: ${  err.message}`);
    }
  };

  // --- LOGIKA UTAMA EKSEKUSI WORKER ---
  const handleAnalyze = async () => {
    // 1. Validasi Input
    if (!options.dependent || options.covariates.length === 0) {
      toast.error("Please select a dependent variable and at least one covariate.");
      return;
    }

    if (!data || data.length === 0) {
      toast.error("Dataset is empty or unavailable.");
      return;
    }

    const optionsValidationErrors = validateOptionsParams(optParams);
    if (optionsValidationErrors.length > 0) {
      toast.error(
        "Some values on the Options tab are out of range. Fix the highlighted fields before running the analysis."
      );
      return;
    }

    const timingCtx = startAnalysisRun(`BinaryLogistic:${options.method}`);

    setIsLoading(true);

    try {
      const worker = new Worker(
        new URL(
          "/workers/Regression/binaryLogistic.worker.js",
          window.location.origin
        ),
        { type: "module" }
      );

      worker.onmessage = async (event) => {
        const { type, payload, timing } = event.data;
        console.log(`[Main] Worker Message: ${type}`, payload);

        if (type === "SUCCESS") {
          markWorkerResponse(timingCtx);
          try {
            console.log("[Main] Starting Formatting Process...");

            const allIndependentVars = [
              ...options.covariates,
              ...options.factors,
            ];

            // Pass display options to formatter
            const formattedResult = formatBinaryLogisticResult(
              payload,
              options.dependent!,
              allIndependentVars,
              {
                displayAtLastStep: !optParams.displayAtEachStep,
                ciForExpB: optParams.ciForExpB,
                ciLevel: optParams.ciLevel,
                cutoff: optParams.classificationCutoff,
                casewiseOutliers: optParams.casewiseOutliers,
              }
            );

            console.log("[Main] Formatting Complete:", formattedResult);

            if (
              !formattedResult.sections ||
              formattedResult.sections.length === 0
            ) {
              console.warn("[Main] Warning: Formatter returned 0 sections!");
            }

            // B. Simpan Log dengan syntax lengkap SPSS-like
            const syntaxLog = generateLogisticRegressionSyntax({
              dependent: options.dependent!,
              covariates: options.covariates,
              factors: options.factors,
              method: options.method,
              categoricalParams: catParams,
              saveParams,
              optionParams: optParams,
            });

            // Procedure time ends here: result data is fully built, nothing
            // below this point is IndexedDB or render work.
            markProcedureEnd(timingCtx, timing);

            const logId = await addLog({
              log: syntaxLog,
            });

            // C. Simpan Analytic Entry (Parent)
            const analyticId = await addAnalytic(logId, {
              title: "Binary Logistic Regression",
              note: `Method: ${options.method}`,
            });

            registerRenderCompletionTarget(
              timingCtx,
              analyticId,
              formattedResult.sections?.length ?? 0
            );

            console.log(`[Main] Saving to DB (AnalyticID: ${analyticId})...`);

            // D. Simpan Output per Section
            if (
              formattedResult.sections &&
              Array.isArray(formattedResult.sections)
            ) {
              for (const section of formattedResult.sections) {
                console.log(`[Main] Saving Section: ${section.title}`);

                // -----------------------------------------------------------
                // LOGIC CUSTOM COMPONENTS (HEADER GROUPING)
                // -----------------------------------------------------------
                let componentCategory = "Tables";
                const cleanTitle = section.title
                  .replace(/<[^>]*>?/gm, " ")
                  .trim();

                if (section.id.includes("fitting_warnings")) {
                  componentCategory = "Warnings";
                } else if (section.id.includes("case_processing")) {
                  componentCategory = "Case Summary";
                } else if (section.id.includes("encoding")) {
                  componentCategory = "Dependent Variable Encoding";
                } else if (section.id.includes("categorical_codings")) {
                  componentCategory = "Categorical Variables Codings";
                } else if (section.id.includes("block0")) {
                  componentCategory = "Block 0: Beginning Block";
                } else if (
                  section.id.includes("block1") ||
                  section.id.includes("hosmer") ||
                  section.id.startsWith("classification_plot")
                ) {
                  componentCategory = `Block 1: Method = ${options.method}`;
                } else if (section.id.includes("casewise")) {
                  componentCategory = "Casewise Diagnostics";
                } else if (section.id.startsWith("assumption_")) {
                  componentCategory = "Assumption Tests";
                } else {
                  componentCategory = cleanTitle;
                }

                // -----------------------------------------------------------
                // DATA PREPARATION FOR RENDERER
                // -----------------------------------------------------------
                let payloadForRenderer: any;

                // Handle chart sections differently
                if (section.type === "chart" && section.chartData) {
                  // For chart sections, use the chart data format
                  payloadForRenderer = {
                    charts: section.chartData.charts,
                    description: section.description,
                    title: section.title,
                  };
                } else {
                  // For table sections, use the table format
                  const tableObjectForRenderer = {
                    ...section.data,
                    title: section.title,
                  };

                  payloadForRenderer = {
                    tables: [tableObjectForRenderer],
                  };
                }

                // -----------------------------------------------------------
                // SIMPAN KE DATABASE
                // -----------------------------------------------------------
                await addStatistic(analyticId, {
                  title: section.title,
                  description: section.description || "",
                  output_data: JSON.stringify(payloadForRenderer),
                  components: componentCategory,
                });
              }
            }

            // E. Simpan Saved Predictions ke Dataset (jika ada)
            if (payload.saved_predictions) {
              console.log("[Main] Processing Saved Predictions...");
              // Pass y_encoding from model_info to convert 0/1 back to original labels
              const yEncoding = payload.model_info?.y_encoding;
              await savePredictionsToDataset(payload.saved_predictions, yEncoding);
            }

            console.log("[Main] All Saved. Closing Modal.");
            setIsLoading(false);
            worker.terminate();
            closeModal("BINARY_LOGISTIC");
          } catch (saveError: any) {
            console.error("[Main] Error inside SUCCESS block:", saveError);
            toast.error(`Failed to save results: ${saveError.message}`);
            setIsLoading(false);
            worker.terminate();
          }
        } else if (type === "ERROR") {
          console.error("[Main] Worker reported ERROR:", payload);
          toast.error(
            typeof payload === "string"
              ? payload
              : "An unexpected error occurred during computation."
          );
          setIsLoading(false);
          worker.terminate();
        }
      };

      worker.onerror = (event) => {
        event.preventDefault();
        console.error("[Main] Worker System Error:", event);
        toast.error("Failed to run the calculation module (WASM error).");
        setIsLoading(false);
        worker.terminate();
      };

      // --- PERSIAPAN DATA INDEX & CONFIG ---
      // Refresh variables from store to ensure we have the latest state
      // (handles cases where the dataset was reloaded/saved and IDs changed)
      const currentVariables = useVariableStore.getState().variables;

      // Find actual variables in store (with correct IDs)
      const actualDependent = findActualVariable(currentVariables, options.dependent!);
      const actualCovariates = options.covariates
        .map(c => findActualVariable(currentVariables, c))
        .filter((v): v is Variable => v !== null);
      const actualFactors = options.factors
        .map(f => findActualVariable(currentVariables, f))
        .filter((v): v is Variable => v !== null);

      // Get indices in currentVariables array
      const depIndex = actualDependent
        ? currentVariables.findIndex(v => v.id === actualDependent.id)
        : -1;
      const indepIndices = [
        ...actualCovariates.map(c => currentVariables.findIndex(v => v.id === c.id)),
        ...actualFactors.map(f => currentVariables.findIndex(v => v.id === f.id)),
      ].filter((idx) => idx !== -1);

      // Debug logging
      console.log("[Main] Variables in store:", currentVariables.length);
      console.log("[Main] Dependent variable:", options.dependent?.name, "oldID:", options.dependent?.id, "newID:", actualDependent?.id);
      console.log("[Main] Dependent index found:", depIndex);
      console.log("[Main] Actual covariates:", actualCovariates.map(c => ({ name: c.name, id: c.id })));
      console.log("[Main] Independent indices:", indepIndices);

      if (!actualDependent || depIndex === -1) {
        const storeIds = currentVariables.map(v => v.id);
        console.error("[Main] Variable IDs in store:", storeIds);
        console.error("[Main] Looking for dependent ID:", options.dependent?.id);
        throw new Error(
          `Dependent variable "${options.dependent?.name}" was not found in the dataset. ` +
          `Please reselect it from the available list.`
        );
      }

      if (indepIndices.length === 0) {
        throw new Error(
          `No independent variables were found in the dataset. ` +
          `Selected covariates: ${options.covariates.map(c => c.name).join(", ")}`
        );
      }

      // Build variableDetails with CURRENT IDs from store
      const currentVariableDetails: Record<number, Variable> = {};
      currentVariables.forEach(v => {
        if (v.id !== undefined) {
          currentVariableDetails[v.id] = v;
        }
      });

      const methodMapping: Record<string, string> = {
        Enter: "Enter",
        "Forward: Conditional": "ForwardConditional",
        "Forward: Wald": "ForwardWald",
        "Forward: LR": "ForwardLR",
        "Backward: Conditional": "BackwardConditional",
        "Backward: Wald": "BackwardWald",
        "Backward: LR": "BackwardLR",
      };

      // --- PERUBAHAN: Mapping Konfigurasi Kategorik (Per-Variable) ---
      // Mengubah state UI (catParams) menjadi format config untuk Rust
      // Setiap variabel memiliki contrast & reference sendiri (SPSS style)
      const categoricalConfig = actualCovariates
        .filter((v) => catParams.covariates.includes(v.name))
        .map((v) => {
          const setting = catParams.variableSettings[v.name];
          return {
            id: v.id,
            method: setting?.contrast ?? "Indicator",
            reference: setting?.referenceCategory ?? "Last",
          };
        });

      // Tambahkan factors otomatis (default: Indicator/Last)
      actualFactors.forEach((f) => {
        if (!categoricalConfig.find((c) => c.id === f.id)) {
          const setting = catParams.variableSettings[f.name];
          categoricalConfig.push({
            id: f.id,
            method: setting?.contrast ?? "Indicator",
            reference: setting?.referenceCategory ?? "Last",
          });
        }
      });
      // ------------------------------------------------

      const analysisConfig = {
        dependent_index: depIndex,
        independent_indices: indepIndices,

        // --- Option Params ---
        max_iterations: optParams.maxIterations,
        include_constant: optParams.includeConstant,
        convergence_threshold: 0.001,
        confidence_level: optParams.ciLevel,
        cutoff: optParams.classificationCutoff,

        // --- Algoritma Method Params ---
        method: methodMapping[options.method] || "Enter",
        p_entry: optParams.probEntry,
        p_removal: optParams.probRemoval,

        // --- Additional Output Options sent to Worker ---
        classification_plots: optParams.classificationPlots,
        hosmer_lemeshow: optParams.hosmerLemeshow,
        casewise_listing: optParams.casewiseListing,
        casewise_type: optParams.casewiseType, // BARU: "outliers" atau "all"
        casewise_outliers: optParams.casewiseOutliers,
        iteration_history: optParams.iterationHistory,
        correlations: optParams.correlations,

        // Display option - BARU: untuk menentukan at each step vs at last step
        display_at_last_step: !optParams.displayAtEachStep,

        // --- BARU: Save Options (Tab Save di UI) ---
        save_predicted_probabilities: saveParams.predictedProbabilities,
        save_predicted_group: saveParams.predictedGroup,
        save_residuals_unstandardized: saveParams.residualsUnstandardized,
        save_residuals_logit: saveParams.residualsLogit,
        save_residuals_studentized: saveParams.residualsStudentized,
        save_residuals_standardized: saveParams.residualsStandardized,
        save_residuals_deviance: saveParams.residualsDeviance,
        save_influence_cooks: saveParams.influenceCooks,
        save_influence_leverage: saveParams.influenceLeverage,
        save_influence_dfbeta: saveParams.influenceDfBeta,

        rows: data.length,
        cols: variables.length,

        // --- KIRIM CONFIG KATEGORIK ---
        categoricalVariables: categoricalConfig,

        assumptions: {
          multicollinearity: assumptionParams.multicollinearity,
          box_tidwell: assumptionParams.boxTidwell,
        },
      };

      console.log("Config Cleaned for Rust:", JSON.stringify(analysisConfig));

      markDispatch(timingCtx);

      // Use ACTUAL IDs from currentVariables (not the potentially stale IDs from options)
      worker.postMessage({
        action: "run_binary_logistic",
        dependentId: actualDependent.id,
        independentIds: [
          ...actualCovariates.map((v) => v.id),
          ...actualFactors.map((v) => v.id),
        ],
        data,
        variableDetails: currentVariableDetails, // Use refreshed variableDetails
        config: JSON.stringify(analysisConfig),
      });
    } catch (err: any) {
      console.error("Main Thread Error:", err);
      toast.error(`Failed to start analysis: ${err.message}`);
      setIsLoading(false);
    }
  };

  // --- RENDER ---
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Feature Tour elements */}
      <AnimatePresence>
        {tourActive && tourSteps.length > 0 && currentStep < tourSteps.length && (
          <TourPopup
            step={tourSteps[currentStep]}
            currentStep={currentStep}
            totalSteps={tourSteps.length}
            onNext={nextStep}
            onPrev={prevStep}
            onClose={endTour}
            targetElement={currentTargetElement}
          />
        )}
      </AnimatePresence>
      <ActiveElementHighlight active={tourActive} />

      <div className="flex-grow px-6 py-3 overflow-y-auto min-h-0">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full h-full flex flex-col"
        >
          <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
            <TabsTrigger value="variables" id="binary-logistic-variables-tab-trigger">Variables</TabsTrigger>
            <TabsTrigger value="categorical" id="binary-logistic-categorical-tab-trigger">Categorical</TabsTrigger>
            <TabsTrigger value="save" id="binary-logistic-save-tab-trigger">Save</TabsTrigger>
            <TabsTrigger value="options" id="binary-logistic-options-tab-trigger">Options</TabsTrigger>
            <TabsTrigger value="assumption" id="binary-logistic-assumption-tab-trigger">Assumption</TabsTrigger>
          </TabsList>

          <div className="flex-grow min-h-0 overflow-hidden">
            <TabsContent value="variables" className="h-full mt-0">
              <VariablesTab
                availableVariables={availableVariables}
                selectedDependent={options.dependent}
                selectedCovariates={options.covariates}
                highlightedVariable={highlightedVariable}
                setHighlightedVariable={setHighlightedVariable}
                onMoveToDependent={handleMoveToDependent}
                onMoveToCovariates={handleMoveToCovariates}
                onRemoveDependent={handleRemoveDependent}
                onRemoveCovariate={handleRemoveCovariate}
                onDropToDependent={handleDropToDependent}
                onDropToCovariates={handleDropToCovariates}
                method={options.method}
                onMethodChange={(val) =>
                  setOptions((prev) => ({ ...prev, method: val }))
                }
              />
            </TabsContent>

            <TabsContent value="categorical" className="h-full mt-0">
              <CategoricalTab
                covariates={options.covariates}
                factors={options.factors}
                params={catParams}
                onChange={setCatParams}
              />
            </TabsContent>

            <TabsContent value="save" className="h-full mt-0">
              <SaveTab
                params={saveParams}
                onChange={(p) => setSaveParams((prev) => ({ ...prev, ...p }))}
              />
            </TabsContent>

            <TabsContent value="options" className="h-full mt-0">
              <OptionsTab
                params={optParams}
                onChange={(p) => setOptParams((prev) => ({ ...prev, ...p }))}
              />
            </TabsContent>

            <TabsContent
              value="assumption"
              className="h-full mt-0 border-0 p-0"
            >
              <AssumptionChecksTab
                dependent={options.dependent}
                covariates={options.covariates}
                onRunVIF={handleRunVIF}
                onRunBoxTidwell={handleRunBoxTidwell}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
        <div className="flex items-center text-muted-foreground">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-testid="binary-logistic-help-button"
                  variant="ghost"
                  size="icon"
                  onClick={startTour}
                  aria-label="Start feature tour"
                  className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">Start feature tour</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center space-x-4">
          <Button
            onClick={handleAnalyze}
            disabled={isLoading || !options.dependent || options.covariates.length === 0}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "OK"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setOptions(DEFAULT_BINARY_LOGISTIC_OPTIONS);
              setCatParams(DEFAULT_BINARY_LOGISTIC_CATEGORICAL_PARAMS);
              setSaveParams(DEFAULT_BINARY_LOGISTIC_SAVE_PARAMS);
              setOptParams(DEFAULT_BINARY_LOGISTIC_OPTIONS_PARAMS);
              setAssumptionParams(DEFAULT_BINARY_LOGISTIC_ASSUMPTION_PARAMS);
              setHighlightedVariable(null);
            }}
            disabled={isLoading}
          >
            Reset
          </Button>
          <Button
            variant="outline"
            onClick={() => closeModal("BINARY_LOGISTIC")}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};
