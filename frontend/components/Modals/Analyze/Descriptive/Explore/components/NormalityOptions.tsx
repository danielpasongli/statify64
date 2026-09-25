"use client";

import React from 'react';
import { InfoIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface NormalityOptionsProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const NormalityOptions = ({ checked, onCheckedChange }: NormalityOptionsProps) => (
  <div data-testid="explore-normality-section" className="p-4 border rounded-md space-y-3">
    <div className="flex items-center gap-1">
      <Label className="text-base font-medium">Normality</Label>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Syarat penggunaan uji normalitas"
              className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs space-y-1 text-xs">
            <p>Syarat:</p>
            <p>Data numerik dan bisa digunakan hanya dengan 1 variabel.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <div className="flex items-center space-x-2">
      <Checkbox
        id="normality-plots-tests"
        data-testid="explore-normality-plots-tests-checkbox"
        checked={checked}
        onCheckedChange={value => onCheckedChange(value === true)}
      />
      <Label htmlFor="normality-plots-tests" className="font-normal">Normality plots with tests</Label>
    </div>
  </div>
);

export default NormalityOptions;
