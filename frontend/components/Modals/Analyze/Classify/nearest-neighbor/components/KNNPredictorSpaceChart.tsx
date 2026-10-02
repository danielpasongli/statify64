import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import KNNPeersChart from "./KNNPeersChart";
import { useMountWhenNearViewport } from "../hooks/useMountWhenNearViewport";

type Neighbor = {
  id: number | string;
  distance: number;
};

type Point = {
  id: number | string;
  label?: string;
  x: number;
  y: number;
  z?: number;
  type: string;
  target: string;
  targetNumber?: number | null;
  observed?: string;
  predicted?: string;
  predictorValues?: number[];
  focal?: boolean;
  neighbors?: Neighbor[];
};

type AxisInfo = {
  name?: string;
  measure?: string;
  categories?: string[];
  ticks?: Array<{ value: number; label: string }>;
};

type ChartPayload = {
  charts?: Array<{
    chartData: Point[];
    chartMetadata?: {
      title?: string;
    };
    chartConfig?: {
      width?: number;
      height?: number;
      axisLabels?: { x?: string; y?: string; z?: string };
      axisInfo?: { x?: AxisInfo; y?: AxisInfo; z?: AxisInfo };
      predictorSpace?: {
        selectedK: number;
        modelPredictors: number;
        actualPredictors: number;
        targetVariable: string;
        targetMeasure?: string;
        hasFocalCaseIdentifier?: boolean;
        displayedDimensions?: number;
        availableAxes?: AxisInfo[];
        instruction: string;
        peersChartEnabled?: boolean;
        quadrantMapEnabled?: boolean;
      };
    };
  }>;
};

type TooltipState = {
  x: number;
  y: number;
  html: React.ReactNode;
} | null;

const targetColors = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#4b5563",
  "#dc2626",
];

function parsePayload(data: string | ChartPayload): ChartPayload {
  return typeof data === "string" ? JSON.parse(data) : data;
}

function formatDistance(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(4);
}

function createNiceTicks(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (Math.abs(max - min) < Number.EPSILON) return [max];

  const step = niceTickStep((max - min) / 5);
  let start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  if (start === 0 && min > 0) {
    start = step;
  }

  const tickCount = Math.round((end - start) / step) + 1;
  return Array.from({ length: Math.max(0, tickCount) }, (_, index) =>
    roundTick(start + step * index, step),
  );
}

// Rounds to the nearest 1/2/5 step (geometric midpoints, as d3 does) instead
// of always rounding up, which could stretch the axis far past the data
// (1..110 gave a step of 50 and an axis up to 150; now 20 and 120).
export function niceTickStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;

  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const fraction = rawStep / magnitude;

  if (fraction >= Math.sqrt(50)) return 10 * magnitude;
  if (fraction >= Math.sqrt(10)) return 5 * magnitude;
  if (fraction >= Math.sqrt(2)) return 2 * magnitude;
  return magnitude;
}

function roundTick(value: number, step: number) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return Number(value.toFixed(decimals));
}

function formatTick(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 1 ? 3 : 2,
  });
}

