import { DEFAULT_ALPHA, escapeHtml } from '@/components/Modals/Analyze/shared/statisticalOutput';

export const buildNormalityInterpretation = (
  testName: string,
  subject: string,
  pValue: number | null | undefined,
  alpha = DEFAULT_ALPHA,
): string | null => {
  if (!Number.isFinite(pValue)) return null;

  const safeTestName = escapeHtml(testName);
  const safeSubject = escapeHtml(subject);
  const numericPValue = pValue as number;
  const significant = numericPValue < alpha;
  const decision = significant
    ? 'H₀ ditolak. Data tidak berdistribusi normal.'
    : 'gagal menolak H₀. Tidak terdapat bukti bahwa data menyimpang dari distribusi normal.';

  return `${safeTestName} — ${safeSubject}: p = ${numericPValue.toFixed(3)} ${significant ? '<' : '≥'} α = ${alpha.toFixed(3)}; ${decision}`;
};

export const buildNormalityDescription = (interpretations: string[]): string[] | undefined => {
  if (interpretations.length === 0) return undefined;

  return [
    '<p><strong>Hipotesis</strong></p>',
    '<p>H₀: X ∼ N(μ, σ²) — data berdistribusi normal.</p>',
    '<p>H₁: X ≁ N(μ, σ²) — data tidak berdistribusi normal.</p>',
    '<p><strong>Interpretasi</strong></p>',
    ...interpretations.map(interpretation => `<p>${interpretation}</p>`),
  ];
};
