import type { KMedoidsClusterType } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import { ClusterMode, AutoKMethod, MissingValueMethod } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import type { Variable } from "@/types/Variable";
import { ClusterWorker, type ClusteringInput, type ClusteringResult, type ClusteringRangeInput, type ClusteringRangeItem, type ProgressUpdate, type ClusteringMethod, type DistanceMetric } from "../types/worker";
import { generateComprehensiveKMedoidsOutput } from "./k-medoids-cluster-comprehensive-output";
import { prepareKMedoidsSaveVariables, validateSaveData } from "./k-medoids-cluster-save";
import { useVariableStore } from "@/stores/useVariableStore";
import { toast } from "sonner";
import { PAM_HARD_MAX_ROWS } from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/constants/k-medoids-cluster-default";

type WasmModule = {
    default: (moduleOrPath?: unknown) => Promise<unknown>;
    run_k_medoids: (input: ClusteringInput) => unknown;
    run_k_medoids_range?: (input: ClusteringRangeInput) => unknown[];
    standardize_data: (input: { data: number[][]; method: string }) => { matrix: number[][] };
    calculate_wcss?: (input: {
        data: number[][];
        labels: number[];
        medoid_indices: number[];
        distance_metric: string;
    }) => { wcss: number };
};

export type KMedoidsClusterAnalysisType = {
    configData: KMedoidsClusterType;
    dataVariables: any[];
    variables: Variable[];
    allVariables?: Variable[];
    onProgress?: (progress: ProgressUpdate) => void;
    useWorker?: boolean; // Enable/disable web worker
};

type PreprocessingSummary = {
    initialN: number;
    afterPreprocessingN: number;
    missingRowsRemoved: number;
    outlierRowsRemoved: number;
    missingByVariable: Record<string, number>;
};

type MissingHandlingResult = {
    matrix: number[][];
    rows: any[];
    removedCount: number;
};

let wasmInitialized = false;
let wasmModuleCache: WasmModule | null = null;
let wasmImportPromise: Promise<WasmModule> | null = null;
let worker: ClusterWorker | null = null;
let warmupPromise: Promise<void> | null = null;

async function loadWasmModule(): Promise<WasmModule> {
    if (wasmModuleCache) {
        return wasmModuleCache;
    }

    if (!wasmImportPromise) {
        wasmImportPromise = import("@/public/workers/Clustering/K-Medoids/wasm")
            .then((mod) => mod as unknown as WasmModule);
    }

    wasmModuleCache = await wasmImportPromise;
    return wasmModuleCache;
}

function getInitializedWasmModule(): WasmModule {
    if (!wasmInitialized || !wasmModuleCache) {
        throw new Error("WASM module is not initialized");
    }
    return wasmModuleCache;
}


/** Per-feature median, computed over the finite values of each column. */
function calculateFeatureMedians(matrix: number[][], d: number): number[] {
    return Array.from({ length: d }, (_, j) => {
        const valid = matrix
            .map(row => row[j])
            .filter(v => Number.isFinite(v))
            .sort((a, b) => a - b);
        if (valid.length === 0) return 0;
        const mid = Math.floor(valid.length / 2);
        return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
    });
}

/** Impute missing entries with the median of their own feature/column. */
function imputeMedian(matrix: number[][]): number[][] {
    const d = matrix[0].length;
    const medians = calculateFeatureMedians(matrix, d);
    return matrix.map(row => row.map((v, j) => (Number.isFinite(v) ? v : medians[j])));
}

/**
 * Impute missing entries using the average of the k nearest rows (default k=5).
 * Distance between two rows is the Euclidean distance computed over the
 * features both rows have available (NaN-aware, à la scikit-learn's
 * KNNImputer), scaled up to the full feature count so rows sharing few
 * features aren't unfairly favored. Rows with no comparable neighbor for a
 * given feature fall back to that feature's median.
 */
export function imputeKnn(matrix: number[][], k: number = 5): number[][] {
    const n = matrix.length;
    const d = matrix[0].length;
    const medians = calculateFeatureMedians(matrix, d);
    const result = matrix.map(row => [...row]);

    for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) {
            if (Number.isFinite(matrix[i][j])) continue;

            const neighbors: { dist: number; value: number }[] = [];
            for (let other = 0; other < n; other++) {
                if (other === i) continue;
                const otherValue = matrix[other][j];
                if (!Number.isFinite(otherValue)) continue;

                let sumSq = 0;
                let shared = 0;
                for (let f = 0; f < d; f++) {
                    if (f === j) continue;
                    const a = matrix[i][f];
                    const b = matrix[other][f];
                    if (Number.isFinite(a) && Number.isFinite(b)) {
                        sumSq += (a - b) ** 2;
                        shared += 1;
                    }
                }
                if (shared === 0) continue;
                neighbors.push({ dist: Math.sqrt((sumSq / shared) * d), value: otherValue });
            }

            if (neighbors.length === 0) {
                result[i][j] = medians[j];
                continue;
            }

            neighbors.sort((a, b) => a.dist - b.dist);
            const nearest = neighbors.slice(0, Math.min(k, neighbors.length));
            result[i][j] = nearest.reduce((s, nb) => s + nb.value, 0) / nearest.length;
        }
    }

    return result;
}

/**
 * After imputation, `rows` still holds the original source objects — the
 * cells that were filled in only exist in the numeric `matrix`. Patch those
 * imputed values back into cloned copies of the source rows so downstream
 * consumers (output tables, saved attributes) display the filled-in value
 * instead of a blank/0 for cells that were originally missing. No-op for
 * listwise deletion, since no missing values remain in the kept rows.
 */
