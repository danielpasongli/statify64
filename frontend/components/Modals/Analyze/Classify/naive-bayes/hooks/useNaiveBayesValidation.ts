import { useMemo } from "react";
import type {
    NaiveBayesTextSource,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import { validateStwvConfig } from "@/components/Modals/Transform/StringToWordVector/config";
import type { Variable } from "@/types/Variable";

export type NaiveBayesValidationResult = {
    isValid: boolean;
    errors: string[];
};

// Batas seed mengikuti Rust: seed dikonversi ke u32 untuk Mersenne Twister
// (identik dengan MAX_SEED di useNearestNeighborValidation.ts, AGENTS.md §4.2).
const MAX_SEED = 4294967295;

// AGENTS_V2 §3.7 & §6: batas validasi Text (alpha > 0 dan <= 999 seperti
// Smoothing Alpha v1; Top-k bilangan bulat 1-1000).
const MAX_TEXT_ALPHA = 999;
const MIN_TEXT_TOP_K = 1;
const MAX_TEXT_TOP_K = 1000;

/**
 * Sumber Text efektif (AGENTS_V2 §2 V2): diturunkan dari ISI slot, bukan dari
 * `main.TextSource` yang tersimpan (bisa basi pada data lama). Raw Text Variable
 * menang bila terisi; selain itu Word-Vector Variables; selain itu "none".
 */
export function getEffectiveTextSource(
    main: NaiveBayesType["main"]
): NaiveBayesTextSource {
    if (main.RawTextVar) return "raw";
    if ((main.TextVectorVars ?? []).length > 0) return "vector";
    return "none";
}

/**
 * Nama kolom Text yang dikirim ke worker (urutan sama dengan payload
 * `NaiveBayesTextPayload`): `[RawTextVar]`, daftar Word-Vector, atau kosong.
 * Container membangun `dataVariables` sebagai
 * `[target, ...getEffectivePredictors, ...getTextColumnNames]` HANYA untuk jalur
 * Word-Vector. Raw Text Variable tidak lewat `dataVariables` (lihat
 * `rawTextValues` pada `analyzeNaiveBayes`).
 */
export function getTextColumnNames(main: NaiveBayesType["main"]): string[] {
    const source = getEffectiveTextSource(main);
    if (source === "raw") return [main.RawTextVar as string];
    if (source === "vector") return [...(main.TextVectorVars ?? [])];
    return [];
}

/**
 * Predictor efektif menurut kontrak AGENTS.md §3.3.
 *
 * Diperbaiki di Fase 18 (Temuan 2 -- sebelumnya bagian ini berjudul
 * "CATATAN PENYIMPANGAN"): mode kini dibaca LANGSUNG dari satu field
 * diskriminator `main.SpecificationMode` ("exclude" | "candidates"),
 * bukan lagi diturunkan secara heuristik dari isi array
 * (`CandidateFactors`/`CandidateCovariates` terisi atau tidak). Heuristik
 * lama salah kalau mode aktif sebenarnya "exclude" tapi array mode
 * "candidates" masih menyimpan sisa data lama yang belum sempat
 * dikosongkan -- lihat regression test untuk kasus ini di
 * `hooks/__tests__/useNaiveBayesValidation.test.ts`.
 *
 * Exclusivity penuh (auto-activate saat drop pertama ke blok tidak
 * aktif, auto-clear isi mode sebelumnya kembali ke pool "available",
 * graying-out blok tidak aktif) diimplementasikan di
 * `components/variables-tab.tsx`, yang menjamin isi mode yang tidak
 * aktif SELALU kosong begitu mode berpindah. Fungsi ini tetap membaca
 * `SpecificationMode` secara eksplisit (bukan bergantung pada jaminan
 * itu) supaya tetap benar untuk state yang mungkin belum melalui
 * `variables-tab.tsx` (data lama di IndexedDB, pemanggilan langsung dari
 * test, dll).
 */
export function getEffectivePredictors(
    main: NaiveBayesType["main"],
    variables: Variable[]
): string[] {
    const target = main.TargetVar;
    // Fallback "exclude" untuk kompatibilitas mundur dengan data
    // tersimpan dari sebelum field ini ada -- lihat fallback identik di
    // `variables-tab.tsx`.
    const mode = main.SpecificationMode ?? "exclude";

    if (mode === "candidates") {
        const candidateFactors = main.CandidateFactors ?? [];
        const candidateCovariates = main.CandidateCovariates ?? [];
        return [...candidateFactors, ...candidateCovariates];
    }

    // v2 (AGENTS_V2 §0 V3 & §3.3): pada mode Exclude, yang otomatis keluar
    // hanya target, ExcludedVar, RawTextVar, TextVectorVars, dan `unknown`.
    // Variabel STRING lain TETAP ikut sebagai predictor (perilaku v1).
    const excluded = new Set(main.ExcludedVar ?? []);
    if (main.RawTextVar) excluded.add(main.RawTextVar);
    for (const name of main.TextVectorVars ?? []) excluded.add(name);

    return variables
        .filter((v) => v.measure !== "unknown")
        .map((v) => v.name)
        .filter((name) => name !== target && !excluded.has(name));
}

/**
 * Validasi terpusat menu Naive Bayes (pola `useNearestNeighborValidation.ts`):
 * - `validation.isValid` menentukan disabled/enabled tombol OK: target harus
 *   terisi DAN predictor efektif tidak boleh kosong (AGENTS.md §4.4).
 * - v2 (AGENTS_V2 §3.3): OK aktif bila target terisi DAN (predictor efektif
 *   tidak kosong ATAU Text Features terisi). Pilihan Complement yang bercampur
 *   dengan predictor Numeric/Categorical, serta konfigurasi Text Preprocessing
 *   yang tidak sah (jalur Raw Text), memblokir OK.
 * - `validateNumericInputs()` menggabungkan validasi numerik (Smoothing
 *   Alpha, persentase training/holdout, jumlah fold, seed) jadi satu pintu,
 *   dipanggil baik saat pindah tab maupun sebelum submit.
 */
export function useNaiveBayesValidation(
    formData: NaiveBayesType,
    variables: Variable[]
) {
    const validation = useMemo<NaiveBayesValidationResult>(() => {
        const errors: string[] = [];

        if (!formData.main.TargetVar) {
            errors.push("Select a target variable.");
        }

        const effectivePredictors = getEffectivePredictors(
            formData.main,
            variables
        );
        const textSource = getEffectiveTextSource(formData.main);
        const hasText = textSource !== "none";
        // N5-8: pada mode Exclude tanpa target, daftar predictor efektif (semua
        // variabel selain target) belum bermakna, jadi pesan predictor tetap
        // ditampilkan bila Text Features juga kosong. Hanya memengaruhi pesan:
        // form sudah tidak valid karena target kosong. `getEffectivePredictors`
        // tidak diubah (perilaku v1 dipertahankan).
        const predictorBelumBermakna =
            !formData.main.TargetVar &&
            (formData.main.SpecificationMode ?? "exclude") === "exclude";
        if (
            (effectivePredictors.length === 0 || predictorBelumBermakna) &&
            !hasText
        ) {
            errors.push(
                "Select at least one predictor variable (using Variables to Exclude or Candidate Factors / Covariates) or add Text Features."
            );
        }

        // AGENTS_V2 §0 V5 & §3.6: Complement hanya sah bila model HANYA berisi
        // Text Features (kode NB_E_COMPLEMENT_MIXED).
        if (
            hasText &&
            formData.options.TextLikelihood === "complement" &&
            effectivePredictors.length > 0
        ) {
            errors.push(
                "Complement Naive Bayes can only be used when the model contains Text Features only. Choose Multinomial or Bernoulli, or remove the numeric/categorical predictors."
            );
        }

        // AGENTS_V2 §3.5: jalur Raw Text memvalidasi konfigurasi Text Preprocessing.
        if (textSource === "raw") {
            for (const message of validateStwvConfig(formData.text)) {
                errors.push(`Text Preprocessing: ${message}`);
            }
        }

        return { isValid: errors.length === 0, errors };
    }, [formData.main, formData.options.TextLikelihood, formData.text, variables]);

    const validateNumericInputs = (): string | null =>
        getNumericInputError(formData);

    return { validation, validateNumericInputs };
}

/**
 * Validasi input angka lintas tab Options & Validation, mengikuti pola
 * `getNumericInputError` KNN. Batas atas jumlah fold terhadap ukuran
 * dataset/kelas terkecil (AGENTS.md §5.5) sengaja TIDAK dicek di sini karena
 * memerlukan data aktual dan merupakan tanggung jawab engine Rust (rencana
 * Fase 11 di PLAN.md) — di Fase 5 (Bagian A, worker stub) hanya batas yang
 * bisa ditentukan murni dari nilai form yang divalidasi.
 */
export function getNumericInputError(formData: NaiveBayesType): string | null {
    const { options, validation } = formData;
    const hasTextFeatures = getEffectiveTextSource(formData.main) !== "none";

    // Smoothing Alpha — AGENTS.md §4.1 & §5.2: harus > 0, boleh desimal,
    // maksimum 999.
    if (
        typeof options.SmoothingAlpha !== "number" ||
        !Number.isFinite(options.SmoothingAlpha)
    ) {
        return "Enter a valid number for Smoothing Alpha.";
    }
    if (options.SmoothingAlpha <= 0) {
        return "Smoothing Alpha must be greater than 0.";
    }
    if (options.SmoothingAlpha > 999) {
        return "Smoothing Alpha must not exceed 999.";
    }

    // Text Features (AGENTS_V2 §3.6/§3.7) — hanya divalidasi bila Text Features
    // terisi, supaya field tersembunyi tidak memblokir model tanpa teks.
    // Top-k hanya relevan bila Text Feature Table dicentang.
    if (hasTextFeatures) {
        if (
            typeof options.TextAlpha !== "number" ||
            !Number.isFinite(options.TextAlpha)
        ) {
            return "Enter a valid number for Text smoothing alpha.";
        }
        if (options.TextAlpha <= 0) {
            return "Text smoothing alpha must be greater than 0.";
        }
        if (options.TextAlpha > MAX_TEXT_ALPHA) {
            return `Text smoothing alpha must not exceed ${MAX_TEXT_ALPHA}.`;
        }
        if (formData.output.TextFeatureTable) {
            const k = formData.output.TextTopK;
            if (
                typeof k !== "number" ||
                !Number.isInteger(k) ||
                k < MIN_TEXT_TOP_K ||
                k > MAX_TEXT_TOP_K
            ) {
                return `Top-k terms per class must be a whole number between ${MIN_TEXT_TOP_K} and ${MAX_TEXT_TOP_K}.`;
            }
        }
    }

    // Training/Holdout — AGENTS.md §4.2: TrainingPercentage rentang 1-99.
    // HoldoutPercentage TIDAK disimpan sebagai field terpisah — selalu
    // diturunkan sebagai (100 - TrainingPercentage) dan ditampilkan
    // read-only di dialogs/validation.tsx. Diperbaiki Fase 18 (Temuan 1):
    // sebelumnya field ini keliru dipakai sebagai HoldoutPercent walau
    // label UI-nya "Training Percentage".
    if (validation.ValidationMethod === "holdout") {
        const pct = validation.TrainingPercentage;
        if (
            typeof pct !== "number" ||
            !Number.isInteger(pct) ||
            pct < 1 ||
            pct > 99
        ) {
            return "Training percentage must be a whole number between 1 and 99.";
        }
    }

    // Cross-Validation Folds — AGENTS.md §4.2: default 10, minimum 1.
    if (validation.ValidationMethod === "kfold") {
        const folds = validation.KFolds;
        if (typeof folds !== "number" || !Number.isInteger(folds) || folds < 1) {
            return "The number of folds must be at least 1.";
        }
    }

    // Set Seed — AGENTS.md §4.2: 0 sampai 4294967295 (batas u32 di Rust).
    // RandomSeed !== null berarti "Set Seed" tercentang (tidak ada field
    // SetSeed terpisah pada tipe NaiveBayesValidationType).
    if (validation.RandomSeed !== null) {
        if (
            typeof validation.RandomSeed !== "number" ||
            !Number.isInteger(validation.RandomSeed) ||
            validation.RandomSeed < 0 ||
            validation.RandomSeed > MAX_SEED
        ) {
            return `The seed must be a whole number between 0 and ${MAX_SEED}.`;
        }
    }

    return null;
}