function formatNumericTargetTick(value: number) {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function finiteNumber(value: unknown, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function pointAxisValue(point: Point, axisIndex: number, fallback: number) {
  const value = point.predictorValues?.[axisIndex];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clampInteger(value: unknown, min: number, max: number) {
  const numericValue = Math.trunc(Number(value));
  if (!Number.isFinite(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
}

function interpolateColor(start: string, end: string, ratio: number) {
  const clamped = Math.min(1, Math.max(0, ratio));
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(start);
  const [r2, g2, b2] = parse(end);
  const toHex = (value: number) =>
    Math.round(value).toString(16).padStart(2, "0");

  return `#${toHex(r1 + (r2 - r1) * clamped)}${toHex(
    g1 + (g2 - g1) * clamped,
  )}${toHex(b1 + (b2 - b1) * clamped)}`;
}

/**
 * Memoized so the output viewer re-rendering (once per added statistic) skips
 * this chart when its data is unchanged, and deferred until the chart is near
 * the visible area so opening the viewer does not draw every point at once.
 */
const KNNPredictorSpaceChart = React.memo(function KNNPredictorSpaceChart({
  data,
}: {
  data: string | ChartPayload;
}) {
  const [placeholderRef, isNearViewport] = useMountWhenNearViewport<HTMLDivElement>();

  if (isNearViewport) return <PredictorSpaceChartContent data={data} />;
  return (
    <div
      ref={placeholderRef}
      className="p-4 text-sm text-muted-foreground"
      style={{ minHeight: 640 }}
    >
      Loading predictor space...
    </div>
  );
});

export default KNNPredictorSpaceChart;

function PredictorSpaceChartContent({
  data,
}: {
  data: string | ChartPayload;
}) {
  const payload = useMemo(() => parsePayload(data), [data]);
  const chart = payload.charts?.[0];
  const sourcePoints = useMemo(
    () =>
      (chart?.chartData ?? []).filter(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      ),
    [chart?.chartData],
  );
  const config = chart?.chartConfig?.predictorSpace;
  const width = chart?.chartConfig?.width ?? 900;
  const height = chart?.chartConfig?.height ?? 640;
  const svgWidth = width - 220;
  const svgHeight = height - 110;
  const maxK = Math.max(1, Number(config?.selectedK ?? 1));
  const isNumericTarget = config?.targetMeasure === "scale";

  const [currentK, setCurrentK] = useState(maxK);
  const [selectedId, setSelectedId] = useState<number | string | null>(null);
  // Tooltip state lives in TooltipLayer: keeping it here re-rendered every
  // point of the chart on each mouse move.
  const tooltipLayerRef = useRef<TooltipLayerHandle>(null);
  const setTooltip = useCallback(
    (value: TooltipState) => tooltipLayerRef.current?.setTooltip(value),
    [],
  );
  const availableAxes = useMemo(() => {
    const configuredAxes = config?.availableAxes?.filter(Boolean) ?? [];
    if (configuredAxes.length) return configuredAxes;

    const axisInfo = chart?.chartConfig?.axisInfo ?? {};
    return [axisInfo.x, axisInfo.y, axisInfo.z].filter(Boolean) as AxisInfo[];
  }, [chart?.chartConfig?.axisInfo, config?.availableAxes]);
  const [selectedAxisIndexes, setSelectedAxisIndexes] = useState([0, 1, 2]);

  useEffect(() => {
    setCurrentK((value) => clampInteger(value, 1, maxK));
  }, [maxK]);

  useEffect(() => {
    setSelectedAxisIndexes((current) =>
      [0, 1, 2].map((position) => {
        const currentIndex = current[position];
        if (currentIndex < availableAxes.length) return currentIndex;
        return Math.min(position, Math.max(0, availableAxes.length - 1));
      }),
    );
  }, [availableAxes.length]);

  // Capped by the predictor axes that exist: a payload without
  // displayedDimensions (or saved by an older version) defaulted to 2 and drew
  // a single predictor as a diagonal running off the plot.
  const configuredDimensions = finiteNumber(config?.displayedDimensions, 2);
  const predictorCount = sourcePoints.reduce(
    (count, point) => Math.max(count, point.predictorValues?.length ?? 0),
    0,
  );
  const displayedDimensions = Math.max(
    1,
    Math.min(
      3,
      configuredDimensions,
      config?.availableAxes?.length || configuredDimensions,
      predictorCount || configuredDimensions,
    ),
  );

  // Only displayed dimensions read predictor values. With one predictor the
  // Y slot falls back to the X predictor, and reading it put every point at
  // y = its X value, far outside the fixed [-1, 1] Y domain of the 1D chart.
  const points = useMemo(
    () =>
      sourcePoints
        .map((point) => ({
          ...point,
          x: pointAxisValue(point, selectedAxisIndexes[0], point.x),
          y:
            displayedDimensions >= 2
              ? pointAxisValue(point, selectedAxisIndexes[1], point.y)
              : 0,
          z:
            displayedDimensions >= 3
              ? pointAxisValue(point, selectedAxisIndexes[2], finiteNumber(point.z, 0))
              : 0,
        }))
        .filter((point) => !(isNumericTarget && point.type === "Holdout"))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    [displayedDimensions, isNumericTarget, selectedAxisIndexes, sourcePoints],
  );

  const targetCategories = useMemo(
    () => Array.from(new Set(points.map((point) => point.target || "(blank)"))),
    [points],
  );
  const colorByTarget = useMemo(
    () =>
      new Map(
        targetCategories.map((target, index) => [
          target,
          targetColors[index % targetColors.length],
        ]),
      ),
    [targetCategories],
  );
  const numericTargets = useMemo(
    () =>
      points
        .map((point) => Number(point.targetNumber))
        .filter((value) => Number.isFinite(value)),
    [points],
  );
  const numericTargetMin = numericTargets.length ? Math.min(...numericTargets) : 0;
  const numericTargetMax = numericTargets.length ? Math.max(...numericTargets) : 0;
  const numericTargetSpan = numericTargetMax - numericTargetMin || 1;
  const numericTargetTicks = createNiceTicks(numericTargetMin, numericTargetMax).reverse();
  const numericTargetColor = useCallback((value: number | null | undefined) => {
    if (!Number.isFinite(Number(value))) return "#6b7280";
    return interpolateColor(
      "#2563eb",
      "#dc2626",
      (Number(value) - numericTargetMin) / numericTargetSpan,
    );
  }, [numericTargetMin, numericTargetSpan]);
  const colorForPoint = useCallback(
    (point: Point) =>
      isNumericTarget
        ? numericTargetColor(point.targetNumber)
        : colorByTarget.get(point.target || "(blank)") ?? "#2563eb",
    [colorByTarget, isNumericTarget, numericTargetColor],
  );

  const rawXValues = points.map((point) => point.x);
  const rawYValues = points.map((point) => point.y);
  const rawZValues = points.map((point) => finiteNumber(point.z, 0));
  const rawXMin = Math.min(...rawXValues);
  const rawXMax = Math.max(...rawXValues);
  const rawYMin = Math.min(...rawYValues);
  const rawYMax = Math.max(...rawYValues);
  const rawZMin = Math.min(...rawZValues);
  const rawZMax = Math.max(...rawZValues);
  const hasZAxis =
    displayedDimensions >= 3 &&
    Boolean(chart?.chartConfig?.axisLabels?.z) &&
    rawZValues.some((value) => Number.isFinite(value));
  const chartAxisInfo = {
    x: availableAxes[selectedAxisIndexes[0]] ?? chart?.chartConfig?.axisInfo?.x,
    y: availableAxes[selectedAxisIndexes[1]] ?? chart?.chartConfig?.axisInfo?.y,
    z: availableAxes[selectedAxisIndexes[2]] ?? chart?.chartConfig?.axisInfo?.z,
  };
  const chartAxisLabels = {
    x:
      chartAxisInfo.x?.name ??
      chart?.chartConfig?.axisLabels?.x ??
      "X",
    y:
      chartAxisInfo.y?.name ??
      chart?.chartConfig?.axisLabels?.y ??
      "Y",
    z:
      chartAxisInfo.z?.name ??
      chart?.chartConfig?.axisLabels?.z ??
      "Z",
  };
  const isSinglePredictorSpace = displayedDimensions === 1;
  const projectionNote =
    (config?.actualPredictors ?? 0) > 3
      ? `This chart is a lower-dimensional projection of the predictor space, which contains a total of ${config?.actualPredictors} predictors`
      : "";
  const xAxis = buildAxisTicks(chartAxisInfo.x, chartAxisLabels.x ?? "X", [
    rawXMin,
    rawXMax,
  ]);
  const yAxis = isSinglePredictorSpace
    ? { label: "", min: -1, max: 1, ticks: [] }
    : buildAxisTicks(chartAxisInfo.y, chartAxisLabels.y ?? "Y", [
        rawYMin,
        rawYMax,
      ]);
  const zTicks = hasZAxis ? createNiceTicks(rawZMin, rawZMax) : [];

  const plot = { left: 58, right: 24, top: 28, bottom: 58 };
  // Keeps points (and their markers) off the axis lines.
  const plotInset = 12;
  const [xDomainMin, xDomainMax] = plotDomain(xAxis, chartAxisInfo.x, rawXValues);
  const [yDomainMin, yDomainMax] = isSinglePredictorSpace
    ? [yAxis.min, yAxis.max]
    : plotDomain(yAxis, chartAxisInfo.y, rawYValues);
  const scaleX = (value: number) =>
    plot.left +
    plotInset +
    ((value - xDomainMin) / (xDomainMax - xDomainMin)) *
      (svgWidth - plot.left - plot.right - plotInset * 2);
  const scaleY = (value: number) =>
    svgHeight -
    plot.bottom -
    plotInset -
    ((value - yDomainMin) / (yDomainMax - yDomainMin)) *
      (svgHeight - plot.top - plot.bottom - plotInset * 2);
  const pointById = new Map(points.map((point) => [String(point.id), point]));
  const selectedPoint =
    selectedId === null ? null : pointById.get(String(selectedId)) ?? null;
  const focalLinePoints = selectedPoint
    ? [selectedPoint]
    : points.filter((point) => point.focal);

  // Depth only applies when a Z axis is drawn. With two predictors the third
  // axis slot falls back to one of the plotted axes, and projecting that as
  // depth pushed every point off the X/Y axes.
  const depthOf = (zValue: number) => (hasZAxis ? zValue : 0);
  const projectedOf = (point: Point) => {
    const z = depthOf(finiteNumber(point.z, 0));
    return {
      x: scaleX(point.x + z * 0.45),
      y: scaleY(point.y - z * 0.35),
    };
  };
  const projectedCoord = (xValue: number, yValue: number, zValue = 0) => ({
    x: scaleX(xValue + depthOf(zValue) * 0.45),
    y: scaleY(yValue - depthOf(zValue) * 0.35),
  });

  const showTooltip = (event: React.MouseEvent, html: React.ReactNode) => {
    const rect = (event.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect();
    setTooltip({
      x: event.clientX - (rect?.left ?? 0) + 10,
      y: event.clientY - (rect?.top ?? 0) - 42,
      html,
    });
  };
  const handleKChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentK(clampInteger(event.target.value, 1, maxK));
  };

  if (!chart || points.length === 0) return null;

  const axisPicker =
    availableAxes.length > 3 ? (
      <AxisPicker
        axes={availableAxes}
        selectedAxisIndexes={selectedAxisIndexes}
        setSelectedAxisIndexes={setSelectedAxisIndexes}
      />
    ) : null;
  const peersChartNode =
    config?.peersChartEnabled || config?.quadrantMapEnabled ? (
    <KNNPeersChart
      axes={availableAxes}
      colorForPoint={colorForPoint}
      currentK={currentK}
      isNumericTarget={isNumericTarget}
      peersChartEnabled={Boolean(config?.peersChartEnabled)}
      points={points}
      quadrantMapEnabled={Boolean(config?.quadrantMapEnabled)}
      selectedId={selectedId}
      targetVariable={config?.targetVariable ?? "Target"}
    />
  ) : null;

  if (hasZAxis) {
    return (
      <>
        <div className="relative mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div style={{ width, minHeight: height }} className="relative">
          <div className="mb-2 text-center">
            <div className="text-base font-bold">Predictor Space</div>
            <div className="text-xs text-gray-600">
              Built Model: {config?.modelPredictors ?? 0} selected predictors, K ={" "}
              {currentK}
            </div>
          </div>

          <div data-export-ignore className="mb-2 flex items-center justify-center gap-3">
            <label htmlFor="knn-predictor-space-k-3d" className="text-xs font-semibold">
              K
            </label>
            <input
              id="knn-predictor-space-k-3d"
              type="number"
              min={1}
              max={maxK}
              step={1}
              value={currentK}
              onChange={handleKChange}
              className="h-8 w-20 rounded border border-gray-300 px-2 text-center text-xs"
            />
            <span className="text-xs text-gray-500">Max {maxK}</span>
          </div>
          {axisPicker}

          <div className="flex items-start justify-center gap-4">
            <ThreePredictorSpace
              points={points}
              currentK={currentK}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              width={svgWidth}
              height={svgHeight}
              axisLabels={chartAxisLabels}
              axisInfo={chartAxisInfo}
              isNumericTarget={isNumericTarget}
              colorForPoint={colorForPoint}
            />

            <div className="w-44 text-xs leading-snug">
              <LegendSection title="Focal" />
              <LegendCircle label="No" />
              <LegendCircle label="Yes" outline="#dc2626" />
              <LegendSection title="Type" />
              <LegendCircle label="Training" fill="#6b7280" />
              {!isNumericTarget && (
                <div className="mb-1 flex items-center gap-2">
                  <span className="h-0 w-0 border-b-[13px] border-l-[7px] border-r-[7px] border-b-gray-500 border-l-transparent border-r-transparent" />
                  <span>Holdout</span>
                </div>
              )}
              <LegendSection title="Target" />
              <div className="mb-1">{config?.targetVariable ?? "Target"}</div>
              {isNumericTarget ? (
                <NumericGradientLegend
                  ticks={numericTargetTicks}
                  min={numericTargetMin}
                  max={numericTargetMax}
                />
              ) : (
                targetCategories.map((target) => (
                  <LegendCircle
                    key={target}
                    label={target}
                    fill={colorByTarget.get(target) ?? "#2563eb"}
                  />
                ))
              )}
              <LegendSection title={`K: ${currentK}`} />
            </div>
          </div>

          {projectionNote && (
            <div className="mt-2 text-center text-xs text-gray-500">
              {projectionNote}
            </div>
          )}

          <div className="mt-2 text-center text-xs text-gray-600">
            {config?.instruction ?? "Select points to use as focal records"}
          </div>
          </div>
        </div>
        {peersChartNode}
      </>
    );
  }

  return (
    <>
      <div className="relative mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div style={{ width, minHeight: height }} className="relative">
        <div className="mb-2 text-center">
          <div className="text-base font-bold">Predictor Space</div>
          <div className="text-xs text-gray-600">
            Built Model: {config?.modelPredictors ?? 0} selected predictors, K ={" "}
            {currentK}
          </div>
        </div>

        <div data-export-ignore className="mb-2 flex items-center justify-center gap-3">
          <label htmlFor="knn-predictor-space-k-2d" className="text-xs font-semibold">
            K
          </label>
          <input
            id="knn-predictor-space-k-2d"
            type="number"
            min={1}
            max={maxK}
            step={1}
            value={currentK}
            onChange={handleKChange}
            className="h-8 w-20 rounded border border-gray-300 px-2 text-center text-xs"
          />
          <span className="text-xs text-gray-500">Max {maxK}</span>
        </div>
        {axisPicker}

        <div className="flex items-start justify-center gap-4">
          <svg width={svgWidth} height={svgHeight} className="overflow-visible">
            {xAxis.ticks.map((tick) => {
              const x = projectedCoord(tick.value, yAxis.min, 0).x;
              return (
                <g key={`x-tick-${tick.value}-${tick.label}`}>
                  <line
                    x1={x}
                    y1={plot.top}
                    x2={x}
                    y2={svgHeight - plot.bottom}
                    stroke="#d1d5db"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={x}
                    y1={svgHeight - plot.bottom}
                    x2={x}
                    y2={svgHeight - plot.bottom + 5}
                    stroke="#6b7280"
                  />
                  <text
                    x={x}
                    y={svgHeight - plot.bottom + 18}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#4b5563"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}

            {yAxis.ticks.map((tick) => {
              const y = projectedCoord(xAxis.min, tick.value, 0).y;
              return (
                <g key={`y-tick-${tick.value}-${tick.label}`}>
                  <line
                    x1={plot.left}
                    y1={y}
                    x2={svgWidth - plot.right}
                    y2={y}
                    stroke="#d1d5db"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={plot.left - 5}
                    y1={y}
                    x2={plot.left}
                    y2={y}
                    stroke="#6b7280"
                  />
                  <text
                    x={plot.left - 9}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={10}
                    fill="#4b5563"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}

            {hasZAxis &&
              zTicks.map((tick) => {
                const start = projectedCoord(rawXMin, rawYMin, tick);
                const end = projectedCoord(rawXMax, rawYMin, tick);
                return (
                  <g key={`z-tick-${tick}`}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#d1d5db"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={start.x - 8}
                      y={start.y + 3}
                      textAnchor="end"
                      fontSize={10}
                      fill="#4b5563"
                    >
                      {formatTick(tick)}
                    </text>
                  </g>
                );
              })}

            <line
              x1={plot.left}
              y1={svgHeight - plot.bottom}
              x2={svgWidth - plot.right}
              y2={svgHeight - plot.bottom}
              stroke="#9ca3af"
            />
            <line
              x1={plot.left}
              y1={plot.top}
              x2={plot.left}
              y2={svgHeight - plot.bottom}
              stroke="#9ca3af"
            />
            {hasZAxis && (
              <line
                x1={projectedCoord(rawXMin, rawYMin, rawZMin).x}
                y1={projectedCoord(rawXMin, rawYMin, rawZMin).y}
                x2={projectedCoord(rawXMin, rawYMin, rawZMax).x}
                y2={projectedCoord(rawXMin, rawYMin, rawZMax).y}
                stroke="#9ca3af"
              />
            )}
            <text
              x={svgWidth / 2}
              y={svgHeight - 16}
              textAnchor="middle"
              fontSize={12}
              fill="#374151"
            >
              {xAxis.label}
            </text>
            <text
              x={16}
              y={svgHeight / 2}
              textAnchor="middle"
              fontSize={12}
              fill="#374151"
              transform={`rotate(-90 16 ${svgHeight / 2})`}
            >
              {yAxis.label}
            </text>
            {hasZAxis && chart.chartConfig?.axisLabels?.z && (
              <text
                x={projectedCoord(rawXMin, rawYMin, rawZMax).x - 10}
                y={projectedCoord(rawXMin, rawYMin, rawZMax).y - 8}
                fontSize={12}
                fill="#374151"
                textAnchor="end"
              >
                {chart.chartConfig.axisLabels.z}
              </text>
            )}

            {focalLinePoints.flatMap((focalPoint) =>
              (focalPoint.neighbors ?? []).slice(0, currentK).map((neighbor) => {
                const neighborPoint = pointById.get(String(neighbor.id));
                if (!neighborPoint) return null;
                const start = projectedOf(focalPoint);
                const end = projectedOf(neighborPoint);
                return (
                  <g key={`${focalPoint.id}-${neighbor.id}`}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#dc2626"
                      strokeWidth={1.6}
                      strokeOpacity={selectedPoint ? 0.85 : 0.35}
                    />
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="transparent"
                      strokeWidth={10}
                      onMouseMove={(event) =>
                        showTooltip(event, <>Distance: {formatDistance(Number(neighbor.distance))}</>)
                      }
                      onMouseLeave={() => setTooltip(null)}
                    />
                  </g>
                );
              }),
            )}

            {points.map((point) => {
              const projectedPoint = projectedOf(point);
              const isSelected = String(point.id) === String(selectedId);
              const fill = isNumericTarget
                ? numericTargetColor(point.targetNumber)
                : colorByTarget.get(point.target || "(blank)") ?? "#2563eb";
              const commonProps = {
                fill,
                stroke: isSelected ? "#dc2626" : "#1f2937",
                strokeWidth: isSelected ? 3 : 1,
                className: "cursor-pointer",
                onClick: () =>
                  setSelectedId((current) =>
                    String(current) === String(point.id) ? null : point.id,
                  ),
                onMouseMove: (event: React.MouseEvent<SVGElement>) =>
                  showTooltip(event, pointTooltip(point)),
                onMouseLeave: () => setTooltip(null),
              };

              if (point.type === "Holdout") {
                const size = 8;
                const isFocal =
                  isSelected || (selectedId === null && Boolean(point.focal));
                return (
                  <polygon
                    key={String(point.id)}
                    points={`${projectedPoint.x},${projectedPoint.y - size} ${
                      projectedPoint.x - size
                    },${projectedPoint.y + size} ${projectedPoint.x + size},${
                      projectedPoint.y + size
                    }`}
                    {...commonProps}
                    stroke={isFocal ? "#dc2626" : "#1f2937"}
                    strokeWidth={isFocal ? 3 : 1}
                  />
                );
              }

              const isFocal =
                isSelected || (selectedId === null && Boolean(point.focal));
              return (
                <circle
                  key={String(point.id)}
                  cx={projectedPoint.x}
                  cy={projectedPoint.y}
                  r={6}
                  {...commonProps}
                  stroke={isFocal ? "#dc2626" : "#1f2937"}
                  strokeWidth={isFocal ? 3 : 1}
                />
              );
            })}
          </svg>

          <div className="w-44 text-xs leading-snug">
            <LegendSection title="Focal" />
            <LegendCircle label="No" />
            <LegendCircle label="Yes" outline="#dc2626" />
            <LegendSection title="Type" />
            <LegendCircle label="Training" fill="#6b7280" />
            {!isNumericTarget && (
              <div className="mb-1 flex items-center gap-2">
                <span className="h-0 w-0 border-b-[13px] border-l-[7px] border-r-[7px] border-b-gray-500 border-l-transparent border-r-transparent" />
                <span>Holdout</span>
              </div>
            )}
            <LegendSection title="Target" />
            <div className="mb-1">{config?.targetVariable ?? "Target"}</div>
            {isNumericTarget ? (
              <NumericGradientLegend
                ticks={numericTargetTicks}
                min={numericTargetMin}
                max={numericTargetMax}
              />
            ) : (
              targetCategories.map((target) => (
                <LegendCircle
                  key={target}
                  label={target}
                  fill={colorByTarget.get(target) ?? "#2563eb"}
                />
              ))
            )}
            <LegendSection title={`K: ${currentK}`} />
          </div>
        </div>

        {projectionNote && (
          <div className="mt-2 text-center text-xs text-gray-500">
            {projectionNote}
          </div>
        )}

        <div className="mt-2 text-center text-xs text-gray-600">
          {config?.instruction ?? "Select points to use as focal records"}
        </div>

        <TooltipLayer ref={tooltipLayerRef} />
        </div>
      </div>
      {peersChartNode}
    </>
  );
}

function ThreePredictorSpace({
  points,
  currentK,
  selectedId,
  setSelectedId,
  width,
  height,
  axisLabels,
  axisInfo,
  isNumericTarget,
  colorForPoint,
}: {
  points: Point[];
  currentK: number;
  selectedId: number | string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<number | string | null>>;
  width: number;
  height: number;
  axisLabels: { x?: string; y?: string; z?: string };
  axisInfo: { x?: AxisInfo; y?: AxisInfo; z?: AxisInfo };
  isNumericTarget: boolean;
  colorForPoint: (point: Point) => string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const sceneStateRef = useRef<{
    lineGroup: THREE.Group;
    outlineGroup: THREE.Group;
    pointMeshes: THREE.Object3D[];
    meshById: Map<string, THREE.Mesh>;
    pointById: Map<string, Point>;
    positionOf: (point: Point) => THREE.Vector3;
  } | null>(null);
  const neighborLinesRef = useRef<THREE.Object3D[]>([]);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (!canCreateWebGLContext()) {
      setWebglUnavailable(true);
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ffffff");

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 1000);
    camera.position.set(7, 6, 8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        // Keeps the last frame readable so the chart can be exported as an image.
        preserveDrawingBuffer: true,
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }
    setWebglUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight("#ffffff", 1.5));
    const directional = new THREE.DirectionalLight("#ffffff", 2);
    directional.position.set(5, 8, 6);
    scene.add(directional);

    const ranges = {
      x: extent(points.map((point) => point.x)),
      y: extent(points.map((point) => point.y)),
      z: extent(points.map((point) => Number(point.z ?? 0))),
    };
    const axes = {
      depth: buildAxisTicks(axisInfo.x, axisLabels.x ?? "X", ranges.x),
      vertical: buildAxisTicks(axisInfo.y, axisLabels.y ?? "Y", ranges.y),
      horizontal: buildAxisTicks(axisInfo.z, axisLabels.z ?? "Z", ranges.z),
    };
    const scale = {
      depth: createScale(axes.depth.min, axes.depth.max),
      vertical: createScale(axes.vertical.min, axes.vertical.max),
      horizontal: createScale(axes.horizontal.min, axes.horizontal.max),
    };
    const positionOf = (point: Point) =>
      new THREE.Vector3(
        scale.horizontal(finiteNumber(point.z, 0)),
        scale.vertical(point.y),
        -scale.depth(point.x),
    );

    const axisGroup = new THREE.Group();
    const axisMaterial = new THREE.LineBasicMaterial({ color: "#6b7280" });
    addLine(axisGroup, [-4, -4, 4], [4, -4, 4], axisMaterial);
    addLine(axisGroup, [-4, -4, 4], [-4, -4, -4], axisMaterial);
    addLine(axisGroup, [-4, -4, 4], [-4, 4, 4], axisMaterial);
    scene.add(axisGroup);

    const gridGroup = new THREE.Group();
    const gridMaterial = new THREE.LineDashedMaterial({
      color: "#9ca3af",
      dashSize: 0.14,
      gapSize: 0.12,
      transparent: true,
      opacity: 0.8,
    });
    drawDashedGrid(gridGroup, axes, scale, gridMaterial);
    scene.add(gridGroup);

    scene.add(makeTextSprite(axes.depth.label, new THREE.Vector3(-4.45, -4.45, -4.55), 1.5));
    scene.add(makeTextSprite(axes.vertical.label, new THREE.Vector3(-4.65, 4.35, 4.15), 1.5));
    scene.add(makeTextSprite(axes.horizontal.label, new THREE.Vector3(4.55, -4.35, 4.15), 1.8));
    addTickLabels(scene, axes, scale);

    const pointById = new Map(points.map((point) => [String(point.id), point]));

    const pointMeshes: THREE.Object3D[] = [];
    const meshById = new Map<string, THREE.Mesh>();
    const pointGroup = new THREE.Group();
    for (const point of points) {
      const geometry =
        point.type === "Holdout" && !isNumericTarget
          ? new THREE.ConeGeometry(0.15, 0.34, 3)
          : new THREE.SphereGeometry(0.13, 20, 20);
      const material = new THREE.MeshStandardMaterial({
        color: colorForPoint(point),
        roughness: 0.55,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(positionOf(point));
      mesh.userData.point = point;
      pointGroup.add(mesh);
      pointMeshes.push(mesh);
      meshById.set(String(point.id), mesh);
    }
    scene.add(pointGroup);

    const lineGroup = new THREE.Group();
    scene.add(lineGroup);
    const outlineGroup = new THREE.Group();
    scene.add(outlineGroup);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.12 };
    const mouse = new THREE.Vector2();
    sceneStateRef.current = {
      lineGroup,
      outlineGroup,
      pointMeshes,
      meshById,
      pointById,
      positionOf,
    };

    const updateMouse = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const [hit] = raycaster.intersectObjects(pointMeshes, false);
      if (hit?.object.userData.point) {
        const point = hit.object.userData.point as Point;
        setTooltip({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 42,
          html: (
            pointTooltip(point)
          ),
        });
        return;
      }

      const [lineHit] = raycaster.intersectObjects(neighborLinesRef.current, false);
      if (lineHit?.object.userData.neighbor) {
        const neighbor = lineHit.object.userData.neighbor as Neighbor;
        setTooltip({
          x: event.clientX - rect.left + 10,
          y: event.clientY - rect.top - 42,
          html: <>Distance: {formatDistance(Number(neighbor.distance))}</>,
        });
        return;
      }

      if (!hit?.object.userData.point) {
        setTooltip(null);
        return;
      }
    };

    const handleClick = () => {
      raycaster.setFromCamera(mouse, camera);
      const [hit] = raycaster.intersectObjects(pointMeshes, false);
      const point = hit?.object.userData.point as Point | undefined;
      if (!point) return;
      setSelectedId((current) =>
        String(current) === String(point.id) ? null : point.id,
      );
    };
    const handlePointerLeave = () => setTooltip(null);

    renderer.domElement.addEventListener("pointermove", updateMouse);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("click", handleClick);

    let animationFrame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      renderer.domElement.removeEventListener("pointermove", updateMouse);
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      renderer.domElement.removeEventListener("click", handleClick);
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material?.dispose();
        }
      });
      sceneStateRef.current = null;
      neighborLinesRef.current = [];
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [
    axisLabels.x,
    axisLabels.y,
    axisLabels.z,
    axisInfo.x,
    axisInfo.y,
    axisInfo.z,
    colorForPoint,
    height,
    isNumericTarget,
    points,
    setSelectedId,
    width,
  ]);

  useEffect(() => {
    const state = sceneStateRef.current;
    if (!state) return;

    clearGroup(state.lineGroup);
    clearGroup(state.outlineGroup);
    neighborLinesRef.current = [];

    const selectedPoint =
      selectedId === null ? null : state.pointById.get(String(selectedId)) ?? null;
    const focalLinePoints = selectedPoint
      ? [selectedPoint]
      : points.filter((point) => point.focal);

    for (const point of points) {
      const mesh = state.meshById.get(String(point.id));
      if (!mesh) continue;

      const isSelected = String(point.id) === String(selectedId);
      const isFocal = isSelected || (selectedId === null && Boolean(point.focal));
      mesh.scale.setScalar(isSelected ? 1.45 : isFocal ? 1.25 : 1);

      if (isFocal) {
        const outline = new THREE.Mesh(
          mesh.geometry.clone(),
          new THREE.MeshBasicMaterial({
            color: "#dc2626",
            side: THREE.BackSide,
          }),
        );
        outline.position.copy(mesh.position);
        outline.scale.setScalar(isSelected ? 1.75 : 1.5);
        state.outlineGroup.add(outline);
      }
    }

    const neighborMaterial = new THREE.LineBasicMaterial({
      color: "#dc2626",
      transparent: true,
      opacity: selectedPoint ? 0.85 : 0.35,
    });
    for (const focalPoint of focalLinePoints) {
      const start = state.positionOf(focalPoint);
      for (const neighbor of (focalPoint.neighbors ?? []).slice(0, currentK)) {
        const neighborPoint = state.pointById.get(String(neighbor.id));
        if (!neighborPoint) continue;
        const line = addLine(
          state.lineGroup,
          start.toArray(),
          state.positionOf(neighborPoint).toArray(),
          neighborMaterial,
        );
        line.userData.neighbor = neighbor;
        neighborLinesRef.current.push(line);
      }
    }

    return () => {
      neighborMaterial.dispose();
    };
  }, [currentK, points, selectedId]);

  if (webglUnavailable) {
    return (
      <PredictorSpace2DFallback
        points={points}
        currentK={currentK}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        width={width}
        height={height}
        axisLabels={axisLabels}
        colorForPoint={colorForPoint}
        isNumericTarget={isNumericTarget}
      />
    );
  }

  return (
    <div
      className="relative rounded-md border border-gray-200"
      style={{ width, height }}
    >
      <div ref={mountRef} />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.html}
        </div>
      )}
    </div>
  );
}

function canCreateWebGLContext() {
  if (typeof document === "undefined") return false;

  const canvas = document.createElement("canvas");
  const attributes: WebGLContextAttributes = {
    antialias: true,
    failIfMajorPerformanceCaveat: false,
  };

  const context = (
    canvas.getContext("webgl2", attributes) ??
    canvas.getContext("webgl", attributes) ??
    canvas.getContext("experimental-webgl", attributes)
  ) as WebGLRenderingContext | WebGL2RenderingContext | null;

  if (!context) return false;

  const loseContext = context.getExtension("WEBGL_lose_context");
  loseContext?.loseContext();
  return true;
}

function PredictorSpace2DFallback({
  points,
  currentK,
  selectedId,
  setSelectedId,
  width,
  height,
  axisLabels,
  colorForPoint,
  isNumericTarget,
}: {
  points: Point[];
  currentK: number;
  selectedId: number | string | null;
  setSelectedId: React.Dispatch<React.SetStateAction<number | string | null>>;
  width: number;
  height: number;
  axisLabels: { x?: string; y?: string; z?: string };
  colorForPoint: (point: Point) => string;
  isNumericTarget: boolean;
}) {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const plot = { left: 58, right: 24, top: 28, bottom: 58 };
  const xRange = extent(points.map((point) => point.x));
  const yRange = extent(points.map((point) => point.y));
  const zRange = extent(points.map((point) => finiteNumber(point.z, 0)));
  const xAxis = buildAxisTicks(undefined, axisLabels.x ?? "X", xRange);
  const yAxis = buildAxisTicks(undefined, axisLabels.y ?? "Y", yRange);
  const spanX = xAxis.max - xAxis.min || 1;
  const spanY = yAxis.max - yAxis.min || 1;
  const spanZ = zRange[1] - zRange[0] || 1;
  const pointById = new Map(points.map((point) => [String(point.id), point]));
  const selectedPoint =
    selectedId === null ? null : pointById.get(String(selectedId)) ?? null;
  const focalLinePoints = selectedPoint
    ? [selectedPoint]
    : points.filter((point) => point.focal);
  const project = (point: Point) => {
    const zRatio = (finiteNumber(point.z, zRange[0]) - zRange[0]) / spanZ;
    return {
      x:
        plot.left +
        ((point.x - xAxis.min) / spanX) * (width - plot.left - plot.right) +
        zRatio * 34,
      y:
        height -
        plot.bottom -
        ((point.y - yAxis.min) / spanY) * (height - plot.top - plot.bottom) -
        zRatio * 24,
    };
  };
  const showTooltip = (event: React.MouseEvent, html: React.ReactNode) => {
    const rect = (event.currentTarget as SVGElement).ownerSVGElement?.getBoundingClientRect();
    setTooltip({
      x: event.clientX - (rect?.left ?? 0) + 10,
      y: event.clientY - (rect?.top ?? 0) - 42,
      html,
    });
  };

  return (
    <div
      className="relative rounded-md border border-gray-200 bg-white"
      style={{ width, height }}
    >
      <svg width={width} height={height} className="overflow-visible">
        <rect
          x={plot.left}
          y={plot.top}
          width={width - plot.left - plot.right}
          height={height - plot.top - plot.bottom}
          fill="#ffffff"
        />
        {xAxis.ticks.map((tick) => {
          const x =
            plot.left +
            ((tick.value - xAxis.min) / spanX) * (width - plot.left - plot.right);
          return (
            <g key={`fallback-x-${tick.value}-${tick.label}`}>
              <line
                x1={x}
                y1={plot.top}
                x2={x}
                y2={height - plot.bottom}
                stroke="#d1d5db"
                strokeDasharray="4 4"
              />
              <text
                x={x}
                y={height - plot.bottom + 18}
                textAnchor="middle"
                fontSize={10}
                fill="#4b5563"
              >
                {tick.label}
              </text>
            </g>
          );
        })}
        {yAxis.ticks.map((tick) => {
          const y =
            height -
            plot.bottom -
            ((tick.value - yAxis.min) / spanY) * (height - plot.top - plot.bottom);
          return (
            <g key={`fallback-y-${tick.value}-${tick.label}`}>
              <line
                x1={plot.left}
                y1={y}
                x2={width - plot.right}
                y2={y}
                stroke="#d1d5db"
                strokeDasharray="4 4"
              />
              <text
                x={plot.left - 9}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="#4b5563"
              >
                {tick.label}
              </text>
            </g>
          );
        })}
        <line
          x1={plot.left}
          y1={height - plot.bottom}
          x2={width - plot.right}
          y2={height - plot.bottom}
          stroke="#9ca3af"
        />
        <line
          x1={plot.left}
          y1={plot.top}
          x2={plot.left}
          y2={height - plot.bottom}
          stroke="#9ca3af"
        />
        <text
          x={width / 2}
          y={height - 16}
          textAnchor="middle"
          fontSize={12}
          fill="#374151"
        >
          {axisLabels.x ?? "X"}
        </text>
        <text
          x={16}
          y={height / 2}
          textAnchor="middle"
          fontSize={12}
          fill="#374151"
          transform={`rotate(-90 16 ${height / 2})`}
        >
          {axisLabels.y ?? "Y"}
        </text>
        {focalLinePoints.flatMap((focalPoint) =>
          (focalPoint.neighbors ?? []).slice(0, currentK).map((neighbor) => {
            const neighborPoint = pointById.get(String(neighbor.id));
            if (!neighborPoint) return null;
            const start = project(focalPoint);
            const end = project(neighborPoint);
            return (
              <g key={`fallback-line-${focalPoint.id}-${neighbor.id}`}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="#dc2626"
                  strokeWidth={1.6}
                  strokeOpacity={selectedPoint ? 0.85 : 0.35}
                />
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="transparent"
                  strokeWidth={10}
                  onMouseMove={(event) =>
                    showTooltip(
                      event,
                      <>Distance: {formatDistance(Number(neighbor.distance))}</>,
                    )
                  }
                  onMouseLeave={() => setTooltip(null)}
                />
              </g>
            );
          }),
        )}
        {points.map((point) => {
          const projected = project(point);
          const isSelected = String(selectedId) === String(point.id);
          const isFocal = isSelected || (selectedId === null && Boolean(point.focal));
          const radius = isSelected ? 6.5 : isFocal ? 5.8 : 4.8;
          return point.type === "Holdout" && !isNumericTarget ? (
            <path
              key={`fallback-point-${point.id}`}
              d={`M ${projected.x} ${projected.y - radius} L ${projected.x + radius} ${projected.y + radius} L ${projected.x - radius} ${projected.y + radius} Z`}
              fill={colorForPoint(point)}
              stroke={isFocal ? "#dc2626" : "#374151"}
              strokeWidth={isFocal ? 2.2 : 1}
              onClick={() =>
                setSelectedId((current) =>
                  String(current) === String(point.id) ? null : point.id,
                )
              }
              onMouseMove={(event) =>
                showTooltip(event, pointTooltip(point))
              }
              onMouseLeave={() => setTooltip(null)}
            />
          ) : (
            <circle
              key={`fallback-point-${point.id}`}
              cx={projected.x}
              cy={projected.y}
              r={radius}
              fill={colorForPoint(point)}
              stroke={isFocal ? "#dc2626" : "#374151"}
              strokeWidth={isFocal ? 2.2 : 1}
              onClick={() =>
                setSelectedId((current) =>
                  String(current) === String(point.id) ? null : point.id,
                )
              }
              onMouseMove={(event) =>
                showTooltip(event, pointTooltip(point))
              }
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </svg>
      <div data-export-ignore className="absolute left-3 top-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
        3D rendering unavailable. Showing a 2D projection.
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.html}
        </div>
      )}
    </div>
  );
}

type TooltipLayerHandle = {
  setTooltip: (value: TooltipState) => void;
};

const TooltipLayer = React.forwardRef<TooltipLayerHandle>(function TooltipLayer(
  _props,
  ref,
) {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  React.useImperativeHandle(ref, () => ({ setTooltip }), []);

  if (!tooltip) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-lg"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      {tooltip.html}
    </div>
  );
});

function pointTooltip(point: Point) {
  const shownLabel = point.type === "Holdout" ? "Predicted" : "Target";

  return (
    <>
      <strong>Label:</strong> {point.label ?? point.id}
      <br />
      <strong>{shownLabel}:</strong> {point.target}
    </>
  );
}

function extent(values: number[]): [number, number] {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return [0, 1];

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  return Math.abs(max - min) < Number.EPSILON ? [min - 0.5, max + 0.5] : [min, max];
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    if (!child) continue;
    group.remove(child);

    child.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else {
        material?.dispose();
      }
    });
  }
}

function createScale(min: number, max: number) {
  const span = max - min || 1;
  return (value: number) => ((value - min) / span) * 8 - 4;
}

type AxisTick = {
  value: number;
  label: string;
};

type RenderAxis = {
  label: string;
  min: number;
  max: number;
  ticks: AxisTick[];
};

function buildAxisTicks(
  axis: AxisInfo | undefined,
  fallbackLabel: string,
  range: [number, number],
): RenderAxis {
  const explicitTicks = (axis?.ticks ?? [])
    .map((tick) => ({
      value: Number(tick.value),
      label: String(tick.label ?? ""),
    }))
    .filter((tick) => Number.isFinite(tick.value) && tick.label);
  if (explicitTicks.length > 0) {
    const isDiscreteAxis =
      axis?.measure === "nominal" || axis?.measure === "ordinal";
    const firstTick = explicitTicks[0].value;
    const lastTick = explicitTicks[explicitTicks.length - 1].value;

    return {
      label: axis?.name ?? fallbackLabel,
      min: isDiscreteAxis ? Math.min(0, firstTick) : Math.min(range[0], firstTick),
      max: isDiscreteAxis
        ? Math.max(range[1], lastTick + 0.5)
        : Math.max(range[1], lastTick),
      ticks: explicitTicks,
    };
  }

  const categories = axis?.categories?.filter(Boolean) ?? [];
  if (categories.length > 0) {
    return {
      label: axis?.name ?? fallbackLabel,
      min: 0,
      max: Math.max(1, categories.length - 1),
      ticks: categories.map((label, value) => ({ value, label })),
    };
  }

  const ticks = createNiceTicks(range[0], range[1]);
  return {
    label: axis?.name ?? fallbackLabel,
    min: range[0],
    max: range[1],
    ticks: ticks.map((value) => ({ value, label: formatTick(value) })),
  };
}

/**
 * Value range drawn by the 2D chart. It covers every point and every tick
 * (nice ticks can extend past the data), and gives discrete axes half a
 * category of room so the first and last categories are not on the axis.
 */
export function plotDomain(
  axis: RenderAxis,
  info: AxisInfo | undefined,
  values: number[],
): [number, number] {
  const covered = [...values, ...axis.ticks.map((tick) => tick.value)].filter(
    (value) => Number.isFinite(value),
  );
  if (covered.length === 0) return [axis.min, axis.max > axis.min ? axis.max : axis.min + 1];

  let min = Math.min(...covered);
  let max = Math.max(...covered);
  const isDiscrete =
    info?.measure === "nominal" ||
    info?.measure === "ordinal" ||
    (info?.categories?.filter(Boolean).length ?? 0) > 0;
  if (isDiscrete || max - min < Number.EPSILON) {
    min -= 0.5;
    max += 0.5;
  }
  return [min, max];
}

function drawDashedGrid(
  group: THREE.Group,
  axes: { depth: RenderAxis; vertical: RenderAxis; horizontal: RenderAxis },
  scale: {
    depth: (value: number) => number;
    vertical: (value: number) => number;
    horizontal: (value: number) => number;
  },
  material: THREE.LineDashedMaterial,
) {
  for (const tick of axes.depth.ticks) {
    const depth = -scale.depth(tick.value);
    addLine(group, [-4, -4, depth], [4, -4, depth], material);
    addLine(group, [-4, -4, depth], [-4, 4, depth], material);
  }

  for (const tick of axes.horizontal.ticks) {
    const horizontal = scale.horizontal(tick.value);
    addLine(group, [horizontal, -4, 4], [horizontal, -4, -4], material);
    addLine(group, [horizontal, -4, 4], [horizontal, 4, 4], material);
  }

  for (const tick of axes.vertical.ticks) {
    const vertical = scale.vertical(tick.value);
    addLine(group, [-4, vertical, 4], [4, vertical, 4], material);
    addLine(group, [-4, vertical, 4], [-4, vertical, -4], material);
  }
}

function addTickLabels(
  scene: THREE.Scene,
  axes: { depth: RenderAxis; vertical: RenderAxis; horizontal: RenderAxis },
  scale: {
    depth: (value: number) => number;
    vertical: (value: number) => number;
    horizontal: (value: number) => number;
  },
) {
  for (const tick of axes.depth.ticks) {
    scene.add(
      makeTextSprite(
        tick.label,
        new THREE.Vector3(-4.45, -4.32, -scale.depth(tick.value)),
        1.05,
      ),
    );
  }

  for (const tick of axes.vertical.ticks) {
    scene.add(
      makeTextSprite(
        tick.label,
        new THREE.Vector3(-4.55, scale.vertical(tick.value), 4.25),
        1.05,
      ),
    );
  }

  for (const tick of axes.horizontal.ticks) {
    scene.add(
      makeTextSprite(
        tick.label,
        new THREE.Vector3(scale.horizontal(tick.value), -4.32, 4.28),
        1.05,
      ),
    );
  }
}

function addLine(
  group: THREE.Group,
  start: number[],
  end: number[],
  material: THREE.LineBasicMaterial | THREE.LineDashedMaterial,
): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start[0], start[1], start[2]),
    new THREE.Vector3(end[0], end[1], end[2]),
  ]);
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  group.add(line);
  return line;
}

