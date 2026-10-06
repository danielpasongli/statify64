import { buildColumnData } from "../utils/buildColumnData";
import { resolveVariable } from "../utils/resolveVariable";
import { toRustConfig, STWV_DEFAULT_CONFIG } from "../config";

describe("buildColumnData (F01)", () => {
    // Matriks 4×2: dokumen ke-3 (indeks 2) = "b c" → [1, 1]; baris 1 & 2 nol (dokumen kosong)
    const result = {
        vocabulary: ["b", "c"],
        matrix: [
            [0, 0],
            [0, 0],
            [1, 1],
            [5, 7],
        ],
    };
    const resolveName = (base: string) => base;

    it("2 kolom, masing-masing panjang 4 (sejajar baris dataset)", () => {
        const cols = buildColumnData(result, resolveName);
        expect(cols).toHaveLength(2);
        expect(cols[0].values).toHaveLength(4);
        expect(cols[1].values).toHaveLength(4);
    });

    it("baris ke-3 = vektor dokumen ke-3", () => {
        const cols = buildColumnData(result, resolveName);
        expect([cols[0].values[2], cols[1].values[2]]).toEqual(result.matrix[2]);
        expect(cols[0].values).toEqual([0, 0, 1, 5]);
        expect(cols[1].values).toEqual([0, 0, 1, 7]);
    });

    it("nama diberi prefix VEC_ dan nama terpakai diteruskan ke resolver", () => {
        const seen: string[][] = [];
        const cols = buildColumnData(result, (base, claimed) => {
            seen.push([...claimed]);
            return base;
        });
        expect(cols.map((c) => c.variable_name)).toEqual(["VEC_b", "VEC_c"]);
        expect(seen).toEqual([[], ["VEC_b"]]);
    });

    it("resolver gagal → nama fallback VEC_VAR_<indeks>", () => {
        const cols = buildColumnData(result, () => undefined);
        expect(cols.map((c) => c.variable_name)).toEqual(["VEC_VAR_0", "VEC_VAR_1"]);
    });
});

describe("resolveVariable (F20)", () => {
    const vars = [
        { id: 1, name: "a", columnIndex: 0 },
        { id: 2, name: "b", columnIndex: 3 },
    ];
    it("menemukan berdasarkan id dan mengembalikan versi terbaru (columnIndex baru)", () => {
        const found = resolveVariable({ id: 2, name: "b" }, vars);
        expect(found?.columnIndex).toBe(3);
    });
    it("id tidak ditemukan → undefined", () => {
        expect(resolveVariable({ id: 99, name: "b" }, vars)).toBeUndefined();
    });
    it("tanpa id: cocokkan nama", () => {
        expect(resolveVariable({ name: "a" }, vars)?.id).toBe(1);
    });
});

describe("toRustConfig (perilaku v1 tidak berubah)", () => {
    it("config default → payload default baru (D6: Weka/raw/none/none)", () => {
        const p = toRustConfig(STWV_DEFAULT_CONFIG);
        expect(p).toMatchObject({
            lowercase: true,
            stemming_method: "none",
            stopwords_method: "none",
            custom_stopwords: null,
            ngram_min: 1,
            ngram_max: 1,
            formula_standard: "weka",
            tf_method: "raw",
            idf_method: "none",
            normalization: "none",
            words_to_keep: 1000,
            min_term_freq: 1,
        });
    });
    it("ngram memakai min/max; custom stopwords di-trim dan dibuang yang kosong", () => {
        const p = toRustConfig({
            ...STWV_DEFAULT_CONFIG,
            tokenizer: { type: "ngram", minSize: 1, maxSize: 3 },
            stopwords: { method: "custom", customList: " a \n\nb\n" },
        });
        expect([p.ngram_min, p.ngram_max]).toEqual([1, 3]);
        expect(p.custom_stopwords).toBe('["a","b"]');
    });
});
