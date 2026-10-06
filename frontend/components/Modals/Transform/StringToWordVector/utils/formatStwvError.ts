import type { AppError } from "../types";

/** Escape untuk dipakai di dalam RegExp. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Mengubah galat { code, message } menjadi satu kalimat untuk pengguna dengan pola
 * PLAN_V3 E3: kalimat utama (Inggris) dahulu, kode internal di akhir dalam kurung.
 * Contoh: `The vocabulary is empty after preprocessing. (EMPTY_VOCABULARY)`.
 *
 * - Awalan kode di depan pesan (`[KODE] ...` atau `KODE: ...`) dibuang agar kode tidak tampil di awal.
 * - Bila pesan sudah berakhir dengan `(KODE)`, kode tidak ditambahkan dua kali.
 * - Kalimat utama diberi titik bila belum berakhir dengan tanda baca.
 */
export function formatStwvError(error: AppError): string {
    const code = error.code.trim();
    let message = error.message.trim();

    if (code !== "") {
        const safe = escapeRegExp(code);
        message = message.replace(new RegExp(`^(?:\\[${safe}\\]|${safe}:)\\s*`), "");
        message = message.replace(new RegExp(`\\s*\\(${safe}\\)\\s*$`), "");
    }
    message = message.trim();

    if (message !== "" && !/[.!?]$/.test(message)) message += ".";
    if (code === "") return message;
    return message === "" ? `(${code})` : `${message} (${code})`;
}
