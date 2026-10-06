import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatisticsTab from '../StatisticsTab';

const options = {
  statistics: { chiSquare: false },
  cells: {
    observed: true,
    expected: false,
    row: false,
    column: false,
    total: false,
    hideSmallCounts: false,
    hideSmallCountsThreshold: 5,
  },
  residuals: {
    unstandardized: false,
    standardized: false,
    adjustedStandardized: false,
  },
  nonintegerWeights: 'roundCell' as const,
};

describe('StatisticsTab', () => {
  it('shows the Chi-Square usage description only in the information tooltip', async () => {
    render(<StatisticsTab options={options} setOptions={jest.fn()} />);
    const user = userEvent.setup();
    const description = /Variabel kelompok dan variabel hasil harus kategorik/i;

    expect(screen.queryByText(description)).not.toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'Informasi penggunaan Chi-Square' }));

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(description)).toBeVisible();
  });

  it('menampilkan pilihan tujuan setelah Pearson Chi-Square dipilih', async () => {
    const user = userEvent.setup();

    const TestHarness = () => {
      const [currentOptions, setCurrentOptions] = useState(options);
      return <StatisticsTab options={currentOptions} setOptions={setCurrentOptions} />;
    };

    render(<TestHarness />);

    expect(screen.queryByRole('radiogroup', { name: 'Tujuan Pengujian' })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Pearson Chi-Square'));

    expect(screen.getByRole('radio', { name: 'Uji Kebebasan' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Uji Kesamaan Proporsi' })).not.toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Uji Kesamaan Proporsi' }));

    expect(screen.getByRole('radio', { name: 'Uji Kesamaan Proporsi' })).toBeChecked();
    expect(screen.getByText(/binomial atau multinomial ditentukan otomatis/i)).toBeVisible();
  });
});
