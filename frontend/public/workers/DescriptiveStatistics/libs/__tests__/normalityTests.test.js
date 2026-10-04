const path = require('path');

const normalityModulePath = path.resolve(
  __dirname,
  '../normality/normalityTests.js',
);

const {
  runNormalityTests,
  calculateKolmogorovSmirnov,
  calculateShapiroWilk,
  normalityMean,
} = require(normalityModulePath);

describe('runNormalityTests', () => {
  it('mempertahankan kontribusi kecil saat menghitung mean', () => {
    expect(normalityMean([1e16, 1, -1e16])).toBeCloseTo(1 / 3, 15);
  });

  it('returns Bartlett-like structured summary with per-test entries', () => {
    const values = [10, 12, 11, 13, 14, 10, 12, 11];
    const result = runNormalityTests(values, { alpha: 0.05 });

    expect(result).toBeDefined();
    expect(result.sampleSize).toBe(8);
    expect(result.alpha).toBe(0.05);
    expect(Array.isArray(result.tests)).toBe(true);
    expect(result.tests).toHaveLength(2);

    const ksEntry = result.tests.find((t) => t.key === 'kolmogorovSmirnov');
    const swEntry = result.tests.find((t) => t.key === 'shapiroWilk');

    expect(ksEntry).toBeDefined();
    expect(swEntry).toBeDefined();
    expect(ksEntry.label).toBe('Kolmogorov-Smirnov');
    expect(swEntry.label).toBe('Shapiro-Wilk');

    // Backward compatibility keys still available
    expect(result.kolmogorovSmirnov).toEqual(calculateKolmogorovSmirnov(values));
    expect(result.shapiroWilk).toEqual(calculateShapiroWilk(values));
  });

  it('marks tests unavailable for insufficient observations', () => {
    const result = runNormalityTests([1, 2], { alpha: 0.01 });

    expect(result.success).toBe(false);
    expect(result.sampleSize).toBe(2);
    expect(result.notes).toContain('Normality tests require at least 3 valid observations.');
    expect(result.tests.every((t) => t.available === false)).toBe(true);
    expect(result.kolmogorovSmirnov).toBeNull();
    expect(result.shapiroWilk).toBeNull();
  });

  it('disables Shapiro-Wilk when sample size exceeds 5000', () => {
    const large = Array.from({ length: 5001 }, (_, i) => i + 1);
    const result = runNormalityTests(large);

    const swEntry = result.tests.find((t) => t.key === 'shapiroWilk');

    expect(swEntry.available).toBe(false);
    expect(swEntry.unavailableReason).toContain('up to 5000');
    expect(result.notes).toContain('Shapiro-Wilk is only reported for sample sizes up to 5000.');
    expect(result.shapiroWilk).toBeNull();
  });
});
