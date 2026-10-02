/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";
import init, {
    KNNAnalysis,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/rust/pkg/wasm";

const validTargetData = [
    [
        { target: 10 },
        { target: 20 },
        { target: 30 },
    ],
];

const validFeaturesData = [
    [
        { score: 1 },
        { score: 2 },
        { score: 3 },
    ],
];

const validCaseData = [
    [
        { case_id: 101 },
        { case_id: 102 },
        { case_id: 103 },
    ],
];

const variableDefinition = (
    name: string,
    columnIndex: number,
    measure: "scale" | "nominal" = "scale"
) => ({
    id: columnIndex + 1,
    columnIndex,
    name,
    type: "NUMERIC",
    width: 8,
    decimals: 0,
    label: "",
    values: [],
    missing: [],
    columns: 8,
    align: "right",
    measure,
    role: "input",
});

const validTargetDefs = [[variableDefinition("target", 0)]];
const validFeaturesDefs = [[variableDefinition("score", 1)]];
const validCaseDefs = [[variableDefinition("case_id", 2)]];
const categoricalTargetData = [
    [
        { target: "A" },
        { target: "B" },
        { target: "A" },
    ],
];
const categoricalTargetDefs = [[variableDefinition("target", 0, "nominal")]];

const validConfig = {
    main: {
        TargetVar: "target",
        FeatureVar: ["score"],
        CaseIdenVar: "case_id",
        FocalCaseIdenVar: null,
        NormCovar: true,
    },
    neighbors: {
        Specify: true,
        AutoSelection: false,
        SpecifyK: 1,
        MinK: null,
        MaxK: null,
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
        PerformSelection: false,
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
        NumPartition: 2,
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

type ConstructorInput = {
    targetData?: unknown;
    featuresData?: unknown;
    focalCaseData?: unknown;
    caseData?: unknown;
    targetDefs?: unknown;
    featuresDefs?: unknown;
    focalCaseDefs?: unknown;
    caseDefs?: unknown;
    config?: unknown;
};

const createAnalysis = ({
    targetData = validTargetData,
    featuresData = validFeaturesData,
    focalCaseData = [],
    caseData = validCaseData,
    targetDefs = validTargetDefs,
    featuresDefs = validFeaturesDefs,
    focalCaseDefs = [],
    caseDefs = validCaseDefs,
    config = validConfig,
}: ConstructorInput = {}) =>
    new KNNAnalysis(
        targetData,
        featuresData,
        focalCaseData,
        caseData,
        targetDefs,
        featuresDefs,
        focalCaseDefs,
        caseDefs,
        config
    );

const runAnalysisTest = (input: ConstructorInput = {}) => {
    try {
        const analysis = createAnalysis(input);
        analysis.free();
        return null;
    } catch (error) {
        return error;
    }
};

describe("Nearest Neighbor Constructor Test", () => {
    beforeAll(async () => {
        const wasmPath = path.join(__dirname, "../rust/pkg/wasm_bg.wasm");
        const wasmBuffer = fs.readFileSync(wasmPath);
        await init({ module_or_path: wasmBuffer });
    });

    it("T01: Harus berhasil saat seluruh data input dan konfigurasi valid", () => {
        expect(runAnalysisTest()).toBeNull();
    });

    it("T02: Harus error parsing saat target_data tidak sesuai format", () => {
        expect(runAnalysisTest({ targetData: [{ target: 10 }] })).toContain(
            "Failed to parse target data"
        );
    });

    it("T03: Harus error parsing saat features_data tidak sesuai format", () => {
        expect(runAnalysisTest({ featuresData: [{ score: 1 }] })).toContain(
            "Failed to parse features data"
        );
    });

    it("T04: Harus error parsing saat focal_case_data tidak sesuai format", () => {
        expect(runAnalysisTest({ focalCaseData: [{ focal_id: 101 }] })).toContain(
            "Failed to parse focal case data"
        );
    });

    it("T05: Harus error parsing saat case_data tidak sesuai format", () => {
        expect(runAnalysisTest({ caseData: [{ case_id: 101 }] })).toContain(
            "Failed to parse case data"
        );
    });

    it("T06: Harus error parsing saat target_data_defs tidak sesuai format", () => {
        expect(runAnalysisTest({ targetDefs: [[{ name: "target" }]] })).toContain(
            "Failed to parse target data definitions"
        );
    });

    it("T07: Harus error parsing saat features_data_defs tidak sesuai format", () => {
        expect(runAnalysisTest({ featuresDefs: [[{ name: "score" }]] })).toContain(
            "Failed to parse features data definitions"
        );
    });

    it("T08: Harus error parsing saat focal_case_data_defs tidak sesuai format", () => {
        expect(
            runAnalysisTest({ focalCaseDefs: [[{ name: "focal_id" }]] })
        ).toContain("Failed to parse focal case data definitions");
    });

    it("T09: Harus error parsing saat case_data_defs tidak sesuai format", () => {
        expect(runAnalysisTest({ caseDefs: [[{ name: "case_id" }]] })).toContain(
            "Failed to parse case data definitions"
        );
    });

    it("T10: Harus error parsing saat field wajib pada config_data hilang", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    neighbors: {},
                },
            })
        ).toContain("Failed to parse configuration");
    });

    it("T11: Harus error validasi saat target dan feature tidak dipilih", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        TargetVar: null,
                        FeatureVar: null,
                    },
                },
            })
        ).toBe("At least one target or feature variable must be selected");
    });

    it("T12: Harus error validasi saat target tidak dipilih", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        TargetVar: null,
                    },
                },
            })
        ).toBe("A target variable is required for KNN classification");
    });

    it("T13: Harus error validasi saat feature tidak dipilih", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        FeatureVar: null,
                    },
                },
            })
        ).toBe("At least one feature variable is required");
    });

    it("T14: Harus error validasi saat daftar feature kosong", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        FeatureVar: [],
                    },
                },
            })
        ).toBe("At least one feature variable is required");
    });

    it("T15: Harus error validasi saat nama target kosong", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        TargetVar: " ",
                    },
                },
            })
        ).toBe("A target variable is required for KNN classification");
    });

    it("T16: Harus error validasi saat daftar feature memuat nama kosong", () => {
        expect(
            runAnalysisTest({
                config: {
                    ...validConfig,
                    main: {
                        ...validConfig.main,
                        FeatureVar: ["score", " "],
                    },
                },
            })
        ).toBe("At least one feature variable is required");
    });

    it("T17: Harus berhasil saat case_data opsional bernilai null", () => {
        expect(runAnalysisTest({ caseData: null, caseDefs: null })).toBeNull();
    });

    it("T18: Harus menyediakan hasil, hasil terformat, dan log eksekusi", () => {
        const analysis = createAnalysis();

        expect(analysis.get_results()).toBeTruthy();
        expect(analysis.get_formatted_results()).toBeTruthy();
        expect(analysis.get_all_log()).toEqual(["nearest_neighbors", "predictor_space"]);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T19: Harus mencatat error analisis dan dapat membersihkannya", () => {
        const analysis = createAnalysis({
            targetData: [[]],
            featuresData: [[]],
        });

        expect(analysis.get_all_errors()).toContain(
            "No valid data records after preprocessing"
        );
        expect(analysis.clear_errors()).toBe("Error collector cleared");
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T20: Harus menghasilkan ringkasan kasus, detail tetangga, prediksi, dan pengaturan RNG saat opsi diaktifkan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    SetSeed: true,
                    Seed: 1234,
                },
                output: {
                    ...validConfig.output,
                    CaseSummary: true,
                    PredictionResults: true,
                    ShowNeighborDetail: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.case_processing_summary).toBeTruthy();
        expect(results.system_settings).toBeTruthy();
        expect(results.prediction_results).toBeTruthy();
        expect(results.nearest_neighbors).toBeTruthy();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T21: Harus menghasilkan tabel klasifikasi dan ringkasan error untuk target kategorikal", () => {
        const analysis = createAnalysis({
            targetData: categoricalTargetData,
            targetDefs: categoricalTargetDefs,
        });
        const results = analysis.get_results();

        expect(results.classification_table).toBeTruthy();
        expect(results.error_summary).toBeTruthy();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T22: Harus menjalankan pemilihan k otomatis dengan cross-validation", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
                output: {
                    ...validConfig.output,
                    KSelectionChart: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.k_selection_chart).toBeTruthy();
        expect(results.k_selection_chart.candidates).toHaveLength(2);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T23: Harus menghasilkan predictor importance saat pembobotan feature diaktifkan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Weight: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.predictor_importance).toBeTruthy();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T24: Harus menghasilkan ringkasan feature selection saat seleksi feature diaktifkan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                features: {
                    ...validConfig.features,
                    ForwardSelection: ["score"],
                    PerformSelection: true,
                    MaxToSelect: 1,
                },
                output: {
                    ...validConfig.output,
                    FeatureSelectionSummary: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.feature_selection_summary).toBeTruthy();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T24b: Fitur forced dengan error 0 -> fixed number tetap menambah J_add fitur, minimum change berhenti", () => {
        // Fitur "a" memisahkan kategori sempurna sehingga error training fitur forced = 0.
        const zeroErrorInput = {
            targetData: [["A", "A", "A", "B", "B", "B"].map((target) => ({ target }))],
            featuresData: [
                [1, 1, 1, 10, 10, 10].map((a) => ({ a })),
                [3, 7, 1, 8, 2, 5].map((b) => ({ b })),
            ],
            caseData: null,
            targetDefs: [[variableDefinition("target", 0, "nominal")]],
            featuresDefs: [[variableDefinition("a", 1)], [variableDefinition("b", 2)]],
            caseDefs: [],
        };
        const selectionConfig = (features: Record<string, unknown>) => ({
            ...validConfig,
            main: { ...validConfig.main, FeatureVar: ["a", "b"], CaseIdenVar: null },
            features: {
                ...validConfig.features,
                ForwardSelection: ["a", "b"],
                ForcedEntryVar: ["a"],
                PerformSelection: true,
                ...features,
            },
            output: { ...validConfig.output, FeatureSelectionSummary: true },
        });

        const fixed = createAnalysis({
            ...zeroErrorInput,
            config: selectionConfig({ MaxReached: true, BelowMin: false, MaxToSelect: 1 }),
        });
        const fixedSummary = fixed.get_results().feature_selection_summary;
        expect(fixedSummary.selected_features).toEqual(["a", "b"]);
        expect(fixedSummary.stopping_reason).toBe("max_features_reached");
        fixed.free();

        const minimumChange = createAnalysis({
            ...zeroErrorInput,
            config: selectionConfig({ MaxReached: false, BelowMin: true, MinChange: 0.01 }),
        });
        const minimumChangeSummary = minimumChange.get_results().feature_selection_summary;
        expect(minimumChangeSummary.selected_features).toEqual(["a"]);
        expect(minimumChangeSummary.stopping_reason).toBe("zero_error");
        minimumChange.free();
    });

    it("T25: Harus mencatat error saat mode partition variable dipilih tanpa variabel", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
            },
        });

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );

        analysis.free();
    });

    it("T26: Harus mencatat error saat jumlah fold cross-validation kurang dari dua", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
                partition: {
                    ...validConfig.partition,
                    NumPartition: 1,
                },
                output: {
                    ...validConfig.output,
                    KSelectionChart: true,
                },
            },
        });

        expect(analysis.get_all_errors()).toContain(
            "Number of folds must be at least 2"
        );

        analysis.free();
    });

    it("T27: Harus menggunakan partition variable untuk membagi training dan holdout", () => {
        const analysis = createAnalysis({
            caseData: [
                [
                    { case_id: 101, partition: 1 },
                    { case_id: 102, partition: 1 },
                    { case_id: 103, partition: 0 },
                ],
            ],
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    PartitioningVariable: "partition",
                    UseVariable: true,
                },
                output: {
                    ...validConfig.output,
                    CaseSummary: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.case_processing_summary.training.n).toBe(2);
        expect(results.case_processing_summary.holdout.n).toBe(1);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T28: Harus mencatat error saat partition variable tidak memiliki kasus training", () => {
        const analysis = createAnalysis({
            caseData: [
                [
                    { case_id: 101, partition: 0 },
                    { case_id: 102, partition: 0 },
                    { case_id: 103, partition: 0 },
                ],
            ],
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    PartitioningVariable: "partition",
                    UseVariable: true,
                },
            },
        });

        expect(analysis.get_all_errors()).toContain(
            "No training cases found using partition variable"
        );

        analysis.free();
    });

    it("T29: Harus mencatat error saat fold variable dipilih tanpa variabel", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
                partition: {
                    ...validConfig.partition,
                    VFoldUsePartitioningVar: true,
                },
            },
        });

        expect(analysis.get_all_errors()).toContain(
            "No cross-validation fold variable specified"
        );

        analysis.free();
    });

    it("T30: Harus mencatat error saat jumlah fold melebihi jumlah kasus training", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
                partition: {
                    ...validConfig.partition,
                    NumPartition: 4,
                },
            },
        });

        expect(analysis.get_all_errors()).toContain(
            "Number of folds cannot exceed the number of training samples"
        );

        analysis.free();
    });

    it("T31: Harus menyimpan nilai prediksi dan hasil pembagian partition saat diminta", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                save: {
                    ...validConfig.save,
                    HasTargetVar: true,
                    RandomAssignToPartition: true,
                },
            },
        });
        const results = analysis.get_results();
        const variableNames = results.saved_variables.variables.map(
            (variable: { name: string }) => variable.name
        );

        expect(variableNames).toEqual([
            "KNN_PredictedValue",
            "KNN_Partition",
        ]);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T32: Harus menyimpan probabilitas setiap kategori saat target kategorikal diminta", () => {
        const analysis = createAnalysis({
            targetData: categoricalTargetData,
            targetDefs: categoricalTargetDefs,
            config: {
                ...validConfig,
                save: {
                    ...validConfig.save,
                    IsCateTargetVar: true,
                },
            },
        });
        const results = analysis.get_results();
        const variableNames = results.saved_variables.variables.map(
            (variable: { name: string }) => variable.name
        );

        expect(variableNames).toEqual([
            "KNN_Probability_A",
            "KNN_Probability_B",
        ]);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T33: Harus memilih k dan feature bersama-sama saat kedua opsi diaktifkan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
                features: {
                    ...validConfig.features,
                    ForwardSelection: ["score"],
                    PerformSelection: true,
                    MaxToSelect: 1,
                },
                output: {
                    ...validConfig.output,
                    FeatureSelectionSummary: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.feature_selection_summary).toBeTruthy();
        expect(results.k_feature_selection_summary).toHaveLength(2);
        expect(results.k_selection_chart).toBeUndefined();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T34: Harus membatasi detail tetangga pada focal case yang dipilih", () => {
        const analysis = createAnalysis({
            focalCaseData: [
                [
                    { focal_id: 101 },
                    { focal_id: 102 },
                    { focal_id: 103 },
                ],
            ],
            config: {
                ...validConfig,
                main: {
                    ...validConfig.main,
                    FocalCaseIdenVar: "focal_id",
                },
                output: {
                    ...validConfig.output,
                    ShowNeighborDetail: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.nearest_neighbors.focal_neighbor_sets).toHaveLength(3);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T35: Harus tetap gagal parsing config tanpa detail tambahan saat config_data mengandung referensi sirkular (JSON.stringify gagal)", () => {
        const circularConfig: Record<string, unknown> = {
            ...validConfig,
            neighbors: {}, // field wajib hilang -> parsing config tetap gagal
        };
        circularConfig.self = circularConfig; // referensi sirkular -> JSON.stringify melempar exception

        const error = runAnalysisTest({ config: circularConfig });

        expect(error).toContain("Failed to parse configuration");
        expect(error).not.toContain("Raw config:");
    });

    it("T36: Harus tetap gagal parsing config tanpa detail tambahan saat config_data adalah undefined (JSON.stringify(undefined) bukan string)", () => {
        let error: unknown = null;

        try {
            const analysis = new KNNAnalysis(
                validTargetData,
                validFeaturesData,
                [],
                validCaseData,
                validTargetDefs,
                validFeaturesDefs,
                [],
                validCaseDefs,
                undefined
            );
            analysis.free();
        } catch (caught) {
            error = caught;
        }

        expect(error).toContain("Failed to parse configuration");
        expect(error).not.toContain("Raw config:");
    });

    it("T37: Harus mencatat error ringkasan kasus saat CaseSummary aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
                output: {
                    ...validConfig.output,
                    CaseSummary: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.case_processing_summary).toBeUndefined();

        analysis.free();
    });

    it("T38: Harus mencatat error feature selection saat PerformSelection aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                features: {
                    ...validConfig.features,
                    ForwardSelection: ["score"],
                    PerformSelection: true,
                    MaxToSelect: 1,
                },
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.feature_selection_summary).toBeUndefined();

        analysis.free();
    });

    it("T39: Harus tetap menjalankan feature selection walau FeatureSelectionSummary dimatikan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                features: {
                    ...validConfig.features,
                    ForwardSelection: ["score"],
                    PerformSelection: true,
                    MaxToSelect: 1,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.feature_selection_summary).toBeUndefined();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T40: Harus tetap memilih k otomatis walau KSelectionChart dimatikan", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Specify: false,
                    AutoSelection: true,
                    MinK: 1,
                    MaxK: 2,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.k_selection_chart).toBeUndefined();
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T41: Harus mencatat error detail tetangga saat ShowNeighborDetail aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
                output: {
                    ...validConfig.output,
                    ShowNeighborDetail: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.nearest_neighbors).toBeUndefined();

        analysis.free();
    });

    it("T42: Harus mencatat error prediction_results saat PredictionResults aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
                output: {
                    ...validConfig.output,
                    PredictionResults: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.prediction_results).toBeUndefined();

        analysis.free();
    });

    it("T43: Harus mencatat error saved_variables saat HasTargetVar aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
                save: {
                    ...validConfig.save,
                    HasTargetVar: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.saved_variables).toBeUndefined();

        analysis.free();
    });

    it("T44: Harus mencatat error saved_variables saat IsCateTargetVar aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            targetData: categoricalTargetData,
            targetDefs: categoricalTargetDefs,
            config: {
                ...validConfig,
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
                save: {
                    ...validConfig.save,
                    IsCateTargetVar: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.saved_variables).toBeUndefined();

        analysis.free();
    });

    it("T45: Harus mencatat error predictor importance saat Weight aktif namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Weight: true,
                },
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.predictor_importance).toBeUndefined();

        analysis.free();
    });

    it("T46: Harus menyimpan variabel partisi acak saat RandomAssignToPartition aktif sendirian", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                save: {
                    ...validConfig.save,
                    RandomAssignToPartition: true,
                },
            },
        });
        const results = analysis.get_results();
        const variableNames = results.saved_variables.variables.map(
            (variable: { name: string }) => variable.name
        );

        expect(variableNames).toEqual(["KNN_Partition"]);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T47: Harus menyimpan variabel fold acak saat RandomAssignToFold aktif sendirian", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                save: {
                    ...validConfig.save,
                    RandomAssignToFold: true,
                },
            },
        });
        const results = analysis.get_results();
        const variableNames = results.saved_variables.variables.map(
            (variable: { name: string }) => variable.name
        );

        expect(variableNames).toEqual(["KNN_Fold"]);
        expect(analysis.get_all_errors()).toBe("No errors occurred.");

        analysis.free();
    });

    it("T48: Harus mencatat error saved_variables saat RandomAssignToPartition aktif sendirian namun partisi tidak valid", () => {
        const analysis = createAnalysis({
            config: {
                ...validConfig,
                save: {
                    ...validConfig.save,
                    RandomAssignToPartition: true,
                },
                partition: {
                    ...validConfig.partition,
                    UseVariable: true,
                },
            },
        });
        const results = analysis.get_results();

        expect(analysis.get_all_errors()).toContain(
            "No partition variable specified"
        );
        expect(results.saved_variables).toBeUndefined();

        analysis.free();
    });

    it("T49: Harus mencatat error classification table dan error summary saat Weight aktif dengan partisi acak training kosong (target kategorikal)", () => {
        const analysis = createAnalysis({
            targetData: categoricalTargetData,
            targetDefs: categoricalTargetDefs,
            config: {
                ...validConfig,
                neighbors: {
                    ...validConfig.neighbors,
                    Weight: true,
                },
                partition: {
                    ...validConfig.partition,
                    UseRandomly: true,
                    TrainingNumber: 0,
                },
            },
        });
        const results = analysis.get_results();

        expect(results.classification_table).toBeUndefined();
        expect(results.error_summary).toBeUndefined();
        expect(analysis.get_all_errors()).toContain(
            "Feature selection requires at least one training case"
        );
        expect(analysis.get_all_errors()).toContain(
            "Classification table not available for error summary calculation"
        );

        analysis.free();
    });
});
