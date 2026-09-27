"use client";
import React, { useState, useEffect } from "react";
import DataTableRenderer from "@/components/Output/Table/DataTableRenderer";
import { Card } from "@/components/ui/card";
import dynamic from "next/dynamic";
import { useResultStore } from "@/stores/useResultStore";
import GeneralChartContainer from "@/components/Output/Chart/GeneralChartContainer";
import KNNKPredictorSelectionChart from "@/components/Modals/Analyze/Classify/nearest-neighbor/components/KNNKPredictorSelectionChart";
import KNNOutputDownloadMenu, {
  getKnnDownloadKind,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/components/KNNOutputDownloadMenu";
import { KNN_RESULT_ANALYTIC_TITLE } from "@/components/Modals/Analyze/Classify/nearest-neighbor/constants/nearest-neighbor-output";
// KNN predictor space chart is a bit heavy to load, so we dynamically import it with a loading state
const KNNPredictorSpaceChart = dynamic(
  () => import("@/components/Modals/Analyze/Classify/nearest-neighbor/components/KNNPredictorSpaceChart"),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 text-sm text-muted-foreground">
        Loading predictor space...
      </div>
    ),
  },
);
const KMedoidsOutputRenderer = dynamic(
  () => import("@/components/Modals/Analyze/Clustering/k-medoids-cluster/components/OutputRenderer").then(m => ({ default: m.KMedoidsOutputRenderer })),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted-foreground">Loading...</div> }
);
const TiptapEditor = dynamic(
  () => import("@/components/Output/Editor/TiptapEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="border rounded-md p-2 min-h-[120px] bg-background w-full" />
    ),
  }
);
import { Edit, ChevronDown, ChevronUp } from "lucide-react";
import TextRenderer from "@/components/Output/text/text-renderer";
import { getStatisticsComponent } from "@/components/Output/Statistics";
import { checkRenderCompletionTargets } from "@/lib/analysisTiming";

