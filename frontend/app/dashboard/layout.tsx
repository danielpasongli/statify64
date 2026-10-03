"use client"; // Make this layout a Client Component

import "@/app/globals.css";
import Header from "@/app/dashboard/components/layout/Header";
import Footer from "@/app/dashboard/components/layout/Footer";
import React, { useState, lazy, Suspense, useEffect } from "react";
import DataLoader from "@/components/ui/DataLoader";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import { useMobile } from "@/hooks/useMobile";
import { useModal } from "@/hooks/useModal";
import dynamic from 'next/dynamic';
import { OnbordaProvider } from "onborda";
import { ModalType } from "@/types/modalTypes";

import ResultNavigationObserver from "@/components/Common/ResultNavigationObserver";
const SyncStatusClient = dynamic(() => import('@/components/ui/SyncStatus'), { ssr: false });
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";

// Lazy load ModalManager untuk performa yang lebih baik
const ModalManager = lazy(() => import("@/components/Modals/ModalManager"));

// Komponen fallback saat ModalManager sedang dimuat
const ModalLoading = () => (
  <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary"></div>
  </div>
);

// Pengaturan lebar sidebar
const DEFAULT_SIDEBAR_WIDTH = 30; // Persentase default lebar sidebar
const KNN_SIDEBAR_WIDTH = 40;     // 2/5 layar, khusus Nearest Neighbor
const MIN_SIDEBAR_WIDTH = 0;      // Tidak ada lebar minimum sidebar
const MAX_SIDEBAR_WIDTH = 60;     // Persentase maksimum lebar sidebar

