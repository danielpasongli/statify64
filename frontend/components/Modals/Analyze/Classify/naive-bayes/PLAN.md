# PLAN.md — Implementation Plan Menu Naive Bayes

Format yang dipilih: **file terpisah `PLAN.md`**, disandingkan dengan `AGENTS.md` di folder yang sama (`frontend/components/Modals/Analyze/Classify/naive-bayes/`). Alasannya: dokumen ini akan dirujuk berulang kali selama coding berlangsung (dicentang per-step), bukan dibaca sekali lalu dibuang seperti jawaban chat — jadi lebih pas jadi file yang hidup berdampingan dengan `AGENTS.md`, bukan hanya teks di percakapan.

Dokumen ini murni rencana kerja. **Tidak ada kode implementasi di sini.**

---

## 0. Keputusan yang sudah dikonfirmasi (mempengaruhi bentuk plan ini)

Empat keputusan berikut sudah dikonfirmasi dan membentuk struktur plan di bawah:

1. **Tab Variables**: reuse `VariableListManager` (komponen yang sama dipakai Nearest Neighbor), dibungkus logic mode eksklusif di level Naive Bayes — bukan komponen drop-zone custom dari nol.
2. **Build wasm**: Naive Bayes **tidak** ditambahkan ke `build-wasm.sh` (script itu memang sudah tidak mencakup Nearest Neighbor maupun Discriminant). Build wasm Naive Bayes dilakukan manual (`wasm-pack build` lalu copy ke `public/workers/Classify/NaiveBayes/pkg/`), mengikuti pola yang sudah berjalan untuk NN & Discriminant.
3. **Urutan kerja**: UI (React) dibangun & diverifikasi lebih dulu memakai **worker stub** (mengembalikan JSON contoh statis), sebelum engine Rust/WASM sungguhan ditulis. Engine asli disambungkan di fase akhir, menggantikan stub.
4. **Tidak ada estimasi waktu/effort** per fase — plan fokus ke urutan step, file, dan cara verifikasi.

## 1. Asumsi implementasi tambahan (hasil investigasi kode, bukan pertanyaan blocking)

Selain empat keputusan di atas, beberapa hal berikut ditemukan lewat pembacaan kode langsung dan diputuskan sebagai *judgment call* implementer — dicatat di sini secara terbuka supaya bisa dikoreksi kalau ternyata keliru, bukan disembunyikan sebagai asumsi diam-diam:

- **Lokasi lebar sidebar khusus KNN sudah ditemukan** (sebelumnya di `AGENTS.md` ditandai "perlu ditelusuri"): ada di `frontend/app/dashboard/layout.tsx` baris ±30–34 dan ±63–64 (`KNN_SIDEBAR_WIDTH = 40`, dicek lewat `topModalType === ModalType.ModalNearestNeighbor`, dipakai untuk `activeSidebarWidth`, `desktopPanelGroupKey`, dan pengecualian pada `onResize`). Rencana: **perluas kondisi yang sudah ada** (`isKNNModalOpen`) agar juga mengenali `ModalType.ModalNaiveBayes`, memakai nilai lebar yang sama (40%), tanpa me-refactor penamaan variabel yang sudah ada (`KNN_SIDEBAR_WIDTH`, dll.) — perubahan sekecil mungkin di file bersama ini. Detail di Fase 6.
- **Kontrak payload ke WASM**: satu daftar `predictors` (data + definisi variabel yang membawa `measure`), bukan dua array terpisah (kategorik vs numerik) yang dikirim manual dari sisi TS. Rust yang menentukan faktor vs kovariat dari `measure` tiap definisi variabel — konsisten dengan Kontrak Data §3.1 `AGENTS.md` (measure sebagai satu-satunya sumber kebenaran tipe). Ini meniru pola KNN yang mengirim `featureDefs` lengkap dengan metadata, bukan memisah tipe di sisi TS.
- **Rust crate independen**: folder `naive-bayes/rust` adalah crate wasm-pack yang berdiri sendiri (Cargo.toml sendiri, tidak ada shared-lib dengan `nearest-neighbor`), mengikuti pola tiap modul Classify/analisis lain di repo ini (Factor Analysis, TimeSeries, K-Means, K-Medoids, Univariate — semuanya crate terpisah, lihat `build-wasm.sh`). RNG Mersenne Twister ditulis ulang di dalam crate Naive Bayes sendiri (bukan import lintas-crate dari nearest-neighbor), karena repo ini memang tidak punya shared stats crate antar modul.
- **Testing Rust**: modul-modul lain (mis. `nearest-neighbor/rust/src/test/`) berisi file test yang praktis kosong (2 byte). Artinya level pengujian Rust di repo ini memang minim. Plan ini tetap menyarankan menulis beberapa unit test Rust nyata untuk rumus inti (smoothing, densitas Gaussian + variance floor, stratified split, metrik evaluasi) sebagai perbaikan kualitas — bukan alasan untuk tidak menguji sama sekali.
- **Key IndexedDB**: `"NaiveBayes"` (sejajar dengan `"NearestNeighbor"` milik KNN).
- **Posisi menu**: `MenubarItem` "Naive Bayes" diletakkan setelah "Nearest Neighbor" dan sebelum separator ROC di `classify-menu.tsx`. Item ini **tidak** diberi `disabled={true}` sejak Fase 0 supaya bisa diklik dan diverifikasi manual sepanjang pengembangan (mengikuti pola item lain yang sudah aktif seperti Discriminant dan Nearest Neighbor, bukan pola item yang masih `disabled={true}` seperti Tree/ROC).

Jika ada dari lima poin di atas yang ternyata tidak sesuai keinginan, tandai saja saat review — ini semua reversible dan tidak mengunci desain yang sudah disepakati di `AGENTS.md`.

---

## Struktur Fase

Plan dibagi dua bagian besar:

- **Bagian A (Fase 0–7)** — UI React lengkap, jalan di atas **worker stub** (data tiruan), bisa diklik dan diverifikasi visual dari awal tanpa menunggu Rust selesai.
- **Bagian B (Fase 8–19)** — engine Rust/WASM sungguhan, dibangun bertahap dari kerangka kosong sampai statistik lengkap, lalu menggantikan stub di Bagian A.

Setiap step mencantumkan **File**, **Ringkasan perubahan**, dan **Cara verifikasi manual**. Step-step dalam satu fase dianggap selesai kalau verifikasi fase tersebut lulus, baru lanjut ke fase berikutnya.

