import { moveVariables } from "../variables-tab";
import { buildNaiveBayesTextPayload } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis";
import type { NaiveBayesMainType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";

/**
 * [N6/N7] Kolom Raw Text diambil dari `useDataStore.data[row][columnIndex]` dan
 * dikirim lewat `rawTextValues`, BUKAN lewat `getSlicedData` (yang memotong
 * teks berawalan angka dengan parseFloat). Test ini memastikan hasil pemilihan
 * slot di tab Variables + `rawTextValues` menghasilkan payload dengan teks utuh.
 */
const teksVar: Variable = {
    columnIndex: 1,
    name: "Teks",
    type: "STRING",
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "left",
    measure: "nominal",
    role: "input",
};

const BASE_MAIN: NaiveBayesMainType = {
    TargetVar: "Kelas",
    SpecificationMode: "exclude",
    ExcludedVar: [],
    CandidateFactors: [],
    CandidateCovariates: [],
    TextSource: "none",
    RawTextVar: null,
    TextVectorVars: null,
};

describe("Raw Text dari tab Variables sampai payload", () => {
    it('"3 kucing lucu" tetap utuh sampai payload (rawTextValues dari data store)', () => {
        const result = moveVariables(BASE_MAIN, ["Teks"], "rawText", new Map([["Teks", teksVar]]));
        const main = { ...BASE_MAIN, ...(result?.update ?? {}) } as NaiveBayesMainType;
        expect(main.RawTextVar).toBe("Teks");

        // Meniru `useDataStore.data[row][columnIndex]`.
        const storeData: (string | number | null)[][] = [
            ["pos", "3 kucing lucu"],
            ["neg", "2024 pilkada seru"],
            ["pos", null],
        ];
        const rawTextValues = storeData.map((row) => row[teksVar.columnIndex]);

        const payload = buildNaiveBayesTextPayload(main, [], storeData.length, rawTextValues);
        expect(payload).toEqual({
            source: "raw",
            variable: "Teks",
            values: ["3 kucing lucu", "2024 pilkada seru", null],
        });
    });
});
