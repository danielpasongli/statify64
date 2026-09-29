import React, {lazy, Suspense} from "react";
import type {BaseModalProps} from "@/types/modalTypes";
import { ModalType} from "@/types/modalTypes";

/**
 * LoadingModal - Displayed while modal components are loading
 */
const LoadingModal: React.FC<BaseModalProps> = ({ onClose }) => (
    <div className="p-6 text-center">
        <div className="animate-pulse mx-auto h-8 w-8 rounded-full bg-primary/20 mb-4" />
        <p className="text-sm text-muted-foreground">
            Loading classify modal...
        </p>
    </div>
);

/**
 * withSuspense - HOC for wrapping lazy-loaded components with Suspense
 */
function withSuspense(
    Component: React.ComponentType<BaseModalProps>
): React.ComponentType<BaseModalProps> {
    const WrappedComponent = (props: BaseModalProps) => (
        <Suspense fallback={<LoadingModal onClose={props.onClose} />}>
            <Component {...props} />
        </Suspense>
    );

    WrappedComponent.displayName = `withSuspense(${
        Component.displayName || Component.name || "Component"
    })`;
    return WrappedComponent;
}

// Lazy load Classify modals
const TwoStepClusterModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/two-step-cluster/dialogs/two-step-cluster-main"
    ).then((module) => ({ default: module.TwoStepClusterContainer }))
);
const TreeModal = lazy(() =>
    import("@/components/Modals/Analyze/Classify/tree/dialogs/tree-main").then(
        (module) => ({ default: module.TreeContainer })
    )
);
const DiscriminantModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/discriminant/dialogs/discriminant-main"
    ).then((module) => ({ default: module.DiscriminantMain }))
);
const NearestNeighborModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/nearest-neighbor/dialogs/nearest-neighbor-main"
    ).then((module) => ({ default: module.KNNContainer }))
);
const NaiveBayesModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/naive-bayes/dialogs/naive-bayes-main"
    )
);
const ROCCurveModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/roc-curve/dialogs/roc-curve-main"
    ).then((module) => ({ default: module.RocCurveContainer }))
);
const ROCAnalysisModal = lazy(() =>
    import(
        "@/components/Modals/Analyze/Classify/roc-analysis/dialogs/roc-analysis-main"
    ).then((module) => ({ default: module.RocAnalysisContainer }))
);

/**
 * CLASSIFY_MODAL_COMPONENTS - Registry for classify statistics modal components
 *
 * Maps each classify-related ModalType to its corresponding React component
 */
export const CLASSIFY_MODAL_COMPONENTS: Record<
    string,
    React.ComponentType<BaseModalProps>
> = {
    [ModalType.ModalTwoStepCluster]: withSuspense(
        TwoStepClusterModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalTree]: withSuspense(
        TreeModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalDiscriminant]: withSuspense(
        DiscriminantModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalNearestNeighbor]: withSuspense(
        NearestNeighborModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalNaiveBayes]: withSuspense(
        NaiveBayesModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalROCCurve]: withSuspense(
        ROCCurveModal as any
    ) as React.ComponentType<BaseModalProps>,
    [ModalType.ModalROCAnalysis]: withSuspense(
        ROCAnalysisModal as any
    ) as React.ComponentType<BaseModalProps>,
};

/**
 * getClassifyModalComponent - Get a classify modal component by type
 *
 * @param type - The type of modal to retrieve
 * @returns The React component for the specified modal type, or null if not found
 */
export function getClassifyModalComponent(
    type: ModalType
): React.ComponentType<BaseModalProps> | null {
    const Component = CLASSIFY_MODAL_COMPONENTS[type];

    if (!Component) {
        console.warn(
            `No classify modal component registered for type: ${type}`
        );
        return null;
    }

    return Component;
}

/**
 * CLASSIFY_MODAL_CONTAINER_PREFERENCES - Container preferences for classify modals
 *
 * Some modals work better in specific container types based on their complexity
 * and screen space requirements.
 */
export const CLASSIFY_MODAL_CONTAINER_PREFERENCES: Partial<
    Record<ModalType, "dialog" | "sidebar">
> = {
    [ModalType.ModalTwoStepCluster]: "sidebar",
    [ModalType.ModalTree]: "sidebar",
    [ModalType.ModalDiscriminant]: "sidebar",
    [ModalType.ModalNearestNeighbor]: "sidebar",
    [ModalType.ModalNaiveBayes]: "sidebar",
    [ModalType.ModalROCCurve]: "sidebar",
    [ModalType.ModalROCAnalysis]: "sidebar",
};
