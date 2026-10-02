/** @jest-environment node */

/**
 * Uji performa konstruktor KNNAnalysis (parsing input + seluruh komputasi KNN).
 *
 * Desain faktorial: jumlah baris x jumlah fitur x konfigurasi.
 *   - fixed-k            : k = 3 tetap
 *   - auto-k             : pemilihan k otomatis (k = 3..5) dengan 10-fold CV
 *   - feature-selection  : forward selection dengan k = 3 tetap
 *
 * Setiap skenario: warm-up (tidak dicatat), lalu N run terukur. Untuk tiap
 * skenario dilaporkan min, maks, rata-rata, median, SD, CV, dan CI 95% rata-rata
 * (distribusi t). Pertumbuhan waktu dianalisis dengan regresi log-log
 * (kemiringan ~1 = linear, ~2 = kuadratik).
 *
 * Konfigurasi lewat environment variable (semua opsional):
 *   KNN_PERF_ROW_COUNTS       default 100,1000,5000,10000
 *   KNN_PERF_FEATURE_COUNTS   default 2,5,10,20
 *   KNN_PERF_CONFIGS          default fixed-k,auto-k,feature-selection
 *   KNN_PERF_RUNS             jumlah run tetap; default adaptif (100 untuk
 *                             <= 1000 baris, 30 untuk lebih besar)
 *   KNN_PERF_WARMUP_RUNS      default 5
 *   KNN_PERF_MAX_RUN_MS       skenario dilewati bila satu run warm-up melebihi
 *                             batas ini; default 15000
 *   KNN_PERF_OUTPUT           nama file hasil di folder __tests__;
 *                             default performance-results-constructor-all-runs.json
 */

