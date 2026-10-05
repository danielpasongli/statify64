import type { FC } from "react";
import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface OptionTabProps {
    maxLagADF: number;
    handleMaxLagADF: (value: number) => void;
}

const OptionTab: FC<OptionTabProps> = ({
    maxLagADF,
    handleMaxLagADF,
}) => {
    return (
        <div className="space-y-6 p-4">
            <div className="space-y-2">
                <Label htmlFor="maxLagADF">Max Lag for ADF Test</Label>
                <Input
                    id="maxLagADF"
                    type="number"
                    min={1}
                    max={10}
                    value={maxLagADF}
                    onChange={(e) => handleMaxLagADF(Math.max(1, Math.min(10, parseInt(e.target.value) || 2)))}
                />
                <p className="text-xs text-muted-foreground">
                    Maximum lag for Augmented Dickey-Fuller cointegration test (typically 1-3)
                </p>
            </div>



            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium text-sm">Model Overview</h4>
                <p className="text-xs text-muted-foreground">
                    <strong>Step 1: Long-run regression</strong><br/>
                    Yₜ = β₀ + β₁Xₜ + εₜ
                </p>
                <p className="text-xs text-muted-foreground">
                    <strong>Step 2: Cointegration test</strong><br/>
                    ADF test on residuals (εₜ)
                </p>
                <p className="text-xs text-muted-foreground">
                    <strong>Step 3: Error Correction Model (Parsimony)</strong><br/>
                    ΔYₜ = α + γ·ECTₜ₋₁ + φ₁·ΔX₁ₜ + φ₂·ΔX₂ₜ + … + uₜ
                </p>
            </div>
        </div>
    );
};

export default OptionTab;
