type AnalysisType =
    // Basic & Advanced Analysis
    | "Univariate"
    | "Multivariate"
    | "RepeatedMeasuresDefine"
    | "RepeatedMeasures"
    | "VarianceComponents"
    // Dimension Reduction & Factor Analysis
    | "Factor"
    | "CorrespondenceAnalysis"
    | "OptimalScaling"
    | "CAPTCA"
    | "MCA"
    | "OVERALS"
    // Clustering & Classification
    | "TwoStepCluster"
    | "KMeansCluster"
    | "KMedoidsCluster"
    | "HierarchicalCluster"
    | "ClusterSilhouettes"
    // Predictive Models & Evaluation
    | "Tree"
    | "Discriminant"
    | "NearestNeighbor"
    | "NaiveBayes"
    | "ROCCurve"
    | "ROCAnalysis"
    // Time Series
    | "TimeSeriesStore"
    | "Smoothing"
    | "Decomposition"
    | "Autocorrelation"
    | "UnitRootTest"
    | "BoxJenkinsModel"
    | "GARCH"
    | "ARCH"
    | "ECM"
    | "ARDL"
    | "HeteroskedasticityModels"
    // Descriptive Statistics
    | "Frequencies"
    | "Descriptive"
    | "Explore"
    | "Crosstabs"
    ;

const DB_NAME = "Statify";
const STORE_NAME = "AnalysisForm";

// Generate a consistent ID for each analysis type
const generateFormId = (
    analysisType: AnalysisType,
    suffix: string = "formData"
): string => {
    return `${analysisType}_${suffix}`;
};

// Initialize the database with a single store
export const initializeDatabase = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        // First try to open the database without specifying a version
        // This will open the database with its current version
        const checkRequest = indexedDB.open(DB_NAME);

        checkRequest.onerror = () => reject(checkRequest.error);

        checkRequest.onsuccess = () => {
            const db = checkRequest.result;

            // Check if our required object store exists
            if (db.objectStoreNames.contains(STORE_NAME)) {
                resolve(db); // If it exists, we're good to go
            } else {
                // Need schema upgrade, close and reopen with incremented version
                const currentVersion = db.version;
                db.close();

                const upgradeRequest = indexedDB.open(
                    DB_NAME,
                    currentVersion + 1
                );

                upgradeRequest.onerror = () => reject(upgradeRequest.error);

                upgradeRequest.onupgradeneeded = (event) => {
                    const upgradedDb = upgradeRequest.result;
                    if (!upgradedDb.objectStoreNames.contains(STORE_NAME)) {
                        upgradedDb.createObjectStore(STORE_NAME, {
                            keyPath: "id",
                        });
                    }
                };

                upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
            }
        };

        // If database doesn't exist yet, this will create it with version 1
        checkRequest.onupgradeneeded = (event) => {
            const db = checkRequest.result;

            // Create our store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
    });
};

// Save form data for a specific analysis type
export const saveFormData = async (
    analysisType: AnalysisType,
    data: any,
    suffix: string = "formData"
): Promise<void> => {
    const db = await initializeDatabase();
    const formId = generateFormId(analysisType, suffix);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({
            id: formId,
            analysisType,
            ...data,
            updatedAt: new Date().toISOString(),
        });

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
        transaction.oncomplete = () => db.close();
    });
};

// Get form data for a specific analysis type
export const getFormData = async (
    analysisType: AnalysisType,
    suffix: string = "formData"
): Promise<any | null> => {
    const db = await initializeDatabase();
    const formId = generateFormId(analysisType, suffix);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(formId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || null);
        transaction.oncomplete = () => db.close();
    });
};

// Clear form data for a specific analysis type
export const clearFormData = async (
    analysisType: AnalysisType,
    suffix: string = "formData"
): Promise<void> => {
    const db = await initializeDatabase();
    const formId = generateFormId(analysisType, suffix);

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(formId);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
        transaction.oncomplete = () => db.close();
    });
};

// Get all saved forms for a specific analysis type
export const getAllAnalysisData = async (
    analysisType: AnalysisType
): Promise<any[]> => {
    const db = await initializeDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            // Filter results to match the requested analysis type
            const allData = request.result || [];
            const filteredData = allData.filter(
                (item) => item.analysisType === analysisType
            );
            resolve(filteredData);
        };
        transaction.oncomplete = () => db.close();
    });
};

// Get all form data in the store
export const getAllFormData = async (): Promise<any[]> => {
    const db = await initializeDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
        transaction.oncomplete = () => db.close();
    });
};
