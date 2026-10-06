import type { VectorizerOutput } from "../types";
import { DEFAULT_COLUMN_PREFIX } from "./columnPrefix";

/** Satu kolom yang akan ditambahkan ke dataset. */
export interface VectorColumn {
    variable_name: string;
    values: number[];
}

/**
 * Fungsi pemberi nama variabel unik. `claimedNames` = nama yang sudah dipakai kolom vektor
 * sebelumnya pada pemanggilan ini. Mengembalikan nama final, atau undefined bila gagal.
 */
export type ResolveVariableName = (baseName: string, claimedNames: readonly string[]) => string | undefined;

/**
 * Membentuk daftar kolom dari hasil vektorisasi (murni, tanpa React/store).
 * Nilai kolom ke-j = matrix[i][j] untuk setiap baris i, sehingga baris dataset
 * sejajar dengan dokumen asli (F01). Nama dasar kolom = `prefix` + kata.
 */
export function buildColumnData(
    result: Pick<VectorizerOutput, "vocabulary" | "matrix">,
    resolveName: ResolveVariableName,
    prefix: string = DEFAULT_COLUMN_PREFIX
): VectorColumn[] {
    const claimed: string[] = [];
    return result.vocabulary.map((term, colIndex) => {
        const finalName = resolveName(`${prefix}${term}`, claimed) || `${prefix}VAR_${colIndex}`;
        claimed.push(finalName);
        return {
            variable_name: finalName,
            values: result.matrix.map((row) => row[colIndex] ?? 0),
        };
    });
}
