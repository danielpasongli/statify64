# REVIEW-G1 — Tinjauan kode Gelombang 1 (N0, N1, N2, N5, A1)

Reviewer: read-only (tanpa git, tanpa npm install, tanpa cargo add, tanpa wasm-pack). Branch `dija-v2`.
Tanggal tinjauan: 2026-10-04. Sumber kontrak: `PLAN_V2.md` (Fase N0/N1/N2/N5/A1, §1, §3), `AGENTS_V2.md`,
`CATATAN_TAHAP2_negatif_dan_notscored.md`, serta laporan `N0.md`, `N1.md`, `N2.md`, `N2b.md`, `N5.md`, `A1.md`.

Satu-satunya file yang saya tulis ke repo adalah dokumen ini. Semua file kerja sementara (config jest/tsc, harness Rust)
berada di luar repo.

---

## 1. Ringkasan

| Fase | Status | Temuan (ID, severity) |
|---|---|---|
| N0 | **LULUS** | N0-1 Low |
| N1 | **LULUS** (syarat: pemilik menjalankan ulang `cargo test` NB, lihat N1-1) | N1-1 Medium, N1-2 Medium, N1-3 Low, N1-4 Low, N1-5 Low, N1-6 Low |
| N2 | **LULUS** | N2-1 Low, N2-2 Info, N2-3 Low |
| N5 | **PERLU PERBAIKAN** | N5-1 **High**, N5-2 **High**, N5-3 Medium, N5-4 Low, N5-5 Low, N5-6 Low, N5-7 Low, N5-8 Info |
| A1 | **LULUS** | A1-1 Low, A1-2 Low, A1-3 Low, A1-4 Info |

Tidak ada temuan Critical. Dua temuan High semuanya ada di N5 dan kecil perbaikannya.

Pemeriksaan umum (berlaku untuk semua fase):

- **Kepemilikan file.** Saya mencari file yang berubah pada jendela waktu Gelombang 1 (mtime >= 2026-10-04 07:00 UTC) di
  `Transform/`, `rust-crates/`, `Classify/`, `public/workers/` dan `build-wasm.sh`. Hasilnya hanya file milik fase N0/N1/N2/N5/A1
  ditambah dua file CORE milik N2b (`Cargo.toml`, `tests/s4_fit_transform.rs`, lihat N2-3). Tidak ada perubahan di
  `public/workers/**`, `STWV/**`, `Output/Statistics/index.tsx`, dialog NB/AM, `apply-model/rust`, maupun file konstanta versi
  (`NAIVE_BAYES_WASM_VERSION` tetap `naive-bayes-real-20261002a`, `naive-bayes-analysis.ts:54`). Satu-satunya file di luar
  daftar tertulis adalah `naive-bayes/rust/Cargo.lock`, yang dihasilkan cargo (diakui `N1.md` KEPUTUSAN 5).
- **Regresi v1 Rust.** Binary test NB dari sebelum v2 (`target/debug/deps/wasm-31961e00a3bb0169.exe`, 2026-10-03) memuat 94
  nama test. Seluruh 94 nama itu masih ada di binary N1 dan di sumber sekarang (94 test v1 + 18 test baru = 112 `#[test]`).
  Tidak ada test v1 yang hilang. Angka itu juga cocok dengan catatan Fase 18 di `apply-model/PLAN.md:430` ("NB 94 hijau").
- **Regresi v1 TS.** Ekspektasi test v1 yang berubah hanya yang inheren pada tipe/daftar yang diperluas (rincian di N5-8 dan
  A1-4). Tidak ada ekspektasi v1 lain yang diubah.

---

## 2. Temuan per fase (detail)

### N0 — Revisi dokumen kontrak (LULUS)

| ID | Sev | Lokasi | Bukti | Saran |
|---|---|---|---|---|
| N0-1 | Low | `apply-model/AGENTS.md:87-90` (P6), P7, §7.4, P3/P4, §3.6, §4.5, §6.4, §7.2/7.3 | N0 hanya merujuk bagian yang disebut tugas. P7 ("NB/ read-only") dan §7.4 (larangan impor lintas-crate) masih bertentangan dengan v2 secara tekstual; yang menyelesaikannya hanya blok hierarki di baris 3. N0 sudah melaporkan ini sendiri (`N0.md` "Catatan untuk fase berikutnya" butir 1). | Di Fase V1 tambahkan rujukan `(Lihat AGENTS_V2.md §...)` pada P3/P4/P7, §3.6, §4.5, §6.4, §7.2/7.3, §7.4 bila pemilik setuju. Tidak memblokir. |

Pemeriksaan Tugas dan Kriteria:

- Blok `> **Revisi v2 (disetujui pemilik, 2026-10):**` ada di bagian atas kedua file: `naive-bayes/AGENTS.md:3`,
  `apply-model/AGENTS.md:3`. Isinya memuat semua butir yang diminta: v1 tetap berlaku, perluasan v2, schema 2.0, Raw Text di AM,
  pengecualian P6, pengecualian K4, dan hierarki `AGENTS_V2 > PLAN_V2 > dokumen ini`.
