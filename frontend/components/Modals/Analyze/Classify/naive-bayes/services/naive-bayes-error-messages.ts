/**
 * Menerjemahkan pesan error internal (dari mesin analisis Naive Bayes)
 * menjadi pesan yang dipahami pengguna, dipakai sebagai `error` callback
 * pada `toast.promise` saat menjalankan analisis — pola identik
 * `getUserFriendlyKNNError` (nearest-neighbor-error-messages.ts).
 *
 * PLAN_V3_UI_EN (E2/E3): semua teks yang tampil ke pengguna berbahasa Inggris;
 * kalimat utama ramah pengguna, kode internal ditaruh di AKHIR dalam kurung,
 * mis. `... (NB_E_TEXT_NEGATIVE)`.
 *
 * Parser pesan Rust menerima format LAMA (Indonesia) maupun BARU (Inggris,
 * PLAN_V3_UI_EN §3.2) karena WASM baru dibangun belakangan oleh pemilik (E7).
 */

/** Menambahkan kode internal di akhir kalimat (pola E3). */
const withCode = (sentence: string, code: string): string => `${sentence} (${code})`;

export const getUserFriendlyNaiveBayesError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();

  // v2 (AGENTS_V2 §11): kode NB_E_* dikenali lewat prefiks kode (pola v1:
  // string matching). Dicek lebih dulu agar tidak tertangkap kata umum
  // ("fold", "predictor", dst.) pada pesan v1 di bawah.
  if (normalizedMessage.includes("nb_e_text_negative")) {
    // Format baru : "NB_E_TEXT_NEGATIVE: Text vector column '{col}' contains
    //                negative values ({n} column(s) affected). ..."
    // Format lama : "NB_E_TEXT_NEGATIVE: Kolom vektor teks '{kolom}' berisi
    //                nilai negatif (total {n} kolom bermasalah). ..."
    // Nama kolom pertama dan jumlah kolom WAJIB diteruskan (CATATAN_TAHAP2 §1).
    const column = /'([^']+)'/.exec(message)?.[1];
    const totalText =
      /\((\d+) column/i.exec(message)?.[1] ?? /total (\d+) kolom/i.exec(message)?.[1];
    if (column) {
      const total = totalText ? Number.parseInt(totalText, 10) : 1;
      const more = Number.isFinite(total) && total > 1 ? ` and ${total - 1} more column(s)` : "";
      return withCode(
        `Text vector column '${column}' contains negative values${more}. Text likelihoods require values >= 0; remove it from Word-Vector Variables.`,
        "NB_E_TEXT_NEGATIVE",
      );
    }
    // Ekstraksi gagal: pakai pesan umum.
    return withCode(
      "Text vector columns contain negative values. Text likelihoods require values >= 0; remove them from Word-Vector Variables.",
      "NB_E_TEXT_NEGATIVE",
    );
  }

  if (normalizedMessage.includes("nb_e_text_raw_missing")) {
    // Galat pemrograman/orkestrasi: container belum menyuplai teks mentah.
    return withCode(
      "The text of the Raw Text Variable is not available. Re-select the Raw Text Variable and run the analysis again; if this keeps happening, report it as an application error.",
      "NB_E_TEXT_RAW_MISSING",
    );
  }

  if (normalizedMessage.includes("nb_e_text_empty_vocab_fold")) {
    const code = "NB_E_TEXT_EMPTY_VOCAB_FOLD";
    // Menerima "fold 3", "fold ke-3", "fold ke 3", dan "fold #3" (format lama
    // dan baru). Dicari setelah prefiks kode agar nama kode tidak ikut dicocokkan.
    const body = message.replace(/^.*?NB_E_TEXT_EMPTY_VOCAB_FOLD:?/i, "");
    const foldMatch = /fold[\s_]*(?:ke)?[\s\-#:_]*(\d+)/i.exec(body);
    if (foldMatch) {
      return withCode(
        `No words are left in the training data of fold ${foldMatch[1]} after text preprocessing. Relax the Text Preprocessing settings or use fewer folds.`,
        code,
      );
    }
    // Format baru untuk validasi holdout: "... of the holdout split. ...".
    if (/holdout/i.test(body)) {
      return withCode(
        "No words are left in the training data of the holdout split after text preprocessing. Relax the Text Preprocessing settings.",
        code,
      );
    }
    return withCode(
      "No words are left in the training data of one of the folds after text preprocessing. Relax the Text Preprocessing settings or use fewer folds.",
      code,
    );
  }

  if (normalizedMessage.includes("nb_e_text_empty_vocab")) {
    return withCode(
      "No words are left after text preprocessing. Relax the Text Preprocessing settings (e.g. Words to Keep, Min term frequency, stopwords).",
      "NB_E_TEXT_EMPTY_VOCAB",
    );
  }

  if (normalizedMessage.includes("nb_e_complement_mixed")) {
    // Format baru menyebut jumlah predictor lain ("... also has {k} numeric/
    // categorical predictor(s)"); format lama tidak, sehingga jumlahnya opsional.
    const k = /(\d+)\s+numeric\/categorical predictor/i.exec(message)?.[1];
    const extra = k ? ` This model also has ${k} numeric/categorical predictor(s).` : "";
    return withCode(
      `Complement Naive Bayes can only be used when the model contains Text Features only.${extra} Choose Multinomial or Bernoulli, or remove the numeric/categorical predictors.`,
      "NB_E_COMPLEMENT_MIXED",
    );
  }

  if (normalizedMessage.includes("nb_e_text_shape")) {
    return withCode(
      "The text data does not match the dataset rows. Re-select the text variables and run the analysis again.",
      "NB_E_TEXT_SHAPE",
    );
  }

  if (normalizedMessage.includes("nb_e_text_config")) {
    // Pesan CORE diteruskan setelah prefiks kode, berbentuk "[KODE_CORE] pesan".
    // Pola E3: kalimat utama dulu, kode internal di akhir dalam kurung.
    const detail = message.replace(/^.*?NB_E_TEXT_CONFIG:?\s*/i, "").trim();
    const coded = /^\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(detail);
    const text = (coded ? coded[2] : detail).trim();
    const code = coded ? `NB_E_TEXT_CONFIG: ${coded[1]}` : "NB_E_TEXT_CONFIG";
    return text
      ? withCode(`The Text Preprocessing settings are not valid: ${text}`, code)
      : withCode(
          "The Text Preprocessing settings are not valid. Check the Text Preprocessing tab.",
          code,
        );
  }

  if (normalizedMessage.includes("target")) {
    return "Select a target variable before running the Naive Bayes analysis.";
  }

  if (
    normalizedMessage.includes("predictor") ||
    normalizedMessage.includes("feature") ||
    normalizedMessage.includes("no predictors")
  ) {
    return "Select at least one predictor variable before running the Naive Bayes analysis.";
  }

  if (
    normalizedMessage.includes("no cases") ||
    normalizedMessage.includes("no data") ||
    normalizedMessage.includes("no valid")
  ) {
    return "There are no valid cases to analyze. Check the selected variables for missing or invalid values.";
  }

  if (normalizedMessage.includes("fold")) {
    return "Check the cross-validation settings. The number of folds must not exceed the number of cases or the size of the smallest class.";
  }

  if (
    normalizedMessage.includes("worker") ||
    normalizedMessage.includes("wasm") ||
    normalizedMessage.includes("module") ||
    normalizedMessage.includes("stub")
  ) {
    return "The Naive Bayes analysis engine could not be loaded. Reload the page and try again.";
  }

  return "The Naive Bayes analysis could not be completed. Check the selected variables and settings, then try again.";
};
