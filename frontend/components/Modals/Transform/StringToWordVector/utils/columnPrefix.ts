/** Awalan nama kolom vektor di dataset (nama final = awalan + kata, mis. VEC_makan). */
export const DEFAULT_COLUMN_PREFIX = "VEC_";

/** Panjang maksimum awalan; sisa dari batas 64 karakter nama variabel dipakai untuk kata. */
export const MAX_COLUMN_PREFIX_LENGTH = 32;

/**
 * Validasi awalan nama kolom. Mengembalikan pesan error (Bahasa Inggris),
 * atau null bila sah. Aturan mengikuti penamaan variabel (huruf/@/#/$ di awal,
 * lalu huruf, angka, titik, underscore, @, #, $).
 */
export function validateColumnPrefix(prefix: string): string | null {
    if (prefix.trim().length === 0) {
        return "Vector column name cannot be empty.";
    }
    if (prefix !== prefix.trim() || /\s/.test(prefix)) {
        return "Vector column name cannot contain spaces.";
    }
    if (prefix.length > MAX_COLUMN_PREFIX_LENGTH) {
        return `Vector column name must be at most ${MAX_COLUMN_PREFIX_LENGTH} characters long.`;
    }
    if (!/^[A-Za-z@#$]/.test(prefix)) {
        return "Vector column name must start with a letter, @, # or $.";
    }
    if (!/^[A-Za-z0-9._@#$]+$/.test(prefix)) {
        return "Vector column name can only contain letters, digits, periods, underscores, @, # and $.";
    }
    return null;
}