- Baris rujukan `(Lihat AGENTS_V2.md §x)` ada pada semua bagian yang diminta. NB: §1 `AGENTS.md:31`, §5 `:154`, §5.10 `:225`,
  §7 `:292`. AM: K4 `:36`, P1 `:73`, P6 `:88`, §3.1 `:153`, §3.4 `:279`, §5 `:468`.
- Setiap rujukan menunjuk bagian AGENTS_V2 yang benar (V1–V5/§1, §6 dan V5–V6/V12, V8/§8, P-V1/P-V4/§12, V10–V11/§10.2,
  §8/§10.1, V13/P-V2/§10.4). Seluruh nomor bagian itu ada di `AGENTS_V2.md`.
- Hanya penambahan: baris `> ` dan baris `*(Revisi v2 ...)*` bersifat tambahan, tanpa penghapusan. Ini tidak bisa saya
  buktikan dengan diff karena `git` dilarang. Saya mengandalkan verifikasi `git diff` oleh pemilik di `N0.md:36-37`.

### N1 — NB Rust: config, payload, data v2 (LULUS, bersyarat)

| ID | Sev | Lokasi | Bukti | Saran |
|---|---|---|---|---|
| N1-1 | Medium | `N1.md:59,64,87` | Run terakhir pemilik: 107/110 lulus, 3 gagal karena ekspektasi test baru salah. Sesudahnya ada dua perubahan yang **belum dijalankan ulang**: perbaikan 3 ekspektasi, dan pesan `NB_E_TEXT_NEGATIVE` baru (`text_negative_message`, test (a)(b)(c)). Saya tidak bisa menjalankan cargo (tidak ada toolchain di VM perangkat; di cloud crates.io 403). Pengganti yang saya lakukan: (1) membaca `ten_row_dataset`: target missing memang di indeks 0-based 5 (`preprocess_data.rs:412`), jadi ekspektasi `[0,1,2,3,4,6,7,8,9]` (`:617`) benar; (2) menyalin logika `vector_to_csr` + `text_negative_message` ke harness terpisah: 4 test lulus (satu kolom negatif, beberapa kolom negatif, zero-fill/CSR, negatif di baris target-missing). | Pemilik jalankan ulang `cd .../naive-bayes/rust && cargo test` dan `cargo check --target wasm32-unknown-unknown`. Harapannya 112 test lulus (94 v1 + 18 baru). |
| N1-2 | Medium | `wasm/constructor.rs:187-207`, `stats/preprocess_data.rs:56-58` | Payload Text dan `config_v2` diterima lalu **tidak dipakai**: `run_analysis(&analysis.data, &analysis.config, ...)` tidak menerima keduanya. Akibatnya setelah worker meneruskan `text` (I1) tetapi sebelum N3a/N3b selesai, model campuran akan diam-diam dihitung tanpa fitur Text (hasil menyerupai v1 tetapi salah), dan model hanya-Text gagal dengan pesan generik "At least one predictor variable is required". Konstruktor sudah melonggarkan cek predictor (`constructor.rs:159-160`) tetapi `preprocess_naive_bayes_data` masih menolak daftar kosong. Aman hari ini karena worker belum meneruskan `text` dan WASM belum dibangun. | Tambahkan guard sementara di konstruktor: bila `text_payload != TextPayload::None` dan belum didukung, kembalikan galat eksplisit ("Fitur Text belum didukung oleh build ini"); N3a menghapusnya. Minimal: jadikan ini butir wajib di tugas N3a (parameter `text`/`config_v2` ke `run_analysis` dan lewati resolusi predictor bila Text terisi). |
| N1-3 | Low | `models/config.rs:93-101` vs `statify-text-core/src/nb_text.rs:19-23` | Ada dua enum `TextLikelihood` (NB dan CORE) dengan varian identik. Semangat P-V2 (satu sumber) lebih baik dipenuhi dengan satu tipe. | Pada N3a tambahkan `impl From<config::TextLikelihood> for nb_text::TextLikelihood` atau pakai langsung tipe CORE. Tidak memblokir. |
| N1-4 | Low | `models/data.rs:271-276`, `preprocess_data.rs:306-310` | Galat bentuk payload (baris vector tidak rata; jumlah baris Text ≠ data) tidak berawalan kode `NB_E_*` (diakui `N1.md` KEPUTUSAN 4). Di TS pesan ini jatuh ke fallback generik "Analisis Naive Bayes tidak dapat diselesaikan". | Tambahkan `NB_E_TEXT_SHAPE` di AGENTS_V2 §11 dan di `naive-bayes-error-messages.ts` pada fase berikutnya. |
| N1-5 | Low | `models/data.rs:252-312`, `N1.md:121` | `vector_to_csr` memindai seluruh payload. Bila dipanggil sebelum `align_text_payload`, nilai negatif di baris yang akan dibuang (target missing) tetap menggagalkan analisis (terbukti di harness). Urutan yang benar: `align_text_payload` → penentuan NotScored dari `TextPayload` mentah → `vector_to_csr`. | Tulis urutan ini sebagai komentar kode dan test eksplisit di N3a. |
| N1-6 | Low | `N1.md:59,87` | Laporan menyebut "98 test lama" padahal baseline binary pra-v2 memuat 94 (total 110 = 94 + 16 baru memang cocok dengan binary N1). Tidak ada dampak kode, hanya akurasi laporan. | Koreksi angka "98" menjadi 94 saat laporan diperbarui setelah `cargo test` ulang. |

