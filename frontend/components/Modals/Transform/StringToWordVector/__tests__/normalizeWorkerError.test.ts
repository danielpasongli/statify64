import { normalizeWorkerError } from "../utils/normalizeWorkerError";

describe("normalizeWorkerError (F04)", () => {
    it("T3: string JSON {code,message} → objek terisi", () => {
        expect(normalizeWorkerError('{"code":"EMPTY_VOCABULARY","message":"x"}')).toEqual({
            code: "EMPTY_VOCABULARY",
            message: "x",
        });
    });

    it("objek {code,message} diteruskan", () => {
        expect(normalizeWorkerError({ code: "INVALID_REGEX", message: "regex salah" })).toEqual({
            code: "INVALID_REGEX",
            message: "regex salah",
        });
    });

    it("objek tanpa message → message fallback tak kosong, code dipertahankan", () => {
        const e = normalizeWorkerError({ code: "INVALID_CONFIG" });
        expect(e.code).toBe("INVALID_CONFIG");
        expect(e.message.length).toBeGreaterThan(0);
    });

    it("Error → WASM_ERROR dengan message Error", () => {
        expect(normalizeWorkerError(new Error("gagal init"))).toEqual({
            code: "WASM_ERROR",
            message: "gagal init",
        });
    });

    it("Error dengan properti code string dipertahankan", () => {
        const err = Object.assign(new Error("m"), { code: "X1" });
        expect(normalizeWorkerError(err)).toEqual({ code: "X1", message: "m" });
    });

    it("string biasa (bukan JSON) menjadi message", () => {
        expect(normalizeWorkerError("sesuatu gagal")).toEqual({ code: "WASM_ERROR", message: "sesuatu gagal" });
    });

    it("string JSON non-objek diperlakukan sebagai pesan biasa", () => {
        expect(normalizeWorkerError("123")).toEqual({ code: "WASM_ERROR", message: "123" });
    });

    it("undefined / null / string kosong → selalu terisi", () => {
        for (const v of [undefined, null, "", "   ", {}, []]) {
            const e = normalizeWorkerError(v);
            expect(e.code).toBe("WASM_ERROR");
            expect(e.message.length).toBeGreaterThan(0);
        }
    });

    it("fallbackCode kustom dipakai (mis. onerror worker)", () => {
        expect(normalizeWorkerError("boom", "WORKER_ERROR")).toEqual({ code: "WORKER_ERROR", message: "boom" });
    });
});