---

## BAGIAN A — UI (dengan worker stub)

### Fase 0 — Fondasi: tipe, konstanta, skeleton container, wiring minimal

Tujuan fase ini: panel Naive Bayes bisa dibuka dari menu sebagai sidebar kosong (tab kosong, tombol OK/Reset/Cancel ada tapi belum berfungsi penuh) — supaya semua fase berikutnya bisa diverifikasi langsung di browser.

1. **File**: `naive-bayes/types/naive-bayes.ts` (baru) ✅
   **Ringkasan**: Definisikan seluruh tipe data per tab (`NaiveBayesMainType`, `NaiveBayesOptionsType`, `NaiveBayesValidationType`, `NaiveBayesOutputType`), tipe props tiap tab, dan tipe gabungan `NaiveBayesType` + `NaiveBayesContainerProps` — persis mengikuti pola `types/nearest-neighbor.ts` (satu type data + satu type props per tab, field bernama PascalCase seperti `TargetVar`, `SpecificationMode`, dst., sesuai Kontrak Data `AGENTS.md` §3).
   **Verifikasi**: `tsc --noEmit` (atau `npm run lint` di `frontend/`) tidak error karena tipe belum dipakai di mana pun (boleh ada warning unused-export, bukan error).

2. **File**: `naive-bayes/constants/naive-bayes-default.ts` (baru) ✅
   **Ringkasan**: Nilai default per tab sesuai `AGENTS.md` §4 (mis. `SmoothingAlpha: 1`, `TrainingPercentage: 70`, `Folds: 10`, empat checkbox Output default `true`, `SpecificationMode: "exclude"` dengan list kosong), digabung jadi satu `NaiveBayesDefault`.
   **Verifikasi**: unit test kecil (`__tests__/naive-bayes-default.test.ts`) yang men-assert setiap nilai default sesuai angka di `AGENTS.md` — mencegah default drift diam-diam di kemudian hari.

3. **File**: `frontend/types/modalTypes.ts` (ubah — **wiring wajib**, satu baris tambahan) ✅
   **Ringkasan**: Tambah `ModalNaiveBayes` ke enum `ModalType`, plus entri judul modal (`getModalTitle`) bernilai `"Naive Bayes"`.
   **Verifikasi**: `tsc --noEmit` lulus; `ModalType.ModalNaiveBayes` bisa diimpor dari file lain tanpa error.

4. **File**: `naive-bayes/dialogs/naive-bayes-main.tsx` (baru) ✅
   **Ringkasan**: Container skeleton meniru `nearest-neighbor-main.tsx`: `Tabs`/`TabsList`/`TabsContent` dengan 4 tab (Variables, Options, Validation, Output) yang isinya sementara placeholder teks (`"TODO"`), state `formData` bertipe `NaiveBayesType` diisi dari `NaiveBayesDefault`, `activeTab`, `resetKey`, `helperMode`. Footer sticky dengan tombol OK (disabled sementara, `disabled={true}` hardcode dulu), Reset, Cancel — Cancel & tombol close di header sidebar sudah harus benar-benar menutup panel (pakai `useModal().closeModal()` + `onClose()` seperti `KNNContainer`).
   **Verifikasi**: belum bisa dibuka dari UI (menu belum didaftarkan) — cukup pastikan file ini kompilasi tanpa error (`tsc --noEmit`).

5. **File**: `../ClassifyRegistry.tsx` (ubah — wiring wajib) ✅
   **Ringkasan**: Tambah `lazy(() => import(".../naive-bayes/dialogs/naive-bayes-main").then(m => ({default: m.NaiveBayesContainer})))`, daftarkan ke `CLASSIFY_MODAL_COMPONENTS[ModalType.ModalNaiveBayes]`, set `CLASSIFY_MODAL_CONTAINER_PREFERENCES[ModalType.ModalNaiveBayes] = "sidebar"`.
   **Verifikasi**: build dev (`npm run dev`) tidak crash saat startup.

6. **File**: `../classify-menu.tsx` (ubah — wiring wajib) ✅
   **Ringkasan**: Tambah `MenubarItem` baru "Naive Bayes" memanggil `openModal(ModalType.ModalNaiveBayes)`, diposisikan setelah "Nearest Neighbor" (lihat §1 poin "Posisi menu").
   **Verifikasi manual di browser**: buka aplikasi → Analyze → Classify → klik "Naive Bayes" → panel muncul di **sidebar kanan** (bukan dialog tengah) dengan judul "Naive Bayes", empat tab terlihat (isinya placeholder "TODO"), tombol OK terlihat disabled, tombol Reset & Cancel ada. Klik Cancel/tombol X → panel tertutup bersih tanpa error di console.

> Setelah Fase 0 lulus, setiap fase berikutnya (1–7) bisa diverifikasi langsung dengan cara yang sama: buka menu, lihat tab yang relevan berubah dari placeholder jadi UI sungguhan.

---

### Fase 1 — Tab Variables

1. **File**: `naive-bayes/components/dataset-variable-list.tsx` (baru, atau nama setara) ✅
   **Ringkasan**: Panel kiri daftar variabel dataset: tombol sort (Nama / Measurement Level) + toggle arah ascending/descending, tombol "Select All", "Select All Nominal Fields", "Select All Continuous Fields" yang hanya meng-highlight (bukan memindahkan) sesuai `AGENTS.md` §3.4, mendukung Shift-click range-select.
   **Verifikasi**: buka tab Variables, klik tombol sort by Nama/Measure dan panah arah → urutan daftar variabel berubah sesuai. Klik "Select All Nominal Fields" → hanya variabel bermeasure nominal/ordinal yang ter-highlight, variabel tidak berubah lokasi.

