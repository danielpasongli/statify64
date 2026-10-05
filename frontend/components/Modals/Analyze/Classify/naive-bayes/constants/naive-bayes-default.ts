import type {
    NaiveBayesMainType,
    NaiveBayesOptionsType,
    NaiveBayesValidationType,
    NaiveBayesOutputType,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

export const NaiveBayesMainDefault: NaiveBayesMainType = {
    TargetVar: null,
    // AGENTS.md §3.3 poin 1: kondisi awal (panel baru dibuka, belum ada
    // interaksi) adalah mode "exclude" dengan ExcludedVariables kosong.
    // Diperbaiki Fase 18 (Temuan 2): sebelumnya tidak ada field
    // diskriminator ini sama sekali -- mode hanya diturunkan secara
    // heuristik dari isi array (lihat riwayat `getEffectivePredictors`).
    SpecificationMode: "exclude",
    ExcludedVar: null,
    CandidateFactors: null,
    CandidateCovariates: null,
};

export const NaiveBayesOptionsDefault: NaiveBayesOptionsType = {
    MissingValuePolicy: "exclude",
    UnseenCategoryPolicy: "smoothing",
    SmoothingAlpha: 1,
    VarianceFloor: 1e-9,
};

export const NaiveBayesValidationDefault: NaiveBayesValidationType = {
    ValidationMethod: "holdout",
    // AGENTS.md §4.2: TrainingPercentage default 70 (bukan 30 - nilai
    // lama adalah bug Fase 3/15 di mana field ini sebenarnya dipakai
    // sebagai HoldoutPercent, lihat Temuan 1 laporan regresi Fase 18.
    // Sudah diperbaiki: field ini sekarang benar-benar TrainingPercentage.
    TrainingPercentage: 70,
    KFolds: 10,
    RandomSeed: null,
};

// Sesuai AGENTS.md §4.3: keempat output default tercentang (true).
export const NaiveBayesOutputDefault: NaiveBayesOutputType = {
    CaseProcessingSummary: true,
    AttributeDistributionTable: true,
    ModelEvaluationMetrics: true,
    ConfusionMatrix: true,
};

export const NaiveBayesDefault: NaiveBayesType = {
    main: NaiveBayesMainDefault,
    options: NaiveBayesOptionsDefault,
    validation: NaiveBayesValidationDefault,
    output: NaiveBayesOutputDefault,
};
