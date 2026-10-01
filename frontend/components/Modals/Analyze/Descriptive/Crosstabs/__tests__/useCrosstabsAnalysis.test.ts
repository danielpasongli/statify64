import { renderHook, act } from '@testing-library/react';
import { useCrosstabsAnalysis } from '../hooks/useCrosstabsAnalysis';
import { useAnalysisData } from '@/hooks/useAnalysisData';
import { useVariableStore } from '@/stores/useVariableStore';
import { useResultStore } from '@/stores/useResultStore';
import { CrosstabsAnalysisParams } from '../types';
import type { Variable } from '@/types/Variable';

// Mock stores and hooks
jest.mock('@/hooks/useAnalysisData');
jest.mock('@/stores/useVariableStore');
jest.mock('@/stores/useResultStore');

// Mock Worker
const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();
let workerOnMessage: (event: { data: any }) => void;
let workerOnError: (event: ErrorEvent) => void;

global.Worker = jest.fn().mockImplementation(() => ({
  postMessage: mockPostMessage,
  terminate: mockTerminate,
  set onmessage(fn: (event: { data: any }) => void) {
    workerOnMessage = fn;
  },
  set onerror(fn: (event: ErrorEvent) => void) {
    workerOnError = fn;
  },
}));

// Mock implementations
const mockedUseAnalysisData = useAnalysisData as unknown as jest.Mock;
const mockedUseVariableStore = useVariableStore as unknown as jest.Mock;
const mockedUseResultStore = useResultStore as unknown as jest.Mock;

const mockAddLog = jest.fn();
const mockAddAnalytic = jest.fn();
const mockAddStatistic = jest.fn();
const mockOnClose = jest.fn();

const mockVariables: Variable[] = [
    { name: 'var1', label: 'Variable 1', columnIndex: 0, type: 'NUMERIC', tempId: '1', width: 8, decimals: 0, values: [], missing: {}, align: 'left', measure: 'scale', role: 'input', columns: 8 },
    { name: 'var2', label: 'Variable 2', columnIndex: 1, type: 'NUMERIC', tempId: '2', width: 8, decimals: 0, values: [], missing: {}, align: 'left', measure: 'scale', role: 'input', columns: 8 },
];

const mockData = [
    [1, 'A'],
    [2, 'B'],
];

const mockWeights = [1, 2];

