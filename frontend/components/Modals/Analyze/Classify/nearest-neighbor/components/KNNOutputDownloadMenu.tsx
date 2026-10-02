"use client";
import React, { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  downloadChart,
  downloadTables,
  type ImageDownloadFormat,
  type TableDownloadFormat,
} from "../utils/output-export";

export type KnnDownloadKind = "table" | "chart";

/** Which download menu fits a KNN statistic, based on its stored output. */
export function getKnnDownloadKind(outputData: unknown): KnnDownloadKind | null {
  let parsed: unknown = outputData;
  if (typeof outputData === "string") {
    try {
      parsed = JSON.parse(outputData);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { tables, charts } = parsed as { tables?: unknown; charts?: unknown };
  if (Array.isArray(tables) && tables.length > 0) return "table";
  if (Array.isArray(charts) && charts.length > 0) return "chart";
  return null;
}

const TABLE_OPTIONS: { format: TableDownloadFormat; label: string }[] = [
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV (.csv)" },
];

const IMAGE_OPTIONS: { format: ImageDownloadFormat; label: string }[] = [
  { format: "png", label: "PNG (.png)" },
  { format: "jpg", label: "JPG (.jpg)" },
  { format: "svg", label: "SVG (.svg)" },
];

interface KNNOutputDownloadMenuProps {
  kind: KnnDownloadKind;
  /** Statistic title, used for the file name and the Excel sheet name. */
  title: string;
  /** DOM id of the element that holds the rendered table or chart. */
  targetId: string;
}

const KNNOutputDownloadMenu: React.FC<KNNOutputDownloadMenuProps> = ({
  kind,
  title,
  targetId,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (format: TableDownloadFormat | ImageDownloadFormat) => {
    setBusy(true);
    setError(null);
    try {
      const target = document.getElementById(targetId);
      if (!target) throw new Error("Output is not on the page.");

      if (kind === "table") {
        downloadTables(
          Array.from(target.querySelectorAll("table")),
          format as TableDownloadFormat,
          title,
        );
      } else {
        await downloadChart(target, format as ImageDownloadFormat, title);
      }
    } catch (err) {
      console.error(`[KNN] Download ${title} as ${format} failed:`, err);
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  };

  const options = kind === "table" ? TABLE_OPTIONS : IMAGE_OPTIONS;

  return (
    <div className="mb-2 flex items-center justify-end gap-2" data-export-ignore>
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            data-testid={`knn-download-${targetId}`}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            Download
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {kind === "table" ? "Download table" : "Download image"}
          </DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuItem
              key={option.format}
              onSelect={() => void download(option.format)}
              data-testid={`knn-download-${targetId}-${option.format}`}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default KNNOutputDownloadMenu;
