/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import { useAnalyzeHook } from '@/components/Modals/Analyze/TimeSeries/ECM/hooks/analyzeHook';
import { ChartService } from '@/services/chart/ChartService';
import type { Variable } from '@/types/Variable';
import type { DataRow } from '@/types/Data';

// ─── Unit: ECM Stale Variable Validation Logic ────────────────────────────────
//
// The isVariableValid helper in ECM/index.tsx loadSavedState ensures that:
//   - A saved variable is valid only if its columnIndex + name both match a
//     variable in the current filteredVariables list.
//   - Stale variables (different name or non-existent index) are discarded.
//
// This describe block tests the pure logic directly as a unit test.
// ─────────────────────────────────────────────────────────────────────────────
describe('ECM loadSavedState – isVariableValid logic (unit)', () => {
    /** Reproduce the exact function from ECM/index.tsx */
    const makeIsVariableValid = (filteredVariables: Variable[]) =>
        (v: Variable) =>
            filteredVariables.some(
                (fv) => fv.columnIndex === v.columnIndex && fv.name === v.name
            );

    const currentVars: Variable[] = [
        { columnIndex: 0, name: 'penumpang', type: 'NUMERIC', width: 8, decimals: 2, label: '', values: [], missing: null, columns: 10, align: 'right', measure: 'scale', role: 'input' },
        { columnIndex: 1, name: 'rjp',       type: 'NUMERIC', width: 8, decimals: 2, label: '', values: [], missing: null, columns: 10, align: 'right', measure: 'scale', role: 'input' },
        { columnIndex: 2, name: 'harga',     type: 'NUMERIC', width: 8, decimals: 2, label: '', values: [], missing: null, columns: 10, align: 'right', measure: 'scale', role: 'input' },
    ];

    it('TC-ECM-VAL-01: valid variable (same columnIndex + name) → passes filter', () => {
        const isValid = makeIsVariableValid(currentVars);
        expect(isValid({ ...currentVars[1] })).toBe(true);
    });

    it('TC-ECM-VAL-02: stale variable with different name at same index → rejected', () => {
        const isValid = makeIsVariableValid(currentVars);
        // columnIndex=1 exists but name was "rjp", now saved as "x" (from another dataset)
        const staleVar = { ...currentVars[1], name: 'x' };
        expect(isValid(staleVar)).toBe(false);
    });

    it('TC-ECM-VAL-03: variable with non-existent columnIndex → rejected', () => {
        const isValid = makeIsVariableValid(currentVars);
        const ghostVar = { ...currentVars[0], columnIndex: 99, name: 'ghost' };
        expect(isValid(ghostVar)).toBe(false);
    });

    it('TC-ECM-VAL-04: first variable (columnIndex=0) is valid → passes filter', () => {
        const isValid = makeIsVariableValid(currentVars);
        // Ensures columnIndex=0 (falsy) is not accidentally rejected
        expect(isValid({ ...currentVars[0] })).toBe(true);
    });

    it('TC-ECM-VAL-05: saved array with mix of valid + stale → only valid ones survive', () => {
        const isValid = makeIsVariableValid(currentVars);
        const savedVars: Variable[] = [
            { ...currentVars[0] },                    // valid: penumpang@0
            { ...currentVars[1], name: 'x' },         // stale: name mismatch
            { ...currentVars[0], columnIndex: 99 },   // stale: index does not exist
            { ...currentVars[2] },                    // valid: harga@2
        ];
        const valid = savedVars.filter(isValid);
        expect(valid).toHaveLength(2);
        expect(valid[0].name).toBe('penumpang');
        expect(valid[1].name).toBe('harga');
    });
});

// ─── Worker Mock ───────────────────────────────────────────────────────────────
let capturedMessageHandler: ((e: any) => void) | null = null;
let capturedErrorHandler: ((e: any) => void) | null = null;

const mockClient = {
    post: jest.fn(),
    onMessage: jest.fn((h: any) => { capturedMessageHandler = h; }),
    onError: jest.fn((h: any) => { capturedErrorHandler = h; }),
    release: jest.fn(),
};

jest.mock('@/utils/timeseriesWorkerPool', () => ({
    getTimeSeriesWorker: () => mockClient,
}));

// ─── Store Mock ────────────────────────────────────────────────────────────────
const mockAddStatistic = jest.fn();

