import { renderHook } from "@testing-library/react";
import {
    getEffectivePredictors,
    getEffectiveTextSource,
    getNumericInputError,
    getTextColumnNames,
    useNaiveBayesValidation,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import {
    NaiveBayesDefault,
    mergeWithDefaults,
} from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import { STWV_DEFAULT_CONFIG } from "@/components/Modals/Transform/StringToWordVector/config";
import type { Variable } from "@/types/Variable";

const makeVariable = (
    name: string,
    measure: Variable["measure"],
    type: Variable["type"] = "NUMERIC"
): Variable => ({
    columnIndex: 0,
    name,
    type,
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure,
    role: "input",
});

// Dataset: target nominal, satu STRING biasa (nama), satu STRING teks mentah,
// dua kolom vektor numerik, satu kovariat biasa, satu variabel unknown.
const variables: Variable[] = [
    makeVariable("label", "nominal"),
    makeVariable("nama", "nominal", "STRING"),
    makeVariable("tweet", "nominal", "STRING"),
    makeVariable("VEC_a", "scale"),
    makeVariable("VEC_b", "scale"),
    makeVariable("umur", "scale"),
    makeVariable("tak_dikenal", "unknown"),
];

const cloneDefault = (): NaiveBayesType =>
    JSON.parse(JSON.stringify(NaiveBayesDefault));

describe("getEffectivePredictors v2 (Text Features)", () => {
    it("exclude: Raw Text Variable keluar dari predictor, STRING lain TETAP ikut", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.RawTextVar = "tweet";
        form.main.TextSource = "raw";

        const result = getEffectivePredictors(form.main, variables);

        expect(result).toEqual(["nama", "VEC_a", "VEC_b", "umur"]);
        expect(result).not.toContain("tweet");
        expect(result).toContain("nama");
    });

    it("exclude: Word-Vector Variables keluar dari predictor, STRING biasa tetap ikut", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        form.main.TextSource = "vector";

        const result = getEffectivePredictors(form.main, variables);

        expect(result).toEqual(["nama", "tweet", "umur"]);
    });

    it("exclude: target, ExcludedVar, Raw Text, Vector, dan unknown sekaligus keluar", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.ExcludedVar = ["umur"];
        form.main.RawTextVar = "tweet";

        expect(getEffectivePredictors(form.main, variables)).toEqual([
            "nama",
            "VEC_a",
            "VEC_b",
        ]);
    });

    it("candidates: tetap gabungan CandidateFactors + CandidateCovariates (v1)", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.SpecificationMode = "candidates";
        form.main.CandidateFactors = ["nama"];
        form.main.CandidateCovariates = ["umur"];
        form.main.TextVectorVars = ["VEC_a"];

        expect(getEffectivePredictors(form.main, variables)).toEqual([
            "nama",
            "umur",
        ]);
    });

    it("data lama tanpa field Text (undefined) -> perilaku v1", () => {
        const main = {
            TargetVar: "label",
            SpecificationMode: "exclude",
            ExcludedVar: null,
            CandidateFactors: null,
            CandidateCovariates: null,
        } as unknown as NaiveBayesType["main"];

        expect(getEffectivePredictors(main, variables)).toEqual([
            "nama",
            "tweet",
            "VEC_a",
            "VEC_b",
            "umur",
        ]);
    });
});

describe("getEffectiveTextSource & getTextColumnNames", () => {
    it("diturunkan dari isi slot, bukan dari TextSource tersimpan", () => {
        const form = cloneDefault();
        form.main.TextSource = "raw"; // basi: slot kosong
        expect(getEffectiveTextSource(form.main)).toBe("none");
        expect(getTextColumnNames(form.main)).toEqual([]);

        form.main.RawTextVar = "tweet";
        expect(getEffectiveTextSource(form.main)).toBe("raw");
        expect(getTextColumnNames(form.main)).toEqual(["tweet"]);

        form.main.RawTextVar = null;
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        expect(getEffectiveTextSource(form.main)).toBe("vector");
        expect(getTextColumnNames(form.main)).toEqual(["VEC_a", "VEC_b"]);
    });
});

