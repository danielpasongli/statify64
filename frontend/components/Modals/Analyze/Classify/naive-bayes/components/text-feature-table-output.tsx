"use client";

import React, { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type {
    NaiveBayesTextFeatureFullEntry,
    NaiveBayesTextFeatureTableRaw,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";

/**
 * Komponen output "Text Feature Table" (AGENTS_V2 §9 / V9): tabel Top-k kata
 * paling berpengaruh per kelas + aksi Download CSV (tabel lengkap, UTF-8 dengan
 * BOM) dan Copy (TSV, batas 5 MB).
 *
 * `data` adalah `output_data` statistic ini, berbentuk
 * `{ tables: [Table], textFeatureTable: NaiveBayesTextFeatureTableRaw }`
 * (lihat `services/naive-bayes-analysis-output.ts`).
 *
 * CATATAN INTEGRASI: komponen ini baru tampil sebagai komponen khusus setelah
 * didaftarkan di registry `components/Output/Statistics/index.tsx` dengan key
 * "Text Feature Table" (file itu milik Fase I1). Sebelum itu, output viewer
 * jatuh ke renderer tabel generik memakai `tables[0]` (Top-k saja, tanpa tombol).
 */

/** Nama file default unduhan (AGENTS_V2 §9). */
export const DEFAULT_TEXT_FEATURE_CSV_FILE_NAME = "Naive_Bayes_Text_Features.csv";

/** Batas ukuran TSV yang boleh disalin ke clipboard: 5 MB (V9). */
export const TEXT_FEATURE_COPY_LIMIT_BYTES = 5 * 1024 * 1024;

/** Pesan toast bila TSV melebihi batas (AGENTS_V2 §9). */
export const TEXT_FEATURE_COPY_TOO_LARGE_MESSAGE =
    "The table is too large to copy. Use Download CSV instead.";

/** Nama likelihood untuk keterangan di atas tabel. */
const TEXT_LIKELIHOOD_NAME: Record<string, string> = {
    multinomial: "Multinomial",
    bernoulli: "Bernoulli",
    complement: "Complement",
};

/** Penanda urutan byte UTF-8 agar Excel membaca karakter Indonesia dengan benar. */
export const UTF8_BOM = "﻿";

/** Kolom tabel lengkap, urutan DIKUNCI (AGENTS_V2 §9). */
export const TEXT_FEATURE_FULL_COLUMNS = [
    "term",
    "class",
    "count",
    "log_weight",
    "probability",
    "score",
] as const;

/** Angka -> teks tanpa pembulatan; nilai tak hingga/NaN menjadi kosong. */
const formatRawNumber = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";

/** Escape satu sel CSV (RFC 4180): kutip bila memuat koma, kutip, atau baris baru. */
export function escapeCsvField(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * CSV format panjang `term,class,count,log_weight,probability,score`.
 * Baris dipisah CRLF (RFC 4180). BOM TIDAK ditambahkan di sini; lihat
 * `buildTextFeatureCsvFile`.
 */
export function buildTextFeatureCsv(
    full: ReadonlyArray<NaiveBayesTextFeatureFullEntry>
): string {
    const lines: string[] = [TEXT_FEATURE_FULL_COLUMNS.join(",")];
    for (const entry of full) {
        lines.push(
            [
                escapeCsvField(entry.term),
                escapeCsvField(entry.class),
                formatRawNumber(entry.count),
                formatRawNumber(entry.log_weight),
                formatRawNumber(entry.probability),
                formatRawNumber(entry.score),
            ].join(",")
        );
    }
    return lines.join("\r\n");
}

/** Isi berkas CSV siap unduh: BOM UTF-8 + CSV. */
export function buildTextFeatureCsvFile(
    full: ReadonlyArray<NaiveBayesTextFeatureFullEntry>
): string {
    return UTF8_BOM + buildTextFeatureCsv(full);
}

/** Sel TSV: tab/baris baru di dalam teks diganti spasi agar kolom tidak bergeser. */
const sanitizeTsvField = (value: string): string => value.replace(/[\t\r\n]+/g, " ");

/** TSV (pemisah tab, baris `\n`) dengan kolom yang sama seperti CSV; untuk Copy. */
export function buildTextFeatureTsv(
    full: ReadonlyArray<NaiveBayesTextFeatureFullEntry>
): string {
    const lines: string[] = [TEXT_FEATURE_FULL_COLUMNS.join("\t")];
    for (const entry of full) {
        lines.push(
            [
                sanitizeTsvField(entry.term),
                sanitizeTsvField(entry.class),
                formatRawNumber(entry.count),
                formatRawNumber(entry.log_weight),
                formatRawNumber(entry.probability),
                formatRawNumber(entry.score),
            ].join("\t")
        );
    }
    return lines.join("\n");
}

/** Panjang string dalam byte UTF-8 (tanpa bergantung pada TextEncoder/Blob). */
export function utf8ByteLength(text: string): number {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
            // pasangan surrogate = satu titik kode 4 byte
            bytes += 4;
            i++;
        } else bytes += 3;
    }
    return bytes;
}

type TextFeatureTableOutputData = {
    textFeatureTable?: NaiveBayesTextFeatureTableRaw;
};

export type TextFeatureTableOutputProps = {
    data: string | TextFeatureTableOutputData;
    /** Menimpa unduhan bawaan (untuk test); menerima nama file & isi (sudah ber-BOM). */
    onDownload?: (fileName: string, content: string) => void;
    /** Menimpa penyalinan bawaan (untuk test). */
    onCopy?: (text: string) => Promise<void> | void;
};

const downloadTextFile = (fileName: string, content: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
};

const formatCell = (value: number, decimals: number): string =>
    Number.isFinite(value) ? String(Number(value.toFixed(decimals))) : "";

export const TextFeatureTableOutput = ({
    data,
    onDownload = downloadTextFile,
    onCopy = copyToClipboard,
}: TextFeatureTableOutputProps) => {
    const table = useMemo<NaiveBayesTextFeatureTableRaw | null>(() => {
        try {
            const parsed: TextFeatureTableOutputData | null =
                typeof data === "string" ? JSON.parse(data) : data;
            return parsed?.textFeatureTable ?? null;
        } catch {
            return null;
        }
    }, [data]);

    const handleDownload = useCallback(() => {
        if (!table) return;
        onDownload(
            DEFAULT_TEXT_FEATURE_CSV_FILE_NAME,
            buildTextFeatureCsvFile(table.full)
        );
    }, [table, onDownload]);

    const handleCopy = useCallback(async () => {
        if (!table) return;
        const tsv = buildTextFeatureTsv(table.full);
        if (utf8ByteLength(tsv) > TEXT_FEATURE_COPY_LIMIT_BYTES) {
            toast.warning(TEXT_FEATURE_COPY_TOO_LARGE_MESSAGE);
            return;
        }
        try {
            await onCopy(tsv);
            toast.success("Table copied as tab-separated text.");
        } catch {
            toast.error("The table could not be copied. Use Download CSV instead.");
        }
    }, [table, onCopy]);

    if (!table) {
        return (
            <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                The Text Feature Table cannot be displayed because its data is missing or not valid.
            </div>
        );
    }

    const classes = table.classes.length > 0 ? table.classes : Object.keys(table.top);

    return (
        <div className="space-y-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                    Top {table.k} terms per class ({TEXT_LIKELIHOOD_NAME[table.likelihood] ?? table.likelihood}). Score = log weight of the
                    class minus the mean log weight of the other classes.
                </p>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={table.full.length === 0}
                        onClick={handleDownload}
                    >
                        Download CSV
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={table.full.length === 0}
                        onClick={handleCopy}
                    >
                        Copy (TSV)
                    </Button>
                </div>
            </div>

            {classes.map((className) => {
                const entries = table.top[className] ?? [];
                return (
                    <div key={className} data-testid={`text-feature-class-${className}`}>
                        <h4 className="mb-1 text-sm font-medium">Class: {className}</h4>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Rank</TableHead>
                                    <TableHead>Term</TableHead>
                                    <TableHead>Score</TableHead>
                                    <TableHead>Log weight</TableHead>
                                    <TableHead>Count</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {entries.map((entry, index) => (
                                    <TableRow key={`${entry.term}-${index}`}>
                                        <TableCell>{index + 1}</TableCell>
                                        <TableCell>{entry.term}</TableCell>
                                        <TableCell>{formatCell(entry.score, 4)}</TableCell>
                                        <TableCell>{formatCell(entry.log_weight, 4)}</TableCell>
                                        <TableCell>{formatCell(entry.count, 3)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                );
            })}
        </div>
    );
};

export default TextFeatureTableOutput;
