import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NormalityOptions from '@/components/Modals/Analyze/Descriptive/Explore/components/NormalityOptions';

describe('NormalityOptions', () => {
  it('shows requirements and reports checkbox changes', async () => {
    const onCheckedChange = jest.fn();
    const user = userEvent.setup();
    render(<NormalityOptions checked={false} onCheckedChange={onCheckedChange} />);

    await user.hover(screen.getByRole('button', { name: 'Syarat penggunaan uji normalitas' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText(/minimal 3 observasi valid/i)).toBeVisible();

    await user.click(screen.getByLabelText('Normality plots with tests'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
