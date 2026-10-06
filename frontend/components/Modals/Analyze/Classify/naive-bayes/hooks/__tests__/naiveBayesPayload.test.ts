import {
    buildNaiveBayesTextPayload,
    buildNaiveBayesWorkerConfig,
    splitNaiveBayesDataVariables,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis";
import { getUserFriendlyNaiveBayesError } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-error-messages";
import { NaiveBayesDefault } from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import type { NaiveBayesType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";
import { toRustConfig } from "@/components/Modals/Transform/StringToWordVector/config";

// Modul output/formatter menarik store & UI; tidak relevan untuk pengujian payload.
jest.mock(
    "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-output",
    () => ({ resultNaiveBayes: jest.fn() })
);
jest.mock(
    "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter",
    () => ({ transformNaiveBayesResult: jest.fn() })
);

const cloneDefault = (): NaiveBayesType =>
    JSON.parse(JSON.stringify(NaiveBayesDefault));

/** Meniru satu kolom keluaran getSlicedData: satu objek {nama: nilai} per baris. */
const col = (name: string, values: (string | number | null)[]) =>
    values.map((v) => ({ [name]: v }));

describe("buildNaiveBayesTextPayload", () => {
    it("none: tanpa Text Features", () => {
        const form = cloneDefault();
        expect(buildNaiveBayesTextPayload(form.main, [], 3)).toEqual({
            source: "none",
        });
    });

    it("raw: sejajar baris target; kosong/null -> null; angka di-String-kan", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";

        const payload = buildNaiveBayesTextPayload(
            form.main,
            [],
            5,
            ["saya makan nasi", null, "", 42, undefined]
        );

        expect(payload).toEqual({
            source: "raw",
            variable: "tweet",
            values: ["saya makan nasi", null, null, "42", null],
        });
    });

    it("raw: panjang values = jumlah baris target (diisi null bila teks lebih pendek)", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        const payload = buildNaiveBayesTextPayload(form.main, [], 3, ["a"]);
        expect(payload).toEqual({
            source: "raw",
            variable: "tweet",
            values: ["a", null, null],
        });
    });

    it("raw: teks berawalan angka tetap utuh (tanpa parseFloat)", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        const payload = buildNaiveBayesTextPayload(form.main, [], 2, [
            "3 kucing lucu",
            "2024 pilkada seru",
        ]);
        expect(payload).toEqual({
            source: "raw",
            variable: "tweet",
            values: ["3 kucing lucu", "2024 pilkada seru"],
        });
    });

    it("raw: teks spasi saja (spasi/tab/newline) -> null; teks bermakna tidak di-trim", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        const payload = buildNaiveBayesTextPayload(form.main, [], 4, [
            "   ",
            "\t\n",
            " halo ",
            0,
        ]);
        expect(payload).toEqual({
            source: "raw",
            variable: "tweet",
            values: [null, null, " halo ", "0"],
        });
    });

    it("N5-6: '   ' dan '\\t\\n' -> null; '  halo  ' dan '3 kucing lucu' tetap utuh", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        const payload = buildNaiveBayesTextPayload(form.main, [], 4, [
            "   ",
            "\t\n",
            "  halo  ",
            "3 kucing lucu",
        ]);
        expect(payload).toEqual({
            source: "raw",
            variable: "tweet",
            values: [null, null, "  halo  ", "3 kucing lucu"],
        });
    });

    it("N5-4: TextSource tersimpan basi -> payload memakai nilai efektif dari slot", () => {
        const form = cloneDefault();
        // Tersimpan "raw" tetapi slot kosong -> none.
        form.main.TextSource = "raw";
        expect(buildNaiveBayesTextPayload(form.main, [], 2, ["a", "b"])).toEqual({
            source: "none",
        });
        // Tersimpan "raw" tetapi yang terisi Word-Vector -> vector.
        form.main.TextVectorVars = ["VEC_a"];
        expect(
            buildNaiveBayesTextPayload(form.main, [col("VEC_a", [1, 2])], 2, [
                "a",
                "b",
            ])
        ).toEqual({
            source: "vector",
            columns: ["VEC_a"],
            values: [[1], [2]],
        });
        // Tersimpan "vector" tetapi slot kosong -> none.
        const kosong = cloneDefault();
        kosong.main.TextSource = "vector";
        expect(buildNaiveBayesTextPayload(kosong.main, [], 2)).toEqual({
            source: "none",
        });
    });

    it("raw: slice getSlicedData diabaikan; tanpa rawTextValues melempar galat", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        // Slice basi (sudah di-parseFloat) tidak boleh dipakai.
        const stale = [col("tweet", [3])];
        expect(
            buildNaiveBayesTextPayload(form.main, stale, 1, ["3 kucing lucu"])
        ).toEqual({ source: "raw", variable: "tweet", values: ["3 kucing lucu"] });
        expect(() => buildNaiveBayesTextPayload(form.main, stale, 1)).toThrow(
            /NB_E_TEXT_RAW_MISSING/
        );
    });

    it("vector: values[row][i] sejajar columns; non-numerik/NaN -> null", () => {
        const form = cloneDefault();
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        const slices = [
            col("VEC_a", [1, 0, null]),
            col("VEC_b", [0.5, "x", Number.NaN]),
        ];

        const payload = buildNaiveBayesTextPayload(form.main, slices, 3);

        expect(payload).toEqual({
            source: "vector",
            columns: ["VEC_a", "VEC_b"],
            values: [
                [1, 0.5],
                [0, null],
                [null, null],
            ],
        });
    });
});

