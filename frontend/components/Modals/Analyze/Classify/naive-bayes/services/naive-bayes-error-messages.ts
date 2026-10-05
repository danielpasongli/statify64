/**
 * Menerjemahkan pesan error internal (dari mesin analisis Naive Bayes)
 * menjadi pesan yang dipahami pengguna, dipakai sebagai `error` callback
 * pada `toast.promise` saat menjalankan analisis — pola identik
 * `getUserFriendlyKNNError` (nearest-neighbor-error-messages.ts).
 *
 * Fase 7 (worker stub): hanya menangani error generik yang mungkin muncul
 * dari orkestrasi TS (target belum dipilih, predictor kosong, stub gagal
 * dimuat). Daftar pesan akan ditambah begitu bentuk pesan error asli dari
 * Rust/WASM diketahui (PLAN.md Fase 9+ / Fase 17).
 */
export const getUserFriendlyNaiveBayesError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("target")) {
    return "Pilih variabel target sebelum menjalankan analisis Naive Bayes.";
  }

  if (
    normalizedMessage.includes("predictor") ||
    normalizedMessage.includes("feature") ||
    normalizedMessage.includes("no predictors")
  ) {
    return "Pilih minimal satu variabel predictor sebelum menjalankan analisis Naive Bayes.";
  }

  if (
    normalizedMessage.includes("no cases") ||
    normalizedMessage.includes("no data") ||
    normalizedMessage.includes("no valid")
  ) {
    return "Tidak ada kasus valid yang bisa dianalisis. Periksa variabel yang dipilih untuk nilai kosong/tidak valid.";
  }

  if (normalizedMessage.includes("fold")) {
    return "Periksa pengaturan cross-validation. Jumlah fold tidak boleh melebihi jumlah instance atau anggota kelas terkecil.";
  }

  if (
    normalizedMessage.includes("worker") ||
    normalizedMessage.includes("wasm") ||
    normalizedMessage.includes("module") ||
    normalizedMessage.includes("stub")
  ) {
    return "Mesin analisis Naive Bayes gagal dimuat. Muat ulang halaman dan coba lagi.";
  }

  return "Analisis Naive Bayes tidak dapat diselesaikan. Periksa kembali variabel dan pengaturan yang dipilih, lalu coba lagi.";
};