jest.mock('@/stores/useResultStore', () => ({
    useResultStore: () => ({
        addLog: jest.fn(() => Promise.resolve(1)),
        addAnalytic: jest.fn(() => Promise.resolve(1)),
        addStatistic: mockAddStatistic,
    }),
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/services/chart/ChartService', () => ({
    ChartService: { createChartJSON: jest.fn(() => ({ type: 'line', data: [] })) },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────
const createVar = (name: string, columnIndex: number): Variable => ({
    columnIndex,
    name,
    type: 'NUMERIC',
    width: 8,
    decimals: 2,
    label: '',
    values: [],
    missing: null,
    columns: 10,
    align: 'right',
    measure: 'scale',
    role: 'input',
});

/** n rows, setiap baris: [Y, X1] */
const makeData = (n: number): DataRow[] =>
    Array.from({ length: n }, (): DataRow => [1.5, 2.0]);

const yVar = createVar('Y', 0);
const xVar = createVar('X1', 1);

const runHook = (
    dep: Variable[],
    indep: Variable[],
    data: DataRow[],
    maxLagADF = 1,
) =>
    renderHook(() =>
        useAnalyzeHook(dep, indep, data, null, maxLagADF, false, false, jest.fn()),
    );

const runAndAnalyze = async (
    dep: Variable[],
    indep: Variable[],
    data: DataRow[],
    maxLagADF = 1,
) => {
    const { result } = runHook(dep, indep, data, maxLagADF);
    await act(async () => { await result.current.handleAnalyzes(); });
    return result;
};

const triggerSuccess = async (mockResult: any) => {
    await act(async () => {
        if (capturedMessageHandler)
            await (capturedMessageHandler as any)({ data: { status: 'success', result: mockResult } });
    });
};

const triggerWorkerError = async (msg = 'Cointegration failed') => {
    await act(async () => {
        if (capturedMessageHandler)
            await (capturedMessageHandler as any)({ data: { status: 'error', error: msg } });
    });
};

const triggerConnectionError = async () => {
    await act(async () => {
        if (capturedErrorHandler)
            (capturedErrorHandler as any)(new ErrorEvent('error'));
    });
};

// ─── Mock ECM results (tiga varian interpretasi ECT) ──────────────────────────
const baseLongRun = {
    coefficients: ['1.5', '0.8'],
    stdErrors:    ['0.2', '0.1'],
    tStats:       ['7.5', '8.0'],
    pValues:      ['0.000', '0.000'],
    rSquared: '0.85', adjRSquared: '0.84', fStat: '45.2',
    residuals: [0.1, -0.2, 0.3],
};

const baseDiag = {
    jarqueBera:     { stat: '2.1', prob: '0.35' },
    breuschGodfrey: { stat: '1.8', prob: '0.40' },
    breuschPagan:   { stat: '2.5', prob: '0.29' },
};

/** ECT negatif + signifikan (p < 0.05) → ECM valid */
const mockECMValid = {
    longRun: baseLongRun,
    cointegration: { isCointegrated: true, adfStat: '-3.5', pValue: '0.01' },
    ecm: {
        coefficients: ['0.5', '-0.3', '0.2'],
        stdErrors:    ['0.1', '0.05', '0.08'],
        tStats:       ['5.0', '-6.0', '2.5'],
        pValues:      ['0.000', '0.010', '0.015'],
        rSquared: '0.75', adjRSquared: '0.73', fStat: '30.1',
        residuals: [0.05, -0.1, 0.08],
    },
    diagnostics: baseDiag,
};

/** ECT positif → ECM tidak valid */
const mockECMPositiveECT = {
    ...mockECMValid,
    ecm: {
        ...mockECMValid.ecm,
        coefficients: ['0.5', '0.4', '0.2'],   // ECT = +0.4
        pValues:      ['0.000', '0.010', '0.015'],
    },
};

/** ECT negatif tetapi p > 0.05 → tidak signifikan */
const mockECMNotSignificant = {
    ...mockECMValid,
    ecm: {
        ...mockECMValid.ecm,
        coefficients: ['0.5', '-0.3', '0.2'],
        pValues:      ['0.000', '0.200', '0.015'],  // p = 0.20 > 0.05
    },
};

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Node / Keputusan di handleAnalyzes:
//   D1: dependentVariable.length === 0 || independentVariable.length === 0
//   D2: filter baris valid Y & X (loop + if bersarang)
//   D3: yData.length < 10
//   D4: status === "success"  (worker response)
//   D5: ectCoef < 0 && ectProb < 0.05  (interpretasi ECT)
//   D6: ectCoef >= 0                   (cabang else if)
//   D7: client.onError dipanggil
//
//  Jalur Independen:
//   P1 (TC-ECM-01): D1=true (dep kosong)     → return early, errorMsg diset
//   P2 (TC-ECM-02): D1=true (indep kosong)   → return early, errorMsg diset
//   P3 (TC-ECM-03): D1=false, D3=true        → throw "Insufficient data"
//   P4 (TC-ECM-04): D4=true, D5=true         → ECM valid, addStatistic dipanggil
//   P5 (TC-ECM-05): D4=true, D6=true         → ECT positif, tidak valid
//   P6 (TC-ECM-06): D4=true, D5=false, D6=false → ECT negatif tapi tidak signifikan
//   P7 (TC-ECM-07): D4=false                 → errorMsg dari worker
//   P8 (TC-ECM-08): D7=true                  → errorMsg "Failed to connect"
//
//  Cyclomatic Complexity V(G) = 8

beforeEach(() => {
    capturedMessageHandler = null;
    capturedErrorHandler   = null;
    jest.clearAllMocks();
    mockClient.onMessage.mockImplementation((h: any) => { capturedMessageHandler = h; });
    mockClient.onError.mockImplementation((h: any)   => { capturedErrorHandler = h; });
});

// ─── Jalur Validasi ────────────────────────────────────────────────────────────
describe('useAnalyzeHook ECM – Validasi (P1–P3)', () => {
    it('TC-ECM-01 [P1]: Dependent variable kosong → setErrorMsg, tidak panggil worker', async () => {
        const result = await runAndAnalyze([], [xVar], makeData(15));

        expect(result.current.errorMsg).toBe('Please select both dependent and independent variables');
        expect(mockClient.post).not.toHaveBeenCalled();
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ECM-02 [P2]: Independent variable kosong → setErrorMsg, tidak panggil worker', async () => {
        const result = await runAndAnalyze([yVar], [], makeData(15));

        expect(result.current.errorMsg).toBe('Please select both dependent and independent variables');
        expect(mockClient.post).not.toHaveBeenCalled();
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ECM-03 [P3]: Kurang dari 10 observasi valid → errorMsg "Insufficient data points"', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(7));

        expect(result.current.errorMsg).toBe('Insufficient data points (minimum 10 required)');
        expect(mockClient.post).not.toHaveBeenCalled();
    });
});

// ─── Jalur Interpretasi ECT (worker success) ──────────────────────────────────
describe('useAnalyzeHook ECM – Interpretasi ECT (P4–P6)', () => {
    it('TC-ECM-04 [P4]: ECT negatif + signifikan → ECM valid, addStatistic dipanggil', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockECMValid);

        expect(result.current.errorMsg).toBeNull();
        expect(result.current.isCalculating).toBe(false);
        expect(mockAddStatistic).toHaveBeenCalled();

        // Verifikasi pesan interpretasi
        const call = mockAddStatistic.mock.calls[0];
        const parsed = JSON.parse(call[1].output_data);
        const interpTable = parsed.tables.find((t: any) => t.title === 'Model Interpretation');
        const ecmRow = interpTable?.rows?.find((r: any) => r.col === 'Short-Run ECM');
        expect(ecmRow?.val).toContain('valid');
    });

    it('TC-ECM-05 [P5]: ECT positif → interpretasi "not valid", addStatistic dipanggil', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockECMPositiveECT);

        expect(result.current.errorMsg).toBeNull();
        expect(mockAddStatistic).toHaveBeenCalled();

        const call = mockAddStatistic.mock.calls[0];
        const parsed = JSON.parse(call[1].output_data);
        const interpTable = parsed.tables.find((t: any) => t.title === 'Model Interpretation');
        const ecmRow = interpTable?.rows?.find((r: any) => r.col === 'Short-Run ECM');
        expect(ecmRow?.val).toContain('positive');
    });

    it('TC-ECM-06 [P6]: ECT negatif tapi p > 0.05 → interpretasi "not statistically significant"', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockECMNotSignificant);

        expect(result.current.errorMsg).toBeNull();
        expect(mockAddStatistic).toHaveBeenCalled();

        const call = mockAddStatistic.mock.calls[0];
        const parsed = JSON.parse(call[1].output_data);
        const interpTable = parsed.tables.find((t: any) => t.title === 'Model Interpretation');
        const ecmRow = interpTable?.rows?.find((r: any) => r.col === 'Short-Run ECM');
        expect(ecmRow?.val).toContain('not statistically significant');
    });
});