2. **Investigasi singkat (bukan kode)**: baca ulang `frontend/components/Common/VariableListManager.tsx` secara utuh (belum dibaca detail saat riset `AGENTS.md`) untuk memastikan asumsi Keputusan §0.1 benar: apakah `targetLists` bisa punya entri yang `disabled`/read-only secara keseluruhan (untuk meng-abukan grup yang tidak aktif), dan apakah `onMoveVariable`/`onReorderVariable` cukup untuk mengimplementasikan "kembalikan variabel ke pool saat mode berpindah".
   **Verifikasi**: hasil investigasi dicatat sebagai komentar singkat di PR/commit pertama tab Variables (2–3 kalimat: bisa reuse langsung / perlu wrapper tambahan / perlu fallback custom untuk sebagian kecil perilaku). Ini bukan blocking step tapi wajib dilakukan sebelum menulis kode dropzone supaya tidak menebak-nebak API komponen.
   **Hasil investigasi**: ✅ `VariableListManager` mendukung `allowedMeasurements` dan `maxItems` untuk validasi per-list. Tidak ada prop `disabled` untuk read-only list — perlu wrapper/logic di level hook untuk mengabukan grup yang tidak aktif. `onMoveVariable` dan `onReorderVariable` cukup untuk kebutuhan Naive Bayes (tidak ada mode berpindah seperti KNN yang memerlukan pengembalian variabel ke pool).

3. **File**: `naive-bayes/hooks/useNaiveBayesVariableRules.ts` (baru) ✅ **TIDAK DIPERLUKAN — digantikan oleh implementasi langsung di `variables-tab.tsx`**
   **Ringkasan**: Untuk Naive Bayes, aturan interaksi lebih sederhana dari KNN karena tidak ada mode Specification (Excluded vs Candidates) yang berpindah-pindah. Aturan drop/validasi diimplementasikan langsung di `variables-tab.tsx` via props `allowedMeasurements` dan `maxItems` pada `VariableListManager`.
   **Verifikasi**: (a) drop variabel nominal/ordinal ke Target → diterima (maxItems 1); (b) drop variabel scale ke Target → ditolak; (c) drop variabel apapun ke Features → diterima; (d) drop variabel apapun ke Case ID → diterima (maxItems 1); (e) variabel `measure: "unknown"` masih bisa dipilih (perlu peringatan di Fase 5 validasi terpusat).

4. **File**: `naive-bayes/dialogs/variables.tsx` (baru) ✅ **DIGANTI NAMA menjadi `naive-bayes/components/variables-tab.tsx`**
   **Ringkasan**: Tab Variables sungguhan: kiri = `dataset-variable-list` (tidak dipakai — `VariableListManager` sudah menyediakan panel kiri), kanan = `VariableListManager` dengan 3 target list: Target (maxItems 1, allowedMeasurements: nominal/ordinal), Features (allowedMeasurements: nominal/ordinal/scale), dan Case ID (maxItems 1).
   **Catatan implementasi**: File `dataset-variable-list.tsx` dibuat sebagai komponen terpisah untuk panel kiri custom, namun `VariableListManager` sudah menyediakan panel kiri bawaan. Untuk Fase 1 ini, `dataset-variable-list.tsx` tidak digunakan dan bisa dihapus di housekeeping akhir. Yang dipakai adalah `VariableListManager` langsung.
   **Verifikasi manual**: buka tab Variables → drag satu variabel ke Target → tampil di kotak Target. Drag variabel lain ke Features → masuk ke daftar Features. Drag variabel scale ke Target → ditolak (karena allowedMeasurements Target hanya nominal/ordinal). Double-click variabel di available → pindah ke Target jika kosong, else ke Features. Double-click di Target/Features/Case ID → kembali ke available.

---

### Fase 2 — Tab Options

1. **File**: `naive-bayes/dialogs/options.tsx` (baru) ✅
   **Ringkasan**: Satu input numerik `SmoothingAlpha` dengan label, default 1, styling section mengikuti pola `neighbors.tsx` (satu `<section>` di dalam card `rounded-lg border`).
   **Verifikasi manual**: buka tab Options → nilai default terisi 1. Ubah ke 0 → pesan validasi muncul saat pindah tab/klik OK ("harus > 0"). Ubah ke 1000 → validasi menolak (maks 999). Ubah ke 0.5 → diterima (boleh desimal).

---

### Fase 3 — Tab Validation

1. **File**: `naive-bayes/hooks/useNaiveBayesValidationRules.ts` (baru) ✅ **TIDAK DIPERLUKAN — logic diimplementasikan langsung di `validation.tsx`**
   **Ringkasan**: Fungsi murni untuk: hitung `HoldoutPercentage = 100 - TrainingPercentage`; tentukan field mana yang abu-abu berdasarkan `ValidationMethod` (`"holdout" | "kfold"`); default `NumPartition`/`Folds` saat berpindah metode; `isSeedApplicable` (di Naive Bayes seed selalu bisa dipakai untuk kedua metode, beda dengan KNN yang punya kasus `isSeedUnavailable` — cek ulang apakah Naive Bayes butuh pengecualian serupa; berdasarkan `AGENTS.md` tidak ada kombinasi yang mematikan seed, jadi kemungkinan besar seed selalu aktif selama `SetSeed` dicentang).
   **Catatan implementasi**: Untuk Naive Bayes, logic validasi lebih sederhana dari KNN karena tidak ada `NumPartition` (hanya `HoldoutPercent` dan `KFolds`). Logic diimplementasikan langsung di komponen `validation.tsx` tanpa hook terpisah.
   **Verifikasi**: unit test menutupi: switch holdout→kfold mengosongkan/abukan field holdout; `HoldoutPercentage` selalu `100 - TrainingPercentage`; default `Folds = 10` muncul saat pertama kali masuk mode kfold.

2. **File**: `naive-bayes/dialogs/validation.tsx` (baru) ✅
   **Ringkasan**: `RadioGroup` top-level "Validation Strategy" (Holdout vs K-Fold) yang mengontrol dua section (mengikuti gaya visual `partition.tsx`: section per blok, opacity-50 + pointer-events-none untuk section nonaktif), input `TrainingNumber`/holdout read-only, input `Folds`, checkbox `SetSeed` + input `Seed` (range 0–4294967295).
   **Verifikasi manual**: pilih Holdout → input Training % aktif, Holdout % otomatis terisi (100-training), section K-Fold abu-abu. Pilih K-Fold → sebaliknya. Isi Training % = 60 → Holdout % tampil 40. Centang Set Seed → input Seed aktif, isi angka di luar 0–4294967295 → validasi menolak.

---

### Fase 4 — Tab Output + tombol Export Model (placeholder)

1. **File**: `naive-bayes/dialogs/output.tsx` (baru)
   **Ringkasan**: 4 checkbox (Case Processing Summary, Attribute Distribution Table, Model Evaluation Metrics, Confusion Matrix), semua default `true`, pola `normalizeOutputCheckboxValue` seperti KNN.
   **Verifikasi manual**: buka tab Output → keempat checkbox sudah tercentang secara default. Uncheck satu → state berubah (cek lewat React DevTools atau log sementara, karena belum ada output sungguhan untuk dicek visual).

