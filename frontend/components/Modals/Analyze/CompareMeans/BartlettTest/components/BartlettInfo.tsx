"use client";

import React from 'react';
import { InfoIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const BartlettInfo = () => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Syarat penggunaan uji Bartlett"
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <InfoIcon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs space-y-1 text-xs">
        <p>Gunakan variabel numerik berskala pada dua atau lebih kelompok independen.</p>
        <p>Data dalam setiap kelompok harus berdistribusi normal.</p>
        <p>Setiap kelompok memerlukan minimal dua observasi valid dan varians lebih dari nol.</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export default BartlettInfo;
