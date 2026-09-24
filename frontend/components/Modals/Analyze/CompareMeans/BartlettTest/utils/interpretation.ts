import { DEFAULT_ALPHA, escapeHtml } from '@/components/Modals/Analyze/shared/statisticalOutput';
import type { BartlettTestResult } from '../types';

export const buildBartlettInterpretation = (
  result: BartlettTestResult,
  alpha = DEFAULT_ALPHA,
): string | null => {
  if (!result.variable || !Number.isFinite(result.statistic) || !Number.isFinite(result.df) || !Number.isFinite(result.pValue)) {
    return null;
  }

  const variableLabel = result.variable.label?.trim();
  let rawVariableName = result.variable.name ?? 'Unknown';
  if (variableLabel) rawVariableName = variableLabel;
  const variableName = escapeHtml(rawVariableName);
  const pValue = result.pValue as number;
  const significant = pValue < alpha;
  const pText = pValue < 0.001
    ? 'p < 0.001'
    : `p = ${pValue.toFixed(3)} ${significant ? '<' : '≥'} α = ${alpha.toFixed(3)}`;
  const decision = significant
    ? 'H₀ ditolak. Varians antar kelompok berbeda secara signifikan.'
    : 'gagal menolak H₀. Belum terdapat bukti bahwa varians antar kelompok berbeda.';

  return `<p>Bartlett — ${variableName}: χ²(${Math.round(result.df as number)}) = ${(result.statistic as number).toFixed(3)}, ${pText}; ${decision}</p>`;
};

export const buildBartlettDescription = (
  results: BartlettTestResult[],
  alpha = DEFAULT_ALPHA,
): string[] => [
  '<p><strong>Hipotesis</strong></p>',
  '<p>H₀: σ₁² = σ₂² = ⋯ = σₖ² — seluruh kelompok memiliki varians yang sama (homogen).</p>',
  '<p>H₁: ∃ i ≠ j: σᵢ² ≠ σⱼ² — minimal dua kelompok memiliki varians berbeda.</p>',
  '<p><strong>Interpretasi</strong></p>',
  ...results.map(result => buildBartlettInterpretation(result, alpha)).filter((value): value is string => value !== null),
  '<p><strong>Catatan asumsi</strong></p>',
  '<p>Uji Bartlett mengasumsikan data dalam setiap kelompok berdistribusi normal dan sensitif terhadap pelanggaran normalitas.</p>',
];
