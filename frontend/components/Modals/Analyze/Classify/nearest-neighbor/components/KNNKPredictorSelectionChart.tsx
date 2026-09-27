import React, { useMemo, useState } from "react";

type ChartPoint = {
  model: number;
  predictor?: string;
  value: number;
  rawValue?: number;
};

type ChartPayload = {
  charts?: Array<{
    chartType?: string;
    chartData: ChartPoint[];
    chartMetadata?: {
      title?: string;
      subtitle?: string;
    };
    chartConfig?: {
      width?: number;
      height?: number;
      axisLabels?: { x?: string; y?: string };
      kAndPredictorSelection?: {
        mode?: "classification" | "regression";
        selectedK?: number;
        showPointLabels?: boolean;
      };
    };
  }>;
};

type TooltipState = {
  x: number;
  y: number;
  point: ChartPoint;
} | null;

function parsePayload(data: string | ChartPayload): ChartPayload {
  return typeof data === "string" ? JSON.parse(data) : data;
}

function formatClassificationValue(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(4);
}

function formatRegressionValue(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function createLinearTicks(min: number, max: number, count: number) {
  if (count <= 1) return [max];
  if (Math.abs(max - min) < Number.EPSILON) return [max];

  return Array.from({ length: count }, (_, index) =>
    min + ((max - min) * index) / (count - 1),
  );
}

function createClassificationTicks(values: number[]) {
  if (values.length === 1) return [values[0]];

  const max = Math.max(...values, 0);
  if (max <= 0) return [0];

  return createLinearTicks(0, max, 5);
}

function createRegressionTicks(values: number[]) {
  const max = Math.max(...values, 0);
  if (max <= 0) return [0];

  return createLinearTicks(0, max, 5);
}

function getYDomain(values: number[], mode: "classification" | "regression") {
  const max = Math.max(...values, 0);
  const hasZero = values.some((value) => Math.abs(value) < Number.EPSILON);

  if (values.length === 1) {
    const onlyValue = values[0] ?? 0;
    if (onlyValue <= 0) return [-1, 1] as const;
    return [0, onlyValue * 2] as const;
  }

  if (mode === "regression") {
    return max <= 0 ? [0, 1] as const : [0, max] as const;
  }

  if (max <= 0) return [-0.05, 0.05] as const;
  if (hasZero) return [-max * 0.08, max] as const;

  return [0, max] as const;
}

// Memoized so the output viewer re-rendering (once per added statistic)
// skips this chart when its data is unchanged.
export default React.memo(function KNNKPredictorSelectionChart({
  data,
}: {
  data: string | ChartPayload;
}) {
  const payload = useMemo(() => parsePayload(data), [data]);
  const chart = payload.charts?.[0];
  const points = useMemo(
    () =>
      (chart?.chartData ?? [])
        .map((point) => ({
          ...point,
          model: Number(point.model),
          value: Number(point.value),
        }))
        .filter(
          (point) =>
            Number.isFinite(point.model) && Number.isFinite(point.value),
        ),
    [chart?.chartData],
  );
  const mode =
    chart?.chartConfig?.kAndPredictorSelection?.mode === "regression"
      ? "regression"
      : "classification";
  const width = chart?.chartConfig?.width ?? 900;
  const height = chart?.chartConfig?.height ?? 520;
  const axisLabels = chart?.chartConfig?.axisLabels ?? {};
  const showPointLabels = Boolean(
    chart?.chartConfig?.kAndPredictorSelection?.showPointLabels,
  );
  // Only the k selection chart plots k on the x-axis; the predictor selection
  // chart plots model steps, so selectedK must not be matched against it.
  const rawSelectedK = chart?.chartConfig?.kAndPredictorSelection?.selectedK;
  const highlightedK =
    chart?.chartType === "KNN k Selection Error Log" &&
    rawSelectedK !== null &&
    rawSelectedK !== undefined &&
    Number.isFinite(Number(rawSelectedK))
      ? Number(rawSelectedK)
      : null;
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  if (!chart || points.length === 0) return null;

  const margin = { top: 96, right: 34, bottom: 70, left: 92 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const modelValues = points.map((point) => point.model);
  const modelMin = Math.min(...modelValues);
  const modelMax = Math.max(...modelValues);
  const modelSpan = Math.max(1, modelMax - modelMin);
  const values = points.map((point) => point.value);
  const [yMin, yMax] = getYDomain(values, mode);
  const ySpan = yMax - yMin || 1;
  const yTicks =
    mode === "regression"
      ? createRegressionTicks(values)
      : createClassificationTicks(values);
  const formatValue =
    mode === "regression" ? formatRegressionValue : formatClassificationValue;

  const scaleX = (model: number) =>
    margin.left +
    (Math.abs(modelMax - modelMin) < Number.EPSILON
      ? plotWidth / 2
      : ((model - modelMin) / modelSpan) * plotWidth);
  const scaleY = (value: number) =>
    margin.top + ((yMax - value) / ySpan) * plotHeight;

  const linePath = points
    .map((point, index) => {
      const prefix = index === 0 ? "M" : "L";
      return `${prefix} ${scaleX(point.model)} ${scaleY(point.value)}`;
    })
    .join(" ");

  const handleMouseMove = (
    event: React.MouseEvent<SVGCircleElement>,
    point: ChartPoint,
  ) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    setTooltip({
      x: event.clientX - (rect?.left ?? 0) + 12,
      y: event.clientY - (rect?.top ?? 0) - 48,
      point,
    });
  };

  return (
    <div className="relative mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <svg width={width} height={height} className="overflow-visible">
        <text
          x={width / 2}
          y={28}
          textAnchor="middle"
          className="fill-gray-900 text-base font-bold"
        >
          {chart.chartMetadata?.title ?? "k and Predictor Selection"}
        </text>
        {chart.chartMetadata?.subtitle && (
          <text
            x={width / 2}
            y={48}
            textAnchor="middle"
            className="fill-gray-600 text-xs"
          >
            {chart.chartMetadata.subtitle}
          </text>
        )}

        {yTicks.map((tick) => {
          const y = scaleY(tick);
          return (
            <g key={`y-${tick}`}>
              <line
                x1={margin.left}
                y1={y}
                x2={width - margin.right}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray="4 4"
              />
              <text
                x={margin.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-gray-600 text-xs"
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        {points.map((point) => {
          const x = scaleX(point.model);
          return (
            <g key={`x-${point.model}`}>
              <line
                x1={x}
                y1={margin.top}
                x2={x}
                y2={margin.top + plotHeight}
                stroke="#f3f4f6"
              />
              <text
                x={x}
                y={margin.top + plotHeight + 24}
                textAnchor="middle"
                className="fill-gray-700 text-xs"
              >
                {point.model}
              </text>
            </g>
          );
        })}

        <line
          x1={margin.left}
          y1={margin.top + plotHeight}
          x2={width - margin.right}
          y2={margin.top + plotHeight}
          stroke="#9ca3af"
        />
        <line
          x1={margin.left}
          y1={margin.top}
          x2={margin.left}
          y2={margin.top + plotHeight}
          stroke="#9ca3af"
        />

        {points.length > 1 && (
          <path d={linePath} fill="none" stroke="#2563eb" strokeWidth={2} />
        )}

        {points.map((point) => {
          const x = scaleX(point.model);
          const y = scaleY(point.value);
          const isSelected = highlightedK !== null && point.model === highlightedK;
          return (
            <g key={`point-${point.model}-${point.predictor ?? "k"}`}>
              {showPointLabels && point.predictor && (
                <text
                  x={x}
                  y={y - 14}
                  textAnchor="middle"
                  className="fill-gray-800 text-xs font-medium"
                >
                  {point.predictor}
                </text>
              )}
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 7 : 5}
                fill={isSelected ? "#dc2626" : "#2563eb"}
                stroke="#ffffff"
                strokeWidth={2}
                onMouseMove={(event) => handleMouseMove(event, point)}
                onMouseLeave={() => setTooltip(null)}
              />
            </g>
          );
        })}

        <text
          x={width / 2}
          y={height - 18}
          textAnchor="middle"
          className="fill-gray-800 text-sm"
        >
          {axisLabels.x ?? "Model"}
        </text>
        <text
          x={18}
          y={margin.top + plotHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 18 ${margin.top + plotHeight / 2})`}
          className="fill-gray-800 text-sm"
        >
          {axisLabels.y ??
            (mode === "regression"
              ? "Sum Square of Error (SSE)"
              : "Error Rate")}
        </text>
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <strong>{mode === "regression" ? "SSE" : "Error Rate"}:</strong>{" "}
          {formatValue(tooltip.point.value)}
        </div>
      )}
    </div>
  );
});
