import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChiSquareOptions from '@/components/Modals/Analyze/Descriptive/Crosstabs/components/ChiSquareOptions';

describe('ChiSquareOptions', () => {
  it('shows usage information and reports checkbox changes', async () => {
    const onCheckedChange = jest.fn();
    const user = userEvent.setup();
    render(<ChiSquareOptions checked={false} onCheckedChange={onCheckedChange} highlighted={false} />);

    await user.hover(screen.getByRole('button', { name: 'Informasi penggunaan Chi-Square' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(/binomial\/multinomial/i)).toBeVisible();

    await user.click(screen.getByLabelText('Pearson Chi-Square'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
