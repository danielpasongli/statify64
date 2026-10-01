import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChiSquareOptions from '@/components/Modals/Analyze/Descriptive/Crosstabs/components/ChiSquareOptions';

describe('Black-box Tampilan Uji Kategorik', () => {
  it('C-BB-06: menampilkan informasi penggunaan dan menerima pilihan Pearson Chi-Square', async () => {
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
    expect(within(tooltip).getByText(/uji kebebasan memeriksa hubungan antara dua variabel kategorik/i)).toBeVisible();
    expect(within(tooltip).getByText(/uji kesamaan proporsi membandingkan proporsi hasil pada beberapa kelompok/i)).toBeVisible();
    expect(within(tooltip).getByText(/variabel kelompok dan variabel hasil harus kategorik/i)).toBeVisible();
    expect(within(tooltip).getByText(/dua kategori hasil menggunakan binomial/i)).toBeVisible();
    expect(within(tooltip).getByText(/tiga atau lebih kategori hasil menggunakan multinomial/i)).toBeVisible();

    await user.click(screen.getByLabelText('Pearson Chi-Square'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('C-BB-07: menerima pilihan tujuan uji kesamaan proporsi', async () => {
    const onPurposeChange = jest.fn();
    const user = userEvent.setup();
    render(
      <ChiSquareOptions
        checked
        onCheckedChange={jest.fn()}
        purpose="independence"
        onPurposeChange={onPurposeChange}
        highlighted={false}
      />,
    );

    await user.click(screen.getByLabelText('Uji Kesamaan Proporsi'));

    expect(onPurposeChange).toHaveBeenCalledWith('proportion');
  });
});