describe("buildNaiveBayesWorkerConfig", () => {
    it("tanpa teks: Text = null dan field `text` UI tidak ikut terkirim", () => {
        const form = cloneDefault();
        const config = buildNaiveBayesWorkerConfig(form);

        expect(config.Text).toBeNull();
        expect("text" in config).toBe(false);
        expect(config.main).toEqual(form.main);
        expect(config.options).toEqual(form.options);
        expect(config.output).toEqual(form.output);
    });

    it("raw: Text = toRustConfig(formData.text)", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        form.main.TextSource = "raw";

        const config = buildNaiveBayesWorkerConfig(form);

        expect(config.Text).toEqual(toRustConfig(form.text));
        expect(config.Text).toHaveProperty("stemming_method");
    });

    it("vector: Text = null (konfigurasi preprocessing tidak dipakai)", () => {
        const form = cloneDefault();
        form.main.TextVectorVars = ["VEC_a"];
        expect(buildNaiveBayesWorkerConfig(form).Text).toBeNull();
    });

    it("TextSource basi diganti nilai efektif dari isi slot", () => {
        const form = cloneDefault();
        form.main.TextSource = "raw"; // basi: slot kosong
        expect(buildNaiveBayesWorkerConfig(form).main.TextSource).toBe("none");

        form.main.TextSource = "none"; // basi: slot vector terisi
        form.main.TextVectorVars = ["VEC_a"];
        expect(buildNaiveBayesWorkerConfig(form).main.TextSource).toBe("vector");

        form.main.TextSource = "vector"; // basi: Raw Text menang
        form.main.RawTextVar = "tweet";
        expect(buildNaiveBayesWorkerConfig(form).main.TextSource).toBe("raw");
    });

    it("TextTopK tidak sah diganti default 100; yang sah dipertahankan", () => {
        const form = cloneDefault();
        form.output.TextTopK = Number.NaN;
        expect(buildNaiveBayesWorkerConfig(form).output.TextTopK).toBe(100);
        form.output.TextTopK = 2.5;
        expect(buildNaiveBayesWorkerConfig(form).output.TextTopK).toBe(100);
        form.output.TextTopK = 25;
        expect(buildNaiveBayesWorkerConfig(form).output.TextTopK).toBe(25);
    });
});

