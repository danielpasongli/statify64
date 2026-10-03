# README-VERIFICATION.md — Panduan Verifikasi Implementasi Apply Model

**Lokasi folder:** `frontend/components/Modals/Analyze/Classify/apply-model/`

Dokumen ini adalah **index** untuk proses verifikasi implementasi menu Apply Model. Gunakan urutan di bawah untuk menjalankan verifikasi dengan benar.

---

## QUICK START

### Jika kamu seorang reviewer / QA:

1. **Baca dokumen kontrak & rencana:**
   - `AGENTS.md` (57 KB) — Keputusan K1–K11, prinsip P1–P7, kontrak data, validasi
   - `PLAN.md` (37 KB) — Rencana implementasi 17 fase bertahap

2. **Invoke Opus agent dengan prompt:**
   - File: `VERIFY-PROMPT.md` (folder ini)
   - Agent: Claude Opus (recommended)
   - Output: `VERIFY-RESULT.md` (folder ini) — akan diisi agent

3. **Review laporan verifikasi:**
   - File: `VERIFY-RESULT.md`
   - Cari: blocker, warning, issue yang harus diperbaiki
   - Diskusikan dengan tim

4. **Jika semua hijau, generate commit message:**
   - File: `COMMIT-MESSAGE-TEMPLATE.md`
   - Isi field dari `VERIFY-RESULT.md`
   - Jalankan `git commit`

---

### Jika kamu seorang developer / implementor:

1. **Pahami keputusan & prinsip:**
   - Baca `AGENTS.md` §0 (keputusan K1–K11)
   - Baca `AGENTS.md` §2 (prinsip P1–P7)
   - **Ini adalah kontrak yang mengikat** — jangan improvisasi

2. **Ikuti rencana fase demi fase:**
   - Baca `PLAN.md` dari Fase 0 sampai Fase 17
   - Kerjakan **satu fase per sesi**
   - Setelah fase selesai, ubah judul menjadi `### Fase N — ... ✅`

3. **Update `VERIFY-RESULT.md` saat fase selesai:**
   - Tulis status & temuan untuk fase ini
   - Jangan tunggu semua 17 fase selesai — update per fase

4. **Jika ada pertanyaan:**
   - Baca `AGENTS.md` §9.3 (prosedur bertanya)
   - **Jangan improvisasi** — berhenti dan tanya

---

## STRUKTUR FILE VERIFIKASI

| File | Tujuan | Siapa | Kapan |
|---|---|---|---|
| **VERIFY-PROMPT.md** | Instruksi detail untuk agent (Opus) yang melakukan verifikasi | Reviewer / QA | Sebelum invoke agent |
| **VERIFY-RESULT.md** | Laporan hasil verifikasi (template kosong, diisi oleh agent) | Agent (output) | Setelah agent selesai |
| **COMMIT-MESSAGE-TEMPLATE.md** | Template pesan git commit, diisi dari hasil verifikasi | Developer | Setelah verifikasi OK |
| **README-VERIFICATION.md** | File ini — index & panduan proses | Tim | Referensi |
| **AGENTS.md** | Kontrak mengikat (tidak boleh diubah implementor) | Semua | Selalu | 
| **PLAN.md** | Rencana 17 fase (status update per fase) | Developer | Per fase |

---

## WORKFLOW VERIFIKASI LENGKAP

```
┌─────────────────────────────────────────────────────────────────┐
│  DEVELOPER MENGIMPLEMENTASI (per fase PLAN.md)                  │
│  - Fase 0: NB export schema 1.1 ✅                              │
│  - Fase 1: Tipe & default ✅                                   │
│  - Fase 2: Adapter & registry ✅                               │
│  - ...                                                           │
│  - Fase 17: Full integration ✅                                 │
│                                                                  │
│  Update PLAN.md: ubah judul fase menjadi "... ✅"              │
│  Update VERIFY-RESULT.md: isi status & temuan per fase          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  DEVELOPER / QA TRIGGER VERIFIKASI                              │
│  - Buka VERIFY-PROMPT.md                                        │
│  - Invoke Claude Opus dengan prompt ini                         │
│  - Tunggu agent selesai analisis                                │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  AGENT (Opus) MEMBACA & VERIFIKASI                              │
│  ✅ Baca AGENTS.md + PLAN.md                                   │
│  ✅ Baca kode aktual di folder apply-model/                    │
│  ✅ Validasi K1–K11, P1–P7, fase 0–17                          │
│  ✅ Cek fixture D1–D3, test result T1–T6                       │
│  ✅ Regresi testing (TS type, Jest, Rust)                      │
│  ✅ Tulis laporan ke VERIFY-RESULT.md                          │
│  ✅ Rating: ✅ / ⚠️ / ❌ per item                               │
│                                                                  │
│  Output: VERIFY-RESULT.md (terisi lengkap)                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  REVIEWER MEMERIKSA LAPORAN (VERIFY-RESULT.md)                  │
│  - Baca BAGIAN A: Kontrak (K1–K11, P1–P7)                      │
│  - Baca BAGIAN B: Plan (Fase 0–17)                             │
│  - Baca BAGIAN C: Fixture & test                               │
│  - Baca BAGIAN D: Regresi (TS, Jest, Rust)                     │
│  - Baca BAGIAN E: Cross-reference consistency                   │
│  - Baca BAGIAN F: Kesimpulan & rekomendasi                     │
│                                                                  │
│  Keputusan:                                                     │
│  ✅ Go → Lanjut ke commit                                       │
│  ⚠️  Fix warning dulu → Ulangi verifikasi                      │
│  ❌ Blocker → Perbaiki, commit baru, verifikasi ulang           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  DEVELOPER GENERATE COMMIT MESSAGE                              │
│  - Buka COMMIT-MESSAGE-TEMPLATE.md                              │
│  - Isi field dari VERIFY-RESULT.md                              │
│  - Copy template penuh                                          │
│  - Run: git commit -m "..."                                     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  PUSH & PR                                                      │
│  - git push origin <branch>                                     │
│  - Buat PR dengan deskripsi dari commit message                 │
│  - Link ke VERIFY-RESULT.md dalam PR description               │
└─────────────────────────────────────────────────────────────────┘
```

