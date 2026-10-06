import type { AppError } from "../types";

const DEFAULT_CODE = "WASM_ERROR";
const DEFAULT_MESSAGE = "An unknown error occurred while creating the word vectors.";

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;

/** Mengambil teks tak-kosong dari sebuah nilai, atau undefined. */
const nonEmptyText = (v: unknown): string | undefined => {
    if (typeof v === "string") return v.trim() === "" ? undefined : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return undefined;
};

function fromRecord(obj: Record<string, unknown>, fallbackCode: string): AppError {
    return {
        code: nonEmptyText(obj.code) ?? fallbackCode,
        message: nonEmptyText(obj.message) ?? DEFAULT_MESSAGE,
    };
}

/**
 * Menormalkan error apa pun dari worker/WASM menjadi { code, message } yang selalu terisi.
 * Menerima: string JSON, string biasa, objek {code,message}, Error, atau nilai lain.
 * Tidak pernah melempar error.
 */
export function normalizeWorkerError(payload: unknown, fallbackCode: string = DEFAULT_CODE): AppError {
    try {
        if (typeof payload === "string") {
            const raw = payload.trim();
            if (raw === "") return { code: fallbackCode, message: DEFAULT_MESSAGE };
            try {
                const parsed: unknown = JSON.parse(raw);
                if (isRecord(parsed)) return fromRecord(parsed, fallbackCode);
            } catch {
                // bukan JSON → perlakukan sebagai pesan biasa
            }
            return { code: fallbackCode, message: raw };
        }

        if (payload instanceof Error) {
            const withCode = payload as Error & { code?: unknown };
            return {
                code: nonEmptyText(withCode.code) ?? fallbackCode,
                message: nonEmptyText(payload.message) ?? DEFAULT_MESSAGE,
            };
        }

        if (isRecord(payload)) {
            return fromRecord(payload, fallbackCode);
        }

        const text = nonEmptyText(payload);
        return { code: fallbackCode, message: text ?? DEFAULT_MESSAGE };
    } catch {
        return { code: fallbackCode, message: DEFAULT_MESSAGE };
    }
}
