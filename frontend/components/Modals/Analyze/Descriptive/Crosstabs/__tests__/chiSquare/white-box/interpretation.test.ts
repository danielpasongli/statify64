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
    expect(description.join(' ')).toContain('terdapat hubungan antara Kelompok dan Pilihan');
    expect(description.join(' ')).toContain('Konteks proporsi binomial');
    expect(description.join(' ')).toContain('terdapat cukup bukti untuk menyatakan bahwa proporsi Pilihan antar kelompok Kelompok berbeda');
  });

  it('explains a non-significant independence result as cause, decision, and conclusion', () => {
    const description = buildChiSquareDescription({
      ...baseInput,
      rowName: 'Tingkat pendidikan',
      columnName: 'Lama waktu mencari pekerjaan',
      value: 8.25,
      df: 4,
      pValue: 0.083,
      outcomeCategoryCount: 3,
    });

    expect(description.join(' ')).toContain(
      'Karena nilai statistik uji Chi-Square sebesar χ²(4) = 8.250 menghasilkan p-value = 0,083 yang lebih besar atau sama dengan tingkat signifikansi yang digunakan (0,05), maka diperoleh keputusan gagal menolak H₀. Dengan demikian dapat disimpulkan bahwa dari data tersebut tidak terdapat hubungan antara Tingkat pendidikan dan Lama waktu mencari pekerjaan.',
    );
  });

  it('explains a non-significant multinomial proportion result using its critical value', () => {
    const description = buildChiSquareDescription({
      ...baseInput,
      rowName: 'Desa',
      columnName: 'Kemiskinan',
      value: 0.09,
      df: 3,
      pValue: 0.993,
      sampleSize: 120,
      outcomeCategoryCount: 4,
    });

    expect(description.join(' ')).toContain(
      'Nilai statistik Pearson Chi-Square pada output menunjukkan angka 0,090. Nilai statistik tersebut lebih kecil daripada nilai kritis χ²<sub>0,05;3</sub> sebesar 7,815. Hal ini menunjukkan bahwa diperoleh keputusan gagal menolak H₀. Dengan demikian dapat disimpulkan bahwa pada tingkat signifikansi 5% dan jumlah sampel sebanyak 120 yang digunakan, belum cukup bukti untuk menyatakan bahwa proporsi Kemiskinan antar kelompok Desa berbeda.',
    );
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
