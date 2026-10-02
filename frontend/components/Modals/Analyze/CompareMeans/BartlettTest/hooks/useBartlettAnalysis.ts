import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { Variable } from '@/types/Variable';
import type { BartlettTestOptions, BartlettTestResult } from '../types';
import { useDataStore } from '@/stores/useDataStore';
import { useResultStore } from '@/stores/useResultStore';
import { useAnalysisData } from '@/hooks/useAnalysisData';
import { formatBartlettTestTable, formatDescriptiveStatisticsTable } from '../utils/formatters';

interface UseBartlettAnalysisProps {
    testVariables: Variable[];
    factorVariable: Variable | null;
    options: BartlettTestOptions;
    onClose: () => void;
}

/**
 * Hook untuk menjalankan analisis Bartlett Test menggunakan Web Worker
 *
 * Hook ini mengelola seluruh proses analisis Bartlett Test:
 * 1. Inisialisasi Web Worker
 * 2. Persiapan data dari penyimpanan state
 * 3. Pengiriman data ke worker untuk perhitungan
 * 4. Menerima hasil dan menyimpan ke result store
 */
export function useBartlettAnalysis({
    testVariables,
    factorVariable,
    options,
    onClose,
}: UseBartlettAnalysisProps) {
    const [isCalculating, setIsCalculating] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const resultsRef = useRef<BartlettTestResult[]>([]);
    const requestIdRef = useRef(0);

    // Gunakan useAnalysisData untuk mendapatkan data dari penyimpanan state
    const { data: analysisData, weightVariable } = useAnalysisData();
    const { addLog, addAnalytic, addStatistic } = useResultStore();

    /**
     * Tangani error kalkulasi
     *
     * Menangani error yang terjadi selama kalkulasi
     */
    const handleCalculationError = useCallback((error: string) => {
        console.error('Calculation error:', error);
        setErrorMsg(error);
        setIsCalculating(false);
        toast.error(`Analysis failed: ${error}`);
    }, []);

    /**
     * Tangani penyelesaian kalkulasi
     *
     * Menangani hasil kalkulasi dari worker:
     * 1. Simpan hasil ke resultsRef
     * 2. Buat log entry
     * 3. Buat analytic entry
     * 4. Formatkan dan simpan tabel hasil
     * 5. Tambahkan descriptive statistics jika diminta
     */
    const handleCalculationComplete = useCallback(async (results: BartlettTestResult[]) => {
        try {
            resultsRef.current = results;

            // Add log entry first
            // Bentuk sintaks: BARTLETT testVars BY groupVar /STATISTICS DESCRIPTIVES
            const variableNames = testVariables.map(v => v.name).join(' ');
            let logMsg = `BARTLETT ${variableNames} BY ${factorVariable?.name}`;
            if (options.includeDescriptives) {
                logMsg += ` /STATISTICS DESCRIPTIVES`;
            }
            const logId = await addLog({ log: logMsg });

            // Buat entri analytic
            const analyticTitle = `Bartlett's Test of Homogeneity - ${factorVariable?.label || factorVariable?.name}`;
            const analyticId = await addAnalytic(logId, {
                title: analyticTitle,
                note: 'Tests equality of variances across groups'
            });

            // Formatkan dan simpan tabel Uji Bartlett
            const bartlettTable = formatBartlettTestTable(results);
            // Validasi struktur tabel sebelum menyimpan
            if (bartlettTable.rows && bartlettTable.rows.length > 0) {
                const invalidRows = bartlettTable.rows.filter((row: any) =>
                    !row.rowHeader || !Array.isArray(row.rowHeader) || row.rowHeader.length === 0
                );
                if (invalidRows.length > 0) {
                    console.error('[ERROR] Invalid rows detected before save:', invalidRows);
                    throw new Error('Table contains invalid rows without proper rowHeader');
                }
            }

            // Deep clone untuk memastikan tidak ada masalah referensi
            const tableToSave = JSON.parse(JSON.stringify({ tables: [bartlettTable] }));
            await addStatistic(analyticId, {
                title: "Bartlett's Test of Homogeneity of Variances",
                output_data: JSON.stringify(tableToSave),
                components: "Bartlett Test",
                description: bartlettTable.description?.join('\n') || ''
            });

            // Tambahkan statistik deskriptif jika diminta
            if (options.includeDescriptives) {
                const descriptivesTable = formatDescriptiveStatisticsTable(results);
                // Validasi struktur tabel
                if (descriptivesTable.rows && descriptivesTable.rows.length > 0) {
                    const invalidRows = descriptivesTable.rows.filter((row: any) =>
                        !row.rowHeader || !Array.isArray(row.rowHeader) || row.rowHeader.length === 0
                    );
                    if (invalidRows.length > 0) {
                        console.error('[ERROR] Invalid descriptive rows detected:', invalidRows);
                        throw new Error('Descriptive table contains invalid rows');
                    }
                }

                // Deep clone
                const descriptivesToSave = JSON.parse(JSON.stringify({ tables: [descriptivesTable] }));
                await addStatistic(analyticId, {
                    title: "Descriptive Statistics",
                    output_data: JSON.stringify(descriptivesToSave),
                    components: "Descriptives",
                    description: "Summary statistics for each group"
                });
            }

            toast.success("Bartlett's Test of Homogeneity completed successfully");
            setIsCalculating(false);
            onClose();

        } catch (error) {
            console.error('Error saving results:', error);
            handleCalculationError('Failed to save results');
        }
    }, [factorVariable, testVariables, options, addAnalytic, addStatistic, addLog, onClose, handleCalculationError]);

    const createWorker = useCallback(() => {
        const worker = new Worker('/workers/CompareMeans/bartlettTestWorker.js', { type: 'module' });

        worker.onmessage = (e) => {
            const { type, data, error } = e.data;

            if (type === 'BARTLETT_RESULT') {
                handleCalculationComplete(data);
            } else if (type === 'ERROR') {
                handleCalculationError(error);
            }
        };

        worker.onerror = (error) => {
            console.error('Worker error:', error);
            handleCalculationError('Worker error occurred');
        };

        workerRef.current = worker;
        return worker;
    }, [handleCalculationComplete, handleCalculationError]);

    useEffect(() => () => {
        requestIdRef.current++;
        workerRef.current?.terminate();
        workerRef.current = null;
    }, []);

    /**
     * Jalankan analisis Bartlett Test
     *
     * Menjalankan analisis Bartlett Test:
     * 1. Validasi masukan (variabel uji dan variabel pengelompokan)
     * 2. Simpan perubahan pending ke store
     * 3. Persiapkan data untuk setiap variabel uji
     * 4. Kirim data ke worker untuk kalkulasi
     */
    const runAnalysis = useCallback(async () => {
        // Validasi
        if (testVariables.length === 0) {
            toast.error('Please select at least one test variable');
            return;
        }

        if (!factorVariable) {
            toast.error('Please select a grouping variable');
            return;
        }

        if (weightVariable) {
            handleCalculationError('Bartlett does not support case weights yet. Turn off Weight Cases before running this test.');
            return;
        }

        const requestId = ++requestIdRef.current;
        setIsCalculating(true);
        setErrorMsg(null);

        try {
            // Simpan perubahan pending sebelum analisis
            await useDataStore.getState().checkAndSave();
            if (requestId !== requestIdRef.current) return;

            // Persiapkan data untuk setiap variabel uji
            // analysisData adalah array of rows, setiap row adalah object dengan key=columnIndex
            const variablesData = testVariables.map(variable => {
                return analysisData.map((row: any) => row[variable.columnIndex]);
            });

            const factorData = analysisData.map((row: any) => row[factorVariable.columnIndex]);

            // Kirim data ke worker untuk kalkulasi
            workerRef.current?.terminate();
            const worker = createWorker();
            worker.postMessage({
                    type: 'CALCULATE',  // Worker mengharapkan type 'CALCULATE'
                    data: {
                        testVariables,
                        factorVariable,
                        variablesData,
                        factorData,
                    }
                });

        } catch (error) {
            console.error('Error preparing data:', error);
            handleCalculationError('Failed to prepare data for analysis');
        }
    }, [testVariables, factorVariable, analysisData, weightVariable, createWorker, handleCalculationError]);

    /**
     * Batalkan kalkulasi
     */
    const cancelCalculation = useCallback(() => {
        requestIdRef.current++;
        if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
        }
        setIsCalculating(false);
        setErrorMsg(null);
    }, []);

    return {
        isCalculating,
        errorMsg,
        runAnalysis,
        cancelCalculation,
    };
}
