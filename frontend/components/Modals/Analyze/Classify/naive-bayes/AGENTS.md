# AGENTS.md — Menu Analyze → Classify → Naive Bayes

Dokumen ini adalah kontrak kerja untuk siapa pun (manusia atau agent) yang mengimplementasikan menu **Naive Bayes** di `frontend/components/Modals/Analyze/Classify/naive-bayes`. Dokumen ini mengikat: bila ada bagian kode yang menyimpang dari sini tanpa alasan yang didiskusikan ulang, anggap itu bug desain, bukan variasi yang sah.

Dokumen ini murni desain & kontrak. **Tidak ada kode implementasi di sini.** Rencana implementasi langkah-demi-langkah ada di `PLAN.md` (folder yang sama).

> **Revisi Apply Model (2026-10-02, disetujui pemilik produk, sekali saja).** Dokumen ini disinkronkan dengan kode yang sudah berjalan dan dengan desain menu baru **Apply Model** (`../apply-model/AGENTS.md`). Perubahan: §1 (cakupan prediksi dipindah ke Apply Model), §3.3 (tidak ada tampilan abu-abu — keputusan pemilik produk saat Fase 18), §3.3/§4.1/§4.2 (nama field sesuai kode), §4.6 (lokasi konfigurasi lebar sidebar), §5.10 (schema export `1.1`), §6 (titik integrasi yang sudah ada di kode), §7 (pengecualian untuk Fase 0 Apply Model). Di luar penanda "Revisi Apply Model", isi dokumen tidak diubah.

---

## 1. Tujuan & Cakupan

Naive Bayes ditambahkan sebagai item baru pada **Analyze → Classify**, sejajar dengan Nearest Neighbor, Tree, Discriminant, dll. Tujuannya: menyediakan alur SPSS-style untuk melatih dan mengevaluasi satu model Naive Bayes campuran (mendukung atribut numerik sekaligus kategorik dalam satu model, target multiclass) langsung dari dataset yang sedang dibuka di aplikasi.

Cakupan yang **termasuk**:

- Pemilihan variabel target dan predictor (dua mode: Exclude / Candidate Factors & Covariates).
- Pengaturan Laplace smoothing alpha.
- Pengaturan strategi validasi: training/holdout split (stratified) atau k-fold cross-validation (saling eksklusif), plus seed Mersenne Twister.
- Output: Case Processing Summary, Attribute Distribution Table (gaya WEKA), Model Evaluation Metrics, Confusion Matrix.
- Export model terlatih sebagai file JSON, sebagai aksi di output viewer (bukan checkbox di form).

Cakupan yang **tidak termasuk** (di luar scope menu ini, jangan ditambahkan tanpa diskusi ulang):

- Import model dan prediksi ke dataset baru/lain. Menu ini hanya melatih dan mengevaluasi. *(Revisi Apply Model: kebutuhan ini sekarang ditangani menu terpisah **Analyze → Classify → Apply Model**, `../apply-model/`, yang membaca file/hasil Export Model dari menu ini. Menu Naive Bayes sendiri tetap tidak melakukan prediksi data baru.)*
- Tab "Save" ala Nearest Neighbor yang menulis kolom hasil (predicted value/probability) kembali ke data viewer. Tidak ada permintaan seperti itu di spesifikasi ini.
- Varian algoritma terpisah per tipe atribut (murni Gaussian NB atau murni Categorical/Multinomial NB) — yang dibangun adalah **satu model campuran**.

---

## 2. Referensi Pola: `nearest-neighbor`

Struktur direktori, gaya komponen, dan mekanisme sidebar-kanan **wajib** mengikuti pola yang sudah ada di `frontend/components/Modals/Analyze/Classify/nearest-neighbor`. Berikut pemetaan konkret file-per-file yang sudah diverifikasi dari kode nearest-neighbor (KNN) — pakai sebagai referensi tiru, bukan sebagai sumber untuk disalin isinya:

