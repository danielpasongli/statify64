import { buildStwvOutput, countZeroRows, MAX_VOCABULARY_ROWS } from "../utils/buildStwvOutput";
import { STWV_DEFAULT_CONFIG } from "../config";
import type { VectorizerOutput } from "../types";

const result: VectorizerOutput = {
    vocabulary: ["makan", "nasi"],
    matrix: [
        [1, 1],
        [0, 0],
        [3, 0],
    ],
    stats: { total_documents: 3, vocabulary_size: 2, method: "x" },
};

const build = (over: Partial<Parameters<typeof buildStwvOutput>[0]> = {}) =>
    buildStwvOutput({
        variableName: "teks",
        config: STWV_DEFAULT_CONFIG,
        result,
        columnPrefix: "VEC_",
        columnNames: ["VEC_makan", "VEC_nasi"],
        ...over,
    });

const valueOf = (tableKey: string, label: string, out = build()) => {
    const table = out.tables.find((t) => t.key === tableKey);
    return table?.rows.find((r) => r.rowHeader[0] === label)?.value;
};

describe("buildStwvOutput", () => {
    it("countZeroRows menghitung baris nol", () => {
        expect(countZeroRows(result.matrix)).toBe(1);
        expect(countZeroRows([])).toBe(0);
    });

    it("tiga tabel: summary, settings, vocabulary", () => {
        expect(build().tables.map((t) => t.key)).toEqual([
            "stwv_processing_summary",
            "stwv_settings",
            "stwv_vocabulary",
        ]);
    });

    it("processing summary berisi angka yang benar", () => {
        const out = build({ durationMs: 12.4 });
        expect(valueOf("stwv_processing_summary", "Source Variable", out)).toBe("teks");
        expect(valueOf("stwv_processing_summary", "Documents (Rows)", out)).toBe(3);
        expect(valueOf("stwv_processing_summary", "Documents with Zero Vector", out)).toBe(1);
        expect(valueOf("stwv_processing_summary", "Vocabulary Size", out)).toBe(2);
        expect(valueOf("stwv_processing_summary", "Columns Added to Dataset", out)).toBe(2);
        expect(valueOf("stwv_processing_summary", "Column Name Prefix", out)).toBe("VEC_");
        expect(valueOf("stwv_processing_summary", "First – Last Column", out)).toBe("VEC_makan – VEC_nasi");
        expect(valueOf("stwv_processing_summary", "Processing Time (ms)", out)).toBe(12);
    });

    it("tanpa durasi, baris waktu tidak ada", () => {
        expect(valueOf("stwv_processing_summary", "Processing Time (ms)")).toBeUndefined();
    });

    it("settings mencerminkan default Weka", () => {
        expect(valueOf("stwv_settings", "Formula Standard")).toBe("Weka");
        expect(valueOf("stwv_settings", "Words to Keep")).toBe(1000);
        expect(valueOf("stwv_settings", "Minimum Term Frequency")).toBe(1);
        expect(valueOf("stwv_settings", "Stopwords")).toBe("None");
    });

    it("words_to_keep 0 ditampilkan All", () => {
        const out = build({ config: { ...STWV_DEFAULT_CONFIG, wordsToKeep: 0 } });
        expect(valueOf("stwv_settings", "Words to Keep", out)).toBe("All");
    });

    it("vocabulary: term, kolom, dan jumlah dokumen non-nol", () => {
        const rows = build().tables[2].rows;
        expect(rows[0]).toMatchObject({ term: "makan", column: "VEC_makan", documents: 2 });
        expect(rows[1]).toMatchObject({ term: "nasi", column: "VEC_nasi", documents: 1 });
    });

    it("vocabulary dipotong MAX_VOCABULARY_ROWS dengan catatan", () => {
        const n = MAX_VOCABULARY_ROWS + 5;
        const vocabulary = Array.from({ length: n }, (_, i) => `w${i}`);
        const big: VectorizerOutput = {
            vocabulary,
            matrix: [vocabulary.map(() => 1)],
            stats: { total_documents: 1, vocabulary_size: n, method: "x" },
        };
        const out = build({ result: big, columnNames: vocabulary.map((w) => `VEC_${w}`) });
        const vocab = out.tables.find((t) => t.key === "stwv_vocabulary");
        expect(vocab?.rows).toHaveLength(MAX_VOCABULARY_ROWS);
        expect(vocab?.note).toContain(String(n));
    });

    it("teks ringkasan dan log menyebut variabel", () => {
        const out = build();
        expect(out.summaryText).toContain("teks");
        expect(out.summaryText).toContain("2 vector columns were created");
        expect(out.logText).toContain("STRING TO WORD VECTOR teks");
    });

    it("output dapat diserialisasi JSON", () => {
        expect(() => JSON.stringify({ tables: build().tables })).not.toThrow();
    });
});