function patchImputedAttributes(
    rows: any[],
    matrix: number[][],
    variables: Variable[]
): any[] {
    return rows.map((sourceRow, i) => {
        const numericRow = matrix[i];
        let patched = sourceRow;
        variables.forEach((v, j) => {
            const columnIndex = v.columnIndex as number;
            const rawValue = sourceRow[columnIndex];
            const parsed = typeof rawValue === "number" ? rawValue : parseFloat(rawValue);
            if (!Number.isFinite(parsed)) {
                if (patched === sourceRow) patched = { ...sourceRow };
                patched[columnIndex] = numericRow[j];
            }
        });
        return patched;
    });
}

/**
 * Missing value handling per Options → Missing Values:
 * - Listwise: keep rows only when all selected vars are valid.
 * - Median / Knn: keep rows with at least one valid value, drop rows that are
 *   entirely missing, then impute the remaining empty cells so the matrix
 *   stays numeric.
 */
export function applyMissingHandling(
    rowsWithNumeric: Array<{ source: any; numeric: number[] }>,
    method: MissingValueMethod
): MissingHandlingResult {
    if (rowsWithNumeric.length === 0) {
        return { matrix: [], rows: [], removedCount: 0 };
    }

    if (method === MissingValueMethod.Listwise) {
        const kept = rowsWithNumeric.filter(item => item.numeric.every(v => Number.isFinite(v)));
        return {
            matrix: kept.map(item => item.numeric),
            rows: kept.map(item => item.source),
            removedCount: rowsWithNumeric.length - kept.length,
        };
    }

    // Median / Knn imputation: keep rows with at least one valid value.
    const kept = rowsWithNumeric.filter(item => item.numeric.some(v => Number.isFinite(v)));
    if (kept.length === 0) {
        return { matrix: [], rows: [], removedCount: rowsWithNumeric.length };
    }

    const rawMatrix = kept.map(item => item.numeric);
    const imputedMatrix = method === MissingValueMethod.Knn
        ? imputeKnn(rawMatrix)
        : imputeMedian(rawMatrix);

    return {
        matrix: imputedMatrix,
        rows: kept.map(item => item.source),
        removedCount: rowsWithNumeric.length - kept.length,
    };
}

type NormalizationKind = "none" | "zscore" | "minmax";

/**
 * Standardize/normalize a matrix via the WASM `standardize_data` export, so
 * the scaling formula (Z-score with sample std n-1, or Min-Max) has a single
 * implementation in Rust (`stats::normalization`) instead of being duplicated
 * in TypeScript.
 */
async function standardizeMatrixWasm(
    matrix: number[][],
    method: NormalizationKind
): Promise<number[][]> {
    if (method === "none" || matrix.length === 0) {
        return matrix;
    }

    await initializeWasm();
    const result = getInitializedWasmModule().standardize_data({ data: matrix, method });
    return result.matrix;
}

function resolveNormalizationMethod(config: any): NormalizationKind {
    const methodFromOptions = config?.options?.NormalizationMethod as NormalizationKind | undefined;
    const methodFromIterate = config?.iterate?.NormalizationMethod as NormalizationKind | undefined;

    if (methodFromOptions) return methodFromOptions;
    if (methodFromIterate) return methodFromIterate;

    const hasStandardizeFlag =
        config?.options?.Standardize !== undefined ||
        config?.iterate?.Standardize !== undefined;
    const standardizeFlag =
        config?.options?.Standardize ??
        config?.iterate?.Standardize;

    if (hasStandardizeFlag) {
        return standardizeFlag ? "zscore" : "none";
    }

    return "none";
}

/**
 * Calculate Euclidean distance between two points
 */
function euclideanDistance(p1: number[], p2: number[]): number {
    let sum = 0;
    for (let i = 0; i < p1.length; i++) {
        sum += Math.pow(p1[i] - p2[i], 2);
    }
    return Math.sqrt(sum);
}

function manhattanDistance(p1: number[], p2: number[]): number {
    let sum = 0;
    for (let i = 0; i < p1.length; i++) {
        sum += Math.abs(p1[i] - p2[i]);
    }
    return sum;
}

function normalizeDistanceMetric(metric: unknown): DistanceMetric {
    const normalized = String(metric ?? "euclidean").toLowerCase();
    if (normalized === "manhattan" || normalized === "cityblock" || normalized === "l1") {
        return "manhattan";
    }
    return "euclidean";
}

function calculateDistance(p1: number[], p2: number[], metric: DistanceMetric): number {
    return metric === "manhattan" ? manhattanDistance(p1, p2) : euclideanDistance(p1, p2);
}

/**
 * Calculate Silhouette Score for a clustering result
 * Returns average silhouette score across all points.
 * For large datasets, sub-samples up to MAX_SILHOUETTE_SAMPLE points
 * (stratified by cluster) to keep the O(n²) cost manageable.
 */
const MAX_SILHOUETTE_SAMPLE = 300;

