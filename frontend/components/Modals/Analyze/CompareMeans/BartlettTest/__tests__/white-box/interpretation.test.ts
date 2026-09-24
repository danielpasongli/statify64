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
      '<p>Bartlett — &lt;Score&gt;: χ²(2) = 5.123, p = 0.077 ≥ α = 0.050; gagal menolak H₀. Belum terdapat bukti bahwa varians antar kelompok berbeda.</p>',
    );
  });

  it('keeps hypotheses and assumptions in one description', () => {
    expect(buildBartlettDescription([result])).toEqual(expect.arrayContaining([
      '<p><strong>Hipotesis</strong></p>',
      '<p><strong>Interpretasi</strong></p>',
      '<p><strong>Catatan asumsi</strong></p>',
    ]));
  });
});
