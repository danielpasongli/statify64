import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OrdinalOptionsParams } from "../types/ordinal";

interface Props {
  params: OrdinalOptionsParams;
  onChange: (params: Partial<OrdinalOptionsParams>) => void;
}

const FieldError: React.FC<{ show: boolean; message?: string }> = ({
  show,
  message = "Nilai tidak boleh minus.",
}) => (show ? <p className="text-xs text-destructive mt-1">{message}</p> : null);

export const OptionsTab: React.FC<Props> = ({ params, onChange }) => {
  const isMaxIterationsNegative = params.maxIterations < 0;
  const isMaxStepHalvingNegative = params.maxStepHalving < 0;
  const isLogLikelihoodConvergenceNegative = params.logLikelihoodConvergence < 0;
  const isParameterConvergenceNegative = params.parameterConvergence < 0;
  const isConfidenceIntervalNegative = params.confidenceInterval < 0;
  const isDeltaNegative = params.delta < 0;
  const isSingularityToleranceNegative = params.singularityTolerance < 0;

  return (
    <div className="grid grid-cols-2 gap-8 py-4 h-full overflow-y-auto">
      <div className="space-y-6">
        <div className="space-y-3">
          <h4 className="font-semibold text-sm border-b pb-1 mb-2">
            Iteration
          </h4>
          <div>
            <Label htmlFor="ordinal-max-iterations">Maximum Iterations</Label>
            <Input
              id="ordinal-max-iterations"
              type="number"
              value={params.maxIterations}
              onChange={(e) => onChange({ maxIterations: Number(e.target.value) })}
              className={cn(isMaxIterationsNegative && "border-destructive focus-visible:ring-destructive")}
            />
            <FieldError show={isMaxIterationsNegative} />
          </div>
          <div>
            <Label htmlFor="ordinal-max-step-halving">Maximum step-halving</Label>
            <Input
              id="ordinal-max-step-halving"
              type="number"
              value={params.maxStepHalving}
              onChange={(e) => onChange({ maxStepHalving: Number(e.target.value) })}
              className={cn(isMaxStepHalvingNegative && "border-destructive focus-visible:ring-destructive")}
            />
            <FieldError show={isMaxStepHalvingNegative} />
          </div>
          <div>
            <Label htmlFor="ordinal-log-likelihood-convergence">Log-likelihood convergence</Label>
            <Input
              id="ordinal-log-likelihood-convergence"
              type="number"
              value={params.logLikelihoodConvergence}
              onChange={(e) => onChange({ logLikelihoodConvergence: Number(e.target.value) })}
              className={cn(isLogLikelihoodConvergenceNegative && "border-destructive focus-visible:ring-destructive")}
            />
            <FieldError show={isLogLikelihoodConvergenceNegative} />
          </div>
          <div>
            <Label htmlFor="ordinal-parameter-convergence">Parameter convergence</Label>
            <Input
              id="ordinal-parameter-convergence"
              type="number"
              value={params.parameterConvergence}
              onChange={(e) => onChange({ parameterConvergence: Number(e.target.value) })}
              className={cn(isParameterConvergenceNegative && "border-destructive focus-visible:ring-destructive")}
            />
            <FieldError show={isParameterConvergenceNegative} />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div>
          <Label htmlFor="ordinal-confidence-interval">Confidence Interval</Label>
          <Input
            id="ordinal-confidence-interval"
            type="number"
            value={params.confidenceInterval}
            onChange={(e) => onChange({ confidenceInterval: Number(e.target.value) })}
            className={cn(isConfidenceIntervalNegative && "border-destructive focus-visible:ring-destructive")}
          />
          <FieldError show={isConfidenceIntervalNegative} />
        </div>
        <div>
          <Label htmlFor="ordinal-delta">Delta</Label>
          <Input
            id="ordinal-delta"
            type="number"
            value={params.delta}
            onChange={(e) => onChange({ delta: Number(e.target.value) })}
            className={cn(isDeltaNegative && "border-destructive focus-visible:ring-destructive")}
          />
          <FieldError show={isDeltaNegative} />
        </div>
        <div>
          <Label htmlFor="ordinal-singularity-tolerance">Singularity Tolerance</Label>
          <Input
            id="ordinal-singularity-tolerance"
            type="number"
            value={params.singularityTolerance}
            onChange={(e) => onChange({ singularityTolerance: Number(e.target.value) })}
            className={cn(isSingularityToleranceNegative && "border-destructive focus-visible:ring-destructive")}
          />
          <FieldError show={isSingularityToleranceNegative} />
        </div>
        <div>
          <Label>Link Function</Label>
          <Select value={params.linkFunction} onValueChange={(value: any) => onChange({ linkFunction: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Logit">Logit</SelectItem>
              <SelectItem value="Probit">Probit</SelectItem>
              <SelectItem value="Complementary Log-Log">Complementary Log-Log</SelectItem>
              <SelectItem value="Negative Log-Log">Negative Log-Log</SelectItem>
              <SelectItem value="Cauchit">Cauchit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};