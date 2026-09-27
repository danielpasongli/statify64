import React from "react";
import type {
  KNNOutputProps,
  KNNOutputType,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldHelp } from "./field-help";
import { normalizeOutputCheckboxValue } from "@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborOutputRules";

export const KNNOutput = ({
  updateFormData,
  data,
  showFieldHelp = false,
}: KNNOutputProps) => {
  const outputState: KNNOutputType = {
    ...data,
    CaseSummary: data.CaseSummary ?? true,
    PredictorSpace: true,
    ShowNeighborDetail: data.ShowNeighborDetail ?? false,
    PeersChart: data.PeersChart ?? false,
    QuadrantMap: data.QuadrantMap ?? false,
    ChartAndTable: data.ChartAndTable ?? true,
  };

  const handleChange = (
    field: keyof KNNOutputType,
    value: CheckedState | undefined | boolean | string | null,
  ) => {
    updateFormData(field, normalizeOutputCheckboxValue(value));
  };

  const viewerOutputOptions: Array<{
    field: keyof KNNOutputType;
    label: string;
    help: string;
  }> = [
    {
      field: "CaseSummary",
      label: "Case Processing Summary",
      help: "Menampilkan ringkasan jumlah kasus valid, missing, dan diproses.",
    },
    {
      field: "ShowNeighborDetail",
      label: "Neighbor and Distance Table",
      help: "Menampilkan tabel tetangga terdekat dan jaraknya.",
    },
    {
      field: "PeersChart",
      label: "Peers Chart",
      help: "Menampilkan peers chart untuk kasus fokus.",
    },
    {
      field: "QuadrantMap",
      label: "Quadrant Map",
      help: "Menampilkan quadrant map untuk hasil KNN.",
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 w-full overflow-hidden">
      <div className="flex-1 min-h-0 w-full overflow-y-auto">
        <div className="flex flex-col items-start gap-2 p-4 w-full">
          <div className="w-full max-w-xl rounded-lg border md:min-w-[200px]">
            <section className="flex flex-col gap-1 p-2">
                <Label className="font-bold">Viewer Output</Label>
                {viewerOutputOptions.map(({ field, label, help }) => (
                  <div className="flex items-center space-x-2" key={field}>
                    <Checkbox
                      id={field}
                      checked={Boolean(outputState[field])}
                      onCheckedChange={(checked) =>
                        handleChange(field, checked)
                      }
                    />
                    <label
                      htmlFor={field}
                      className="text-sm font-medium leading-none"
                    >
                      {label}
                    </label>
                    <FieldHelp show={showFieldHelp} text={help} />
                  </div>
                ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
