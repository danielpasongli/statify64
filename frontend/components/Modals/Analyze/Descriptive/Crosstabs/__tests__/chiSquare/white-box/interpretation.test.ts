import { buildChiSquareDescription, getProportionContext } from '@/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquare/interpretation';

const baseInput = {
  rowName: 'Kelompok',
  columnName: 'Pilihan',
  value: 6.25,
  df: 2,
  pValue: 0.044,
  diagnostics: {
    minExpectedCount: 5,
    cellsUnder5: 0,
    totalCells: 6,
    percentCellsUnder5: 0,
  },
};

describe('Chi-Square interpretation', () => {
  it('distinguishes binomial and multinomial outcomes', () => {
    expect(getProportionContext(2)).toBe('binomial');
    expect(getProportionContext(3)).toBe('multinomial');
  });

  it('builds independence and binomial conclusions from one Pearson result', () => {
    const description = buildChiSquareDescription({ ...baseInput, outcomeCategoryCount: 2 });
    expect(description.join(' ')).toContain('Kelompok dan Pilihan memiliki hubungan');
    expect(description.join(' ')).toContain('Konteks proporsi binomial');
    expect(description.join(' ')).toContain('Proporsi Pilihan berbeda secara signifikan');
  });

  it('escapes variable labels inserted into HTML', () => {
    const description = buildChiSquareDescription({
      ...baseInput,
      rowName: '<Kelompok>',
      outcomeCategoryCount: 3,
    });
    expect(description.join(' ')).toContain('&lt;Kelompok&gt;');
    expect(description.join(' ')).not.toContain('<Kelompok>');
  });
});
