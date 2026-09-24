import { DEFAULT_ALPHA, escapeHtml, formatNumber } from '@/components/Modals/Analyze/shared/statisticalOutput';
import type { ExpectedCountDiagnostics } from './validation';
import { evaluateExpectedCountAssumption } from './validation';

export type ProportionContext = 'binomial' | 'multinomial';

export interface ChiSquareInterpretationInput {
  rowName: string;
  columnName: string;
  outcomeCategoryCount: number;
  value: number;
  df: number;
  pValue: number | null;
  diagnostics?: ExpectedCountDiagnostics;
  alpha?: number;
}

export const getProportionContext = (outcomeCategoryCount: number): ProportionContext =>
  outcomeCategoryCount === 2 ? 'binomial' : 'multinomial';

export const buildChiSquareDescription = ({
  rowName,
  columnName,
  outcomeCategoryCount,
  value,
  df,
  pValue,
  diagnostics,
  alpha = DEFAULT_ALPHA,
}: ChiSquareInterpretationInput): string[] => {
  const safeRowName = escapeHtml(rowName);
  const safeColumnName = escapeHtml(columnName);
  const context = getProportionContext(outcomeCategoryCount);
  const significant = pValue !== null && pValue < alpha;
  const pText = pValue === null
    ? 'p-value tidak tersedia'
    : pValue < 0.001
      ? 'p < 0.001'
      : `p = ${pValue.toFixed(3)} ${significant ? '<' : '≥'} α = ${alpha.toFixed(3)}`;
  const independenceDecision = pValue === null
    ? 'Keputusan uji tidak dapat ditentukan.'
    : significant
      ? `H₀ ditolak. Terdapat hubungan yang signifikan antara ${safeRowName} dan ${safeColumnName}.`
      : `gagal menolak H₀. Belum terdapat bukti hubungan yang signifikan antara ${safeRowName} dan ${safeColumnName}.`;
  const proportionHypothesis = context === 'binomial'
    ? '<p>H₀: p₁ = p₂ = ⋯ = pₖ — proporsi hasil binomial sama pada seluruh kelompok.</p>'
    : '<p>H₀: p₁ⱼ = p₂ⱼ = ⋯ = pₖⱼ untuk setiap kategori j — distribusi proporsi multinomial sama pada seluruh kelompok.</p>';
  const proportionAlternative = context === 'binomial'
    ? '<p>H₁: minimal satu kelompok memiliki proporsi hasil binomial yang berbeda.</p>'
    : '<p>H₁: minimal satu kelompok memiliki distribusi proporsi multinomial yang berbeda.</p>';
  const proportionDecision = pValue === null
    ? `Dalam konteks proporsi ${context}, keputusan uji tidak dapat ditentukan.`
    : significant
      ? context === 'binomial'
        ? `Dalam konteks proporsi binomial, H₀ ditolak. Proporsi ${safeColumnName} berbeda secara signifikan pada minimal satu kelompok ${safeRowName}.`
        : `Dalam konteks proporsi multinomial, H₀ ditolak. Distribusi proporsi ${safeColumnName} berbeda secara signifikan pada minimal satu kelompok ${safeRowName}.`
      : context === 'binomial'
        ? `Dalam konteks proporsi binomial, gagal menolak H₀. Belum terdapat bukti bahwa proporsi ${safeColumnName} berbeda antar kelompok ${safeRowName}.`
        : `Dalam konteks proporsi multinomial, gagal menolak H₀. Belum terdapat bukti bahwa distribusi proporsi ${safeColumnName} berbeda antar kelompok ${safeRowName}.`;

  return [
    '<p><strong>Hipotesis uji kebebasan</strong></p>',
    `<p>H₀: Pᵢⱼ = Pᵢ·P·ⱼ — ${safeRowName} dan ${safeColumnName} saling bebas.</p>`,
    `<p>H₁: ∃ i,j: Pᵢⱼ ≠ Pᵢ·P·ⱼ — ${safeRowName} dan ${safeColumnName} memiliki hubungan.</p>`,
    `<p><strong>Konteks proporsi ${context}</strong></p>`,
    proportionHypothesis,
    proportionAlternative,
    '<p><strong>Interpretasi</strong></p>',
    `<p>Pearson Chi-Square: χ²(${df}) = ${formatNumber(value)}, ${pText}; ${independenceDecision}</p>`,
    `<p>${proportionDecision}</p>`,
    `<p>${evaluateExpectedCountAssumption(diagnostics).text}</p>`,
  ];
};