Pemeriksaan Tugas dan Kriteria:

1. Cargo.toml: `statify-text-core = { path = "../../../../../../rust-crates/statify-text-core" }` ada (`rust/Cargo.toml:34`). Tidak ada dependensi lain yang berubah.
2. Config v2 (`models/config.rs:81-229`): `NumericLikelihood`/`TextLikelihood`/`TextSource` dengan `rename` sesuai string TS;
   `MainConfigV2`, `OptionsConfigV2` (`TextAlpha`=1), `OutputConfigV2` (`TextTopK`=100, `TextFeatureTable`=true), semuanya
   `#[serde(default)]`. `Text: Option<TextVectorizerConfig>` dibaca sebagai `Value` dulu sehingga galat CORE diteruskan sebagai
   `NB_E_TEXT_CONFIG: [kode] pesan` (`config.rs:215-221`). Bentuk JSON `toRustConfig` dari TS cocok dengan
   `TextVectorizerConfig` (semua field wajib terkirim: `lowercase`, `stemming_method`, `stopwords_method`, `custom_stopwords`,
   `delimiters`, `ngram_*`, `tf_method`, `idf_method`, `words_to_keep`; sisanya punya default).
   Catatan desain: field v2 ditaruh di struct saudara (`*V2`), bukan di struct v1, agar test v1 `save.rs` tetap terkompilasi
   (`config.rs:68-79`). Alasannya masuk akal dan sah menurut P-V1.
3. Payload Text (`data.rs:197-312`): `TextPayload` bertag `source` (`none`/`raw`/`vector`); `raw_documents()` null→"";
   `vector_to_csr()` null/non-finite→0, pecahan boleh, negatif→`NB_E_TEXT_NEGATIVE` dengan nama kolom pertama dan jumlah kolom
   (sesuai CATATAN_TAHAP2 §1); baris tidak rata→galat tanpa panic. Kolom CSR terurut naik (loop kolom menaik).
4. Penyelarasan baris (`preprocess_data.rs:268-332`): `kept_row_indices` memakai aturan target-missing yang sama dengan
   `preprocess_naive_bayes_data`; `align_text_payload` memeriksa jumlah baris dan memakai `.get(i)` (tanpa panic). Fungsi
   terkunci P-V4 (`is_missing_value`, `data_value_to_label`) tidak diubah (`:226-254` utuh).
5. Konstruktor (`constructor.rs:50,119-143`): argumen ke-6 `text: JsValue`; `undefined`/`null`→`TextPayload::None`; payload v1
   persis seperti sebelumnya (hanya cek "predictor kosong" yang dilonggarkan bila Text terisi, `:159-160`).
6. Test baru: `config.rs` 5 test, `data.rs` 9 test, `preprocess_data.rs` 4 test, sesuai butir Tugas 6 (v1 tetap ter-parse,
   v2 raw/vector ter-parse, negatif→error, baris target missing ikut terbuang di Text).

Bug nyata yang saya cari dan tidak temukan di N1: off-by-one pada indeks `kept`, pembagian nol, `unwrap` pada input, error
tertelan. `unwrap_or(None)`/`unwrap_or_default()` di `align_text_payload` aman karena jumlah baris sudah divalidasi lebih dulu.

### N2 — CORE `nb_text` (LULUS)

| ID | Sev | Lokasi | Bukti | Saran |
|---|---|---|---|---|
| N2-1 | Low | `tests/nb_text.rs:190-206` | Test tie-break "alfabetis" tidak bisa membedakan urutan alfabetis dari urutan indeks, karena `terms()` sudah terurut alfabetis sehingga indeks = urutan alfabetis. Probe saya dengan nama term dibalik (`["a","z","y","x","b"]`) lulus, jadi **implementasi benar** (`nb_text.rs:238-242`), hanya testnya yang lemah. | Tambahkan test dengan nama term yang tidak terurut seperti probe: ekspektasi `[4,3,2,1,0]`. |
| N2-2 | Info | `nb_text.rs:41-48,109,144`; `N2.md` KEPUTUSAN 2 | `train` tidak memvalidasi `alpha`; `alpha <= 0` diam-diam dipetakan ke `ln(MIN_POSITIVE)`. | Pastikan N3a dan A2 memvalidasi `0 < alpha <= 999` sebelum memanggil `train`. |
| N2-3 | Low | `N2b.md`; `statify-text-core/Cargo.toml`, `tests/s4_fit_transform.rs` | Fase **N2b** (fitur `float_roundtrip`) tidak ada di peta Gelombang 1 `PLAN_V2.md` dan menyentuh file di luar daftar N2 (`Cargo.toml` CORE, test Tahap 1 `s4_fit_transform.rs`: toleransi 1e-12 diganti perbandingan eksak). Ada `PROMPT_N2b_float_roundtrip.md` dan hasil terverifikasi pemilik, jadi ini tampak sah. | Catat N2b di `PLAN_V2.md` (checklist §5) agar jejaknya jelas. |