// ─── Jalur Worker Error ────────────────────────────────────────────────────────
describe('useAnalyzeHook ECM – Respons Worker Error (P7–P8)', () => {
    it('TC-ECM-07 [P7]: Worker kembalikan error → errorMsg dari worker diset', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerWorkerError('ECM computation failed');

        expect(result.current.errorMsg).toBe('ECM computation failed');
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ECM-08 [P8]: Koneksi worker error → errorMsg "Failed to connect to worker"', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerConnectionError();

        expect(result.current.errorMsg).toBe('Failed to connect to worker');
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ECM-09: Worker mengembalikan correlogram → Correlogram table & ACF/PACF chart dimasukkan ke output_data', async () => {
        const mockECMWithCorrelogram = {
            ...mockECMValid,
            correlogram: [
                { lag: 1, ac: '0.120', pac: '0.120', qStat: '0.15', prob: '0.69' },
                { lag: 2, ac: '-0.050', pac: '-0.065', qStat: '0.22', prob: '0.89' }
            ]
        };

        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockECMWithCorrelogram);

        expect(mockAddStatistic).toHaveBeenCalled();
        const call = mockAddStatistic.mock.calls[0];
        const parsed = JSON.parse(call[1].output_data);

        // Verifikasi Correlogram Table
        const correlogramTable = parsed.tables.find((t: any) => t.title.includes('Correlogram of ECM Residuals'));
        expect(correlogramTable).toBeDefined();
        expect(correlogramTable.rows.length).toBe(2);

        // Verifikasi Correlogram Chart Service Call
        expect(ChartService.createChartJSON).toHaveBeenCalledWith(
            expect.objectContaining({
                chartType: "Multiple Line Chart",
                chartMetadata: expect.objectContaining({
                    title: "ECM Residual Correlogram Plot (ACF & PACF)"
                })
            })
        );
    });
});
