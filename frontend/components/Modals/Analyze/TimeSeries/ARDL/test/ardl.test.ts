/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderHook, act } from '@testing-library/react';
import { useAnalyzeHook } from '@/components/Modals/Analyze/TimeSeries/ARDL/hooks/analyzeHook';
import type { Variable } from '@/types/Variable';
import type { DataRow } from '@/types/Data';

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
    ChartService: {
        createChartJSON: jest.fn((config) => ({
            chartType: config.chartType,
            chartData: config.chartData,
            chartVariables: config.chartVariables,
            chartMetadata: config.chartMetadata,
            chartConfig: config.chartConfig,
        })),
    },
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

/** n rows: col 0 = Y (1.5), col 1 = X (2.0) */
const makeData = (n: number): DataRow[] =>
    Array.from({ length: n }, (): DataRow => [1.5, 2.0]);

/** 15 rows: 10 valid rows for X, 5 rows with null X → triggers length mismatch */
const makeDataNullX = (): DataRow[] => [
    ...Array.from({ length: 10 }, (): DataRow => [1.5, 2.0]),
    ...Array.from({ length: 5 },  (): DataRow => [1.5, null]),
];

const yVar  = createVar('Y', 0);
const xVar  = createVar('X1', 1);

const runHook = (
    dep: Variable[],
    indep: Variable[],
    data: DataRow[],
    pOrder = 1,
    qOrders = [1],
) =>
    renderHook(() =>
        useAnalyzeHook(dep, indep, data, null, true, 4, 4, 'aic', pOrder, qOrders, false, false, jest.fn()),
    );

const runAndAnalyze = async (
    dep: Variable[],
    indep: Variable[],
    data: DataRow[],
    pOrder = 1,
    qOrders = [1],
) => {
    const { result } = runHook(dep, indep, data, pOrder, qOrders);
    await act(async () => { await result.current.handleAnalyzes(); });
    return result;
};

const triggerSuccess = async (mockResult: any) => {
    await act(async () => {
        if (capturedMessageHandler)
            await (capturedMessageHandler as any)({ data: { status: 'success', result: mockResult } });
    });
};

