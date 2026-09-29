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
  const pText = `p-value = ${String(pValue)} ${significant ? '<' : '≥'} α = ${String(alpha)}`;
  const decision = significant
    ? 'H₀ ditolak, artinya terdapat minimal dua kelompok memiliki varians antar kelompok berbeda.'
    : 'gagal menolak H₀, artinya belum terdapat cukup bukti untuk membuktikan bahwa varians antar kelompok berbeda (varians antar kelompok sama).';

  return `<p>Bartlett <br> ${variableName}: χ²(${String(result.df)}) = ${String(result.statistic)}, ${pText}; ${decision}</p>`;
};

export const buildBartlettDescription = (
  results: BartlettTestResult[],
  alpha = DEFAULT_ALPHA,
): string[] => [
  '<p><strong>Hipotesis</strong></p>',
  '<p>H₀: σ₁² = σ₂² = ⋯ = σₖ² — seluruh kelompok memiliki varians yang sama (homogen).</p>',
  '<p>H₁: ∃ i ≠ j: σᵢ² ≠ σⱼ² — minimal dua kelompok memiliki varians antar kelompok berbeda.</p>',
  '<p><strong>Interpretasi</strong></p>',
  ...results.map(result => buildBartlettInterpretation(result, alpha)).filter((value): value is string => value !== null),
];
