# Statistical Modules Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the owned Normality, Bartlett, and Crosstabs statistical modules use consistent UI, validation, formatting, interpretation, and test boundaries without changing their statistical results.

**Architecture:** Keep each feature in its current host module to avoid conflicts with other contributors. Extract focused helpers and components behind compatibility exports, and share only stable presentation primitives.

**Tech Stack:** TypeScript, React, Jest, React Testing Library, Web Workers.

**Spec:** Approved in chat on 2026-09-25.

## Global Constraints

- Modify only Normality, Bartlett, Crosstabs, their tests, and the shared statistical presentation helper.
- Preserve existing worker calculation behavior and output contracts.
- Use English identifiers and Indonesian user-facing interpretation text.
- Keep performance tests separate from default functional tests.
- Add no dependencies.

---

### Task 1: Shared statistical output primitives

**Files:**
- Create: `frontend/components/Modals/Analyze/shared/statisticalOutput.ts`
- Test: `frontend/components/Modals/Analyze/shared/__tests__/statisticalOutput.test.ts`

**Interfaces:**
- Produces: `DEFAULT_ALPHA`, `formatNumber`, `formatPValue`, `escapeHtml`.

- [x] Write failing tests for formatting and escaping.
- [x] Run the focused test and confirm missing-module failure.
- [x] Implement the four primitives.
- [x] Run the focused test and confirm it passes.

### Task 2: Normality boundaries

**Files:**
- Create: `frontend/components/Modals/Analyze/Descriptive/Explore/components/NormalityOptions.tsx`
- Create: `frontend/components/Modals/Analyze/Descriptive/Explore/utils/normality/interpretation.ts`
- Create: `frontend/components/Modals/Analyze/Descriptive/Explore/utils/normality/formatter.ts`
- Modify: `frontend/components/Modals/Analyze/Descriptive/Explore/PlotsTab.tsx`
- Modify: `frontend/components/Modals/Analyze/Descriptive/Explore/utils/formatters.ts`
- Delete: `frontend/components/Modals/Analyze/Descriptive/Explore/utils/testsOfNormalityFormatter.ts`
- Test: `frontend/components/Modals/Analyze/Descriptive/Explore/__tests__/normality/white-box/interpretation.test.ts`
- Test: `frontend/components/Modals/Analyze/Descriptive/Explore/__tests__/normality/black-box/NormalityOptions.test.tsx`

**Interfaces:**
- Produces: `buildNormalityDescription`, `formatTestsOfNormalityTable`, `NormalityOptions`.

- [x] Write failing tests for extracted interpretation and UI behavior.
- [x] Run focused tests and confirm missing-module failures.
- [x] Extract interpretation without changing output text.
- [x] Move formatter and update the barrel export.
- [x] Extract the tooltip and checkbox component.
- [x] Run Normality formatter, UI, hook, and worker tests.

### Task 3: Bartlett boundaries

**Files:**
- Create: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/components/BartlettInfo.tsx`
- Create: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/utils/interpretation.ts`
- Create: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/utils/validation.ts`
- Modify: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/index.tsx`
- Modify: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/utils/formatters.ts`
- Test: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/__tests__/white-box/interpretation.test.ts`
- Test: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/__tests__/white-box/validation.test.ts`
- Test: `frontend/components/Modals/Analyze/CompareMeans/BartlettTest/__tests__/black-box/BartlettInfo.test.tsx`

**Interfaces:**
- Produces: `buildBartlettDescription`, `getBartlettSelectionError`, `BartlettInfo`.

- [x] Write failing tests for interpretation, selection validation, and tooltip.
- [x] Run focused tests and confirm missing-module failures.
- [x] Implement interpretation, validation, and information component.
- [x] Update formatter and modal to consume them.
- [x] Remove production debug logs from the formatter and hook.
- [x] Run all Bartlett component, formatter, hook, and worker tests.

### Task 4: Chi-Square and proportion boundaries

**Files:**
- Create: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/components/ChiSquareOptions.tsx`
- Create: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquare/interpretation.ts`
- Create: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquare/validation.ts`
- Move: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquareFormatter.ts` to `frontend/components/Modals/Analyze/Descriptive/Crosstabs/utils/chiSquare/formatter.ts`
- Modify: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/StatisticsTab.tsx`
- Modify: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/utils/formatters.ts`
- Test: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/__tests__/chiSquare/white-box/interpretation.test.ts`
- Test: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/__tests__/chiSquare/white-box/validation.test.ts`
- Test: `frontend/components/Modals/Analyze/Descriptive/Crosstabs/__tests__/chiSquare/black-box/ChiSquareOptions.test.tsx`

**Interfaces:**
- Produces: `buildChiSquareDescription`, `evaluateExpectedCountAssumption`, `ChiSquareOptions`, `formatChiSquareTestsTable`.

- [x] Write failing tests for independence, binomial, multinomial, assumptions, and UI behavior.
- [x] Run focused tests and confirm missing-module failures.
- [x] Extract interpretation and assumption evaluation.
- [x] Move the formatter and update the barrel export.
- [x] Extract the statistics option component.
- [x] Run all Crosstabs component, formatter, hook, and worker tests.

### Task 5: Verification and documentation

**Files:**
- Modify: module README files only when paths or commands changed.

**Interfaces:**
- Consumes: all tasks above.
- Produces: verified refactor with unchanged observable statistical behavior.

- [x] Run relevant Jest suites for all three modules and workers.
- [x] Run TypeScript validation; record unrelated baseline failures outside the new production files.
- [x] Run `git diff --check` and inspect every changed path.
- [ ] Commit the refactor locally without pushing.