describe('useCrosstabsAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAnalysisData.mockReturnValue({ data: mockData, weights: mockWeights });
    mockedUseVariableStore.mockReturnValue({ variables: mockVariables });
    mockedUseResultStore.mockReturnValue({
        addLog: mockAddLog,
        addAnalytic: mockAddAnalytic,
        addStatistic: mockAddStatistic,
    });
    mockAddLog.mockResolvedValue('log-123');
    mockAddAnalytic.mockResolvedValue('analytic-123');
  });

  const defaultParams: CrosstabsAnalysisParams = {
    rowVariables: [mockVariables[0]],
    columnVariables: [mockVariables[1]],
    options: {
        cells: { observed: true, expected: false, row: false, column: false, total: false, hideSmallCounts: false, hideSmallCountsThreshold: 5 },
        residuals: { unstandardized: false, standardized: false, adjustedStandardized: false },
        nonintegerWeights: 'roundCell',
    },
  };

  it('should not run analysis if row or column variables are empty', async () => {
    const params: CrosstabsAnalysisParams = { ...defaultParams, rowVariables: [] };
    const { result } = renderHook(() => useCrosstabsAnalysis(params, mockOnClose));

    await act(async () => {
      await result.current.runAnalysis();
    });

    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should run analysis and process successful worker response', async () => {
    const { result } = renderHook(() => useCrosstabsAnalysis(defaultParams, mockOnClose));

    // Initial state
    expect(result.current.isCalculating).toBe(false);
    expect(result.current.error).toBe(null);

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runAnalysis();
    });

    // State during calculation
    expect(result.current.isCalculating).toBe(true);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith({
        analysisType: 'crosstabs',
        variable: { row: mockVariables[0], col: mockVariables[1] },
        data: [{ var1: 1, var2: 'A' }, { var1: 2, var2: 'B' }],
        weights: mockWeights,
        options: defaultParams.options,
    });

    const mockWorkerResult = {
        status: 'success',
        results: {
            summary: { valid: 2, missing: 0, rowCategories: [], colCategories: [], rowTotals: [], colTotals: [], totalCases: 2 },
            contingencyTable: []
        },
        variableName: 'var1 * var2'
    };

    await act(async () => {
        workerOnMessage({ data: mockWorkerResult });
        await runPromise; // wait for the full analysis process to complete
    });

    expect(mockAddLog).toHaveBeenCalled();
    expect(mockAddAnalytic).toHaveBeenCalled();
    expect(mockAddStatistic).toHaveBeenCalledTimes(2); // Case Processing & Crosstabs table
    expect(mockTerminate).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
    expect(result.current.isCalculating).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should save Chi-Square Tests output when chi-square statistic is enabled', async () => {
    const paramsWithChiSquare: CrosstabsAnalysisParams = {
      ...defaultParams,
      options: {
        ...defaultParams.options,
        statistics: { chiSquare: true },
      },
    };

    const { result } = renderHook(() => useCrosstabsAnalysis(paramsWithChiSquare, mockOnClose));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runAnalysis();
    });

    const mockWorkerResult = {
      status: 'success',
      results: {
        summary: { valid: 2, missing: 0, rowCategories: ['1', '2'], colCategories: ['A', 'B'], rowTotals: [1, 1], colTotals: [1, 1], totalCases: 2 },
        contingencyTable: [[1, 0], [0, 1]],
        chiSquare: {
          pearson: {
            value: 2,
            df: 1,
            pValue: 0.1573,
            expectedDiagnostics: {
              minExpectedCount: 0.5,
              cellsUnder5: 4,
              totalCells: 4,
              percentCellsUnder5: 100,
            },
          },
        },
      },
      variableName: 'var1 * var2',
    };

    await act(async () => {
      workerOnMessage({ data: mockWorkerResult });
      await runPromise;
    });

    expect(mockAddStatistic).toHaveBeenCalledTimes(3); // Case Processing, Crosstabs, Chi-Square Tests
    expect(mockAddStatistic).toHaveBeenNthCalledWith(
      3,
      'analytic-123',
      expect.objectContaining({
        components: 'Chi-Square Tests',
        description: expect.stringContaining('Hipotesis uji kebebasan'),
      }),
    );
    const savedDescription = mockAddStatistic.mock.calls[2][1].description;
    expect(savedDescription).toContain('<strong>Interpretasi</strong>');
    expect(savedDescription).toContain('gagal menolak H');
    expect(savedDescription).not.toContain('Hipotesis uji proporsi');
  });

  it('should handle worker error', async () => {
    const { result } = renderHook(() => useCrosstabsAnalysis(defaultParams, mockOnClose));

    let runPromise: Promise<void>;
    act(() => {
      runPromise = result.current.runAnalysis();
    });

    const mockWorkerError = {
        status: 'error',
        error: 'Something went wrong',
        variableName: 'var1 * var2'
    };

    await act(async () => {
        workerOnMessage({ data: mockWorkerError });
        await runPromise;
    });

    expect(result.current.error).toContain('Something went wrong');
    expect(result.current.isCalculating).toBe(false);
    expect(mockTerminate).toHaveBeenCalled();
  });

  it('should handle worker instantiation error', async () => {
    const { result } = renderHook(() => useCrosstabsAnalysis(defaultParams, mockOnClose));

    act(() => {
      result.current.runAnalysis();
    });

    const errorEvent = new ErrorEvent('error', {
      error: new Error('Failed to load script'),
      message: 'Worker script failed to load'
    });

    act(() => {
        workerOnError(errorEvent);
    });

    expect(result.current.error).toContain('Failed to load the analysis worker');
    expect(result.current.isCalculating).toBe(false);
    expect(mockTerminate).toHaveBeenCalled();
  });
});
