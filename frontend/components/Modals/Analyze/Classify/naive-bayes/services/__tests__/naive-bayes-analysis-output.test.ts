import {
    transformNaiveBayesResult,
    type NaiveBayesRawResult,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";
import { resultNaiveBayes } from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-output";
import { mergeWithDefaults } from "@/components/Modals/Analyze/Classify/naive-bayes/constants/naive-bayes-default";
import { readFileSync } from "fs";
import { join } from "path";

const mockAddStatistic = jest.fn();
jest.mock("@/stores/useResultStore", () => ({
    useResultStore: {
        getState: () => ({
            addLog: jest.fn().mockResolvedValue(1),
            addAnalytic: jest.fn().mockResolvedValue(2),
            addStatistic: (...args: unknown[]) => mockAddStatistic(...args),
        }),
    },
}));

// Fixture dibaca lewat fs (bukan import JSON) agar `tsc -p frontend` (composite) tidak
// menolaknya dengan TS6307 karena JSON tidak masuk daftar file proyek.
const stubResult: unknown = JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", "naive-bayes-stub-result.json"), "utf8")
);
const stub = stubResult as unknown as NaiveBayesRawResult;

const TEXT_FEATURE_TABLE = {
    likelihood: "multinomial" as const,
    classes: ["neg", "pos"],
    k: 1,
    top: {
        neg: [{ term: "tidak", score: 0.98083, log_weight: -1.504077, count: 1 }],
        pos: [{ term: "makan", score: 1.321756, log_weight: -0.875469, count: 4 }],
    },
    full: [
        { term: "tidak", class: "neg", count: 1, log_weight: -1.504077, probability: 0.222222, score: 0.98083 },
        { term: "makan", class: "pos", count: 4, log_weight: -0.875469, probability: 0.416667, score: 1.321756 },
    ],
};

const run = async (opts: { rawText: string | null; flag: boolean; withTable: boolean }) => {
    const configData = mergeWithDefaults(null);
    configData.main.RawTextVar = opts.rawText;
    configData.output.TextFeatureTable = opts.flag;
    const rawResult: NaiveBayesRawResult = opts.withTable
        ? { ...stub, text_feature_table: TEXT_FEATURE_TABLE }
        : stub;
    const formattedResult = transformNaiveBayesResult(rawResult, configData.output);
    await resultNaiveBayes({ formattedResult, rawResult, configData });
    return mockAddStatistic.mock.calls.map((c) => c[1] as { title: string; description: string; components: string; output_data: string });
};

describe("resultNaiveBayes: Text Feature Table", () => {
    beforeEach(() => mockAddStatistic.mockReset());

    it("Text Features terisi + flag + data: statistic 'Text Feature Table' sebelum Export Model", async () => {
        const stats = await run({ rawText: "Text Tweet", flag: true, withTable: true });
        const titles = stats.map((s) => s.title);
        expect(titles).toContain("Text Feature Table");
        expect(titles.indexOf("Text Feature Table")).toBe(titles.indexOf("Export Model") - 1);

        const stat = stats.find((s) => s.title === "Text Feature Table")!;
        expect(stat.components).toBe("Text Feature Table");
        const payload = JSON.parse(stat.output_data);
        // Tabel Top-k (untuk renderer generik) + struktur lengkap (untuk CSV/TSV).
        expect(payload.tables[0].key).toBe("text_feature_table");
        expect(payload.textFeatureTable.full).toHaveLength(2);
        expect(payload.textFeatureTable.top.pos[0].term).toBe("makan");
    });

    it("opsi tersimpan true tetapi tidak ada Text Features: statistic Text diabaikan", async () => {
        const stats = await run({ rawText: null, flag: true, withTable: true });
        expect(stats.map((s) => s.title)).not.toContain("Text Feature Table");
    });

    it("Text Features terisi tetapi Rust tidak mengirim tabel: diabaikan", async () => {
        const stats = await run({ rawText: "Text Tweet", flag: true, withTable: false });
        expect(stats.map((s) => s.title)).not.toContain("Text Feature Table");
    });

    it("flag dimatikan: diabaikan", async () => {
        const stats = await run({ rawText: "Text Tweet", flag: false, withTable: true });
        expect(stats.map((s) => s.title)).not.toContain("Text Feature Table");
    });

    it("v1: statistic yang dipasang sama seperti sebelum v2", async () => {
        const stats = await run({ rawText: null, flag: true, withTable: false });
        expect(stats.map((s) => s.title)).toEqual([
            "Case Processing Summary",
            "Attribute Distribution Table",
            "Model Evaluation Metrics",
            "Cohen's Kappa",
            "Confusion Matrix",
            "Export Model",
        ]);
    });

    it("setiap statistic punya description HTML berbahasa Inggris (interpretasi otomatis)", async () => {
        const stats = await run({ rawText: "Text Tweet", flag: true, withTable: true });
        expect(stats.length).toBeGreaterThanOrEqual(7);
        stats.forEach((stat) => {
            expect(stat.description).toMatch(/^<p><strong>What this shows\.<\/strong>/);
            expect(stat.description).not.toMatch(/NaN|undefined|\[object|AGENTS|§/);
            expect(stat.description).not.toBe(stat.title);
        });
        const kappa = stats.find((s) => s.title === "Cohen's Kappa")!;
        expect(kappa.description).toContain("0.917");
        expect(kappa.description).toContain("almost perfect");
        const exportModel = stats.find((s) => s.title === "Export Model")!;
        expect(exportModel.description).toContain("Apply Model");
    });
});
