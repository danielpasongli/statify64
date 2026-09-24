"use client";

import React from 'react';
import { InfoIcon } from 'lucide-react';
import { ActiveElementHighlight } from '@/components/Common/TourComponents';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ChiSquareOptionsProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  highlighted: boolean;
}

const ChiSquareOptions = ({ checked, onCheckedChange, highlighted }: ChiSquareOptionsProps) => (
  <div
    id="crosstabs-statistics-chi-square-section"
    className="bg-card border border-border rounded-md p-4 relative"
    data-testid="crosstabs-statistics-chi-square-section"
  >
    <div className="flex items-center gap-1 mb-3">
      <div className="text-sm font-medium">Chi-Square</div>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Informasi penggunaan Chi-Square"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs text-xs">
            Uji asosiasi untuk proporsi lebih dari dua populasi (binomial/multinomial) melalui tabel kontingensi.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <div className="flex items-center">
      <Checkbox
        id="pearsonChiSquare"
        checked={checked}
        onCheckedChange={value => onCheckedChange(value === true)}
        className="mr-2"
        data-testid="crosstabs-chi-square-checkbox"
      />
      <Label htmlFor="pearsonChiSquare" className="text-sm cursor-pointer">
        Pearson Chi-Square
      </Label>
    </div>
    <ActiveElementHighlight active={highlighted} />
  </div>
);

export default ChiSquareOptions;
