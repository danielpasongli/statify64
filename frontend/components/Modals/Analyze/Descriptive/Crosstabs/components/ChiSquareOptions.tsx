"use client";

import React from 'react';
import { InfoIcon } from 'lucide-react';
import { ActiveElementHighlight } from '@/components/Common/TourComponents';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ChiSquareTestPurpose } from '../types';

interface ChiSquareOptionsProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  purpose: ChiSquareTestPurpose;
  onPurposeChange: (purpose: ChiSquareTestPurpose) => void;
  highlighted: boolean;
}

const ChiSquareOptions = ({ checked, onCheckedChange, purpose, onPurposeChange, highlighted }: ChiSquareOptionsProps) => (
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
          <TooltipContent side="right" className="max-w-sm space-y-1 text-xs">
            <p>Uji Kebebasan memeriksa hubungan antara dua variabel kategorik.</p>
            <p>Uji Kesamaan Proporsi membandingkan proporsi hasil pada beberapa kelompok.</p>
            <p>Variabel kelompok dan variabel hasil harus kategorik.</p>
            <p>Dua kategori hasil menggunakan binomial.</p>
            <p>Tiga atau lebih kategori hasil menggunakan multinomial.</p>
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
    {checked && (
      <fieldset className="mt-4 border-t border-border pt-4">
        <legend className="mb-2 text-sm font-medium">Tujuan Pengujian</legend>
        <RadioGroup
          aria-label="Tujuan Pengujian"
          value={purpose}
          onValueChange={value => onPurposeChange(value as ChiSquareTestPurpose)}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="independence" id="chiSquarePurposeIndependence" />
            <Label htmlFor="chiSquarePurposeIndependence" className="cursor-pointer font-normal">
              Uji Kebebasan
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="proportion" id="chiSquarePurposeProportion" />
            <Label htmlFor="chiSquarePurposeProportion" className="cursor-pointer font-normal">
              Uji Kesamaan Proporsi
            </Label>
          </div>
        </RadioGroup>
        {purpose === 'proportion' && (
          <p className="mt-2 text-xs text-muted-foreground">
            Binomial atau multinomial ditentukan otomatis berdasarkan jumlah kategori variabel kolom.
          </p>
        )}
      </fieldset>
    )}
    <ActiveElementHighlight active={highlighted} />
  </div>
);

export default ChiSquareOptions;