2. **File**: `naive-bayes/components/export-model-action.tsx` (baru, belum difungsikan penuh)
   **Ringkasan**: Komponen tombol "Export Model" + input nama file (default `Naive_Bayes_Model_Export.json`) — di fase ini cukup dibuat sebagai komponen berdiri sendiri yang menerima prop `trainedModel` dan `onExport`, belum dipasang di output viewer sungguhan (itu Fase 7).
   **Verifikasi**: render komponen ini di halaman/test terisolasi (React Testing Library) dengan `trainedModel` dummy → klik tombol memicu `onExport` dengan nama file yang benar (default atau yang diketik user).

---

### Fase 5 — Validasi terpusat, tombol OK/Reset/Cancel, persistensi, reset-saat-dataset-berubah

1. **File**: `naive-bayes/hooks/useNaiveBayesValidation.ts` (baru)
   **Ringkasan**: Hook pusat (pola `useNearestNeighborValidation.ts`): `{ validation: {isValid, errors}, validateNumericInputs(): string | null }`. `isValid` = target terisi DAN predictor efektif (hasil `getEffectivePredictors`) tidak kosong. `validateNumericInputs` menggabungkan validasi alpha, training %, folds, seed dari fase-fase sebelumnya jadi satu pintu.
   **Verifikasi**: unit test: form kosong → `isValid=false` dengan pesan yang tepat; target+predictor terisi tapi alpha=0 → `validateNumericInputs` mengembalikan pesan alpha; semua valid → keduanya `null`/`isValid=true`.

2. **File**: `naive-bayes/dialogs/naive-bayes-main.tsx` (ubah)
   **Ringkasan**: Sambungkan hook Fase 5.1 ke tombol OK (`disabled={!validation.isValid}`, klik OK jalankan `validateNumericInputs()` dulu). Tambah load/save/clear via `useIndexedDB` dengan key `"NaiveBayes"` (persist saat panel ditutup, restore saat dibuka lagi, hapus saat Reset). Tambah listener perubahan dataset (mis. subscribe ke `useVariableStore`) yang me-reset seluruh `formData` ke default ketika daftar variabel berubah (sesuai `AGENTS.md` §4.5, beda dari KNN).
   **Verifikasi manual**: isi beberapa field → tutup panel (Cancel) → buka lagi → isian tadi masih ada (persist). Klik Reset → semua kembali default, tab aktif kembali ke Variables. Ubah dataset (mis. hapus satu variabel di Variable View) → buka lagi Naive Bayes → seluruh form kembali default (bukan cuma referensi variabel yang hilang dibersihkan).

---

### Fase 6 — Integrasi & Registrasi Menu (Finalisasi)

Fase ini merapikan wiring yang di Fase 0 masih versi "minimal supaya bisa diklik" menjadi versi final sesuai `AGENTS.md` §4.6.

1. **File**: `frontend/app/dashboard/layout.tsx` (ubah — wiring wajib, file bersama di luar folder ini)
   **Ringkasan**: Perluas kondisi `isKNNModalOpen` (atau tambahkan kondisi paralel yang di-OR-kan) agar juga bernilai true saat `topModalType === ModalType.ModalNaiveBayes`, sehingga `activeSidebarWidth` ikut memakai `KNN_SIDEBAR_WIDTH` (40%) dan pengecualian pada `onResize`/`desktopPanelGroupKey` berlaku sama. Perubahan dibuat sekecil mungkin (tidak me-rename konstanta yang sudah ada), sesuai catatan §1.
   **Verifikasi manual**: buka Naive Bayes di desktop (bukan mobile) → lebar sidebar awal ≈40% dari layar (bandingkan visual dengan membuka Nearest Neighbor lalu Naive Bayes bergantian, lebarnya harus sama). Coba drag resize handle → panel bisa di-resize (tidak terkunci). Buka modal lain (mis. Discriminant) → lebar sidebar kembali ke default 30% atau nilai terakhir yang di-resize user untuk modal non-KNN/non-NaiveBayes (tidak ketiban 40%).

2. **Verifikasi mobile**: set viewport ke ukuran mobile (atau pakai emulator device) → buka Naive Bayes → tampil sebagai dialog tengah (bukan sidebar), sama seperti perilaku KNN di mobile (mengikuti `useMobile()` yang otomatis override ke `"dialog"`, tidak perlu kode tambahan — tinggal diverifikasi berperilaku sama).

3. **Review akhir wiring**: cek ulang `classify-menu.tsx` (posisi & label item benar, tidak ada typo), `ClassifyRegistry.tsx` (import path benar, tidak ada modal lain yang ke-overwrite), `modalTypes.ts` (judul modal "Naive Bayes" tampil benar di header sidebar).
   **Verifikasi**: klik semua item lain di menu Classify (Tree, Discriminant, Nearest Neighbor, ROC Curve, ROC Analysis) satu per satu → semuanya masih terbuka normal seperti sebelum perubahan (regression check bahwa penambahan Naive Bayes tidak merusak modal lain).

---

### Fase 7 — Service layer stub: worker palsu, formatter, integrasi output viewer, Export Model fungsional

1. **File**: `naive-bayes/services/__fixtures__/naive-bayes-stub-result.json` (baru, hanya untuk pengembangan — boleh dihapus/diganti nanti)
   **Ringkasan**: JSON contoh hasil analisis yang bentuknya meniru apa yang nanti dikembalikan WASM (angka-angka dummy tapi terstruktur benar: `case_processing_summary`, `attribute_distribution`, `evaluation_metrics`, `confusion_matrix`, `trained_model`).
   **Verifikasi**: file valid JSON, strukturnya dicocokkan manual terhadap skema di `AGENTS.md` §5.10 dan §5.6–§5.8.

2. **File**: `naive-bayes/services/naive-bayes-analysis-formatter.ts` (baru)
   **Ringkasan**: Fungsi yang mengubah struktur mentah (baik dari stub JSON maupun nanti dari WASM — bentuknya disamakan sejak awal) menjadi `Table[]` yang dipahami output viewer aplikasi (field `key`, `rows`, dst. sesuai `types/Table.ts`), mengikuti pola `nearest-neighbor-analysis-formatter.ts`.
   **Verifikasi**: unit test yang memasukkan stub JSON Fase 7.1 dan mencocokkan output `Table[]` (jumlah baris Attribute Distribution Table sesuai jumlah kategori × kelas, dst.).