Pemeriksaan Tugas dan Kriteria:

- Signature persis PLAN_V2: `TextLikelihood`, `TextNbParams` (7 field sesuai), `train` (`nb_text.rs:69-76`), `score_rows` (`:169`),
  `top_k` (`:211`). `lib.rs:11` hanya menambah `pub mod nb_text;`. Tidak ada dependensi baru (hanya `serde` yang sudah ada).
- Rumus: Multinomial (`:104-113`), Bernoulli (`:114-126`, skor efisien `Σ A + Σ_{x>0}(L−A)` di `:174-176,193-199`), Complement
  norm=False (`:127-148`, `uses_class_prior=false` bila K≥2 di `:152`), Top-k (`:211-247`, K=1 memakai `L` langsung, seri→term
  alfabetis lalu indeks). Semua sesuai AGENTS_V2 §6.1–6.3 dan §6.6.
- **Angka golden dipakai persis dan benar-benar diuji**: `tests/nb_text.rs:79-145` memuat matriks `L` §6.7 (toleransi 1e-6),
  `class_term_counts`, skor gabungan dan P(pos) untuk ketiga likelihood. Dua verifikasi independen saya:
  (a) 11 test aslinya + 1 probe dikompilasi di cloud dengan `CsrMatrix` stub dan derive serde dibuang: 12/12 lulus;
  (b) angka §6.7 saya hitung ulang dengan scikit-learn: Multinomial `[-4.799914,-3.072693]` P=0.849057, Bernoulli
  `[-5.898527,-3.060271]` P=0.944708, Complement `[2.667228,3.701302]` P=0.737705. Cocok dengan dokumen.
- NaN/pembagian nol: kelas tanpa dokumen ditangani (`safe_ln`; test `kelas_tanpa_dokumen_tidak_menghasilkan_nan`, `:160-178`);
  label di luar rentang dan indeks kolom di luar kosakata diabaikan tanpa panic; tidak ada `unwrap`.
- "Test hijau pada crate sebenarnya": `N2.md` menulis "SELESAI SEBAGIAN" karena cargo tak bisa jalan di sesi agent, tetapi
  `N2b.md` melaporkan pemilik menjalankan `cargo test` CORE penuh: nb_text 12/12, characterization 15/15, s2 16/16, s3 25/25,
  s4 22/22. `tests/nb_text.rs` tidak berubah sejak itu (mtime 07:05, sebelum run 07:27). Kriteria terpenuhi lewat laporan N2b.

### N5 — NB TS: tipe, default, validasi, peringatan, payload (PERLU PERBAIKAN)

