import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDataStore } from '@/stores/useDataStore';
import { useMetaStore } from '@/stores/useMetaStore';
import { useVariableStore } from '@/stores/useVariableStore';
import { uploadSavFile } from '@/services/api';
import type { Variable } from '@/types/Variable';
import type { DataRow } from '@/types/Data';
import { parseCSV, parseXLSX, generateDefaultVariables } from '@/utils/file-parsers';
import { processSavApiResponse } from '@/utils/savFileUtils';
import type { SavUploadResponse } from '@/types/SavUploadResponse';

export const useExampleDatasetLoader = (onClose: () => void) => {
    const router = useRouter();
    const { setData, resetData } = useDataStore();
    const { setMeta: setProjectMeta, resetMeta: resetProjectMeta } = useMetaStore();
    const { overwriteAll, resetVariables, setVariables } = useVariableStore();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadDataset = async (filePath: string) => {
        setIsLoading(true);
        setError(null);
        const fileName = filePath.split('/').pop() ?? 'Untitled Project';
        const fileExtension = filePath.split('.').pop()?.toLowerCase();

        try {
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            let parsedData: DataRow[] = [];
            let variables: Variable[] = [];

            if (fileExtension === 'csv') {
                const csvContent = await response.text();
                parsedData = await parseCSV(csvContent);
                if (parsedData.length > 0) variables = generateDefaultVariables(parsedData[0].length);
            } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                const arrayBuffer = await response.arrayBuffer();
                parsedData = await parseXLSX(arrayBuffer);
                if (parsedData.length > 0) variables = generateDefaultVariables(parsedData[0].length);
            } else if (fileExtension === 'sav') {
                const savBlob = await response.blob();
                const formData = new FormData();
                const validSavName = fileName.toLowerCase().endsWith('.sav') ? fileName : `${fileName}.sav`;
                formData.append('file', savBlob, validSavName);

                await resetData();
                await resetVariables();

                const result = await uploadSavFile(formData);

                const { variables: savVariables, dataMatrix } = processSavApiResponse(result);
                variables = savVariables;
                parsedData = dataMatrix as DataRow[];
            } else {
                throw new Error(`Unsupported file type: ${fileExtension}`);
            }

            if (fileExtension !== 'sav') {
                await resetData();
                await resetVariables();
            }
            await resetProjectMeta();
            await setProjectMeta({ name: fileName, location: fileName, created: new Date() });
            
            if (fileExtension === 'sav') {
                await overwriteAll(variables, parsedData);
            } else {
                await setData(parsedData);
                await setVariables(variables);
            }

            onClose();
            router.push('/dashboard/data');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load data.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    return { isLoading, error, loadDataset };
};