describe("useNaiveBayesValidation v2", () => {
    const run = (form: NaiveBayesType) =>
        renderHook(() => useNaiveBayesValidation(form, variables)).result
            .current;

    it("OK aktif bila target terisi dan HANYA Text Features terisi (predictor lain dikeluarkan)", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.ExcludedVar = ["nama", "tweet", "VEC_a", "VEC_b", "umur"];
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];

        expect(getEffectivePredictors(form.main, variables)).toEqual([]);
        expect(run(form).validation.isValid).toBe(true);
    });

    it("N5-8: target kosong (mode exclude) tanpa Text Features -> pesan target DAN predictor", () => {
        const form = cloneDefault();
        form.main.TargetVar = null;

        const { validation } = run(form);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toEqual(
            expect.arrayContaining([
                expect.stringContaining("target"),
                expect.stringContaining("predictor"),
            ])
        );
    });

    it("N5-8: target kosong tetapi Text Features terisi -> hanya pesan target", () => {
        const form = cloneDefault();
        form.main.TargetVar = null;
        form.main.TextVectorVars = ["VEC_a"];

        const { validation } = run(form);

        expect(validation.isValid).toBe(false);
        expect(validation.errors).toEqual(["Select a target variable."]);
    });

    it("N5-8: target kosong pada mode candidates tidak memunculkan pesan predictor bila kandidat terisi", () => {
        const form = cloneDefault();
        form.main.TargetVar = null;
        form.main.SpecificationMode = "candidates";
        form.main.CandidateCovariates = ["umur"];

        expect(run(form).validation.errors).toEqual(["Select a target variable."]);
    });

    it("tanpa predictor dan tanpa Text Features -> tetap tidak valid", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.ExcludedVar = ["nama", "tweet", "VEC_a", "VEC_b", "umur"];

        expect(run(form).validation.isValid).toBe(false);
    });

    it("Complement + predictor Numeric/Categorical efektif -> error yang memblokir OK", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        form.options.TextLikelihood = "complement";

        const { validation } = run(form);

        expect(validation.isValid).toBe(false);
        expect(validation.errors.some((e) => e.includes("Complement"))).toBe(
            true
        );
    });

    it("Complement + hanya Text Features -> valid", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.ExcludedVar = ["nama", "tweet", "umur"];
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        form.options.TextLikelihood = "complement";

        expect(run(form).validation.isValid).toBe(true);
    });

    it("Complement tersimpan tetapi Text Features kosong -> tidak memblokir", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.options.TextLikelihood = "complement";

        expect(run(form).validation.isValid).toBe(true);
    });

    it("jalur Raw Text memvalidasi StwvConfig (n-gram min > max -> tidak valid)", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.RawTextVar = "tweet";
        form.text = {
            ...STWV_DEFAULT_CONFIG,
            tokenizer: { type: "ngram", minSize: 3, maxSize: 2 },
        };

        const { validation } = run(form);

        expect(validation.isValid).toBe(false);
        expect(validation.errors.some((e) => /n-gram/i.test(e))).toBe(true);
    });

    it("jalur vector tidak memvalidasi StwvConfig", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.TextVectorVars = ["VEC_a"];
        form.text = {
            ...STWV_DEFAULT_CONFIG,
            tokenizer: { type: "ngram", minSize: 3, maxSize: 2 },
        };

        expect(run(form).validation.isValid).toBe(true);
    });
});

describe("getNumericInputError v2 (TextAlpha & TextTopK)", () => {
    const withText = (): NaiveBayesType => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.main.TextVectorVars = ["VEC_a"];
        return form;
    };

    it("default dengan Text Features -> null", () => {
        expect(getNumericInputError(withText())).toBeNull();
    });

    it("TextAlpha 0 / > 999 / NaN ditolak", () => {
        const a = withText();
        a.options.TextAlpha = 0;
        expect(getNumericInputError(a)).toContain("Text smoothing alpha");

        const b = withText();
        b.options.TextAlpha = 1000;
        expect(getNumericInputError(b)).toContain("999");

        const c = withText();
        c.options.TextAlpha = Number.NaN;
        expect(getNumericInputError(c)).toContain("valid");
    });

    it("TextTopK harus bilangan bulat 1-1000 (saat tabel dicentang)", () => {
        for (const bad of [0, 1001, 2.5, Number.NaN]) {
            const form = withText();
            form.output.TextTopK = bad;
            expect(getNumericInputError(form)).toContain("Top-k");
        }
        for (const ok of [1, 100, 1000]) {
            const form = withText();
            form.output.TextTopK = ok;
            expect(getNumericInputError(form)).toBeNull();
        }
    });

    it("TextAlpha/TextTopK tidak divalidasi bila tidak ada Text Features (field tersembunyi)", () => {
        const form = cloneDefault();
        form.main.TargetVar = "label";
        form.options.TextAlpha = 0;
        form.output.TextTopK = 0;

        expect(getNumericInputError(form)).toBeNull();
    });

    it("SmoothingAlpha v1 tetap divalidasi", () => {
        const form = cloneDefault();
        form.options.SmoothingAlpha = 0;
        expect(getNumericInputError(form)).toBe(
            "Smoothing Alpha must be greater than 0."
        );
    });
});