| ID | Sev | Lokasi | Bukti | Saran |
|---|---|---|---|---|
| N5-1 | **High** | `services/naive-bayes-error-messages.ts:19-21`; `hooks/__tests__/naiveBayesPayload.test.ts:127-135` | `CATATAN_TAHAP2_negatif_dan_notscored.md` §1 butir 2 dan 4 mewajibkan pesan ramah `NB_E_TEXT_NEGATIVE` **meneruskan nama kolom dan jumlah kolom bermasalah** ("jangan membuangnya"; diulang di handoff `N1.md:122`). Implementasi mengembalikan string tetap tanpa nama kolom. Test memakai pesan lama tanpa kolom (`"Kolom vektor teks berisi nilai negatif; ..."`) dan hanya `toContain("nilai negatif")`, sehingga pelanggaran ini tidak tertangkap. Pesan Rust sebenarnya (`data.rs:197-202`) berformat `Kolom vektor teks '{kolom}' berisi nilai negatif (total {n} kolom bermasalah)`. | Ekstrak `'([^']+)'` dan `total (\d+) kolom` dari pesan, lalu susun pesan ramah yang memuat keduanya (mis. "Kolom vektor teks 'VEC_a' berisi nilai negatif (total 2 kolom bermasalah). ..."). Ganti input test dengan pesan Rust asli dan tambahkan test (a) satu kolom, (b) beberapa kolom. |
| N5-2 | **High** | `hooks/useVariable.ts:22-32` (`parseCellValue`); `services/naive-bayes-analysis.ts:103-134,189-197`; `N5.md` KEPUTUSAN 4 | Kolom Raw Text dibaca dari `getSlicedData`, yang memanggil `parseCellValue`: `Number.parseFloat("2024 pilkada seru")` = 2024, sehingga teks berawalan angka menjadi angka dan dokumen terpotong (`"3 kucing lucu"`→`"3"`). Tweet yang diawali angka sangat umum, jadi ini merusak data diam-diam pada kasus pakai utama (dataset tweet). N5 mengetahuinya tetapi tidak menutupnya, dan tidak ada fase yang secara eksplisit ditugasi. Kontrak "kolom Text di ekor `dataVariables`" (`naive-bayes-analysis.ts:189-197`) justru memaksa jalur ini. `useVariable.ts` bukan milik N5/N7. | Putuskan sekarang: (a) builder menerima teks mentah (`string[]`) dari `useDataStore.data[row][columnIndex]` dan **tidak** lewat `getSlicedData`; (b) tulis sebagai butir wajib + test di tugas N7 ("3 kucing lucu" harus tetap utuh). Jangan mengubah `getSlicedData` (dipakai fitur lain). |
| N5-3 | Medium | `dialogs/naive-bayes-main.tsx:31,96`; `components/__tests__/options.test.tsx:6` | Saya menjalankan `tsc` pada subset file Gelombang 1 + dua file ini dan **mengonfirmasi** 3 error: `naive-bayes-main.tsx(31,55)` dan `(96,33)` (properti `text` hilang), `options.test.tsx(6,11)` (4 field Options v2 hilang). Penyebab: tipe `NaiveBayesType.text` wajib (`types/naive-bayes.ts:90`). Semuanya file milik N7, jadi N5 tidak bisa memperbaikinya, tetapi repo sekarang gagal type-check sampai N7 selesai. Runtime v1 tetap aman: data lama tanpa `text`/`TextTopK` jatuh ke default (`naive-bayes-analysis.ts:82-86`). | Jangan rilis/merge Gelombang 1 saja. Pastikan N7 memperbaiki ketiganya (pakai `mergeWithDefaults`, `cloneNaiveBayesDefault` + `text`). |
| N5-4 | Low | `services/naive-bayes-analysis.ts:78-93`; `rust/src/models/config.rs:130-131` | Builder meneruskan `main.TextSource` apa adanya, padahal N5 sendiri menyatakan nilai efektif diturunkan dari isi slot (`useNaiveBayesValidation.ts:25-35`) dan nilai tersimpan bisa basi. Rust menyimpan `text_source` dari config; bila N3a bercabang pada field itu alih-alih pada `text.source` payload, hasilnya bisa tidak konsisten. | Di builder set `main.TextSource = getEffectiveTextSource(main)`, atau tetapkan di N3a bahwa Rust hanya memakai `text.source` dari payload. |
| N5-5 | Low | `services/naive-bayes-error-messages.ts:24` | Regex `/fold\D{0,3}(\d+)/i` bergantung pada format pesan Rust yang belum ada (N3b). Contoh "fold ke-3" tidak cocok (4 karakter non-digit). | Sepakati format di N3b: `NB_E_TEXT_EMPTY_VOCAB_FOLD: fold {n} ...` dan uji dengan pesan itu. |
| N5-6 | Low | `services/naive-bayes-analysis.ts:119` | Teks berisi spasi saja dikirim sebagai string spasi, bukan `null`. AGENTS_V2 V11 menganggap whitespace sebagai missing. Hanya masalah bila Rust tidak men-trim. | Pastikan N3a/A2 men-trim saat menentukan NotScored, atau normalkan di builder. |
| N5-7 | Low | `hooks/__tests__/naiveBayesPayload.test.ts:27-84` | Test builder memberi argumen irisan secara manual. Pemotongan ekor `dataVariables` di `analyzeNaiveBayes` (`naive-bayes-analysis.ts:178-197`) dan `rowCount` dari `targetSlices[0].length` tidak teruji. | Ekspor fungsi pemisah murni dan uji urutan `[target, ...predictor, ...text]` (terutama kasus tanpa target dan tanpa predictor). |
| N5-8 | Info | `hooks/__tests__/useNaiveBayesValidation.test.ts:136-149` | Satu test v1 gagal ("form kosong ... target & predictor"). **Terkonfirmasi pra-eksisting**: `apply-model/PLAN.md:430` (Fase 18) mencatat "Jest naive-bayes memiliki 2 test gagal yang sudah ada di HEAD", termasuk test ini; `getEffectivePredictors` v1 dengan target `null` mengembalikan semua variabel sehingga pesan "predictor" memang tidak pernah muncul. Bukan regresi N5. Penyentuhan test v1 oleh N5 terbatas pada 4 literal `main` yang diberi 3 field v2 (`:46-49,66-69,84-87,107-110`), ekspektasi tidak berubah; ini sah menurut AGENTS_V2 §12 (tipe diperluas) dan sudah dilaporkan. | Pemilik putuskan: ubah test, atau tambahkan pesan "predictor" saat target kosong. Test pra-eksisting kedua (`options.test.tsx` "value > 999") milik N7. |

Pemeriksaan Tugas dan Kriteria:

1. Tipe dan default (`types/naive-bayes.ts:14-47,69-77,83-101`; `constants/naive-bayes-default.ts:13-71`): semua field AGENTS_V2 §4 ada
   dengan default benar (`NumericLikelihood` gaussian, `TextLikelihood` multinomial, `TextAlpha` 1, `TextFeatureTable` true,
   `TextTopK` 100, `text: STWV_DEFAULT_CONFIG`). `mergeWithDefaults` diekspor (`default.ts:94-120`): deep merge per section,
   termasuk sub-objek STWV dan `NumericLikelihoodOverrides`, hasil tidak berbagi referensi dengan default.