| Peran | File referensi KNN | Catatan pola yang harus ditiru |
|---|---|---|
| Container utama (tabs, state, tombol OK/Reset/Cancel, load/save persist) | `dialogs/nearest-neighbor-main.tsx` (`KNNContainer`) | `useState` untuk `formData` per-section, `activeTab`, `resetKey`, `helperMode`; load/save/clear via `useIndexedDB` (`getFormData`/`saveFormData`/`clearFormData`) dengan key string unik per menu; `Tabs`/`TabsList`/`TabsContent` dari `@/components/ui/tabs`; footer sticky (`bg-secondary`, `border-t`) berisi toggle bantuan (ikon `CircleHelp`) di kiri, tombol **OK / Reset / Cancel** di kanan; validasi tab-switch (`onValueChange` menolak pindah tab jika ada error) dan validasi sebelum submit (disable tombol OK via `validation.isValid`, plus pengecekan tambahan saat klik OK). |
| Tab Variables (drag-and-drop dua panel) | `dialogs/dialog.tsx` (`KNNDialog`) | Pakai komponen bersama `VariableListManager` (`@/components/Common/VariableListManager`) dengan `availableVariables`, `targetLists` (array `TargetListConfig`: `id`, `title`, `variables`, `maxItems`, `height`, `allowedTypes` opsional), `highlightedVariable`/`setHighlightedVariable`, `onMoveVariable`, `onReorderVariable`, `showArrowButtons`. Helper icon opsional per field via komponen `HelperIcon` (`./helper-icon`), tampil hanya jika `showFieldHelp` true. Error list ditampilkan di bawah panel dengan ikon `AlertCircle`. |
| Tab dengan grup radio + input numerik saling bergantung | `dialogs/neighbors.tsx` (`KNNNeighbors`) | Section per blok (`<section className="border-b">`), `RadioGroup`/`RadioGroupItem`, `Input type="number"` dengan `disabled` mengikuti mode aktif, sinkronisasi via `useEffect` untuk membersihkan field yang tidak relevan saat mode berubah. |
| Tab dengan panel kiri (daftar variabel/drag source) + panel kanan (pengaturan bersection, radio group, seed) | `dialogs/partition.tsx` (`KNNPartition`) | `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` untuk split kiri-kanan yang bisa di-resize; pola drag `Badge` (`draggable`, `onDragStart`) dari panel kiri, `onDrop`/`onDragOver` di target; grup "Set Seed" (`Checkbox` + `Input type="number" min={0} max={4294967295}`) dengan disabled saat mode tertentu; logika aturan dipisah ke file hook murni (`hooks/useNearestNeighborPartitionRules.ts`) berisi fungsi-fungsi kecil (`isXxxEnabled`, `enforceXxxRules`, `applyXxxDefaults`) yang dipakai lewat `useEffect` di komponen. |
| Tab Output (checklist) | `dialogs/output.tsx` (`KNNOutput`) | Daftar `viewerOutputOptions` (array of `{field, label, help}`), setiap opsi dirender sebagai `Checkbox` + `label` + komponen bantuan (`FieldHelp`). Nilai checkbox dinormalisasi lewat helper (`normalizeOutputCheckboxValue` di `hooks/useNearestNeighborOutputRules.ts`) supaya state `"indeterminate"`/`undefined` selalu jadi `false`. |
| Validasi form terpusat | `hooks/useNearestNeighborValidation.ts` | Hook `useXxxValidation(formData)` mengembalikan `{ validation: {isValid, errors}, validateXxx(): string | null, ... }`; validasi numerik dikumpulkan di satu fungsi (`getNumericInputError`). Batas seed konstan diberi komentar penjelas (`MAX_SEED = 4294967295`, mengikuti batas u32 Rust). |
| Konstanta default per tab | `constants/nearest-neighbor-default.ts` | Satu objek default per tab (`KNNMainDefault`, `KNNNeighborsDefault`, dst.) digabung jadi satu `KNNDefault`. |
| Tipe data per tab + props komponen | `types/nearest-neighbor.ts` | Satu `type` untuk data tab (`KNNMainType`, dst.), satu `type Props` bersebelahan (berisi `data`, `updateFormData`, dan flag kontekstual seperti `hasTarget`), lalu digabung jadi `type KNNType` untuk seluruh form dan `KNNContainerProps` untuk container. |
| Orkestrasi analisis (payload → worker → hasil) | `services/nearest-neighbor-analysis.ts` | Fungsi `analyzeXxx({configData, dataVariables, variables})`: slice data & definisi variabel yang relevan (`getSlicedData`, `getVarDefs`), spawn `Worker` (module worker di `/workers/Classify/<Nama>/...worker.js`), `postMessage` payload, `onmessage`/`onerror` menangani hasil, format hasil lewat formatter khusus, kirim ke output viewer, lalu (jika relevan) simpan variabel hasil ke data viewer. Dibungkus `toast.promise` di container saat dipanggil. |
| Pesan error ramah pengguna | `services/nearest-neighbor-error-messages.ts` | Fungsi `getUserFriendlyXxxError(error)` mem-parsing pesan error mentah dari engine (match substring lowercase) dan mengembalikan kalimat yang dipahami pengguna awam; dipakai sebagai `error` callback `toast.promise`. |
| Engine statistik | `rust/` (Cargo.toml, `src/models`, `src/stats`, `src/utils`, `src/wasm`, dikompilasi ke `rust/pkg/` via wasm-pack) | Semua komputasi berat (bukan sekadar validasi ringan) wajib di Rust/WASM, bukan di worker TypeScript murni. Pemisahan tanggung jawab: `models/` untuk struct konfigurasi/input/hasil, `stats/` untuk algoritma & utilitas statistik (termasuk RNG Mersenne Twister di `stats/mersenne_twister.rs`, partisi data di `stats/partition.rs`, tabel klasifikasi/metrik di `stats/classification_table.rs`, serialisasi model di `stats/save.rs`), `wasm/` untuk binding yang diekspos ke JS (constructor + fungsi jalankan analisis), `utils/` untuk konversi tipe & error umum. |
| Registrasi menu & container | `../classify-menu.tsx`, `../ClassifyRegistry.tsx` | `classify-menu.tsx`: tambah `MenubarItem` baru memanggil `openModal(ModalType.ModalNaiveBayes)`. `ClassifyRegistry.tsx`: tambah `lazy(() => import(".../naive-bayes/dialogs/naive-bayes-main").then(m => ({default: m.NaiveBayesContainer})))`, daftarkan di `CLASSIFY_MODAL_COMPONENTS` dan set `CLASSIFY_MODAL_CONTAINER_PREFERENCES[ModalType.ModalNaiveBayes] = "sidebar"` (bukan `"dialog"`) — ini yang membuat panel muncul di sidebar kanan, bukan pop-up. |
| Tipe modal | `frontend/types/modalTypes.ts` (`ModalType` enum) | Tambahkan entri baru mengikuti konvensi penamaan yang sudah ada (`Modal<Nama>`, mis. `ModalNaiveBayes`), sejajar dengan `ModalNearestNeighbor`, `ModalTree`, dst. |

Catatan penting: berkas-berkas yang disebut sebagai referensi **tidak boleh diubah**. Lihat bagian 7 (Larangan).

---

## 3. Kontrak Data

### 3.1 Sumber dataset & metadata variabel

