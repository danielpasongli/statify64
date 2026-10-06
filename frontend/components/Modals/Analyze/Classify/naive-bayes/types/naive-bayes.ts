import type { StwvConfig } from "@/components/Modals/Transform/StringToWordVector/config";

/* =========================
   MAIN TAB
========================= */

// AGENTS.md §3.3: dua mode Variable Specification Method, saling
// eksklusif, dibedakan oleh SATU field diskriminator ini (Temuan 2
// laporan regresi Fase 18 -- sebelumnya field ini tidak ada sama sekali,
// mode hanya diturunkan secara heuristik dari isi array, lihat riwayat
// versi lama `getEffectivePredictors` di `useNaiveBayesValidation.ts`).
export type NaiveBayesSpecificationMode = "exclude" | "candidates";

// --- v2 (AGENTS_V2 §4) ---
export type NaiveBayesTextSource = "none" | "raw" | "vector";
export type NaiveBayesNumericLikelihood = "gaussian" | "gaussian_minstd";
export type NaiveBayesTextLikelihood = "multinomial" | "bernoulli" | "complement";

export type NaiveBayesMainType = {
    TargetVar: string | null;
    SpecificationMode: NaiveBayesSpecificationMode;
    ExcludedVar: string[] | null;
    CandidateFactors: string[] | null;
    CandidateCovariates: string[] | null;
    // --- v2 (AGENTS_V2 §4): Text Features ---------------------------------
    // `TextSource` tetap disimpan, tetapi nilai efektifnya diturunkan dari isi
    // slot (lihat `getEffectiveTextSource` di useNaiveBayesValidation.ts).
    TextSource: NaiveBayesTextSource;
    RawTextVar: string | null;
    TextVectorVars: string[] | null;
};

/* =========================
   OPTIONS TAB
========================= */

export type NaiveBayesOptionsType = {
    MissingValuePolicy: "exclude" | "impute";
    UnseenCategoryPolicy: "ignore" | "smoothing";
    SmoothingAlpha: number;
    VarianceFloor: number;
    // --- v2 (AGENTS_V2 §4) ---
    NumericLikelihood: NaiveBayesNumericLikelihood;
    NumericLikelihoodOverrides: Record<string, NaiveBayesNumericLikelihood>;
    TextLikelihood: NaiveBayesTextLikelihood;
    TextAlpha: number;
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
    // --- v2 (AGENTS_V2 §3.7): Text Feature Table ---
    TextFeatureTable: boolean;
    TextTopK: number;
};

/* =========================
   AGGREGATE TYPE
========================= */

export type NaiveBayesType = {
    main: NaiveBayesMainType;
    options: NaiveBayesOptionsType;
    validation: NaiveBayesValidationType;
    output: NaiveBayesOutputType;
    // v2 (AGENTS_V2 §3.5/§4): konfigurasi Text Preprocessing (jalur Raw Text),
    // memakai ulang tipe STWV (impor read-only).
    text: StwvConfig;
};

/* =========================
   PAYLOAD TEXT (AGENTS_V2 §5.1)
   Sejajar baris dengan target yang dikirim ke worker.
========================= */

export type NaiveBayesTextPayload =
    | { source: "none" }
    | { source: "raw"; variable: string; values: (string | null)[] }
    | { source: "vector"; columns: string[]; values: (number | null)[][] };

/* =========================
   CONTAINER
========================= */

export type NaiveBayesContainerProps = {
    onClose: () => void;
};