function makeTextSprite(text: string, position: THREE.Vector3, widthScale = 1.6) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "28px sans-serif";
    context.fillStyle = "#374151";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(widthScale, 0.4, 1);
  return sprite;
}

function AxisPicker({
  axes,
  selectedAxisIndexes,
  setSelectedAxisIndexes,
}: {
  axes: AxisInfo[];
  selectedAxisIndexes: number[];
  setSelectedAxisIndexes: React.Dispatch<React.SetStateAction<number[]>>;
}) {
  const axisSlots = ["X", "Y", "Z"];

  return (
    <div data-export-ignore className="mb-3 flex flex-wrap items-center justify-center gap-2 text-xs">
      {axisSlots.map((slot, slotIndex) => {
        const selectedIndex = selectedAxisIndexes[slotIndex] ?? slotIndex;
        const replacementIndexes = axes
          .map((_, index) => index)
          .filter(
            (index) =>
              index === selectedIndex || !selectedAxisIndexes.includes(index),
          );

        return (
          <label key={slot} className="flex items-center gap-1">
            <span className="font-semibold">{slot}</span>
            <select
              value={selectedIndex}
              onChange={(event) => {
                const nextIndex = Number(event.target.value);
                setSelectedAxisIndexes((current) =>
                  current.map((value, index) =>
                    index === slotIndex ? nextIndex : value,
                  ),
                );
              }}
              className="h-8 min-w-28 rounded border border-gray-300 bg-white px-2 text-xs"
            >
              {replacementIndexes.map((axisIndex) => (
                <option key={`${slot}-${axisIndex}`} value={axisIndex}>
                  {axes[axisIndex]?.name ?? `Variable ${axisIndex + 1}`}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

function LegendSection({ title }: { title: string }) {
  return <div className="mb-1 mt-2 font-bold first:mt-0">{title}</div>;
}

function LegendCircle({
  label,
  fill = "#ffffff",
  outline = "#1f2937",
}: {
  label: string;
  fill?: string;
  outline?: string;
}) {
  return (
    <div className="mb-1 flex items-center gap-2">
      <span
        className="inline-block h-3 w-3 rounded-full border-2"
        style={{ background: fill, borderColor: outline }}
      />
      <span>{label}</span>
    </div>
  );
}

function NumericGradientLegend({
  ticks,
  min,
  max,
}: {
  ticks: number[];
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-stretch gap-2">
      <div
        className="h-32 w-4 rounded-sm border border-gray-300"
        style={{
          background: "linear-gradient(to bottom, #dc2626, #f59e0b, #2563eb)",
        }}
      />
      <div className="flex h-32 flex-col justify-between">
        {ticks.length > 0 ? (
          ticks.map((tick) => (
            <span key={`target-tick-${tick}`}>
              {formatNumericTargetTick(tick)}
            </span>
          ))
        ) : (
          <>
            <span>{formatNumericTargetTick(max)}</span>
            <span>{formatNumericTargetTick(min)}</span>
          </>
        )}
      </div>
    </div>
  );
}
