/**
 * PENGUJIAN MENU — Aturan Menu Nearest Neighbor tab Partition
 *
 * Mencakup: kapan bagian "Cross Validation Folds" aktif, kapan opsi
 * "Set Seed for Mersenne Twister" tidak tersedia, dan bagaimana nilai
 * default disesuaikan otomatis ketika pengguna berpindah antar opsi
 * Auto K Selection / Feature Selection.
 */

import type { KNNPartitionType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";
import {
  isCrossValidationEnabled,
  isSeedUnavailable,
  enforcePartitionRules,
  applyCrossValidationDefaults,
} from "../useNearestNeighborPartitionRules";

function makeState(overrides: Partial<KNNPartitionType> = {}): KNNPartitionType {
  return {
    PartitioningVariable: null,
    UseRandomly: true,
    UseVariable: false,
    VFoldPartitioningVariable: null,
    VFoldUseRandomly: true,
    VFoldUsePartitioningVar: false,
    TrainingNumber: 70,
    NumPartition: null,
    SetSeed: false,
    Seed: null,
    ...overrides,
  };
}

describe("isCrossValidationEnabled — kapan bagian Cross Validation Folds aktif", () => {
  it("TCP01: Auto K Selection nonaktif -> Cross Validation Folds tetap terkunci", () => {
    expect(isCrossValidationEnabled(false, false)).toBe(false);
    expect(isCrossValidationEnabled(false, true)).toBe(false);
  });

  it("TCP02: Auto K Selection aktif TAPI Feature Selection juga aktif -> Cross Validation Folds tetap terkunci", () => {
    expect(isCrossValidationEnabled(true, true)).toBe(false);
  });

  it("TCP03: Auto K Selection aktif DAN Feature Selection nonaktif -> Cross Validation Folds terbuka", () => {
    expect(isCrossValidationEnabled(true, false)).toBe(true);
  });
});

describe("isSeedUnavailable — kapan opsi Set Seed tidak tersedia", () => {
  it("TCP04: Partition TIDAK menggunakan variabel -> Set Seed tetap tersedia", () => {
    expect(isSeedUnavailable(makeState({ UseVariable: false, VFoldUsePartitioningVar: true }))).toBe(false);
  });

  it("TCP05: Partition pakai variabel TAPI fold tidak pakai variabel -> Set Seed tetap tersedia", () => {
    expect(isSeedUnavailable(makeState({ UseVariable: true, VFoldUsePartitioningVar: false }))).toBe(false);
  });

  it("TCP06: Partition DAN fold sama-sama pakai variabel -> Set Seed tidak tersedia", () => {
    expect(isSeedUnavailable(makeState({ UseVariable: true, VFoldUsePartitioningVar: true }))).toBe(true);
  });
});

describe("enforcePartitionRules — memaksa Set Seed nonaktif bila tidak tersedia", () => {
  it("TCP07: Seed tersedia -> Set Seed=true dibiarkan apa adanya", () => {
    const state = makeState({ UseVariable: false, VFoldUsePartitioningVar: false, SetSeed: true });
    expect(enforcePartitionRules(state)).toEqual(state);
  });

  it("TCP08: Seed tidak tersedia TAPI Set Seed memang sudah false -> tidak ada perubahan", () => {
    const state = makeState({ UseVariable: true, VFoldUsePartitioningVar: true, SetSeed: false });
    expect(enforcePartitionRules(state)).toEqual(state);
  });

  it("TCP09: Seed tidak tersedia DAN Set Seed=true -> dipaksa menjadi false", () => {
    const state = makeState({ UseVariable: true, VFoldUsePartitioningVar: true, SetSeed: true });
    const result = enforcePartitionRules(state);
    expect(result.SetSeed).toBe(false);
  });
});

describe("applyCrossValidationDefaults — penyesuaian default saat berpindah opsi", () => {
  it("TCP10: Cross Validation baru aktif & field fold masih kosong -> diisi nilai default (acak, 10 lipatan)", () => {
    const state = makeState({ VFoldUseRandomly: null as unknown as boolean, VFoldUsePartitioningVar: null as unknown as boolean, NumPartition: null });
    const result = applyCrossValidationDefaults(state, true, false);
    expect(result.VFoldUseRandomly).toBe(true);
    expect(result.VFoldUsePartitioningVar).toBe(false);
    expect(result.NumPartition).toBe(10);
  });

  it("TCP11: Cross Validation aktif TAPI field fold sudah pernah diisi pengguna -> nilai yang ada dipertahankan", () => {
    const state = makeState({ VFoldUseRandomly: false, VFoldUsePartitioningVar: true, NumPartition: 5 });
    const result = applyCrossValidationDefaults(state, true, false);
    expect(result.VFoldUseRandomly).toBe(false);
    expect(result.VFoldUsePartitioningVar).toBe(true);
    expect(result.NumPartition).toBe(5);
  });

  it("TCP12: Cross Validation nonaktif TAPI Feature Selection aktif -> kedua opsi fold dipaksa nonaktif", () => {
    const state = makeState({ VFoldUseRandomly: true, VFoldUsePartitioningVar: true });
    const result = applyCrossValidationDefaults(state, false, true);
    expect(result.VFoldUseRandomly).toBe(false);
    expect(result.VFoldUsePartitioningVar).toBe(false);
  });

  it("TCP13: Cross Validation nonaktif DAN Feature Selection nonaktif -> tidak ada penyesuaian apa pun", () => {
    const state = makeState({ VFoldUseRandomly: true, VFoldUsePartitioningVar: false, NumPartition: 3 });
    const result = applyCrossValidationDefaults(state, false, false);
    expect(result).toEqual(state);
  });
});