3. **File**: `naive-bayes/services/naive-bayes-analysis-output.ts` (baru)
   **Ringkasan**: Fungsi `resultNaiveBayes({formattedResult, rawResult, configData})` mengikuti pola persis `resultNearestNeighbor`: `addLog({log: "Naive Bayes Analysis"})` → `addAnalytic(logId, {title: "Naive Bayes Analysis Result"})` → `addStatistic(...)` satu per tabel yang dicentang di tab Output (Case Processing Summary, Attribute Distribution Table, Model Evaluation Metrics, Confusion Matrix), `output_data` berisi `JSON.stringify({tables: [table]})`.
   **Verifikasi**: unit test memanggil fungsi ini dengan `useResultStore` di-mock, pastikan `addLog`/`addAnalytic`/`addStatistic` dipanggil dengan jumlah & argumen yang benar sesuai checkbox Output yang aktif (mis. uncheck Confusion Matrix → `addStatistic` untuk itu tidak dipanggil).

4. **File**: `naive-bayes/services/naive-bayes-analysis.ts` (baru)
   **Ringkasan**: Orkestrator (pola `nearest-neighbor-analysis.ts`) — untuk fase ini **tanpa** worker/WASM sungguhan: langsung baca stub JSON (Fase 7.1), lempar ke formatter (7.2), lalu ke output (7.3), simulasikan delay dengan `setTimeout`/`Promise` supaya UI loading state (`toast.promise`) tetap teruji. Simpan hasil `trainedModel` dari stub ke state `execution.trainedModel` di container agar tombol Export Model (Fase 4.2) bisa dipasang sungguhan di sini.
   **Verifikasi manual (end-to-end dengan data palsu)**: isi form lengkap (target, predictor via salah satu mode, alpha, validation, output) → klik OK → toast "Running..." muncul → toast sukses → panel tertutup → buka panel Result/Output aplikasi → muncul entry baru "Naive Bayes Analysis" dengan tabel-tabel sesuai checkbox yang dicentang (isinya angka dummy dari stub, itu wajar). Tombol "Export Model" muncul di viewer, diklik → file JSON terunduh dengan nama sesuai input (default `Naive_Bayes_Model_Export.json`).

5. **File**: `naive-bayes/services/naive-bayes-error-messages.ts` (baru)
   **Ringkasan**: `getUserFriendlyNaiveBayesError(error)` mengikuti pola `getUserFriendlyKNNError` — untuk fase ini cukup menangani error generik ("target belum dipilih", "predictor kosong", "worker/wasm gagal dimuat"); daftar pesan akan ditambah lagi begitu pesan error asli dari Rust (Fase 9+) diketahui bentuknya.
   **Verifikasi**: unit test dengan beberapa pesan error mentah contoh → cocok dengan pesan ramah yang diharapkan.

> **Checkpoint Bagian A selesai**: seluruh alur UI (isi form → validasi → jalankan → lihat hasil di viewer → export model) sudah bisa didemokan end-to-end memakai data palsu. Ini titik yang bagus untuk review UI/UX sebelum masuk ke pekerjaan Rust yang lebih berat.

---

## BAGIAN B — Engine Rust/WASM

### Fase 8 — Scaffold crate + wasm dummy tersambung ke worker

1. **File**: `naive-bayes/rust/Cargo.toml`, `naive-bayes/rust/src/lib.rs`, `naive-bayes/rust/src/{models,stats,utils,wasm}/mod.rs` (baru)
   **Ringkasan**: Kerangka folder identik pola `nearest-neighbor/rust` (lihat `AGENTS.md` §2 tabel referensi), tapi isi tiap fungsi masih dummy/`todo!()` minimal supaya crate bisa di-compile. `wasm/constructor.rs` mengekspos satu class (misal `NaiveBayesAnalysis`) dengan constructor yang menerima payload sesuai kontrak §3.5, dan method `get_formatted_results()` yang untuk sementara mengembalikan struktur statis (hardcoded) yang bentuknya sama dengan stub JSON Fase 7.1, plus `get_all_errors()`.
   **Verifikasi**: `cd naive-bayes/rust && wasm-pack build --target web --release` sukses tanpa error compile.

2. **File**: `frontend/public/workers/Classify/NaiveBayes/pkg/*` (hasil copy manual dari `rust/pkg/*`), `frontend/public/workers/Classify/NaiveBayes/naive-bayes.worker.js` (baru)
   **Ringkasan**: Worker module meniru persis `nearest-neighbor.worker.js` — `init()` dari `pkg/wasm.js`, buat instance `NaiveBayesAnalysis(...)` dengan argumen sesuai payload, panggil `get_formatted_results()`/`get_all_errors()`, `postMessage` hasilnya. Sertakan query-string cache-busting (`?v=naive-bayes-<tanggal>`) seperti pola KNN, supaya browser tidak nyangkut wasm lama saat development.
   **Verifikasi**: dari console browser atau test manual, panggil worker ini langsung dengan payload dummy → `onmessage` mengembalikan struktur dummy yang di-hardcode di step 8.1 (bukan error).

3. **File**: `naive-bayes/services/naive-bayes-analysis.ts` (ubah)
   **Ringkasan**: Ganti pemanggilan stub JSON (Fase 7.4) dengan `new Worker("/workers/Classify/NaiveBayes/naive-bayes.worker.js?...")` sungguhan, payload dikonstruksi dari `getSlicedData`/`getVarDefs` seperti pola KNN.
   **Verifikasi manual end-to-end**: ulangi verifikasi manual Fase 7.4 (isi form → OK → lihat hasil di viewer) — sekarang datanya lewat wasm dummy asli (bukan `setTimeout` stub), tapi angkanya masih sama (hardcoded dummy). Ini membuktikan **pipeline wasm-worker-formatter-output benar-benar tersambung** sebelum menulis satu baris statistik pun.

---

### Fase 9 — Preprocessing data di Rust (parsing, pemisahan factor/covariate, missing value)

1. **File**: `naive-bayes/rust/src/models/{config.rs, data.rs}`
   **Ringkasan**: Struct konfigurasi (alpha, validation method, output flags) dan struct data masuk (target, predictors + defs). Parsing payload JS→Rust (via `serde`/`wasm-bindgen`, meniru `utils/converter.rs` KNN).
