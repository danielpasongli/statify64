/**
 * PENGUJIAN MENU — Aturan Menu Nearest Neighbor tab Output
 *
 * Tab ini hanya berisi checkbox tampilan output tanpa aturan enable/disable
 * antar field, sehingga satu-satunya logika bercabang adalah normalisasi
 * status checkbox yang "indeterminate".
 */
import { normalizeOutputCheckboxValue } from "../useNearestNeighborOutputRules";

describe("normalizeOutputCheckboxValue — menu tab Output", () => {
  it("TCO01: status checkbox 'indeterminate' -> dianggap tidak dicentang (false)", () => {
    expect(normalizeOutputCheckboxValue("indeterminate")).toBe(false);
  });

  it("TCO02: status checkbox undefined -> dianggap tidak dicentang (false)", () => {
    expect(normalizeOutputCheckboxValue(undefined)).toBe(false);
  });

  it("TCO03: status checkbox true/false biasa -> dipakai apa adanya", () => {
    expect(normalizeOutputCheckboxValue(true)).toBe(true);
    expect(normalizeOutputCheckboxValue(false)).toBe(false);
  });
});