Dataset dan daftar variabel dibaca dari store aplikasi yang sama dengan modul Classify lain (`useVariableStore` untuk metadata variabel, `useDataStore`/`getSlicedData` untuk nilai data — pola identik dengan `nearest-neighbor-analysis.ts`). Setiap variabel mengikuti tipe `Variable` (`frontend/types/Variable.ts`):

- `type: VariableType` — tipe penyimpanan (`NUMERIC`, `STRING`, `DATE`, dst).
- `measure: VariableMeasure` — salah satu dari `"scale" | "ordinal" | "nominal" | "unknown"`. **Ini adalah dasar tunggal** untuk menentukan apakah sebuah variabel diperlakukan sebagai *categorical factor* atau *numerical covariate* (lihat 3.3).

### 3.2 Definisi peran variabel

- **Target / Label** (`TargetVar`): tepat satu variabel, wajib nominal/kategorik (ordinal diperlakukan sama seperti nominal — sebagai kategori biasa, tanpa urutan diistimewakan). Multiclass didukung secara native.
- **Predictor efektif**: kumpulan variabel yang dipakai untuk melatih model, dihitung dari mode aktif (lihat 3.3) — bukan field yang disimpan langsung, melainkan turunan dari `TargetVar` + `SpecificationMode` + isi mode aktif.
- **Candidate Factors / Categorical Features**: subset predictor dengan `measure` `nominal` atau `ordinal`.
- **Candidate Covariates / Numerical Features**: subset predictor dengan `measure` `scale`.
- Variabel dengan `measure === "unknown"` **tidak boleh** dipilih ke area manapun (target, exclude, factors, covariates). Begitu pengguna mencoba menempatkannya, tampilkan error yang mengarahkan pengguna memperbaiki measurement level variabel tersebut terlebih dulu (lewat Variable View/definisi variabel), bukan diam-diam mengasumsikan tipe.
- Sebuah variabel hanya boleh menempati **satu** peran pada satu waktu: tidak boleh dipakai sebagai target sekaligus predictor, atau muncul di lebih dari satu daftar (Exclude vs Factors vs Covariates) secara bersamaan. Begitu dipindah ke satu area, ia hilang dari daftar variabel yang tersedia dan dari area lain.
- Tidak ada deteksi otomatis kolom ID. Jika pengguna ingin mengecualikan kolom ID, ia harus memasukkannya secara eksplisit ke **Variables to Exclude**.

### 3.3 Variable Specification Method — dua mode eksklusif

Ada tepat dua mode, saling eksklusif, disimpan sebagai satu field diskriminator, misalnya `SpecificationMode: "exclude" | "candidates"`:

- **Mode `exclude`** — daftar `ExcludedVariables: string[]`. Predictor efektif = *semua kolom eligible* (bukan target, bukan `unknown`) **dikurangi** target dan isi `ExcludedVariables`. Tipe tiap predictor (factor vs covariate) ditentukan otomatis dari `measure` (nominal/ordinal → factor, scale → covariate).
- **Mode `candidates`** — dua daftar terpisah: `CandidateFactors: string[]` (harus `nominal`/`ordinal`) dan `CandidateCovariates: string[]` (harus `scale`). Predictor efektif = gabungan isi kedua daftar ini saja (bukan "semua kecuali").

Aturan transisi mode (gabungan dari beberapa keputusan yang sudah dikonfirmasi — baca sebagai satu paket, bukan terpisah):

1. **Kondisi awal**: saat panel pertama dibuka (state default, belum ada interaksi), mode aktif adalah **`exclude`** dengan `ExcludedVariables` kosong. Blok "Candidate Factors & Covariates" tampil abu-abu (disabled) sejak awal.
2. **Auto-activate**: begitu pengguna memasukkan variabel pertama ke salah satu blok yang saat itu tidak aktif, mode otomatis berpindah ke blok tersebut. Tidak ada radio button eksplisit "pilih mode" — mode murni ditentukan oleh ke mana pengguna meletakkan variabel pertama.
3. **Saat berpindah mode**: seluruh isi mode sebelumnya dikosongkan, dan variabel-variabel yang sempat dimasukkan di mode sebelumnya **dikembalikan** ke daftar variabel tersedia (panel kiri) — bukan dihapus permanen dari dataset, bukan pula dipindah otomatis ke mode baru.
4. **Mode non-aktif tampil abu-abu** (visually disabled, tidak menerima drop, tidak menerima klik) — bukan disembunyikan.

*(Revisi Apply Model — sinkron dengan keputusan pemilik produk saat Fase 18, lihat komentar kepala `components/variables-tab.tsx`):* poin 1 dan 4 **tidak berlaku lagi**. Tidak ada tampilan abu-abu: kedua blok (Exclude dan Candidate Factors/Covariates) **selalu** menerima drop. Saling eksklusif dicapai dengan aturan poin 3 — drop ke satu blok mengosongkan blok lain dan mengembalikan isinya ke daftar tersedia. Peringatan eksplisit pada poin 5 tidak muncul (drop yang tidak cocok ditolak senyap oleh `VariableListManager`, keterbatasan yang diwarisi).
5. **Validasi tipe tetap berlaku di mode `candidates`**: menempatkan variabel `scale` ke Candidate Factors, atau variabel `nominal`/`ordinal` ke Candidate Covariates, **ditolak** (drop dibatalkan) dan memunculkan peringatan tentang ketidakcocokan measurement level. Ini menegaskan bahwa "penentuan manual" pada mode `candidates` adalah kebebasan memilih *variabel mana saja* yang dijadikan predictor dan ke kelompok mana ia terdaftar untuk keperluan tampilan/organisasi, **bukan** kebebasan mengubah cara model memperlakukan tipe statistik variabel tersebut (tipe statistik tetap murni dari `measure`).

