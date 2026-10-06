// AGENTS_V2.md §10.2 — daftar nama kolom yang dapat dibuka (Fase A3).
// Model teks bisa memuat ribuan kolom vektor, sehingga UI hanya menampilkan satu
// baris ringkasan; daftar baru dirender setelah dibuka, bertahap per `pageSize` nama.

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CollapsibleNameListProps = {
  /** Teks tombol pembuka, mis. "Show zero-filled columns". */
  label: string;
  names: string[];
  /** Jumlah nama yang dirender per tahap (default 200). */
  pageSize?: number;
  testId: string;
};

export function CollapsibleNameList({
  label,
  names,
  pageSize = 200,
  testId,
}: CollapsibleNameListProps) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pageSize);

  if (names.length === 0) return null;

  const shown = names.slice(0, visibleCount);
  const remaining = names.length - shown.length;

  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-fit gap-1 px-2"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {label} ({names.length})
      </Button>
      {open && (
        <div className="flex flex-col gap-1">
          <ul
            className="max-h-48 overflow-auto rounded border px-3 py-2 text-sm"
            aria-label={label}
          >
            {shown.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setVisibleCount((value) => value + pageSize)}
            >
              Show {Math.min(pageSize, remaining)} more ({remaining} remaining)
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default CollapsibleNameList;
