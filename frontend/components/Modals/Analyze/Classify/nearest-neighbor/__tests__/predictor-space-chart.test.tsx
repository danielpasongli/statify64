/** @jest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";
import KNNPredictorSpaceChart, {
  niceTickStep,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/components/KNNPredictorSpaceChart";
import { createPredictorSpaceChart } from "@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis-output";

// The 2D chart never creates OrbitControls; the ESM module does not load in Jest.
jest.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: jest.fn(),
}));

const width = 900;
const height = 640;
const svgWidth = width - 220;
const svgHeight = height - 110;

function singlePredictorPayload() {
  const ages = [18, 25, 33, 41, 49, 60];
  return {
    charts: [
      {
        chartData: ages.map((age, index) => ({
          id: index + 1,
          x: age,
          y: 0,
          type: "Training",
          target: index % 2 === 0 ? "No" : "Yes",
          predictorValues: [age],
          focal: index === 0,
          neighbors: [{ id: 2, distance: 0.1 }],
        })),
        chartConfig: {
          width,
          height,
          axisLabels: { x: "Age" },
          axisInfo: { x: { name: "Age", measure: "scale" } },
          predictorSpace: {
            selectedK: 1,
            modelPredictors: 1,
            actualPredictors: 1,
            targetVariable: "Attrition",
            targetMeasure: "nominal",
            displayedDimensions: 1,
            availableAxes: [{ name: "Age", measure: "scale" }],
            instruction: "Select points to use as focal records",
          },
        },
      },
    ],
  };
}

describe("KNN predictor space chart", () => {
  it("keeps single-predictor points on one line inside the plot", () => {
    const { container } = render(
      <KNNPredictorSpaceChart data={singlePredictorPayload()} />,
    );
    const circles = Array.from(container.querySelectorAll("svg circle"));

    expect(circles).toHaveLength(6);
    const cxs = circles.map((circle) => Number(circle.getAttribute("cx")));
    const cys = circles.map((circle) => Number(circle.getAttribute("cy")));

    expect(new Set(cys).size).toBe(1);
    for (const cy of cys) {
      expect(cy).toBeGreaterThan(0);
      expect(cy).toBeLessThan(svgHeight);
    }
    for (const cx of cxs) {
      expect(cx).toBeGreaterThan(0);
      expect(cx).toBeLessThan(svgWidth);
    }
    // Larger ages are drawn further right.
    expect([...cxs].sort((a, b) => a - b)).toEqual(cxs);
  });

  it("draws a single predictor on one line when the payload omits its dimensions", () => {
    const payload = singlePredictorPayload();
    const predictorSpace = payload.charts[0].chartConfig.predictorSpace as Record<
      string,
      unknown
    >;
    delete predictorSpace.displayedDimensions;
    delete predictorSpace.availableAxes;

    const { container } = render(<KNNPredictorSpaceChart data={payload} />);
    const cys = Array.from(container.querySelectorAll("svg circle")).map(
      (circle) => Number(circle.getAttribute("cy")),
    );

    expect(cys).toHaveLength(6);
    expect(new Set(cys).size).toBe(1);
    expect(cys[0]).toBeGreaterThan(0);
    expect(cys[0]).toBeLessThan(svgHeight);
  });

  it("rounds tick steps to the nearest nice value", () => {
    expect(niceTickStep(109 / 5)).toBe(20);
    expect(niceTickStep(42 / 5)).toBe(10);
    expect(niceTickStep(0.37)).toBe(0.5);
    expect(niceTickStep(1.2)).toBe(1);
  });

  it("stores only the point fields the chart reads, at chart precision", () => {
    const payload = createPredictorSpaceChart({
      k_value: 2,
      model_predictors: 2,
      dimensions: [
        {
          name: "Age x Income",
          axes: [{ name: "Age" }, { name: "Income" }],
          points: [
            {
              id: 7,
              label: "7",
              x: 0.123456789012345,
              y: -0.987654321098765,
              z: null,
              point_type: "Training",
              target_label: "No",
              actual_label: "No",
              predicted_label: "Yes",
              predictor_values: [0.123456789012345, -0.987654321098765],
              focal: false,
              neighbors: [
                { id: 3, label: "3", row_number: 3, distance: 0.0123456789012 },
              ],
            },
          ],
        },
      ],
    });
    const point = payload?.charts[0].chartData[0];

    expect(point).toEqual({
      id: 7,
      x: 0.1234568,
      y: -0.9876543,
      type: "Training",
      target: "No",
      targetNumber: null,
      predictorValues: [0.1234568, -0.9876543],
      neighbors: [{ id: 3, distance: 0.01234568 }],
    });
  });
});
