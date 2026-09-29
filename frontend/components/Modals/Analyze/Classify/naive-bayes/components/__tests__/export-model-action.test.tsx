import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
    ExportModelAction,
    DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME,
} from "@/components/Modals/Analyze/Classify/naive-bayes/components/export-model-action";

describe("ExportModelAction", () => {
    const dummyTrainedModel = {
        schema_version: 1,
        model_type: "naive_bayes",
        target: { name: "kelas", classes: ["a", "b"], class_priors: [0.5, 0.5] },
    };

    it("renders with the default export file name pre-filled", () => {
        render(<ExportModelAction trainedModel={dummyTrainedModel} onExport={jest.fn()} />);

        expect(
            screen.getByDisplayValue(DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME)
        ).toBeInTheDocument();
    });

    it("calls onExport with the default file name and the trained model when clicked", () => {
        const onExport = jest.fn();
        render(<ExportModelAction trainedModel={dummyTrainedModel} onExport={onExport} />);

        fireEvent.click(screen.getByRole("button", { name: /export model/i }));

        expect(onExport).toHaveBeenCalledTimes(1);
        expect(onExport).toHaveBeenCalledWith(
            DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME,
            dummyTrainedModel
        );
    });

    it("calls onExport with a user-edited file name", () => {
        const onExport = jest.fn();
        render(<ExportModelAction trainedModel={dummyTrainedModel} onExport={onExport} />);

        const input = screen.getByLabelText(/nama file/i);
        fireEvent.change(input, { target: { value: "custom-model.json" } });
        fireEvent.click(screen.getByRole("button", { name: /export model/i }));

        expect(onExport).toHaveBeenCalledWith("custom-model.json", dummyTrainedModel);
    });

    it("falls back to the default file name when the input is cleared/blank", () => {
        const onExport = jest.fn();
        render(<ExportModelAction trainedModel={dummyTrainedModel} onExport={onExport} />);

        const input = screen.getByLabelText(/nama file/i);
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.click(screen.getByRole("button", { name: /export model/i }));

        expect(onExport).toHaveBeenCalledWith(
            DEFAULT_NAIVE_BAYES_EXPORT_FILE_NAME,
            dummyTrainedModel
        );
    });

    it("disables the export button when there is no trained model yet", () => {
        render(<ExportModelAction trainedModel={null} onExport={jest.fn()} />);

        expect(screen.getByRole("button", { name: /export model/i })).toBeDisabled();
    });
});
