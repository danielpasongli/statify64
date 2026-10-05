const path = require('path');

function loadWorker() {
    global.self = global;
    global.importScripts = (...urls) => {
        urls.forEach((url) => {
            const localPath = path.join(
                process.cwd(),
                'public',
                url.replace(/^\/+/, ''),
            );
            delete require.cache[require.resolve(localPath)];
            require(localPath);
        });
    };

    const workerPath = path.join(
        process.cwd(),
        'public/workers/DescriptiveStatistics/crosstabs.worker.js',
    );
    delete require.cache[require.resolve(workerPath)];
    require(workerPath);
}

function runCrosstabs(data) {
    const postMessage = jest.fn();
    global.postMessage = postMessage;
    loadWorker();

    global.onmessage({
        data: {
            variable: {
                row: { name: 'Kelompok', type: 'STRING', measure: 'nominal' },
                col: { name: 'Hasil', type: 'STRING', measure: 'nominal' },
            },
            data,
            options: {
                statistics: { chiSquare: true },
                cells: {},
                residuals: {},
                nonintegerWeights: 'noAdjustment',
            },
        },
    });

    return postMessage.mock.calls[0][0];
}

function expandTable(rowLabels, columnLabels, frequencies) {
    const data = [];
    frequencies.forEach((row, rowIndex) => {
        row.forEach((frequency, columnIndex) => {
            for (let count = 0; count < frequency; count++) {
                data.push({
                    Kelompok: rowLabels[rowIndex],
                    Hasil: columnLabels[columnIndex],
                });
            }
        });
    });
    return data;
}

describe('Black-box Uji Kategorik', () => {
    test('C-BB-01: kategori teks diproses tanpa recode manual', () => {
        const data = expandTable(
            ['Desa A', 'Desa B'],
            ['Miskin', 'Tidak miskin'],
            [[10, 20], [20, 10]],
        );
        const salinanData = data.map((baris) => ({ ...baris }));

        const pesan = runCrosstabs(data);

        expect(pesan.status).toBe('success');
        expect(pesan.results.summary.rowCategories).toEqual(['Desa A', 'Desa B']);
        expect(pesan.results.summary.colCategories).toEqual(['Miskin', 'Tidak miskin']);
        expect(pesan.results.contingencyTable).toEqual([[10, 20], [20, 10]]);
        expect(data).toEqual(salinanData);
    });

    test('C-BB-02: data berhubungan menghasilkan keputusan menolak kebebasan', () => {
        const pesan = runCrosstabs(expandTable(
            ['A', 'B'],
            ['Ya', 'Tidak'],
            [[30, 10], [10, 30]],
        ));

        expect(pesan.results.chiSquare.pearson).toEqual(expect.objectContaining({
            testType: 'independence',
            decision: 'reject',
            significant: true,
        }));
        expect(pesan.results.chiSquare.pearson.pValue).toBeLessThan(0.05);
    });

    test('C-BB-03: data bebas menghasilkan keputusan gagal menolak kebebasan', () => {
        const pesan = runCrosstabs(expandTable(
            ['A', 'B'],
            ['Ya', 'Tidak'],
            [[20, 20], [20, 20]],
        ));

        expect(pesan.results.chiSquare.pearson).toEqual(expect.objectContaining({
            testType: 'independence',
            decision: 'fail-to-reject',
            significant: false,
        }));
        expect(pesan.results.chiSquare.pearson.pValue).toBeGreaterThanOrEqual(0.05);
    });

    test('P-BB-01: dua kategori hasil menggunakan uji proporsi binomial', () => {
        const pesan = runCrosstabs(expandTable(
            ['Desa A', 'Desa B'],
            ['Miskin', 'Tidak miskin'],
            [[10, 20], [20, 10]],
        ));

        expect(pesan.results.chiSquare.proportion).toEqual(expect.objectContaining({
            testType: 'binomial-proportion-homogeneity',
            outcomeCategoryCount: 2,
        }));
    });

    test('P-BB-02: tiga kategori hasil menggunakan uji proporsi multinomial', () => {
        const pesan = runCrosstabs(expandTable(
            ['Desa A', 'Desa B'],
            ['Rendah', 'Sedang', 'Tinggi'],
            [[10, 20, 30], [20, 10, 30]],
        ));

        expect(pesan.results.chiSquare.proportion).toEqual(expect.objectContaining({
            testType: 'multinomial-proportion-homogeneity',
            outcomeCategoryCount: 3,
        }));
    });

    test('C-BB-04: kategori kosong dikeluarkan dan dicatat sebagai missing', () => {
        const pesan = runCrosstabs([
            { Kelompok: 'A', Hasil: 'Ya' },
            { Kelompok: 'A', Hasil: 'Tidak' },
            { Kelompok: 'B', Hasil: 'Ya' },
            { Kelompok: 'B', Hasil: 'Tidak' },
            { Kelompok: '', Hasil: 'Ya' },
            { Kelompok: 'A', Hasil: '   ' },
        ]);

        expect(pesan.results.summary).toEqual(expect.objectContaining({
            valid: 4,
            missing: 2,
        }));
    });

    test('C-BB-05: satu kategori hasil ditangani tanpa membuat worker gagal', () => {
        const pesan = runCrosstabs([
            { Kelompok: 'A', Hasil: 'Ya' },
            { Kelompok: 'A', Hasil: 'Ya' },
            { Kelompok: 'B', Hasil: 'Ya' },
            { Kelompok: 'B', Hasil: 'Ya' },
        ]);

        expect(pesan.status).toBe('success');
        expect(pesan.results.chiSquare.pearson).toEqual(expect.objectContaining({
            df: 0,
            pValue: null,
        }));
        expect(pesan.results.chiSquare.proportion).toBeNull();
    });
});