describe("mergeWithDefaults", () => {
    it("data lama (tanpa field v2 dan tanpa text) digabung dengan default v2", () => {
        const legacy = {
            main: {
                TargetVar: "label",
                SpecificationMode: "candidates",
                ExcludedVar: null,
                CandidateFactors: ["nama"],
                CandidateCovariates: null,
            },
            options: {
                MissingValuePolicy: "impute",
                UnseenCategoryPolicy: "ignore",
                SmoothingAlpha: 2,
                VarianceFloor: 1e-6,
            },
            validation: { ValidationMethod: "kfold", KFolds: 5 },
            output: { CaseProcessingSummary: false },
        } as unknown as Parameters<typeof mergeWithDefaults>[0];

        const merged = mergeWithDefaults(legacy);

        // Nilai tersimpan dipertahankan
        expect(merged.main.TargetVar).toBe("label");
        expect(merged.main.CandidateFactors).toEqual(["nama"]);
        expect(merged.options.SmoothingAlpha).toBe(2);
        expect(merged.options.MissingValuePolicy).toBe("impute");
        expect(merged.validation.ValidationMethod).toBe("kfold");
        expect(merged.validation.TrainingPercentage).toBe(70);
        expect(merged.output.CaseProcessingSummary).toBe(false);
        // Default v2 terisi
        expect(merged.main.TextSource).toBe("none");
        expect(merged.main.RawTextVar).toBeNull();
        expect(merged.main.TextVectorVars).toBeNull();
        expect(merged.options.NumericLikelihood).toBe("gaussian");
        expect(merged.options.NumericLikelihoodOverrides).toEqual({});
        expect(merged.options.TextLikelihood).toBe("multinomial");
        expect(merged.options.TextAlpha).toBe(1);
        expect(merged.output.TextFeatureTable).toBe(true);
        expect(merged.output.TextTopK).toBe(100);
        expect(merged.text).toEqual(STWV_DEFAULT_CONFIG);
    });

    it("null/undefined -> default penuh", () => {
        expect(mergeWithDefaults(null)).toEqual(NaiveBayesDefault);
        expect(mergeWithDefaults(undefined)).toEqual(NaiveBayesDefault);
    });

    it("merge dalam pada text (STWV) dan tidak berbagi referensi dengan default", () => {
        const merged = mergeWithDefaults({
            text: {
                lowercase: false,
                tokenizer: { type: "ngram" },
            } as unknown as Partial<NaiveBayesType["text"]>,
            options: { NumericLikelihoodOverrides: { umur: "gaussian_minstd" } },
        });

        expect(merged.text.lowercase).toBe(false);
        expect(merged.text.tokenizer).toEqual({
            ...STWV_DEFAULT_CONFIG.tokenizer,
            type: "ngram",
        });
        expect(merged.text.stopwords).toEqual(STWV_DEFAULT_CONFIG.stopwords);
        expect(merged.options.NumericLikelihoodOverrides).toEqual({
            umur: "gaussian_minstd",
        });

        // Mutasi hasil tidak boleh mengubah konstanta default.
        merged.text.tokenizer.minSize = 99;
        merged.options.NumericLikelihoodOverrides.x = "gaussian";
        expect(STWV_DEFAULT_CONFIG.tokenizer.minSize).toBe(1);
        expect(NaiveBayesDefault.options.NumericLikelihoodOverrides).toEqual({});
    });
});
