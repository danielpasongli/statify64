const fs = require('fs');
const path = require('path');

// Helper to load worker scripts into the Node test environment.
const loadScript = (scriptPath) => {
  const normalized = scriptPath.startsWith('/') ? scriptPath.slice(1) : scriptPath;
  const absolutePath = path.resolve(__dirname, '../', normalized);
  const scriptContent = fs.readFileSync(absolutePath, 'utf8');
  new Function(scriptContent)();
};

// -------------------------------------------------------------
//  Set up a faux Web-Worker global scope
// -------------------------------------------------------------

global.self = global;
global.importScripts = loadScript;

// Load required scripts
loadScript('utils/utils.js');
loadScript('categoricalTests/categoricalChiSquare.js');
loadScript('crosstabs/crosstabs.js');

const CrosstabsCalculator = global.self.CrosstabsCalculator;

// -------------------------------------------------------------
//  Unit tests
// -------------------------------------------------------------

describe('CrosstabsCalculator', () => {
    // Define simple numeric row/column variables
    const rowVar = { name: 'rowVar', measure: 'nominal' };
    const colVar = { name: 'colVar', measure: 'nominal' };

    // Build a dataset that forms the following 2x2 contingency table:
    //            colVar
    //            0    1
    //  rowVar 0  3    1
    //         1  1    3
    //  Expected Pearson Chi-Square = 2 (df = 1)
    const data = [];
    for (let i = 0; i < 3; i++) data.push({ rowVar: 0, colVar: 0 });
    data.push({ rowVar: 0, colVar: 1 });
    data.push({ rowVar: 1, colVar: 0 });
    for (let i = 0; i < 3; i++) data.push({ rowVar: 1, colVar: 1 });

    const calc = new CrosstabsCalculator({ variable: { row: rowVar, col: colVar }, data });

    it('should correctly compute Pearson Chi-Square and degrees of freedom', () => {
        const { value, df } = calc.getPearsonChiSquare();
        expect(df).toBe(1);
        expect(value).toBeCloseTo(2);
    });

    it('should build the correct contingency table totals', () => {
        const stats = calc.getStatistics();
        expect(stats.summary.totalCases).toBe(8);

        // Row totals should each equal 4
        expect(stats.summary.rowTotals).toEqual([4, 4]);
        // Column totals should each equal 4
        expect(stats.summary.colTotals).toEqual([4, 4]);
    });
});
