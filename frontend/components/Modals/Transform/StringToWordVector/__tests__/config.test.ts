import {
    STWV_DEFAULT_CONFIG,
    applyFormulaStandard,
    getVectorDecimals,
    toRustConfig,
    validateStwvConfig,
    type StwvConfig,
    type TfMethod,
} from "../config";

/** Salinan config default dengan override sebagian (tanpa mengubah default). */
const withOverrides = (patch: Partial<StwvConfig>): StwvConfig => ({ ...STWV_DEFAULT_CONFIG, ...patch });

describe("STWV_DEFAULT_CONFIG (D6)", () => {
    it("default = Weka / raw / none / none", () => {
        expect(STWV_DEFAULT_CONFIG.formulaStandard).toBe("weka");
        expect(STWV_DEFAULT_CONFIG.vectorization).toEqual({
            tfMethod: "raw",
            idfMethod: "none",
            normalization: "none",
        });
    });

    it("opsi lain tetap default lama", () => {
        expect(STWV_DEFAULT_CONFIG.lowercase).toBe(true);
        expect(STWV_DEFAULT_CONFIG.stopwords.method).toBe("none");
        expect(STWV_DEFAULT_CONFIG.stemming.method).toBe("none");
        expect(STWV_DEFAULT_CONFIG.tokenizer.type).toBe("word");
        expect(STWV_DEFAULT_CONFIG.delimiters).toBe("[\\s.,;:'\"()?!]+");
        expect(STWV_DEFAULT_CONFIG.wordsToKeep).toBe(1000);
        expect(STWV_DEFAULT_CONFIG.minTermFreq).toBe(1);
    });

    it("default lolos validasi", () => {
        expect(validateStwvConfig(STWV_DEFAULT_CONFIG)).toEqual([]);
    });
});

describe("toRustConfig (kontrak §3.1)", () => {
    it("default menghasilkan nilai enum baru snake_case", () => {
        expect(toRustConfig(STWV_DEFAULT_CONFIG)).toEqual({
            lowercase: true,
            stemming_method: "none",
            stopwords_method: "none",
            custom_stopwords: null,
            delimiters: "[\\s.,;:'\"()?!]+",
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

    it("preset sklearn mengirim raw/smooth/l2", () => {
        const p = toRustConfig(applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn"));
        expect([p.formula_standard, p.tf_method, p.idf_method, p.normalization]).toEqual([
            "sklearn",
            "raw",
            "smooth",
            "l2",
        ]);
    });

    it("words_to_keep 0 dikirim apa adanya (0 = semua), tidak dipaksa 1000", () => {
        expect(toRustConfig(withOverrides({ wordsToKeep: 0 })).words_to_keep).toBe(0);
    });

    it("min_term_freq diteruskan", () => {
        expect(toRustConfig(withOverrides({ minTermFreq: 3 })).min_term_freq).toBe(3);
    });

    it("mode word memaksa n-gram 1..1; mode ngram memakai min/max", () => {
        const word = toRustConfig(withOverrides({ tokenizer: { type: "word", minSize: 2, maxSize: 4 } }));
        expect([word.ngram_min, word.ngram_max]).toEqual([1, 1]);
        const ngram = toRustConfig(withOverrides({ tokenizer: { type: "ngram", minSize: 1, maxSize: 3 } }));
        expect([ngram.ngram_min, ngram.ngram_max]).toEqual([1, 3]);
    });

    it("custom stopwords di-trim dan baris kosong dibuang", () => {
        const p = toRustConfig(withOverrides({ stopwords: { method: "custom", customList: " a \n\nb\n" } }));
        expect(p.custom_stopwords).toBe('["a","b"]');
    });
});

describe("validateStwvConfig", () => {
    const ngram = (minSize: number, maxSize: number): StwvConfig =>
        withOverrides({ tokenizer: { type: "ngram", minSize, maxSize } });

    it("menolak n-gram min > max", () => {
        expect(validateStwvConfig(ngram(3, 2))).toHaveLength(1);
    });

    it("menolak n-gram 6", () => {
        expect(validateStwvConfig(ngram(1, 6))).toHaveLength(1);
    });

    it("menerima n-gram 1..5", () => {
        expect(validateStwvConfig(ngram(1, 5))).toEqual([]);
        expect(validateStwvConfig(ngram(2, 2))).toEqual([]);
    });

    it("mode word tidak memvalidasi ukuran n-gram (nilainya tidak dipakai)", () => {
        expect(validateStwvConfig(withOverrides({ tokenizer: { type: "word", minSize: 3, maxSize: 2 } }))).toEqual([]);
    });

    it("menolak wordsToKeep negatif atau non-bulat; menerima 0", () => {
        expect(validateStwvConfig(withOverrides({ wordsToKeep: -1 }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ wordsToKeep: 1.5 }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ wordsToKeep: 0 }))).toEqual([]);
    });

    it("menolak minTermFreq 0, negatif, atau non-bulat", () => {
        expect(validateStwvConfig(withOverrides({ minTermFreq: 0 }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ minTermFreq: -2 }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ minTermFreq: 2.5 }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ minTermFreq: 2 }))).toEqual([]);
    });

    it("menolak delimiter kosong", () => {
        expect(validateStwvConfig(withOverrides({ delimiters: "" }))).toHaveLength(1);
    });

    it("menolak sklearn + doc_length", () => {
        const cfg = applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn");
        const bad: StwvConfig = { ...cfg, vectorization: { ...cfg.vectorization, normalization: "doc_length" } };
        expect(validateStwvConfig(bad)).toHaveLength(1);
    });

    it("menolak Weka + sublinear / smooth / l2, dan TF 'none' sisa v1", () => {
        const v = STWV_DEFAULT_CONFIG.vectorization;
        expect(validateStwvConfig(withOverrides({ vectorization: { ...v, tfMethod: "sublinear" } }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ vectorization: { ...v, idfMethod: "smooth" } }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ vectorization: { ...v, normalization: "l2" } }))).toHaveLength(1);
        expect(validateStwvConfig(withOverrides({ vectorization: { ...v, tfMethod: "none" as unknown as TfMethod } }))).toHaveLength(1);
    });

    it("Weka + log1p/standard/doc_length sah; Custom menerima semua kombinasi", () => {
        const weka = withOverrides({
            vectorization: { tfMethod: "log1p", idfMethod: "standard", normalization: "doc_length" },
        });
        expect(validateStwvConfig(weka)).toEqual([]);
        const custom = withOverrides({
            formulaStandard: "custom",
            vectorization: { tfMethod: "normalized", idfMethod: "plus1", normalization: "l1" },
        });
        expect(validateStwvConfig(custom)).toEqual([]);
    });

    it("mengumpulkan beberapa pesan sekaligus", () => {
        expect(validateStwvConfig(withOverrides({ wordsToKeep: -1, minTermFreq: 0 }))).toHaveLength(2);
    });
});

