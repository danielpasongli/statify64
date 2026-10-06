import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CellsTab from '../CellsTab';
import { useMetaStore } from '@/stores/useMetaStore';

// Mock the meta store so we can control whether a weight variable is active
jest.mock('@/stores/useMetaStore');
const mockedUseMetaStore = useMetaStore as unknown as jest.Mock;

// Helper to create a fresh options object for each test
const createDefaultOptions = () => ({
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
});

describe('CellsTab Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Counts, Percentages and Residuals sections', () => {
    mockedUseMetaStore.mockReturnValue({ meta: { weight: null } });
    const setOptions = jest.fn();
    render(<CellsTab options={createDefaultOptions()} setOptions={setOptions} rowVariables={[]} columnVariables={[]} />);

    expect(screen.getByText('Counts')).toBeInTheDocument();
    expect(screen.getByText('Percentages')).toBeInTheDocument();
    expect(screen.getByText('Residuals')).toBeInTheDocument();
  });

  it('does NOT render the "Noninteger Weights" section when no weight variable is active', () => {
    mockedUseMetaStore.mockReturnValue({ meta: { weight: null } });
    const setOptions = jest.fn();
    render(<CellsTab options={createDefaultOptions()} setOptions={setOptions} rowVariables={[]} columnVariables={[]} />);

    expect(screen.queryByText('Noninteger Weights')).not.toBeInTheDocument();
  });

  // Noninteger Weights section telah dihapus, sehingga tidak perlu diuji lagi

  it('calls setOptions when the "Observed" checkbox is toggled', async () => {
    mockedUseMetaStore.mockReturnValue({ meta: { weight: null } });
    const user = userEvent.setup();
    const setOptions = jest.fn();
    render(<CellsTab options={createDefaultOptions()} setOptions={setOptions} rowVariables={[]} columnVariables={[]} />);

    const observedCheckbox = screen.getByLabelText('Observed');
    expect(observedCheckbox).toBeChecked();

    await user.click(observedCheckbox);

    // We expect setOptions to have been called to update the state
    expect(setOptions).toHaveBeenCalled();
  });
}); 