function calculateSilhouetteScore(
    data: number[][],
    labels: number[],
    n_clusters: number,
    metric: DistanceMetric
): number {
    if (!labels || !Array.isArray(labels) || labels.length === 0) return 0;
    const n = data.length;
    if (n_clusters <= 1 || n_clusters >= n) return 0;

    // Sub-sample when dataset is large
    let sampleData = data;
    let sampleLabels = labels;
    if (n > MAX_SILHOUETTE_SAMPLE) {
        // Stratified sample: take ~equal share from each cluster
        const perCluster = Math.max(1, Math.floor(MAX_SILHOUETTE_SAMPLE / n_clusters));
        const indices: number[] = [];
        for (let c = 0; c < n_clusters; c++) {
            const clusterIdx = labels.reduce<number[]>((acc, l, i) => { if (l === c) acc.push(i); return acc; }, []);
            const step = Math.max(1, Math.floor(clusterIdx.length / perCluster));
            for (let j = 0; j < clusterIdx.length && indices.length < MAX_SILHOUETTE_SAMPLE; j += step) {
                indices.push(clusterIdx[j]);
            }
        }
        sampleData = indices.map(i => data[i]);
        sampleLabels = indices.map(i => labels[i]);
    }

    const sn = sampleData.length;

    // Group sample points by cluster
    const clusters: number[][] = Array.from({ length: n_clusters }, () => []);
    for (let i = 0; i < sn; i++) {
        clusters[sampleLabels[i]].push(i);
    }

    // Calculate silhouette for each sample point
    const silhouettes: number[] = [];

    for (let i = 0; i < sn; i++) {
        const clusterIdx = sampleLabels[i];
        const cluster = clusters[clusterIdx];

        // a(i): average distance to points in same cluster
        let a = 0;
        if (cluster.length > 1) {
            for (const j of cluster) {
                if (i !== j) {
                    a += calculateDistance(sampleData[i], sampleData[j], metric);
                }
            }
            a /= (cluster.length - 1);
        }

        // b(i): minimum average distance to points in other clusters
        let b = Infinity;
        for (let otherCluster = 0; otherCluster < n_clusters; otherCluster++) {
            if (otherCluster === clusterIdx) continue;
            const otherPoints = clusters[otherCluster];
            if (otherPoints.length === 0) continue;
            let avgDist = 0;
            for (const j of otherPoints) {
                avgDist += calculateDistance(sampleData[i], sampleData[j], metric);
            }
            avgDist /= otherPoints.length;
            b = Math.min(b, avgDist);
        }

        const s = b === Infinity ? 0 : (b - a) / Math.max(a, b);
        silhouettes.push(s);
    }

    return silhouettes.reduce((sum, s) => sum + s, 0) / sn;
}

/**
 * Prefer the WASM `calculate_wcss` export (single Rust implementation);
 * fall back to the local JS computation only for older WASM builds that
 * don't export it yet.
 */
function wcssFromWasm(
    wasmModule: WasmModule,
    matrix: number[][],
    labels: number[],
    medoidIndices: number[],
    metric: DistanceMetric
): number {
    if (typeof wasmModule.calculate_wcss === "function") {
        return wasmModule.calculate_wcss({
            data: matrix,
            labels,
            medoid_indices: medoidIndices,
            distance_metric: metric,
        }).wcss;
    }
    return calculateWCSS(matrix, labels, medoidIndices, metric);
}

/**
 * Calculate within-cluster sum of squares (WCSS) for Elbow method
 */
function calculateWCSS(
    data: number[][],
    labels: number[],
    medoidIndices: number[],
    metric: DistanceMetric
): number {
    let wcss = 0;
    for (let i = 0; i < data.length; i++) {
        const clusterIdx = labels[i];
        const medoidIdx = medoidIndices[clusterIdx];
        const dist = calculateDistance(data[i], data[medoidIdx], metric);
        wcss += metric === "manhattan" ? dist : dist ** 2;
    }
    return wcss;
}

/**
 * Find optimal k using Elbow method
 * Returns the k where the rate of decrease sharply changes
 */
function findOptimalKElbow(kValues: number[], wcssValues: number[]): number {
    if (kValues.length < 3) return kValues[0];
    
    // Calculate rate of change (second derivative approximation)
    const changes: number[] = [];
    for (let i = 1; i < wcssValues.length - 1; i++) {
        const change = Math.abs(
            (wcssValues[i + 1] - wcssValues[i]) - (wcssValues[i] - wcssValues[i - 1])
        );
        changes.push(change);
    }
    
    // Find the maximum change (the elbow point)
    let maxChangeIdx = 0;
    let maxChange = changes[0];
    for (let i = 1; i < changes.length; i++) {
        if (changes[i] > maxChange) {
            maxChange = changes[i];
            maxChangeIdx = i;
        }
    }
    
    // Return k at elbow point (add 1 because we started from index 1)
    return kValues[maxChangeIdx + 1];
}

/**
 * Initialize WASM module (direct execution mode)
 */
async function initializeWasm() {
    if (!wasmInitialized) {
        try {
            const wasmModule = await loadWasmModule();
            await wasmModule.default();
            wasmInitialized = true;
        } catch (error) {
            console.error("❌ Failed to initialize WASM module:", error);
            throw error;
        }
    }
}

/**
 * Warm up clustering runtime ahead of execution to reduce first-run latency.
 * This is intentionally idempotent and safe to call multiple times.
 */
export async function warmupKMedoidsRuntime(preferWorker: boolean = true): Promise<void> {
    if (warmupPromise) {
        return warmupPromise;
    }

    warmupPromise = (async () => {
        if (preferWorker) {
            const workerInstance = initializeWorker();
            if (workerInstance) {
                try {
                    await workerInstance.init();
                    return;
                } catch (error) {
                    console.warn("Worker warmup failed, falling back to WASM warmup", error);
                }
            }
        }

        await initializeWasm();
    })();

    try {
        await warmupPromise;
    } finally {
        warmupPromise = null;
    }
}

