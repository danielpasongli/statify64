import { useState } from "react";

export const useOptionHook = () => {
    const [maxLagADF, setMaxLagADF] = useState<number>(2); // Max lag for ADF test

    const handleMaxLagADF = (value: number) => {
        setMaxLagADF(value);
    };

    const resetOptions = () => {
        setMaxLagADF(2);
    };

    return {
        maxLagADF,
        handleMaxLagADF,
        resetOptions,
    };
};