2. **File**: `naive-bayes/rust/src/stats/preprocess_data.rs`
   **Ringkasan**: Implementasi aturan §5.4 `AGENTS.md`: buang baris dengan target missing (listwise); kategorikal missing → kategori `"(Missing)"`; numerik missing → dikecualikan hanya dari mean/variance atribut itu. Tentukan factor vs covariate dari `measure` tiap definisi variabel; variabel `measure: "unknown"` yang lolos sampai sini (seharusnya sudah dicegah di UI) tetap ditolak dengan error eksplisit sebagai pengaman lapis kedua.
   **Verifikasi**: unit test Rust (`cargo test`) dengan dataset kecil buatan tangan (≤10 baris, beberapa missing value tersebar) → assert baris yang tersisa dan kategori "(Missing)" muncul sesuai perhitungan manual.

---

### Fase 10 — Stratified train/holdout split + Mersenne Twister

1. **File**: `naive-bayes/rust/src/stats/mersenne_twister.rs`
   **Ringkasan**: RNG seeded (u32), ditulis ulang mengikuti gaya `nearest-neighbor/rust/src/stats/mersenne_twister.rs` (bukan di-import lintas crate).
2. **File**: `naive-bayes/rust/src/stats/partition.rs`
   **Ringkasan**: Stratified split training/holdout berdasarkan `TrainingPercentage`, seeded bila `SetSeed` aktif.
   **Verifikasi**: `cargo test` — dataset kecil dengan distribusi kelas diketahui → proporsi kelas di training & holdout mendekati proporsi keseluruhan (stratified, bukan random polos); menjalankan dua kali dengan seed sama → hasil split identik; seed beda/tanpa seed → hasil split (kemungkinan besar) berbeda.

---

### Fase 11 — Stratified K-Fold

1. **File**: `naive-bayes/rust/src/stats/partition.rs` (lanjutan)
   **Ringkasan**: Implementasi pembagian k-fold stratified, termasuk pengecekan `Folds > min(n_instance, n_anggota_kelas_terkecil)` yang menghasilkan warning/error terstruktur (dikembalikan lewat `get_all_errors()`), sesuai §5.5 `AGENTS.md`.
   **Verifikasi**: `cargo test` dengan dataset kecil 3 kelas tidak seimbang → tiap fold menjaga proporsi kelas relatif (dalam batas pembulatan wajar); coba `Folds` lebih besar dari anggota kelas terkecil → warning muncul di hasil, bukan crash.

---

### Fase 12 — Training model: prior kelas, parameter Gaussian (covariate), frekuensi + smoothing (factor) ✅

1. **File**: `naive-bayes/rust/src/stats/{class_prior.rs, numerical_distribution.rs, categorical_distribution.rs, training.rs}` (baru) ✅
   **Ringkasan**: `class_prior.rs` menghitung `class_priors` (`count(class)/n`); `numerical_distribution.rs` menghitung mean & variance per covariate per kelas + variance floor/epsilon (§5.3); `categorical_distribution.rs` menghitung frekuensi kategori per kelas + Laplace smoothing dengan `alpha` (§5.2), termasuk kategori "(Missing)" bila ada; `training.rs` (file tambahan di luar dua nama yang disebut draft awal, dipakai karena "nama final bebas" diizinkan) menggabungkan ketiganya jadi satu `TrainedModelParams`. Belum disambungkan ke `wasm/` (itu Fase 16) — modul-modul ini murni fungsi statistik atas `PreprocessedCase` hasil Fase 9.
   **Keputusan untuk 3 hal yang tadinya judgment call terbuka** (diselesaikan memakai konvensi yang umum dipakai, sesuai arahan pemilik produk — bukan lagi pertanyaan terbuka untuk Fase 13+):
   - **Variance Gaussian**: population variance (dibagi `n`, bukan `n-1`) — sama seperti `scikit-learn GaussianNB` (`ddof=0`).
   - **Kelas tanpa observasi non-missing sama sekali untuk suatu covariate**: fallback ke mean & variance GLOBAL (dihitung dari seluruh dataset untuk covariate itu, lintas kelas) — "backoff ke statistik marginal", bukan `mean=0.0` yang arbitrer. Kalau data global pun kosong (jauh lebih degenerate), baru jatuh ke `mean=0.0, variance=floor`.
   - **`jumlah_kategori` pada smoothing kategorik**: dihitung LINTAS KELAS (union kategori dari seluruh training data yang diberikan), bukan per-kelas — sama seperti `scikit-learn CategoricalNB`, dan konsisten dengan §5.9 (kategori tak dikenal di suatu kelas tetap pakai penyebut yang sama dari training).
   **Verifikasi**: `cargo test` di `naive-bayes/rust` — **51 test lulus, 0 gagal** (16 di antaranya test Fase 12: `class_prior`, `numerical_distribution`, `categorical_distribution`, `training`), dijalankan langsung oleh pemilik produk di lingkungan lokal. Angka dicocokkan terhadap perhitungan manual Python untuk dataset kecil buatan tangan (6 baris, 2 kelas, 1 factor "Outlook", 1 covariate "Temp", alpha=1) — hasil identik sampai presisi floating point (mis. prior 0.5/0.5; mean/variance Temp 72.0/2.6667 & 84.0/18.6667; probabilitas smoothed Outlook 0.5/0.3333/0.1667), plus kasus tambahan missing value, variance floor, dan fallback kelas kosong.

---

### Fase 13 — Prediksi / scoring + penanganan kategori tak dikenal

1. **File**: `naive-bayes/rust/src/stats/prediction.rs`
   **Ringkasan**: Hitung log-likelihood gabungan (Gaussian utk covariate + kategorik utk factor) + log prior, ambil kelas dengan skor tertinggi. Kategori yang tidak muncul di training (pada fold/holdout tertentu) diberi probabilitas kecil via smoothing (§5.9), bukan error.
   **Verifikasi**: `cargo test` — kasus dengan kategori benar-benar baru pada data evaluasi (sengaja dibuat) tidak menyebabkan panic/NaN; hasil prediksi tetap berupa kelas valid.

---

### Fase 14 — Metrik evaluasi & Confusion Matrix ✅