describe("getUserFriendlyNaiveBayesError (kode §11)", () => {
    it("NB_E_TEXT_NEGATIVE: satu kolom memuat nama kolom dan jumlah", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_NEGATIVE: Kolom vektor teks 'VEC_a' berisi nilai negatif (total 1 kolom bermasalah). Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0. Periksa apakah kolom ini bukan vektor kata (mis. hasil standardisasi/PCA atau kode missing seperti -1) lalu keluarkan dari Word-Vector Variables."
            )
        );
        expect(message).toContain("'VEC_a'");
        expect(message).toContain("negative values");
        // Satu kolom terdampak: tidak ada kalimat "and N more column(s)".
        expect(message).not.toContain("more column");
        expect(message.endsWith("(NB_E_TEXT_NEGATIVE)")).toBe(true);
    });

    it("NB_E_TEXT_NEGATIVE: beberapa kolom -> nama pertama + jumlah", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_NEGATIVE: Kolom vektor teks 'zscore_1' berisi nilai negatif (total 7 kolom bermasalah). Multinomial/Bernoulli/Complement NB memerlukan nilai ≥ 0. Periksa apakah kolom ini bukan vektor kata (mis. hasil standardisasi/PCA atau kode missing seperti -1) lalu keluarkan dari Word-Vector Variables."
            )
        );
        expect(message).toContain("'zscore_1'");
        expect(message).toContain("and 6 more column(s)");
    });

    it("NB_E_TEXT_NEGATIVE: pesan tanpa nama kolom tidak crash (pesan umum)", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_NEGATIVE: ada nilai negatif")
        );
        expect(message).toContain("Text vector columns contain negative values");
        expect(message).not.toContain("'");
        expect(message).not.toContain("undefined");
    });

    it("NB_E_TEXT_NEGATIVE: tanpa jumlah tetap memuat nama kolom", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_NEGATIVE: Kolom vektor teks 'x' berisi nilai negatif.")
        );
        expect(message).toContain("'x'");
        expect(message).not.toContain("more column");
    });

    it.each([
        ["NB_E_TEXT_EMPTY_VOCAB_FOLD: fold 3 kosong", "3"],
        ["NB_E_TEXT_EMPTY_VOCAB_FOLD: fold ke-3 kosong", "3"],
        ["NB_E_TEXT_EMPTY_VOCAB_FOLD: Fold #3 kosong", "3"],
        ["NB_E_TEXT_EMPTY_VOCAB_FOLD: fold ke 12 kosong", "12"],
    ])("nomor fold dikenali dari %j", (pesan, nomor) => {
        expect(getUserFriendlyNaiveBayesError(new Error(pesan))).toContain(
            `of fold ${nomor} after`
        );
    });

    it("NB_E_TEXT_RAW_MISSING: galat builder dipetakan ke pesan ramah", () => {
        const form = cloneDefault();
        form.main.RawTextVar = "tweet";
        let galat: unknown;
        try {
            buildNaiveBayesTextPayload(form.main, [], 1);
        } catch (e) {
            galat = e;
        }
        expect((galat as Error).message).toContain("NB_E_TEXT_RAW_MISSING");
        const pesan = getUserFriendlyNaiveBayesError(galat);
        expect(pesan).toContain("Raw Text Variable");
        // Pola E3: kode internal ada di akhir kalimat, dalam kurung.
        expect(pesan.endsWith("(NB_E_TEXT_RAW_MISSING)")).toBe(true);
    });

    it("NB_E_TEXT_EMPTY_VOCAB_FOLD tanpa nomor fold tidak crash", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_EMPTY_VOCAB_FOLD: kosakata kosong")
        );
        expect(message).toContain("No words are left in the training data");
        expect(message).not.toContain("fold 1");
        expect(message.endsWith("(NB_E_TEXT_EMPTY_VOCAB_FOLD)")).toBe(true);
    });

    it("NB_E_TEXT_EMPTY_VOCAB_FOLD menyebut nomor fold; NB_E_TEXT_EMPTY_VOCAB untuk model final", () => {
        const fold = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_EMPTY_VOCAB_FOLD: fold 3 memiliki kosakata kosong")
        );
        expect(fold).toContain("fold 3");
        expect(fold).toContain("No words are left in the training data");

        // Format baru (Inggris, PLAN_V3_UI_EN §3.2), termasuk varian holdout.
        const foldBaru = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of fold 4. Relax the Text Preprocessing settings (e.g. Words to Keep, Min term frequency, stopwords) or use fewer folds."
            )
        );
        expect(foldBaru).toContain("fold 4");
        const holdoutBaru = getUserFriendlyNaiveBayesError(
            new Error(
                "NB_E_TEXT_EMPTY_VOCAB_FOLD: The text vocabulary is empty in the training data of the holdout split. Relax the Text Preprocessing settings."
            )
        );
        expect(holdoutBaru).toContain("holdout split");
        expect(holdoutBaru).not.toContain("fold 4");

        const final = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_EMPTY_VOCAB: kosakata kosong")
        );
        expect(final).toContain("after text preprocessing");
        expect(final).not.toContain("fold");
    });

    it("NB_E_COMPLEMENT_MIXED", () => {
        expect(
            getUserFriendlyNaiveBayesError(
                new Error("NB_E_COMPLEMENT_MIXED: complement dengan fitur non-text")
            )
        ).toContain("contains Text Features only");
    });

    it("NB_E_TEXT_CONFIG meneruskan pesan asli CORE", () => {
        const message = getUserFriendlyNaiveBayesError(
            new Error("NB_E_TEXT_CONFIG: [INVALID_REGEX] pola delimiter salah")
        );
        // Pola E3: kode CORE dipindah ke akhir kalimat, tidak lagi di awal.
        expect(message).toContain("pola delimiter salah");
        expect(message).not.toContain("[INVALID_REGEX]");
        expect(message.endsWith("(NB_E_TEXT_CONFIG: INVALID_REGEX)")).toBe(true);
    });

    it("pesan v1 tidak berubah", () => {
        expect(getUserFriendlyNaiveBayesError(new Error("no target"))).toBe(
            "Select a target variable before running the Naive Bayes analysis."
        );
    });
});

