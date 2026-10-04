import '@testing-library/jest-dom';
import {
  hydrateOrdinalSelections,
  useOrdinalFormStore,
} from "../stores/useOrdinalFormStore";
import type { Variable } from "@/types/Variable";
import type { OrdinalOptions, OrdinalLocationParams } from "../types/ordinal";

describe("White-Box: Dialogs & Form Store (useOrdinalFormStore)", () => {
  const dummyVars: Variable[] = [
    {
      id: 0,
      name: "satisfaction",
      label: "Satisfaction Level",
      type: "NUMERIC",
      width: 8,
      decimals: 0,
      // Values untuk variabel Ordinal (Dependent Variable)
      values: [
        { id: 1, variableId: 1, value: 1, label: "Very Dissatisfied" },
        { id: 2, variableId: 1, value: 2, label: "Dissatisfied" },
        { id: 3, variableId: 1, value: 3, label: "Neutral" },
        { id: 4, variableId: 1, value: 4, label: "Satisfied" },
        { id: 5, variableId: 1, value: 5, label: "Very Satisfied" }
      ],
      missing: null,
      columns: 8,
      align: "right",
      measure: "ordinal",
      role: "target", // Atau "output" tergantung definisi enum VariableRole Anda
      columnIndex: 0, // Properti tambahan jika masih dipakai di sistem Anda
    },
    {
      id: 1,
      name: "age",
      label: "Age",
      type: "NUMERIC",
      width: 8,
      decimals: 0,
      values: [], // Variabel scale (covariate) biasanya tidak punya value labels
      missing: null,
      columns: 8,
      align: "right",
      measure: "scale",
      role: "input", // Sebagai independent variable (covariate)
      columnIndex: 1,
    },
    {
      id: 2,
      name: "gender",
      label: "Gender",
      type: "NUMERIC",
      width: 8,
      decimals: 0,
      // Values untuk variabel Nominal (Factor)
      values: [
        { id: 1, variableId: 1, value: 1, label: "Male" },
        { id: 2, variableId: 1, value: 2, label: "Female" }
      ],
      missing: null,
      columns: 8,
      align: "right",
      measure: "nominal",
      role: "input", // Sebagai independent variable (factor)
      columnIndex: 2,
    },
  ];

  it("Path 1 (1-2-12): Hydrasi dengan state tersimpan kosong", () => {
    const emptySaved = {
      dependentName: null,
      factorNames: [],
      covariateNames: [],
      locationModelNames: [],
    };
    const hydrated = hydrateOrdinalSelections(emptySaved, dummyVars);
    expect(hydrated.options.dependent).toBeNull();
    expect(hydrated.options.factors).toHaveLength(0);
    expect(hydrated.options.covariates).toHaveLength(0);
    expect(hydrated.locationParams.locationModel).toHaveLength(0);
  });

  it("Path 2 (1-3-4-12): Hydrasi dependent ditemukan & model single variable", () => {
    const saved = {
      dependentName: "satisfaction",
      factorNames: ["gender"],
      covariateNames: ["age"],
      locationModelNames: [{ kind: "variable" as const, name: "age" }],
    };
    const hydrated = hydrateOrdinalSelections(saved, dummyVars);
    expect(hydrated.options.dependent?.name).toBe("satisfaction");
    expect(hydrated.options.factors[0].name).toBe("gender");
    expect(hydrated.options.covariates[0].name).toBe("age");
    expect(hydrated.locationParams.locationModel[0].name).toBe("age");
  });

  it("Path 3 (1-6-7-8-12): Hydrasi model efek interaksi (interaction term) valid", () => {
    const saved = {
      dependentName: "satisfaction",
      factorNames: ["gender"],
      covariateNames: ["age"],
      locationModelNames: [
        {
          kind: "interaction" as const,
          id: "interaction-v2-v3",
          name: "age*gender",
          variableNames: ["age", "gender"],
        },
      ],
    };
    const hydrated = hydrateOrdinalSelections(saved, dummyVars);
    expect(hydrated.locationParams.locationModel).toHaveLength(1);
    const term = hydrated.locationParams.locationModel[0];
    expect(term.name).toBe("age*gender");
    if (typeof term === "object" && "kind" in term) {
      expect(term.kind).toBe("interaction");
    }
  });

  it("Path 4 (1-6-7-9-12): Hydrasi term interaksi tapi salah satu variabel tidak ada di dataset", () => {
    const saved = {
      dependentName: "satisfaction",
      factorNames: [],
      covariateNames: [],
      locationModelNames: [
        {
          kind: "interaction" as const,
          id: "invalid-inter",
          name: "missing*age",
          variableNames: ["missing_var", "age"],
        },
      ],
    };
    const hydrated = hydrateOrdinalSelections(saved, dummyVars);
    // Karena length vars (1) != variableNames.length (2), term diabaikan
    expect(hydrated.locationParams.locationModel).toHaveLength(0);
  });
});
