/**
 * Pengujian karakteristik komputasi Shapiro-Wilk.
 *
 * Pengujian ini memeriksa perilaku yang dapat diamati. Bentuk internal kode
 * tidak dikunci agar algoritma dapat dirapikan tanpa merusak pengujian.
 */
describe('Shapiro-Wilk: karakteristik komputasi', () => {
    let calculateShapiroWilk;

    beforeAll(() => {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.join(__dirname, '../normalityTests.js'),
            'utf-8',
        );
        const context = {};
        new Function(
            'context',
            `${source}\ncontext.calculateShapiroWilk = calculateShapiroWilk;`,
        )(context);
        calculateShapiroWilk = context.calculateShapiroWilk;
    });

    function generateNormalData(n, seed = 42) {
        let state = seed;
        const random = () => {
            state |= 0;
            state = state + 0x6D2B79F5 | 0;
            let value = Math.imul(state ^ state >>> 15, 1 | state);
            value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };

        const data = [];
        for (let i = 0; i < n; i += 2) {
            const u1 = random() || Number.EPSILON;
            const u2 = random();
            const radius = Math.sqrt(-2 * Math.log(u1));
            data.push(radius * Math.cos(2 * Math.PI * u2));
            if (i + 1 < n) data.push(radius * Math.sin(2 * Math.PI * u2));
        }
        return data;
    }

    test('tidak mengubah urutan atau isi data masukan', () => {
        const data = [5, 1, 4, 2, 3];
        const original = [...data];

        calculateShapiroWilk(data);

        expect(data).toEqual(original);
    });

    test('W dan nilai-p tetap sama setelah transformasi lokasi dan skala positif', () => {
        const data = generateNormalData(50);
        const transformed = data.map(value => 10 + 3.5 * value);

        const originalResult = calculateShapiroWilk(data);
        const transformedResult = calculateShapiroWilk(transformed);

        expect(transformedResult.statistic).toBeCloseTo(originalResult.statistic, 12);
        expect(transformedResult.pValue).toBeCloseTo(originalResult.pValue, 12);
    });

    test('menyelesaikan batas maksimum 5.000 observasi dalam waktu wajar', () => {
        const data = generateNormalData(5000);
        const startedAt = performance.now();

        const result = calculateShapiroWilk(data);
        const elapsed = performance.now() - startedAt;

        expect(result).not.toBeNull();
        expect(result.statistic).toBeGreaterThan(0);
        expect(result.statistic).toBeLessThanOrEqual(1);
        expect(elapsed).toBeLessThan(500);
    });
});
