"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
    TooltipProvider,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, HelpCircle, RotateCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Stores & Hooks
import { useVariableStore } from "@/stores/useVariableStore";
import { useModalStore } from "@/stores/useModalStore";
import { useResultStore } from "@/stores/useResultStore";
import { useAnalysisData } from "@/hooks/useAnalysisData";

// Tour Guide
import type { TabControlProps } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { useTourGuide } from "@/components/Modals/Analyze/Descriptive/Descriptive/hooks/useTourGuide";
import { baseTourSteps } from "../hooks/tourConfig";
import { TourPopup, ActiveElementHighlight } from "@/components/Common/TourComponents";
import { AnimatePresence } from "framer-motion";

// Komponen Tab (Pastikan Anda membuat file-file ini di folder yang sama)
import { VariablesTab } from "./VariablesTab";
import { StatisticsTab, StatisticsOptions } from "./StatisticsTab";
import { CriteriaTab } from "./CriteriaTab";
import { OptionsTab } from "./OptionsTab";
import { SaveTab } from "./SaveTab";

// Types
import { Variable } from "@/types/Variable";

// Interpretations
import {
    generateCaseProcessingDescription,
    generateModelFittingDescription,
    generateStepSummaryDescription,
    generatePseudoRSquareDescription,
    generateParameterEstimatesDescription,
    generateClassificationDescription,
    generateGoodnessOfFitDescription,
    generateLikelihoodRatioDescription,
    generateAsymptoticCovariancesDescription,
    generateAsymptoticCorrelationsDescription,
    generateMonotonicityDescription,
    generateCellProbabilitiesDescription,
} from "./interpretations";

type MultinomialSaveOptions = {
    estimatedResponseProbabilities: boolean;
    predictedCategory: boolean;
    predictedCategoryProbability: boolean;
    actualCategoryProbability: boolean;
};

type MultinomialAdvancedOptions = {
    dispersionScale: "none" | "userDefined" | "pearson" | "deviance";
    dispersionValue: string;
    entryProbability: string;
    entryTest: "likelihoodRatio" | "score";
    removalProbability: string;
    removalTest: "likelihoodRatio" | "score";
    minimumSteppedEffects: string;
    maximumSteppedEffects: string;
    constrainHierarchy: boolean;
    hierarchyMode: "treat_covariates_like_factors" | "consider_only_factorial_terms" | "within_covariate_effects";
};

