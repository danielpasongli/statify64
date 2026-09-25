import { buildNormalityDescription, buildNormalityInterpretation } from '@/components/Modals/Analyze/Descriptive/Explore/utils/normality/interpretation';

describe('normality interpretation', () => {
  it('builds a fail-to-reject conclusion at the alpha boundary', () => {
    expect(buildNormalityInterpretation('Shapiro-Wilk', 'Pendapatan', 0.05, 0.05)).toBe(
      'Shapiro-Wilk — Pendapatan: p-value = 0.050 ≥ α = 0.050; gagal menolak H₀, artinya tidak terdapat cukup bukti untuk membuktikan bahwa data tidak berdistribusi normal (data berdistribusi normal).',
    );
  });

  it('omits conclusions when the test was not computed', () => {
    expect(buildNormalityInterpretation('Shapiro-Wilk', 'Pendapatan', null, 0.05)).toBeNull();
  });

  it('returns structured hypotheses and escaped interpretations', () => {
    const description = buildNormalityDescription([
      'Shapiro-Wilk — &lt;Pendapatan&gt;: p = 0.010 < α = 0.050; H₀ ditolak.',
    ]);

    expect(description).toEqual([
      '<p><strong>Hipotesis</strong></p>',
      '<p>H₀: X ∼ N(μ, σ²) — data berdistribusi normal.</p>',
      '<p>H₁: X ≁ N(μ, σ²) — data tidak berdistribusi normal.</p>',
      '<p><strong>Interpretasi</strong></p>',
      '<p>Shapiro-Wilk — &lt;Pendapatan&gt;: p = 0.010 < α = 0.050; H₀ ditolak.</p>',
    ]);
  });
});