2. `getEffectivePredictors` tetap satu-satunya sumber (`useNaiveBayesValidation.ts:73-100`): mode Exclude mengeluarkan target,
   `ExcludedVar`, `RawTextVar`, `TextVectorVars`, dan `unknown`; STRING lain tetap ikut. Validasi OK sesuai §3.3
   (`:121-135`), `NB_E_COMPLEMENT_MIXED` memblokir (`:139-147`), `validateStwvConfig` hanya untuk raw (`:150-154`), `TextAlpha`
   (>0, ≤999) dan `TextTopK` (bulat 1–1000, hanya bila tabel dicentang) di `getNumericInputError` (`:195-219`).
3. `useNaiveBayesTextRules.ts`: W-VEC (`:66-104`, sampel 1.000, ambang 20, ">50% nol" ketat sehingga tepat 50% tidak dihitung),
   W-STR (`:111-143`, sampel 5.000, unik ≥50%), W-LEAK (`:146-150`). Teks pesan ketiganya identik dengan AGENTS_V2 §3.4.
   Hook `useMemo` ada (`:157-176`).
4. Payload (`naive-bayes-analysis.ts:103-134`): `none`/`raw`/`vector` sejajar baris target; `Text: toRustConfig(text)` hanya
   untuk jalur raw (`:90-92`), keputusan konservatif yang terdokumentasi (`N5.md` KEPUTUSAN 6); konstanta versi tidak diubah.
5. Pesan error §11 ada untuk kelima kode (`error-messages.ts:19-44`), dicek lebih dulu dari pesan v1 sehingga tidak tertangkap
   kata "fold"/"predictor". Kekurangan: N5-1.
6. Test jest: `useNaiveBayesV2.test.ts` (21), `useNaiveBayesTextRules.test.ts` (11, termasuk 20 vs 19 kolom di `:39-55` dan
   unik 50% di `:111-119`), `naiveBayesPayload.test.ts` (13). Seluruh butir test pada Tugas 6 ada. Hasil pemilik: 45/45 test baru
   lulus.

Bug nyata yang saya cari: NaN/pembagian nol di W-VEC/W-STR dijaga (`nonMissing > 0`); `getTextColumnNames` memakai
`main.RawTextVar as string` tetapi hanya dipanggil setelah `getEffectiveTextSource === "raw"` sehingga aman; tidak ada `any`.

### A1 — AM TS: schema 2.0, adapter, mapping (LULUS)

| ID | Sev | Lokasi | Bukti | Saran |
|---|---|---|---|---|
| A1-1 | Low | `constants/apply-model-codes.ts:74`; `dialogs/__tests__/apply-model-main.test.tsx:389-399`, `hooks/__tests__/useApplyModelValidation.test.ts:238-241`, `services/__tests__/apply-model-error-messages.test.ts:7-13` | Pesan `AM_E_SCHEMA_VERSION_UNSUPPORTED` masih "Versi yang didukung: 1.0, 1.1." padahal 2.0 sudah didukung adapter. Empat test mengunci pesan itu dengan **"2.0" sebagai contoh versi tak didukung**. Penundaan ke A3 sudah disetujui pemilik (`A1.md:342`), tetapi sampai A3 pengguna dengan model 3.0 melihat daftar versi yang salah. | Di A3 ubah pesan menjadi "1.0, 1.1, 2.0" dan ganti contoh test ke "3.0". Ini mengubah ekspektasi lama, jadi catat di laporan A3 dan minta persetujuan. |
| A1-2 | Low | `services/__fixtures__/nb-model-v2_0-raw.json`, `nb-model-v2_0-vector.json` | `log_weights` dibulatkan 6 desimal (selisih terhadap `ln((N+α)/(N_c+αV))` hingga 4.7e-7; saya hitung ulang dengan node). P-V3 meminta konsistensi NB↔AM 1e-9, jadi test A2 yang memakai fixture ini hanya bisa memakai toleransi 1e-6. | Di A2 uji skor fixture dengan toleransi 1e-6 (angka §6.7 sendiri berpresisi 1e-6); uji 1e-9 hanya NB↔AM pada model yang dilatih (bukan fixture). |
| A1-3 | Low | `adapters/naive-bayes-adapter.ts:522-641` | Validasi blok `text` belum memeriksa: `uses_class_prior` konsisten dengan likelihood dan K (complement K≥2 harus `false`, selain itu `true`), `log_weights` ≤ 0, `doc_freq`/`n_docs` pada `recipe` (validasi resep sengaja dangkal, `A1.md:348`). Model buatan tangan bisa lolos dan menghasilkan skor aneh. | Tambahkan pemeriksaan konsistensi `uses_class_prior` (murah) dan pastikan A2 (Rust, lapis kedua) menolak sisanya. |
| A1-4 | Info | `adapters/__tests__/naive-bayes-adapter.test.ts:84`, `registry.test.ts:51`, `constants/__tests__/apply-model-codes.test.ts:17,38-39`; `apply-model-codes.ts:25` | Ekspektasi test lama yang berubah, semuanya inheren dan disetujui pemilik (`A1.md:341`): daftar versi → `["1.0","1.1","2.0"]`, jumlah kode error 43→50 (7 kode baru), warning 8→9, regex kode `AM_[EWI]_...`. Selain itu `AM_W_TEXT_ALL_ZERO_FILLED` adalah kode **di luar** AGENTS_V2 §10.2 (disetujui, `A1.md:345`) sehingga dokumen kontrak belum memuatnya. | Tambahkan `AM_W_TEXT_ALL_ZERO_FILLED` dan `AM_I_TEXT_ZERO_FILLED` ke AGENTS_V2 §10.2 di fase V1. |

