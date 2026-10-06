#!/bin/bash

# Root repo (absolut), dipakai blok yang perlu kembali ke root setelah banyak cd
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Build script for WASM modules in the project

echo "Building Factor Analysis WASM module..."
cd frontend/components/Modals/Analyze/dimension-reduction/factor/rust
wasm-pack build --target web --release
echo "✓ Factor Analysis WASM module built successfully"

echo "Syncing Factor Analysis WASM to worker public directory..."
mkdir -p ../../../../../../public/workers/FactorAnalysis/pkg
cp -f pkg/wasm.js ../../../../../../public/workers/FactorAnalysis/pkg/wasm.js
cp -f pkg/wasm_bg.wasm ../../../../../../public/workers/FactorAnalysis/pkg/wasm_bg.wasm
cp -f pkg/wasm.d.ts ../../../../../../public/workers/FactorAnalysis/pkg/wasm.d.ts
cp -f pkg/wasm_bg.wasm.d.ts ../../../../../../public/workers/FactorAnalysis/pkg/wasm_bg.wasm.d.ts
echo "✓ Factor Analysis WASM artifacts synced"

echo ""
echo "Building TimeSeries WASM module..."
cd ../../../../TimeSeries/wasm
wasm-pack build --target web --release
echo "✓ TimeSeries WASM module built successfully"

echo ""
echo "Building K-Means Cluster WASM module..."
cd ../../Classify/k-means-cluster/rust
wasm-pack build --target web --release
echo "✓ K-Means Cluster WASM module built successfully"

echo ""
echo "Building Univariate WASM module..."
cd ../../general-linear-model/univariate/rust
wasm-pack build --target web --release
echo "✓ Univariate WASM module built successfully"

echo ""
echo "Building K-Medoids Cluster WASM module..."
cd ../../Classify/k-medoids-cluster/rust
wasm-pack build --target web --release
echo "✓ K-Medoids Cluster WASM module built successfully"

echo ""
echo "Building String To Word Vector WASM module..."
cd "$REPO_ROOT"
cd frontend/components/Modals/Transform/StringToWordVector/rust
wasm-pack build --target web --out-dir ../wasm-output --release
echo "✓ String To Word Vector WASM module built successfully"

echo ""
echo "All WASM modules built successfully!"
