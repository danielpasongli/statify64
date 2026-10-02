import type React from 'react';

// Import statistics components
import LinearityTest from './LinearityTest';
import HomoscedasticityTest from './HomoscedasticityTest';
import MulticollinearityTest from './MulticollinearityTest';
import GarchAnalysis from './GarchAnalysis';
import EcmAnalysis from './EcmAnalysis';
import ArdlAnalysis from './ArdlAnalysis';
import CaseProcessingSummary from './CaseProcessingSummary';

// Naive Bayes: tombol Export Model wajib muncul di output viewer, bukan di
// tab Output/form (AGENTS.md §4.3) — dipasang lewat registry ini.
import ExportModelOutput from '@/components/Modals/Analyze/Classify/naive-bayes/components/export-model-output';

// Import Factor Analysis chart components
import { ScreePlot } from '@/components/Modals/Analyze/dimension-reduction/factor/charts/ScreePlot';
import LoadingPlot from '@/components/Modals/Analyze/dimension-reduction/factor/charts/FactorLoadingChart';

// Define the StatisticsComponentsRegistry interface
interface StatisticsComponentsRegistry {
  [key: string]: React.ComponentType<any>;
}

// Create a registry of statistics components mapped by name
// Create a registry of statistics components mapped by name
export const StatisticsComponents: StatisticsComponentsRegistry = {
  // Add LinearityTest component
  LinearityTest,

  // Add HomoscedasticityTest component
  HomoscedasticityTest,

  // Add MulticollinearityTest component
  MulticollinearityTest,

  // Add GarchAnalysis component
  GarchAnalysis,

  // Add EcmAnalysis component
  EcmAnalysis,

  // Add ArdlAnalysis component
  ArdlAnalysis,

  // Dedicated renderer for multinomial output
  "Case Processing Summary": CaseProcessingSummary,

  // Naive Bayes: tombol Export Model + input nama file di output viewer
  // (AGENTS.md §4.3), dipasang lewat naive-bayes-analysis-output.ts
  "Export Model": ExportModelOutput,

  // Add Factor Analysis ScreePlot component
  ScreePlot,

  // Add Factor Analysis LoadingPlot component
  LoadingPlot,
};

// Function to get a component by name
export const getStatisticsComponent = (name: string): React.ComponentType<any> | null => {
  return StatisticsComponents[name] || null;
};

// Default export for convenience
export default StatisticsComponents;