### 3.4 Sorting & Select All (panel kiri, presentasional)

- `SortBy: "name" | "measure"`, `SortDirection: "asc" | "desc"` — state ini lokal/presentasional pada `DatasetVariableList`, tidak perlu ikut disimpan sebagai bagian dari payload analisis maupun dipersist ke IndexedDB.
- **Select All / Select All Nominal Fields / Select All Continuous Fields**: hanya melakukan seleksi/highlight multi-item di panel kiri (state highlight, bukan memindahkan variabel ke area manapun). Pengguna tetap bisa menambah/mengurangi seleksi manual dengan menahan Shift untuk range-select, mengikuti interaksi highlight yang sudah ada di `VariableListManager` (`highlightedVariable`/`setHighlightedVariable`), diperluas untuk multi-select.

### 3.5 Bentuk payload ke engine (ringkasan kontrak, bukan skema final byte-per-byte)

Payload yang dikirim ke worker/WASM minimal memuat: data & definisi variabel target, data & definisi predictor (dengan penanda per-atribut apakah ia factor atau covariate — turunan dari `measure`, bukan disimpan ulang secara manual), `SmoothingAlpha`, konfigurasi validasi (`ValidationMethod`, parameter partition/fold, seed), dan daftar output yang diminta. Pola pengambilan-slice data dan definisi variabel mengikuti `getSlicedData`/`getVarDefs` seperti pada `nearest-neighbor-analysis.ts`.

*(Revisi Apply Model — sinkron dengan kode, `types/naive-bayes.ts`):* nama field yang berlaku adalah `TargetVar`, `SpecificationMode`, `ExcludedVar` (bukan `ExcludedVariables`), `CandidateFactors`, `CandidateCovariates`; ketiga daftar bertipe `string[] | null`. Predictor efektif dihitung satu-satunya oleh `getEffectivePredictors` (`hooks/useNaiveBayesValidation.ts`). Label kategori/kelas dibentuk di Rust oleh `data_value_to_label` (`rust/src/stats/preprocess_data.rs`): teks di-trim, angka bulat ditulis tanpa desimal (`1.0` → `"1"`); fungsi ini juga disalin oleh Apply Model dan **tidak boleh** diubah tanpa merevisi `../apply-model/AGENTS.md` §5.3.

---

## 4. Aturan Perilaku UI

### 4.1 Tab Options

- `SmoothingAlpha: number`, default **1**.
- Validasi: harus **`> 0`** (nilai `0` ditolak karena bisa menyebabkan error/undefined behavior pada perhitungan probabilitas kategorik), boleh desimal, batas maksimum **999**. Tampilkan pesan validasi inline jika di luar rentang, mengikuti pola pesan error numerik di `useNearestNeighborValidation.ts`.
- *(Revisi Apply Model — sinkron dengan kode):* `NaiveBayesOptionsType` juga berisi `MissingValuePolicy` (`"exclude"`), `UnseenCategoryPolicy` (`"smoothing"`), dan `VarianceFloor` (`1e-9`). Ketiganya **internal** (tidak tampil di UI, tidak dapat diubah pengguna) dan dikirim apa adanya ke Rust; `VarianceFloor` inilah nilai variance floor §5.3.

### 4.2 Tab Validation

- **Strategi validasi bersifat saling eksklusif**: *Training and Holdout Partition* vs *Cross-Validation Folds*. Representasikan sebagai satu pilihan mode (mis. `ValidationMethod: "holdout" | "kfold"`), bukan dua blok independen yang bisa aktif bersamaan — field/section milik mode yang tidak dipilih tampil abu-abu (disabled), mengikuti gaya visual section di `partition.tsx`.
- **Training/Holdout**: pengguna hanya mengisi `TrainingPercentage` (default **70**, rentang 1–99); `HoldoutPercentage` dihitung otomatis (`100 - TrainingPercentage`) dan ditampilkan sebagai field read-only (pola identik dengan input "Holdout %" & "Total %" yang disabled di `partition.tsx`). Total harus selalu tepat 100 by construction. Pembagian **wajib stratified** berdasarkan distribusi kelas target.
- **Cross-Validation Folds**: `Folds: number`, default **10**, minimum **1**. Maksimum tidak dipatok angka tetap — dibatasi oleh `min(jumlah instance, jumlah anggota kelas terkecil)`; jika pengguna memasukkan nilai yang melebihi batas ini, tampilkan **peringatan** (bukan blokir keras jika sistem masih bisa menjalankan dengan penyesuaian, tapi tetap harus ada validasi yang menahan submit bila nilai jelas tidak mungkin dieksekusi, misalnya folds > jumlah instance).
- **Set Seed for Mersenne Twister**: `Checkbox SetSeed` + `Input Seed` (integer). Ikuti rentang standar yang sudah dipakai KNN: `0` sampai `4294967295` (batas `u32` di sisi Rust). Field `Seed` disabled jika `SetSeed` tidak dicentang. Seed ini dipakai untuk **semua** operasi acak pada run tersebut: pembagian stratified training/holdout, maupun pengacakan/assignment k-fold.
- *(Revisi Apply Model — sinkron dengan kode, `types/naive-bayes.ts`):* field yang berlaku adalah `ValidationMethod`, `TrainingPercentage`, `KFolds` (bukan `Folds`), dan `RandomSeed: number | null`. Tidak ada field `SetSeed`/`Seed` terpisah: checkbox "Use random seed" di UI hanya mengatur apakah `RandomSeed` bernilai angka atau `null`.

