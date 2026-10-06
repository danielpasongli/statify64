import { buildDocuments, areAllDocumentsEmpty } from "../utils/buildDocuments";

describe("buildDocuments (F01)", () => {
    it("T1: ['a b', null, '', 'b c'] → 4 dokumen, urutan sama, baris tidak dibuang", () => {
        const docs = buildDocuments(["a b", null, "", "b c"]);
        expect(docs).toEqual(["a b", "", "", "b c"]);
        expect(docs).toHaveLength(4);
    });

    it("undefined menjadi string kosong dan angka diubah ke string", () => {
        expect(buildDocuments([undefined, 42, 0, "x"])).toEqual(["", "42", "0", "x"]);
    });

    it("kolom kosong menghasilkan array kosong", () => {
        expect(buildDocuments([])).toEqual([]);
    });
});

describe("areAllDocumentsEmpty", () => {
    it("T2: semua null/kosong/whitespace → true", () => {
        expect(areAllDocumentsEmpty(buildDocuments([null, null, undefined]))).toBe(true);
        expect(areAllDocumentsEmpty(["", "   ", "\t\n"])).toBe(true);
        expect(areAllDocumentsEmpty([])).toBe(true);
    });

    it("minimal satu dokumen berisi → false", () => {
        expect(areAllDocumentsEmpty(["", "a", ""])).toBe(false);
    });
});