describe("splitNaiveBayesDataVariables", () => {
    const mk = (name: string, measure: Variable["measure"]): Variable => ({
        columnIndex: 0,
        name,
        type: "NUMERIC",
        width: 8,
        decimals: 0,
        values: [],
        missing: null,
        columns: 8,
        align: "right",
        measure,
        role: "input",
    });
    const variables = [mk("y", "nominal"), mk("a", "scale"), mk("b", "scale")];
    const colOf = (name: string, n: number) =>
        Array.from({ length: n }, (_, i) => ({ [name]: i }));

    it("urutan [target, ...predictor, ...text vector]", () => {
        const form = cloneDefault();
        form.main.TargetVar = "y";
        form.main.SpecificationMode = "candidates";
        form.main.CandidateCovariates = ["a", "b"];
        form.main.TextVectorVars = ["VEC_a", "VEC_b"];
        const data = [
            colOf("y", 4),
            colOf("a", 4),
            colOf("b", 4),
            colOf("VEC_a", 4),
            colOf("VEC_b", 4),
        ];

        const r = splitNaiveBayesDataVariables(data, form.main, variables);

        expect(r.targetNames).toEqual(["y"]);
        expect(r.predictorNames).toEqual(["a", "b"]);
        expect(r.textNames).toEqual(["VEC_a", "VEC_b"]);
        expect(r.targetSlices).toEqual([data[0]]);
        expect(r.predictorSlices).toEqual([data[1], data[2]]);
        expect(r.textSlices).toEqual([data[3], data[4]]);
        expect(r.rowCount).toBe(4);
    });

    it("tanpa target: predictor mulai dari indeks 0, rowCount 0", () => {
        const form = cloneDefault();
        form.main.TargetVar = null;
        form.main.SpecificationMode = "candidates";
        form.main.CandidateCovariates = ["a"];
        form.main.TextVectorVars = ["VEC_a"];
        const data = [colOf("a", 3), colOf("VEC_a", 3)];

        const r = splitNaiveBayesDataVariables(data, form.main, variables);

        expect(r.targetSlices).toEqual([]);
        expect(r.predictorSlices).toEqual([data[0]]);
        expect(r.textSlices).toEqual([data[1]]);
        expect(r.rowCount).toBe(0);
    });

    it("tanpa predictor: target lalu text vector", () => {
        const form = cloneDefault();
        form.main.TargetVar = "y";
        form.main.SpecificationMode = "candidates";
        form.main.CandidateFactors = [];
        form.main.CandidateCovariates = [];
        form.main.TextVectorVars = ["VEC_a"];
        const data = [colOf("y", 2), colOf("VEC_a", 2)];

        const r = splitNaiveBayesDataVariables(data, form.main, variables);

        expect(r.predictorNames).toEqual([]);
        expect(r.predictorSlices).toEqual([]);
        expect(r.targetSlices).toEqual([data[0]]);
        expect(r.textSlices).toEqual([data[1]]);
        expect(r.rowCount).toBe(2);
    });

    it("raw: kolom Text tidak dibaca dari ekor dataVariables", () => {
        const form = cloneDefault();
        form.main.TargetVar = "y";
        form.main.SpecificationMode = "candidates";
        form.main.CandidateCovariates = ["a"];
        form.main.RawTextVar = "tweet";
        const data = [colOf("y", 2), colOf("a", 2), colOf("tweet", 2)];

        const r = splitNaiveBayesDataVariables(data, form.main, variables);

        expect(r.textNames).toEqual([]);
        expect(r.textSlices).toEqual([]);
        expect(r.predictorSlices).toEqual([data[1]]);
    });

    it("dataVariables bukan array -> semua kosong, tidak crash", () => {
        const form = cloneDefault();
        form.main.TargetVar = "y";
        const r = splitNaiveBayesDataVariables(undefined, form.main, variables);
        expect(r.targetSlices).toEqual([]);
        expect(r.rowCount).toBe(0);
    });
});
