/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { jStat } = require('jstat');

function loadWorker() {
    const context = vm.createContext({
        self: { postMessage: jest.fn() },
        console: { log() {}, warn() {}, error() {} },
        performance,
    });
    const categoricalSource = fs.readFileSync(
        path.join(
            __dirname,
            '..',
            '..',
            '..',
            'DescriptiveStatistics',
            'libs',
            'categoricalTests',
            'categoricalChiSquare.js',
        ),
        'utf8',
    );
    vm.runInContext(categoricalSource, context);
    const utilities = fs.readFileSync(
        path.join(__dirname, '..', '..', 'libs', 'utils.js'),
        'utf8',
    );
    vm.runInContext(utilities.replace(/export function /g, 'function '), context);

    const source = fs.readFileSync(
        path.join(__dirname, '..', '..', 'bartlettTestWorker.js'),
        'utf8',
    );
    vm.runInContext(source.replace(/^import .*;\r?$/gm, ''), context);
    return context;
}

function runBartlett(testData, factorData, definitions = {}) {
    const worker = loadWorker();
    const testVariable = definitions.testVariable ?? {
        name: 'Nilai',
        type: 'NUMERIC',
    };
    const factorVariable = definitions.factorVariable ?? {
        name: 'Kelompok',
        type: 'STRING',
    };

    worker.self.onmessage({
        data: {
            type: 'CALCULATE',
            data: {
                testVariables: [testVariable],
                factorVariable,
                variablesData: [testData],
                factorData,
            },
        },
    });

    return worker.self.postMessage.mock.calls[0][0];
}

describe('Black-box Uji Bartlett', () => {
    test('B-BB-01: faktor teks menghasilkan statistik Bartlett dan label kelompok asli', () => {
        const testData = [10, 12, 14, 20, 22, 24, 30, 32, 34];
        const factorData = ['Kelas A', 'Kelas A', 'Kelas A', 'Kelas B', 'Kelas B', 'Kelas B', 'Kelas C', 'Kelas C', 'Kelas C'];
        const salinanFaktor = [...factorData];

        const pesan = runBartlett(testData, factorData);
        const hasil = pesan.data[0];

        expect(pesan.type).toBe('BARTLETT_RESULT');
        expect(hasil).toEqual(expect.objectContaining({
            statistic: 0,
            df: 2,
            pValue: 1,
            groupNames: ['Kelas A', 'Kelas B', 'Kelas C'],
        }));
        expect(factorData).toEqual(salinanFaktor);
    });

    test('B-BB-02: varians homogen menghasilkan p-value lebih besar atau sama dengan 0,05', () => {
        const pesan = runBartlett(
            [10, 12, 14, 20, 22, 24, 30, 32, 34],
            ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C'],
        );

        expect(pesan.data[0].pValue).toBeGreaterThanOrEqual(0.05);
        expect(Math.abs(
            pesan.data[0].pValue
            - (1 - jStat.chisquare.cdf(pesan.data[0].statistic, pesan.data[0].df)),
        )).toBeLessThan(1e-10);
    });

    test('B-BB-03: varians heterogen menghasilkan p-value kurang dari 0,05', () => {
        const pesan = runBartlett(
            [10, 11, 10, 11, 10, 15, 25, 10, 30, 20, 20, 21, 19, 22, 18],
            ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C', 'C'],
        );

        expect(pesan.data[0].pValue).toBeLessThan(0.05);
    });

    test('B-BB-04: satu kelompok menghasilkan keterangan kelompok tidak mencukupi', () => {
        const pesan = runBartlett([10, 12, 14], ['A', 'A', 'A']);

        expect(pesan.data[0]).toEqual(expect.objectContaining({
            insufficientType: 'lessThanTwoGroups',
            error: expect.any(String),
        }));
    });

    test('B-BB-05: nilai kosong dan missing dikeluarkan sebelum pengujian', () => {
        const pesan = runBartlett(
            [1, 3, 999, 5, 7, 9],
            ['A', 'A', 'A', 'B', 'B', ''],
            {
                testVariable: {
                    name: 'Nilai',
                    type: 'NUMERIC',
                    missing: { discrete: [999] },
                },
                factorVariable: {
                    name: 'Kelompok',
                    type: 'STRING',
                },
            },
        );

        expect(pesan.data[0]).toEqual(expect.objectContaining({
            totalSampleSize: 4,
            groupNames: ['A', 'B'],
        }));
        expect(Array.from(pesan.data[0].groupSizes)).toEqual([2, 2]);
    });
});
