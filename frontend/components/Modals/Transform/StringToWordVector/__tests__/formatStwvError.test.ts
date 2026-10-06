import { formatStwvError } from "../utils/formatStwvError";
import { EMPTY_DATA_ERROR } from "../utils/buildDocuments";
import { normalizeWorkerError } from "../utils/normalizeWorkerError";
import { validateColumnPrefix } from "../utils/columnPrefix";
import { STWV_DEFAULT_CONFIG, validateStwvConfig } from "../config";

/** Kata Indonesia umum yang tidak boleh muncul di teks pengguna. */
const INDONESIAN = /\b(tidak|harus|kolom|variabel|kosong|dengan|untuk|dari|gagal|terjadi|nama|hanya|boleh|diawali)\b/i;

describe("formatStwvError (PLAN_V3 E3: kode di akhir dalam kurung)", () => {
    it("kalimat utama dahulu, kode di akhir", () => {
        expect(formatStwvError({ code: "EMPTY_VOCABULARY", message: "The vocabulary is empty." })).toBe(
            "The vocabulary is empty. (EMPTY_VOCABULARY)"
        );
    });

    it("menambahkan titik bila belum ada tanda baca", () => {
        expect(formatStwvError({ code: "INVALID_REGEX", message: "The delimiter pattern is not a valid regex" })).toBe(
            "The delimiter pattern is not a valid regex. (INVALID_REGEX)"
        );
    });

    it("membuang awalan kode lama ([KODE] dan KODE:) agar kode tidak di awal", () => {
        expect(formatStwvError({ code: "INVALID_CONFIG", message: "[INVALID_CONFIG] Bad value." })).toBe("Bad value. (INVALID_CONFIG)");
        expect(formatStwvError({ code: "INVALID_CONFIG", message: "INVALID_CONFIG: Bad value." })).toBe("Bad value. (INVALID_CONFIG)");
    });

    it("tidak menggandakan kode yang sudah ada di akhir pesan", () => {
        expect(formatStwvError({ code: "X_1", message: "Something failed. (X_1)" })).toBe("Something failed. (X_1)");
    });

    it("pesan kosong atau kode kosong tetap menghasilkan teks wajar", () => {
        expect(formatStwvError({ code: "X_1", message: "" })).toBe("(X_1)");
        expect(formatStwvError({ code: "", message: "Oops" })).toBe("Oops.");
    });

    it("kode berisi karakter khusus regex tidak membuat galat", () => {
        expect(() => formatStwvError({ code: "A.B(C)", message: "m" })).not.toThrow();
    });
});

describe("pesan galat STWV berbahasa Inggris", () => {
    it("EMPTY_DATA_ERROR dan galat tak dikenal", () => {
        expect(EMPTY_DATA_ERROR.message).toMatch(/no text data/);
        expect(formatStwvError(EMPTY_DATA_ERROR)).toMatch(/\(EMPTY_DATA\)$/);
        expect(normalizeWorkerError(undefined).message).toBe("An unknown error occurred while creating the word vectors.");
    });

    it("validasi awalan kolom", () => {
        const messages = ["", "a b", "A".repeat(33), "1A", "A-"].map((p) => validateColumnPrefix(p));
        for (const m of messages) {
            expect(m).not.toBeNull();
            expect(m).toMatch(/^Vector column name /);
            expect(m).not.toMatch(INDONESIAN);
        }
    });

    it("validasi config", () => {
        const errs = validateStwvConfig({
            ...STWV_DEFAULT_CONFIG,
            tokenizer: { type: "ngram", minSize: 3, maxSize: 2 },
            wordsToKeep: -1,
            minTermFreq: 0,
            delimiters: "",
        });
        expect(errs).toHaveLength(4);
        expect(errs[0]).toBe("N-gram min size cannot be greater than max size.");
        for (const e of errs) expect(e).not.toMatch(INDONESIAN);
    });
});