export const MultinomialLogisticMain = () => {
    const { closeModal } = useModalStore();
    const variables = useVariableStore((state) => state.variables);
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const { data, weights, weightVariable } = useAnalysisData();
    const { addLog, addAnalytic, addStatistic, loadResults } = useResultStore();

    // --- STATE & TOUR ---
    const [activeTab, setActiveTab] = useState("variables");

    const tabControl = useMemo<TabControlProps>(
        () => ({
            setActiveTab: (tab: string) => setActiveTab(tab),
            currentActiveTab: activeTab,
        }),
        [activeTab]
    );

    const {
        tourActive,
        currentStep,
        tourSteps,
        currentTargetElement,
        startTour,
        nextStep,
        prevStep,
        endTour,
    } = useTourGuide(baseTourSteps, "dialog", tabControl);


    // State untuk opsi Multinomial Logistic (Sesuai SPSS)
    const [options, setOptions] = useState({
        dependent: null as Variable | null,
        factors: [] as Variable[],
        covariates: [] as Variable[],
        referenceCategory: "last", // first, last, or custom
        statistics: {
            caseProcessing: true,
            pseudoRSquare: true,
            stepSummary: true,
            modelFitting: true,
            informationCriteria: true,
            cellProbabilities: true,
            classificationTable: true,
            goodnessOfFit: true,
            monotonicityMeasures: false,
            parameterEstimates: true,
            likelihoodRatioTests: true,
            asymptoticCorrelations: false,
            asymptoticCovariances: false,
            confidenceInterval: 95,
            subpopulationMode: "factors" as StatisticsOptions["subpopulationMode"],
            subpopulationVariables: [] as string[],
        },
        criteria: {
            iterations: 100,
            pconverge: 0.000001,
            lconverge: 0.0,
            singularity: 0.00000001,
            delta: 0.5,
        },
        save: {
            estimatedResponseProbabilities: false,
            predictedCategory: false,
            predictedCategoryProbability: false,
            actualCategoryProbability: false,
        } as MultinomialSaveOptions,
        advanced: {
            dispersionScale: "none",
            dispersionValue: "",
            entryProbability: ".05",
            entryTest: "likelihoodRatio",
            removalProbability: ".1",
            removalTest: "likelihoodRatio",
            minimumSteppedEffects: "0",
            maximumSteppedEffects: "",
            constrainHierarchy: true,
            hierarchyMode: "treat_covariates_like_factors",
        } as MultinomialAdvancedOptions,
    });

    const handleAnalyze = async () => {
        // 1. Gunakan 'data' dari store dan pastikan tidak kosong
        if (!options.dependent || !data || data.length === 0) return;
        setIsLoading(true);
        setErrorMsg(null);

        try {
            // Validasi criteria
            if (options.criteria.iterations <= 0 || !Number.isInteger(options.criteria.iterations)) {
                throw new Error("Batas maksimum perulangan (Maximum iterations) harus berupa bilangan bulat positif.");
            }
            if (options.criteria.pconverge <= 0) {
                throw new Error("Konvergensi parameter (Parameter convergence) harus berupa bilangan positif.");
            }
            if (options.criteria.lconverge < 0) {
                throw new Error("Konvergensi log-likelihood (Log-likelihood convergence) tidak boleh negatif.");
            }
            if (options.criteria.singularity <= 0) {
                throw new Error("Kriteria singularitas (Singularity criterion) harus berupa bilangan positif.");
            }
            if (options.criteria.delta < 0) {
                throw new Error("Nilai penyesuaian sel kosong (Added to empty cells / Delta) tidak boleh negatif.");
            }

            console.log("Struktur Baris Data:", data[0]);
            console.log("ID Variabel Dependen:", options.dependent.id);
            console.log("Nama Variabel Dependen:", options.dependent.name);

            const dependentVar = options.dependent;
            const factorVars = options.factors;
            const covariateVars = options.covariates;

            const dependentIndex = dependentVar.columnIndex;
            const factorIndices = factorVars.map(v => v.columnIndex);
            const covariateIndices = covariateVars.map(v => v.columnIndex);

            const allSelectedIndices = [dependentIndex, ...factorIndices, ...covariateIndices];

            // Validasi keberadaan kolom berdasarkan index
            const availableColumns = (data[0] || []).map((_: any, idx: number) => idx);
            const missingVars = [dependentVar, ...factorVars, ...covariateVars]
                .filter(v => v.columnIndex >= (data[0]?.length ?? 0))
                .map(v => v.name);

            if (missingVars.length > 0) {
                throw new Error(
                    `Kolom tidak ditemukan di data: ${missingVars.join(", ")}. Kolom yang tersedia: ${availableColumns.join(", ")}`
                );
            }

            // 2. Case base: abaikan baris yang benar-benar kosong pada semua variabel terpilih.
            const analysisBaseRows = data
                .map((row: any[], rowIndex: number) => ({
                    row,
                    rowIndex,
                    weight: weights[rowIndex] ?? 1,
                }))
                .filter(({ row }) => {
                    return allSelectedIndices.some((idx) => {
                        const val = row[idx];
                        return val !== null && val !== undefined && String(val).trim() !== "";
                    });
                });

            // 3. Listwise Deletion + valid positive weight if Weight Cases is active
            const validRows = analysisBaseRows.filter(({ row, weight }) => {
                const hasCompleteData = allSelectedIndices.every((idx) => {
                    const val = row[idx];
                    return val !== null && val !== undefined && String(val).trim() !== "";
                });
                const hasValidWeight = !weightVariable || (Number.isFinite(weight) && weight > 0);
                return hasCompleteData && hasValidWeight;
            });

            const validData = validRows.map(({ row }) => row);
            const validRowIndices = validRows.map(({ rowIndex }) => rowIndex);
            const validWeights = validRows.map(({ weight }) => Number(weight));

            console.log("Debug Data Access:", {
                sampleRow: data[0],
                lookingFor: allSelectedIndices,
                foundCount: validData.length
            });

            if (validData.length === 0) {
                throw new Error("Tidak ada data valid. Pastikan variabel yang dipilih memiliki nilai pada semua baris.");
            }

            const normalizeCategory = (value: unknown) => String(value).trim();
            const compareCategory = (a: string, b: string) => {
                const aNum = Number(a);
                const bNum = Number(b);
                const aIsNum = Number.isFinite(aNum);
                const bIsNum = Number.isFinite(bNum);
                if (aIsNum && bIsNum) return aNum - bNum;
                return a.localeCompare(b, undefined, { numeric: true });
            };
            // SPSS-like factor handling: indicator (dummy) coding with one reference level omitted.
            const encodedFactorColumns = factorVars.flatMap((factorVar) => {
                const idx = factorVar.columnIndex;
                const categories = Array.from(
                    new Set(validData.map((row: any[]) => normalizeCategory(row[idx])))
                ).sort(compareCategory);

                if (categories.length <= 1) {
                    return [] as Array<{ name: string; values: number[] }>;
                }

                const referenceCategory = categories[categories.length - 1];
                const nonReferenceCategories = categories.filter((cat) => cat !== referenceCategory);

                return nonReferenceCategories.map((category) => {
                    return {
                        name: `${factorVar.name}=${category}`,
                        values: validData.map((row: any[]) =>
                            normalizeCategory(row[idx]) === category ? 1.0 : 0.0
                        ),
                    };
                });
            });

            const covariateColumns = covariateIndices.map((idx, covIdx) => {
                const name = covariateVars[covIdx]?.name ?? `X${covIdx + 1}`;
                const values = validData.map((row: any[], rowIdx) => {
                    const rawVal = row[idx];
                    const val = parseFloat(String(rawVal));
                    if (Number.isNaN(val)) {
                        throw new Error(`Variabel covariate '${name}' mengandung nilai non-numerik '${rawVal}' pada baris ${validRowIndices[rowIdx] + 1}.`);
                    }
                    return val;
                });
                return { name, values };
            });

            const allPredictorColumns = [...covariateColumns, ...encodedFactorColumns];

            // SPSS-like behavior: internally recode dependent categories (including strings)
            // into numeric IDs required by the WASM layer.
            const dependentCategories = Array.from(
                new Set(validData.map((row: any[]) => normalizeCategory(row[dependentIndex])))
            ).sort(compareCategory);

            if (dependentCategories.length < 2) {
                throw new Error("Variabel dependen harus memiliki minimal 2 kategori unik.");
            }

            const dependentValueToCode = new Map<string, number>();
            dependentCategories.forEach((category, idx) => {
                dependentValueToCode.set(category, idx + 1);
            });

            const dependentCodeToValue = new Map<number, string>();
            dependentValueToCode.forEach((code, value) => {
                dependentCodeToValue.set(code, value);
            });

            const encodedDependent = validData.map((row: any[]) => {
                const normalized = normalizeCategory(row[dependentIndex]);
                const encoded = dependentValueToCode.get(normalized);
                if (encoded === undefined) {
                    throw new Error(`Kategori dependen tidak dikenali: ${normalized}`);
                }
                return encoded;
            });

            const formattedData = {
                dependent: encodedDependent,
                independent: allPredictorColumns.map((col) => col.values),
                weights: validWeights,
                variableNames: allPredictorColumns.map((col) => col.name),
            };

            console.log("[Multinomial UI] Formatted data sample:", {
                dependent: formattedData.dependent.slice(0, 5),
                independentCount: formattedData.independent.length,
                independent0Sample: formattedData.independent[0]?.slice(0, 5),
                independent1Sample: formattedData.independent[1]?.slice(0, 5)
            });

            const worker = new Worker(`/workers/Regression/multinomialLogistic.worker.js?cb=${Date.now()}`, { type: 'module' });

            const encodedReferenceCategory = (() => {
                const encodedCategories = dependentCategories
                    .map((cat) => dependentValueToCode.get(cat))
                    .filter((value): value is number => value !== undefined)
                    .sort((a, b) => a - b);

                if (encodedCategories.length === 0) return undefined;
                if (options.referenceCategory === "first") return encodedCategories[0];
                if (options.referenceCategory === "last") return encodedCategories[encodedCategories.length - 1];

                const normalizedCustom = normalizeCategory(options.referenceCategory);
                const customEncoded = dependentValueToCode.get(normalizedCustom);
                if (customEncoded !== undefined) return customEncoded;

                const parsedCustom = Number(options.referenceCategory);
                if (Number.isFinite(parsedCustom) && encodedCategories.includes(parsedCustom)) {
                    return parsedCustom;
                }

                return encodedCategories[encodedCategories.length - 1];
            })();

            const workerOptions = {
                subpopulationMode: options.statistics.subpopulationMode,
                subpopulationColumns: (() => {
                    if (options.statistics.subpopulationMode !== "variableList") {
                        return undefined;
                    }

                    const selectedVariables = new Set(options.statistics.subpopulationVariables);
                    if (selectedVariables.size === 0) {
                        return undefined;
                    }

                    return allPredictorColumns
                        .map((col, idx) => ({ col, idx }))
                        .filter(({ col }) => {
                            if (selectedVariables.has(col.name)) return true;
                            return factorVars.some(
                                (factor) =>
                                    selectedVariables.has(factor.name) &&
                                    col.name.startsWith(`${factor.name}=`)
                            );
                        })
                        .map(({ idx }) => idx);
                })(),
                subpopulationVariables: options.statistics.subpopulationVariables,
                referenceCategory: ["first", "last"].includes(options.referenceCategory)
                    ? options.referenceCategory
                    : String(encodedReferenceCategory ?? "last"),
                confidenceInterval: options.statistics.confidenceInterval / 100,
                iterations: options.criteria.iterations,
                tolerance: options.criteria.pconverge,
                pconverge: options.criteria.pconverge,
                lconverge: options.criteria.lconverge,
                singularity: options.criteria.singularity,
                delta: options.criteria.delta,
                dispersionScale: options.advanced.dispersionScale,
                dispersionValue: options.advanced.dispersionValue,
                stepwiseEntryProbability: options.advanced.entryProbability,
                stepwiseEntryTest: options.advanced.entryTest,
                stepwiseRemovalProbability: options.advanced.removalProbability,
                stepwiseRemovalTest: options.advanced.removalTest,
                minimumSteppedEffects: options.advanced.minimumSteppedEffects,
                maximumSteppedEffects: options.advanced.maximumSteppedEffects,
                constrainHierarchy: options.advanced.constrainHierarchy,
                hierarchyMode: options.advanced.hierarchyMode,
                includeIntercept: true
            };

            const savePredictedVariables = async (result: any) => {
                if (
                    !options.save.estimatedResponseProbabilities &&
                    !options.save.predictedCategory &&
                    !options.save.predictedCategoryProbability &&
                    !options.save.actualCategoryProbability
                ) {
                    return;
                }

                const coefficients = Array.isArray(result?.coefficients) ? result.coefficients : [];
                if (coefficients.length === 0) {
                    return;
                }

                const referenceCategoryIndex = (() => {
                    if (dependentCategories.length === 0) return 0;
                    if (options.referenceCategory === "first") return 0;
                    if (options.referenceCategory === "last") return dependentCategories.length - 1;

                    const normalizedCustom = normalizeCategory(options.referenceCategory);
                    const customEncoded = dependentValueToCode.get(normalizedCustom);
                    if (customEncoded !== undefined) {
                        return Math.max(customEncoded - 1, 0);
                    }

                    const parsedCustom = Number(options.referenceCategory);
                    if (Number.isFinite(parsedCustom) && parsedCustom >= 1 && parsedCustom <= dependentCategories.length) {
                        return parsedCustom - 1;
                    }

                    return dependentCategories.length - 1;
                })();

                const buildFeatures = (rowIndex: number) => [
                    1,
                    ...allPredictorColumns.map((col) => {
                        const rawValue = Number(col.values[rowIndex]);
                        return Number.isFinite(rawValue) ? rawValue : 0;
                    }),
                ];

                const predictProbabilities = (rowIndex: number) => {
                    const features = buildFeatures(rowIndex);
                    const logits = new Array(dependentCategories.length).fill(0);
                    let coefficientRow = 0;
                    let maxLogit = 0;

                    for (let categoryIndex = 0; categoryIndex < dependentCategories.length; categoryIndex += 1) {
                        if (categoryIndex === referenceCategoryIndex) {
                            logits[categoryIndex] = 0;
                            continue;
                        }

                        const row = coefficients[coefficientRow] ?? [];
                        let logit = 0;
                        for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
                            logit += (Number(row[featureIndex]) || 0) * features[featureIndex];
                        }

                        logits[categoryIndex] = logit;
                        if (logit > maxLogit) {
                            maxLogit = logit;
                        }
                        coefficientRow += 1;
                    }

                    const expValues = logits.map((logit) => Math.exp(logit - maxLogit));
                    const sumExp = expValues.reduce((sum, value) => sum + value, 0) || 1;
                    return expValues.map((value) => value / sumExp);
                };

                const predictedProbabilitiesByRow = validData.map((_, rowIndex) => predictProbabilities(rowIndex));
                const predictedCategoryIndicesByRow = predictedProbabilitiesByRow.map((probabilities) =>
                    probabilities.reduce(
                        (bestIndex, value, currentIndex, array) => (value > array[bestIndex] ? currentIndex : bestIndex),
                        0
                    )
                );
                const predictedCategoryProbabilitiesByRow = predictedProbabilitiesByRow.map(
                    (probabilities, rowIndex) => probabilities[predictedCategoryIndicesByRow[rowIndex]] ?? 0
                );
                const actualCategoryProbabilitiesByRow = validData.map((row, rowIndex) => {
                    const actualCategory = normalizeCategory(row[dependentIndex]);
                    const actualIndex = dependentCategories.findIndex((category) => category === actualCategory);
                    return actualIndex >= 0 ? (predictedProbabilitiesByRow[rowIndex]?.[actualIndex] ?? 0) : 0;
                });
                const variableDefinitions: Partial<Variable>[] = [];
                const cellUpdates: Array<{ row: number; col: number; value: string | number }> = [];
                const variableStore = useVariableStore.getState();
                let nextColumnIndex = variableStore.variables.reduce(
                    (max, variable) => Math.max(max, variable.columnIndex),
                    -1
                ) + 1;

                if (options.save.estimatedResponseProbabilities) {
                    const probabilityStartColumn = nextColumnIndex;

                    dependentCategories.forEach((categoryValue, categoryIndex) => {
                        variableDefinitions.push({
                            columnIndex: nextColumnIndex,
                            name: `PRE_${categoryIndex + 1}`,
                            type: "NUMERIC",
                            width: 8,
                            decimals: 6,
                            label: `Predicted probability for ${categoryValue}`,
                            values: [],
                            missing: null,
                            columns: 200,
                            align: "right",
                            measure: "scale",
                            role: "none",
                        });
                        nextColumnIndex += 1;
                    });

                    predictedProbabilitiesByRow.forEach((probabilities, validRowIndex) => {
                        probabilities.forEach((probability, categoryIndex) => {
                            cellUpdates.push({
                                row: validRowIndices[validRowIndex],
                                col: probabilityStartColumn + categoryIndex,
                                value: Number.isFinite(probability) ? probability : 0,
                            });
                        });
                    });
                }

                if (options.save.predictedCategoryProbability) {
                    const predictedCategoryProbabilityColumn = nextColumnIndex;
                    variableDefinitions.push({
                        columnIndex: predictedCategoryProbabilityColumn,
                        name: "PREDP_1",
                        type: "NUMERIC",
                        width: 8,
                        decimals: 6,
                        label: "Predicted category probability",
                        values: [],
                        missing: null,
                        columns: 200,
                        align: "right",
                        measure: "scale",
                        role: "none",
                    });
                    nextColumnIndex += 1;

                    predictedCategoryProbabilitiesByRow.forEach((probability, validRowIndex) => {
                        cellUpdates.push({
                            row: validRowIndices[validRowIndex],
                            col: predictedCategoryProbabilityColumn,
                            value: Number.isFinite(probability) ? probability : 0,
                        });
                    });
                }

                if (options.save.predictedCategory) {
                    const predictedCategoryColumn = nextColumnIndex;
                    variableDefinitions.push({
                        columnIndex: predictedCategoryColumn,
                        name: "PRO_1",
                        type: "STRING",
                        width: 50,
                        decimals: 0,
                        label: "Predicted category",
                        values: [],
                        missing: null,
                        columns: 200,
                        align: "left",
                        measure: "nominal",
                        role: "none",
                    });

                    predictedProbabilitiesByRow.forEach((probabilities, validRowIndex) => {
                        const predictedIndex = probabilities.reduce(
                            (bestIndex, value, currentIndex, array) => (
                                value > array[bestIndex] ? currentIndex : bestIndex
                            ),
                            0
                        );

                        cellUpdates.push({
                            row: validRowIndices[validRowIndex],
                            col: predictedCategoryColumn,
                            value: dependentCategories[predictedIndex] ?? "",
                        });
                    });
                    nextColumnIndex += 1;
                }

                if (options.save.actualCategoryProbability) {
                    const actualCategoryProbabilityColumn = nextColumnIndex;
                    variableDefinitions.push({
                        columnIndex: actualCategoryProbabilityColumn,
                        name: "ACTP_1",
                        type: "NUMERIC",
                        width: 8,
                        decimals: 6,
                        label: "Actual category probability",
                        values: [],
                        missing: null,
                        columns: 200,
                        align: "right",
                        measure: "scale",
                        role: "none",
                    });
                    nextColumnIndex += 1;

                    actualCategoryProbabilitiesByRow.forEach((probability, validRowIndex) => {
                        cellUpdates.push({
                            row: validRowIndices[validRowIndex],
                            col: actualCategoryProbabilityColumn,
                            value: Number.isFinite(probability) ? probability : 0,
                        });
                    });
                }

                if (variableDefinitions.length > 0) {
                    await variableStore.addVariables(variableDefinitions, cellUpdates);
                }
            };

            console.log("[Multinomial UI] Worker options:", workerOptions);

            // ═══════════════════════════════════════════════════════════
            // 📊 PERFORMANCE LOGGER – Multinomial Logistic Regression
            // Mengukur 5 indikator: preprocessing, WASM wait, post-proc,
            // total pipeline, dan responsiveness (frame timing)
            // ═══════════════════════════════════════════════════════════
            const _perfMark = (name: string) => {
                try { performance.mark(`mnl:${name}`); } catch { /* ignore */ }
            };
            const _perfMeasure = (label: string, from: string, to: string): number => {
                try {
                    const entry = performance.measure(`mnl:${label}`, `mnl:${from}`, `mnl:${to}`);
                    return entry.duration;
                } catch { return 0; }
            };

            // Catat titik: data selesai disiapkan, Worker akan diluncurkan
            _perfMark("worker-start");
            const _uiInteractionStart = performance.now();

            const _dataShape = {
                rows: formattedData.dependent.length,
                predictors: formattedData.independent.length,
                categories: dependentCategories.length,
            };

            console.group(
                `%c[Multinomial Logistic] 🚀 Analisis dimulai`,
                "color:#6ee7b7;font-weight:bold;font-size:13px"
            );
            console.table({
                "📦 Baris data": _dataShape.rows,
                "📊 Prediktor": _dataShape.predictors,
                "🏷 Kategori dependen": _dataShape.categories,
            });
            console.groupEnd();

            worker.postMessage({
                data: formattedData,
                options: workerOptions
            });

            worker.onmessage = (e) => {
                const { type, payload, error, timing } = e.data;

                // ─── ⏱ Ukur waktu komputasi WASM (Worker phase) ───────
                _perfMark("worker-end");
                const workerRoundTripMs = _perfMeasure("worker-round-trip", "worker-start", "worker-end");
                const _postProcStart = performance.now();

                // ─── Log responsiveness: apakah frame di-drop? ───────
                const _frameCheck = () => {
                    if (typeof requestAnimationFrame === "undefined") return;
                    const rafStart = performance.now();
                    requestAnimationFrame(() => {
                        const frameMs = performance.now() - rafStart;
                        console.log(`[Multinomial] Responsiveness: frame setelah analisis = ${frameMs.toFixed(1)} ms`);
                    });
                };

                console.group("[Multinomial Logistic] Laporan Performa");

                // ─── Tabel 1: PERFORMANCE (waktu komputasi) ──────────
                console.log("PERFORMANCE — Waktu Komputasi");
                console.table({
                    "Worker round-trip (UI->Worker->UI)": `${workerRoundTripMs.toFixed(1)} ms`,
                    "WASM init (cold start)": timing?.wasmInitMs != null ? `${Number(timing.wasmInitMs).toFixed(1)} ms` : "ter-cache",
                    "WASM computation murni": timing?.analysisMs != null ? `${Number(timing.analysisMs).toFixed(1)} ms` : "-",
                    "Total dalam Worker": timing?.totalMs != null ? `${Number(timing.totalMs).toFixed(1)} ms` : "-",
                });

                // ─── Tabel 2: Data yang diproses ─────────────────────
                console.log("DATA — Ukuran Data");
                console.table({
                    "Baris": timing?.dataRows ?? _dataShape.rows,
                    "Prediktor": timing?.independentCount ?? _dataShape.predictors,
                    "Kategori dependen": _dataShape.categories,
                    "Waktu eksekusi": timing?.timestamp ?? new Date().toISOString(),
                });

                console.log("[Multinomial UI] Worker response:", { type, hasPayload: !!payload, error });

                if (type === "SUCCESS") {
                    (async () => {
                        try {
                            const result = typeof payload === "string" ? JSON.parse(payload) : payload;
                            console.log("[Multinomial UI] Parsed result:", result);
                            console.log("[Multinomial UI] Result keys:", Object.keys(result));

                            await savePredictedVariables(result);

                            // DEBUG: Check new fields
                            console.log("[Multinomial UI] NEW FIELDS CHECK:", {
                                hasClassificationTable: !!result?.classificationTable,
                                classificationTable: result?.classificationTable,
                                hasGoodnessOfFit: !!result?.goodnessOfFit,
                                goodnessOfFit: result?.goodnessOfFit,
                                hasLikelihoodRatioTests: !!result?.likelihoodRatioTests,
                                likelihoodRatioTests: result?.likelihoodRatioTests,
                                hasCIs: !!(result?.ciLower && result?.ciUpper),
                            });

                            console.log("[Multinomial UI] Result structure:", {
                                logLikelihood: result?.logLikelihood,
                                chiSquare: result?.chiSquare,
                                df: result?.df,
                                pValueModel: result?.pValueModel,
                                pseudoRSquare: result?.pseudoRSquare,
                                coefficients: result?.coefficients,
                                stdErrors: result?.stdErrors,
                                waldStats: result?.waldStats,
                                pValues: result?.pValues,
                                expBeta: result?.expBeta
                            });

                            const weightSyntax = weightVariable?.name
                                ? `\n/WEIGHT=${weightVariable.name}`
                                : "";
                            const logMessage = `NOMREG ${options.dependent!.name}
/METHOD=ENTER ${[...options.factors, ...options.covariates].map(v => v.name).join(" ")}
/CRITERIA=ITERATE(${options.criteria.iterations}) PCONVERGE(${options.criteria.pconverge}) LCONVERGE(${options.criteria.lconverge})${weightSyntax}`;

                            console.log("[Multinomial UI] Creating log entry...");
                            const logId = await addLog({ log: logMessage });
                            console.log("[Multinomial UI] Log ID:", logId);

                            const analyticId = await addAnalytic(logId, {
                                title: "Multinomial Logistic Regression",
                                note: "",
                            });
                            console.log("[Multinomial UI] Analytic ID:", analyticId);

                            const coeffs: number[][] = result?.coefficients || [];
                            const stdErrors: number[][] = result?.stdErrors || [];
                            const waldStats: number[][] = result?.waldStats || [];
                            const pValues: number[][] = result?.pValues || [];
                            const expBeta: number[][] = result?.expBeta || [];
                            const expCiLower: number[][] = result?.expCiLower || [];
                            const expCiUpper: number[][] = result?.expCiUpper || [];
                            const asymptoticCovariance: number[][] = result?.asymptoticCovariance || [];
                            const asymptoticCorrelation: number[][] = result?.asymptoticCorrelation || [];
                            const weightedSampleSize = validWeights.reduce(
                                (sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0),
                                0
                            );
                            const sampleSize = weightVariable ? weightedSampleSize : validData.length;
                            const validCases = validData.length;
                            const totalCases = analysisBaseRows.length;
                            const missingCases = totalCases - validCases;

                            console.log("[Multinomial UI] Extracted data:", {
                                coeffsLength: coeffs.length,
                                stdErrorsLength: stdErrors.length,
                                waldStatsLength: waldStats.length,
                                pValuesLength: pValues.length,
                                expBetaLength: expBeta.length,
                                hasExpCIs: expCiLower.length > 0
                            });

                            const nParams = coeffs[0]?.length ?? 0;
                            const usedParamNames = ["Intercept", ...allPredictorColumns.map((col) => col.name)].slice(0, nParams);
                            const kParams = coeffs.reduce((sum, row) => sum + row.length, 0);
                            const finalNeg2LL = result?.logLikelihood !== undefined ? (-2 * result.logLikelihood) : NaN;

                            // SPSS-style grouped multinomial likelihood constant:
                            // C = 2 * Σ_g [ lnΓ(n_g + 1) - Σ_j lnΓ(y_gj + 1) ]
                            // where g = predictor pattern, y_gj = weighted count for category j.
                            const logGamma = (z: number): number => {
                                if (!Number.isFinite(z) || z <= 0) return NaN;
                                const p = [
                                    676.5203681218851,
                                    -1259.1392167224028,
                                    771.32342877765313,
                                    -176.61502916214059,
                                    12.507343278686905,
                                    -0.13857109526572012,
                                    9.9843695780195716e-6,
                                    1.5056327351493116e-7,
                                ];
                                const g = 7;

                                if (z < 0.5) {
                                    const reflected = Math.PI / (Math.sin(Math.PI * z) * Math.exp(logGamma(1 - z)));
                                    return Math.log(reflected);
                                }

                                let x = 0.99999999999980993;
                                const zm1 = z - 1;
                                for (let i = 0; i < p.length; i += 1) {
                                    x += p[i] / (zm1 + i + 1);
                                }

                                const t = zm1 + g + 0.5;
                                return 0.5 * Math.log(2 * Math.PI) + (zm1 + 0.5) * Math.log(t) - t + Math.log(x);
                            };
                            let groupedNeg2LLCorrection = 0;

                            const formatSpssNumber = (value: number | undefined, digits = 3) => {
                                if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
                                    return ".";
                                }
                                const fixed = value.toFixed(digits);
                                if (fixed.startsWith("-0.")) {
                                    return `-${fixed.slice(2)}`;
                                }
                                if (fixed.startsWith("0.")) {
                                    return fixed.slice(1);
                                }
                                return fixed;
                            };

                            const formatCategoryValue = (value: number | string | undefined) => {
                                if (value === undefined || value === null) return "";
                                if (typeof value === "number") {
                                    if (!Number.isFinite(value)) return "";
                                    return Number.isInteger(value) ? String(value) : value.toString();
                                }
                                return String(value);
                            };

                            const findValueLabel = (variable: Variable, rawValue: number | string | undefined) => {
                                if (rawValue === undefined || rawValue === null || !Array.isArray(variable.values)) {
                                    return null;
                                }

                                const rawStr = String(rawValue).trim();
                                const rawNum = Number(rawValue);
                                const hasRawNum = Number.isFinite(rawNum);

                                const matched = variable.values.find((item) => {
                                    const itemStr = String(item.value).trim();
                                    if (itemStr === rawStr) return true;

                                    const itemNum = Number(item.value);
                                    return hasRawNum && Number.isFinite(itemNum) && itemNum === rawNum;
                                });

                                return matched?.label ?? null;
                            };

                            const formatCategoryWithLabel = (variable: Variable, rawValue: number | string | undefined) => {
                                const valueText = formatCategoryValue(rawValue);
                                const valueLabel = findValueLabel(variable, rawValue);
                                return valueLabel && valueLabel.trim() !== "" ? valueLabel : valueText;
                            };

                            const dependentCategoryMap = Array.from(
                                new Set(
                                    formattedData.dependent
                                        .map((val: any) => Number(val))
                                        .filter((val: number) => Number.isFinite(val))
                                )
                            ).sort((a, b) => a - b);

                            groupedNeg2LLCorrection = (() => {
                                try {
                                    if (validData.length === 0 || dependentCategoryMap.length === 0) return 0;

                                    const categoryToIndex = new Map<number, number>();
                                    dependentCategoryMap.forEach((cat, idx) => {
                                        categoryToIndex.set(Number(cat), idx);
                                    });

                                    const grouped = new Map<string, number[]>();
                                    for (let rowIdx = 0; rowIdx < validData.length; rowIdx += 1) {
                                        const key = allPredictorColumns
                                            .map((col) => String(col.values[rowIdx]))
                                            .join("\u0001");

                                        if (!grouped.has(key)) {
                                            grouped.set(key, new Array(dependentCategoryMap.length).fill(0));
                                        }

                                        const category = Number(formattedData.dependent[rowIdx]);
                                        const catIdx = categoryToIndex.get(category);
                                        if (catIdx === undefined) continue;

                                        const weight = Number.isFinite(validWeights[rowIdx]) && validWeights[rowIdx] > 0
                                            ? validWeights[rowIdx]
                                            : 0;
                                        grouped.get(key)![catIdx] += weight;
                                    }

                                    let correction = 0;
                                    grouped.forEach((counts) => {
                                        const nGroup = counts.reduce((sum, c) => sum + c, 0);
                                        if (!(nGroup > 0)) return;

                                        const lgN = logGamma(nGroup + 1);
                                        if (!Number.isFinite(lgN)) return;

                                        const lgParts = counts.reduce((sum, c) => {
                                            if (!(c > 0)) return sum;
                                            const lg = logGamma(c + 1);
                                            return Number.isFinite(lg) ? sum + lg : sum;
                                        }, 0);

                                        correction += 2 * (lgN - lgParts);
                                    });

                                    return Number.isFinite(correction) && correction > 0 ? correction : 0;
                                } catch {
                                    return 0;
                                }
                            })();

                            const decodeDependentCategory = (encodedValue: number | string | undefined) => {
                                if (encodedValue === undefined || encodedValue === null) return undefined;
                                const asNumber = Number(encodedValue);
                                if (!Number.isFinite(asNumber)) return String(encodedValue);
                                return dependentCodeToValue.get(asNumber) ?? String(encodedValue);
                            };

                            const formatDependentCategory = (encodedValue: number | string | undefined) => {
                                const rawValue = decodeDependentCategory(encodedValue);
                                return formatCategoryWithLabel(dependentVar, rawValue);
                            };

                            const referenceCategoryValue = (() => {
                                if (dependentCategoryMap.length === 0) return undefined;
                                if (options.referenceCategory === "first") return dependentCategoryMap[0];
                                if (options.referenceCategory === "last") return dependentCategoryMap[dependentCategoryMap.length - 1];

                                const normalizedCustom = normalizeCategory(options.referenceCategory);
                                const customEncoded = dependentValueToCode.get(normalizedCustom);
                                if (customEncoded !== undefined && dependentCategoryMap.includes(customEncoded)) {
                                    return customEncoded;
                                }

                                const parsed = Number(options.referenceCategory);
                                return Number.isFinite(parsed) && dependentCategoryMap.includes(parsed)
                                    ? parsed
                                    : dependentCategoryMap[dependentCategoryMap.length - 1];
                            })();

                            const nonReferenceCategories = dependentCategoryMap.filter(
                                (cat) => cat !== referenceCategoryValue
                            );

                            const referenceCategoryIndex = (() => {
                                if (dependentCategoryMap.length === 0) return 0;
                                if (options.referenceCategory === "first") return 0;
                                if (options.referenceCategory === "last") return dependentCategoryMap.length - 1;

                                const normalizedCustom = normalizeCategory(options.referenceCategory);
                                const customEncoded = dependentValueToCode.get(normalizedCustom);
                                if (customEncoded !== undefined && dependentCategoryMap.includes(customEncoded)) {
                                    return dependentCategoryMap.indexOf(customEncoded);
                                }

                                const parsed = Number(options.referenceCategory);
                                return Number.isFinite(parsed) && dependentCategoryMap.includes(parsed)
                                    ? dependentCategoryMap.indexOf(parsed)
                                    : dependentCategoryMap.length - 1;
                            })();

                            const predictRowProbabilities = (rowIndex: number) => {
                                const features = [
                                    1,
                                    ...allPredictorColumns.map((col) => {
                                        const rawValue = Number(col.values[rowIndex]);
                                        return Number.isFinite(rawValue) ? rawValue : 0;
                                    }),
                                ];

                                const logits = new Array(dependentCategoryMap.length).fill(0);
                                let coefficientRow = 0;
                                let maxLogit = 0;

                                for (let categoryIndex = 0; categoryIndex < dependentCategoryMap.length; categoryIndex += 1) {
                                    if (categoryIndex === referenceCategoryIndex) {
                                        logits[categoryIndex] = 0;
                                        continue;
                                    }

                                    const row = coeffs[coefficientRow] ?? [];
                                    let logit = 0;
                                    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
                                        logit += (Number(row[featureIndex]) || 0) * features[featureIndex];
                                    }

                                    logits[categoryIndex] = logit;
                                    if (logit > maxLogit) {
                                        maxLogit = logit;
                                    }
                                    coefficientRow += 1;
                                }

                                const expValues = logits.map((logit) => Math.exp(logit - maxLogit));
                                const sumExp = expValues.reduce((sum, value) => sum + value, 0) || 1;
                                return expValues.map((value) => value / sumExp);
                            };

                            const formatPValue = (p: number | undefined) => {
                                if (p === undefined || Number.isNaN(p)) return "";
                                if (p < 0.001) return "< .001";
                                return formatSpssNumber(p, 3);
                            };

                            const formatFixed = (value: number | undefined, digits = 3) => {
                                if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
                                    return "";
                                }
                                return value.toFixed(digits);
                            };

                            const formatExpValueForDisplay = (value: number | undefined) => formatSpssNumber(value, 3);

                            // Construct list of display predictors including redundant factor categories
                            interface DisplayPredictor {
                                label: string;
                                isRedundant: boolean;
                                pIdx?: number;
                            }

                            const displayPredictors: DisplayPredictor[] = [];
                            // 1. Intercept
                            displayPredictors.push({
                                label: "Intercept",
                                isRedundant: false,
                                pIdx: 0,
                            });

                            // 2. Covariates
                            let nextPIdx = 1;
                            covariateVars.forEach((cov) => {
                                displayPredictors.push({
                                    label: cov.name,
                                    isRedundant: false,
                                    pIdx: nextPIdx,
                                });
                                nextPIdx += 1;
                            });

                            // 3. Factors
                            factorVars.forEach((factorVar) => {
                                const idx = factorVar.columnIndex;
                                const categories = Array.from(
                                    new Set(validData.map((row: any[]) => normalizeCategory(row[idx])))
                                ).sort(compareCategory);

                                if (categories.length <= 1) {
                                    return;
                                }

                                const referenceCategory = categories[categories.length - 1];
                                const nonReferenceCategoriesFactor = categories.filter((cat) => cat !== referenceCategory);

                                nonReferenceCategoriesFactor.forEach((category) => {
                                    displayPredictors.push({
                                        label: `[${factorVar.name}=${formatCategoryWithLabel(factorVar, category)}]`,
                                        isRedundant: false,
                                        pIdx: nextPIdx,
                                    });
                                    nextPIdx += 1;
                                });

                                displayPredictors.push({
                                    label: `[${factorVar.name}=${formatCategoryWithLabel(factorVar, referenceCategory)}]`,
                                    isRedundant: true,
                                });
                            });

                            // Parameter table with Exp(B) confidence intervals including redundant factor categories
                            const parameterRows = nonReferenceCategories.flatMap((depCategory, catIdx) =>
                                displayPredictors.map((pred) => {
                                    if (pred.isRedundant) {
                                        return {
                                            rowHeader: [
                                                formatDependentCategory(depCategory),
                                                pred.label,
                                            ],
                                            "B": ".000<sup>b</sup>",
                                            "Std. Error": ".",
                                            "Wald": ".",
                                            "df": ".",
                                            "Sig.": ".",
                                            "Exp(B)": ".",
                                            "Lower Bound": ".",
                                            "Upper Bound": ".",
                                        };
                                    } else {
                                        const pIdx = pred.pIdx!;
                                        return {
                                            rowHeader: [
                                                formatDependentCategory(depCategory),
                                                pred.label,
                                            ],
                                            "B": formatSpssNumber(coeffs[catIdx]?.[pIdx]),
                                            "Std. Error": formatSpssNumber(stdErrors[catIdx]?.[pIdx]),
                                            "Wald": formatSpssNumber(waldStats[catIdx]?.[pIdx]),
                                            "df": "1",
                                            "Sig.": (() => {
                                                const p = pValues[catIdx]?.[pIdx];
                                                return p !== undefined ? formatPValue(p) : "";
                                            })(),
                                            "Exp(B)": formatExpValueForDisplay(expBeta[catIdx]?.[pIdx]),
                                            "Lower Bound": formatSpssNumber(expCiLower[catIdx]?.[pIdx]),
                                            "Upper Bound": formatSpssNumber(expCiUpper[catIdx]?.[pIdx]),
                                        };
                                    }
                                })
                            );

                            const nullNeg2LL = result?.nullLogLikelihood !== undefined
                                ? (-2 * result.nullLogLikelihood)
                                : NaN;
                            const displayFinalNeg2LL = Number.isFinite(finalNeg2LL)
                                ? Math.max(finalNeg2LL - groupedNeg2LLCorrection, 0)
                                : NaN;
                            const displayNullNeg2LL = Number.isFinite(nullNeg2LL)
                                ? Math.max(nullNeg2LL - groupedNeg2LLCorrection, 0)
                                : NaN;
                            const interceptOnlyParams = Math.max((dependentCategoryMap.length || 1) - 1, 1);

                            const modelFittingTable = {
                                title: "Model Fitting Information",
                                columnHeaders: [
                                    { header: "Model" },
                                    { header: "AIC" },
                                    { header: "BIC" },
                                    { header: "-2 Log Likelihood" },
                                    { header: "Chi-Square" },
                                    { header: "df" },
                                    { header: "Sig." },
                                ],
                                rows: [
                                    {
                                        rowHeader: ["Intercept Only"],
                                        "AIC": Number.isFinite(displayNullNeg2LL) ? (displayNullNeg2LL + 2 * interceptOnlyParams).toFixed(3) : "",
                                        "BIC": Number.isFinite(displayNullNeg2LL) && sampleSize > 0
                                            ? (displayNullNeg2LL + Math.log(sampleSize) * interceptOnlyParams).toFixed(3)
                                            : "",
                                        "-2 Log Likelihood": Number.isFinite(displayNullNeg2LL) ? displayNullNeg2LL.toFixed(3) : "",
                                        "Chi-Square": "",
                                        "df": "",
                                        "Sig.": "",
                                    },
                                    {
                                        rowHeader: ["Final"],
                                        "AIC": Number.isFinite(displayFinalNeg2LL) ? (displayFinalNeg2LL + 2 * kParams).toFixed(3) : "",
                                        "BIC": Number.isFinite(displayFinalNeg2LL) && sampleSize > 0
                                            ? (displayFinalNeg2LL + Math.log(sampleSize) * kParams).toFixed(3)
                                            : "",
                                        "-2 Log Likelihood": Number.isFinite(displayFinalNeg2LL) ? displayFinalNeg2LL.toFixed(3) : "",
                                        "Chi-Square": (result?.chiSquare?.toFixed(3) ?? ""),
                                        "df": (result?.df ?? ""),
                                        "Sig.": formatPValue(result?.pValueModel),
                                    },
                                ],
                            };

                            const categoricalEntries = [
                                { label: dependentVar.name, index: dependentIndex, variable: dependentVar },
                                ...factorVars.map((factor) => ({ label: factor.name, index: factor.columnIndex, variable: factor })),
                            ];

                            const isWeightedAnalysis = !!weightVariable;
                            const validBaseN = isWeightedAnalysis
                                ? validWeights.reduce((sum, weight) => sum + (Number.isFinite(weight) && weight > 0 ? weight : 0), 0)
                                : validCases;
                            const totalBaseN = isWeightedAnalysis
                                ? analysisBaseRows.reduce(
                                    (sum, item) => sum + (Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 0),
                                    0
                                )
                                : totalCases;
                            const missingBaseN = Math.max(totalBaseN - validBaseN, 0);

                            const formatCaseN = (value: number) => {
                                if (!Number.isFinite(value)) return "0";
                                if (Math.abs(value - Math.round(value)) < 1e-9) {
                                    return String(Math.round(value));
                                }
                                return value.toFixed(3);
                            };

                            const categoryBreakdownRows = categoricalEntries.flatMap((entry) => {
                                const freq = validData.reduce((acc, row, rowIdx) => {
                                    const raw = row[entry.index];
                                    const key = String(raw);
                                    const increment = isWeightedAnalysis
                                        ? (Number.isFinite(validWeights[rowIdx]) && validWeights[rowIdx] > 0 ? validWeights[rowIdx] : 0)
                                        : 1;
                                    acc[key] = (acc[key] || 0) + increment;
                                    return acc;
                                }, {} as Record<string, number>);

                                return Object.entries(freq)
                                    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
                                    .map(([category, count]) => ({
                                        rowHeader: [entry.label, formatCategoryWithLabel(entry.variable, category)],
                                        N: formatCaseN(count),
                                        Percent: validBaseN > 0 ? `${((count / validBaseN) * 100).toFixed(1)}%` : "0.0%",
                                        n: formatCaseN(count),
                                        percent: validBaseN > 0 ? `${((count / validBaseN) * 100).toFixed(1)}%` : "0.0%",
                                    }));
                            });

                            const caseProcessingRows = [
                                ...categoryBreakdownRows,
                                {
                                    rowHeader: ["Overall", "Valid"],
                                    N: formatCaseN(validBaseN),
                                    Percent: totalBaseN > 0 ? `${((validBaseN / totalBaseN) * 100).toFixed(1)}%` : "0.0%",
                                    n: formatCaseN(validBaseN),
                                    percent: totalBaseN > 0 ? `${((validBaseN / totalBaseN) * 100).toFixed(1)}%` : "0.0%",
                                },
                                {
                                    rowHeader: ["Overall", "Missing"],
                                    N: formatCaseN(missingBaseN),
                                    Percent: totalBaseN > 0 ? `${((missingBaseN / totalBaseN) * 100).toFixed(1)}%` : "0.0%",
                                    n: formatCaseN(missingBaseN),
                                    percent: totalBaseN > 0 ? `${((missingBaseN / totalBaseN) * 100).toFixed(1)}%` : "0.0%",
                                },
                                {
                                    rowHeader: ["Overall", "Total"],
                                    N: formatCaseN(totalBaseN),
                                    Percent: "100.0%",
                                    n: formatCaseN(totalBaseN),
                                    percent: "100.0%",
                                },
                                {
                                    rowHeader: ["Overall", "Subpopulation"],
                                    N: result?.goodnessOfFit?.subpopulationsCount !== undefined 
                                        ? String(result.goodnessOfFit.subpopulationsCount)
                                        : formatCaseN(validBaseN),
                                    Percent: "",
                                    n: result?.goodnessOfFit?.subpopulationsCount !== undefined 
                                        ? String(result.goodnessOfFit.subpopulationsCount)
                                        : formatCaseN(validBaseN),
                                    percent: "",
                                },
                            ];

                            if (categoryBreakdownRows.length === 0) {
                                caseProcessingRows.push({
                                    rowHeader: [dependentVar.name, "(no categories found)"],
                                    N: "0",
                                    Percent: "0.0%",
                                    n: "0",
                                    percent: "0.0%",
                                });
                            }

                            const caseProcessingTable = {
                                title: "Case Processing Summary",
                                columnHeaders: [
                                    { header: "N" },
                                    { header: "Percent" },
                                ],
                                rows: caseProcessingRows,
                            };

                            const stepwiseTrace: Array<{
                                step?: number;
                                action?: string;
                                effect?: string;
                                test?: string;
                                chiSquare?: number;
                                pValue?: number;
                                selectedEffects?: string[];
                            }> = Array.isArray(result?.stepwiseTrace) ? result.stepwiseTrace : [];

                            const stepSummaryTable = stepwiseTrace.length > 0
                                ? {
                                    title: "Step Summary",
                                    columnHeaders: [
                                        { header: "Step" },
                                        { header: "Action" },
                                        { header: "Effect" },
                                        { header: "Test" },
                                        { header: "Chi-Square" },
                                        { header: "Sig." },
                                        { header: "Selected Effects" },
                                    ],
                                    rows: stepwiseTrace.map((entry: any) => ({
                                        rowHeader: [String(entry.step ?? "")],
                                        Step: String(entry.step ?? ""),
                                        Action: entry.action ?? "",
                                        Effect: entry.effect ?? "",
                                        Test: entry.test ?? "",
                                        "Chi-Square": Number.isFinite(entry.chiSquare) ? formatSpssNumber(entry.chiSquare, 3) : "",
                                        "Sig.": Number.isFinite(entry.pValue) ? formatSpssNumber(entry.pValue, 3) : "",
                                        "Selected Effects": Array.isArray(entry.selectedEffects) ? entry.selectedEffects.join(", ") : "",
                                    })),
                                }
                                : {
                                    title: "Model Information",
                                    columnHeaders: [
                                        { header: "" },
                                        { header: "Value" },
                                    ],
                                    rows: [
                                        {
                                            rowHeader: ["Iterations"],
                                            "Value": String(result?.iterations ?? ""),
                                        },
                                        {
                                            rowHeader: ["Converged"],
                                            "Value": result?.converged ? "Yes" : "No",
                                        },
                                        {
                                            rowHeader: ["Weight Variable"],
                                            "Value": weightVariable?.name || "(None)",
                                        },
                                        {
                                            rowHeader: ["Effective N (Model)"],
                                            "Value": Number.isFinite(sampleSize) ? sampleSize.toFixed(3) : "",
                                        },
                                        {
                                            rowHeader: ["Final -2 Log Likelihood"],
                                            "Value": Number.isFinite(displayFinalNeg2LL) ? displayFinalNeg2LL.toFixed(3) : "",
                                        },
                                    ],
                                };

                            const pseudoRSquareTable = {
                                title: "Pseudo R-Square",
                                columnHeaders: [
                                    { header: "" },
                                    { header: "Value" },
                                ],
                                rows: [
                                    { rowHeader: ["Cox & Snell"], "Value": (result?.pseudoRSquare?.coxSnell?.toFixed(3) ?? "") },
                                    { rowHeader: ["Nagelkerke"], "Value": (result?.pseudoRSquare?.nagelkerke?.toFixed(3) ?? "") },
                                    { rowHeader: ["McFadden"], "Value": (result?.pseudoRSquare?.mcfadden?.toFixed(3) ?? "") },
                                ],
                            };

                            const parameterEstimatesTable = {
                                title: "Parameter Estimates",
                                columnHeaders: [
                                    { header: "Category", key: "row_header_col_1" },
                                    { header: "", key: "row_header_col_2" },
                                    { header: "B", key: "B" },
                                    { header: "Std. Error", key: "Std. Error" },
                                    { header: "Wald", key: "Wald" },
                                    { header: "df", key: "df" },
                                    { header: "Sig.", key: "Sig." },
                                    { header: "Exp(B)", key: "Exp(B)" },
                                    {
                                        header: `${options.statistics.confidenceInterval}% Confidence Interval for Exp(B)`,
                                        children: [
                                            { header: "Lower Bound", key: "Lower Bound" },
                                            { header: "Upper Bound", key: "Upper Bound" },
                                        ],
                                    },
                                ],
                                rows: parameterRows,
                                footer: [
                                    `a. The reference category is: ${formatDependentCategory(referenceCategoryValue)}.`,
                                    "b. This parameter is set to zero because it is redundant.",
                                ],
                            };

                            // NEW: Classification Table
                            const classificationTable = result?.classificationTable ? {
                                title: "Classification Table",
                                columnHeaders: [
                                    { header: "Observed" },
                                    ...Array.from(
                                        { length: result.classificationTable.confusionMatrix.length },
                                        (_, i) => ({ header: `Predicted ${formatDependentCategory(dependentCategoryMap[i])}` })
                                    ),
                                    { header: "Percent Correct" },
                                ],
                                rows: (() => {
                                    const matrix = result.classificationTable.confusionMatrix;
                                    const nCols = matrix.length;
                                    const totalN = matrix.reduce(
                                        (sumRow: number, row: number[]) =>
                                            sumRow + row.reduce((sumCell: number, val: number) => sumCell + val, 0),
                                        0
                                    );

                                    const predictedOverallPct = Array.from({ length: nCols }, (_, predIdx) => {
                                        const colTotal = matrix.reduce(
                                            (sum: number, row: number[]) => sum + (row[predIdx] ?? 0),
                                            0
                                        );
                                        return totalN > 0 ? `${((colTotal / totalN) * 100).toFixed(1)}%` : "0.0%";
                                    });

                                    const bodyRows = matrix.map((row: number[], idx: number) => ({
                                        rowHeader: [formatDependentCategory(dependentCategoryMap[idx])],
                                        ...row.reduce((acc, val, predIdx) => {
                                            acc[`Predicted ${formatDependentCategory(dependentCategoryMap[predIdx])}`] = String(val);
                                            return acc;
                                        }, {} as Record<string, string>),
                                        "Percent Correct": `${result.classificationTable.categoryPercentages[idx].toFixed(1)}%`,
                                    }));

                                    const overallRow = {
                                        rowHeader: ["Overall Percentage"],
                                        ...predictedOverallPct.reduce((acc, val, i) => {
                                            acc[`Predicted ${formatDependentCategory(dependentCategoryMap[i])}`] = val;
                                            return acc;
                                        }, {} as Record<string, string>),
                                        "Percent Correct": `${result.classificationTable.overallPercentage.toFixed(1)}%`,
                                    };

                                    return bodyRows.concat([overallRow]);
                                })(),
                            } : null;

                            const cellProbabilitiesTable = (() => {
                                if (validData.length === 0 || dependentCategories.length === 0) return null;

                                // Jika data tidak di-weight (raw data), tampilkan pesan bahwa cell probabilities tidak didukung untuk raw data
                                if (!isWeightedAnalysis) {
                                    return {
                                        title: "Observed and Predicted Frequencies",
                                        columnHeaders: [],
                                        rows: [{ rowHeader: [""] }],
                                        footer: "Cell probabilities is not supported for raw data.",
                                    };
                                }

                                const allPredictors = [...factorVars, ...covariateVars];
                                const subpopVars = options.statistics.subpopulationMode === 'variableList' && options.statistics.subpopulationVariables && options.statistics.subpopulationVariables.length > 0
                                    ? options.statistics.subpopulationVariables.map((vName: string) => {
                                        return allPredictors.find((p) => p.name === vName || (p as any).id === vName) || { name: vName, columnIndex: -1 } as any;
                                    })
                                    : allPredictors;

                                const columnHeaders = [
                                    ...subpopVars.map((v) => ({ header: v.name })),
                                    { header: dependentVar.name },
                                    {
                                        header: "Frequency",
                                        children: [
                                            { header: "Observed", key: "observed" },
                                            { header: "Predicted", key: "predicted" },
                                            { header: "Pearson Residual", key: "pearsonResidual" },
                                        ],
                                    },
                                    {
                                        header: "Percentage",
                                        children: [
                                            { header: "Observed", key: "obsPercentage" },
                                            { header: "Predicted", key: "predPercentage" },
                                        ],
                                    },
                                ];

                                // Group rows by subpopulation defined by subpopVars
                                interface SubpopData {
                                    rawValues: any[];
                                    totalWeight: number;
                                    observedCounts: number[];
                                    expectedCounts: number[];
                                }

                                const subpopMap = new Map<string, SubpopData>();
                                const subpopOrder: string[] = [];

                                for (let rowIdx = 0; rowIdx < validData.length; rowIdx += 1) {
                                    const row = validData[rowIdx];
                                    const rawVals = subpopVars.map((v) => row[v.columnIndex]);
                                    const subpopKey = rawVals.map((val) => normalizeCategory(val)).join("\u0001");

                                    const probs = predictRowProbabilities(rowIdx);
                                    const actualCategory = normalizeCategory(row[dependentIndex]);
                                    const catIdx = dependentCategories.findIndex((c) => c === actualCategory);
                                    const weight = Number.isFinite(validWeights[rowIdx]) && validWeights[rowIdx] > 0
                                        ? validWeights[rowIdx]
                                        : 1;

                                    if (!subpopMap.has(subpopKey)) {
                                        subpopOrder.push(subpopKey);
                                        subpopMap.set(subpopKey, {
                                            rawValues: rawVals,
                                            totalWeight: 0,
                                            observedCounts: new Array(dependentCategories.length).fill(0),
                                            expectedCounts: new Array(dependentCategories.length).fill(0),
                                        });
                                    }

                                    const entry = subpopMap.get(subpopKey)!;
                                    entry.totalWeight += weight;
                                    if (catIdx >= 0) {
                                        entry.observedCounts[catIdx] += weight;
                                    }
                                    probs.forEach((p, j) => {
                                        entry.expectedCounts[j] += weight * p;
                                    });
                                }

                                // Sort subpopulations deterministically by raw predictor values
                                const sortedSubpopKeys = [...subpopOrder].sort((keyA, keyB) => {
                                    const entryA = subpopMap.get(keyA)!;
                                    const entryB = subpopMap.get(keyB)!;
                                    for (let k = 0; k < entryA.rawValues.length; k += 1) {
                                        const strA = normalizeCategory(entryA.rawValues[k]);
                                        const strB = normalizeCategory(entryB.rawValues[k]);
                                        const cmp = compareCategory(strA, strB);
                                        if (cmp !== 0) return cmp;
                                    }
                                    return 0;
                                });

                                const rows: any[] = [];
                                sortedSubpopKeys.forEach((key) => {
                                    const entry = subpopMap.get(key)!;
                                    const predHeaderLabels = subpopVars.map((v, pIdx) =>
                                        formatCategoryWithLabel(v, entry.rawValues[pIdx])
                                    );

                                    dependentCategories.forEach((catVal, j) => {
                                        const depCatLabel = formatCategoryWithLabel(dependentVar, catVal);
                                        const rowHeader = [...predHeaderLabels, depCatLabel];

                                        const obsCount = entry.observedCounts[j];
                                        const expCount = entry.expectedCounts[j];
                                        const predProb = entry.totalWeight > 0 ? expCount / entry.totalWeight : 0;
                                        const variance = expCount * (1 - predProb);
                                        const residual = variance > 1e-10
                                            ? (obsCount - expCount) / Math.sqrt(variance)
                                            : 0;

                                        const obsPct = entry.totalWeight > 0
                                            ? (obsCount / entry.totalWeight) * 100
                                            : 0;
                                        const predPct = entry.totalWeight > 0
                                            ? (expCount / entry.totalWeight) * 100
                                            : 0;

                                        const formattedObserved = Math.abs(obsCount - Math.round(obsCount)) < 1e-9
                                            ? String(Math.round(obsCount))
                                            : formatSpssNumber(obsCount, 3);

                                        const formattedPredicted = formatSpssNumber(expCount, 3);
                                        const formattedResidual = formatSpssNumber(residual, 3);
                                        const formattedObsPct = `${obsPct.toFixed(1)}%`;
                                        const formattedPredPct = `${predPct.toFixed(1)}%`;

                                        rows.push({
                                            rowHeader,
                                            observed: formattedObserved,
                                            predicted: formattedPredicted,
                                            pearsonResidual: formattedResidual,
                                            obsPercentage: formattedObsPct,
                                            predPercentage: formattedPredPct,
                                        });
                                    });
                                });

                                return {
                                    title: "Observed and Predicted Frequencies",
                                    columnHeaders,
                                    rows,
                                    footer: "The percentages are based on total observed frequencies in each subpopulation.",
                                };
                            })();

                            // NEW: Goodness-of-Fit Tests
                            const goodnessOfFitTable = result?.goodnessOfFit ? {
                                title: "Goodness-of-Fit Tests",
                                columnHeaders: [
                                    { header: "" },
                                    { header: "Chi-Square" },
                                    { header: "df" },
                                    { header: "Sig." },
                                ],
                                rows: [
                                    {
                                        rowHeader: ["Pearson"],
                                        "Chi-Square": result.goodnessOfFit.pearsonChiSquare.toFixed(3),
                                        "df": String(result.goodnessOfFit.pearsonDf),
                                        "Sig.": result.goodnessOfFit.pearsonPValue < 0.001 ? "< .001" : result.goodnessOfFit.pearsonPValue.toFixed(3),
                                    },
                                    {
                                        rowHeader: ["Deviance"],
                                        "Chi-Square": result.goodnessOfFit.deviance.toFixed(3),
                                        "df": String(result.goodnessOfFit.devianceDf),
                                        "Sig.": result.goodnessOfFit.deviancePValue < 0.001 ? "< .001" : result.goodnessOfFit.deviancePValue.toFixed(3),
                                    },
                                ],
                            } : null;

                            // NEW: Likelihood Ratio Tests
                            const likelihoodRatioTable = result?.likelihoodRatioTests && result.likelihoodRatioTests.length > 0 ? {
                                title: "Likelihood Ratio Tests",
                                columnHeaders: [
                                    { header: "Effect", key: "row_header_col_1" },
                                    {
                                        header: "Model Fit",
                                        children: [
                                            { header: "AIC", key: "AIC" },
                                            { header: "BIC", key: "BIC" },
                                            { header: "-2LL", key: "-2LL" },
                                        ],
                                    },
                                    {
                                        header: "LR Test",
                                        children: [
                                            { header: "Chi2", key: "Chi2" },
                                            { header: "df", key: "df" },
                                            { header: "Sig.", key: "Sig." },
                                        ],
                                    },
                                ],
                                rows: result.likelihoodRatioTests.map((test: any) => {
                                    const adjustedNeg2 = Number.isFinite(test.neg2LogLikelihoodReduced)
                                        ? Math.max(test.neg2LogLikelihoodReduced - groupedNeg2LLCorrection, 0)
                                        : test.neg2LogLikelihoodReduced;
                                    const adjustedAic = Number.isFinite(test.aicReduced)
                                        ? test.aicReduced - groupedNeg2LLCorrection
                                        : test.aicReduced;
                                    const adjustedBic = Number.isFinite(test.bicReduced)
                                        ? test.bicReduced - groupedNeg2LLCorrection
                                        : test.bicReduced;

                                    return {
                                        rowHeader: [test.effect],
                                        "AIC": formatSpssNumber(adjustedAic),
                                        "BIC": formatSpssNumber(adjustedBic),
                                        "-2LL": test.equivalentToFinal
                                            ? `${formatSpssNumber(adjustedNeg2)}<sup>a</sup>`
                                            : formatSpssNumber(adjustedNeg2),
                                        "Chi2": formatSpssNumber(test.chiSquare),
                                        "df": String(test.df),
                                        "Sig.": Number.isFinite(test.pValue) ? formatPValue(test.pValue) : ".",
                                    };
                                }),
                                footer: [
                                    "Chi2 = difference in -2LL between final and reduced model.",
                                    "a. Reduced model equals final model (no df increase).",
                                ],
                            } : null;

                            const monotonicityTable = result?.classificationTable?.observed && result?.classificationTable?.predicted
                                ? (() => {
                                    const observed = result.classificationTable.observed as number[];
                                    const predicted = result.classificationTable.predicted as number[];
                                    const n = observed.length;
                                    if (n === 0) {
                                        return null;
                                    }

                                    const meanObserved = observed.reduce((s, v) => s + v, 0) / n;
                                    const meanPredicted = predicted.reduce((s, v) => s + v, 0) / n;
                                    const covariance = observed.reduce(
                                        (s, v, i) => s + (v - meanObserved) * (predicted[i] - meanPredicted),
                                        0,
                                    );
                                    const varObserved = observed.reduce((s, v) => s + (v - meanObserved) ** 2, 0);
                                    const varPredicted = predicted.reduce((s, v) => s + (v - meanPredicted) ** 2, 0);
                                    const rho = varObserved > 0 && varPredicted > 0
                                        ? covariance / Math.sqrt(varObserved * varPredicted)
                                        : 0;

                                    return {
                                        title: "Monotonicity Measures",
                                        columnHeaders: [
                                            { header: "Measure" },
                                            { header: "Value" },
                                        ],
                                        rows: [
                                            { rowHeader: ["Spearman rho (Observed vs Predicted)"], "Value": rho.toFixed(4) },
                                            { rowHeader: ["N"], "Value": String(n) },
                                        ],
                                    };
                                })()
                                : null;

                            const parameterDisplayNames = usedParamNames.map((name, idx) =>
                                name?.includes("=") ? `[${name}]` : (name ?? `Param ${idx + 1}`)
                            );

                            const matrixColumnKeys = nonReferenceCategories.flatMap((cat) =>
                                parameterDisplayNames.map((paramName) => `${formatDependentCategory(cat)}||${paramName}`)
                            );

                            const matrixColumnGroups = nonReferenceCategories.map((cat) => ({
                                header: formatDependentCategory(cat),
                                children: parameterDisplayNames.map((paramName) => ({
                                    header: paramName,
                                    key: `${formatDependentCategory(cat)}||${paramName}`,
                                })),
                            }));

                            const buildAsymptoticRows = (matrix: number[][]) => {
                                const paramsPerCategory = parameterDisplayNames.length;
                                return matrix.map((row: number[], rowIdx: number) => {
                                    const catIdx = paramsPerCategory > 0 ? Math.floor(rowIdx / paramsPerCategory) : 0;
                                    const paramIdx = paramsPerCategory > 0 ? rowIdx % paramsPerCategory : rowIdx;
                                    return {
                                        rowHeader: [
                                            formatDependentCategory(nonReferenceCategories[catIdx]),
                                            parameterDisplayNames[paramIdx] ?? `Param ${paramIdx + 1}`,
                                        ],
                                        ...matrixColumnKeys.reduce((acc, colKey, colIdx) => {
                                            const val = row[colIdx];
                                            acc[colKey] = Number.isFinite(val) ? val.toFixed(4) : "";
                                            return acc;
                                        }, {} as Record<string, string>),
                                    };
                                });
                            };

                            const asymptoticCovariancesTable = asymptoticCovariance.length > 0 ? {
                                title: "Asymptotic Covariance Matrix<sup>a</sup>",
                                columnHeaders: [
                                    { header: "", key: "row_header_col_1" },
                                    { header: "", key: "row_header_col_2" },
                                    {
                                        header: dependentVar.name,
                                        children: matrixColumnGroups,
                                    },
                                ],
                                rows: buildAsymptoticRows(asymptoticCovariance),
                                footer: [
                                    "a. There is no overdispersion adjustment.",
                                    `b. The reference category is: ${formatDependentCategory(referenceCategoryValue)}.`,
                                ],
                            } : null;

                            const asymptoticCorrelationsTable = asymptoticCorrelation.length > 0 ? {
                                title: "Asymptotic Correlation Matrix",
                                columnHeaders: [
                                    { header: "", key: "row_header_col_1" },
                                    { header: "", key: "row_header_col_2" },
                                    {
                                        header: dependentVar.name,
                                        children: matrixColumnGroups,
                                    },
                                ],
                                rows: buildAsymptoticRows(asymptoticCorrelation),
                                footer: `The reference category is: ${formatDependentCategory(referenceCategoryValue)}.`,
                            } : null;

                            console.log("[Multinomial UI] Creating statistics with tables:", {
                                caseProcessingTable,
                                stepSummaryTable,
                                modelFitting: modelFittingTable,
                                pseudoRSquare: pseudoRSquareTable,
                                cellProbabilitiesTable,
                                parameterEstimates: parameterEstimatesTable,
                                classificationTable,
                                goodnessOfFit: goodnessOfFitTable,
                                likelihoodRatio: likelihoodRatioTable,
                                monotonicityTable,
                                asymptoticCovariancesTable,
                                asymptoticCorrelationsTable,
                            });

                            // DEBUG: Check what will be saved
                            console.log("[Multinomial UI] Statistics to save:", {
                                caseProcessing: options.statistics.caseProcessing,
                                stepSummary: options.statistics.stepSummary,
                                modelFitting: options.statistics.modelFitting,
                                informationCriteria: options.statistics.informationCriteria,
                                pseudoRSquare: options.statistics.pseudoRSquare,
                                cellProbabilities: options.statistics.cellProbabilities,
                                parameterEstimates: options.statistics.parameterEstimates,
                                classificationTable: options.statistics.classificationTable,
                                goodnessOfFit: options.statistics.goodnessOfFit,
                                likelihoodRatioTests: options.statistics.likelihoodRatioTests,
                                monotonicityMeasures: options.statistics.monotonicityMeasures,
                                asymptoticCovariances: options.statistics.asymptoticCovariances,
                                asymptoticCorrelations: options.statistics.asymptoticCorrelations,
                            });

                            console.log("[Multinomial UI] Tables availability:", {
                                hasCellProbabilities: !!cellProbabilitiesTable,
                                hasClassificationTable: !!classificationTable,
                                hasGoodnessOfFit: !!goodnessOfFitTable,
                                hasLikelihoodRatio: !!likelihoodRatioTable,
                                hasMonotonicity: !!monotonicityTable,
                                hasAsymptoticCovariances: !!asymptoticCovariancesTable,
                                hasAsymptoticCorrelations: !!asymptoticCorrelationsTable,
                            });

                            if (options.statistics.caseProcessing) {
                                const caseProcessingDescription = generateCaseProcessingDescription(
                                    validBaseN,
                                    missingBaseN,
                                    totalBaseN,
                                    isWeightedAnalysis
                                );
                                await addStatistic(analyticId, {
                                    title: "Case Processing Summary",
                                    description: caseProcessingDescription,
                                    output_data: JSON.stringify({ tables: [caseProcessingTable] }),
                                    components: "Case Processing Summary",
                                });
                                console.log("[Multinomial UI] Case Processing statistic added");
                            }

                            if (options.statistics.stepSummary) {
                                const stepSummaryDescription = generateStepSummaryDescription(
                                    result?.iterations ?? options.criteria.iterations,
                                    result?.converged ?? true
                                );
                                const tableTitle = stepwiseTrace.length > 0 ? "Step Summary" : "Model Information";
                                await addStatistic(analyticId, {
                                    title: tableTitle,
                                    description: stepSummaryDescription,
                                    output_data: JSON.stringify({ tables: [stepSummaryTable] }),
                                    components: tableTitle,
                                });
                                console.log(`[Multinomial UI] ${tableTitle} statistic added`);
                            }

                            const saveMergedModelFitting = options.statistics.modelFitting || options.statistics.informationCriteria;
                            if (saveMergedModelFitting) {
                                const modelFittingDescription = generateModelFittingDescription(
                                    displayNullNeg2LL,
                                    displayFinalNeg2LL,
                                    result?.chiSquare ?? 0,
                                    result?.pValueModel ?? 1,
                                    result?.df ?? 0
                                );
                                await addStatistic(analyticId, {
                                    title: "Model Fitting Information",
                                    description: modelFittingDescription,
                                    output_data: JSON.stringify({ tables: [modelFittingTable] }),
                                    components: "Model Fitting Information",
                                });
                                console.log("[Multinomial UI] Model Fitting statistic added");
                            }

                            // Save Pseudo R-Square (if enabled)
                            if (options.statistics.pseudoRSquare) {
                                const coxSnell = result?.pseudoRSquare?.coxSnell ?? 0;
                                const nagelkerke = result?.pseudoRSquare?.nagelkerke ?? 0;
                                const mcFadden = result?.pseudoRSquare?.mcfadden ?? result?.pseudoRSquare?.mcFadden ?? 0;
                                const pseudoRSquareDescription = generatePseudoRSquareDescription(
                                    coxSnell,
                                    nagelkerke,
                                    mcFadden
                                );
                                await addStatistic(analyticId, {
                                    title: "Pseudo R-Square",
                                    description: pseudoRSquareDescription,
                                    output_data: JSON.stringify({ tables: [pseudoRSquareTable] }),
                                    components: "Pseudo R-Square",
                                });
                                console.log("[Multinomial UI] Pseudo R-Square statistic added");
                            }

                            // Save Parameter Estimates (if enabled)
                            if (options.statistics.parameterEstimates) {
                                const refCatLabel = formatDependentCategory(referenceCategoryValue);
                                const totalEstimatedParams = coeffs.reduce((sum, row) => sum + row.length, 0);
                                const sigParams: string[] = [];
                                let sigCount = 0;

                                nonReferenceCategories.forEach((depCategory, catIdx) => {
                                    const depCatLabel = formatDependentCategory(depCategory);
                                    displayPredictors.forEach((pred) => {
                                        if (!pred.isRedundant && pred.pIdx !== undefined) {
                                            const p = pValues[catIdx]?.[pred.pIdx];
                                            if (p !== undefined && p < 0.05) {
                                                sigCount += 1;
                                                sigParams.push(`${pred.label} (${depCatLabel} vs ${refCatLabel})`);
                                            }
                                        }
                                    });
                                });

                                const parameterEstimatesDescription = generateParameterEstimatesDescription(
                                    allPredictorColumns.length,
                                    dependentCategoryMap.length,
                                    sigCount,
                                    totalEstimatedParams,
                                    refCatLabel,
                                    sigParams
                                );
                                await addStatistic(analyticId, {
                                    title: "Parameter Estimates",
                                    description: parameterEstimatesDescription,
                                    output_data: JSON.stringify({ tables: [parameterEstimatesTable] }),
                                    components: "Parameter Estimates",
                                });
                                console.log("[Multinomial UI] Parameter Estimates statistic added");
                            }

                            if (options.statistics.cellProbabilities && cellProbabilitiesTable) {
                                const formattedCatNames = dependentCategoryMap.map((cat) => formatDependentCategory(cat));
                                const cellProbabilitiesDescription = generateCellProbabilitiesDescription(
                                    validData.length,
                                    dependentCategoryMap.length,
                                    formattedCatNames
                                );
                                await addStatistic(analyticId, {
                                    title: "Observed and Predicted Frequencies",
                                    description: cellProbabilitiesDescription,
                                    output_data: JSON.stringify({ tables: [cellProbabilitiesTable] }),
                                    components: "Observed and Predicted Frequencies",
                                });
                                console.log("[Multinomial UI] Observed and Predicted Frequencies statistic added");
                            }

                            // NEW: Save Classification Table (if enabled)
                            if (options.statistics.classificationTable && classificationTable) {
                                const overallPercentage = result?.classificationTable?.overallPercentage ?? result?.classificationTable?.overallAccuracy ?? 0;
                                const categoryPercentages = result?.classificationTable?.categoryPercentages ?? result?.classificationTable?.categoryAccuracies ?? [];
                                const formattedCatNames = dependentCategoryMap.map((cat) => formatDependentCategory(cat));
                                const classificationDescription = generateClassificationDescription(
                                    overallPercentage,
                                    categoryPercentages,
                                    formattedCatNames
                                );
                                await addStatistic(analyticId, {
                                    title: "Classification Table",
                                    description: classificationDescription,
                                    output_data: JSON.stringify({ tables: [classificationTable] }),
                                    components: "Classification Table",
                                });
                                console.log("[Multinomial UI] Classification Table statistic added");
                            }

                            // NEW: Save Goodness-of-Fit Tests (if enabled)
                            if (options.statistics.goodnessOfFit && goodnessOfFitTable) {
                                const pearsonChiSquare = result?.goodnessOfFit?.pearsonChiSquare ?? result?.goodnessOfFit?.pearsonChi2 ?? 0;
                                const pearsonDf = result?.goodnessOfFit?.pearsonDf ?? 0;
                                const pearsonPValue = result?.goodnessOfFit?.pearsonPValue ?? result?.goodnessOfFit?.pearsonP ?? 1;
                                const deviance = result?.goodnessOfFit?.deviance ?? result?.goodnessOfFit?.devianceChi2 ?? 0;
                                const devianceDf = result?.goodnessOfFit?.devianceDf ?? 0;
                                const deviancePValue = result?.goodnessOfFit?.deviancePValue ?? result?.goodnessOfFit?.devianceP ?? 1;

                                const goodnessOfFitDescription = generateGoodnessOfFitDescription(
                                    pearsonChiSquare,
                                    pearsonDf,
                                    pearsonPValue,
                                    deviance,
                                    devianceDf,
                                    deviancePValue
                                );
                                await addStatistic(analyticId, {
                                    title: "Goodness-of-Fit Tests",
                                    description: goodnessOfFitDescription,
                                    output_data: JSON.stringify({ tables: [goodnessOfFitTable] }),
                                    components: "Goodness-of-Fit",
                                });
                                console.log("[Multinomial UI] Goodness-of-Fit statistic added");
                            }

                            // NEW: Save Likelihood Ratio Tests (if enabled)
                            if (options.statistics.likelihoodRatioTests && likelihoodRatioTable) {
                                const lrTestsData: any[] = result?.likelihoodRatioTests ?? [];
                                const sigLRNames: string[] = [];
                                lrTestsData.forEach((test) => {
                                    const p = test.pValue ?? test.p;
                                    if (p !== undefined && p < 0.05) {
                                        sigLRNames.push(test.effect);
                                    }
                                });

                                const likelihoodRatioDescription = generateLikelihoodRatioDescription(
                                    lrTestsData.length,
                                    sigLRNames.length,
                                    result?.pValueModel ?? 1,
                                    sigLRNames
                                );
                                await addStatistic(analyticId, {
                                    title: "Likelihood Ratio Tests",
                                    description: likelihoodRatioDescription,
                                    output_data: JSON.stringify({ tables: [likelihoodRatioTable] }),
                                    components: "Likelihood Ratio Tests",
                                });
                                console.log("[Multinomial UI] Likelihood Ratio Tests statistic added");
                            }

                            if (options.statistics.monotonicityMeasures && monotonicityTable) {
                                const observed = result?.classificationTable?.observed as number[] | undefined;
                                const predicted = result?.classificationTable?.predicted as number[] | undefined;
                                let rho = 0;
                                if (observed && predicted && observed.length > 0) {
                                    const n = observed.length;
                                    const meanObserved = observed.reduce((s: number, v: number) => s + v, 0) / n;
                                    const meanPredicted = predicted.reduce((s: number, v: number) => s + v, 0) / n;
                                    const covariance = observed.reduce(
                                        (s: number, v: number, i: number) => s + (v - meanObserved) * (predicted[i] - meanPredicted),
                                        0
                                    );
                                    const varObserved = observed.reduce((s: number, v: number) => s + (v - meanObserved) ** 2, 0);
                                    const varPredicted = predicted.reduce((s: number, v: number) => s + (v - meanPredicted) ** 2, 0);
                                    if (varObserved > 0 && varPredicted > 0) {
                                        rho = covariance / Math.sqrt(varObserved * varPredicted);
                                    }
                                }

                                const monotonicityDescription = generateMonotonicityDescription(
                                    rho,
                                    validData.length
                                );
                                await addStatistic(analyticId, {
                                    title: "Monotonicity Measures",
                                    description: monotonicityDescription,
                                    output_data: JSON.stringify({ tables: [monotonicityTable] }),
                                    components: "Monotonicity Measures",
                                });
                                console.log("[Multinomial UI] Monotonicity Measures statistic added");
                            }

                            if (options.statistics.asymptoticCovariances && asymptoticCovariancesTable) {
                                const asymptoticCovariancesDescription = generateAsymptoticCovariancesDescription(
                                    asymptoticCovariance.length
                                );
                                await addStatistic(analyticId, {
                                    title: "Asymptotic Covariances",
                                    description: asymptoticCovariancesDescription,
                                    output_data: JSON.stringify({ tables: [asymptoticCovariancesTable] }),
                                    components: "Asymptotic Covariances",
                                });
                                console.log("[Multinomial UI] Asymptotic Covariances statistic added");
                            }

                            if (options.statistics.asymptoticCorrelations && asymptoticCorrelationsTable) {
                                const asymptoticCorrelationsDescription = generateAsymptoticCorrelationsDescription(
                                    asymptoticCorrelation.length
                                );
                                await addStatistic(analyticId, {
                                    title: "Asymptotic Correlations",
                                    description: asymptoticCorrelationsDescription,
                                    output_data: JSON.stringify({ tables: [asymptoticCorrelationsTable] }),
                                    components: "Asymptotic Correlations",
                                });
                                console.log("[Multinomial UI] Asymptotic Correlations statistic added");
                            }

                            console.log("[Multinomial UI] Loading results...");
                            await loadResults();
                            console.log("[Multinomial UI] Results loaded, closing modal");

                            // ─── Ringkasan Performa Akhir ───────────────────────
                            _perfMark("postproc-end");
                            const postProcMs = performance.now() - _postProcStart;
                            const totalPipelineMs = performance.now() - _uiInteractionStart;

                            console.log("POST-PROCESSING — Rendering Hasil");
                            console.table({
                                "Post-processing (save + render)": `${postProcMs.toFixed(0)} ms`,
                                "Total pipeline end-to-end": `${totalPipelineMs.toFixed(0)} ms`,
                            });

                            // ─── Tabel 3: RESPONSIVENESS ─────────────────────
                            console.log("RESPONSIVENESS — Waktu Respon UI");
                            console.table({
                                "INP target browser": "< 200 ms",
                                "Worker di background thread": "Ya (tidak memblokir UI)",
                                "Waktu Post-processing": `${postProcMs.toFixed(0)} ms`,
                                "Waktu Total Pipeline": `${totalPipelineMs.toFixed(0)} ms`,
                            });

                            console.groupEnd();

                            // Cek responsiveness frame setelah render selesai
                            _frameCheck();

                            closeModal("MULTINOMIAL_LOGISTIC");
                            worker.terminate();
                            setIsLoading(false);
                        } catch (saveError: any) {
                            console.groupEnd(); // tutup grup [Laporan Performa] jika error
                            console.error("[Multinomial UI] Failed to save result:", saveError);
                            setErrorMsg("Gagal menyimpan hasil: " + saveError.message);
                            setIsLoading(false);
                            worker.terminate();
                        }
                    })();
                } else {
                    console.error("[Multinomial UI] Analysis Error:", error);
                    setErrorMsg(`Analysis Error: ${error || "Unknown error"}`);
                    setIsLoading(false);
                    worker.terminate();
                }
            };

            worker.onerror = (err) => {
                console.error("[Multinomial UI] Worker Execution Error:", err);
                const detail = err.message
                    ? `${err.message} (${err.filename || "unknown"}:${err.lineno || 0}:${err.colno || 0})`
                    : `${String(err)} (${err.filename || "unknown"}:${err.lineno || 0}:${err.colno || 0})`;
                setErrorMsg(`Worker Error: ${detail}`);
                setIsLoading(false);
                worker.terminate();
            };

        } catch (error: any) {
            console.error("[Multinomial UI] Exception in handleAnalyze:", error);
            setErrorMsg(error.message || String(error));
            setIsLoading(false);
        }
    };

    const resetOptions = () => {
        setErrorMsg(null);
        setOptions({
            dependent: null,
            factors: [],
            covariates: [],
            referenceCategory: "last",
            statistics: {
                caseProcessing: true,
                pseudoRSquare: true,
                stepSummary: true,
                modelFitting: true,
                informationCriteria: true,
                cellProbabilities: true,
                classificationTable: true,
                goodnessOfFit: true,
                monotonicityMeasures: false,
                parameterEstimates: true,
                likelihoodRatioTests: true,
                asymptoticCorrelations: false,
                asymptoticCovariances: false,
                confidenceInterval: 95,
                subpopulationMode: "factors",
                subpopulationVariables: [],
            },
            criteria: {
                iterations: 100,
                pconverge: 0.000001,
                lconverge: 0.0,
                singularity: 0.00000001,
                delta: 0.5,
            },
            save: {
                estimatedResponseProbabilities: false,
                predictedCategory: false,
                predictedCategoryProbability: false,
                actualCategoryProbability: false,
            },
            advanced: {
                dispersionScale: "none",
                dispersionValue: "",
                entryProbability: ".05",
                entryTest: "likelihoodRatio",
                removalProbability: ".1",
                removalTest: "likelihoodRatio",
                minimumSteppedEffects: "0",
                maximumSteppedEffects: "",
                constrainHierarchy: true,
                hierarchyMode: "treat_covariates_like_factors",
            },
        });
    };

    return (
        <div className="flex flex-col h-full bg-background">
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

            <div className="flex-grow px-6 py-3 overflow-hidden min-h-0 flex flex-col">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col min-h-0 overflow-hidden">
                    <TabsList className="grid w-full grid-cols-5 flex-shrink-0">
                        <TabsTrigger value="variables" id="multinomial-logistic-variables-tab-trigger">Variables</TabsTrigger>
                        <TabsTrigger value="statistics" id="multinomial-logistic-statistics-tab-trigger">Statistics</TabsTrigger>
                        <TabsTrigger value="criteria" id="multinomial-logistic-criteria-tab-trigger">Criteria</TabsTrigger>
                        <TabsTrigger value="options" id="multinomial-logistic-options-tab-trigger">Options</TabsTrigger>
                        <TabsTrigger value="save" id="multinomial-logistic-save-tab-trigger">Save</TabsTrigger>
                    </TabsList>

                    <div className="flex-grow min-h-0 overflow-y-auto mt-4 pr-1">
                        <TabsContent value="variables" className="h-full mt-0">
                            <VariablesTab
                                variables={variables}
                                options={options}
                                setOptions={setOptions as React.Dispatch<React.SetStateAction<any>>}
                            />
                        </TabsContent>

                        <TabsContent value="statistics" className="h-full mt-0">
                            <StatisticsTab
                                options={options.statistics}
                                onChange={(stats) => setOptions({ ...options, statistics: stats })}
                            />
                        </TabsContent>

                        <TabsContent value="criteria" className="h-full mt-0">
                            <CriteriaTab
                                options={options.criteria}
                                onChange={(crit) => setOptions({ ...options, criteria: crit })}
                            />
                        </TabsContent>

                        <TabsContent value="options" className="h-full mt-0">
                            <OptionsTab
                                referenceCategory={options.referenceCategory}
                                advanced={options.advanced}
                                onReferenceCategoryChange={(val) => setOptions({ ...options, referenceCategory: val })}
                                onAdvancedChange={(patch) => setOptions({ ...options, advanced: { ...options.advanced, ...patch } })}
                                dependentVariable={options.dependent}
                            />
                        </TabsContent>

                        <TabsContent value="save" className="h-full mt-0">
                            <SaveTab
                                options={options.save}
                                onChange={(save) => setOptions({ ...options, save: save })}
                            />
                        </TabsContent>
                    </div>
                </Tabs>

                {errorMsg && (
                    <div className="mt-4">
                        <Alert variant="destructive">
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{errorMsg}</AlertDescription>
                        </Alert>
                    </div>
                )}
            </div>

            <div className="px-6 py-3 border-t border-border flex items-center justify-between bg-secondary flex-shrink-0">
                <div className="flex items-center text-muted-foreground">
                    <div className="flex items-center gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        data-testid="multinomial-logistic-help-button"
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
                </div>

                <div className="flex items-center space-x-4">
                    <Button
                        // [EDIT: Panggil fungsi handleAnalyze di sini]
                        onClick={handleAnalyze}
                        // Tombol mati jika loading atau variabel dependen belum dipilih
                        disabled={isLoading || !options.dependent}
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
                        onClick={resetOptions} // Gunakan fungsi reset yang sudah kita buat sebelumnya
                        disabled={isLoading}
                    >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reset
                    </Button>

                    <Button
                        variant="outline"
                        onClick={() => closeModal("MULTINOMIAL_LOGISTIC")}
                        disabled={isLoading}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        </div>
    );
};