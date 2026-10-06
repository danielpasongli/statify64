import { writeStwvOutput } from "../utils/writeStwvOutput";
import { buildStwvOutput } from "../utils/buildStwvOutput";
import { STWV_DEFAULT_CONFIG } from "../config";

const mockAddLog = jest.fn(async () => 1);
const mockAddAnalytic = jest.fn(async () => 2);
const mockAddStatistic = jest.fn(async () => 3);

jest.mock("@/stores/useResultStore", () => ({
    useResultStore: {
        getState: () => ({
            addLog: mockAddLog,
            addAnalytic: mockAddAnalytic,
            addStatistic: mockAddStatistic,
        }),
    },
}));

describe("writeStwvOutput", () => {
    it("mengisi description setiap statistic dengan interpretasi (bukan judul/kosong)", async () => {
        const out = buildStwvOutput({
            variableName: "teks",
            config: STWV_DEFAULT_CONFIG,
            result: {
                vocabulary: ["a", "b"],
                matrix: [[1, 0], [0, 0]],
                stats: { total_documents: 2, vocabulary_size: 2, method: "x" },
            },
            columnPrefix: "VEC_",
            columnNames: ["VEC_a", "VEC_b"],
        });
        await writeStwvOutput(out);

        const calls = (mockAddStatistic.mock.calls as unknown as [number, { title: string; description: string; components: string }][]).map((c) => c[1]);
        expect(calls.map((c) => c.components)).toEqual([
            "Executed",
            "String to Word Vector Processing Summary",
            "String to Word Vector Settings",
            "String to Word Vector Vocabulary",
        ]);
        for (const c of calls) {
            expect(c.description.startsWith("<p><strong>What this shows.</strong>")).toBe(true);
        }
    });
});
