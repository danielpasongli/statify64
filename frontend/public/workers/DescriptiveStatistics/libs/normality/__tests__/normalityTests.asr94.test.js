const {
    calculateShapiroWilk,
    shapiroWilkPValue,
} = require('../normalityTests.js');

describe('Regresi numerik Shapiro-Wilk AS R94', () => {
    beforeAll(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    test('data 1 sampai 5 menghasilkan statistik dan p-value acuan', () => {
        const result = calculateShapiroWilk([1, 2, 3, 4, 5]);

        expect(result.statistic).toBeCloseTo(0.9867621554477195, 6);
        expect(result.pValue).toBeCloseTo(0.9671739359680402, 5);
    });

    test('rumus eksak untuk tiga observasi mempunyai batas p-value yang benar', () => {
        expect(shapiroWilkPValue(0.75, 3)).toBeCloseTo(0, 12);
        expect(shapiroWilkPValue(1, 3)).toBeCloseTo(1, 12);
    });

    test.each([
        [4, 0.9929120068006195, 0.9718770576208986],
        [6, 0.9818894288631078, 0.9605549608007049],
        [11, 0.9683912805170447, 0.8698423287837866],
        [12, 0.9668963632914048, 0.8757314433658766],
        [50, 0.9555826876524776, 0.05809186270093386],
    ])('data berurutan n=%i mengikuti nilai acuan AS R94', (n, expectedW, expectedP) => {
        const data = Array.from({ length: n }, (_, index) => index + 1);
        const result = calculateShapiroWilk(data);

        expect(result.statistic).toBeCloseTo(expectedW, 5);
        expect(result.pValue).toBeCloseTo(expectedP, 5);
    });
});
