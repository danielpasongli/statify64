importScripts('/workers/DescriptiveStatistics/libs/utils/utils.js');
importScripts('/workers/DescriptiveStatistics/libs/categoricalTests/categoricalChiSquare.js');
importScripts('/workers/DescriptiveStatistics/libs/crosstabs/crosstabs.js');

onmessage = function (event) {
  const { variable, data, weights, options } = event.data || {};

  try {
    const calculator = new self.CrosstabsCalculator({ variable, data, weights, options });
    const results = calculator.getStatistics();

    const variableName = variable && variable.row && variable.col
      ? `${variable.row?.name} * ${variable.col?.name}`
      : 'unknown';

    postMessage({
      status: 'success',
      variableName,
      results,
    });
  } catch (err) {
    const variableName = variable && variable.row && variable.col
      ? `${variable.row?.name} * ${variable.col?.name}`
      : 'unknown';
    console.error('[CrosstabsWorker] Error:', err);
    postMessage({
      status: 'error',
      variableName,
      error: err?.message || String(err),
    });
  }
};
