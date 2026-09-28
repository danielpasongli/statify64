/**
 * Unit tests for DescriptiveStatistics/crosstabs.worker.js
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

  require(path.join(process.cwd(), 'public/workers/DescriptiveStatistics/libs/utils/utils.js'));

  const workerPath = path.join(process.cwd(), 'public/workers/DescriptiveStatistics/crosstabs.worker.js');
  delete require.cache[require.resolve(workerPath)];
  require(workerPath);
}

describe('crosstabs.worker', () => {
  test('posts success for simple 2x2 table', () => {
    const postSpy = jest.fn();
    global.postMessage = postSpy;
    loadWorker();

    const variable = {
      row: { name: 'Gender', measure: 'nominal', type: 'STRING' },
      col: { name: 'Vote', measure: 'nominal', type: 'STRING' },
    };
    const data = [
      { Gender: 'Male', Vote: 'Yes' },
      { Gender: 'Male', Vote: 'No' },
      { Gender: 'Female', Vote: 'Yes' },
      { Gender: 'Female', Vote: 'No' },
    ];

    global.onmessage({ data: { variable, data, options: {} } });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const payload = postSpy.mock.calls[0][0];
    expect(payload.status).toBe('success');
    expect(payload.variableName).toBe('Gender * Vote');
    expect(payload.results).toBeDefined();
    expect(payload.results.chiSquare).toBeDefined();
    expect(payload.results.chiSquare.pearson).toBeDefined();
    expect(typeof payload.results.chiSquare.pearson.value).toBe('number');
    expect(payload.results.chiSquare.pearson.df).toBe(1);
    expect(payload.results.chiSquare.pearson.testType).toBe('independence');
    expect(payload.results.chiSquare.pearson.expectedCounts).toEqual([
      [1, 1],
      [1, 1],
    ]);
    expect(payload.results.chiSquare.proportion.testType)
      .toBe('binomial-proportion-homogeneity');
    expect(payload.results.chiSquare.proportion.outcomeCategoryCount).toBe(2);
  });

  test('supports date strings (dd-mm-yyyy) in row/col and preserves labels in summary', () => {
    const postSpy = jest.fn();
    global.postMessage = postSpy;
    loadWorker();

    const variable = {
      row: { name: 'Start', measure: 'unknown', type: 'DATE' },
      col: { name: 'End', measure: 'unknown', type: 'DATE' },
    };
    const data = [
      { Start: '01-01-2024', End: '02-01-2024' },
      { Start: '01-01-2024', End: '02-01-2024' },
      { Start: '02-01-2024', End: '03-01-2024' },
    ];

    global.onmessage({ data: { variable, data, options: {} } });

    const payload = postSpy.mock.calls[0][0];
    expect(payload.status).toBe('success');
    const summary = payload.results.summary;
    // Expect categories to be returned as dd-mm-yyyy strings
    expect(summary.rowCategories).toEqual(expect.arrayContaining(['01-01-2024', '02-01-2024']));
    expect(summary.colCategories).toEqual(expect.arrayContaining(['02-01-2024', '03-01-2024']));
  });

  test('uses the multinomial proportion algorithm for three outcome categories', () => {
    const postSpy = jest.fn();
    global.postMessage = postSpy;
    loadWorker();

    const variable = {
      row: { name: 'Village', measure: 'nominal', type: 'STRING' },
      col: { name: 'Status', measure: 'nominal', type: 'STRING' },
    };
    const data = [
      { Village: 'A', Status: 'Low' },
      { Village: 'A', Status: 'Medium' },
      { Village: 'A', Status: 'High' },
      { Village: 'B', Status: 'Low' },
      { Village: 'B', Status: 'Medium' },
      { Village: 'B', Status: 'High' },
    ];

    global.onmessage({ data: { variable, data, options: {} } });

    const proportion = postSpy.mock.calls[0][0].results.chiSquare.proportion;
    expect(proportion.testType).toBe('multinomial-proportion-homogeneity');
    expect(proportion.outcomeCategoryCount).toBe(3);
    expect(proportion.value).toBe(0);
    expect(proportion.df).toBe(2);
  });
});


