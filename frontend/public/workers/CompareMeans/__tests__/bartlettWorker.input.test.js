/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Execute the production worker. Only the CDN CDF is substituted; these tests
// exercise input selection and the message contract, not the distribution.
function loadWorker() {
    const context = vm.createContext({
        self: { postMessage: jest.fn() },
        console: { log() {}, warn() {}, error() {} },
        performance, chiSquareCdf: () => 0,
    });
    const utilities = fs.readFileSync(path.join(__dirname, '../libs/utils.js'), 'utf8');
    vm.runInContext(utilities.replace(/export function /g, 'function '), context);
    const source = fs.readFileSync(path.join(__dirname, '../bartlettTestWorker.js'), 'utf8');
    vm.runInContext(source.replace(/^import .*;\r?$/gm, ''), context);
    return context;
}

test('Bartlett excludes blank, non-finite and declared missing values in either column', () => {
    const worker = loadWorker();
    const groups = worker.groupDataByFactor(
        [1, 3, '', '  ', Infinity, 999, 5, 7, 8, 9],
        ['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', '', 'missing'],
        { type: 'NUMERIC', missing: { discrete: [999] } },
        { type: 'STRING', missing: { discrete: ['missing'] } },
    );
    expect(Object.keys(groups)).toEqual(['a', 'b']);
    expect(Array.from(groups.a)).toEqual([1, 3]);
    expect(Array.from(groups.b)).toEqual([5, 7]);
});

test('Bartlett accepts ordinary categorical labels that coincide with object properties', () => {
    const groups = loadWorker().groupDataByFactor([1, 3, 5, 7], ['__proto__', '__proto__', 'constructor', 'constructor']);
    expect(Array.from(groups.__proto__)).toEqual([1, 3]);
    expect(Array.from(groups.constructor)).toEqual([5, 7]);
});

test('Bartlett merecode faktor teks menjadi kode sementara berbasis satu', () => {
    const worker = loadWorker();
    const dataAsli = ['SMA', 'SMP', 'SMA', 'SD'];

    expect(worker.recodeCategoricalValues).toEqual(expect.any(Function));

    const hasil = worker.recodeCategoricalValues(dataAsli);

    expect(Array.from(hasil.codes)).toEqual([1, 2, 1, 3]);
    expect(Array.from(hasil.categories)).toEqual(['SMA', 'SMP', 'SD']);
    expect(dataAsli).toEqual(['SMA', 'SMP', 'SMA', 'SD']);
});

test('CALCULATE passes both variable definitions to input selection', () => {
    const worker = loadWorker();
    worker.self.onmessage({ data: { type: 'CALCULATE', data: {
        testVariables: [{ name: 'score', type: 'NUMERIC', missing: { range: { min: 90, max: 99 } } }],
        factorVariable: { name: 'group', type: 'NUMERIC', missing: { discrete: [99] } },
        variablesData: [[1, 3, 5, 7, 95, 100]],
        factorData: [1, 1, 2, 2, 1, 99],
    } } });
    const message = worker.self.postMessage.mock.calls[0][0];
    expect(message.type).toBe('BARTLETT_RESULT');
    expect(message.data[0].statistic).toBeCloseTo(0);
    expect(message.data[0].df).toBe(1);
});