import fs from "fs";
import os from "os";
import path from "path";
import { performance } from "perf_hooks";
import init, {
    KNNAnalysis,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/rust/pkg/wasm";

type ConfigName = "fixed-k" | "auto-k" | "feature-selection";

type PerformanceSummary = {
    runs: number;
    minimumMs: number;
    maximumMs: number;
    averageMs: number;
    medianMs: number;
    standardDeviationMs: number;
    coefficientOfVariation: number;
    ci95LowerMs: number;
    ci95UpperMs: number;
};

type ScenarioResult =
    | {
          status: "measured";
          rowCount: number;
          featureCount: number;
          config: ConfigName;
          warmupRuns: number;
          executionTimesMs: number[];
          summary: PerformanceSummary;
          wasmMemoryBytesAfter: number;
      }
    | {
          status: "skipped";
          rowCount: number;
          featureCount: number;
          config: ConfigName;
          reason: string;
      };

type ScalingFit = {
    config: ConfigName;
    fixed: "featureCount" | "rowCount";
    fixedValue: number;
    variable: "rowCount" | "featureCount";
    points: number;
    slope: number;
    rSquared: number;
};

type PerformanceResult = {
    metadata: {
        generatedAt: string;
        environment: {
            node: string;
            platform: string;
            arch: string;
            cpuModel: string;
            logicalCores: number;
            totalMemoryGB: number;
        };
        warmupRuns: number;
        runsPolicy: string;
        maxRunMs: number;
        rowCounts: number[];
        featureCounts: number[];
        configs: ConfigName[];
        notes: string[];
    };
    scenarios: ScenarioResult[];
    scaling: ScalingFit[];
};

const ALL_CONFIGS: ConfigName[] = ["fixed-k", "auto-k", "feature-selection"];

const parseNumberList = (value: string | undefined, fallback: number[]) =>
    value
        ? value
              .split(",")
              .map(Number)
              .filter((item) => Number.isFinite(item) && item > 0)
        : fallback;

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseConfigList = (value: string | undefined) =>
    value
        ? value
              .split(",")
              .map((item) => item.trim())
              .filter((item): item is ConfigName =>
                  ALL_CONFIGS.includes(item as ConfigName)
              )
        : ALL_CONFIGS;

const variableDefinition = (name: string, columnIndex: number) => ({
    id: columnIndex + 1,
    columnIndex,
    name,
    type: "NUMERIC",
    width: 8,
    decimals: 2,
    label: `Variable ${name}`,
    values: [],
    missing: [],
    columns: 8,
    align: "right",
    measure: "scale",
    role: "input",
});

const generateDummyData = (rowCount: number, featureCount: number) => {
    const featureNames = Array.from(
        { length: featureCount },
        (_, index) => `VAR${index + 1}`
    );
    const targetData = [
        Array.from({ length: rowCount }, (_, rowIndex) => ({
            target: (rowIndex % 10) + 1,
        })),
    ];
    const featuresData = featureNames.map((featureName, featureIndex) =>
        Array.from({ length: rowCount }, (_, rowIndex) => ({
            [featureName]:
                ((rowIndex + 1) * (featureIndex + 3) + featureIndex * 7) % 101,
        }))
    );

    return {
        targetData,
        featuresData,
        targetDefs: [[variableDefinition("target", 0)]],
        featuresDefs: featureNames.map((name, index) => [
            variableDefinition(name, index + 1),
        ]),
        featureNames,
    };
};

const createConfig = (featureNames: string[], configName: ConfigName) => {
    const autoK = configName === "auto-k";
    const featureSelection = configName === "feature-selection";

    return {
        main: {
            TargetVar: "target",
            FeatureVar: featureNames,
            CaseIdenVar: null,
            FocalCaseIdenVar: null,
            NormCovar: true,
        },
        neighbors: {
            Specify: !autoK,
            AutoSelection: autoK,
            SpecifyK: 3,
            MinK: autoK ? 3 : null,
            MaxK: autoK ? 5 : null,
            MetricEucli: true,
            MetricManhattan: false,
            Weight: false,
            PredictionsMean: true,
            PredictionsMedian: false,
        },
        features: {
            ForwardSelection: null,
            ForcedEntryVar: null,
            FeaturesToEvaluate: 0,
            ForcedFeatures: 0,
            PerformSelection: featureSelection,
            MaxReached: true,
            BelowMin: false,
            MaxToSelect: null,
            MinChange: 0.01,
        },
        partition: {
            SrcVar: null,
            PartitioningVariable: null,
            UseRandomly: false,
            UseVariable: false,
            VFoldPartitioningVariable: null,
            VFoldUseRandomly: false,
            VFoldUsePartitioningVar: false,
            TrainingNumber: 70,
            NumPartition: 10,
            SetSeed: false,
            Seed: null,
        },
        save: {
            AutoName: true,
            CustomName: false,
            MaxCatsToSave: null,
            HasTargetVar: false,
            IsCateTargetVar: false,
            RandomAssignToPartition: false,
            RandomAssignToFold: false,
        },
        output: {
            CaseSummary: false,
            FeatureSelectionSummary: false,
            KSelectionChart: false,
            PredictorSpace: false,
            PredictionResults: false,
            ConfusionMatrix: false,
            ShowNeighborDetail: false,
            ChartAndTable: true,
            ExportModelXML: false,
            XMLFilePath: null,
            ExportDistance: false,
            CreateDataset: false,
            WriteDataFile: false,
            NewDataFilePath: null,
            DatasetName: null,
        },
    };
};

const createAnalysis = (
    dummyData: ReturnType<typeof generateDummyData>,
    config: ReturnType<typeof createConfig>
) =>
    new KNNAnalysis(
        dummyData.targetData,
        dummyData.featuresData,
        [],
        null,
        dummyData.targetDefs,
        dummyData.featuresDefs,
        [],
        null,
        config
    );

// Nilai kritis t dua sisi (alpha = 0.05) lewat ekspansi Cornish-Fisher;
// galat < 0.01 untuk df >= 5.
const tCritical95 = (degreesOfFreedom: number) => {
    const z = 1.959964;
    const df = degreesOfFreedom;
    return (
        z +
        (z ** 3 + z) / (4 * df) +
        (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
        (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
    );
};

const summarize = (executionTimesMs: number[]): PerformanceSummary => {
    const runs = executionTimesMs.length;
    const sorted = [...executionTimesMs].sort((left, right) => left - right);
    const middle = Math.floor(runs / 2);
    const medianMs =
        runs % 2 === 0
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
    const averageMs =
        executionTimesMs.reduce((total, value) => total + value, 0) / runs;
    const variance =
        runs > 1
            ? executionTimesMs.reduce(
                  (total, value) => total + (value - averageMs) ** 2,
                  0
              ) /
              (runs - 1)
            : 0;
    const standardDeviationMs = Math.sqrt(variance);
    const marginMs =
        runs > 1
            ? (tCritical95(runs - 1) * standardDeviationMs) / Math.sqrt(runs)
            : 0;

    return {
        runs,
        minimumMs: sorted[0],
        maximumMs: sorted[runs - 1],
        averageMs,
        medianMs,
        standardDeviationMs,
        coefficientOfVariation: standardDeviationMs / averageMs,
        ci95LowerMs: averageMs - marginMs,
        ci95UpperMs: averageMs + marginMs,
    };
};

// Regresi linear log(median waktu) terhadap log(x). Kemiringan adalah
// eksponen empiris: waktu ~ x^slope.
const fitLogLog = (points: Array<{ x: number; timeMs: number }>) => {
    const xs = points.map((point) => Math.log(point.x));
    const ys = points.map((point) => Math.log(point.timeMs));
    const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
    const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;
    let covariance = 0;
    let varianceX = 0;
    let varianceY = 0;
    xs.forEach((x, index) => {
        covariance += (x - meanX) * (ys[index] - meanY);
        varianceX += (x - meanX) ** 2;
        varianceY += (ys[index] - meanY) ** 2;
    });
    const slope = covariance / varianceX;
    const rSquared = varianceY === 0 ? 1 : covariance ** 2 / (varianceX * varianceY);
    return { slope, rSquared };
};

const buildScalingFits = (
    scenarios: ScenarioResult[],
    configs: ConfigName[],
    rowCounts: number[],
    featureCounts: number[]
): ScalingFit[] => {
    const measured = scenarios.filter(
        (scenario): scenario is Extract<ScenarioResult, { status: "measured" }> =>
            scenario.status === "measured"
    );
    const fits: ScalingFit[] = [];

    configs.forEach((config) => {
        featureCounts.forEach((featureCount) => {
            const points = measured
                .filter(
                    (scenario) =>
                        scenario.config === config &&
                        scenario.featureCount === featureCount
                )
                .map((scenario) => ({
                    x: scenario.rowCount,
                    timeMs: scenario.summary.medianMs,
                }));
            if (points.length >= 3) {
                fits.push({
                    config,
                    fixed: "featureCount",
                    fixedValue: featureCount,
                    variable: "rowCount",
                    points: points.length,
                    ...fitLogLog(points),
                });
            }
        });

        rowCounts.forEach((rowCount) => {
            const points = measured
                .filter(
                    (scenario) =>
                        scenario.config === config && scenario.rowCount === rowCount
                )
                .map((scenario) => ({
                    x: scenario.featureCount,
                    timeMs: scenario.summary.medianMs,
                }));
            if (points.length >= 3) {
                fits.push({
                    config,
                    fixed: "rowCount",
                    fixedValue: rowCount,
                    variable: "featureCount",
                    points: points.length,
                    ...fitLogLog(points),
                });
            }
        });
    });

    return fits;
};

describe("KNNAnalysis Constructor Performance Test", () => {
    const ROW_COUNTS = parseNumberList(
        process.env.KNN_PERF_ROW_COUNTS,
        [100, 1000, 5000, 10000]
    );
    const FEATURE_COUNTS = parseNumberList(
        process.env.KNN_PERF_FEATURE_COUNTS,
        [2, 5, 10, 20]
    );
    const CONFIGS = parseConfigList(process.env.KNN_PERF_CONFIGS);
    const FIXED_RUNS = process.env.KNN_PERF_RUNS
        ? parsePositiveInteger(process.env.KNN_PERF_RUNS, 30)
        : null;
    const WARMUP_RUNS = parsePositiveInteger(process.env.KNN_PERF_WARMUP_RUNS, 5);
    const MAX_RUN_MS = parsePositiveInteger(process.env.KNN_PERF_MAX_RUN_MS, 15000);
    const OUTPUT_FILE =
        process.env.KNN_PERF_OUTPUT ?? "performance-results-constructor-all-runs.json";

    const runsFor = (rowCount: number) =>
        FIXED_RUNS ?? (rowCount <= 1000 ? 100 : 30);

    const performanceResults: PerformanceResult = {
        metadata: {
            generatedAt: "",
            environment: {
                node: process.version,
                platform: os.platform(),
                arch: os.arch(),
                cpuModel: os.cpus()[0]?.model ?? "unknown",
                logicalCores: os.cpus().length,
                totalMemoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
            },
            warmupRuns: WARMUP_RUNS,
            runsPolicy: FIXED_RUNS
                ? `${FIXED_RUNS} run untuk semua skenario`
                : "100 run untuk <= 1000 baris, 30 run untuk > 1000 baris",
            maxRunMs: MAX_RUN_MS,
            rowCounts: ROW_COUNTS,
            featureCounts: FEATURE_COUNTS,
            configs: CONFIGS,
            notes: [
                "Waktu = konstruktor KNNAnalysis (parsing input + seluruh komputasi), di Node.js.",
                "wasmMemoryBytesAfter = ukuran memori linear WASM setelah skenario; memori ini hanya bisa bertambah sehingga nilainya kumulatif.",
                "scaling.slope = eksponen empiris dari regresi log(median) terhadap log(x).",
            ],
        },
        scenarios: [],
        scaling: [],
    };

    let wasmMemory: WebAssembly.Memory;

    beforeAll(async () => {
        const wasmPath = path.resolve(__dirname, "../rust/pkg/wasm_bg.wasm");
        const wasmBuffer = fs.readFileSync(wasmPath);
        const wasmExports = await init({ module_or_path: wasmBuffer });
        wasmMemory = wasmExports.memory;
    }, 60000);

    afterAll(() => {
        performanceResults.metadata.generatedAt = new Date().toISOString();
        performanceResults.scaling = buildScalingFits(
            performanceResults.scenarios,
            CONFIGS,
            ROW_COUNTS,
            FEATURE_COUNTS
        );
        fs.writeFileSync(
            path.join(__dirname, OUTPUT_FILE),
            JSON.stringify(performanceResults, null, 2)
        );
    });

    CONFIGS.forEach((configName) => {
        describe(`konfigurasi ${configName}`, () => {
            ROW_COUNTS.forEach((rowCount) => {
                FEATURE_COUNTS.forEach((featureCount) => {
                    const runs = runsFor(rowCount);

                    test(`${rowCount} baris x ${featureCount} fitur, ${runs} run`, () => {
                        const dummyData = generateDummyData(rowCount, featureCount);
                        const config = createConfig(dummyData.featureNames, configName);

                        // Warm-up sekaligus validasi: analisis harus selesai tanpa
                        // error, karena error di Rust dikumpulkan (tidak dilempar)
                        // dan skenario yang gagal akan terlihat "cepat".
                        const warmupStart = performance.now();
                        const firstAnalysis = createAnalysis(dummyData, config);
                        const firstRunMs = performance.now() - warmupStart;
                        const errors = String(firstAnalysis.get_all_errors());
                        firstAnalysis.free();
                        expect(errors).toContain("No errors occurred.");

                        if (firstRunMs > MAX_RUN_MS) {
                            performanceResults.scenarios.push({
                                status: "skipped",
                                rowCount,
                                featureCount,
                                config: configName,
                                reason: `run warm-up pertama ${firstRunMs.toFixed(0)} ms > batas ${MAX_RUN_MS} ms`,
                            });
                            return;
                        }

                        for (let run = 1; run < WARMUP_RUNS; run++) {
                            createAnalysis(dummyData, config).free();
                        }

                        const executionTimesMs: number[] = [];
                        for (let run = 0; run < runs; run++) {
                            const startTime = performance.now();
                            const analysis = createAnalysis(dummyData, config);
                            const endTime = performance.now();

                            analysis.free();
                            executionTimesMs.push(endTime - startTime);
                        }

                        performanceResults.scenarios.push({
                            status: "measured",
                            rowCount,
                            featureCount,
                            config: configName,
                            warmupRuns: WARMUP_RUNS,
                            executionTimesMs,
                            summary: summarize(executionTimesMs),
                            wasmMemoryBytesAfter: wasmMemory.buffer.byteLength,
                        });
                    }, 60 * 60 * 1000);
                });
            });
        });
    });
});