Pemeriksaan Tugas dan Kriteria:

- Tipe schema 2.0 (`types/model-schema.ts:51-112`): `NaiveBayesExportText`, `TextVectorizerRecipe` (cocok dengan `TextVectorizerModel`
  CORE `model.rs:19-37`), `likelihood`/`min_variance` pada fitur, `text?: ... | null`. Field 1.0/1.1 tidak berubah.
- Adapter menerima `["1.0","1.1","2.0"]` (`naive-bayes-adapter.ts:17`) dan memvalidasi §10.1 di langkah 12–13 (`:439-641`): `AM_E_NB2_TEXT_SHAPE`,
  `_TEXT_SOURCE`, `_LIKELIHOOD`, `_COMPLEMENT_MIXED`. Model hanya-Text (`feature_order` kosong) sah hanya bila ada blok `text`
  (`:308-313`); blok `text` pada 1.0/1.1 diabaikan (`:82-85`). Descriptor memuat info Text (`:737-801`) dan **tidak** menambah
  key `text` untuk model v1 (`:798-800`). 3 baris ringkasan v1 tidak berubah.
- Kode baru (`apply-model-codes.ts:14-28,102-108,137,140`): 7 error + 1 warning + 1 info, masing-masing punya pesan; severity `"info"` ditambahkan
  ke `ApplyModelIssue` (`:30-34`).
- Mapping (`useApplyModelMappingRules.ts`): raw auto-map persis lalu case-insensitive unik (`:141-155`), validasi
  `AM_E_MAP_RAW_TEXT_UNMAPPED`/`_TYPE` (`:295-316`); vector auto-map memakai indeks nama agar ribuan kolom cepat (`:57-92,156-169`),
  kolom tak ditemukan hanya info `AM_I_TEXT_ZERO_FILLED` dengan `detail` = jumlah dan tidak memblokir (`:317-360`);
  `useApplyModelValidation.ts:59-66` meneruskan `RawTextVar`/`VectorMapping`, dan hanya `severity === "error"` yang
  menentukan `isValid` (`:88-90`). `formatVectorMappingSummary` menghasilkan "{m} dari {V} kolom vektor ditemukan; {V−m} dianggap 0."
  (`:211-213`).
- Fixture memakai angka golden §6.7 (kelas `[neg,pos]`, 5 term, `N_ct` neg `[0,1,1,1,1]` pos `[4,1,1,1,0]`, prior 1/3 dan 2/3).
  Test: "auto-map vector 3 dari 5 kolom → 2 zero-filled, valid" ada di `useApplyModelMappingRulesV2.test.ts:140`.
- Model 1.0/1.1 tetap valid (`naive-bayes-adapter-v2.test.ts:176-207`), hasil auto-map v1 tanpa key teks
  (`MappingRulesV2.test.ts:271-281`). Hasil pemilik: 21 suite, 385 test lulus.

Bug nyata yang saya cari dan tidak temukan di A1: tidak ada `any`; langkah validasi melewati data yang tipenya sudah dilaporkan
salah (tanpa error berantai/crash); `terms.length === 0` ditolak (`adapter:572`); tidak ada pembagian nol.

---

## 3. Daftar test yang dijalankan dan hasil

Keterbatasan lingkungan: VM perangkat tidak punya `cargo`; di cloud `cargo` ada tetapi `index.crates.io` 403 (tidak ada cache
registry); `node_modules` adalah hasil instalasi Windows, sehingga jest gagal memuat binding native Linux (`@unrs/resolver-binding-linux-x64-gnu`,
SWC `@next/swc-linux-x64-gnu`) dan jaringan npm tertutup. Karena itu test resmi tidak dapat saya eksekusi sendiri dan saya memakai
hasil pemilik dari laporan, ditambah verifikasi pengganti di bawah.

