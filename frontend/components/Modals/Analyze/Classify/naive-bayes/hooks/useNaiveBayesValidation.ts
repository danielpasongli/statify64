import { useMemo } from "react";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";

export type NaiveBayesValidationResult = {
    isValid: boolean;
    errors: string[];
};

// Batas seed mengikuti Rust: seed dikonversi ke u32 untuk Mersenne Twister
// (identik dengan MAX_SEED di useNearestNeighborValidation.ts, AGENTS.md §4.2).
const MAX_SEED = 4294967295;

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

    const excluded = new Set(main.ExcludedVar ?? []);

    return variables
        .filter((v) => v.measure !== "unknown")
        .map((v) => v.name)
        .filter((name) => name !== target && !excluded.has(name));
}

/**
 * Validasi terpusat menu Naive Bayes (pola `useNearestNeighborValidation.ts`):
 * - `validation.isValid` menentukan disabled/enabled tombol OK: target harus
 *   terisi DAN predictor efektif tidak boleh kosong (AGENTS.md §4.4).
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
            errors.push("Pilih variabel target.");
        }

        const effectivePredictors = getEffectivePredictors(
            formData.main,
            variables
        );
        if (effectivePredictors.length === 0) {
            errors.push(
                "Pilih minimal satu variabel predictor (lewat Variables to Exclude atau Candidate Factors/Covariates)."
            );
        }

        return { isValid: errors.length === 0, errors };
    }, [formData.main, variables]);

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

    // Smoothing Alpha — AGENTS.md §4.1 & §5.2: harus > 0, boleh desimal,
    // maksimum 999.
    if (
        typeof options.SmoothingAlpha !== "number" ||
        !Number.isFinite(options.SmoothingAlpha)
    ) {
        return "Masukkan angka yang valid untuk Smoothing Alpha.";
    }
    if (options.SmoothingAlpha <= 0) {
        return "Smoothing Alpha harus lebih besar dari 0.";
    }
    if (options.SmoothingAlpha > 999) {
        return "Smoothing Alpha maksimum 999.";
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
            return "Persentase Training harus bilangan bulat antara 1 dan 99.";
        }
    }

    // Cross-Validation Folds — AGENTS.md §4.2: default 10, minimum 1.
    if (validation.ValidationMethod === "kfold") {
        const folds = validation.KFolds;
        if (typeof folds !== "number" || !Number.isInteger(folds) || folds < 1) {
            return "Jumlah fold minimal 1.";
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
            return `Seed harus bilangan bulat antara 0 dan ${MAX_SEED}.`;
        }
    }

    return null;
}
