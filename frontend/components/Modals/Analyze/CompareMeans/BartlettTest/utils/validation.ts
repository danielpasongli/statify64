export const getBartlettSelectionError = (
  testVariableCount: number,
  hasFactorVariable: boolean,
): string | null => {
  if (testVariableCount === 0) return 'Please select at least one test variable';
  if (!hasFactorVariable) return 'Please select a grouping variable';
  return null;
};