### 4.3 Tab Output

- Checkbox: **Case Processing Summary**, **Attribute Distribution Table**, **Model Evaluation Metrics**, **Confusion Matrix** — keempatnya **default tercentang** saat pertama kali dibuka (beda dengan KNN yang sebagian defaultnya `false`).
- **Export Model bukan checkbox** dan bukan bagian dari tab ini secara struktural. Tombolnya hanya muncul di **output viewer**, setelah model berhasil dilatih (setelah run sukses) — bukan disabled-tapi-terlihat di tab Output sebelum run. Saat diklik, sediakan input nama file (default **`Naive_Bayes_Model_Export.json`**) yang bisa diubah pengguna sebelum file JSON diunduh.
- Normalisasi state checkbox indeterminate/undefined menjadi `false`, mengikuti pola `normalizeOutputCheckboxValue`.

### 4.4 Validasi tombol OK & pesan error

- Tombol **OK** disabled selama `TargetVar` belum diisi atau predictor efektif kosong (baik lewat mode `exclude` yang menyisakan 0 kandidat, maupun mode `candidates` yang kosong keduanya).
- Validasi numerik (`SmoothingAlpha`, `TrainingPercentage`, `Folds`, `Seed`) dikumpulkan di satu fungsi validasi terpusat, mengikuti pola `getNumericInputError` di KNN — dipanggil baik saat pindah tab maupun sebelum eksekusi.
- Pesan error mentah dari engine (Rust/WASM) diterjemahkan ke pesan ramah pengguna lewat modul error-messages khusus Naive Bayes (lihat 6), dipakai sebagai `error` callback pada `toast.promise` saat menjalankan analisis — pola identik `getUserFriendlyKNNError`.

### 4.5 Persistensi & reset

- **Persistensi antar buka-tutup panel**: konfigurasi terakhir (seluruh isi form: Variables, Options, Validation, Output) dipertahankan via `useIndexedDB` (`getFormData`/`saveFormData`/`clearFormData`) dengan key unik (mis. `"NaiveBayes"`), mengikuti pola persis `KNNContainer`.
- **Saat dataset berubah** (variabel ditambah/dihapus/berubah di tempat lain pada aplikasi): seluruh pilihan pada form Naive Bayes **direset ke default**, bukan hanya membersihkan referensi variabel yang hilang.
- **Tombol Reset** mengembalikan seluruh form ke default dan menghapus data tersimpan (pola `resetFormData` di KNN: reset state, reset `activeTab` ke tab pertama, `clearFormData`, toast konfirmasi).

### 4.6 Sidebar

- Panel muncul di **sidebar kanan**, bukan pop-up/dialog tengah — dicapai lewat `CLASSIFY_MODAL_CONTAINER_PREFERENCES` seperti dijelaskan di bagian 2.
- Lebar sidebar dan perilaku pada layar kecil/mobile **mengikuti konfigurasi khusus yang sama dengan Nearest Neighbor** (bukan lebar default generik), termasuk kemampuan resize. Implementer wajib menelusuri di mana `ModalNearestNeighbor` diberi ukuran sidebar khusus (di luar folder `nearest-neighbor`, kemungkinan pada layer layout/renderer sidebar global) dan menambahkan `ModalNaiveBayes` di tempat yang sama dengan nilai yang identik — jangan membuat jalur konfigurasi baru yang terpisah.
- *(Revisi Apply Model — lokasi sudah ditemukan):* `frontend/app/dashboard/layout.tsx` (`KNN_SIDEBAR_WIDTH = 40`, kondisi `isKNNModalOpen` yang mencakup `ModalNearestNeighbor` dan `ModalNaiveBayes`). Menu Apply Model menambahkan `ModalApplyModel` ke kondisi yang sama.

---

## 5. Definisi Perhitungan Statistik (harus konsisten)

Bagian ini adalah kontrak angka/istilah — implementasi Rust wajib patuh persis pada definisi berikut, supaya UI, dokumentasi, dan hasil ekspor JSON tidak saling bertentangan.

### 5.1 Model

- Satu model campuran: atribut `scale` dimodelkan sebagai **Gaussian Naive Bayes** (mean & variance per kelas), atribut `nominal`/`ordinal` dimodelkan sebagai **Categorical Naive Bayes** (frekuensi per kategori per kelas). Prediksi akhir menggabungkan log-likelihood dari kedua jenis atribut plus log class prior.
- Target selalu diperlakukan sebagai kategori nominal biasa (tidak ada penanganan ordinal-aware untuk target), multiclass didukung penuh.

### 5.2 Smoothing Alpha (Laplace)

- **Hanya berlaku untuk atribut kategorik** (Categorical NB): dipakai pada estimasi probabilitas frekuensi kategori per kelas untuk mengatasi frekuensi nol, dengan bentuk standar `(count + alpha) / (class_total + alpha * jumlah_kategori)`.
- **Tidak diterapkan pada atribut numerik** (Gaussian NB) — atribut numerik memakai distribusi Gaussian murni (mean, variance) tanpa smoothing alpha.
- Rentang: `alpha > 0`, boleh desimal, maksimum `999`.

### 5.3 Variance floor / epsilon (Gaussian)

- Untuk mencegah kegagalan numerik (div-by-zero atau `log(0)`) ketika variance suatu atribut numerik di suatu kelas bernilai nol (misal semua nilai identik dalam kelas tersebut), terapkan **variance floor** tetap (epsilon kecil) yang ditambahkan/dipakai sebagai batas bawah variance sebelum dipakai di rumus densitas Gaussian. Nilai epsilon harus konstan dan terdokumentasi di kode engine (bukan berubah-ubah per dataset).