/**
 * Handle saving clustering variables to dataset if user selected save options
 */
async function saveClusteringVariables(
    result: ClusteringResult,
    saveConfig: KMedoidsClusterType["save"],
    k: number,
    processedDataRows: any[]
): Promise<void> {
    try {
        // Check if any save option is enabled
        const anySaveEnabled = saveConfig.ClusterMembership || saveConfig.DistanceClusterCenter;
        if (!anySaveEnabled) {
            return;
        }

        // Prepare variables
        const saveResult = prepareKMedoidsSaveVariables(
            result.labels,
            result.distances_to_medoids,
            saveConfig,
            k
        );

        // Validate
        const validation = validateSaveData(
            saveResult.variableData,
            processedDataRows.length
        );
        if (!validation.valid) {
            throw new Error(`Save validation failed: ${validation.error}`);
        }

        // Build column-aware variable definitions and cell updates for useVariableStore.addVariables.
        const existingVariables = useVariableStore.getState().variables;
        const nextColumnIndex = existingVariables.length > 0
            ? Math.max(...existingVariables.map(v => v.columnIndex)) + 1
            : 0;

        const variablesWithIndex = saveResult.variablesToCreate.map((variable, idx) => ({
            ...variable,
            columnIndex: nextColumnIndex + idx,
        }));

        const updates = variablesWithIndex.flatMap((variable) => {
            const varName = variable.name;
            const columnIndex = variable.columnIndex;
            if (!varName || columnIndex === undefined) {
                return [];
            }

            const values = saveResult.variableData[varName] ?? [];
            return values.map((value, row) => ({
                row,
                col: columnIndex,
                value,
            }));
        });

        // Add variables to store
        await useVariableStore.getState().addVariables(
            variablesWithIndex as Variable[],
            updates
        );

        // Report success
        const createdNames = saveResult.variablesToCreate.map(v => v.name).join(", ");
        toast.success(`Clustering variables saved: ${createdNames}`, {
            duration: 3000,
        });
    } catch (error) {
        console.error("❌ Failed to save clustering variables:", error);
        toast.error(
            `Failed to save clustering variables: ${error instanceof Error ? error.message : String(error)}`,
            { duration: 3000 }
        );
    }
}

/**
 * Must be awaited before navigating to the result page — the result page loads
 * its data once on mount (see ResultOutput's loadResults effect) and does not
 * re-fetch afterwards, so navigating before this settles can leave the newly
 * computed output invisible until some unrelated remount/refetch happens.
 */
async function persistComprehensiveOutput(
    analysisResult: any,
    processedDataRows: any[],
    variables: Variable[],
    caseLabelColumnIndex: number | null,
    finalMatrix?: number[][]
): Promise<void> {
    try {
        await generateComprehensiveKMedoidsOutput(
            analysisResult,
            processedDataRows,
            variables,
            caseLabelColumnIndex,
            finalMatrix
        );
    } catch (err) {
        console.error("Failed to generate comprehensive output:", err);
    }
}

/**
 * Initialize Web Worker
 * webpack 5 requires `new Worker(new URL(...))` at the *call site* to statically
 * bundle the worker as a separate chunk. We create the raw Worker here and pass
 * it to ClusterWorker so the URL pattern is visible to webpack's analyzer.
 */
function initializeWorker(): ClusterWorker | null {
    if (!worker) {
        try {
            // webpack 5 / Next.js native worker bundling.
            // Use the source worker module so URL generation stays stable across builds.
            const rawWorker = new Worker(
                new URL("./cluster-worker.ts", import.meta.url),
                { type: "module" }
            );
            worker = new ClusterWorker(rawWorker);
        } catch (error) {
            console.error("❌ Failed to initialize worker:", error);
            return null;
        }
    }
    return worker;
}

/**
 * Cleanup worker on page unload
 */
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        if (worker) {
            worker.terminate();
            worker = null;
        }
    });
}

/**
 * Map WASM output format to TypeScript ClusteringResult format
 * WASM returns: cluster_assignments, medoids_indices, total_distance
 * TypeScript expects: labels, medoids, cost
 */
export function mapWasmOutputToResult(wasmOutput: any): ClusteringResult {
    // Build iteration_history from cost_history if present
    const costHistory: number[] = wasmOutput.cost_history || [];
    const iterationHistory = costHistory.length > 0
        ? costHistory.map((cost: number, idx: number) => ({
              iteration: idx,
              cost,
          }))
        : undefined;

    // Some WASM paths omit `iterations` but still provide history.
    // Derive swap-iteration count from history shape: [init, iter1, ...].
    const explicitIterations = wasmOutput.iterations;
    const inferredIterations = costHistory.length > 0
        ? Math.max(costHistory.length - 1, 0)
        : iterationHistory && iterationHistory.length > 0
        ? Math.max(iterationHistory.length - 1, 0)
        : 0;
    const totalIterations =
        typeof explicitIterations === "number" && explicitIterations > 0
            ? explicitIterations
            : inferredIterations;

    const rawDistances = wasmOutput.distances_to_medoids;
    const distances_to_medoids: number[] | undefined =
        rawDistances instanceof Float64Array
            ? Array.from(rawDistances as Float64Array)
            : Array.isArray(rawDistances) && rawDistances.length > 0
            ? rawDistances
            : undefined;

    const labels = wasmOutput.cluster_assignments || wasmOutput.labels || [];
    const totalCost = wasmOutput.total_distance || wasmOutput.total_cost || wasmOutput.cost || 0;
    const n = Array.isArray(labels) ? labels.length : 0;
    const avgCost =
        typeof wasmOutput.avg_cost === "number"
            ? wasmOutput.avg_cost
            : typeof wasmOutput.avgCost === "number"
            ? wasmOutput.avgCost
            : n > 0
            ? totalCost / n
            : 0;

    return {
        labels,
        medoids: wasmOutput.medoids_indices || wasmOutput.medoid_indices || wasmOutput.medoids || [],
        cost: totalCost,
        avgCost,
        total_cost_build:
            wasmOutput.total_cost_build ??
            (Array.isArray(costHistory) && costHistory.length > 0 ? costHistory[0] : undefined),
        total_cost_swap:
            wasmOutput.total_cost_swap ??
            (Array.isArray(costHistory) && costHistory.length > 0 ? costHistory[costHistory.length - 1] : undefined),
        iterations: totalIterations,
        converged: wasmOutput.converged || false,
        iteration_history: iterationHistory,
        distances_to_medoids,
    };
}

