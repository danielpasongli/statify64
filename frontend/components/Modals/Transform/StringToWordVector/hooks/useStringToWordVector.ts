import { useState, useEffect, useRef, useCallback } from "react";
import { useVariableStore, processVariableName } from "@/stores/useVariableStore";
import { useDataStore } from "@/stores/useDataStore";
import { toast } from "sonner";
import type { Variable } from "@/types/Variable";
import { STWV_DEFAULT_CONFIG, getVectorDecimals, toRustConfig, validateStwvConfig, type StwvConfig } from "../config";
import type { AppError, VectorizerOutput } from "../types";
import { buildDocuments, areAllDocumentsEmpty, EMPTY_DATA_ERROR } from "../utils/buildDocuments";
import { buildColumnData } from "../utils/buildColumnData";
import { normalizeWorkerError } from "../utils/normalizeWorkerError";
import { resolveVariable } from "../utils/resolveVariable";
import { DEFAULT_COLUMN_PREFIX, validateColumnPrefix } from "../utils/columnPrefix";
import { buildStwvOutput } from "../utils/buildStwvOutput";
import { writeStwvOutput } from "../utils/writeStwvOutput";

// Tipe dipusatkan di ../types; di-re-export agar impor lama tetap valid.
export type { AppError, VectorizerOutput } from "../types";

const isAppError = (v: unknown): v is AppError =>
    typeof v === "object" && v !== null && typeof (v as AppError).code === "string" && typeof (v as AppError).message === "string" && !(v instanceof Error);

// ──────────────────────────────────────────────────────────────────────────────
// Hook
// ──────────────────────────────────────────────────────────────────────────────

