import type {
    KNNFeaturesType,
    KNNMainType,
    KNNNeighborsType,
    KNNOutputType,
    KNNPartitionType,
    KNNSaveType,
    KNNType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";

export const KNNMainDefault: KNNMainType = {
    TargetVar: null,
    FeatureVar: null,
    CaseIdenVar: null,
    FocalCaseIdenVar: null,
    NormCovar: true,
};

export const KNNNeighborsDefault: KNNNeighborsType = {
    Specify: true,
    AutoSelection: false,
    SpecifyK: 3,
    MinK: null,
    MaxK: null,
    MetricEucli: true,
    MetricManhattan: false,
    Weight: false,
    PredictionsMean: true,
    PredictionsMedian: false,
};

export const KNNFeaturesDefault: KNNFeaturesType = {
    ForwardSelection: null,
    ForcedEntryVar: null,
    FeaturesToEvaluate: 0,
    ForcedFeatures: 0,
    PerformSelection: false,
    MaxReached: true,
    BelowMin: false,
    MaxToSelect: null,
    MinChange: 0.01,
};

export const KNNPartitionDefault: KNNPartitionType = {
    PartitioningVariable: null,
    UseRandomly: true,
    UseVariable: false,
    VFoldPartitioningVariable: null,
    VFoldUseRandomly: true,
    VFoldUsePartitioningVar: false,
    TrainingNumber: 70,
    NumPartition: 10,
    SetSeed: false,
    Seed: null,
};

export const KNNSaveDefault: KNNSaveType = {
    AutoName: true,
    CustomName: false,
    MaxCatsToSave: null,
    HasTargetVar: false,
    IsCateTargetVar: false,
    RandomAssignToPartition: false,
    RandomAssignToFold: false,
    PredictedValueName: "KNN_PredictedValue",
    ProbabilityName: "KNN_Probability",
    PartitionName: "KNN_Partition",
    FoldName: "KNN_Fold",
};

export const KNNOutputDefault: KNNOutputType = {
    CaseSummary: true,
    FeatureSelectionSummary: false,
    KSelectionChart: false,
    PredictorSpace: true,
    PredictionResults: false,
    ShowNeighborDetail: false,
    PeersChart: false,
    QuadrantMap: false,
    ChartAndTable: true,
};

export const KNNDefault: KNNType = {
    main: KNNMainDefault,
    neighbors: KNNNeighborsDefault,
    features: KNNFeaturesDefault,
    partition: KNNPartitionDefault,
    save: KNNSaveDefault,
    output: KNNOutputDefault,
};
