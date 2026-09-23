import type { ExploreAnalysisParams } from '../types';
import type { ColumnHeader, FormattedTable, ExploreAggregatedResults } from './helpers';
import { getFactorLabel, regroupByDepVar } from './helpers';

const formatStatistic = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(3);
};

const formatDf = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(Math.round(value));
};

const formatSig = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (value < 0.001) return '<.001';
  return value.toFixed(3);
};

const formatInterpretation = (
  testName: string,
  subject: string,
  pValue: number | null | undefined,
  alpha: number,
): string | null => {
  if (pValue === null || pValue === undefined || !Number.isFinite(pValue)) return null;

  const significant = pValue < alpha;
  const comparison = significant ? '<' : '≥';
  const decision = significant
    ? 'H₀ ditolak. Data tidak berdistribusi normal.'
    : 'gagal menolak H₀. Tidak terdapat bukti bahwa data menyimpang dari distribusi normal.';

  return `${testName} — ${subject}: p = ${pValue.toFixed(3)} ${comparison} α = ${alpha.toFixed(3)}; ${decision}`;
};

export const formatTestsOfNormalityTable = (
  results: ExploreAggregatedResults,
  params: ExploreAnalysisParams,
): FormattedTable | null => {
  if (!params.showNormalityPlots) return null;

  const hasFactors = params.factorVariables.length > 0 && params.factorVariables.every(v => v !== null);
  const resultsByDepVar = regroupByDepVar(results);
  const rows: any[] = [];
  const footnotes: string[] = [];
  const interpretations: string[] = [];

  let hasKsValue = false;

  for (const depVarName in resultsByDepVar) {
    const depVarResults = resultsByDepVar[depVarName];
    const depVarLabel = depVarResults[0]?.variable?.label || depVarName;

    depVarResults.forEach(result => {
      const normality = result.normalityTests;
      if (!normality) return;

      const ks = normality.kolmogorovSmirnov;
      const sw = normality.shapiroWilk;

      if (ks && Number.isFinite(ks.statistic)) {
        hasKsValue = true;
      }

      const factorLabel = hasFactors
        ? (() => {
            const factorVar = params.factorVariables[0];
            const factorValue = result.factorLevels[factorVar.name];
            return getFactorLabel(factorVar, factorValue);
          })()
        : null;

      const rowHeader = hasFactors
        ? [depVarLabel, factorLabel]
        : [depVarLabel];

      const subject = factorLabel
        ? `${depVarLabel} (kelompok ${factorLabel})`
        : depVarLabel;
      const alpha = Number.isFinite(normality.alpha) ? normality.alpha : 0.05;

      [
        formatInterpretation('Kolmogorov-Smirnov', subject, ks?.pValue, alpha),
        formatInterpretation('Shapiro-Wilk', subject, sw?.pValue, alpha),
      ].forEach((interpretation) => {
        if (interpretation) interpretations.push(interpretation);
      });

      rows.push({
        rowHeader,
        ks_statistic: formatStatistic(ks?.statistic),
        ks_df: formatDf(ks?.df),
        ks_sig: formatSig(ks?.pValue) + (ks?.isLowerBound ? '*' : ''),
        sw_statistic: formatStatistic(sw?.statistic),
        sw_df: formatDf(sw?.df),
        sw_sig: formatSig(sw?.pValue),
      });

      if (ks?.isLowerBound) {
        const footnoteLowerBound = '*. This is a lower bound of the true significance.';
        if (!footnotes.includes(footnoteLowerBound)) {
          footnotes.push(footnoteLowerBound);
        }
      }

      if (Array.isArray(normality.notes)) {
        normality.notes.forEach((note: string) => {
          if (!footnotes.includes(note)) {
            footnotes.push(note);
          }
        });
      }
    });
  }

  if (rows.length === 0) {
    params.dependentVariables.forEach((depVar) => {
      const depVarLabel = depVar.label || depVar.name;
      rows.push({
        rowHeader: hasFactors ? [depVarLabel, null] : [depVarLabel],
        ks_statistic: '',
        ks_df: '',
        ks_sig: '',
        sw_statistic: '',
        sw_df: '',
        sw_sig: '',
      });
    });

    footnotes.push('Normality test results were not returned by the worker for this run. Please rerun analysis after refreshing the page.');
  }

  const columnHeaders: ColumnHeader[] = hasFactors
    ? [
        { header: '', key: 'rowHeader1' },
        { header: params.factorVariables[0]?.label || params.factorVariables[0]?.name || '', key: 'rowHeader2' },
        { header: 'Kolmogorov-Smirnov(a) Statistic', key: 'ks_statistic' },
        { header: 'df', key: 'ks_df' },
        { header: 'Sig.', key: 'ks_sig' },
        { header: 'Shapiro-Wilk Statistic', key: 'sw_statistic' },
        { header: 'df', key: 'sw_df' },
        { header: 'Sig.', key: 'sw_sig' },
      ]
    : [
        { header: '', key: 'rowHeader1' },
        { header: 'Kolmogorov-Smirnov(a) Statistic', key: 'ks_statistic' },
        { header: 'df', key: 'ks_df' },
        { header: 'Sig.', key: 'ks_sig' },
        { header: 'Shapiro-Wilk Statistic', key: 'sw_statistic' },
        { header: 'df', key: 'sw_df' },
        { header: 'Sig.', key: 'sw_sig' },
      ];

  if (hasKsValue) {
    footnotes.unshift('a. Lilliefors Significance Correction');
  }

  return {
    title: 'Tests of Normality',
    columnHeaders,
    rows,
    footnotes: interpretations.length
      ? [
          'H₀: data berdistribusi normal. H₁: data tidak berdistribusi normal.',
          ...interpretations,
        ]
      : undefined,
    footer: footnotes.length ? footnotes : undefined,
  };
};