const triggerWorkerError = async (msg = 'Worker computation failed') => {
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

// ─── Mock ARDL result ──────────────────────────────────────────────────────────
const mockARDLResult = {
    longRun: {
        coefficients: ['1.5', '0.8'],
        stdErrors: ['0.2', '0.1'],
        tStats: ['7.5', '8.0'],
        pValues: ['0.000', '0.000'],
        rSquared: '0.85',
        adjRSquared: '0.84',
        fStat: '45.2',
    },
    cointegration: { isCointegrated: true, statistic: '-3.5', pValue: '0.01' },
    shortRun: {
        coefficients: ['0.5', '-0.3', '0.2', '0.15', '-0.05'],
        stdErrors: ['0.1', '0.05', '0.08', '0.04', '0.02'],
        tStats: ['5.0', '-6.0', '2.5', '3.75', '-2.5'],
        pValues: ['0.000', '0.01', '0.015', '0.001', '0.015'],
        rSquared: '0.75',
        adjRSquared: '0.73',
        fStat: '30.1',
    },
    diagnostics: {
        jarqueBera: { stat: '2.1', prob: '0.35' },
        breuschGodfrey: { stat: '1.8', prob: '0.40' },
        breuschPagan: { stat: '2.5', prob: '0.29' },
    },
    residuals: [0.1, -0.2, 0.3],
};

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Node / Keputusan di handleAnalyzes:
//   D1: dependentVariable.length === 0 || independentVariables.length === 0
//   D2: filter baris valid Y  (loop + if)
//   D3: filter baris valid X  (loop + if)
//   D4: nObs < 10
//   D5: xDataArrays[i].length !== nObs
//   D6: qOrders.length === independentVariables.length  (ternary)
//   D7: status === "success"  (worker response)
//   D8: client.onError dipanggil
//
//  Jalur Independen:
//   P1 (TC-ARDL-01): D1=true (dep kosong)    → return early, errorMsg diset
//   P2 (TC-ARDL-02): D1=true (indep kosong)  → return early, errorMsg diset
//   P3 (TC-ARDL-03): D1=false, D4=true       → throw "Insufficient data"
//   P4 (TC-ARDL-04): D1=false, D4=false, D5=true  → throw "different length"
//   P5 (TC-ARDL-05): D6=false                → fallback qOrders digunakan
//   P6 (TC-ARDL-06): D1=false, D7=true       → sukses, addStatistic dipanggil
//   P7 (TC-ARDL-07): D1=false, D7=false      → errorMsg dari worker
//   P8 (TC-ARDL-08): D8=true                 → errorMsg "Failed to connect"
//
//  Cyclomatic Complexity V(G) = 8

beforeEach(() => {
    capturedMessageHandler = null;
    capturedErrorHandler   = null;
    jest.clearAllMocks();
    mockClient.onMessage.mockImplementation((h: any) => { capturedMessageHandler = h; });
    mockClient.onError.mockImplementation((h: any)   => { capturedErrorHandler = h; });
});

// ─── Jalur Error / Validasi ────────────────────────────────────────────────────
describe('useAnalyzeHook ARDL – Validasi (P1–P5)', () => {
    it('TC-ARDL-01 [P1]: Dependent variable kosong → setErrorMsg, tidak panggil worker', async () => {
        const result = await runAndAnalyze([], [xVar], makeData(15));

        expect(result.current.errorMsg).toBe('Please select both dependent and independent variables');
        expect(mockClient.post).not.toHaveBeenCalled();
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ARDL-02 [P2]: Independent variable kosong → setErrorMsg, tidak panggil worker', async () => {
        const result = await runAndAnalyze([yVar], [], makeData(15));

        expect(result.current.errorMsg).toBe('Please select both dependent and independent variables');
        expect(mockClient.post).not.toHaveBeenCalled();
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ARDL-03 [P3]: Observasi Y < 10 → errorMsg "Insufficient data points"', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(5));

        expect(result.current.errorMsg).toBe('Insufficient data points (minimum 10 required)');
        expect(mockClient.post).not.toHaveBeenCalled();
    });

    it('TC-ARDL-04 [P4]: Listwise deletion mengabaikan baris dengan X null secara otomatis', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeDataNullX());

        expect(result.current.errorMsg).toBeNull();
        expect(mockClient.post).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ARDL',
                payload: expect.objectContaining({
                    y: expect.any(Array),
                    x: expect.any(Array),
                }),
            }),
        );
        const postCall = mockClient.post.mock.calls[0][0];
        expect(postCall.payload.y.length).toBe(10);
        expect(postCall.payload.x.length).toBe(10);
    });

    it('TC-ARDL-05 [P5]: qOrders tidak cocok jumlah X → fallback array digunakan ke worker', async () => {
        // 1 X variable, tapi qOrders punya 2 elemen → ambil jalur else ternary
        const result = await runAndAnalyze([yVar], [xVar], makeData(15), 1, [1, 2]);

        expect(mockClient.post).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ARDL',
                payload: expect.objectContaining({
                    q: [1], // qOrders tetap dipakai jika length-nya sama dengan n_vars=1
                }),
            }),
        );
        expect(result.current.errorMsg).toBeNull();
    });
});