export async function analyzeKMedoidsCluster({
    configData,
    dataVariables,
    variables,
    allVariables,
    onProgress,
    useWorker = true, // Default to using worker
}: KMedoidsClusterAnalysisType) {
    const n = dataVariables.length;
    const k = configData.main.Cluster ?? 2;
    const seedMode = configData.iterate.SeedMode ?? (configData.iterate.RandomSeed == null ? "default" : "custom");
    const userSeed = seedMode === "custom" ? configData.iterate.RandomSeed ?? null : null;
    const resolvedSeed = seedMode === "custom" ? userSeed : null;
    const userNInit = Math.max(1, configData.iterate.NumberOfInitializations ?? 1);
    
    // Performance estimation
    const complexity = n * n * k * userNInit; // Simplified estimate
    if (n > 1000 && userNInit > 5) {
        console.warn(`⚠️ Large dataset detected (n=${n}, n_init=${userNInit}). Consider reducing Number of Initializations to 1-3 for faster execution.`);
    }
    if (complexity > 1000000) {
        console.warn(`⚠️ High computational complexity detected. This may take several seconds to complete.`);
    }
    
    try {
        const missingByVariable: Record<string, number> = Object.fromEntries(
            variables.map(v => [v.name, 0])
        );

        // Prepare input data matrix — convert selected vars to numeric and drop invalid rows.
        const parsedRows = dataVariables
            .map((row: any) => {
                const numeric = variables.map(v => {
                    const value = row[v.columnIndex as number];
                    const parsed = typeof value === "number" ? value : parseFloat(value);
                    if (!Number.isFinite(parsed)) {
                        missingByVariable[v.name] = (missingByVariable[v.name] || 0) + 1;
                    }
                    return parsed;
                });
                return {
                    source: row,
                    numeric,
                };
            });

        // Preprocessing flow:
        // 1) non-numeric -> NaN (already done above),
        // 2) missing handling per Options → Missing Values:
        //    listwise = drop rows with any NaN/Inf,
        //    median/knn = keep rows with at least one valid value, impute rest,
        // 3) optional Z-score standardization.
        const missingValueMethod = configData.options?.MissingValueMethod ?? MissingValueMethod.Listwise;
        const missingHandled = applyMissingHandling(parsedRows, missingValueMethod);

        const dataMatrix = missingHandled.matrix;
        // Reflect imputed cells (Median/Knn) back into the row objects so
        // output tables show the filled-in value instead of the original blank.
        const processedDataRows = patchImputedAttributes(missingHandled.rows, dataMatrix, variables);

        const normalizationMethod = resolveNormalizationMethod(configData);
        const standardizedMatrix = await standardizeMatrixWasm(dataMatrix, normalizationMethod);

        const preprocessingSummary: PreprocessingSummary = {
            initialN: dataVariables.length,
            afterPreprocessingN: standardizedMatrix.length,
            missingRowsRemoved: missingHandled.removedCount,
            outlierRowsRemoved: 0,
            missingByVariable,
        };
        
        // Early validation: need at least 2 valid data points
        if (standardizedMatrix.length < 2) {
            throw new Error(`Not enough valid data points for clustering (found ${standardizedMatrix.length}). Check that the selected variables contain numeric values.`);
        }

        const finalMatrix = standardizedMatrix;

        const caseLabelVariableName = configData.main.CaseTarget?.trim();
        const sourceVariables = allVariables ?? variables;
        const caseLabelColumnIndex = caseLabelVariableName
            ? (sourceVariables.find(v => v.name === caseLabelVariableName)?.columnIndex ?? null)
            : null;
        
        // Use the selected method for manual runs; auto-k range stays PAM-only.
        const method: ClusteringMethod = configData.iterate.Method || "PAM";
        const autoKMethod: ClusteringMethod = "PAM";
        const distanceMetric = normalizeDistanceMetric(configData.main.DistanceMetric);

        // Check if automatic k selection is enabled
        const isAutomatic = configData.main.ClusterMode === ClusterMode.Automatic;

        // Automatic k always ends with a full-data PAM run, so it is bound by the PAM limit too.
        // Above PAM_WARN_ROWS the dialog only warns (the user may force PAM); this hard limit is
        // where the n×n distance matrix is practically guaranteed to fail to allocate.
        const usesFullPam = isAutomatic || String(method).toUpperCase() === "PAM";
        if (usesFullPam && finalMatrix.length > PAM_HARD_MAX_ROWS) {
            const matrixMb = Math.round((finalMatrix.length ** 2 * 8) / 1_048_576);
            throw new Error(
                `PAM cannot handle ${finalMatrix.length} valid rows (hard limit ${PAM_HARD_MAX_ROWS}; it needs a ~${matrixMb} MB distance matrix). ` +
                (isAutomatic
                    ? `Automatic k selection uses PAM, so use manual cluster mode with the CLARA method, `
                    : `Select the CLARA method in the Iterate tab, `) +
                `or reduce the data to ${PAM_HARD_MAX_ROWS} rows or fewer.`
            );
        }

        if (!isAutomatic) {
            // Validate manual k
            const manualK = configData.main.Cluster ?? 2;
            if (manualK > dataMatrix.length) {
                throw new Error(
                    `Number of clusters (k=${manualK}) cannot exceed number of valid data points (n=${dataMatrix.length}). ` +
                    `Please reduce the number of clusters or check your data.`
                );
            }
        }
        
        if (isAutomatic) {
            // ========== AUTOMATIC K SELECTION ==========
            
            const kMin = configData.main.AutoKMin || 2;
            const kMax = Math.min(configData.main.AutoKMax || 10, dataMatrix.length - 1);
            const autoMethod = configData.main.AutoKMethod || AutoKMethod.Silhouette;
            
            if (kMin >= kMax) {
                throw new Error(`AutoKMin (${kMin}) must be less than the effective AutoKMax (${kMax}). Dataset has ${dataMatrix.length} valid data points.`);
            }
            
            // Use Web Worker if available (non-blocking), fall back to direct WASM
            const autoWorker = useWorker ? initializeWorker() : null;
            if (autoWorker) {
                await autoWorker.init(); // ensure WASM in worker is ready
                // Cache data matrix in the worker once — avoids re-serializing on every k iteration
                await autoWorker.setData(finalMatrix);
            } else {
                await initializeWasm(); // direct WASM fallback (blocks main thread)
            }
            
            const results: any[] = [];
            const scores: number[] = [];
            const silhouetteScoresPerK: number[] = [];

            // ── Single WASM range call — builds dist matrix once, runs PAM for all k ──
            const rangeInput: ClusteringRangeInput = {
                k_min: kMin,
                k_max: kMax,
                method: autoKMethod,
                max_iterations: configData.iterate.MaximumIterations || 100,
                distance_metric: distanceMetric,
                random_seed: configData.iterate.RandomSeed ?? 42,
                convergence_tolerance: configData.iterate.ConvergenceCriterion || 0.0,
                // data omitted when using worker (cached via setData above)
                ...(autoWorker ? {} : { data: finalMatrix }),
            };

            if (onProgress) {
                onProgress({ stage: "automatic_k", progress: 10,
                    message: `Testing k=${kMin}..${kMax} with shared distance matrix...` });
            }

            let rangeResults: ClusteringRangeItem[];
            if (autoWorker) {
                rangeResults = await autoWorker.clusterRange(rangeInput, onProgress);
            } else {
                // Direct WASM fallback: call run_k_medoids_range if available in the current build
                const wasmModule = getInitializedWasmModule();
                if (typeof wasmModule.run_k_medoids_range !== "function") {
                    throw new Error("run_k_medoids_range not found in WASM build — please rebuild WASM with wasm-pack.");
                }
                const rawItems = wasmModule.run_k_medoids_range(rangeInput) as any[];
                rangeResults = rawItems.map((item: any) => ({
                    k: item.k,
                    labels: item.cluster_assignments || [],
                    medoids: item.medoids_indices || [],
                    cost: item.total_distance || 0,
                    iterations: item.iterations || 0,
                    converged: item.converged || false,
                    cost_history: item.cost_history || [],
                    // Prefer the WASM-computed silhouette_overall (reuses the shared
                    // distance matrix); only recompute in JS for older WASM builds.
                    silhouetteScore: typeof item.silhouette_overall === "number"
                        ? item.silhouette_overall
                        : calculateSilhouetteScore(finalMatrix, item.cluster_assignments || [], item.k, distanceMetric),
                    wcssScore: wcssFromWasm(wasmModule, finalMatrix, item.cluster_assignments || [], item.medoids_indices || [], distanceMetric),
                }));
            }

            // Map range results into the existing arrays shapes
            for (const item of rangeResults) {
                if (!item.labels || item.labels.length === 0) {
                    const fallback = autoMethod === AutoKMethod.Silhouette ? -1 : Infinity;
                    results.push({ labels: [], medoids: [], cost: Infinity, iterations: 0, converged: false });
                    scores.push(fallback);
                    silhouetteScoresPerK.push(-1);
                    continue;
                }
                results.push(item);
                const sil = item.silhouetteScore ?? 0;
                const wcss = item.wcssScore ?? 0;
                if (autoMethod === AutoKMethod.Silhouette) {
                    scores.push(sil);
                    silhouetteScoresPerK.push(sil);
                } else {
                    scores.push(wcss);
                    silhouetteScoresPerK.push(sil);
                }
            }
            
            // Find optimal k
            // kRange is derived from the actual returned range results (preserves order)
            const kRange = rangeResults.map(r => r.k);
            let optimalK: number;
            let optimalIdx: number;
            
            if (autoMethod === AutoKMethod.Silhouette) {
                // Higher silhouette is better
                optimalIdx = scores.indexOf(Math.max(...scores));
                optimalK = kRange[optimalIdx];
            } else {
                // Elbow method - find the elbow point
                optimalK = findOptimalKElbow(kRange, scores);
                optimalIdx = kRange.indexOf(optimalK);
            }
            
            if (onProgress) {
                onProgress({
                    stage: "finalizing",
                    progress: 85,
                    message: `Optimal k=${optimalK} found. Running final clustering...`
                });
            }

            // Run final clustering on the full dataset.
            // The range scan used subsampled data (≤300 pts) so its labels only cover
            // the subsample. We must cluster the full matrix to get assignments for
            // every row.  PAM with BUILD phase is deterministic (effective n_init=1 in
            // Rust regardless of what n_init says), so this is a single fast run.
            const finalInput: ClusteringInput = {
                data: finalMatrix,
                n_clusters: optimalK,
                method: autoKMethod,
                max_iterations: configData.iterate.MaximumIterations || 100,
                distance_metric: distanceMetric,
                random_seed: configData.iterate.RandomSeed || null,
                n_init: 1, // BUILD phase is deterministic — one run is enough
                convergence_tolerance: configData.iterate.ConvergenceCriterion || 0.0,
            };
            let finalResult: any;
            if (autoWorker) {
                finalResult = await autoWorker.cluster(finalInput);
            } else {
                finalResult = mapWasmOutputToResult(getInitializedWasmModule().run_k_medoids(finalInput));
            }
            
            if (onProgress) {
                onProgress({
                    stage: "complete",
                    progress: 100,
                    message: "Analysis complete!"
                });
            }
            
            const analysisResult = {
                success: true,
                message: `K-Medoids analysis completed successfully (automatic k=${optimalK})`,
                result: finalResult,
                config: configData,
                preprocessingSummary,
                automaticKSelection: {
                    method: autoMethod,
                    testedRange: { min: kMin, max: kMax },
                    // Store both metrics so output can render Silhouette + Elbow charts together.
                    scores: rangeResults.map((item, i) => ({
                        k: item.k ?? (kRange[i] ?? (kMin + i)),
                        // Keep primary score for backward compatibility (selected by autoMethod).
                        score: scores[i] ?? (autoMethod === AutoKMethod.Silhouette
                            ? (item.silhouetteScore ?? 0)
                            : (item.wcssScore ?? 0)),
                        silhouetteScore: silhouetteScoresPerK[i] ?? item.silhouetteScore ?? 0,
                        totalCost: item.wcssScore ?? item.cost ?? 0,
                    })),
                    optimalK: optimalK,
                    optimalScore: scores[optimalIdx]
                }
            };
            
            // Save clustering variables if requested
            await saveClusteringVariables(
                finalResult,
                configData.save,
                optimalK,
                processedDataRows
            );
            
            // Persist comprehensive output before returning so the result page
            // (which loads its data once on navigation) already has it available.
            await persistComprehensiveOutput(
                analysisResult,
                processedDataRows,
                variables,
                caseLabelColumnIndex,
                finalMatrix
            );

            return analysisResult;
        } else {
            // ========== MANUAL K SELECTION ==========
            const manualK = configData.main.Cluster ?? 2;
            // Manual mode still needs the k-range sweep when either "Grafik K Optimal" or
            // "Tabel K Optimal" (keduanya di tab Evaluation) aktif. Field Options lama tetap
            // dibaca sebagai fallback untuk konfigurasi yang tersimpan sebelum reorganisasi.
            const shouldBuildManualKChart =
                configData.evaluation?.ShowOptimalKChart === true ||
                configData.options?.ShowOptimalKChart === true ||
                configData.evaluation?.ShowOptimalKTable === true;
            
            const clusteringInput: ClusteringInput = {
                data: finalMatrix,
                n_clusters: manualK,
                method: method,
                max_iterations: configData.iterate.MaximumIterations || 100,
                distance_metric: distanceMetric,
                random_seed: resolvedSeed,
                n_init: userNInit,
                convergence_tolerance: configData.iterate.ConvergenceCriterion || 0.0,
                // BUILD phase only for default mode; random/custom use random init.
                use_build_phase: seedMode === "default",
                use_r_implementation: false,
                clara_num_samples: configData.iterate.NumSamples ?? 5,
                ...(configData.iterate.SampleSize ? { clara_sample_size: configData.iterate.SampleSize } : {}),
            };

            let result;
            let workerInstance: ClusterWorker | null = null;

            if (useWorker) {
                // Try to use Web Worker for background execution
                workerInstance = initializeWorker();
                
                if (workerInstance) {
                    await workerInstance.init(); // ensure WASM is ready before clustering
                    result = await workerInstance.cluster(clusteringInput, onProgress);
                } else {
                    // Worker not available, fallback to direct execution
                    await initializeWasm();
                    
                    if (onProgress) {
                        onProgress({ stage: "preparing", progress: 0, message: "Preparing data..." });
                        onProgress({ stage: "clustering", progress: 50, message: "Running algorithm..." });
                    }
                    
                    const wasmResult = getInitializedWasmModule().run_k_medoids(clusteringInput);
                    result = mapWasmOutputToResult(wasmResult);
                    
                    if (onProgress) {
                        onProgress({ stage: "complete", progress: 100, message: "Analysis complete!" });
                    }
                }
            } else {
                // Direct execution on main thread (explicitly requested)
                await initializeWasm();
                
                if (onProgress) {
                    onProgress({ stage: "clustering", progress: 50, message: "Running algorithm..." });
                }
                
                const wasmResult = getInitializedWasmModule().run_k_medoids(clusteringInput);
                result = mapWasmOutputToResult(wasmResult);
            }

            let kChartSelection: {
                method: AutoKMethod;
                testedRange: { min: number; max: number };
                scores: Array<{ k: number; score: number; silhouetteScore: number; totalCost: number }>;
                optimalK: number;
                optimalScore: number;
            } | undefined;

            if (shouldBuildManualKChart) {
                const kMin = Math.max(2, configData.main.AutoKMin || 2);
                const kMax = Math.min(configData.main.AutoKMax || 10, dataMatrix.length - 1);
                const autoMethod = configData.main.AutoKMethod || AutoKMethod.Silhouette;

                if (kMin < kMax) {
                    if (onProgress) {
                        onProgress({
                            stage: "automatic_k",
                            progress: 70,
                            message: `Evaluating K chart range (k=${kMin}..${kMax})...`
                        });
                    }

                    const rangeInput: ClusteringRangeInput = {
                        k_min: kMin,
                        k_max: kMax,
                        method: autoKMethod,
                        max_iterations: configData.iterate.MaximumIterations || 100,
                        distance_metric: distanceMetric,
                        random_seed: configData.iterate.RandomSeed ?? 42,
                        convergence_tolerance: configData.iterate.ConvergenceCriterion || 0.0,
                        ...(workerInstance ? {} : { data: finalMatrix }),
                    };

                    let rangeResults: ClusteringRangeItem[];
                    if (workerInstance) {
                        await workerInstance.setData(finalMatrix);
                        rangeResults = await workerInstance.clusterRange(rangeInput, onProgress);
                    } else {
                        const wasmModule = getInitializedWasmModule();
                        if (typeof wasmModule.run_k_medoids_range !== "function") {
                            throw new Error("run_k_medoids_range not found in WASM build — please rebuild WASM with wasm-pack.");
                        }
                        const rawItems = wasmModule.run_k_medoids_range(rangeInput) as any[];
                        rangeResults = rawItems.map((item: any) => ({
                            k: item.k,
                            labels: item.cluster_assignments || [],
                            medoids: item.medoids_indices || [],
                            cost: item.total_distance || 0,
                            iterations: item.iterations || 0,
                            converged: item.converged || false,
                            cost_history: item.cost_history || [],
                            // Prefer the WASM-computed silhouette_overall (reuses the shared
                            // distance matrix); only recompute in JS for older WASM builds.
                            silhouetteScore: typeof item.silhouette_overall === "number"
                                ? item.silhouette_overall
                                : calculateSilhouetteScore(finalMatrix, item.cluster_assignments || [], item.k, distanceMetric),
                            wcssScore: wcssFromWasm(wasmModule, finalMatrix, item.cluster_assignments || [], item.medoids_indices || [], distanceMetric),
                        }));
                    }

                    const scores: number[] = [];
                    const silhouetteScoresPerK: number[] = [];
                    for (const item of rangeResults) {
                        if (!item.labels || item.labels.length === 0) {
                            const fallback = autoMethod === AutoKMethod.Silhouette ? -1 : Infinity;
                            scores.push(fallback);
                            silhouetteScoresPerK.push(-1);
                            continue;
                        }
                        const sil = item.silhouetteScore ?? 0;
                        const wcss = item.wcssScore ?? 0;
                        if (autoMethod === AutoKMethod.Silhouette) {
                            scores.push(sil);
                            silhouetteScoresPerK.push(sil);
                        } else {
                            scores.push(wcss);
                            silhouetteScoresPerK.push(sil);
                        }
                    }

                    const kRange = rangeResults.map(r => r.k);
                    let optimalK: number;
                    let optimalIdx: number;
                    if (autoMethod === AutoKMethod.Silhouette) {
                        optimalIdx = scores.indexOf(Math.max(...scores));
                        optimalK = kRange[optimalIdx];
                    } else {
                        optimalK = findOptimalKElbow(kRange, scores);
                        optimalIdx = kRange.indexOf(optimalK);
                    }

                    kChartSelection = {
                        method: autoMethod,
                        testedRange: { min: kMin, max: kMax },
                        scores: rangeResults.map((item, i) => ({
                            k: item.k ?? (kRange[i] ?? (kMin + i)),
                            score: scores[i] ?? (autoMethod === AutoKMethod.Silhouette
                                ? (item.silhouetteScore ?? 0)
                                : (item.wcssScore ?? 0)),
                            silhouetteScore: silhouetteScoresPerK[i] ?? item.silhouetteScore ?? 0,
                            totalCost: item.wcssScore ?? item.cost ?? 0,
                        })),
                        optimalK,
                        optimalScore: scores[optimalIdx],
                    };
                }
            }
            
            const analysisResult = {
                success: true,
                message: "K-Medoids analysis completed successfully",
                result: result,
                config: configData,
                preprocessingSummary,
                kChartSelection,
            };
            
            // Save clustering variables if requested
            await saveClusteringVariables(
                result,
                configData.save,
                manualK,
                processedDataRows
            );
            
            // Persist comprehensive output before returning so the result page
            // (which loads its data once on navigation) already has it available.
            await persistComprehensiveOutput(
                analysisResult,
                processedDataRows,
                variables,
                caseLabelColumnIndex,
                finalMatrix
            );

            return analysisResult;
        }

    } catch (error) {
        console.error("Error in K-Medoids analysis:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            message: `Analysis failed: ${errorMessage}`,
            error: error,
        };
    }
}

/**
 * Cancel ongoing clustering (worker mode only)
 */
export function cancelClustering(): void {
    if (worker) {
        worker.cancel();
    }
}

/**
 * Terminate worker and cleanup resources
 */
export function cleanupWorker(): void {
    if (worker) {
        worker.terminate();
        worker = null;
    }
}