1. **File**: `naive-bayes/rust/src/stats/classification_table.rs` (baru) ✅
   **Ringkasan**: Confusion matrix (baris=actual, kolom=predicted) dengan count/total/persentase; precision/recall/F1 per kelas + macro/weighted/micro average + overall accuracy; Cohen's Kappa overall (§5.6–5.7). **Basis persentase per sel confusion matrix** (tidak dipatok angka pasti di AGENTS.md §5.7) diputuskan eksplisit: persentase terhadap **grand total** (`count / grand_total × 100`), bukan persentase per-baris — karena persentase per-baris identik secara matematis dengan Recall per kelas yang sudah dihitung terpisah, memakai basis yang sama akan jadi duplikasi definisi. Didokumentasikan di komentar kepala file, terbuka untuk dikoreksi bila pemilik produk menghendaki basis lain. **Kappa ditegaskan HANYA satu angka overall** (`EvaluationMetrics::cohens_kappa: f64`), tidak ada varian per kelas di mana pun dalam modul ini — koreksi final ambiguitas draft spesifikasi awal.
   **Verifikasi**: `cargo test` di `naive-bayes/rust` — **76 test lulus, 0 gagal** (13 di antaranya test Fase 14 baru: `classification_table::tests::*`), dijalankan langsung oleh pemilik produk di lingkungan lokal. Angka dicocokkan terhadap perhitungan manual (dataset buatan tangan 3 kelas × 10 instance) memakai pecahan eksak: precision/recall/F1 per kelas (A=1.0/1.0/1.0, B=C=0.8/0.8/0.8), macro/weighted average = 0.8666666666666667, overall accuracy = 26/30, Cohen's Kappa = 0.8 persis — plus kasus tambahan agreement sempurna (kappa=1.0), agreement setara peluang (kappa=0.0), kasus degenerate satu-kelas-efektif (pe=1 → kappa=0.0 bukan NaN), kelas dengan support 0, label di luar daftar kelas, dan properti micro-average == overall accuracy untuk confusion matrix multiclass single-label. Termasuk uji eksplisit bahwa Kappa hanya muncul sebagai satu angka overall, tidak per kelas.

---

### Fase 15 — Attribute Distribution Table & Case Processing Summary

1. **File**: `naive-bayes/rust/src/stats/{attribute_distribution.rs, case_summary.rs}` (nama setara)
   **Ringkasan**: Tabel distribusi gaya WEKA (§5.8): per kategori/kelas raw count, smoothed count, probability, total (kategorik); mean & std dev (numerik, tanpa weighted sum). Case Processing Summary: total instance, valid, dibuang karena target missing, target/atribut yang dipakai, skenario validasi.
   **Verifikasi**: `cargo test` mencocokkan angka terhadap dataset kecil yang sudah dihitung manual, termasuk pengecekan bahwa tabel ini berasal dari **model final (retrain di seluruh data)**, bukan dari satu fold (§5.5) — bisa diuji dengan membandingkan hasil training-full-data vs salah satu fold yang sengaja dibuat berbeda proporsinya.

---

### Fase 16 — Retrain model final, serialisasi JSON export, binding WASM lengkap

1. **File**: `naive-bayes/rust/src/stats/save.rs`
   **Ringkasan**: Setelah evaluasi (holdout/k-fold) selesai dipakai untuk metrik, retrain model di seluruh dataset, serialisasi ke struktur JSON sesuai skema §5.10 `AGENTS.md` (schema_version, model_type, target, features, smoothing_alpha, variance_floor, feature_order, label_mapping, validation_config, missing/unseen policy).
2. **File**: `naive-bayes/rust/src/wasm/{constructor.rs, function.rs}` (lengkapi, gantikan dummy Fase 8)
   **Ringkasan**: `get_formatted_results()` sekarang mengembalikan hasil sungguhan (case summary, attribute distribution, evaluation metrics, confusion matrix, trained model) bukan hardcode; `get_all_errors()` mengembalikan error/warning nyata (mis. fold melebihi batas).
   **Verifikasi**: `cargo test` untuk serialisasi (JSON hasil `save.rs` bisa di-deserialize balik tanpa kehilangan field); `wasm-pack build --target web --release` sukses.

---

### Fase 17 — Sambungkan wasm asli ke worker & service (ganti dummy Fase 8)

1. **File**: `frontend/public/workers/Classify/NaiveBayes/pkg/*` (update manual dari build terbaru), `naive-bayes.worker.js` (bump query cache-busting)
   **Ringkasan**: Copy ulang hasil `wasm-pack build` terbaru ke `public/workers/...` (langkah manual, sesuai Keputusan §0.2 — tidak lewat `build-wasm.sh`).
2. **File**: `naive-bayes/services/naive-bayes-analysis-formatter.ts`, `naive-bayes-analysis-output.ts`, `naive-bayes-error-messages.ts` (ubah bila perlu)
   **Ringkasan**: Sesuaikan field mapping formatter dengan bentuk JSON asli dari Rust (kemungkinan ada penyesuaian kecil dari asumsi bentuk stub Fase 7.1); lengkapi `getUserFriendlyNaiveBayesError` dengan pesan-pesan error nyata yang muncul dari Rust (folds melebihi batas, kategori unknown, dll., dalam Bahasa yang ramah pengguna, mengikuti pola string-matching KNN).
   **Verifikasi manual end-to-end (data asli)**: pakai dataset sungguhan yang sudah ada di aplikasi (bukan dummy) → jalankan Naive Bayes dengan kombinasi: (a) mode Exclude + Holdout, (b) mode Candidate Factors & Covariates + K-Fold + seed → hasil di viewer masuk akal (bandingkan kasar dengan hasil model serupa di Python/WEKA/scikit-learn kalau memungkinkan, tidak perlu identik persis tapi harus masuk akal — akurasi wajar, confusion matrix konsisten dengan jumlah kasus).

---

### Fase 18 — Regresi penuh terhadap seluruh aturan `AGENTS.md`

Checklist manual satu-per-satu (tidak perlu file baru, murni verifikasi):

