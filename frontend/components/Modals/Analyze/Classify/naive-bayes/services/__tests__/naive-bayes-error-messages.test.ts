import { getUserFriendlyNaiveBayesError } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-error-messages";

// Format LAMA (Indonesia), disalin dari rust/src/models/data.rs sebelum PLAN_V3:
// "NB_E_TEXT_NEGATIVE: Kolom vektor teks '{kolom}' berisi nilai negatif
// (total {n} kolom bermasalah). ..."
const rustNegatifLama = (kolom: string, n: number) =>
    `NB_E_TEXT_NEGATIVE: Kolom vektor teks '${kolom}' berisi nilai negatif (total ${n} kolom bermasalah). Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0. Periksa apakah kolom ini bukan vektor kata (mis. hasil standardisasi/PCA atau kode missing seperti -1) lalu keluarkan dari Word-Vector Variables.`;

// Format BARU (Inggris), PLAN_V3_UI_EN §3.2.
const rustNegatifBaru = (kolom: string, n: number) =>
    `NB_E_TEXT_NEGATIVE: Text vector column '${kolom}' contains negative values (${n} column(s) affected). Multinomial, Bernoulli and Complement Naive Bayes require values >= 0. Check that the column is a real word vector (not a standardized/PCA column or a missing-value code such as -1) and remove it from Word-Vector Variables.`;

const KALIMAT_INTI = "Text likelihoods require values >= 0";
const AKHIRAN = "(NB_E_TEXT_NEGATIVE)";

const FORMAT_NEGATIF: ReadonlyArray<
    readonly [string, (kolom: string, n: number) => string]
> = [
    ["format lama (Indonesia)", rustNegatifLama],
    ["format baru (Inggris)", rustNegatifBaru],
];

describe.each(FORMAT_NEGATIF)("getUserFriendlyNaiveBayesError: NB_E_TEXT_NEGATIVE, %s", (_label, buat) => {
    it("(a) satu kolom bermasalah: nama kolom + kalimat inti, kode di akhir", () => {
        const pesan = getUserFriendlyNaiveBayesError(new Error(buat("VEC_a", 1)));
        expect(pesan).toContain("'VEC_a'");
        expect(pesan).toContain("contains negative values");
        expect(pesan).not.toContain("more column");
        expect(pesan).toContain(KALIMAT_INTI);
        expect(pesan.endsWith(AKHIRAN)).toBe(true);
        expect(pesan.startsWith("NB_E_")).toBe(false);
    });

    it("(b) beberapa kolom bermasalah: nama kolom pertama + sisa kolom", () => {
        const pesan = getUserFriendlyNaiveBayesError(new Error(buat("zscore_1", 7)));
        expect(pesan).toContain("'zscore_1'");
        expect(pesan).toContain("and 6 more column(s)");
        expect(pesan).toContain(KALIMAT_INTI);
        expect(pesan.endsWith(AKHIRAN)).toBe(true);
    });

    it("nama kolom dengan spasi dan angka dipertahankan; string (bukan Error) juga didukung", () => {
        const pesan = getUserFriendlyNaiveBayesError(buat("kolom vektor 12", 3));
        expect(pesan).toContain("'kolom vektor 12'");
        expect(pesan).toContain("and 2 more column(s)");
    });

    it("tidak tertangkap kata 'fold'/'predictor' pada nama kolom", () => {
        const pesan = getUserFriendlyNaiveBayesError(
            new Error(buat("fold_predictor_target", 2))
        );
        expect(pesan).toContain("'fold_predictor_target'");
        expect(pesan).not.toContain("cross-validation");
        expect(pesan).not.toContain("Select a target variable");
    });
});

describe("getUserFriendlyNaiveBayesError: NB_E_TEXT_NEGATIVE, format tak dikenal", () => {
    it("(c) fallback pesan umum, tidak melempar galat", () => {
        for (const input of [
            "NB_E_TEXT_NEGATIVE",
            "NB_E_TEXT_NEGATIVE: ada nilai negatif",
            "NB_E_TEXT_NEGATIVE: Kolom vektor teks berisi nilai negatif; format lama.",
            new Error("NB_E_TEXT_NEGATIVE: total 2 kolom"),
            undefined,
        ]) {
            let pesan = "";
            expect(() => {
                pesan = getUserFriendlyNaiveBayesError(input);
            }).not.toThrow();
            expect(typeof pesan).toBe("string");
            expect(pesan.length).toBeGreaterThan(0);
            expect(pesan).not.toContain("undefined");
        }
        const umum = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_NEGATIVE: ada nilai negatif")
        );
        expect(umum).toContain("Text vector columns contain negative values");
        expect(umum).toContain(KALIMAT_INTI);
        expect(umum.endsWith(AKHIRAN)).toBe(true);
    });
});

