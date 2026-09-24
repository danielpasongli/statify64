import type { CrosstabsWorkerResult } from '../../types';

export type ExpectedCountDiagnostics = NonNullable<
  NonNullable<CrosstabsWorkerResult['chiSquare']>['pearson']['expectedDiagnostics']
>;

export interface ExpectedCountAssessment {
  valid: boolean;
  text: string;
}

export const evaluateExpectedCountAssumption = (
  diagnostics: ExpectedCountDiagnostics | undefined,
): ExpectedCountAssessment => {
  const valid = Boolean(
    diagnostics
      && diagnostics.minExpectedCount !== null
      && diagnostics.minExpectedCount > 0
      && diagnostics.percentCellsUnder5 <= 20,
  );

  return {
    valid,
    text: valid
      ? 'Syarat expected count terpenuhi: seluruh expected count lebih dari nol dan maksimal 20% sel memiliki expected count kurang dari 5.'
      : 'Syarat expected count tidak terpenuhi. Tafsirkan hasil dengan hati-hati dan pertimbangkan menggabungkan kategori atau menggunakan uji exact.',
  };
};
