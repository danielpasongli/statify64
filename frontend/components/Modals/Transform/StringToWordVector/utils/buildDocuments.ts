import type { AppError } from "../types";

/** Tipe sel mentah dari kolom dataset. */
export type RawCell = string | number | null | undefined;

/**
 * Mengubah kolom dataset menjadi daftar dokumen teks.
 * F01: JANGAN membuang baris — null/undefined menjadi "" agar indeks dokumen
 * tetap sejajar dengan indeks baris dataset (Rust menghasilkan vektor nol untuk "").
 */
export function buildDocuments(column: readonly RawCell[]): string[] {
    return column.map((v) => (v === null || v === undefined ? "" : String(v)));
}

/** True bila tidak ada dokumen, atau semua dokumen kosong/hanya whitespace. */
export function areAllDocumentsEmpty(documents: readonly string[]): boolean {
    return documents.every((d) => d.trim() === "");
}

/** Error untuk UI bila semua dokumen kosong (worker tidak boleh dipanggil). */
export const EMPTY_DATA_ERROR: AppError = {
    code: "EMPTY_DATA",
    message: "The selected variable has no text data. Select a variable that contains text and try again.",
};