| # | Perintah / metode | Cakupan | Hasil |
|---|---|---|---|
| 1 | `npx jest ...` (config proyek, lalu config sementara ts-jest di luar repo) | N5, A1 | **Tidak dapat dijalankan** (binding native Linux tidak ada, jaringan npm 403). |
| 2 | `tsc -p` config sementara di luar repo (extends `frontend/tsconfig.json`; `composite=false`, `types=[jest,node]`), file: NB `types/constants/hooks (+ __tests__)/services/naive-bayes-analysis.ts, naive-bayes-error-messages.ts`; AM `types/adapters/constants/hooks (+ __tests__)` | N5, A1 | **0 error**, exit 0 (35 file NB/AM dalam program). |
| 3 | `tsc` seperti #2 + `naive-bayes-main.tsx`, `options.test.tsx`, `apply-model/dialogs/*.tsx`, `apply-model/services/*.ts` | dampak lintas fase | 3 error yang diprediksi dan terkonfirmasi: `naive-bayes-main.tsx(31,55)`, `(96,33)`, `options.test.tsx(6,11)` (N5-3). Dialog dan service AM bersih. Error matcher jest-dom di `options.test.tsx` adalah artefak config sementara saya (tidak memuat `@testing-library/jest-dom`), tidak dihitung. |
| 4 | `npx tsc --noEmit -p frontend` (penuh) | seluruh repo | **Tidak selesai** dalam batas 180 detik per panggilan (repo besar di mount Windows) dan proses latar mati bersama shell. Sebagai pengganti: #2 dan #3. Hasil pemilik: 46 error di 20 file, hanya 3 yang terkait G1 (lihat N5-3). |
| 5 | Kompilasi terisolasi `nb_text.rs` + 11 test asli `tests/nb_text.rs` + 1 probe (cloud, `cargo test --offline`, `CsrMatrix` stub, derive serde dibuang) | N2 | **12/12 lulus** (3 golden, Bernoulli term absen, kelas kosong tanpa NaN, label di luar rentang, top-k ×3, indeks di luar kosakata/NaN, pecahan, probe tie-break). Test `jalur_raw_end_to_end` tidak ikut karena butuh crate penuh. |
| 6 | Verifikasi angka §6.7 dengan scikit-learn (`MultinomialNB`, `BernoulliNB`, `ComplementNB(norm=False)`, α=1) | N2, A1 | Cocok dengan dokumen: skor `[-4.799914,-3.072693]`, `[-5.898527,-3.060271]`, `[2.667228,3.701302]`; P(pos) 0.849057 / 0.944708 / 0.737705. |
| 7 | Harness cloud: salinan `TextPayload::vector_to_csr` + `text_negative_message` (tanpa serde) | N1 | **4/4 lulus**: satu kolom negatif memuat nama kolom, beberapa kolom → nama pertama + jumlah, zero-fill/CSR, negatif di baris target-missing tetap gagal (N1-5). |
| 8 | Analisis binary test NB (`strings`/`grep -a` pada `wasm-31961e00a3bb0169.exe` lama vs `wasm-0eaf1a07fb22158f.exe` N1) | N1 (regresi v1) | 94 nama test v1 identik; tambahan 16 nama baru di binary N1 (sisanya ditambahkan sesudah run itu). |
| 9 | Hitung ulang fixture A1 dengan node (`ln((N+α)/(N_c+αV))` vs `log_weights`) | A1 | Selisih maks 4.7e-7 (< 1e-6). |
| 10 | Hasil pemilik (dari laporan, tidak saya ulang) | semua | N2b: CORE `cargo test` hijau (characterization 15, nb_text 12, s2 16, s3 25, s4 22). N1: NB `cargo test` 107/110 (3 ekspektasi test baru salah, sudah dibetulkan, **belum dijalankan ulang**). N5: jest hooks 60 lulus, 1 gagal pra-eksisting. A1: jest apply-model 21 suite, 385 lulus. |

---

## 4. Rekomendasi

**Boleh lanjut ke Gelombang 2: YA, bersyarat.**

Alasan: N0, N1, N2, dan A1 lulus tanpa temuan yang menghalangi fase turunannya. Prasyarat A2 (N2) terpenuhi dan N3a (N1+N2)
terpenuhi, dengan angka golden yang sudah terbukti benar secara independen (bagian 3 #5–#6). Dua temuan High ada di N5, dan keduanya
hanya memblokir fase yang bergantung pada N5 (N6, N7, N8).

Syarat sebelum memulai:

1. **Sebelum N3a:** pemilik menjalankan ulang `cargo test` dan `cargo check --target wasm32-unknown-unknown` di crate NB
   (N1-1; harapan 112 lulus). Masukkan N1-2 (guard atau penerusan `text`/`config_v2` ke `run_analysis`), N1-3, dan N1-5 ke tugas N3a.
2. **Sebelum N6/N7:** perbaiki N5-1 (pesan `NB_E_TEXT_NEGATIVE` dengan nama kolom, plus test) dan putuskan N5-2 (kolom Raw Text
   tidak boleh lewat `getSlicedData`). Tulis N5-2 sebagai butir wajib bertes di tugas N7. Perbaikan N5-4 sebaiknya ikut dikerjakan
   di putaran yang sama.
3. **A2 boleh jalan paralel sekarang.** Bawa A1-2 (toleransi 1e-6 untuk fixture) dan A1-3 (validasi lapis kedua di Rust) ke
   tugas A2, dan N5-6 serta aturan NotScored di `CATATAN_TAHAP2` §2.
4. Jangan rilis atau merge hanya dengan Gelombang 1: `tsc` penuh gagal di `naive-bayes-main.tsx` dan `options.test.tsx` sampai N7
   selesai (N5-3).
5. Keputusan pemilik yang masih terbuka (bukan temuan kode): nasib test pra-eksisting "form kosong" (N5-8), pencatatan N2b di
   `PLAN_V2.md` (N2-3), dan penambahan kode `AM_W_TEXT_ALL_ZERO_FILLED`/`AM_I_TEXT_ZERO_FILLED` ke AGENTS_V2 (A1-4).
