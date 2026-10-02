// nearest-neighbor-analysis-output.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-nullish-coalescing -- Chart payloads preserve empty-string fallback semantics from deserialized WASM results. */
import type { KNNFinalResultType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor-worker";
import type { Table } from "@/types/Table";
import { useResultStore } from "@/stores/useResultStore";
import { ChartService } from "@/services/chart/ChartService";
import { KNN_RESULT_ANALYTIC_TITLE } from "../constants/nearest-neighbor-output";
import { buildNeighborDetails } from "./nearest-neighbor-analysis-formatter";
import {
  describeClassificationTable,
  describeErrorSummary,
  describeFeatureSelection,
  describeKSelection,
  describePredictorImportance,
} from "./nearest-neighbor-analysis-interpretation";

export async function resultNearestNeighbor({
  formattedResult,
  rawResult,
  configData,
}: KNNFinalResultType) {
  const { addLog, addAnalytic, addStatistic: storeAddStatistic } =
    useResultStore.getState();
  // Each added statistic re-renders the output viewer. Yielding after each one
  // lets the browser handle input and paint between them instead of running
  // all of them as one long task.
  const addStatistic: typeof storeAddStatistic = async (...args) => {
    const statisticId = await storeAddStatistic(...args);
    await yieldToMain();
    return statisticId;
  };

    const findTable = (key: string) => {
      const foundTable = formattedResult.tables.find(
        (table: Table) => table.key === key,
      );
      return foundTable ? JSON.stringify({ tables: [foundTable] }) : null;
    };
    const findTableObject = (key: string) =>
      formattedResult.tables.find((table: Table) => table.key === key);

    const nearestNeighborAnalysisResult = async () => {
      const titleMessage = "Nearest Neighbor Analysis";
      const logId = await addLog({ log: titleMessage });

      const nearestNeighborAnalysisResultId = await addAnalytic(logId, {
        title: KNN_RESULT_ANALYTIC_TITLE,
        note: "",
      });

      const systemSettings = findTable("system_settings");
      if (systemSettings) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `System Settings`,
          description: `System Settings`,
          output_data: systemSettings,
          components: `System Settings`,
        });
      }

      const caseProcessingSummary = findTable("case_processing_summary");
      if (caseProcessingSummary) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Case Processing Summary`,
          description: `Case Processing Summary`,
          output_data: caseProcessingSummary,
          components: `Case Processing Summary`,
        });
      }

      // SPSS names this chart "k and Predictor Selection" when k is chosen
      // automatically and "Predictor Selection Error Log" when k is fixed.
      const predictorSelectionTitle = configData?.neighbors?.AutoSelection
        ? "k and Predictor Selection"
        : "Predictor Selection Error Log";
      const kAndPredictorSelectionChart = createKAndPredictorSelectionChart(
        rawResult,
        predictorSelectionTitle,
      );
      if (kAndPredictorSelectionChart) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: predictorSelectionTitle,
          description: describeFeatureSelection(rawResult),
          output_data: JSON.stringify(kAndPredictorSelectionChart),
          components: predictorSelectionTitle,
        });
      }

      const kSelectionErrorLogLineChart = createKSelectionErrorLogLineChart(
        rawResult?.k_selection_chart,
      );
      if (kSelectionErrorLogLineChart) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `k Selection Error Log`,
          description: describeKSelection(rawResult?.k_selection_chart),
          output_data: JSON.stringify(kSelectionErrorLogLineChart),
          components: `k Selection Error Log`,
        });
      }

      const predictorImportance = findTable("predictor_importance");
      if (predictorImportance) {
        const predictorImportanceDescription = describePredictorImportance(
          rawResult?.predictor_importance,
        );
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Predictor Importance`,
          description: predictorImportanceDescription,
          output_data: predictorImportance,
          components: `Predictor Importance`,
        });

        const predictorImportanceChart = createPredictorImportanceChart(
          findTableObject("predictor_importance"),
        );

        if (predictorImportanceChart) {
          await addStatistic(nearestNeighborAnalysisResultId, {
            title: `Predictor Importance Chart`,
            description: predictorImportanceDescription,
            output_data: JSON.stringify(predictorImportanceChart),
            components: `Predictor Importance Chart`,
          });
        }
      }

      const confusionMatrix = findTable("confusion_matrix");
      if (confusionMatrix) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Classification Table`,
          description: describeClassificationTable(rawResult?.classification_table),
          output_data: confusionMatrix,
          components: `Classification Table`,
        });
      }

      const errorSummary = findTable("error_summary");
      if (errorSummary) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Error Summary`,
          description: describeErrorSummary(
            rawResult?.error_summary,
            rawResult?.classification_table,
          ),
          output_data: errorSummary,
          components: `Error Summary`,
        });
      }

      const predictorSpaceChart = createPredictorSpaceChart(
        rawResult?.predictor_space,
        Boolean(configData?.output?.PeersChart),
        Boolean(configData?.output?.QuadrantMap),
      );

      if (predictorSpaceChart) {
        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Predictor Space`,
          description: `Predictor Space`,
          output_data: JSON.stringify(predictorSpaceChart),
          components: `Predictor Space`,
        });
      }

      if (rawResult?.nearest_neighbors) {
        const neighborDetailsTable = buildNeighborDetails(
          rawResult.nearest_neighbors,
        );

        await addStatistic(nearestNeighborAnalysisResultId, {
          title: `Neighbor Details`,
          description: `Neighbor Details`,
          output_data: JSON.stringify({ tables: [neighborDetailsTable] }),
          components: `Neighbor Details`,
        });
      }
    };
  await nearestNeighborAnalysisResult();
}

function yieldToMain() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Seven significant digits: far below one pixel and the 4-decimal tooltips. */
function chartNumber(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? Number(numericValue.toPrecision(7))
    : Number.NaN;
}

export function createPredictorSpaceChart(
  predictorSpace?: any,
  peersChartEnabled = false,
  quadrantMapEnabled = false,
) {
  const dimension = predictorSpace?.dimensions?.find(
    (item: any) => Array.isArray(item.points) && item.points.length > 0,
  );

  if (!dimension) return null;

  const labels = splitDimensionName(dimension.name);
  const axes = Array.isArray(dimension.axes) ? dimension.axes : [];
  const displayedAxisCount = Math.min(3, axes.length > 0 ? axes.length : labels.length);
  const displayedDimensions = Math.max(1, Math.min(3, displayedAxisCount));
  const hasZ =
    displayedDimensions >= 3 &&
    Boolean(axes[2]?.name ?? labels[2]) &&
    dimension.points.some((point: any) => Number.isFinite(Number(point.z)));
  // Only the fields the chart reads, with coordinates at chart precision. The
  // payload is parsed and stored on the main thread, and with every case as a
  // point (plus k neighbors each) full-precision numbers and unused fields
  // made it several times larger than needed.
  const chartData = dimension.points
    .map((point: any) => {
      const label = point.label ?? point.id;
      // Number(null) is 0, which would store a z for every 1D/2D point.
      const z = point.z == null ? Number.NaN : chartNumber(point.z);
      return {
        id: point.id,
        ...(String(label) !== String(point.id) ? { label } : {}),
        x: chartNumber(point.x),
        y: chartNumber(point.y),
        ...(Number.isFinite(z) ? { z } : {}),
        type: point.point_type,
        target: point.target_label || String(point.target_value),
        targetNumber: Number.isFinite(Number(point.target_number))
          ? Number(point.target_number)
          : null,
        predictorValues: Array.isArray(point.predictor_values)
          ? point.predictor_values.map(chartNumber)
          : [chartNumber(point.x), chartNumber(point.y), z],
        ...(point.focal ? { focal: true } : {}),
        neighbors: Array.isArray(point.neighbors)
          ? point.neighbors.map((neighbor: any) => ({
              id: neighbor.id,
              distance: chartNumber(neighbor.distance),
            }))
          : [],
      };
    })
    .filter((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (!chartData.length) return null;

  return {
    charts: [
      {
        chartType: "KNN Predictor Space",
        chartMetadata: {
          axisInfo: {},
          title: "Predictor Space",
          subtitle: `Built Model: ${predictorSpace.model_predictors ?? chartData.length} selected predictors, K = ${predictorSpace.k_value ?? ""}`,
          description: "Select points to use as focal records",
          titleFontSize: 16,
          subtitleFontSize: 12,
        },
        chartData,
        chartConfig: {
          width: 900,
          height: 640,
          chartColor: [],
          useAxis: true,
          useLegend: true,
          axisLabels: {
            x: axes[0]?.name ?? labels[0] ?? "X",
            y: axes[1]?.name ?? labels[1] ?? "Y",
            z: hasZ ? axes[2]?.name ?? labels[2] : "",
          },
          axisInfo: {
            x: axes[0] ?? { name: labels[0] ?? "X", measure: "", categories: [], ticks: [] },
            y: axes[1] ?? { name: labels[1] ?? "Y", measure: "", categories: [], ticks: [] },
            z: hasZ
              ? axes[2] ?? { name: labels[2] ?? "Z", measure: "", categories: [], ticks: [] }
              : undefined,
          },
          predictorSpace: {
            selectedK: Number(predictorSpace.k_value ?? 1),
            modelPredictors: Number(predictorSpace.model_predictors ?? 0),
            actualPredictors: Number(
              predictorSpace.actual_predictors ?? predictorSpace.model_predictors ?? 0,
            ),
            targetVariable: predictorSpace.target_variable ?? "Target",
            targetMeasure: predictorSpace.target_measure ?? "",
            hasFocalCaseIdentifier: Boolean(predictorSpace.has_focal_case_identifier),
            displayedDimensions,
            availableAxes: axes,
            instruction: "Select points to use as focal records",
            peersChartEnabled,
            quadrantMapEnabled,
          },
        },
      },
    ],
  };
}

function createKSelectionErrorLogLineChart(chart?: any) {
  const isRegression = String(chart?.metric_name ?? chart?.metricName ?? "")
    .toLowerCase()
    .includes("sse");
  const chartData = (chart?.candidates ?? [])
    .map((candidate: any) => {
      const rawError = Number(candidate.average_error ?? candidate.averageError);
      return {
        model: Number(candidate.k),
        value: isRegression ? rawError : rawError / 100,
        rawValue: rawError,
      };
    })
    .filter((candidate: any) => (
      Number.isFinite(candidate.model) && Number.isFinite(candidate.value)
    ));

  if (!chartData.length) return null;

  return {
    charts: [
      {
        chartType: "KNN k Selection Error Log",
        chartData,
        chartMetadata: {
          title: "k Selection Error Log",
          description: isRegression
            ? "Cross-validation SSE by number of neighbors"
            : "Cross-validation error rate by number of neighbors",
        },
        chartConfig: {
          width: 900,
          height: 520,
          axisLabels: {
            x: "Number of Nearest Neighbor (k)",
            y: isRegression ? "Sum Square of Error (SSE)" : "Error Rate",
          },
          kAndPredictorSelection: {
            mode: isRegression ? "regression" : "classification",
            selectedK: chart?.selected_k ?? chart?.selectedK,
            showPointLabels: false,
          },
        },
      },
    ],
  };
}

function createPredictorImportanceChart(table?: Table) {
  const chartData = table?.rows
    .map((row) => ({
      category: String(row.predictor ?? row.rowHeader?.[0] ?? ""),
      value: toNumber(row.importance),
    }))
    .filter((row) => row.category && Number.isFinite(row.value));

  if (!chartData?.length) return null;

  return ChartService.createChartJSON({
    chartType: "Horizontal Bar Chart",
    chartData,
    chartVariables: { x: ["Importance"], y: ["Predictor"] },
    chartMetadata: {
      title: "Predictor Importance",
      description: "Relative importance of each predictor in the KNN model",
    },
    chartConfig: {
      axisLabels: {
        x: "Importance",
        y: "Predictor",
      },
      axisScaleOptions: {
        x: {
          min: "0",
          max: "1",
          majorIncrement: "0.2",
        },
      },
      showValueTooltip: true,
      useLegend: false,
    },
  });
}

function createKAndPredictorSelectionChart(
  rawResult?: any,
  title = "k and Predictor Selection",
) {
  const steps = rawResult?.feature_selection_steps;

  if (!Array.isArray(steps) || !steps.length) return null;

  const isRegression =
    rawResult?.predictor_space?.target_measure === "scale" ||
    (!rawResult?.classification_table && !rawResult?.error_summary);
  const chartData = steps
    .map((step: any, index: number) => {
      const rawError = toNumber(step.trial_error ?? step.trialError);
      return {
        model: index + 1,
        predictor:
        step.selected_feature ??
        step.selectedFeature ??
        `Step ${step.step_number ?? step.stepNumber ?? index + 1}`,
        value: isRegression ? rawError : rawError / 100,
        rawValue: rawError,
      };
    })
    .filter((row: any) => row.predictor && Number.isFinite(row.value));

  if (!chartData.length) return null;

  const selectedK = (rawResult?.k_feature_selection_summary ?? []).find(
    (summary: any) => summary.selected,
  )?.k;

  if (selectedK === null || selectedK === undefined) return null;

  return {
    charts: [
      {
        chartType: "KNN k and Predictor Selection",
        chartData,
        chartMetadata: {
          title,
          subtitle: `k = ${selectedK}`,
          description: isRegression
            ? "Feature selection SSE by model"
            : "Feature selection error rate by model",
        },
        chartConfig: {
          width: 900,
          height: 520,
          axisLabels: {
            x: "Model",
            y: isRegression ? "Sum Square of Error (SSE)" : "Error Rate",
          },
          kAndPredictorSelection: {
            mode: isRegression ? "regression" : "classification",
            selectedK,
            showPointLabels: true,
          },
        },
      },
    ],
  };
}

function splitDimensionName(name: string | undefined) {
  return String(name ?? "X vs Y").split(" vs ").filter(Boolean);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;

  return Number(value.replace(/,/g, "").replace("%", ""));
}
