/**
 * Matrix coverage tests for DescriptiveStatistics/crosstabs.worker.js
 * Focus: dd-mm-yyyy handling, non-integer weights, and cell stats flags.
 */
const path = require('path');

function loadWorker() {
  global.self = global;
  global.importScripts = (...urls) => {
    urls.forEach((u) => {
      const localPath = path.join(process.cwd(), 'public', u.replace(/^\/+/, ''));
      delete require.cache[require.resolve(localPath)];
      require(localPath);
    });
  };

  // Load libs
  require(path.join(process.cwd(), 'public/workers/DescriptiveStatistics/libs/utils/utils.js'));
  require(path.join(process.cwd(), 'public/workers/DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js'));
  require(path.join(process.cwd(), 'public/workers/DescriptiveStatistics/libs/crosstabs/crosstabs.js'));

  const workerPath = path.join(process.cwd(), 'public/workers/DescriptiveStatistics/crosstabs.worker.js');
  delete require.cache[require.resolve(workerPath)];
  require(workerPath);
}

describe('crosstabs.worker – basics and date handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handles date labels (dd-mm-yyyy) on rows and converts for display', () => {
    const postSpy = jest.fn();
    global.postMessage = postSpy;
    loadWorker();

    const variable = {
      row: { name: 'Date', label: 'Date', missing: { type: 'none' } },
      col: { name: 'Group', label: 'Group', missing: { type: 'none' } },
    };
    const data = [
      { Date: '01-01-2020', Group: 'A' },
      { Date: '02-01-2020', Group: 'B' },
      { Date: '01-01-2020', Group: 'A' },
    ];

    global.onmessage({ data: { variable, data, options: { cells: { observed: true }, residuals: {}, nonintegerWeights: 'noAdjustment' } } });

    const payload = postSpy.mock.calls[0][0];
    expect(payload.status).toBe('success');
    const summary = payload.results.summary;
    expect(summary).toBeDefined();
    expect(payload.results.chiSquare?.pearson?.expectedDiagnostics).toBeDefined();
    // Row categories should be formatted back to dd-mm-yyyy for display
    expect(summary.rowCategories).toEqual(expect.arrayContaining(['01-01-2020', '02-01-2020']));
  });

  test('applies non-integer weight adjustment at cell level when specified', () => {
    const postSpy = jest.fn();
    global.postMessage = postSpy;
    loadWorker();

    const variable = {
      row: { name: 'R', label: 'R' },
      col: { name: 'C', label: 'C' },
    };
    const data = [
      { R: 'x', C: 'a' },
      { R: 'x', C: 'a' },
      { R: 'y', C: 'b' },
    ];
    const weights = [0.6, 0.6, 0.6];

    global.onmessage({ data: { variable, data, weights, options: { cells: { observed: true }, residuals: {}, nonintegerWeights: 'roundCell' } } });

    const payload = postSpy.mock.calls[0][0];
    expect(payload.status).toBe('success');
    const table = payload.results.contingencyTable;
    // With rounding at cell level, 1.2 rounds to 1 and 0.6 rounds to 1, so total becomes 2
    const total = table.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });
});


