import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Variable } from "@/types/Variable";
import type { LocationModelTerm, OrdinalOptions, OrdinalLocationParams } from "../types/ordinal";

interface OrdinalSavedState {
  dependentName: string | null;
  factorNames: string[];
  covariateNames: string[];
  locationModelNames: Array<
    | { kind: "variable"; name: string }
    | { kind: "interaction"; id: string; name: string; variableNames: string[] }
  >;
}

interface OrdinalFormStoreState {
  savedState: OrdinalSavedState;
  saveOrdinalSelections: (options: OrdinalOptions, locationParams: OrdinalLocationParams) => void;
  resetOrdinalSelections: () => void;
}

const defaultSavedState: OrdinalSavedState = {
  dependentName: null,
  factorNames: [],
  covariateNames: [],
  locationModelNames: [],
};

export const useOrdinalFormStore = create<OrdinalFormStoreState>()(
  persist(
    (set) => ({
      savedState: defaultSavedState,
      saveOrdinalSelections: (options: OrdinalOptions, locationParams: OrdinalLocationParams) => {
        const dependentName = options.dependent ? options.dependent.name : null;
        const factorNames = options.factors.map((v: Variable) => v.name);
        const covariateNames = options.covariates.map((v: Variable) => v.name);

        const locationModelNames = locationParams.locationModel.map((term: LocationModelTerm) => {
          if (typeof term === "object" && "kind" in term && term.kind === "interaction") {
            return {
              kind: "interaction" as const,
              id: term.id,
              name: term.name,
              variableNames: term.variables.map((v: Variable) => v.name),
            };
          }
          return {
            kind: "variable" as const,
            name: term.name,
          };
        });

        set({
          savedState: {
            dependentName,
            factorNames,
            covariateNames,
            locationModelNames,
          },
        });
      },
      resetOrdinalSelections: () => {
        set({ savedState: defaultSavedState });
      },
    }),
    {
      name: "statify-ordinal-regression-form",
    }
  )
);

/**
 * Helper to hydrate full Variable objects from stored names by cross-referencing with active variablesFromStore.
 */
export const hydrateOrdinalSelections = (
  saved: OrdinalSavedState,
  variables: Variable[]
): { options: OrdinalOptions; locationParams: OrdinalLocationParams } => {
  const varMap = new Map<string, Variable>();
  for (const v of variables) {
    varMap.set(v.name, v);
  }

  const dependent = saved.dependentName ? varMap.get(saved.dependentName) ?? null : null;
  const factors = saved.factorNames
    .map((name) => varMap.get(name))
    .filter((v): v is Variable => Boolean(v));
  const covariates = saved.covariateNames
    .map((name) => varMap.get(name))
    .filter((v): v is Variable => Boolean(v));

  const locationModel: LocationModelTerm[] = [];
  for (const item of saved.locationModelNames) {
    if (item.kind === "variable") {
      const v = varMap.get(item.name);
      if (v) {
        locationModel.push(v);
      }
    } else if (item.kind === "interaction") {
      const vars = item.variableNames
        .map((name) => varMap.get(name))
        .filter((v): v is Variable => Boolean(v));
      // Only keep interaction if all participating variables still exist in the dataset
      if (vars.length === item.variableNames.length && vars.length >= 2) {
        locationModel.push({
          kind: "interaction",
          id: item.id,
          name: item.name,
          variables: vars,
        });
      }
    }
  }

  return {
    options: {
      dependent,
      factors,
      covariates,
    },
    locationParams: {
      locationModel,
    },
  };
};