export const useStringToWordVector = () => {
    const variablesStore = useVariableStore(state => state.variables);
    const getVariableData = useDataStore(state => state.getVariableData);

    // ── Variable selection state ──────────────────────────────────────────────
    const [availableVariables, setAvailableVariables] = useState<Variable[]>([]);
    const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null);
    const [highlightedVariable, setHighlightedVariable] = useState<Variable | null>(null);

    // ── Options state ─────────────────────────────────────────────────────────
    const [config, setConfig] = useState<StwvConfig>(STWV_DEFAULT_CONFIG);

    // ── Execution state ───────────────────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(false);
    const [columnPrefix, setColumnPrefix] = useState<string>(DEFAULT_COLUMN_PREFIX);
    const [error, setError] = useState<AppError | null>(null);

    // Worker ref — akan diinisialisasi lazy saat pertama kali dibutuhkan
    const workerRef = useRef<Worker | null>(null);

    // ── Initial load: filter variabel tipe STRING / nominal ───────────────────
    useEffect(() => {
        const stringVars = variablesStore.filter(
            (v) => v.type === "STRING" || v.measure === "nominal"
        );
        if (selectedVariable) {
            setAvailableVariables(stringVars.filter(v => v.id !== selectedVariable.id));
        } else {
            setAvailableVariables(stringVars);
        }
    }, [variablesStore, selectedVariable]);

    // ── Cleanup Worker saat komponen unmount ──────────────────────────────────
    useEffect(() => {
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    // ── Variable move handlers ────────────────────────────────────────────────
    const moveToTarget = () => {
        if (highlightedVariable) {
            setSelectedVariable(highlightedVariable);
            setHighlightedVariable(null);
        }
    };

    const removeTarget = () => {
        setSelectedVariable(null);
        setError(null);
    };

    // ── Worker helper: kirim pesan lalu tunggu hasil sebagai Promise ───────────
    const runWorker = (documents: string[], rustConfig: ReturnType<typeof toRustConfig>) =>
        new Promise<VectorizerOutput>((resolve, reject) => {
            if (!workerRef.current) {
                workerRef.current = new Worker(
                    new URL("../stringToWord.processor.ts", import.meta.url),
                    { type: "module" }
                );
            }
            const worker = workerRef.current;

            worker.onmessage = (event: MessageEvent) => {
                const { status, payload } = event.data;
                if (status === "success") {
                    resolve(payload as VectorizerOutput);
                } else {
                    // F04: payload bisa string JSON / objek / Error — selalu dinormalkan
                    reject(normalizeWorkerError(payload));
                }
            };
            worker.onerror = (event: ErrorEvent) => {
                reject(normalizeWorkerError(event.error ?? event.message, "WORKER_ERROR"));
            };

            worker.postMessage({ data: documents, config: rustConfig });
        });

    // ── Tambahkan kolom vektor ke dataset; mengembalikan nama final tiap kolom ──
    const addVectorColumns = async (output: VectorizerOutput, prefix: string): Promise<string[]> => {
        const dataStore = useDataStore.getState();
        const varStore = useVariableStore.getState();
        const tempVariables = [...varStore.variables];

        // 1. Nama variabel aman (unik, valid SPSS) dan ColumnData.
        //    Baris dataset sejajar dengan dokumen asli (F01): values[i] = matrix[i][kolom].
        const columnDataList = buildColumnData(output, (baseName, claimedNames) => {
            // Nama yang sudah dipakai kolom vektor sebelumnya dianggap terpakai (cek keunikan)
            const stubs = claimedNames.map(
                (name) => ({ name, columnIndex: 999 }) as unknown as Variable
            );
            return processVariableName(baseName, [...tempVariables, ...stubs]).processedName;
        }, prefix);

        // 2. Tambahkan data ke DataStore.
        //    Kosongkan dulu pendingUpdates: bila masih ada, saveData() di addVariableColumns hanya
        //    menulis edit sel dan melewatkan kolom baru (kolom hilang setelah reload/export).
        await dataStore.checkAndSave();
        const { startColumnIndex } = await dataStore.addVariableColumns(columnDataList);

        // 3. Daftarkan metadata variabel ke VariableStore
        const decimals = getVectorDecimals(config);
        const newVarsMetadata = output.vocabulary.map((term, index) => ({
            columnIndex: startColumnIndex + index,
            name: columnDataList[index].variable_name,
            type: "NUMERIC" as const,
            width: 8,
            // Desimal memperhitungkan IDF dan normalisasi (nilai pecahan bila salah satunya aktif)
            decimals,
            label: `Vector of "${term}"`,
            values: [],
            missing: null,
            columns: 64,
            align: "right" as const,
            measure: "scale" as const,
            role: "input" as const,
        }));
        await varStore.registerVariableMetadata(newVarsMetadata);

        // 4. Sinkronkan ulang UI
        await varStore.loadVariables();

        return columnDataList.map((c) => c.variable_name);
    };

    // ── Aksi tombol OK: jalankan STWV → tambah kolom ke dataset → tulis Output Viewer ──
    // Mengembalikan true bila kolom berhasil ditambahkan (modal boleh ditutup).
    const runAndAddToDataset = useCallback(async (): Promise<boolean> => {
        if (!selectedVariable) return false;

        const configErrors = validateStwvConfig(config);
        if (configErrors.length > 0) {
            setError({ code: "INVALID_CONFIG", message: configErrors[0] });
            return false;
        }
        const prefixError = validateColumnPrefix(columnPrefix);
        if (prefixError) {
            setError({ code: "INVALID_COLUMN_NAME", message: prefixError });
            return false;
        }

        setIsLoading(true);
        setError(null);

        let output: VectorizerOutput;
        let variableName = selectedVariable.name;
        let durationMs = 0;
        try {
            // 0. F20: re-resolve variabel dari store (snapshot bisa basi bila kolom berubah)
            const currentVariables = useVariableStore.getState().variables;
            const variable = resolveVariable(selectedVariable, currentVariables);
            if (!variable) {
                setError({
                    code: "VARIABLE_NOT_FOUND",
                    message: "The selected variable no longer exists in the dataset. Select the text variable again.",
                });
                setIsLoading(false);
                return false;
            }
            variableName = variable.name;

            // 1a. Simpan dulu edit sel yang tertunda (pendingUpdates). getVariableData membaca dari
            //     database, bukan dari memori, sehingga tanpa ini proses memakai teks lama.
            await useDataStore.getState().checkAndSave();

            // 1b. Ambil data kolom
            const { data: columnData } = await getVariableData(variable);

            // F01: jangan buang baris. null/undefined → "" agar indeks tetap sejajar dengan dataset.
            const rawDocuments = buildDocuments(columnData);
            if (areAllDocumentsEmpty(rawDocuments)) {
                setError(EMPTY_DATA_ERROR);
                setIsLoading(false);
                return false;
            }

            // 2. Vektorisasi di worker
            const startedAt = performance.now();
            output = await runWorker(rawDocuments, toRustConfig(config));
            durationMs = performance.now() - startedAt;
        } catch (err: unknown) {
            if (isAppError(err)) {
                setError(err);
            } else {
                const message = err instanceof Error ? err.message : "An unknown error occurred.";
                setError({ code: "INTERNAL_ERROR", message });
            }
            setIsLoading(false);
            return false;
        }

        // 3. Tambahkan kolom ke dataset
        let columnNames: string[];
        try {
            columnNames = await addVectorColumns(output, columnPrefix);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setError({ code: "SAVE_FAILED", message: "Could not add the vector columns to the dataset: " + message });
            setIsLoading(false);
            return false;
        }

        // 4. Catat proses di Output Viewer (kegagalan di sini tidak membatalkan kolom yang sudah ditambahkan)
        try {
            await writeStwvOutput(
                buildStwvOutput({
                    variableName,
                    config,
                    result: output,
                    columnPrefix,
                    columnNames,
                    durationMs,
                })
            );
            toast.success(
                columnNames.length === 1
                    ? "1 vector column was added to the dataset."
                    : `${columnNames.length} vector columns were added to the dataset.`
            );
        } catch (err: unknown) {
            console.error("Failed to write the String to Word Vector output:", err);
            toast.warning(
                `${columnNames.length} vector ${columnNames.length === 1 ? "column was" : "columns were"} added, but the processing summary could not be written to the Output Viewer.`
            );
        }

        setIsLoading(false);
        return true;
    }, [selectedVariable, config, columnPrefix, getVariableData]);

    // ── Reset: kembalikan semua pilihan ke kondisi awal ───────────────────────
    const reset = () => {
        setSelectedVariable(null);
        setHighlightedVariable(null);
        setConfig(STWV_DEFAULT_CONFIG);
        setColumnPrefix(DEFAULT_COLUMN_PREFIX);
        setError(null);
    };

    // ──────────────────────────────────────────────────────────────────────────
    return {
        // Variable Context
        availableVariables,
        selectedVariable,
        highlightedVariable,
        setHighlightedVariable,
        moveToTarget,
        removeTarget,

        // Options Context
        config,
        setConfig,

        // Output column name
        columnPrefix,
        setColumnPrefix,

        // Execution Context
        isLoading,
        error,
        runAndAddToDataset,
        reset,
    };
};