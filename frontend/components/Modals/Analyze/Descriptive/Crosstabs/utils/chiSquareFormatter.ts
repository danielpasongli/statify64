import type { CrosstabsAnalysisParams, CrosstabsWorkerResult } from '../types';
import type { ColumnHeader, FormattedTable, TableRowData } from './helpers';

const formatNumber = (value: number, decimals = 3): string => {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(decimals);
};

const formatPValue = (value: number | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value < 0.001) return '<.001';
  return value.toFixed(3);
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
}[character] as string));

export const formatChiSquareTestsTable = (
  result: CrosstabsWorkerResult,
  params: CrosstabsAnalysisParams,
): FormattedTable | null => {
  if (!params.options.statistics?.chiSquare) return null;

  const pearson = result?.chiSquare?.pearson;
  if (!pearson) return null;

  const columnHeaders: ColumnHeader[] = [
    { header: '', key: 'rh1' },
    { header: 'Value', key: 'value' },
    { header: 'df', key: 'df' },
    { header: 'Asymp. Sig. (2-sided)', key: 'sig' },
  ];

  const rows: TableRowData[] = [
    // Baris 1: Pearson Chi-Square
    {
      rowHeader: ['Pearson Chi-Square'],
      value: formatNumber(pearson.value, 3),
      df: String(pearson.df),
      sig: formatPValue(pearson.pValue),
    },
    // Baris 2: N of Valid Cases — selalu ditampilkan seperti output SPSS,
    // kolom df dan Sig. dibiarkan kosong (tidak relevan untuk baris ini)
    {
      rowHeader: ['N of Valid Cases'],
      value: String(result.summary?.valid ?? ''),
      df: '',
      sig: '',
    },
  ];

  const diagnostics = pearson.expectedDiagnostics;
  const footnotes: string[] = [];
  if (diagnostics) {
    footnotes.push(
      `${diagnostics.cellsUnder5} cells (${formatNumber(diagnostics.percentCellsUnder5, 1)}%) have expected count less than 5.`
    );

    if (diagnostics.minExpectedCount !== null) {
      footnotes.push(`The minimum expected count is ${formatNumber(diagnostics.minExpectedCount, 2)}.`);
    }
  }

  const rowName = escapeHtml(params.rowVariables[0]?.label || params.rowVariables[0]?.name || 'variabel baris');
  const columnName = escapeHtml(params.columnVariables[0]?.label || params.columnVariables[0]?.name || 'variabel kolom');
  const outcomeCategoryCount = result.summary?.colCategories?.length ?? 0;
  const isBinomial = outcomeCategoryCount === 2;
  const contextName = isBinomial ? 'binomial' : 'multinomial';
  const pValue = pearson.pValue;
  const significant = pValue !== null && pValue < 0.05;
  const pText = pValue === null
    ? 'p-value tidak tersedia'
    : pValue < 0.001
      ? 'p < 0.001'
      : `p = ${pValue.toFixed(3)} ${significant ? '<' : '≥'} α = 0.050`;
  const independenceDecision = pValue === null
    ? 'Keputusan uji tidak dapat ditentukan.'
    : significant
      ? `H₀ ditolak. Terdapat hubungan yang signifikan antara ${rowName} dan ${columnName}.`
      : `gagal menolak H₀. Belum terdapat bukti hubungan yang signifikan antara ${rowName} dan ${columnName}.`;
  const proportionHypothesis = isBinomial
    ? '<p>H₀: p₁ = p₂ = ⋯ = pₖ — proporsi hasil binomial sama pada seluruh kelompok.</p>'
    : '<p>H₀: p₁ⱼ = p₂ⱼ = ⋯ = pₖⱼ untuk setiap kategori j — distribusi proporsi multinomial sama pada seluruh kelompok.</p>';
  const proportionAlternative = isBinomial
    ? '<p>H₁: minimal satu kelompok memiliki proporsi hasil binomial yang berbeda.</p>'
    : '<p>H₁: minimal satu kelompok memiliki distribusi proporsi multinomial yang berbeda.</p>';
  const proportionDecision = pValue === null
    ? `Dalam konteks proporsi ${contextName}, keputusan uji tidak dapat ditentukan.`
    : significant
      ? isBinomial
        ? `Dalam konteks proporsi binomial, H₀ ditolak. Proporsi ${columnName} berbeda secara signifikan pada minimal satu kelompok ${rowName}.`
        : `Dalam konteks proporsi multinomial, H₀ ditolak. Distribusi proporsi ${columnName} berbeda secara signifikan pada minimal satu kelompok ${rowName}.`
      : isBinomial
        ? `Dalam konteks proporsi binomial, gagal menolak H₀. Belum terdapat bukti bahwa proporsi ${columnName} berbeda antar kelompok ${rowName}.`
        : `Dalam konteks proporsi multinomial, gagal menolak H₀. Belum terdapat bukti bahwa distribusi proporsi ${columnName} berbeda antar kelompok ${rowName}.`;
  const assumptionText = diagnostics && diagnostics.minExpectedCount !== null && diagnostics.minExpectedCount > 0 && diagnostics.percentCellsUnder5 <= 20
    ? 'Syarat expected count terpenuhi: seluruh expected count lebih dari nol dan maksimal 20% sel memiliki expected count kurang dari 5.'
    : 'Syarat expected count tidak terpenuhi. Tafsirkan hasil dengan hati-hati dan pertimbangkan menggabungkan kategori atau menggunakan uji exact.';

  const description = [
    '<p><strong>Hipotesis uji kebebasan</strong></p>',
    `<p>H₀: Pᵢⱼ = Pᵢ·P·ⱼ — ${rowName} dan ${columnName} saling bebas.</p>`,
    `<p>H₁: ∃ i,j: Pᵢⱼ ≠ Pᵢ·P·ⱼ — ${rowName} dan ${columnName} memiliki hubungan.</p>`,
    `<p><strong>Konteks proporsi ${contextName}</strong></p>`,
    proportionHypothesis,
    proportionAlternative,
    '<p><strong>Interpretasi</strong></p>',
    `<p>Pearson Chi-Square: χ²(${pearson.df}) = ${formatNumber(pearson.value, 3)}, ${pText}; ${independenceDecision}</p>`,
    `<p>${proportionDecision}</p>`,
    `<p>${assumptionText}</p>`,
  ];

  return {
    title: 'Chi-Square Tests',
    columnHeaders,
    rows,
    footer: footnotes.length > 0 ? footnotes : undefined,
    description,
  };
};