const ResultOutput: React.FC = () => {
  const { logs, updateStatistic } = useResultStore();

  const [editingDescriptionId, setEditingDescriptionId] = useState<
    number | null
  >(null);
  const [descriptionValues, setDescriptionValues] = useState<
    Record<number, string>
  >({});
  const [saveStatus, setSaveStatus] = useState<Record<number, string>>({});

  // Track which tables are expanded to full height
  const [expandedTables, setExpandedTables] = useState<Record<number, boolean>>({});

  const toggleTable = (statId: number) => {
    setExpandedTables((prev) => ({
      ...prev,
      [statId]: !prev[statId],
    }));
  };

  // Effect to load results when component mounts
  useEffect(() => {
    const loadResults = async () => {
      try {
        await useResultStore.getState().loadResults();
      } catch (error) {
        console.error("Failed to load results:", error);
      }
    };
    loadResults();
  }, []);

  // Effect to scroll to a specific log when the page loads with a hash
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    // Use a timeout to ensure the element is rendered before scrolling
    const timer = setTimeout(() => {
      const id = hash.replace("#", "");
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);

    return () => clearTimeout(timer); // Cleanup the timeout
  }, [logs]); // Rerunning when logs change ensures we can scroll to new content

  // Resolves the "end-to-end response time" metric for any pending Analyze
  // run once its expected statistics have all arrived and been painted.
  useEffect(() => {
    checkRenderCompletionTargets(logs);
  }, [logs]);

  const handleDescriptionChange = (statId: number, value: string) => {
    // Trim leading/trailing whitespace but keep empty paragraphs for line breaks
    const trimmed = value.trim();

    setDescriptionValues((prev) => ({
      ...prev,
      [statId]: trimmed,
    }));
  };

  const handleSaveDescription = async (statId: number) => {
    try {
      const description = descriptionValues[statId];
      if (description !== undefined) {
        setSaveStatus((prev) => ({ ...prev, [statId]: "saving" }));
        // Save to database
        await updateStatistic(statId, { description });
        // Update status flag
        setSaveStatus((prev) => ({ ...prev, [statId]: "saved" }));
        // Reset status and exit edit mode after a short delay
        setTimeout(() => {
          setSaveStatus((prev) => ({ ...prev, [statId]: "" }));
          setEditingDescriptionId(null);
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to update description:", error);
      setSaveStatus((prev) => ({ ...prev, [statId]: "error" }));
    }
  };

  const handleEditClick = (statId: number, currentDescription: string) => {
    setDescriptionValues((prev) => ({
      ...prev,
      [statId]: currentDescription || "",
    }));
    setEditingDescriptionId(statId);
  };

  return (
    <div className="p-4 md:p-6 w-full max-w-full" data-testid="results-content">
      {logs.length === 0 ? (
        <div className="text-center text-muted-foreground py-10" data-testid="no-results-message">
          No data available
        </div>
      ) : (
        <div className="space-y-10" data-testid="results-container">
          {logs.map((log) => (
            <div
              key={log.id}
              id={`log-${log.id}`}
              className="space-y-6 scroll-mt-20"
              data-testid={`result-log-${log.id}`}
            >
              <div className="text-sm font-medium text-muted-foreground px-1" data-testid={`log-header-${log.id}`}>
                Log {log.id}: {log.log}
              </div>
              {log.analytics?.map((analytic) => (
                <Card
                  key={analytic.id}
                  className="p-4 md:p-6 shadow-lg hover:shadow-xl transition-shadow border-t-4 border-primary/20"
                  data-testid={`result-analytic-${analytic.id}`}
                >
                  <div className="text-xl font-bold text-card-foreground mb-4 border-b pb-2" data-testid={`analytic-title-${analytic.id}`}>
                    {analytic.title}
                  </div>
                  {analytic.note && (
                    <div className="text-sm italic text-muted-foreground mb-6 bg-muted/30 p-2 rounded-md" data-testid={`analytic-note-${analytic.id}`}>
                      {analytic.note}
                    </div>
                  )}
                  {(() => {
                    const renderedComponents = new Set<string>();
                    return (
                      analytic.statistics?.map((stat) => {
                        const isFirstAppearance = !renderedComponents.has(
                          stat.components
                        );
                        if (isFirstAppearance) {
                          renderedComponents.add(stat.components);
                        }
                        const statId = stat.id ?? 0;
                        const isEditing = editingDescriptionId === statId;
                        const status = saveStatus[statId] ?? "";
                        const isFactorAnalysisChart = (stat.components === 'ScreePlot' || stat.components === 'LoadingPlot') &&
                          analytic.title?.toLowerCase().includes('factor analysis');
                        const outputElementId = `output-${analytic.id}-${stat.id}`;
                        const knnDownloadKind =
                          analytic.title === KNN_RESULT_ANALYTIC_TITLE
                            ? getKnnDownloadKind(stat.output_data)
                            : null;

                        return (
                          <div key={stat.id} className={`space-y-4 ${
                            isFactorAnalysisChart ? 'mt-16' : ''
                          }`}>
                            {isFirstAppearance && (
                              <div className={`text-base font-semibold text-card-foreground mb-3 flex items-center ${
                                isFactorAnalysisChart ? 'mt-8' : 'mt-8'
                              }`} data-testid={`component-header-${stat.components.replace(/\s+/g, '-').toLowerCase()}`}>
                                <div className="h-4 w-1 bg-primary rounded-full mr-2"></div>
                                {stat.components}
                              </div>
                            )}
                            {knnDownloadKind && (
                              <KNNOutputDownloadMenu
                                kind={knnDownloadKind}
                                title={stat.title}
                                targetId={outputElementId}
                              />
                            )}
                            <div
                              id={outputElementId}
                              className={`${
                                isFactorAnalysisChart ? 'mb-16' : 'mb-6'
                              } rounded-md ${
                                !isFirstAppearance ? "mt-8" : ""
                              }`}
                              style={{
                                marginBottom: isFactorAnalysisChart ? '4rem' : undefined
                              }}
                              data-testid={`result-output-${analytic.id}-${stat.id}`}
                            >
                              {(() => {
                                // Check if there is a specific component for this statistic
                                const SpecificComponent = getStatisticsComponent(stat.components);
                                if (SpecificComponent) {
                                  return (
                                    <div data-testid={`result-component-${stat.id}`}>
                                      <SpecificComponent data={stat.output_data} />
                                    </div>
                                  );
                                }

                                let parsedData;
                                try {
                                  parsedData =
                                    typeof stat.output_data === "string"
                                      ? JSON.parse(stat.output_data)
                                      : stat.output_data;
                                } catch (error) {
                                  console.error(
                                    "Failed to parse output_data:",
                                    error
                                  );
                                  return (
                                    <div className="text-sm text-destructive p-2 bg-destructive/10 rounded-md">
                                      Invalid data: JSON format is incorrect
                                    </div>
                                  );
                                }

                                if (parsedData.tables) {
                                  const isExpandedTable = expandedTables[statId] ?? false;

                                  // Determine if the rendered table is "long" enough to warrant a toggle (simple heuristic)
                                  const isLongTable = parsedData.tables.some(
                                    (tbl: { rows?: unknown[] }) => (tbl.rows?.length ?? 0) > 15
                                  );

                                  return (
                                    <div>
                                      <div
                                        className={`${
                                          !isExpandedTable && isLongTable
                                            ? "max-h-[500px] overflow-y-hidden"
                                            : ""
                                        } overflow-x-auto pb-2`}
                                        data-testid={`result-table-${stat.id}`}
                                      >
                                        <DataTableRenderer data={stat.output_data} />
                                      </div>
                                      {isLongTable && (
                                        <button
                                          type="button"
                                          onClick={() => toggleTable(statId)}
                                          className="mt-2 text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                                          data-testid={`toggle-table-${statId}`}
                                        >
                                          {isExpandedTable ? (
                                            <>
                                              <ChevronUp className="h-3 w-3" />
                                              Show Less
                                            </>
                                          ) : (
                                            <>
                                              <ChevronDown className="h-3 w-3" />
                                              Show Full
                                            </>
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  );
                                } else if (
                                  parsedData.charts?.[0]?.chartType ===
                                  "KNN Predictor Space"
                                ) {
                                  return (
                                    <div data-testid={`result-chart-${stat.id}`}>
                                      <KNNPredictorSpaceChart
                                        data={stat.output_data}
                                      />
                                    </div>
                                  );
                                } else if (
                                  parsedData.charts?.[0]?.chartType ===
                                  "KNN k and Predictor Selection" ||
                                  parsedData.charts?.[0]?.chartType ===
                                  "KNN k Selection Error Log"
                                ) {
                                  return (
                                    <div data-testid={`result-chart-${stat.id}`}>
                                      <KNNKPredictorSelectionChart
                                        data={stat.output_data}
                                      />
                                    </div>
                                  );
                                } else if (parsedData.charts) {
                                  return (
                                    <div 
                                      data-testid={`result-chart-${stat.id}`}
                                      className="w-full min-h-[500px] pb-12 mb-12 overflow-visible"
                                      style={{ display: 'block', marginBottom: '3rem' }}
                                    >
                                      <GeneralChartContainer
                                        data={stat.output_data}
                                      />
                                    </div>
                                  );
                                } else if (parsedData.text) {
                                  return (
                                    <div data-testid={`result-text-${stat.id}`}>
                                      <TextRenderer textData={parsedData.text} />
                                    </div>
                                  );
                                } else if (parsedData.customRenderer === "KMedoidsOutputRenderer" && parsedData.data) {
                                  return (
                                    <div data-testid={`result-kmedoids-${stat.id}`}>
                                      <KMedoidsOutputRenderer
                                        output={parsedData.data}
                                        variables={parsedData.data.variables ?? []}
                                      />
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div className="text-sm text-destructive p-2 bg-destructive/10 rounded-md">
                                      Invalid data: Unrecognized format
                                    </div>
                                  );
                                }
                              })()}
                            </div>
                            {!isFactorAnalysisChart && (
                              <div className="mt-4 mb-10 relative">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-xs font-medium text-muted-foreground" data-testid={`description-label-${stat.id}`}>
                                    Description
                                  </div>
                                  {!isEditing ? (
                                    <button
                                      className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50"
                                      onClick={() =>
                                        handleEditClick(
                                          statId,
                                          stat.description || ""
                                        )
                                      }
                                      type="button"
                                      data-testid={`edit-description-button-${stat.id}`}
                                    >
                                    <Edit className="h-3 w-3" />
                                    Edit
                                  </button>
                                ) : (
                                  <div className="text-xs" data-testid={`save-status-${stat.id}`}>
                                    {status === "saving" && (
                                      <span className="text-yellow-500">
                                        Saving...
                                      </span>
                                    )}
                                    {status === "saved" && (
                                      <span className="text-green-500">
                                        Saved!
                                      </span>
                                    )}
                                    {status === "error" && (
                                      <span className="text-red-500">
                                        Failed to save
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <TiptapEditor
                                value={
                                  isEditing
                                    ? descriptionValues[statId] || ""
                                    : stat.description || ""
                                }
                                onChange={(value) =>
                                  handleDescriptionChange(statId, value)
                                }
                                editable={isEditing}
                                onSave={
                                  isEditing
                                    ? () => handleSaveDescription(statId)
                                    : undefined
                                }
                                placeholder="Write description here..."
                                id={`editor-${statId}`}
                                data-testid={`description-editor-${stat.id}`}
                              />
                            </div>
                            )}
                          </div>
                        );
                      }) ?? null
                    );
                  })()}
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResultOutput;