// ─── Jalur Worker ──────────────────────────────────────────────────────────────
describe('useAnalyzeHook ARDL – Respons Worker (P6–P8)', () => {
    it('TC-ARDL-06 [P6]: Worker sukses → errorMsg null, addStatistic dipanggil', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockARDLResult);

        expect(result.current.errorMsg).toBeNull();
        expect(mockAddStatistic).toHaveBeenCalled();
    });

    it('TC-ARDL-07 [P7]: Worker kembalikan status error → errorMsg dari worker diset', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerWorkerError('ARDL estimation diverged');

        expect(result.current.errorMsg).toBe('ARDL estimation diverged');
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ARDL-08 [P8]: Koneksi worker error → errorMsg "Failed to connect to worker"', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerConnectionError();

        expect(result.current.errorMsg).toBe('Failed to connect to worker');
        expect(result.current.isCalculating).toBe(false);
    });

    it('TC-ARDL-09: Unrestricted ARDL Model & Automatic Lag Selection payload dikirim dengan benar ke worker', async () => {
        const result = await runAndAnalyze([yVar], [xVar], makeData(15));

        expect(mockClient.post).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'ARDL',
                payload: expect.objectContaining({
                    autoSelect: true,
                    maxP: 4,
                    maxQ: 4,
                    selectionCriterion: 'aic',
                }),
            }),
        );
    });

    it('TC-ARDL-10: Worker mengembalikan unrestrictedModel → Tabel Unrestricted ARDL dimasukkan ke output statistic', async () => {
        const mockUnrestrictedResult = {
            ...mockARDLResult,
            selectedModelName: 'ARDL(1, 1)',
            evaluatedModelsCount: 20,
            selectionCriterion: 'AIC',
            unrestrictedModel: {
                varNames: ['Y(-1)', 'X1', 'X1(-1)', 'C'],
                coefficients: ['0.7022', '0.1896', '0.0486', '0.0117'],
                stdErrors: ['0.0085', '0.0084', '0.0109', '0.0599'],
                tStats: ['82.6266', '22.6564', '4.4687', '0.1956'],
                pValues: ['0.0000', '0.0000', '0.0000', '0.8449'],
                effObs: 1499,
                diagnostics: {
                    rSquared: '0.9996',
                    adjRSquared: '0.9996',
                    seRegression: '0.4983',
                    sumSquaredResid: '371.1396',
                    logLikelihood: '-1080.7050',
                    fStatistic: '1264478.0000',
                    probFStatistic: '0.0000',
                    meanDependentVar: '113.9490',
                    sdDependentVar: '25.0781',
                    aic: '1.4472',
                    bic: '1.4614',
                    hq: '1.4525',
                    durbinWatson: '2.0115',
                },
            },
        };

        await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockUnrestrictedResult);

        expect(mockAddStatistic).toHaveBeenCalledWith(
            1,
            expect.objectContaining({
                title: 'ARDL Output',
                components: 'ArdlAnalysis',
            }),
        );
        const outputPayload = JSON.parse(mockAddStatistic.mock.calls[0][1].output_data);
        expect(outputPayload.tables.some((t: any) => t.title.includes('Unrestricted ARDL Equation'))).toBe(true);
    });

    it('TC-ARDL-11: Worker mengembalikan fitted values & correlogram → output_data memuat charts dengan format valid', async () => {
        const mockResultWithGraphics = {
            ...mockARDLResult,
            selectedModelName: 'ARDL(1, 1)',
            unrestrictedModel: {
                varNames: ['Y(-1)', 'C'],
                coefficients: ['0.8', '1.0'],
                stdErrors: ['0.1', '0.2'],
                tStats: ['8.0', '5.0'],
                pValues: ['0.001', '0.001'],
                effObs: 5,
                diagnostics: {
                    rSquared: '0.99',
                    adjRSquared: '0.98',
                    seRegression: '0.5',
                    sumSquaredResid: '1.2',
                    logLikelihood: '-10.5',
                    fStatistic: '100.0',
                    probFStatistic: '0.000',
                    meanDependentVar: '14.0',
                    sdDependentVar: '3.0',
                    aic: '1.4',
                    bic: '1.5',
                    hq: '1.45',
                    durbinWatson: '2.0',
                },
                actual: [10, 12, 14, 16, 18],
                fitted: [9.8, 12.1, 13.9, 16.2, 17.8],
                residuals: [0.2, -0.1, 0.1, -0.2, 0.2]
            },
            correlogram: [
                { lag: 1, ac: "0.150", pac: "0.150", qStat: "0.12", pValue: "0.72" },
                { lag: 2, ac: "-0.080", pac: "-0.100", qStat: "0.25", pValue: "0.88" }
            ]
        };

        await runAndAnalyze([yVar], [xVar], makeData(15));
        await triggerSuccess(mockResultWithGraphics);

        const outputPayload = JSON.parse(mockAddStatistic.mock.calls[0][1].output_data);
        expect(outputPayload.charts).toBeDefined();
        expect(outputPayload.charts.length).toBe(3); // Actual vs Fitted, Residuals, Correlogram
        
        // Actual vs Fitted chart test
        const actualFitted = outputPayload.charts[0];
        expect(actualFitted.chartType).toBe("Multiple Line Chart");
        expect(actualFitted.chartData[0]).toHaveProperty("category");
        expect(actualFitted.chartData[0]).toHaveProperty("subcategory");
        expect(actualFitted.chartData[0]).toHaveProperty("value");
        
        // Residuals chart test
        const resChart = outputPayload.charts[1];
        expect(resChart.chartType).toBe("Line Chart");
        expect(resChart.chartData[0]).toHaveProperty("category");
        expect(resChart.chartData[0]).toHaveProperty("value");

        // Correlogram chart test
        const correloChart = outputPayload.charts[2];
        expect(correloChart.chartType).toBe("Multiple Line Chart");
        expect(correloChart.chartData[0]).toHaveProperty("category");
        expect(correloChart.chartData[0]).toHaveProperty("subcategory");
        expect(correloChart.chartData[0]).toHaveProperty("value");
    });
});