### 5.4 Missing value

- **Target missing**: baris dibuang sepenuhnya (listwise deletion) — tidak ikut training maupun evaluasi.
- **Predictor kategorik missing**: nilai missing diperlakukan sebagai kategori tersendiri (mis. `"(Missing)"`) yang tetap dihitung dalam distribusi frekuensi (dan ikut kena smoothing), sehingga baris tidak perlu dibuang hanya karena satu predictor kategorik kosong.
- **Predictor numerik missing**: nilai tersebut dikecualikan hanya dari perhitungan mean/variance atribut itu untuk kelas terkait (exclusion per-atribut), bukan membuang seluruh baris.
- **Case Processing Summary** melaporkan: jumlah instance total, jumlah valid, jumlah/rincian yang terpengaruh missing value (setidaknya jumlah baris yang dibuang karena target missing), variabel target, daftar variabel atribut, dan skenario pengujian yang dipakai (holdout split atau k-fold, beserta parameternya).

### 5.5 Partition & Cross-Validation

- Training/Holdout split **wajib stratified** terhadap distribusi kelas target.
- K-fold **wajib stratified** juga (praktik umum — mempertahankan proporsi kelas di tiap fold) kecuali dengan alasan kuat untuk tidak; default fold = 10, minimum 1, maksimum dibatasi `min(n_instance, n_anggota_kelas_terkecil)` dengan peringatan bila dilampaui.
- **Model akhir yang diekspor/dilaporkan strukturnya (Attribute Distribution Table) selalu dilatih ulang pada SELURUH dataset** setelah proses validasi (holdout atau k-fold) selesai dipakai murni untuk mengukur performa (Model Evaluation Metrics, Confusion Matrix). Artinya: metrik evaluasi berasal dari prediksi holdout/prediksi gabungan k-fold, sedangkan Attribute Distribution Table dan model yang diekspor berasal dari model final yang dilatih ulang di seluruh data — **bukan** dari satu fold tertentu atau agregasi lintas-fold.
- Seed Mersenne Twister, jika diaktifkan, dipakai konsisten untuk **seluruh** operasi acak run tersebut (shuffling sebelum stratified split, assignment fold pada k-fold).

### 5.6 Model Evaluation Metrics

- Per kelas: Accuracy (dalam konteks one-vs-rest jika relevan), Precision, Recall, F1-Score.
- Agregat wajib ditampilkan selain angka per kelas: **macro average**, **weighted average**, **micro average**, dan **overall accuracy**.
- **Cohen's Kappa ditampilkan hanya sebagai satu angka overall**, bukan per kelas (mengoreksi ambiguitas pada draft spesifikasi awal — Kappa secara definisi adalah metrik keseluruhan).

### 5.7 Confusion Matrix

- Baris = actual (kelas sebenarnya), kolom = predicted (kelas prediksi) — konvensi standar.
- Tampilkan **count**, **total** (per baris/kolom dan grand total), dan **persentase**.

### 5.8 Attribute Distribution Table (gaya WEKA)

- Baris = tiap atribut; untuk atribut **kategorik**, setiap kategori menjadi sub-baris tersendiri, dengan kolom per kelas target menampilkan: **raw count**, **smoothed count** (`count + alpha`), **probability** (`smoothed_count / (class_total + alpha * jumlah_kategori)`), dan **total**.
- Untuk atribut **numerik**: tampilkan **mean** dan **std dev** per kelas. **Weighted sum dihapus dari scope** (tidak ditampilkan), karena aplikasi ini tidak memakai case weights.

### 5.9 Kategori tak dikenal (unseen category)

- Karena scope menu ini hanya melatih & mengevaluasi (tidak ada prediksi data baru terpisah), isu ini relevan saat evaluasi holdout/k-fold: jika suatu kategori pada fold/holdout tidak pernah muncul di data training pada split tersebut, perlakukan sebagai count nol yang tetap mendapat probabilitas kecil melalui smoothing (`alpha / (class_total + alpha * jumlah_kategori)`), **bukan** menyebabkan error atau prediksi gagal.

### 5.10 Export Model (JSON)

- Nama file default: **`Naive_Bayes_Model_Export.json`**, dapat diubah pengguna melalui input nama file di output viewer sebelum unduh.
- Isi minimal skema JSON yang direkomendasikan (versi awal, boleh disempurnakan saat implementasi tapi field inti berikut wajib ada dan namanya dijaga stabil karena ini adalah kontrak file yang mungkin dipakai ulang/diarsipkan pengguna):
  - `schema_version`
  - `model_type` (mis. `"naive_bayes"`)
  - `trained_at` (timestamp)
  - `target`: nama variabel target, daftar kelas (`classes`), dan `class_priors` per kelas.
  - `features`: daftar atribut dengan `name`, `role` (`"categorical" | "numerical"`), dan parameter distribusinya (untuk categorical: distribusi kategori per kelas termasuk hasil smoothing; untuk numerical: mean & variance per kelas).
  - `smoothing_alpha` dan `variance_floor`/`epsilon` yang dipakai saat training.
  - `feature_order` (urutan fitur yang dipakai model, untuk konsistensi bila model dipakai ulang).
  - `label_mapping` bila kelas target di-encode secara internal.
  - `validation_config`: metode (`holdout`/`kfold`), parameter (persentase atau jumlah fold), dan seed yang dipakai.
  - `missing_value_policy`, `unseen_category_policy` (deskripsi singkat kebijakan di 5.4 dan 5.9, ditulis sebagai metadata supaya file self-describing).
