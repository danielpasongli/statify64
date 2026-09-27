export type DiscriminantMainType = {
    GroupingVariable: string | null;
    IndependentVariables: string[] | null;
    Together: boolean;
    Stepwise: boolean;
    SelectionVariable: string | null;
};

export type DiscriminantDefineRangeType = {
    minRange: number | null;
    maxRange: number | null;
};

export type DiscriminantSetValueType = {
    Value: number | null;
};

export type DiscriminantStatisticsType = {
    Means: boolean;
    ANOVA: boolean;
    BoxM: boolean;
    Fisher: boolean;
    Unstandardized: boolean;
    WGCorrelation: boolean;
    WGCovariance: boolean;
    SGCovariance: boolean;
    TotalCovariance: boolean;
};

export type DiscriminantMethodType = {
    Wilks: boolean;
    Unexplained: boolean;
    Mahalonobis: boolean;
    FRatio: boolean;
    Raos: boolean;
    FValue: boolean;
    FProbability: boolean;
    Summary: boolean;
    Pairwise: boolean;
    VEnter: number | null;
    FEntry: number | null;
    FRemoval: number | null;
    PEntry: number | null;
    PRemoval: number | null;
};

export type DiscriminantClassifyType = {
    AllGroupEqual: boolean;
    GroupSize: boolean;
    WithinGroup: boolean;
    SepGroup: boolean;
    Case: boolean;
    Limit: boolean;
    LimitValue: number | null;
    Summary: boolean;
    Leave: boolean;
    Combine: boolean;
    SepGrp: boolean;
    Terr: boolean;
    Replace: boolean;
};

export type DiscriminantSaveType = {
    Predicted: boolean;
    Discriminant: boolean;
    Probabilities: boolean;
    /** Whether to write the model-information XML file on OK. */
    ExportXml: boolean;
    /** Target file name for that export (SPSS asks for a path; a browser can only name the download). */
    XmlFile: string | null;
};

export type DiscriminantBootstrapType = {
    PerformBootStrapping: boolean;
    NumOfSamples: number | null;
    Seed: boolean;
    SeedValue: number | null;
    Level: number | null;
    Percentile: boolean;
    BCa: boolean;
    Simple: boolean;
    Stratified: boolean;
    Variables: string[] | null;
    StrataVariables: string[] | null;
};

export type DiscriminantAssumptionsType = {
    Multicollinearity: boolean;
    MultivariateNormality: boolean;
    UnivariateNormality: boolean;
};

export type DiscriminantType = {
    main: DiscriminantMainType;
    defineRange: DiscriminantDefineRangeType;
    setValue: DiscriminantSetValueType;
    statistics: DiscriminantStatisticsType;
    method: DiscriminantMethodType;
    classify: DiscriminantClassifyType;
    save: DiscriminantSaveType;
    bootstrap: DiscriminantBootstrapType;
    assumptions: DiscriminantAssumptionsType;
};
