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
        <p>Uji Bartlett digunakan untuk memeriksa apakah varians beberapa kelompok sama atau homogen.</p>
        <p>Variabel yang diuji harus numerik.</p>
        <p>Variabel kelompok harus kategorik dan mempunyai minimal dua kelompok.</p>
        <p>Data pada setiap kelompok sebaiknya berdistribusi normal.</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export default BartlettInfo;
