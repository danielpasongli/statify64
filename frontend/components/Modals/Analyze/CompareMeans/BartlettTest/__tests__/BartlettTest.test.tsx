import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BartlettTest from '../index';
import {
    useVariableSelection,
    useTestSettings,
    useBartlettAnalysis,
    useTourGuide,
} from '../hooks';
import { BaseModalProps } from '@/types/modalTypes';
import { Variable } from '@/types/Variable';

// Mock the custom hooks module
jest.mock('../hooks');

// Mock useVariableStore
jest.mock('@/stores/useVariableStore', () => ({
    useVariableStore: jest.fn((selector) => selector({
        isLoading: false,
        error: null,
    })),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
    }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
    toast: {
        error: jest.fn(),
        success: jest.fn(),
        info: jest.fn(),
    },
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    Loader2: ({ className }: { className?: string }) => (
        <div data-testid="loader-icon" className={className}>Loader2</div>
    ),
    HelpCircle: ({ className }: { className?: string }) => (
        <div data-testid="help-circle-icon" className={className}>HelpCircle</div>
    ),
    InfoIcon: ({ className }: { className?: string }) => (
        <div data-testid="info-icon" className={className}>InfoIcon</div>
    ),
}));

// Mock framer-motion
jest.mock('framer-motion', () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    },
}));

// Mock TourPopup component
jest.mock('@/components/Common/TourComponents', () => ({
    TourPopup: () => <div data-testid="tour-popup">Tour Popup</div>,
}));

// Mock child components
jest.mock('../components/VariablesTab', () => ({
    __esModule: true,
    default: ({
        availableVariables,
        testVariables,
        factorVariable,
    }: {
        availableVariables: Variable[],
        testVariables: Variable[],
        factorVariable: Variable | null,
    }) => (
        <div data-testid="variables-tab">
            <div>Variables: {availableVariables.length}</div>
            <div>Test Variables: {testVariables.length}</div>
            <div>Factor Variable: {factorVariable?.name || 'None'}</div>
        </div>
    ),
}));

jest.mock('../components/OptionsTab', () => ({
    __esModule: true,
    default: ({
        options,
    }: {
        options: { confidenceLevel: number; includeDescriptives: boolean };
    }) => (
        <div data-testid="options-tab">
            <div>Confidence Level: {options.confidenceLevel}</div>
            <div>Include Descriptives: {options.includeDescriptives ? 'Yes' : 'No'}</div>
        </div>
    ),
}));

