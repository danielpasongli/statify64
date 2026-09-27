import type { KNNPartitionType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";

/**
 * Aturan menu tab Partition: kapan bagian "Cross Validation Folds" aktif,
 * kapan opsi "Set Seed" tidak tersedia, dan bagaimana nilai default
 * disesuaikan ketika pengguna berpindah antar opsi.
 */

export function isCrossValidationEnabled(
  isAutoK: boolean,
  isFeatureSelectionActive: boolean,
): boolean {
  return isAutoK && !isFeatureSelectionActive;
}

export function isSeedUnavailable(
  state: Pick<KNNPartitionType, "UseVariable" | "VFoldUsePartitioningVar">,
): boolean {
  return Boolean(state.UseVariable && state.VFoldUsePartitioningVar);
}

export function enforcePartitionRules(
  state: KNNPartitionType,
): KNNPartitionType {
  if (!isSeedUnavailable(state) || !state.SetSeed) return state;

  return {
    ...state,
    SetSeed: false,
  };
}

export function applyCrossValidationDefaults(
  state: KNNPartitionType,
  crossValidationEnabled: boolean,
  featureSelectionActive: boolean,
): KNNPartitionType {
  if (crossValidationEnabled) {
    return enforcePartitionRules({
      ...state,
      VFoldUseRandomly: state.VFoldUseRandomly ?? true,
      VFoldUsePartitioningVar: state.VFoldUsePartitioningVar ?? false,
      NumPartition: state.NumPartition ?? 10,
    });
  }

  if (featureSelectionActive) {
    return enforcePartitionRules({
      ...state,
      VFoldUseRandomly: false,
      VFoldUsePartitioningVar: false,
    });
  }

  return state;
}
