import {
    detectFreeTextStrings,
    detectVectorLikeColumns,
    getLeakageNote,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";
import type { Variable } from "@/types/Variable";

const makeVariable = (
    name: string,
    columnIndex: number,
    measure: Variable["measure"],
    type: Variable["type"] = "NUMERIC"
): Variable => ({
    columnIndex,
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

/** Membuat n kolom numerik sparse (nilai >= 0, 1 dari 10 baris bernilai 3). */
const sparseSetup = (nCols: number, nRows = 50) => {
    const variables = Array.from({ length: nCols }, (_, c) =>
        makeVariable(`VEC_${c}`, c, "scale")
    );
    const data: number[][] = Array.from({ length: nRows }, (_, r) =>
        Array.from({ length: nCols }, (): number => (r % 10 === 0 ? 3 : 0))
    );
    return { variables, data, names: variables.map((v) => v.name) };
};

describe("detectVectorLikeColumns (W-VEC)", () => {
    it("20 kolom sparse -> peringatan dengan jumlah kolom", () => {
        const { variables, data, names } = sparseSetup(20);
        const result = detectVectorLikeColumns(names, variables, data);

        expect(result.columns).toHaveLength(20);
        expect(result.message).toBe(
            "20 numeric columns look like word vectors. Move them to Text Features to use a text likelihood such as Multinomial."
        );
    });

    it("19 kolom sparse -> tidak ada peringatan", () => {
        const { variables, data, names } = sparseSetup(19);
        const result = detectVectorLikeColumns(names, variables, data);

        expect(result.columns).toHaveLength(19);
        expect(result.message).toBeNull();
    });

    it("kolom dengan nilai negatif atau tidak sparse tidak dihitung", () => {
        const { variables, data, names } = sparseSetup(20);
        // kolom 0: ada nilai negatif; kolom 1: padat (tidak > 50% nol)
        data[5][0] = -1;
        for (const row of data) row[1] = 7;

        const result = detectVectorLikeColumns(names, variables, data);

        expect(result.columns).toHaveLength(18);
        expect(result.columns).not.toContain("VEC_0");
        expect(result.columns).not.toContain("VEC_1");
        expect(result.message).toBeNull();
    });

    it("tepat 50% nol bukan 'lebih dari 50%' -> tidak dihitung", () => {
        const variables = [makeVariable("x", 0, "scale")];
        const data = [[0], [0], [1], [1]];
        expect(detectVectorLikeColumns(["x"], variables, data).columns).toEqual([]);
    });

    it("hanya variabel scale (Numeric); nominal diabaikan; missing tidak dihitung", () => {
        const variables = [
            makeVariable("n", 0, "nominal"),
            makeVariable("s", 1, "scale"),
        ];
        const data = [
            [0, 0],
            [0, null],
            [0, ""],
            [0, 5],
        ];
        const result = detectVectorLikeColumns(["n", "s"], variables, data);
        // s: non-missing [0, 5] -> 1/2 nol (bukan > 50%) -> tidak dihitung
        expect(result.columns).toEqual([]);
    });

    it("sampel dibatasi 1.000 baris pertama", () => {
        const variables = [makeVariable("x", 0, "scale")];
        // 1.000 baris pertama padat (nilai 1); sesudahnya 9.000 baris nol.
        const data = [
            ...Array.from({ length: 1000 }, () => [1]),
            ...Array.from({ length: 9000 }, () => [0]),
        ];
        expect(detectVectorLikeColumns(["x"], variables, data).columns).toEqual([]);
        // Dengan batas lebih besar kolom ini sparse -> terdeteksi.
        expect(
            detectVectorLikeColumns(["x"], variables, data, 10000).columns
        ).toEqual(["x"]);
    });
});

describe("detectFreeTextStrings (W-STR)", () => {
    const variables = [makeVariable("kalimat", 0, "nominal", "STRING")];

    it("nilai unik 50% -> peringatan dengan nama kolom", () => {
        const data = [["a"], ["a"], ["b"], ["b"]]; // 2 unik / 4 = 50%
        const result = detectFreeTextStrings(["kalimat"], variables, data);

        expect(result.columns).toEqual(["kalimat"]);
        expect(result.messages).toEqual([
            "Column 'kalimat' looks like free text or an ID. Exclude it or move it to Text Features.",
        ]);
    });

    it("nilai unik di bawah 50% -> tidak ada peringatan", () => {
        const data = [["a"], ["a"], ["a"], ["b"]]; // 2/4? -> 50%, ganti: 2 unik dari 5
        data.push(["a"]);
        const result = detectFreeTextStrings(["kalimat"], variables, data);

        expect(result.columns).toEqual([]);
        expect(result.messages).toEqual([]);
    });

    it("nilai kosong tidak dihitung; variabel non-STRING diabaikan", () => {
        const vars = [
            makeVariable("kalimat", 0, "nominal", "STRING"),
            makeVariable("angka", 1, "nominal", "NUMERIC"),
        ];
        const data = [
            ["a", 1],
            ["a", 2],
            ["a", 3],
            ["", 4],
            [null, 5],
            ["  ", 6],
        ];
        const result = detectFreeTextStrings(["kalimat", "angka"], vars, data);
        expect(result.columns).toEqual([]);
    });

    it("sampel dibatasi 5.000 baris", () => {
        const unik = Array.from({ length: 5000 }, (_, i) => [`k${i % 10}`]);
        const sisa = Array.from({ length: 5000 }, (_, i) => [`u${i}`]);
        const data = [...unik, ...sisa];
        expect(detectFreeTextStrings(["kalimat"], variables, data).columns).toEqual([]);
        expect(
            detectFreeTextStrings(["kalimat"], variables, data, 10000).columns
        ).toEqual(["kalimat"]);
    });
});

describe("getLeakageNote (W-LEAK)", () => {
    it("hanya untuk sumber vector", () => {
        expect(getLeakageNote("vector")).toBe(
            "The vocabulary and IDF of these vector columns were computed outside Naive Bayes on all rows, so evaluation results may be slightly optimistic."
        );
        expect(getLeakageNote("raw")).toBeNull();
        expect(getLeakageNote("none")).toBeNull();
    });
});
