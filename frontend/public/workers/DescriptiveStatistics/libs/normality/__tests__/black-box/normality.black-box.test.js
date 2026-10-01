const path = require('path');

const {
    runNormalityTests,
} = require(path.resolve(__dirname, '..', '..', 'normalityTests.js'));

describe('Black-box Uji Normalitas', () => {
    let logSpy;
    let warnSpy;

    beforeAll(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterAll(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    test('N-BB-01: data numerik valid menghasilkan Kolmogorov-Smirnov dan Shapiro-Wilk', () => {
        const dataAsli = [9, 10, 11, 12, 13, 10, 11, 12, 10, 11];
        const salinanData = [...dataAsli];

        const hasil = runNormalityTests(dataAsli, { alpha: 0.05 });

        expect(hasil.success).toBe(true);
        expect(hasil.tests.map((uji) => uji.key)).toEqual([
            'kolmogorovSmirnov',
            'shapiroWilk',
        ]);
        expect(hasil.kolmogorovSmirnov).toEqual(expect.objectContaining({
            statistic: expect.any(Number),
            df: dataAsli.length,
            pValue: expect.any(Number),
        }));
        expect(hasil.shapiroWilk).toEqual(expect.objectContaining({
            statistic: expect.any(Number),
            df: dataAsli.length,
            pValue: expect.any(Number),
        }));
        expect(dataAsli).toEqual(salinanData);
    });

    test('N-BB-02: kedua uji tidak tersedia jika observasi kurang dari tiga', () => {
        const hasil = runNormalityTests([10, 20], { alpha: 0.05 });

        expect(hasil.success).toBe(false);
        expect(hasil.tests).toHaveLength(2);
        expect(hasil.tests.every((uji) => uji.available === false)).toBe(true);
        expect(hasil.kolmogorovSmirnov).toBeNull();
        expect(hasil.shapiroWilk).toBeNull();
    });

    test('N-BB-03: data konstan ditangani tanpa menghasilkan statistik palsu', () => {
        const hasil = runNormalityTests([7, 7, 7, 7, 7], { alpha: 0.05 });

        expect(hasil.success).toBe(false);
        expect(hasil.kolmogorovSmirnov).toBeNull();
        expect(hasil.shapiroWilk).toBeNull();
    });

    test('N-BB-04: ukuran data penelitian 1470 observasi dapat diproses', () => {
        const data = Array.from({ length: 1470 }, (_, indeks) => indeks + 1);

        const hasil = runNormalityTests(data, { alpha: 0.05 });

        expect(hasil.success).toBe(true);
        expect(hasil.kolmogorovSmirnov).not.toBeNull();
        expect(hasil.shapiroWilk).not.toBeNull();
        expect(hasil.kolmogorovSmirnov.df).toBe(1470);
        expect(hasil.shapiroWilk.df).toBe(1470);
    });

    test('N-BB-05: data yang sangat tidak normal menghasilkan keputusan menolak normalitas', () => {
        const hasil = runNormalityTests(
            [1, 1, 1, 1, 1, 1, 1, 1, 1, 100],
            { alpha: 0.05 },
        );

        expect(hasil.tests).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'kolmogorovSmirnov',
                conclusion: 'reject-normality',
            }),
            expect.objectContaining({
                key: 'shapiroWilk',
                conclusion: 'reject-normality',
            }),
        ]));
    });

    test('N-BB-06: data mendekati normal menghasilkan keputusan gagal menolak normalitas', () => {
        const hasil = runNormalityTests(
            [9, 10, 11, 12, 13, 10, 11, 12, 10, 11],
            { alpha: 0.05 },
        );

        expect(hasil.tests).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'kolmogorovSmirnov',
                conclusion: 'fail-to-reject-normality',
            }),
            expect.objectContaining({
                key: 'shapiroWilk',
                conclusion: 'fail-to-reject-normality',
            }),
        ]));
    });
});
