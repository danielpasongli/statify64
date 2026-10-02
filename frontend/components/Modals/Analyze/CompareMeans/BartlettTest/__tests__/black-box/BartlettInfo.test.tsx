import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BartlettInfo from '../../components/BartlettInfo';

describe('Black-box Tampilan Uji Bartlett', () => {
  it('B-BB-06: menampilkan syarat penggunaan ketika ikon informasi disorot', async () => {
    render(<BartlettInfo />);
    const user = userEvent.setup();

    await user.hover(screen.getByRole('button', { name: 'Syarat penggunaan uji Bartlett' }));
    const tooltip = await screen.findByRole('tooltip');

    expect(within(tooltip).getByText(/memeriksa apakah varians beberapa kelompok sama atau homogen/i)).toBeVisible();
    expect(within(tooltip).getByText(/variabel yang diuji harus numerik/i)).toBeVisible();
    expect(within(tooltip).getByText(/variabel kelompok harus kategorik dan mempunyai minimal dua kelompok/i)).toBeVisible();
    expect(within(tooltip).getByText(/setiap kelompok sebaiknya berdistribusi normal/i)).toBeVisible();
  });
});
