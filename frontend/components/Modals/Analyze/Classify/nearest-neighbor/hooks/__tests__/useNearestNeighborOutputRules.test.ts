/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { normalizeOutputCheckboxValue } from '@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborOutputRules';

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Unit yang diuji: hooks/useNearestNeighborOutputRules.ts
//  Node keputusan = setiap kondisi atomik pada if dan ||.
//  V(G) = jumlah node keputusan + 1.
//
//  normalizeOutputCheckboxValue — status checkbox tab Output
//   D1: value === "indeterminate"                            (baris 10, ||)
//   D2: typeof value === "undefined"                         (baris 10)
//   Jalur Independen:
//   P1 (TC-KNN-OUT-01): D1=T                     → false
//   P2 (TC-KNN-OUT-02): D1=F, D2=T               → false
//   P3 (TC-KNN-OUT-03): D1=F, D2=F               → nilai dikembalikan apa adanya
//   Cyclomatic Complexity V(G) = 2 + 1 = 3

describe('normalizeOutputCheckboxValue – status checkbox Output (P1–P3)', () => {
    it('TC-KNN-OUT-01 [P1]: Status "indeterminate" → dianggap tidak dicentang (false)', () => {
        expect(normalizeOutputCheckboxValue('indeterminate')).toBe(false);
    });

    it('TC-KNN-OUT-02 [P2]: Status undefined → dianggap tidak dicentang (false)', () => {
        expect(normalizeOutputCheckboxValue(undefined)).toBe(false);
    });

    it('TC-KNN-OUT-03 [P3]: Status true/false → dipakai apa adanya', () => {
        expect(normalizeOutputCheckboxValue(true)).toBe(true);
        expect(normalizeOutputCheckboxValue(false)).toBe(false);
    });
});
