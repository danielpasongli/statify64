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

const formatIndonesianDecimal = (value: number, decimals: number): string =>
  value.toFixed(decimals).replace('.', ',');

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
  const independenceInterpretation = pValue === null
    ? `Nilai statistik uji Chi-Square sebesar χ²(${df}) = ${formatNumber(value)}, tetapi p-value tidak tersedia sehingga keputusan uji kebebasan antara ${safeRowName} dan ${safeColumnName} tidak dapat ditentukan.`
    : significant
      ? `Karena nilai statistik uji Chi-Square sebesar χ²(${df}) = ${formatNumber(value)} menghasilkan ${pValue < 0.001 ? 'p-value < 0,001' : `p-value = ${formatIndonesianDecimal(pValue, 3)}`} yang lebih kecil dari tingkat signifikansi yang digunakan (${formatIndonesianDecimal(alpha, 2)}), maka diperoleh keputusan menolak H₀. Dengan demikian dapat disimpulkan bahwa dari data tersebut terdapat hubungan antara ${safeRowName} dan ${safeColumnName}.`
      : `Karena nilai statistik uji Chi-Square sebesar χ²(${df}) = ${formatNumber(value)} menghasilkan p-value = ${formatIndonesianDecimal(pValue, 3)} yang lebih besar atau sama dengan tingkat signifikansi yang digunakan (${formatIndonesianDecimal(alpha, 2)}), maka diperoleh keputusan gagal menolak H₀. Dengan demikian dapat disimpulkan bahwa dari data tersebut tidak terdapat hubungan antara ${safeRowName} dan ${safeColumnName}.`;
  const proportionHypothesis = context === 'binomial'
    ? '<p>H₀: p₁ = p₂ = ⋯ = pₖ — proporsi semua kelompok sama.</p>'
    : '<p>H₀: p₁ⱼ = p₂ⱼ = ⋯ = pₖⱼ untuk setiap kategori j — distribusi proporsi multinomial sama pada seluruh kelompok.</p>';
  const proportionAlternative = context === 'binomial'
    ? '<p>H₁: minimal terdapat satu kelompok memiliki proporsi yang berbeda/tidak semua proporsi sama.</p>'
    : '<p>H₁: minimal terdapat satu kelompok memiliki proporsi yang berbeda/tidak semua proporsi sama.</p>';
  const proportionDecision = pValue === null
    ? `Dalam konteks proporsi ${context}, keputusan uji tidak dapat ditentukan.`
    : significant
      ? context === 'binomial'
        ? `Dalam konteks proporsi binomial, H₀ ditolak. Proporsi ${safeColumnName} berbeda secara signifikan pada minimal satu kelompok ${safeRowName}.`
        : `Dalam konteks proporsi multinomial, H₀ ditolak. Distribusi proporsi ${safeColumnName} berbeda secara signifikan pada minimal satu kelompok ${safeRowName}.`
      : context === 'binomial'
        ? `Dalam konteks proporsi binomial, gagal menolak H₀, artinya belum terdapat bukti bahwa proporsi ${safeColumnName} berbeda antar kelompok ${safeRowName}.`
        : `Dalam konteks proporsi multinomial, gagal menolak H₀, artinya belum terdapat bukti bahwa proporsi ${safeColumnName} berbeda antar kelompok ${safeRowName}.`;

  return [
    '<p><strong>Hipotesis uji kebebasan</strong></p>',
    `<p>H₀: Pᵢⱼ = Pᵢ·P·ⱼ — ${safeRowName} dan ${safeColumnName} saling bebas.</p>`,
    `<p>H₁: ∃ i,j: Pᵢⱼ ≠ Pᵢ·P·ⱼ — ${safeRowName} dan ${safeColumnName} memiliki hubungan.</p>`,
    `<p><strong>Konteks proporsi ${context}</strong></p>`,
    proportionHypothesis,
    proportionAlternative,
    '<p><strong>Interpretasi</strong></p>',
    `<p>${independenceInterpretation}</p>`,
    `<p>${proportionDecision}</p>`,
    `<p>${evaluateExpectedCountAssumption(diagnostics).text}</p>`,
  ];
};
