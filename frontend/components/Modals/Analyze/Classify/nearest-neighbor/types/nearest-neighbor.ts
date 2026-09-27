/* =========================
   MAIN TAB
========================= */

export type KNNMainType = {
    TargetVar: string | null;
    // DepVar: string | null;
    FeatureVar: string[] | null;
    CaseIdenVar: string | null;
    FocalCaseIdenVar: string | null;
    NormCovar: boolean;
};

export type KNNDialogProps = {
    data: KNNMainType;
    updateFormData: (
        field: keyof KNNMainType,
        value: string[] | string | boolean | null
    ) => void;
    externalErrors?: string[];
    showFieldHelp?: boolean;
};

/* =========================
   NEIGHBORS TAB
========================= */

export type KNNNeighborsType = {
    Specify: boolean;
    AutoSelection: boolean;
    SpecifyK: number | null;
    MinK: number | null;
    MaxK: number | null;
    MetricEucli: boolean;
    MetricManhattan: boolean;
    Weight: boolean;
    PredictionsMean: boolean;
    PredictionsMedian: boolean;
};

export type KNNNeighborsProps = {
    data: KNNNeighborsType;
    updateFormData: (
        field: keyof KNNNeighborsType,
        value: number | boolean | null
    ) => void;
    hasTarget: boolean;
    targetType: "scale" | "nominal" | "ordinal" | null;
    showFieldHelp?: boolean;
};

/* =========================
   FEATURES TAB
========================= */

export type KNNFeaturesType = {
    ForwardSelection: string[] | null;
    ForcedEntryVar: string[] | null;
    FeaturesToEvaluate: number | null;
    ForcedFeatures: number | null;
    PerformSelection: boolean;
    MaxReached: boolean;
    BelowMin: boolean;
    MaxToSelect: number | null;
    MinChange: number | null;
};

export type KNNFeaturesProps = {
    data: KNNFeaturesType;
    updateFormData: (
        field: keyof KNNFeaturesType,
        value: string[] | number | string | boolean | null
    ) => void;
    hasTarget: boolean;
    showFieldHelp?: boolean;
};

/* =========================
   PARTITION TAB
========================= */

export type KNNPartitionType = {
    PartitioningVariable: string | null;
    UseRandomly: boolean;
    UseVariable: boolean;
    VFoldPartitioningVariable: string | null;
    VFoldUseRandomly: boolean;
    VFoldUsePartitioningVar: boolean;
    TrainingNumber: number | null;
    NumPartition: number | null;
    SetSeed: boolean;
    Seed: number | null;
};

export type KNNPartitionProps = {
    data: KNNPartitionType;
    updateFormData: (
        field: keyof KNNPartitionType,
        value: string[] | number | string | boolean | null
    ) => void;
    availableVariables: string[];
    isAutoK: boolean;
    isFeatureSelectionActive: boolean;
    showFieldHelp?: boolean;
};

/* =========================
   SAVE TAB
========================= */

export type KNNSaveType = {
    AutoName: boolean;
    CustomName: boolean;
    MaxCatsToSave: number | null;
    HasTargetVar: boolean;
    IsCateTargetVar: boolean;
    RandomAssignToPartition: boolean;
    RandomAssignToFold: boolean;
    PredictedValueName?: string | null;
    ProbabilityName?: string | null;
    PartitionName?: string | null;
    FoldName?: string | null;
};

export type KNNSaveProps = {
    data: KNNSaveType;
    updateFormData: (
        field: keyof KNNSaveType,
        value: number | boolean | string | null
    ) => void;
    hasTarget: boolean;
    targetType: "scale" | "nominal" | "ordinal" | null;
    featureCount: number;
    isAutoK: boolean;
    isFeatureSelectionActive: boolean;
    isUsingPartitionVariable: boolean;
    isUsingFoldVariable: boolean;
    showFieldHelp?: boolean;
};

/* =========================
   OUTPUT TAB
========================= */

export type KNNOutputType = {
    CaseSummary: boolean;
    FeatureSelectionSummary: boolean;
    KSelectionChart: boolean;
    PredictorSpace: boolean;
    PredictionResults: boolean;
    ShowNeighborDetail: boolean;
    PeersChart: boolean;
    QuadrantMap: boolean;
    ChartAndTable: boolean;
};

export type KNNOutputProps = {
    data: KNNOutputType;
    updateFormData: (
        field: keyof KNNOutputType,
        value: string | boolean | null
    ) => void;
    isAutoK: boolean;
    isFeatureSelectionActive: boolean;
    showFieldHelp?: boolean;
};

export type KNNType = {
    main: KNNMainType;
    neighbors: KNNNeighborsType;
    features: KNNFeaturesType;
    partition: KNNPartitionType;
    save: KNNSaveType;
    output: KNNOutputType;
};

/* =========================
   CONTAINER
========================= */

export type KNNContainerProps = {
    onClose: () => void;
};
