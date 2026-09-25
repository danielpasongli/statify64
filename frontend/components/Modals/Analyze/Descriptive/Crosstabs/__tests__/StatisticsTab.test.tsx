import React from 'react';
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
    const description = /dibutuhkan minimal 2 variabel bertipe kategorik/i;

    expect(screen.queryByText(description)).not.toBeInTheDocument();

    await user.hover(screen.getByRole('button', { name: 'Informasi penggunaan Chi-Square' }));

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(description)).toBeVisible();
  });
});