---

## CRITICAL CHECKPOINTS

Sebelum invoke verifikasi, pastikan:

### Checkpoint 1: Dokumen Kontrak Selesai (Non-Negotiable)
- [ ] `AGENTS.md` sudah finalized (tidak akan berubah)
- [ ] `PLAN.md` sudah finalized (tidak akan berubah)
- [ ] Keputusan K1–K11 sudah approved pemilik produk
- [ ] Tidak ada revisi dokumen yang pending

**Jika ada revisi dokumen**, **jangan invoke verifikasi** — update dokumen dulu, baru verifikasi.

### Checkpoint 2: Implementasi Minimal Selesai
- [ ] Semua 17 fase sudah dikerjakan (setidaknya draft)
- [ ] `PLAN.md` sudah di-update status setiap fase
- [ ] File-file utama sudah ada (types, adapters, services, Rust crate, UI)
- [ ] Build WASM sudah selesai (jika Fase 7 Rust)

**Jika Fase X belum selesai**, update PLAN.md status, kemudian invoke verifikasi. Agent akan mengidentifikasi gap.

### Checkpoint 3: Regresi Lokal OK
Sebelum invoke agent, jalankan lokal:
```bash
cd frontend

# TS type check
npx tsc --noEmit -p .

# Jest apply-model
npx jest components/Modals/Analyze/Classify/apply-model/

# Jest NB (regresi)
npx jest components/Modals/Analyze/Classify/naive-bayes/

# Rust (jika apply-model ada)
cd components/Modals/Analyze/Classify/apply-model/rust
cargo test
```

Jika **ada error lokal**, fix dulu baru invoke verifikasi. Agent tidak bisa fix kode.

---

## TROUBLESHOOTING

### "Agent tidak bisa baca kode implementasi"

**Solusi:** Jika folder apply-model/ belum ter-stage ke container verifikasi:
1. Tunggu file-file selesai dibuat developer
2. Invoke `device_stage_files` untuk upload folder ke container
3. Beri agent akses ke staged folder
4. Invoke verifikasi ulang

### "Status VERIFY-RESULT.md masih ⏳ Pending semuanya"

**Penyebab:** Agent tidak punya akses ke kode atau belum selesai analisis.

**Solusi:**
1. Cek apakah file `.ts`, `.tsx`, `.rs` sudah ada di folder
2. Pastikan AGENTS.md & PLAN.md dibaca agent
3. Tunggu agent selesai (bisa 60–120 menit untuk 17 fase)
4. Jika timeout, split verifikasi: A vs B vs C vs D per sesi

### "Ada issue/blocker di laporan, tapi aku tidak tahu caranya fix"

**Solusi:**
1. Baca `AGENTS.md` section yang direferensikan di issue
2. Bandingkan dengan kode aktual (file yang disebutkan di issue)
3. Ikuti langkah-langkah di `PLAN.md` fase yang terkait
4. Jika masih tidak jelas, baca `AGENTS.md` §9.3 (prosedur bertanya)

---

## ESTIMASI WAKTU

| Tahap | Durasi |
|---|---|
| Verifikasi (Opus) | 60–120 menit |
| Review laporan (QA) | 15–30 menit |
| Fix blocker (dev) | 15–45 menit (tergantung apa) |
| Generate & commit | 5–10 menit |
| **Total end-to-end** | **~2–3 jam** (best case: ~90 min) |

---

## REFERENSI CEPAT

| Kebutuhan | File | Section |
|---|---|---|
| Kontrak yang mengikat | `AGENTS.md` | §0 (K1–K11) |
| Prinsip design | `AGENTS.md` | §2 (P1–P7) |
| Tipe & data contract | `AGENTS.md` | §3 (3.1–3.6) |
| Error codes | `AGENTS.md` | §4.5 |
| Scoring formula | `AGENTS.md` | §5 |
| Rencana fase | `PLAN.md` | Fase 0–17 |
| Fixture test data | `PLAN.md` | §1 (D1–D3) |
| Expected test result | `PLAN.md` | §1 (T1–T6) |
| Perintah test lokal | `PLAN.md` | Phase-specific |

---

## FILE CHECKLIST

Pastikan file-file verifikasi ini ada:

- [ ] `VERIFY-PROMPT.md` (instruksi agent)
- [ ] `VERIFY-RESULT.md` (laporan kosong, akan diisi agent)
- [ ] `COMMIT-MESSAGE-TEMPLATE.md` (template commit)
- [ ] `README-VERIFICATION.md` (file ini)
- [ ] `AGENTS.md` (kontrak, tidak boleh berubah)
- [ ] `PLAN.md` (rencana, tidak boleh berubah)

---

## KONTAK & ESKALASI

Jika ada yang tidak jelas:

1. **Pertanyaan teknis (kode, design)** → Baca `AGENTS.md` §9.3, ikuti prosedur tanya
2. **Issue dengan verifikasi (agent timeout, error)** → Ulang checkpoint 1–3, coba split fase
3. **Keputusan produk (ambiguitas K1–K11)** → Serahkan ke pemilik produk untuk revisi dokumen

---

**Terakhir diupdate:** 2026-10-03  
**Versi template:** 1.0  
**Status:** Ready to use

