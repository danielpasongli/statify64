import React from 'react';
import { render, screen, within } from '@testing-library/react';
import ModalRenderer from '@/components/Modals/ModalRenderer';
import { ModalType } from '@/types/modalTypes';

jest.mock('@/hooks/useMobile', () => ({
  useMobile: () => ({ isMobile: false }),
}));

jest.mock('@/components/Modals/ModalRegistry', () => ({
  getModalComponent: () => () => <div>Konten Bartlett</div>,
  getModalContainerType: () => 'sidebar',
}));

describe('Black-box Header Sidebar Bartlett', () => {
  it('B-BB-07: menampilkan ikon informasi di sebelah judul Bartlett Test', async () => {
    render(
      <ModalRenderer
        modalType={ModalType.BartlettTest}
        onClose={jest.fn()}
        containerType="sidebar"
      />,
    );

    const title = await screen.findByTestId('modal-title');
    const header = title.parentElement?.parentElement;

    expect(title).toHaveTextContent('Bartlett Test');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole('button', {
      name: 'Syarat penggunaan uji Bartlett',
    })).toBeVisible();
  });
});