- Mode eksklusif Variables: auto-activate, transisi mengembalikan variabel, validasi tipe drop, variabel `unknown` diblokir — semua re-test dengan data asli.
- Smoothing alpha: batas 0 < alpha ≤ 999, tidak diterapkan ke atribut numerik.
- Validation: stratified split benar secara visual (bandingkan proporsi kelas kasar), holdout vs k-fold benar-benar eksklusif di UI, seed reproducible (jalankan 2x dengan seed sama → hasil confusion matrix identik).
- Output: default semua tercentang, uncheck salah satu → tabel itu hilang dari viewer, Export Model hanya muncul setelah run sukses.
- Persistensi: tutup-buka panel mempertahankan konfigurasi; ubah dataset me-reset semua.
- Sidebar: lebar 40% sama seperti KNN, resizable, mobile jadi dialog.
- Pesan error: matikan network/rusak payload secara sengaja (mis. dataset kosong) → pesan error yang tampil ramah pengguna, bukan stack trace mentah.

---

### Fase 19 — Automated test pass & housekeeping akhir

1. **File**: `naive-bayes/__tests__/*` (lengkapi yang masih kurang dari fase-fase sebelumnya)
   **Ringkasan**: Pastikan ada test untuk: validation rules, variable rules, output rules, formatter, minimal beberapa `cargo test` untuk rumus inti (smoothing, Gaussian+variance floor, metrik).
2. **Verifikasi**:
   - `npm run lint:strict` (frontend) tidak ada warning baru dari folder `naive-bayes`.
   - `npm test` (frontend, jest) hijau untuk seluruh `__tests__` folder `naive-bayes`.
   - `cargo test` (di `naive-bayes/rust`) hijau.
   - `wasm-pack build --target web --release` sukses tanpa warning baru yang mengkhawatirkan.
   - Jalankan skenario end-to-end Fase 17–18 sekali lagi sebagai sanity check final.

---

## Risiko Teknis

- **Ketidakcocokan `VariableListManager` dengan model dua-grup-eksklusif**: komponen ini didesain untuk banyak target list yang aktif bersamaan (seperti KNN: Target, Features, Focal, Case Label semuanya aktif sekaligus). Model Naive Bayes butuh satu grup penuh nonaktif (abu-abu, tidak menerima drop) tergantung mode. Kalau ternyata komponen ini tidak punya prop untuk mematikan sebuah `targetList` sepenuhnya, Fase 1.2 (investigasi) bisa memaksa keputusan berubah ke "custom component" di tengah jalan — ini risiko rework yang sudah diketahui sejak awal (makanya investigasi ditaruh sebagai step eksplisit, bukan diasumsikan lolos).
- **File bersama `frontend/app/dashboard/layout.tsx` (Fase 6)**: ini file global yang mempengaruhi SEMUA modal, bukan hanya folder `naive-bayes`. Kesalahan kecil di sini (salah logika `||`, lupa update `desktopPanelGroupKey`) bisa meregresi perilaku sidebar modal lain (Discriminant, Tree, dll). Wajib regression-check semua modal lain setelah perubahan ini (sudah dimasukkan sebagai verifikasi Fase 6.3).
- **WASM build manual, gampang lupa sinkron**: karena tidak masuk `build-wasm.sh`, ada risiko developer mengubah kode Rust tapi lupa `wasm-pack build` + copy ulang ke `public/workers`, sehingga browser tetap memakai wasm lama (masalah yang sama berpotensi sudah terjadi di NN/Discriminant). Mitigasi: disiplin bump query-string cache-busting setiap kali copy ulang (pola yang sudah dipraktikkan KNN, lihat `?v=knn-focal-positive-20260925`), dan jangan skip Fase 17 verification.
- **Numerical stability Gaussian (variance floor)**: nilai epsilon yang terlalu kecil bisa tetap menyebabkan overflow/underflow saat exponensial di rumus densitas Gaussian untuk atribut dengan variance sangat kecil tapi bukan nol; nilai yang terlalu besar bisa mendistorsi hasil untuk atribut yang memang punya variance kecil secara wajar. Perlu beberapa iterasi tuning + unit test dengan atribut yang variance-nya sengaja dibuat sangat kecil.
- **Rust ownership/borrow checker saat porting Mersenne Twister & partition logic**: menulis ulang (bukan copy-paste identik) berisiko memperkenalkan bug subtle di logika RNG/stratifikasi yang sulit terlihat dari luar (hasil tetap "terlihat masuk akal" tapi distribusinya bias). Mitigasi: unit test statistik sederhana (chi-square goodness-of-fit kasar terhadap distribusi seragam untuk RNG, proporsi kelas untuk split) di Fase 10–11, bukan cuma "tidak crash".
- **Ukuran Attribute Distribution Table untuk atribut kategorik berkardinalitas tinggi**: kalau dataset punya factor dengan puluhan/ratusan kategori unik, tabel WEKA-style ini bisa jadi sangat panjang dan lambat dirender di output viewer. Belum ada keputusan soal pagination/limit — kemungkinan perlu dibahas lagi kalau ditemukan kasus nyata seperti ini.
- **k-fold pada dataset kecil/kelas minoritas sangat kecil**: peringatan sudah direncanakan (§5.5, Fase 11), tapi definisi pasti "peringatan vs blokir keras" masih longgar di `AGENTS.md" ("tampilkan peringatan... tetap harus ada validasi yang menahan submit bila nilai jelas tidak mungkin dieksekusi") — perlu keputusan implementasi konkret saat Fase 11 dikerjakan (mis. `folds > n_instance` = blokir keras, `folds > n_kelas_terkecil` tapi masih ≤ `n_instance` = peringatan tapi boleh lanjut).
- **Minimnya konvensi test Rust di repo ini**: karena modul lain praktis tidak punya test Rust nyata, tidak ada "contoh yang bisa ditiru" untuk struktur `cargo test` yang baik di codebase ini — harus dirintis dari nol untuk modul Naive Bayes, sedikit effort ekstra di luar pola copy-paste biasa.
- **Scope creep**: karena Naive Bayes mirip banget dengan alur KNN yang sudah py fitur "Save predicted value/probability ke data viewer" dan "predict data baru", ada risiko implisit tergoda menambahkan fitur itu "sekalian karena polanya sudah ada". `AGENTS.md` §1 & §7 sudah eksplisit melarang ini — perlu kedisiplinan saat implementasi, terutama oleh siapa pun yang terbiasa dengan pola KNN.
- **Payload besar lewat `postMessage` ke Worker**: untuk dataset besar, mengirim seluruh data target+predictor via `postMessage` (pola yang sama dipakai KNN) bisa lambat/memory-heavy. Ini risiko yang sudah ada di pola existing (bukan spesifik Naive Bayes), tapi layak dipantau saat uji dengan dataset besar di Fase 17–18.