- *(Revisi Apply Model — skema final & versi 1.1).* Skema yang berlaku persis struct `ExportedModel` di `rust/src/stats/save.rs`: `target.classes` terurut alfabetis (byte-wise) dan `target.class_priors` sejajar index dengannya; fitur categorical berbentuk `{name, role, categories[], distribution{class: prob[] sejajar categories}}`; fitur numerical `{name, role, mean{class}, variance{class}}` dengan variance yang **sudah** melewati variance floor. Mulai **`schema_version: "1.1"`** (dikerjakan di `../apply-model/PLAN.md` Fase 0) ditambahkan:
  - `target.class_counts: number[]` — jumlah baris per kelas pada data training model final, sejajar `classes`;
  - `class_totals: {class: number}` pada setiap fitur categorical — `class_total` yang dipakai rumus smoothing §5.2 (= jumlah `raw_count` kelas itu).
  Kedua field ini wajib supaya Apply Model bisa menghitung probabilitas kategori tak dikenal persis seperti §5.9. Field lama tidak berubah nama/arti; file `1.0` tetap dianggap valid oleh Apply Model (dengan peringatan). Nama field skema ini sekarang juga dikunci oleh `../apply-model/AGENTS.md` §3.1 — perubahan apa pun wajib merevisi kedua dokumen.
- **Nilai/label kategori asli dari dataset boleh ikut tersimpan** di dalam JSON model (by design — sudah dikonfirmasi pemilik produk). Ini dicatat di sini secara eksplisit supaya tidak ada yang "memperbaiki" ini di kemudian hari dengan menghapus label tanpa didiskusikan ulang; namun karena berarti file ekspor bisa memuat data yang berpotensi sensitif, developer disarankan tetap mendokumentasikan hal ini secara terlihat oleh pengguna (misal keterangan singkat di UI Export) — bukan berarti fungsionalitasnya dibatasi.

---

## 6. Struktur File & Tanggung Jawab

Struktur berikut sudah disepakati sebagai kerangka folder di dalam `frontend/components/Modals/Analyze/Classify/naive-bayes/`. Penamaan file internal bebas mengikuti konvensi kebab-case yang dipakai `nearest-neighbor`, selama tanggung jawab tiap bagian berikut dipenuhi.

- **`dialogs/`** — komponen tab & container, setara `dialogs/` milik KNN.
  - Container utama (setara `nearest-neighbor-main.tsx`): mengelola `activeTab`, `formData` gabungan seluruh tab, `resetKey`, `helperMode`, load/save/clear via IndexedDB, validasi sebelum pindah tab & sebelum submit, tombol OK/Reset/Cancel, memanggil service analisis.
  - Tab **Variables** (setara `dialog.tsx`): panel kiri daftar variabel dataset (sort + select all) dan panel kanan (Target, Variable Specification Method dengan dua mode eksklusif) sesuai kontrak bagian 3.
  - Tab **Options**: input `SmoothingAlpha` beserta pesan validasi.
  - Tab **Validation**: pemilihan strategi (holdout vs k-fold, saling eksklusif), input persentase training, input jumlah fold, checkbox+input seed.
  - Tab **Output**: checklist empat output (Case Processing Summary, Attribute Distribution Table, Model Evaluation Metrics, Confusion Matrix).
  - Helper kecil yang dipakai lintas tab (ikon bantuan field, dsb.) — boleh reuse pola `helper-icon.tsx`/`field-help.tsx` bila cocok, atau versi lokal yang setara.

- **`components/`** — komponen presentasional yang dipakai lintas tab, minimal:
  - Daftar variabel dataset dengan sort & select-all (dipakai di tab Variables).
  - Drop-zone/drag target untuk variabel (Target, Excluded, Candidate Factors, Candidate Covariates) — boleh reuse `VariableListManager` bila cukup fleksibel untuk dua mode eksklusif; bila tidak cukup, buat wrapper tipis di sini, jangan modifikasi `VariableListManager` global demi kebutuhan spesifik Naive Bayes.
  - Komponen aksi **Export Model** (tombol + input nama file) yang dipasang di output viewer setelah run sukses.

- **`constants/`** — nilai default per tab, digabung jadi satu objek default keseluruhan, setara `nearest-neighbor-default.ts`.

- **`dialogs/` types berpasangan dengan `types/`** — `types/` berisi tipe data per tab + tipe props komponen + tipe payload worker, setara `types/nearest-neighbor.ts` dan `types/nearest-neighbor-worker.ts`.

- **`hooks/`** — logika aturan & validasi murni (pure functions/hooks tanpa efek samping berat), dipisah per keperluan:
  - Aturan mode Variable Specification Method (auto-activate, transisi mode, pengembalian variabel ke pool saat berpindah mode, validasi tipe factor/covariate terhadap `measure`).
  - Aturan Validation tab (kapan section holdout vs k-fold aktif/nonaktif, kapan seed tersedia, default saat berpindah strategi) — setara `useNearestNeighborPartitionRules.ts`.
  - Normalisasi checkbox Output — setara `useNearestNeighborOutputRules.ts`.
  - Validasi terpusat form (target wajib, predictor efektif tidak boleh kosong, validasi numerik alpha/persentase/fold/seed) — setara `useNearestNeighborValidation.ts`.

- **`services/`** — orkestrasi ke engine:
  - Service analisis: menyiapkan payload dari `formData` + data dataset, memanggil worker, menangani hasil sukses/gagal, mengirim hasil terformat ke output viewer — setara `nearest-neighbor-analysis.ts`.
  - Formatter hasil: mengubah respons mentah engine menjadi struktur tabel/metric yang dipahami output viewer aplikasi (Case Processing Summary, Attribute Distribution Table, Model Evaluation Metrics, Confusion Matrix) — setara peran `nearest-neighbor-analysis-formatter.ts` + `nearest-neighbor-analysis-output.ts`.
  - Pesan error ramah pengguna — setara `nearest-neighbor-error-messages.ts`.
  - (Bila diperlukan) fungsi terpisah untuk membangun & memicu unduhan file JSON model dari hasil training tersimpan.

