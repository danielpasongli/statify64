import type {
    KMedoidsClusterIterateType,
    KMedoidsClusterMainType,
    KMedoidsClusterOptionsType,
    KMedoidsClusterResultsType,
    KMedoidsClusterEvaluationType,
    KMedoidsClusterSaveType,
    KMedoidsClusterType,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";
import {
    KMedoidsMethod,
    DistanceMetric,
    InitialMedoidsStrategy,
    ClusterMode,
    AutoKMethod,
    NormalizationMethod,
    MissingValueMethod,
} from "@/components/Modals/Analyze/Clustering/k-medoids-cluster/types/k-medoids-cluster";

/**
 * PAM membangun matriks jarak n×n bertipe f64 (n² × 8 B).
 * - PAM_WARN_ROWS: di atas ini pengguna diperingatkan dan disarankan memakai CLARA,
 *   tetapi tetap boleh memaksa PAM.
 * - PAM_HARD_MAX_ROWS: batas mutlak (~763 MB), ditolak karena hampir pasti gagal alokasi.
 *   Harus sama dengan PAM_HARD_MAX_N di rust/src/wasm/function.rs.
 */
export const PAM_WARN_ROWS = 2500;
export const PAM_HARD_MAX_ROWS = 10000;

/**
 * ========================================
 * K-MEDOIDS DEFAULT VALUES
 * ========================================
 * Default values berdasarkan best practices clustering statistik
 */

export const KMedoidsClusterMainDefault: KMedoidsClusterMainType = {
    TargetVar: null,
    CaseTarget: null,
    IterateClassify: true,
    ClassifyOnly: false,
    // --- Cluster selection mode ---
    ClusterMode: ClusterMode.Manual,
    Cluster: 2,
    AutoKMin: 2,
    AutoKMax: 10,
    AutoKMethod: AutoKMethod.Silhouette,
    // --- Distance Metric ---
    DistanceMetric: DistanceMetric.Euclidean, // Euclidean sebagai default standard
    OpenDataset: true,
    ExternalDatafile: false,
    NewDataset: true,
    DataFile: false,
    OpenDatasetMethod: null,
    NewData: null,
};

/**
 * Iterate defaults - mengikuti best practices PAM
 */
export const KMedoidsClusterIterateDefault: KMedoidsClusterIterateType = {
    Method: KMedoidsMethod.PAM, // PAM sebagai default (optimal quality)
    InitialStrategy: InitialMedoidsStrategy.Random, // Random initialization
    MaximumIterations: 300, // PAM biasanya konvergen cepat
    ConvergenceCriterion: 0, // Stop jika tidak ada improvement
    SeedMode: "default",
    RandomSeed: null, // value used only when SeedMode = custom
    NumberOfInitializations: 10, // 10 initializations untuk hasil optimal
    SampleSize: null, // Only for CLARA: akan di-set auto = 40 + 2*k
    NumSamples: 5, // Only for CLARA: jumlah sampling iterations
    NumLocal: 2, // Only for CLARANS: jumlah local minima
    MaxNeighbor: null, // Only for CLARANS: akan di-set auto = max(250, 1.25% of n*(k-1))
    Standardize: false, // Default: no normalization unless user selects
    NormalizationMethod: NormalizationMethod.None,
};

/**
 * Results defaults - tampilkan output utama
 */
export const KMedoidsClusterResultsDefault: KMedoidsClusterResultsType = {
    ShowFinalMedoids: true, // Wajib tampilkan (setara Final Cluster Centers)
    ShowClusterMedoids: true, // Tabel Cluster Medoids pada Data Tables
    ShowClusterMembership: true, // Wajib tampilkan (per case)
    ShowCaseCount: true, // Wajib tampilkan (Number of Cases)
    ShowIterationHistory: false, // Optional detail
    ShowTotalCost: true, // Transparency metric
    ShowConvergenceAlgorithm: true, // Default on: panel status + tabel histori iterasi
    ShowConvergenceChart: false, // Default off: grafik biaya per iterasi (opsional)
    ShowSamplingHistory: true, // Default on: tampilkan histori sampling khusus untuk CLARA
};

/**
 * Evaluation defaults - minimal Silhouette wajib
 */
export const KMedoidsClusterEvaluationDefault: KMedoidsClusterEvaluationType = {
    ComputeSilhouette: true,   // Wajib (pengganti ANOVA untuk clustering)
    ShowSilhouettePlot: true,  // Optional: silhouette plot (satu bar per objek, gaya R)
    ShowElbowPlot: false,      // Optional: grafik SSE vs k (Elbow Method)
    ShowOptimalKChart: false,  // Optional: grafik K optimal (kurva silhouette / elbow)
    ShowOptimalKTable: false,  // Optional: tabel data K optimal (cost & silhouette per k)
    ShowOverallQualityAssessment: true, // Optional: ringkasan kualitas clustering (overall)
};

export const KMedoidsClusterSaveDefault: KMedoidsClusterSaveType = {
    ClusterMembership: false,
    DistanceClusterCenter: false,
};

export const KMedoidsClusterOptionsDefault: KMedoidsClusterOptionsType = {
    InitialCluster: true, // Tampilkan initial medoids
    ClusterInfo: false, // Optional detail per case
    ShowPCAProjection: true, // Tampilkan PCA Projection di hasil visualisasi
    ShowClusterScatterPlot: false, // Default off: tampilkan hanya jika dipilih user
    ShowClusterSizeDistribution: false, // Default off: tampilkan hanya jika dipilih user
    ShowDistanceMatrixBetweenMedoids: false, // Default off: tampilkan hanya jika dipilih user
    ShowDistanceMatrixTable: false, // Default off: tampilkan hanya jika dipilih user
    // ShowOptimalKChart pindah ke tab Evaluation, ShowConvergenceChart pindah ke tab Results
    // agar grafik satu grup dengan tabelnya.
    MissingValueMethod: MissingValueMethod.Listwise, // Default: listwise deletion
    Standardize: false, // Default: no normalization unless user selects
    NormalizationMethod: NormalizationMethod.None,
};

export const KMedoidsClusterDefault: KMedoidsClusterType = {
    main: KMedoidsClusterMainDefault,
    iterate: KMedoidsClusterIterateDefault,
    results: KMedoidsClusterResultsDefault,
    evaluation: KMedoidsClusterEvaluationDefault,
    save: KMedoidsClusterSaveDefault,
    options: KMedoidsClusterOptionsDefault,
};
