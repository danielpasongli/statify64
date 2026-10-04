const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Acuan SF: Python math.erfc, Q(z) = erfc(z / sqrt(2)) / 2.
// Acuan nilai-p: transformasi AS R94 untuk W tetap, dievaluasi dengan math.erfc.
// Galat relatif diperlukan: toleransi absolut dapat meloloskan p palsu bernilai nol.
describe('Presisi ekor distribusi normal', () => {
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../normalityTests.js'), 'utf8'), context);

    test.each([
        [-2, 0.9772498680518209],
        [0, 0.5],
        [0.5, 0.30853753872598694],
        [1.7, 0.04456546275854306],
        [1.8, 0.03593031911292581],
        [4, 3.1671241833119965e-5],
        [8, 6.220960574271819e-16],
        [10, 7.619853024160595e-24],
        [13, 6.117164399549922e-39],
        [20, 2.7536241186063325e-89],
        [37, 5.72557122252514e-300],
    ])('CDF pada -%s sesuai ekor normal acuan', (z, expected) => {
        expect(Math.abs(context.normalityCDF(-z) / expected - 1)).toBeLessThan(5e-13);
    });

    test.each([
        [0.9, 5, 0.4098855225773584],
        [0.95, 11, 0.6439535131211813],
        [0.95, 12, 0.636984717079611],
        [0.95, 30, 0.16906020313294437],
        [0.95, 500, 5.806214832141474e-12],
        [0.8279068, 1470, 4.402366700211671e-37],
        [0.9, 4999, 3.3101664722118988e-49],
    ])('nilai-p W=%s, n=%s mempertahankan presisi relatif', (w, n, expected) => {
        expect(Math.abs(context.shapiroWilkPValue(w, n) / expected - 1)).toBeLessThan(5e-12);
    });

    test('CDF menangani batas probabilitas dan NaN', () => {
        expect(context.normalityCDF(-Infinity)).toBe(0);
        expect(context.normalityCDF(Infinity)).toBe(1);
        expect(context.normalityCDF(NaN)).toBeNaN();
    });

    // Acuan langsung scipy.stats.shapiro versi 1.18.1; mencakup alur data -> W -> p.
    test('sampel besar menghasilkan p sangat kecil sesuai SciPy', () => {
        const result = context.calculateShapiroWilk(Array.from({ length: 5000 }, (_, i) => i % 3));
        expect(Math.abs(result.pValue / 3.2237328546145366e-62 - 1)).toBeLessThan(1e-6);
    });

    test('dataset eksponensial n=100 mempertahankan nilai-p sesuai SciPy', () => {
        const { datasets } = require('./spss-benchmark-datasets.json');
        const data = datasets.find(dataset => dataset.id === 'ds10_exponential_n100').data;
        const result = context.calculateShapiroWilk(data);
        expect(Math.abs(result.pValue / 7.270824256342619e-13 - 1)).toBeLessThan(1e-6);
    });
});
