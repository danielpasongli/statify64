import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChiSquareOptions from '@/components/Modals/Analyze/Descriptive/Crosstabs/components/ChiSquareOptions';

describe('Black-box Tampilan Uji Kategorik', () => {
  it('C-BB-06: menampilkan informasi penggunaan dan menerima pilihan pengguna', async () => {
    const onCheckedChange = jest.fn();
    const onPurposeChange = jest.fn();
    const user = userEvent.setup();
    render(
      <ChiSquareOptions
        checked={false}
        onCheckedChange={onCheckedChange}
        purpose="independence"
        onPurposeChange={onPurposeChange}
        highlighted={false}
      />,
    );

    await user.hover(screen.getByRole('button', { name: 'Informasi penggunaan Chi-Square' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(/binomial\/multinomial/i)).toBeVisible();

    await user.click(screen.getByLabelText('Pearson Chi-Square'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