/**
 * DashboardLayout - Layout utama untuk halaman dashboard
 * 
 * Layout ini menangani:
 * - Tampilan header dan footer
 * - Tampilan konten utama dashboard
 * - Manajemen sidebar untuk modal (pada desktop)
 * - Manajemen dialog modal (pada mobile)
 * - Responsivitas antara tampilan desktop dan mobile
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isMobile } = useMobile(); // Deteksi device mobile
    const { modals } = useModal();
    // Auto-sync is now triggered within the client-only Footer component
    const hasOpenModal = modals.length > 0;
    
    // State untuk mengingat lebar sidebar ketika terbuka
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);

    // ID dan tipe modal teratas untuk filter tampilan dan konfigurasi sidebar
    const topModalId = modals.length > 0 ? modals[modals.length - 1].id : null;
    const topModalType =
        modals.length > 0 ? modals[modals.length - 1].type : null;
    // Naive Bayes memakai sidebar khusus yang identik dengan Nearest
    // Neighbor (AGENTS.md §4.6 / PLAN.md Fase 6 §1) — kondisi yang sudah
    // ada diperluas, bukan di-rename, supaya perubahan di file bersama ini
    // seminimal mungkin.
    const isKNNModalOpen =
        topModalType === ModalType.ModalNearestNeighbor ||
        topModalType === ModalType.ModalNaiveBayes ||
        topModalType === ModalType.ModalApplyModel;
    const activeSidebarWidth = isKNNModalOpen ? KNN_SIDEBAR_WIDTH : sidebarWidth;

    // Key untuk memaksa ResizablePanelGroup re-mount saat perubahan state
    // Ini memastikan defaultSize diterapkan dengan benar selama transisi
    const desktopPanelGroupKey = isMobile
        ? 'mobile'
        : hasOpenModal
            ? `desktop-sidebar-open-${topModalId}-${isKNNModalOpen ? 'knn' : 'default'}`
            : 'desktop-sidebar-closed';

    // Filter untuk hanya menampilkan modal teratas
    const showOnlyTopModal = (modalId: string) => {
        return topModalId === modalId;
    };

    // Add custom CSS for tour inside resizable panel
    useEffect(() => {
        // Create style element
        const style = document.createElement('style');
        style.id = 'onborda-custom-styles';
        style.innerHTML = `
            .onborda-tooltip {
                position: absolute !important;
                left: auto !important;
                top: auto !important;
                transform: none !important;
                z-index: 9999 !important;
            }
            .resize-content {
                position: relative !important; 
                overflow: visible !important;
            }
            .tour-card {
                max-width: 100% !important;
                box-sizing: border-box !important;
            }
            .arrow-container {
                position: relative !important;
                z-index: 10000 !important;
            }
        `;
        
        // Add style to document head
        document.head.appendChild(style);
        
        // Clean up
        return () => {
            const existingStyle = document.getElementById('onborda-custom-styles');
            if (existingStyle) existingStyle.remove();
        };
    }, []);

    return (
        <OnbordaProvider>
            <ResultNavigationObserver />
                <DataLoader />

                <div className="h-screen w-full flex flex-col dashboard-layout" data-testid="dashboard-layout">
                    <header className="flex-shrink-0 z-50 flex items-center justify-between" data-testid="dashboard-layout-header">
                       <Header />
                       <SyncStatusClient />
                    </header>
                    <main className="flex-grow overflow-hidden relative bg-muted w-full" data-testid="dashboard-main-content">
                        {isMobile ? (
                            // Tampilan Mobile: Konten utama penuh lebar, modal sebagai dialog
                            <div className="h-full overflow-y-auto hide-scrollbar-x" data-testid="mobile-content">
                                <LoadingOverlay>
                                    {children}
                                </LoadingOverlay>
                                {/* Render modal sebagai dialog di mobile */}
                                {hasOpenModal && (
                                    <Suspense fallback={<ModalLoading />}>
                                        <ModalManager 
                                            customFilter={showOnlyTopModal} 
                                            containerType="dialog" 
                                        />
                                    </Suspense>
                                )}
                            </div>
                        ) : (
                            // Tampilan Desktop: Panel yang dapat diubah ukurannya untuk konten utama dan sidebar
                            <ResizablePanelGroup 
                                direction="horizontal"
                                key={desktopPanelGroupKey}
                                className="overflow-hidden w-full"
                                data-testid="desktop-resizable-panels"
                            >
                                <ResizablePanel 
                                    defaultSize={hasOpenModal ? (100 - activeSidebarWidth) : 100}
                                    minSize={hasOpenModal ? (100 - MAX_SIDEBAR_WIDTH) : 100} 
                                    maxSize={hasOpenModal ? (100 - MIN_SIDEBAR_WIDTH) : 100}
                                    order={1}
                                    className="transition-all duration-300 ease-in-out"
                                    data-testid="main-content-panel"
                                >
                                    <div className="h-full overflow-y-auto overflow-x-hidden w-full" data-testid="desktop-content">
                                        <LoadingOverlay>
                                            {children}
                                        </LoadingOverlay>
                                    </div>
                                </ResizablePanel>
                                
                                {/* Handle hanya ditampilkan ketika sidebar aktif */} 
                                {hasOpenModal && <ResizableHandle withHandle className="bg-border" />}
                                
                                <ResizablePanel 
                                    defaultSize={hasOpenModal ? activeSidebarWidth : 0} // Collapse jika tidak ada modal
                                    minSize={hasOpenModal ? MIN_SIDEBAR_WIDTH : 0} 
                                    maxSize={hasOpenModal ? MAX_SIDEBAR_WIDTH : 0}
                                    onResize={(size) => {
                                        // Simpan preferensi resize untuk modul lain; KNN selalu mulai dari 2/5 layar.
                                        if (hasOpenModal && !isKNNModalOpen) {
                                            setSidebarWidth(size);
                                        }
                                    }}
                                    collapsible={true}
                                    collapsedSize={0}
                                    order={2}
                                    className="transition-all duration-300 ease-in-out"
                                    data-testid="sidebar-panel"
                                >
                                    {/* Render modal sebagai sidebar panel di desktop */}
                                    {hasOpenModal && (
                                        <Suspense fallback={<ModalLoading />}>
                                            <div className="h-full w-full resize-content">
                                                <ModalManager 
                                                    customFilter={showOnlyTopModal} 
                                                    containerType="sidebar" 
                                                />
                                            </div>
                                        </Suspense>
                                    )}
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        )}
                    </main>
                    <footer className="flex-shrink-0 border-t border-border" data-testid="dashboard-footer">
                        <Footer />
                    </footer>
                </div>
                <Toaster />
        </OnbordaProvider>
    );
}
