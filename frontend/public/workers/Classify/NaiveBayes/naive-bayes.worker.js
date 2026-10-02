// Worker module Naive Bayes — meniru persis pola
// `public/workers/Classify/NearestNeighbor/nearest-neighbor.worker.js`.
//
// PLAN.md Fase 17 ("Sambungkan wasm asli ke worker & service, ganti dummy
// Fase 8"): `pkg/` di bawah folder ini HARUS diisi ulang secara MANUAL dari
// hasil `wasm-pack build --target web --release` terbaru atas
// `naive-bayes/rust` (build wasm Naive Bayes TIDAK masuk `build-wasm.sh`,
// PLAN.md §0 keputusan #2) SEBELUM worker ini benar-benar memuat engine
// statistik sungguhan (Fase 9-16) alih-alih dummy Fase 8. Agent yang
// menuliskan wiring ini TIDAK punya akses jaringan ke crates.io di sandbox
// maupun toolchain Rust di komputer lokal, jadi build itu sendiri
// didelegasikan ke pemilik produk — lihat laporan implementasi Fase 17
// untuk perintah persis (`wasm-pack build ...` + langkah copy `pkg/`).
//
// Query-string cache-busting (`?v=naive-bayes-real-<tanggal><urut>`)
// mengikuti pola KNN supaya browser tidak nyangkut pada wasm lama saat
// development. WAJIB di-bump lagi setiap kali `pkg/` di bawah ini di-copy
// ulang dari hasil `wasm-pack build` yang baru (termasuk BUILD PERTAMA
// yang menggantikan dummy Fase 8 — bump di fase ini sudah dilakukan
// sebagai penanda "kode sekarang mengharapkan wasm asli", TAPI file
// `pkg/*` di folder ini MASIH ISI DUMMY Fase 8 sampai pemilik produk
// menjalankan build dan menyalin ulang `pkg/*` secara manual).
import init, { NaiveBayesAnalysis } from "/workers/Classify/NaiveBayes/pkg/wasm.js?v=naive-bayes-real-20260928a";

const WASM_URL =
  "/workers/Classify/NaiveBayes/pkg/wasm_bg.wasm?v=naive-bayes-real-20260928a";

self.onmessage = async (e) => {
  const { target, predictors, targetDefs, predictorsDefs, config } = e.data;

  try {
    // init WASM (WAJIB kasih path biar ga error)
    await init(WASM_URL);

    const naiveBayes = new NaiveBayesAnalysis(
      target,
      predictors,
      targetDefs,
      predictorsDefs,
      config
    );

    const result = naiveBayes.get_formatted_results();
    const errors = naiveBayes.get_all_errors();

    self.postMessage({
      success: true,
      data: result,
      errors
    });

  } catch (err) {
    self.postMessage({
      success: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
};
