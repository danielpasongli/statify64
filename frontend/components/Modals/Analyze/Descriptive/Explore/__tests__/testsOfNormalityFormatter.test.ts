import { formatTestsOfNormalityTable } from '../utils/normality/formatter';
import type { ExploreAnalysisParams } from '../types';

const baseParams: ExploreAnalysisParams = {
  dependentVariables: [{ name: 'x1', label: 'X1', columnIndex: 0, type: 'NUMERIC', measure: 'scale' } as any],
  factorVariables: [],
  labelVariable: null,
  confidenceInterval: '95',
  showDescriptives: true,
  showMEstimators: false,
  showOutliers: false,
  showPercentiles: false,
  boxplotType: 'none',
  showStemAndLeaf: false,
  showHistogram: false,
  showNormalityPlots: true,
};

describe('formatTestsOfNormalityTable', () => {
  it('returns null when normality option is disabled', () => {
    const table = formatTestsOfNormalityTable({}, { ...baseParams, showNormalityPlots: false });
    expect(table).toBeNull();
  });

  it('formats tests of normality table with KS and SW values', () => {
    const results: any = {
      all_data: {
        factorLevels: {},
        results: [
          {
            variable: { name: 'x1', label: 'X1' },
            normalityTests: {
              sampleSize: 20,
              kolmogorovSmirnov: { statistic: 0.12345, df: 20, pValue: 0.0004, isLowerBound: true },
              shapiroWilk: { statistic: 0.9788, df: 20, pValue: 0.321 },
            },
          },
        ],
      },
    };

    const table = formatTestsOfNormalityTable(results, baseParams);
    expect(table).not.toBeNull();
    expect(table?.title).toBe('Tests of Normality');
    expect(table?.rows).toHaveLength(1);
    expect(table?.rows[0].ks_statistic).toBe('0.123');
    expect(table?.rows[0].ks_sig).toBe('<.001*');
    expect(table?.rows[0].sw_statistic).toBe('0.979');
    expect(table?.rows[0].sw_sig).toBe('0.321');
    expect(table?.footer).toEqual([
      '*. This is a lower bound of the true significance.',
      'a. Lilliefors Significance Correction',
    ]);
  });

  it('adds a separate dynamic interpretation for each normality test', () => {
    const results: any = {
      all_data: {
        factorLevels: {},
        results: [
          {
            variable: { name: 'x1', label: 'Pendapatan' },
            normalityTests: {
              alpha: 0.01,
              kolmogorovSmirnov: { statistic: 0.12, df: 20, pValue: 0.02 },
              shapiroWilk: { statistic: 0.91, df: 20, pValue: 0.009 },
            },
          },
        ],
      },
    };

    const table = formatTestsOfNormalityTable(results, baseParams);

    expect(table?.footnotes).toEqual(expect.arrayContaining([
      '<p><strong>Hipotesis</strong></p>',
      '<p>H₀: X ∼ N(μ, σ²) — data berdistribusi normal.</p>',
      '<p>H₁: X ≁ N(μ, σ²) — data tidak berdistribusi normal.</p>',
      '<p><strong>Interpretasi</strong></p>',
      '<p>Kolmogorov-Smirnov — Pendapatan: p-value = 0.020 ≥ α = 0.010; gagal menolak H₀, artinya tidak terdapat cukup bukti untuk membuktikan bahwa data tidak berdistribusi normal (data berdistribusi normal).</p>',
      '<p>Shapiro-Wilk — Pendapatan: p-value = 0.009 < α = 0.010; H₀ ditolak, artinya data tidak berdistribusi normal.</p>',
    ]));
  });

  it('does not create a conclusion for a test that was not computed', () => {
    const results: any = {
      all_data: {
        factorLevels: {},
        results: [
          {
            variable: { name: 'x1', label: 'Pendapatan' },
            normalityTests: {
              alpha: 0.05,
              kolmogorovSmirnov: { statistic: 0.12, df: 6001, pValue: 0.2 },
              shapiroWilk: null,
              notes: ['Shapiro-Wilk is only reported for sample sizes up to 5000.'],
            },
          },
        ],
      },
    };

    const table = formatTestsOfNormalityTable(results, baseParams);

    expect(table?.footnotes).toHaveLength(5);
    expect(table?.footnotes?.join(' ')).not.toContain('Shapiro-Wilk —');
  });
});