describe('BartlettTest Component', () => {
    // Mock implementations
    const mockOnClose = jest.fn();
    const mockRunAnalysis = jest.fn();
    const mockCancelCalculation = jest.fn();
    const mockResetVariableSelection = jest.fn();
    const mockResetSettings = jest.fn();

    const defaultProps: BaseModalProps = {
        onClose: mockOnClose,
        containerType: 'dialog',
    };

    const mockTestVariables: Variable[] = [
        {
            tempId: 'var1',
            columnIndex: 0,
            name: 'score',
            type: 'NUMERIC',
            width: 8,
            decimals: 2,
            label: 'Test Score',
            values: [],
            missing: null,
            columns: 64,
            align: 'right',
            measure: 'scale',
            role: 'input',
        },
    ];

    const mockFactorVariable: Variable = {
        tempId: 'var2',
        columnIndex: 1,
        name: 'group',
        type: 'NUMERIC',
        width: 8,
        decimals: 0,
        label: 'Group',
        values: [],
        missing: null,
        columns: 64,
        align: 'right',
        measure: 'nominal',
        role: 'input',
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup hook mocks
        (useVariableSelection as jest.Mock).mockReturnValue({
            availableVariables: [],
            testVariables: mockTestVariables,
            factorVariable: mockFactorVariable,
            highlightedVariable: null,
            setHighlightedVariable: jest.fn(),
            moveToTestVariables: jest.fn(),
            moveToFactorVariable: jest.fn(),
            moveToAvailableVariables: jest.fn(),
            reorderVariables: jest.fn(),
            resetVariableSelection: mockResetVariableSelection,
        });

        (useTestSettings as jest.Mock).mockReturnValue({
            options: {
                confidenceLevel: 0.95,
                includeDescriptives: true,
            },
            updateOption: jest.fn(),
            resetSettings: mockResetSettings,
        });

        (useBartlettAnalysis as jest.Mock).mockReturnValue({
            isCalculating: false,
            errorMsg: null,
            runAnalysis: mockRunAnalysis,
            cancelCalculation: mockCancelCalculation,
        });

        // Mock useTourGuide
        (useTourGuide as jest.Mock).mockReturnValue({
            tourActive: false,
            currentStep: 0,
            steps: [],
            targetElements: {},
            startTour: jest.fn(),
            endTour: jest.fn(),
            nextStep: jest.fn(),
            prevStep: jest.fn(),
        });
    });

    describe('Rendering', () => {
        it('renders the dialog with title', () => {
            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByText(/Bartlett.*Test.*Homogeneity.*Variances/i)).toBeInTheDocument();
        });

        it('shows Bartlett usage requirements in the information tooltip', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            await user.hover(screen.getByRole('button', { name: 'Syarat penggunaan uji Bartlett' }));

            const tooltip = await screen.findByRole('tooltip');
            expect(tooltip).toHaveTextContent('Gunakan variabel numerik berskala pada dua atau lebih kelompok independen.');
            expect(tooltip).toHaveTextContent('Data dalam setiap kelompok harus berdistribusi normal.');
            expect(tooltip).toHaveTextContent('Setiap kelompok memerlukan minimal dua observasi valid dan varians lebih dari nol.');
        });

        it('renders variables tab by default', () => {
            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByTestId('variables-tab')).toBeInTheDocument();
        });

        it('renders tab triggers', () => {
            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByRole('tab', { name: /variables/i })).toBeInTheDocument();
            expect(screen.getByRole('tab', { name: /options/i })).toBeInTheDocument();
        });

        it('renders action buttons', () => {
            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
        });
    });

    describe('Tab Navigation', () => {
        it('switches to options tab when clicked', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            const optionsTab = screen.getByRole('tab', { name: /options/i });
            await user.click(optionsTab);

            expect(screen.getByTestId('options-tab')).toBeInTheDocument();
        });

        it('switches back to variables tab when clicked', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            const optionsTab = screen.getByRole('tab', { name: /options/i });
            await user.click(optionsTab);

            const variablesTab = screen.getByRole('tab', { name: /variables/i });
            await user.click(variablesTab);

            expect(screen.getByTestId('variables-tab')).toBeInTheDocument();
        });
    });

    describe('Button Actions', () => {
        it('calls runAnalysis when OK button is clicked with valid selection', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            const okButton = screen.getByRole('button', { name: /ok/i });
            await user.click(okButton);

            expect(mockRunAnalysis).toHaveBeenCalled();
        });

        it('disables OK button when no test variables selected', () => {
            (useVariableSelection as jest.Mock).mockReturnValue({
                availableVariables: [],
                testVariables: [],
                factorVariable: mockFactorVariable,
                highlightedVariable: null,
                setHighlightedVariable: jest.fn(),
                moveToTestVariables: jest.fn(),
                moveToFactorVariable: jest.fn(),
                moveToAvailableVariables: jest.fn(),
                reorderVariables: jest.fn(),
                resetVariableSelection: mockResetVariableSelection,
            });

            render(<BartlettTest {...defaultProps} />);

            const okButton = screen.getByRole('button', { name: /ok/i });
            expect(okButton).toBeDisabled();
        });

        it('disables OK button when no factor variable selected', () => {
            (useVariableSelection as jest.Mock).mockReturnValue({
                availableVariables: [],
                testVariables: mockTestVariables,
                factorVariable: null,
                highlightedVariable: null,
                setHighlightedVariable: jest.fn(),
                moveToTestVariables: jest.fn(),
                moveToFactorVariable: jest.fn(),
                moveToAvailableVariables: jest.fn(),
                reorderVariables: jest.fn(),
                resetVariableSelection: mockResetVariableSelection,
            });

            render(<BartlettTest {...defaultProps} />);

            const okButton = screen.getByRole('button', { name: /ok/i });
            expect(okButton).toBeDisabled();
        });

        it('calls reset functions when Reset button is clicked', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            const resetButton = screen.getByRole('button', { name: /reset/i });
            await user.click(resetButton);

            expect(mockResetVariableSelection).toHaveBeenCalled();
            expect(mockResetSettings).toHaveBeenCalled();
        });

        it('calls onClose when Cancel button is clicked', async () => {
            const user = userEvent.setup();
            render(<BartlettTest {...defaultProps} />);

            const cancelButton = screen.getByRole('button', { name: /cancel/i });
            await user.click(cancelButton);

            expect(mockOnClose).toHaveBeenCalled();
        });
    });

    describe('Calculating State', () => {
        it('shows loading state when calculating', () => {
            (useBartlettAnalysis as jest.Mock).mockReturnValue({
                isCalculating: true,
                errorMsg: null,
                runAnalysis: mockRunAnalysis,
                cancelCalculation: mockCancelCalculation,
            });

            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByText(/calculating/i)).toBeInTheDocument();
        });

        it('disables buttons when calculating', () => {
            (useBartlettAnalysis as jest.Mock).mockReturnValue({
                isCalculating: true,
                errorMsg: null,
                runAnalysis: mockRunAnalysis,
                cancelCalculation: mockCancelCalculation,
            });

            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
        });
    });

    describe('Error Display', () => {
        it('displays error message when present', () => {
            (useBartlettAnalysis as jest.Mock).mockReturnValue({
                isCalculating: false,
                errorMsg: 'An error occurred',
                runAnalysis: mockRunAnalysis,
                cancelCalculation: mockCancelCalculation,
            });

            render(<BartlettTest {...defaultProps} />);

            expect(screen.getByText('An error occurred')).toBeInTheDocument();
        });
    });

    describe('Container Types', () => {
        it('renders in dialog container by default', () => {
            render(<BartlettTest {...defaultProps} containerType="dialog" />);

            // Dialog content should be present
            expect(screen.getByText(/Bartlett.*Test.*Homogeneity.*Variances/i)).toBeInTheDocument();
        });

        it('renders in sidebar container when specified', () => {
            render(<BartlettTest {...defaultProps} containerType="sidebar" />);

            // Should still render the content
            expect(screen.getByTestId('variables-tab')).toBeInTheDocument();
        });
    });
});
