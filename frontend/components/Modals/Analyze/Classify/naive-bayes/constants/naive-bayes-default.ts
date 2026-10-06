import {
    STWV_DEFAULT_CONFIG,
    type StwvConfig,
} from "@/components/Modals/Transform/StringToWordVector/config";
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
    // v2 (AGENTS_V2 §4): tanpa Text Features.
    TextSource: "none",
    RawTextVar: null,
    TextVectorVars: null,
};

export const NaiveBayesOptionsDefault: NaiveBayesOptionsType = {
    MissingValuePolicy: "exclude",
    UnseenCategoryPolicy: "smoothing",
    SmoothingAlpha: 1,
    VarianceFloor: 1e-9,
    // v2 (AGENTS_V2 §4)
    NumericLikelihood: "gaussian",
    NumericLikelihoodOverrides: {},
    TextLikelihood: "multinomial",
    TextAlpha: 1,
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
    // v2 (AGENTS_V2 §3.7)
    TextFeatureTable: true,
    TextTopK: 100,
};

export const NaiveBayesDefault: NaiveBayesType = {
    main: NaiveBayesMainDefault,
    options: NaiveBayesOptionsDefault,
    validation: NaiveBayesValidationDefault,
    output: NaiveBayesOutputDefault,
    // v2: konfigurasi Text Preprocessing = default STWV (AGENTS_V2 §3.5).
    text: STWV_DEFAULT_CONFIG,
};

/**
 * Salinan dalam (deep clone) default STWV supaya state form tidak berbagi
 * referensi dengan konstanta `STWV_DEFAULT_CONFIG` / `NaiveBayesDefault`.
 */
const cloneStwvConfig = (config: StwvConfig): StwvConfig => ({
    ...config,
    stopwords: { ...config.stopwords },
    stemming: { ...config.stemming },
    tokenizer: { ...config.tokenizer },
    vectorization: { ...config.vectorization },
});

/**
 * Menggabungkan data tersimpan (IndexedDB, bisa dari versi lama tanpa field v2)
 * dengan default, secara dalam per section (AGENTS_V2 §4):
 * - `main`/`options`/`output`/`validation`: default lalu ditimpa field tersimpan;
 * - `NumericLikelihoodOverrides`: dicopy (bukan referensi default);
 * - `text` (StwvConfig): digabung per sub-objek (stopwords/stemming/tokenizer/
 *   vectorization) sehingga field STWV baru tetap terisi default.
 * Mengembalikan objek baru; `saved` tidak diubah.
 */
export function mergeWithDefaults(
    saved: Partial<{
        [K in keyof NaiveBayesType]: Partial<NaiveBayesType[K]> | null | undefined;
    }> | null | undefined
): NaiveBayesType {
    const s = saved ?? {};
    const savedText = (s.text ?? {}) as Partial<StwvConfig>;
    const defText = cloneStwvConfig(NaiveBayesDefault.text);
    const options = { ...NaiveBayesDefault.options, ...(s.options ?? {}) };
    return {
        main: { ...NaiveBayesDefault.main, ...(s.main ?? {}) },
        options: {
            ...options,
            NumericLikelihoodOverrides: { ...(options.NumericLikelihoodOverrides ?? {}) },
        },
        validation: { ...NaiveBayesDefault.validation, ...(s.validation ?? {}) },
        output: { ...NaiveBayesDefault.output, ...(s.output ?? {}) },
        text: {
            ...defText,
            ...savedText,
            stopwords: { ...defText.stopwords, ...(savedText.stopwords ?? {}) },
            stemming: { ...defText.stemming, ...(savedText.stemming ?? {}) },
            tokenizer: { ...defText.tokenizer, ...(savedText.tokenizer ?? {}) },
            vectorization: { ...defText.vectorization, ...(savedText.vectorization ?? {}) },
        },
    };
}
