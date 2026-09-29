/* =========================
   MAIN TAB
========================= */

export type NaiveBayesMainType = {
    TargetVar: string | null;
    ExcludedVar: string[] | null;
    CandidateFactors: string[] | null;
    CandidateCovariates: string[] | null;
};

/* =========================
   OPTIONS TAB
========================= */

export type NaiveBayesOptionsType = {
    MissingValuePolicy: "exclude" | "impute";
    UnseenCategoryPolicy: "ignore" | "smoothing";
    SmoothingAlpha: number;
    VarianceFloor: number;
};

/* =========================
   VALIDATION TAB
========================= */

export type NaiveBayesValidationType = {
    ValidationMethod: "holdout" | "kfold";
    TrainingPercentage: number;
    KFolds: number;
    RandomSeed: number | null;
};

/* =========================
   OUTPUT TAB
   Empat opsi ini wajib persis sesuai AGENTS.md §4.3: Case Processing
   Summary, Attribute Distribution Table, Model Evaluation Metrics,
   Confusion Matrix — semuanya default tercentang (lihat
   constants/naive-bayes-default.ts). Jangan menambah/mengganti field di
   sini tanpa memperbarui AGENTS.md §4.3 terlebih dahulu.
========================= */

export type NaiveBayesOutputType = {
    CaseProcessingSummary: boolean;
    AttributeDistributionTable: boolean;
    ModelEvaluationMetrics: boolean;
    ConfusionMatrix: boolean;
};

/* =========================
   AGGREGATE TYPE
========================= */

export type NaiveBayesType = {
    main: NaiveBayesMainType;
    options: NaiveBayesOptionsType;
    validation: NaiveBayesValidationType;
    output: NaiveBayesOutputType;
};

/* =========================
   CONTAINER
========================= */

export type NaiveBayesContainerProps = {
    onClose: () => void;
};