- **`rust/`** — engine statistik, struktur mengikuti pola `nearest-neighbor/rust` (Cargo.toml + `src/models`, `src/stats`, `src/utils`, `src/wasm`, dikompilasi ke `rust/pkg/` via wasm-pack). Isi algoritmanya tentu berbeda (Naive Bayes campuran, bukan KNN), tapi *pemisahan tanggung jawab antar folder* dan *cara binding ke JS lewat `wasm/`* wajib konsisten dengan pola yang sudah ada, termasuk pemakaian ulang pendekatan Mersenne Twister untuk seed acak.

- **`__tests__/`** — mengikuti kategori pengujian yang sudah ada di KNN: validasi aturan (mode, numerik), aturan variabel (transisi mode, tipe factor/covariate), algoritma (delegasikan sebagian besar ke test Rust bila memungkinkan, tapi tetap ada test integrasi TS-level untuk payload/format), formatter output.

Integrasi di luar folder ini (wajib, tidak bisa dihindari — lihat bagian 7 untuk batasannya):

1. `frontend/types/modalTypes.ts` — tambah `ModalNaiveBayes` ke `ModalType`.
2. `../classify-menu.tsx` — tambah `MenubarItem` baru.
3. `../ClassifyRegistry.tsx` — tambah lazy import, daftar di `CLASSIFY_MODAL_COMPONENTS`, set preferensi container `"sidebar"`.
4. Konfigurasi lebar sidebar khusus (lokasi persis harus ditelusuri, lihat 4.6) — tambahkan entri untuk `ModalNaiveBayes` identik dengan `ModalNearestNeighbor`.
5. Worker baru di path yang setara `/workers/Classify/NearestNeighbor/...` (mis. `/workers/Classify/NaiveBayes/naive-bayes.worker.js`) yang memuat WASM engine Naive Bayes.

*(Revisi Apply Model — titik integrasi yang sudah ada di kode, dicatat agar dokumen sinkron):*

6. `frontend/components/Output/Statistics/index.tsx` — registry komponen output: key `"Export Model"` → `components/export-model-output.tsx` (tempat tombol Export Model tampil di Output Viewer). Key ini juga dipakai Apply Model untuk menemukan model di result store; **jangan di-rename**.
7. `frontend/hooks/useIndexedDB.ts` — `"NaiveBayes"` di union `AnalysisType`.
8. Lokasi poin 4 adalah `frontend/app/dashboard/layout.tsx` (lihat §4.6).

---

## 7. Larangan

- **Jangan menyentuh atau memodifikasi kode di dalam `frontend/components/Modals/Analyze/Classify/nearest-neighbor`** (atau modul Classify lain seperti `tree`, `discriminant`, `two-step-cluster`, dll). Folder-folder itu murni referensi baca untuk meniru pola, bukan sumber untuk di-refactor demi menu Naive Bayes.
- **Jangan mengubah komponen bersama lintas-modul** (`VariableListManager`, komponen `ui/*`, `useModal`, `useIndexedDB`, store global seperti `useVariableStore`/`useDataStore`) untuk mengakomodasi kebutuhan spesifik Naive Bayes. Jika suatu kebutuhan benar-benar tidak bisa dipenuhi tanpa mengubah kode bersama, hentikan dan diskusikan dulu — jangan diam-diam mengubahnya.
- **Perubahan di luar folder `naive-bayes/` dibatasi ketat hanya pada wiring/registrasi yang memang wajib**, yaitu lima titik integrasi yang disebut eksplisit di akhir bagian 6 (tipe modal, menu item, registry, konfigurasi lebar sidebar, path worker baru). Tidak ada perubahan lain di luar folder ini yang diizinkan tanpa persetujuan ulang.
- Jangan menambahkan fitur di luar cakupan bagian 1 (predict-on-new-data, import model, tab Save ala KNN, dsb.) tanpa memperbarui dokumen ini terlebih dahulu.
- Jangan mengubah definisi/rumus di bagian 5 (smoothing, variance floor, metrik, confusion matrix, kappa, dsb.) secara sepihak saat implementasi. Jika ternyata ada kebutuhan berbeda saat coding, dokumen ini yang direvisi dulu (dan didiskusikan ulang), bukan kode yang diam-diam menyimpang dari sini.
- *(Revisi Apply Model — pengecualian terbatas):* agent yang mengerjakan `../apply-model/PLAN.md` **Fase 0** boleh mengubah folder ini **hanya** pada: `rust/src/stats/save.rs` (schema 1.1, §5.10), tipe `NaiveBayesTrainedModelRaw` di `services/naive-bayes-analysis-formatter.ts`, konstanta `NAIVE_BAYES_WASM_VERSION` di `services/naive-bayes-analysis.ts`, serta worker & `pkg/` di `frontend/public/workers/Classify/NaiveBayes/`. Rumus training/scoring tetap tidak boleh diubah.
- *(Revisi Apply Model):* jangan mengubah `rust/src/stats/preprocess_data.rs::data_value_to_label`/`is_missing_value`, `rust/src/stats/prediction.rs`, atau `rust/src/stats/classification_table.rs` tanpa merevisi `../apply-model/AGENTS.md` — ketiganya disalin oleh Apply Model dan harus tetap identik.
