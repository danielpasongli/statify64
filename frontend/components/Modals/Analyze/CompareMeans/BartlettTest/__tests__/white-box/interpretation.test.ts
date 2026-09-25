import { buildBartlettDescription, buildBartlettInterpretation } from '../../utils/interpretation';
import type { BartlettTestResult } from '../../types';

const result = {
  variable: { name: 'score', label: '<Score>' },
  statistic: 5.123,
  df: 2,
  pValue: 0.077,
} as BartlettTestResult;

describe('Bartlett interpretation', () => {
  it('builds a safe dynamic conclusion', () => {
    expect(buildBartlettInterpretation(result)).toBe(
      '<p>Bartlett <br> &lt;Score&gt;: χ²(2) = 5.123, p-value = 0.077 ≥ α = 0.050; gagal menolak H₀, artinya belum terdapat cukup bukti untuk membuktikan bahwa varians antar kelompok berbeda (varians antar kelompok sama).</p>',
    );
  });

  it('keeps hypotheses and interpretation in one description', () => {
    expect(buildBartlettDescription([result])).toEqual(expect.arrayContaining([
      '<p><strong>Hipotesis</strong></p>',
      '<p><strong>Interpretasi</strong></p>',
    ]));
  });
});
