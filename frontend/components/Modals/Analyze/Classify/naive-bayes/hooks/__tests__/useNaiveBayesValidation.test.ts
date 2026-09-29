import { renderHook } from "@testing-library/react";
import {
    getEffectivePredictors,
    getNumericInputError,
    useNaiveBayesValidation,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import { NaiveBayesDefault } from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";

const makeVariable = (
    name: string,
    measure: Variable["measure"]
): Variable => ({
    columnIndex: 0,
    name,
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure,
    role: "input",
});

const baseVariables: Variable[] = [
    makeVariable("target_cat", "nominal"),
    makeVariable("factor_a", "nominal"),
    makeVariable("covariate_a", "scale"),
    makeVariable("covariate_b", "scale"),
    makeVariable("unknown_var", "unknown"),
];

const cloneDefault = (): NaiveBayesType =>
    JSON.parse(JSON.stringify(NaiveBayesDefault));

describe("getEffectivePredictors", () => {
    it("mode exclude: predictor efektif = semua eligible dikurangi target & excluded", () => {
        const main: NaiveBayesType["main"] = {
            TargetVar: "target_cat",
            ExcludedVar: ["factor_a"],
            CandidateFactors: null,
            CandidateCovariates: null,
        };

        const result = getEffectivePredictors(main, baseVariables);

        expect(result).toEqual(["covariate_a", "covariate_b"]);
        // Variabel measure "unknown" tidak boleh pernah muncul (AGENTS.md §3.2).
        expect(result).not.toContain("unknown_var");
    });

    it("mode candidates: predictor efektif = gabungan CandidateFactors + CandidateCovariates", () => {
        const main: NaiveBayesType["main"] = {
            TargetVar: "target_cat",
            ExcludedVar: [],
            CandidateFactors: ["factor_a"],
            CandidateCovariates: ["covariate_a"],
        };

        const result = getEffectivePredictors(main, baseVariables);

        expect(result).toEqual(["factor_a", "covariate_a"]);
    });

    it("mode exclude kosong tanpa exclude apapun -> semua eligible selain target", () => {
        const main: NaiveBayesType["main"] = {
            TargetVar: "target_cat",
            ExcludedVar: [],
            CandidateFactors: null,
            CandidateCovariates: null,
        };

        const result = getEffectivePredictors(main, baseVariables);

        expect(result).toEqual(["factor_a", "covariate_a", "covariate_b"]);
    });
});

describe("useNaiveBayesValidation", () => {
    it("form kosong (default) -> isValid=false dengan pesan target & predictor", () => {
        const formData = cloneDefault();

        const { result } = renderHook(() =>
            useNaiveBayesValidation(formData, baseVariables)
        );

        expect(result.current.validation.isValid).toBe(false);
        expect(result.current.validation.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining("target"),
                expect.stringContaining("predictor"),
            ])
        );
    });

    it("target terisi tapi predictor efektif kosong -> isValid=false", () => {
        const formData = cloneDefault();
        formData.main.TargetVar = "target_cat";
        // Exclude semua kandidat predictor lain supaya predictor efektif kosong.
        formData.main.ExcludedVar = ["factor_a", "covariate_a", "covariate_b"];

        const { result } = renderHook(() =>
            useNaiveBayesValidation(formData, baseVariables)
        );

        expect(result.current.validation.isValid).toBe(false);
        expect(
            result.current.validation.errors.some((e) =>
                e.toLowerCase().includes("predictor")
            )
        ).toBe(true);
    });

    it("target + predictor terisi tapi alpha = 0 -> validateNumericInputs mengembalikan pesan alpha", () => {
        const formData = cloneDefault();
        formData.main.TargetVar = "target_cat";
        formData.options.SmoothingAlpha = 0;

        const { result } = renderHook(() =>
            useNaiveBayesValidation(formData, baseVariables)
        );

        expect(result.current.validation.isValid).toBe(true);
        expect(result.current.validateNumericInputs()).toMatch(/Alpha/);
    });

    it("semua valid -> validation.isValid=true dan validateNumericInputs()=null", () => {
        const formData = cloneDefault();
        formData.main.TargetVar = "target_cat";

        const { result } = renderHook(() =>
            useNaiveBayesValidation(formData, baseVariables)
        );

        expect(result.current.validation.isValid).toBe(true);
        expect(result.current.validateNumericInputs()).toBeNull();
    });
});

describe("getNumericInputError", () => {
    it("menolak Smoothing Alpha = 0", () => {
        const formData = cloneDefault();
        formData.options.SmoothingAlpha = 0;
        expect(getNumericInputError(formData)).toMatch(/Alpha/);
    });

    it("menolak Smoothing Alpha > 999", () => {
        const formData = cloneDefault();
        formData.options.SmoothingAlpha = 1000;
        expect(getNumericInputError(formData)).toMatch(/999/);
    });

    it("menerima Smoothing Alpha desimal", () => {
        const formData = cloneDefault();
        formData.options.SmoothingAlpha = 0.5;
        expect(getNumericInputError(formData)).toBeNull();
    });

    it("menolak persentase training di luar 1-99 pada mode holdout", () => {
        const formData = cloneDefault();
        formData.validation.ValidationMethod = "holdout";
        formData.validation.TrainingPercentage = 0;
        expect(getNumericInputError(formData)).toMatch(/1 dan 99/);
    });

    it("menolak jumlah fold < 1 pada mode kfold", () => {
        const formData = cloneDefault();
        formData.validation.ValidationMethod = "kfold";
        formData.validation.KFolds = 0;
        expect(getNumericInputError(formData)).toMatch(/fold/);
    });

    it("menolak seed di luar rentang 0-4294967295", () => {
        const formData = cloneDefault();
        formData.validation.RandomSeed = -1;
        expect(getNumericInputError(formData)).toMatch(/[Ss]eed/);
    });

    it("menerima seed null (Set Seed tidak dicentang)", () => {
        const formData = cloneDefault();
        formData.validation.RandomSeed = null;
        expect(getNumericInputError(formData)).toBeNull();
    });
});
