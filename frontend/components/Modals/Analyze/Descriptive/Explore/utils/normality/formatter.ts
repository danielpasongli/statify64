import { DEFAULT_ALPHA } from '@/components/Modals/Analyze/shared/statisticalOutput';
import type { ExploreAnalysisParams } from '../../types';
import type { ColumnHeader, FormattedTable, ExploreAggregatedResults, TableRowData } from '../helpers';
import { getFactorLabel, regroupByDepVar } from '../helpers';
import { buildNormalityDescription, buildNormalityInterpretation } from './interpretation';

const getDisplayName = (
  label: string | undefined,
  name: string | undefined,
  fallback = '',
): string => {
  if (label?.trim()) return label;
  return name ?? fallback;
};

const formatDf = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return String(value);
};

const formatExactNumber = (value: number | null | undefined): string =>
  Number.isFinite(value) ? String(value) : '';

export const formatTestsOfNormalityTable = (
  results: ExploreAggregatedResults,
  params: ExploreAnalysisParams,
): FormattedTable | null => {
  if (!params.showNormalityPlots) return null;

  const hasFactors = params.factorVariables.length > 0 && params.factorVariables.every(v => v !== null);
  const resultsByDepVar = regroupByDepVar(results);
  const rows: TableRowData[] = [];
  const footnotes: string[] = [];
  const interpretations: string[] = [];

  let hasKsValue = false;

  for (const depVarName in resultsByDepVar) {
    const depVarResults = resultsByDepVar[depVarName];
    const depVarLabel = getDisplayName(depVarResults[0]?.variable?.label, depVarName, depVarName);

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
      const alpha = Number.isFinite(normality.alpha) ? normality.alpha : DEFAULT_ALPHA;

      [
        buildNormalityInterpretation('Kolmogorov-Smirnov', subject, ks?.pValue, alpha),
        buildNormalityInterpretation('Shapiro-Wilk', subject, sw?.pValue, alpha),
      ].forEach((interpretation) => {
        if (interpretation) interpretations.push(interpretation);
      });

      rows.push({
        rowHeader,
        ks_statistic: formatExactNumber(ks?.statistic),
        ks_df: formatDf(ks?.df),
        ks_sig: formatExactNumber(ks?.pValue) + (ks?.isLowerBound ? '*' : ''),
        sw_statistic: formatExactNumber(sw?.statistic),
        sw_df: formatDf(sw?.df),
        sw_sig: formatExactNumber(sw?.pValue),
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
      const depVarLabel = getDisplayName(depVar.label, depVar.name);
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
        { header: getDisplayName(params.factorVariables[0]?.label, params.factorVariables[0]?.name), key: 'rowHeader2' },
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
    footnotes.push('a. Lilliefors Significance Correction');
  }

  return {
    title: 'Tests of Normality',
    columnHeaders,
    rows,
    footnotes: buildNormalityDescription(interpretations),
    footer: footnotes.length ? footnotes : undefined,
  };
};