describe("applyFormulaStandard", () => {
    it("sklearn → raw/smooth/l2", () => {
        const cfg = applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn");
        expect(cfg.formulaStandard).toBe("sklearn");
        expect(cfg.vectorization).toEqual({ tfMethod: "raw", idfMethod: "smooth", normalization: "l2" });
    });

    it("weka → raw/none/none (menimpa nilai sebelumnya)", () => {
        const sk = applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn");
        const cfg = applyFormulaStandard(sk, "weka");
        expect(cfg.formulaStandard).toBe("weka");
        expect(cfg.vectorization).toEqual({ tfMethod: "raw", idfMethod: "none", normalization: "none" });
    });

    it("custom mempertahankan nilai saat ini", () => {
        const sk = applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn");
        const cfg = applyFormulaStandard(sk, "custom");
        expect(cfg.formulaStandard).toBe("custom");
        expect(cfg.vectorization).toEqual(sk.vectorization);
    });

    it("tidak mengubah opsi lain dan tidak memutasi input", () => {
        const base = withOverrides({ wordsToKeep: 50, minTermFreq: 2 });
        const snapshot = JSON.stringify(base);
        const cfg = applyFormulaStandard(base, "sklearn");
        expect(cfg.wordsToKeep).toBe(50);
        expect(cfg.minTermFreq).toBe(2);
        expect(JSON.stringify(base)).toBe(snapshot);
    });

    it("hasil setiap standar selalu lolos validasi", () => {
        for (const std of ["weka", "sklearn", "custom"] as const) {
            expect(validateStwvConfig(applyFormulaStandard(STWV_DEFAULT_CONFIG, std))).toEqual([]);
        }
    });
});

describe("getVectorDecimals", () => {
    const vec = (tfMethod: TfMethod, idfMethod: StwvConfig["vectorization"]["idfMethod"], normalization: StwvConfig["vectorization"]["normalization"]): StwvConfig =>
        withOverrides({ vectorization: { tfMethod, idfMethod, normalization } });

    it("default (raw/none/none) → 0 desimal; binary/none/none → 0", () => {
        expect(getVectorDecimals(STWV_DEFAULT_CONFIG)).toBe(0);
        expect(getVectorDecimals(vec("binary", "none", "none"))).toBe(0);
    });

    it("IDF aktif, normalisasi aktif, atau TF non-bulat → 4 desimal", () => {
        expect(getVectorDecimals(vec("raw", "standard", "none"))).toBe(4);
        expect(getVectorDecimals(vec("raw", "none", "l2"))).toBe(4);
        expect(getVectorDecimals(vec("raw", "none", "doc_length"))).toBe(4);
        expect(getVectorDecimals(vec("log1p", "none", "none"))).toBe(4);
    });
});
