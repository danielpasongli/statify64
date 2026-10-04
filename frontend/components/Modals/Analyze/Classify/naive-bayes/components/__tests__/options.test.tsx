import { render, screen, fireEvent } from "@testing-library/react";
import OptionsTab from "../../dialogs/options";
import type { NaiveBayesOptionsType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";

describe("OptionsTab", () => {
    const defaultData: NaiveBayesOptionsType = {
        MissingValuePolicy: "exclude",
        UnseenCategoryPolicy: "smoothing",
        SmoothingAlpha: 1,
        VarianceFloor: 1e-9,
    };

    const mockUpdateFormData = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders with default value 1", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);
        expect(input).toHaveValue(1);
    });

    it("calls updateFormData when valid value is entered", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "2.5" } });

        expect(mockUpdateFormData).toHaveBeenCalledWith("SmoothingAlpha", 2.5);
    });

    it("shows error for value 0", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "0" } });

        expect(screen.getByText(/harus > 0/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("shows error for negative value", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "-1" } });

        expect(screen.getByText(/harus > 0/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("shows error for value > 999", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "1000" } });

        expect(screen.getByText(/maksimum 999/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("accepts decimal values", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "0.5" } });

        expect(screen.queryByText(/harus > 0/i)).not.toBeInTheDocument();
        expect(mockUpdateFormData).toHaveBeenCalledWith("SmoothingAlpha", 0.5);
    });

    it("syncs local state when data prop changes", () => {
        const { rerender } = render(
            <OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />
        );

        const newData = { ...defaultData, SmoothingAlpha: 5 };
        rerender(<OptionsTab data={newData} updateFormData={mockUpdateFormData} />);

        const input = screen.getByLabelText(/Smoothing Alpha/i);
        expect(input).toHaveValue(5);
    });
});