describe("getUserFriendlyNaiveBayesError: kode NB_E_* lain (pola E3, kode di akhir)", () => {
    it("NB_E_TEXT_SHAPE memakai pesan ramah baru", () => {
        const pesan = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_SHAPE: Text matrix has 3 rows but the dataset has 5.")
        );
        expect(pesan).toBe(
            "The text data does not match the dataset rows. Re-select the text variables and run the analysis again. (NB_E_TEXT_SHAPE)"
        );
    });

    it("NB_E_TEXT_EMPTY_VOCAB_FOLD: nomor fold dari format lama dan baru", () => {
        const lama = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_EMPTY_VOCAB_FOLD: Kosakata teks kosong pada data latih fold ke-3.")
        );
        expect(lama).toBe(
            "No words are left in the training data of fold 3 after text preprocessing. Relax the Text Preprocessing settings or use fewer folds. (NB_E_TEXT_EMPTY_VOCAB_FOLD)"
        );
        const baru = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of fold 2. Relax the Text Preprocessing settings (e.g. Words to Keep, Min term frequency, stopwords) or use fewer folds."
            )
        );
        expect(baru).toContain("fold 2");
        // Nama kode (…_FOLD) tidak boleh dikira nomor fold.
        const tanpaNomor = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty.")
        );
        expect(tanpaNomor).toContain("one of the folds");
    });

    it("NB_E_TEXT_EMPTY_VOCAB_FOLD: varian holdout format baru", () => {
        const pesan = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of the holdout split. Relax the Text Preprocessing settings."
            )
        );
        expect(pesan).toContain("holdout split");
        expect(pesan.endsWith("(NB_E_TEXT_EMPTY_VOCAB_FOLD)")).toBe(true);
    });

    it("NB_E_TEXT_EMPTY_VOCAB: format baru", () => {
        const pesan = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_EMPTY_VOCAB: The text vocabulary is empty after preprocessing all rows. Relax the Text Preprocessing settings."
            )
        );
        expect(pesan).toContain("after text preprocessing");
        expect(pesan).not.toContain("fold");
        expect(pesan.endsWith("(NB_E_TEXT_EMPTY_VOCAB)")).toBe(true);
    });

    it("NB_E_COMPLEMENT_MIXED: jumlah predictor dari format baru bersifat opsional", () => {
        const baru = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_COMPLEMENT_MIXED: Complement Naive Bayes can only be used when the model contains Text Features only, but this model also has 2 numeric/categorical predictor(s)."
            )
        );
        expect(baru).toContain("contains Text Features only");
        expect(baru).toContain("also has 2 numeric/categorical predictor(s)");
        expect(baru.endsWith("(NB_E_COMPLEMENT_MIXED)")).toBe(true);

        const lama = getUserFriendlyNaiveBayesError(
            new Error("NB_E_COMPLEMENT_MIXED: Complement hanya untuk model Text saja.")
        );
        expect(lama).not.toContain("also has");
        expect(lama.endsWith("(NB_E_COMPLEMENT_MIXED)")).toBe(true);
    });

    it("NB_E_TEXT_CONFIG: kode CORE dipindah ke akhir kalimat", () => {
        const pesan = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_CONFIG: [INVALID_REGEX] The delimiter pattern is not a valid regular expression.")
        );
        expect(pesan).toBe(
            "The Text Preprocessing settings are not valid: The delimiter pattern is not a valid regular expression. (NB_E_TEXT_CONFIG: INVALID_REGEX)"
        );
        expect(getUserFriendlyNaiveBayesError(new Error("NB_E_TEXT_CONFIG:"))).toBe(
            "The Text Preprocessing settings are not valid. Check the Text Preprocessing tab. (NB_E_TEXT_CONFIG)"
        );
    });

    it("NB_E_TEXT_RAW_MISSING", () => {
        expect(
            getUserFriendlyNaiveBayesError(
                new Error("NB_E_TEXT_RAW_MISSING: The text of the Raw Text Variable was not provided.")
            ).endsWith("(NB_E_TEXT_RAW_MISSING)")
        ).toBe(true);
    });
});

describe("getUserFriendlyNaiveBayesError: pesan v1 (English)", () => {
    it.each([
        ["no target", "Select a target variable before running the Naive Bayes analysis."],
        ["no predictors", "Select at least one predictor variable before running the Naive Bayes analysis."],
        ["no valid cases", "There are no valid cases to analyze. Check the selected variables for missing or invalid values."],
        ["fold count too large", "Check the cross-validation settings. The number of folds must not exceed the number of cases or the size of the smallest class."],
        ["wasm failed to load", "The Naive Bayes analysis engine could not be loaded. Reload the page and try again."],
        ["something else", "The Naive Bayes analysis could not be completed. Check the selected variables and settings, then try again."],
    ])("%s", (input, expected) => {
        expect(getUserFriendlyNaiveBayesError(new Error(input))).toBe(expected);
    });
});
