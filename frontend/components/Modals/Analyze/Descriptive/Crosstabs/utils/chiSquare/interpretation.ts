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
  sampleSize?: number;
  diagnostics?: ExpectedCountDiagnostics;
  alpha?: number;
}

export const getProportionContext = (outcomeCategoryCount: number): ProportionContext =>
  outcomeCategoryCount === 2 ? 'binomial' : 'multinomial';

const formatIndonesianDecimal = (value: number, decimals: number): string =>
  value.toFixed(decimals).replace('.', ',');

const logGamma = (value: number): number => {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const z = value - 1;
  const sum = coefficients.reduce((acc, coefficient, index) => acc + coefficient / (z + index + 1), 0.9999999999998099);
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
};

const regularizedGammaP = (shape: number, value: number): number => {
  if (value === 0) return 0;
  if (value < shape + 1) {
    let sum = 1 / shape;
    let term = sum;
    for (let index = 1; index < 1000; index += 1) {
      term *= value / (shape + index);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
  }

  let offset = value + 1 - shape;
  let previous = 1e30;
  let current = 1 / offset;
  let fraction = current;
  for (let index = 1; index < 1000; index += 1) {
    const numerator = -index * (index - shape);
    offset += 2;
    current = numerator * current + offset;
    if (Math.abs(current) < 1e-30) current = 1e-30;
    previous = offset + numerator / previous;
    if (Math.abs(previous) < 1e-30) previous = 1e-30;
    current = 1 / current;
    const delta = current * previous;
    fraction *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-value + shape * Math.log(value) - logGamma(shape)) * fraction;
};

const chiSquareCriticalValue = (df: number, alpha: number): number => {
  const target = 1 - alpha;
  const cdf = (value: number): number => regularizedGammaP(df / 2, value / 2);
  let lower = 0;
  let upper = Math.max(1, df);
  while (cdf(upper) < target) upper *= 2;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (cdf(midpoint) < target) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
};

export const buildChiSquareDescription = ({
  rowName,
  columnName,
  outcomeCategoryCount,
  value,
  df,
  pValue,
  sampleSize,
  diagnostics,
  alpha = DEFAULT_ALPHA,
}: ChiSquareInterpretationInput): string[] => {
  const safeRowName = escapeHtml(rowName);
  const safeColumnName = escapeHtml(columnName);
  const context = getProportionContext(outcomeCategoryCount);
  const significant = pValue !== null && pValue < alpha;
  const criticalValue = chiSquareCriticalValue(df, alpha);
  const alphaPercent = formatIndonesianDecimal(alpha * 100, Number.isInteger(alpha * 100) ? 0 : 1);
  const sampleText = Number.isFinite(sampleSize)
    ? `jumlah sampel sebanyak ${sampleSize} yang digunakan`
    : 'jumlah sampel yang digunakan';
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
      ? `Nilai statistik Pearson Chi-Square pada output menunjukkan angka ${formatIndonesianDecimal(value, 3)}. Nilai statistik tersebut lebih besar daripada nilai kritis χ²<sub>${formatIndonesianDecimal(alpha, 2)};${df}</sub> sebesar ${formatIndonesianDecimal(criticalValue, 3)}. Hal ini menunjukkan bahwa diperoleh keputusan menolak H₀. Dengan demikian dapat disimpulkan bahwa pada tingkat signifikansi ${alphaPercent}% dan ${sampleText}, terdapat cukup bukti untuk menyatakan bahwa proporsi ${safeColumnName} antar kelompok ${safeRowName} berbeda.`
      : `Nilai statistik Pearson Chi-Square pada output menunjukkan angka ${formatIndonesianDecimal(value, 3)}. Nilai statistik tersebut lebih kecil daripada nilai kritis χ²<sub>${formatIndonesianDecimal(alpha, 2)};${df}</sub> sebesar ${formatIndonesianDecimal(criticalValue, 3)}. Hal ini menunjukkan bahwa diperoleh keputusan gagal menolak H₀. Dengan demikian dapat disimpulkan bahwa pada tingkat signifikansi ${alphaPercent}% dan ${sampleText}, belum cukup bukti untuk menyatakan bahwa proporsi ${safeColumnName} antar kelompok ${safeRowName} berbeda.`;

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
