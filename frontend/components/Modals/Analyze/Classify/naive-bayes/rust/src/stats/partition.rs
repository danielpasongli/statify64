// naive-bayes/rust/src/stats/partition.rs
//
// PLAN.md Fase 10 — "Stratified train/holdout split + Mersenne Twister"
// dan Fase 11 — "Stratified K-Fold".
//
// AGENTS.md §5.5:
//   - Training/Holdout split WAJIB stratified terhadap distribusi kelas
//     target.
//   - K-fold WAJIB stratified juga.
//   - Seed Mersenne Twister, jika diaktifkan, dipakai konsisten untuk
//     SELURUH operasi acak run tersebut (shuffling sebelum stratified
//     split, assignment fold pada k-fold) — karena itu keduanya dibangun
//     di atas `MersenneTwister` yang sama (`stats/mersenne_twister.rs`).
//
// Keputusan konkret Fase 11 — "peringatan vs blokir keras" untuk folds
// berlebih (AGENTS.md §4.2/§5.5 sengaja hanya bilang "maksimum tidak
// dipatok angka tetap... peringatan bila dilampaui... tetap harus ada
// validasi yang menahan submit bila nilai jelas tidak mungkin
// dieksekusi", tanpa angka pasti — diputuskan EKSPLISIT di sini, bukan
// ditebak diam-diam, sesuai instruksi tugas Fase 11):
//
//   - `folds < 1`                              -> BLOKIR KERAS (Err).
//     Tidak ada k-fold yang valid dengan jumlah fold nol/negatif.
//   - `folds > n_instance` (jumlah instance valid setelah preprocessing)
//                                               -> BLOKIR KERAS (Err).
//     Ini kasus "jelas tidak mungkin dieksekusi" yang disebut AGENTS.md:
//     kalau fold lebih banyak dari instance, pasti ada fold yang sama
//     sekali kosong (tidak mendapat satu instance pun untuk dites),
//     sehingga metrik evaluasi dari fold itu tidak terdefinisi.
//   - `n_kelas_terkecil < folds <= n_instance`  -> PERINGATAN, boleh
//     lanjut. Assignment tetap bisa dijalankan (fold masih terisi dari
//     kelas-kelas lain), hanya saja kelas terkecil tidak bisa hadir di
//     setiap fold sehingga distribusi kelas antar-fold tidak sempurna
//     merata. Ini bukan kegagalan teknis, hanya kualitas stratifikasi
//     yang menurun — pengguna diberi tahu, bukan diblokir.
//   - `folds <= n_kelas_terkecil`               -> tidak ada peringatan,
//     kondisi ideal (setiap kelas, termasuk yang terkecil, punya potensi
//     hadir di setiap fold).
//
// Peringatan/error di atas dikembalikan sebagai `Result`/`Option<String>`
// terstruktur di sini; pemetaan ke `get_all_errors()` WASM (daftar
// error/warning yang dikembalikan ke JS) adalah pekerjaan Fase 16 — file
// ini sengaja TIDAK menyentuh `wasm/` (di luar cakupan step Fase 10/11).

use std::collections::HashMap;

use super::mersenne_twister::seeded_rng;

/// Konversi seed dari kontrak UI (`RandomSeed: number | null`, dikirim ke
/// Rust sebagai `Option<i64>` lewat `ValidationConfig::random_seed`, lihat
/// `models/config.rs`) menjadi `Option<u32>` yang dipakai
/// `MersenneTwister`. Rentang seed yang valid dari UI sudah dibatasi
/// 0..=4294967295 (AGENTS.md §4.2, batas `u32`), jadi truncation di sini
/// murni representasi tipe, bukan perubahan rentang nilai.
fn to_u32_seed(seed: Option<i64>) -> Option<u32> {
    seed.map(|s| s.clamp(0, u32::MAX as i64) as u32)
}

fn group_indices_by_class(class_labels: &[String]) -> HashMap<&str, Vec<usize>> {
    let mut groups: HashMap<&str, Vec<usize>> = HashMap::new();
    for (idx, label) in class_labels.iter().enumerate() {
        groups.entry(label.as_str()).or_default().push(idx);
    }
    groups
}

fn sorted_class_names<'a>(groups: &HashMap<&'a str, Vec<usize>>) -> Vec<&'a str> {
    // Urutan kelas deterministik (bukan urutan iterasi HashMap, yang tidak
    // stabil) supaya hasil split/fold dengan seed yang sama selalu identik
    // run-ke-run.
    let mut names: Vec<&str> = groups.keys().copied().collect();
    names.sort_unstable();
    names
}

fn smallest_class_size(class_labels: &[String]) -> usize {
    let groups = group_indices_by_class(class_labels);
    groups.values().map(Vec::len).min().unwrap_or(0)
}

// -------------------- Fase 10: Stratified train/holdout split ----------

/// Hasil stratified train/holdout split: indeks baris (sejajar dengan
/// `PreprocessedData::cases`) untuk masing-masing partisi, terurut naik
/// supaya output deterministik/gampang dibandingkan di test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HoldoutSplit {
    pub training_indices: Vec<usize>,
    pub holdout_indices: Vec<usize>,
}

/// Stratified split training/holdout (AGENTS.md §5.5, §4.2): setiap kelas
/// diacak lalu dibagi terpisah sesuai `training_percent`, supaya proporsi
/// kelas di training maupun holdout tetap mendekati proporsi keseluruhan
/// dataset — bukan random split polos terhadap seluruh baris sekaligus
/// (yang bisa membuat kelas minoritas hilang sama sekali dari salah satu
/// partisi secara kebetulan).
///
/// `class_labels` = label kelas target per baris, index sejajar dengan
/// `PreprocessedData::cases`. `training_percent` (kontrak UI:
/// `TrainingPercentage`, rentang 1..=99, AGENTS.md §4.2) di-clamp ke
/// `[0, 100]` di sini sebagai pengaman lapis kedua. `seed` `Some(..)` ->
/// hasil deterministik untuk seed yang sama (dipakai saat `SetSeed`
/// dicentang); `None` -> RNG memakai entropi sistem (lihat
/// `mersenne_twister::seeded_rng`).
pub fn stratified_train_holdout_split(
    class_labels: &[String],
    training_percent: i32,
    seed: Option<i64>,
) -> HoldoutSplit {
    if class_labels.is_empty() {
        return HoldoutSplit {
            training_indices: Vec::new(),
            holdout_indices: Vec::new(),
        };
    }

    let training_ratio = training_percent.clamp(0, 100) as f64 / 100.0;
    let mut rng = seeded_rng(to_u32_seed(seed));

    let groups = group_indices_by_class(class_labels);
    let class_names = sorted_class_names(&groups);

    let mut training_indices: Vec<usize> = Vec::with_capacity(class_labels.len());
    let mut holdout_indices: Vec<usize> = Vec::with_capacity(class_labels.len());

    for class_name in class_names {
        let mut indices = groups[class_name].clone();
        rng.shuffle(&mut indices);

        // Pembulatan terdekat (bukan selalu ke bawah/atas) supaya proporsi
        // per kelas sedekat mungkin ke `training_percent`, termasuk untuk
        // kelas kecil (mis. 3 instance @ 70% -> round(2.1) = 2 training, 1
        // holdout, bukan floor(2.1) = 2 juga kebetulan sama, tapi untuk
        // kasus seperti 70% dari 1 instance round -> 1 training, 0 holdout,
        // sedangkan floor akan memberi 0 training).
        let n_train = ((indices.len() as f64) * training_ratio).round() as usize;
        let n_train = n_train.min(indices.len());

        let (train_part, holdout_part) = indices.split_at(n_train);
        training_indices.extend_from_slice(train_part);
        holdout_indices.extend_from_slice(holdout_part);
    }

    training_indices.sort_unstable();
    holdout_indices.sort_unstable();

    HoldoutSplit {
        training_indices,
        holdout_indices,
    }
}

// -------------------- Fase 11: Stratified K-Fold ------------------------

/// Hasil stratified k-fold assignment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StratifiedKFold {
    /// `folds[f]` = indeks baris (sejajar `PreprocessedData::cases`) yang
    /// masuk fold ke-`f` sebagai data uji saat giliran fold itu; sisanya
    /// (union fold lain) jadi training untuk fold tsb — lihat
    /// `training_test_split_for_fold`.
    pub folds: Vec<Vec<usize>>,
    /// Peringatan non-fatal (lihat komentar keputusan di kepala file) —
    /// `Some(..)` ketika `folds` melebihi jumlah anggota kelas terkecil
    /// tapi assignment tetap valid untuk dijalankan.
    pub warning: Option<String>,
}

/// Validasi jumlah fold TANPA menjalankan assignment — dipisah dari
/// `stratified_k_fold` supaya caller (mis. lapisan wasm/validasi di Fase
/// 16) bisa memeriksa validitas `Folds` secara independen bila perlu.
/// Aturan blokir vs peringatan: lihat komentar keputusan di kepala file.
pub fn validate_fold_count(
    folds: i32,
    n_instance: usize,
    smallest_class_size: usize,
) -> Result<Option<String>, String> {
    if folds < 1 {
        return Err(format!(
            "Number of folds must be at least 1 (got {}).",
            folds
        ));
    }

    if n_instance == 0 {
        return Err(
            "Cannot create cross-validation folds: there are no valid instances after missing-value handling.".to_string(),
        );
    }

    let folds = folds as usize;

    if folds > n_instance {
        return Err(format!(
            "Number of folds ({}) cannot be greater than the number of valid instances ({}). Choose a smaller number of folds.",
            folds, n_instance
        ));
    }

    if folds > smallest_class_size {
        return Ok(Some(format!(
            "Number of folds ({}) exceeds the smallest class size ({}). Some folds will not contain any instance of that class, so class proportions across folds will not be perfectly balanced. The analysis will still run.",
            folds, smallest_class_size
        )));
    }

    Ok(None)
}

/// Stratified k-fold assignment (AGENTS.md §5.5): tiap kelas diacak lalu
/// dibagi round-robin ke `folds` bucket (pendekatan umum, setara
/// `StratifiedKFold` scikit-learn), supaya proporsi kelas di tiap fold
/// sedekat mungkin dengan proporsi keseluruhan dataset.
///
/// Mengembalikan `Err` untuk kondisi blokir-keras (lihat
/// `validate_fold_count`); mengembalikan `Ok` dengan `warning: Some(..)`
/// untuk kondisi peringatan-boleh-lanjut.
pub fn stratified_k_fold(
    class_labels: &[String],
    folds: i32,
    seed: Option<i64>,
) -> Result<StratifiedKFold, String> {
    let n_instance = class_labels.len();
    let smallest = smallest_class_size(class_labels);

    let warning = validate_fold_count(folds, n_instance, smallest)?;
    let folds_count = folds as usize;

    let mut rng = seeded_rng(to_u32_seed(seed));
    let mut fold_buckets: Vec<Vec<usize>> = vec![Vec::new(); folds_count];

    let groups = group_indices_by_class(class_labels);
    let class_names = sorted_class_names(&groups);

    for class_name in class_names {
        let mut indices = groups[class_name].clone();
        rng.shuffle(&mut indices);

        for (offset, case_idx) in indices.into_iter().enumerate() {
            let fold_idx = offset % folds_count;
            fold_buckets[fold_idx].push(case_idx);
        }
    }

    for bucket in &mut fold_buckets {
        bucket.sort_unstable();
    }

    Ok(StratifiedKFold {
        folds: fold_buckets,
        warning,
    })
}

/// Bangun pasangan `(training_indices, test_indices)` untuk fold ke-
/// `fold_idx` dari hasil `stratified_k_fold` — dipakai oleh training loop
/// k-fold (Fase 12+) supaya logika "semua indeks kecuali fold ini jadi
/// training" tidak ditulis ulang di tempat lain.
pub fn training_test_split_for_fold(
    folds: &[Vec<usize>],
    fold_idx: usize,
) -> (Vec<usize>, Vec<usize>) {
    let test_indices = folds.get(fold_idx).cloned().unwrap_or_default();
    let mut training_indices: Vec<usize> = folds
        .iter()
        .enumerate()
        .filter(|(idx, _)| *idx != fold_idx)
        .flat_map(|(_, bucket)| bucket.iter().copied())
        .collect();
    training_indices.sort_unstable();
    (training_indices, test_indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(spec: &[(&str, usize)]) -> Vec<String> {
        let mut out = Vec::new();
        for (class, count) in spec {
            for _ in 0..*count {
                out.push(class.to_string());
            }
        }
        out
    }

    fn class_of<'a>(idx: usize, labels: &'a [String]) -> &'a str {
        labels[idx].as_str()
    }

    // ---------------- stratified_train_holdout_split ----------------

    #[test]
    fn holdout_split_keeps_class_proportions_close_to_overall() {
        // 100 instance, dua kelas dengan proporsi 80/20 — training 70%.
        let class_labels = labels(&[("A", 80), ("B", 20)]);

        let split = stratified_train_holdout_split(&class_labels, 70, Some(42));

        let train_a = split
            .training_indices
            .iter()
            .filter(|&&i| class_of(i, &class_labels) == "A")
            .count();
        let train_b = split
            .training_indices
            .iter()
            .filter(|&&i| class_of(i, &class_labels) == "B")
            .count();

        // Stratified: masing-masing kelas ~70% masuk training (56 dari 80,
        // 14 dari 20), bukan proporsi acak yang bisa jomplang.
        assert_eq!(train_a, 56);
        assert_eq!(train_b, 14);
        assert_eq!(split.training_indices.len(), 70);
        assert_eq!(split.holdout_indices.len(), 30);
    }

    #[test]
    fn holdout_split_covers_every_index_exactly_once() {
        let class_labels = labels(&[("A", 37), ("B", 13), ("C", 5)]);
        let split = stratified_train_holdout_split(&class_labels, 65, Some(7));

        let mut all: Vec<usize> = split
            .training_indices
            .iter()
            .chain(split.holdout_indices.iter())
            .copied()
            .collect();
        all.sort_unstable();

        assert_eq!(all, (0..class_labels.len()).collect::<Vec<_>>());
    }

    #[test]
    fn holdout_split_same_seed_is_deterministic() {
        let class_labels = labels(&[("A", 40), ("B", 40), ("C", 20)]);

        let first = stratified_train_holdout_split(&class_labels, 70, Some(2024));
        let second = stratified_train_holdout_split(&class_labels, 70, Some(2024));

        assert_eq!(first, second);
    }

    #[test]
    fn holdout_split_different_seed_gives_different_assignment() {
        let class_labels = labels(&[("A", 40), ("B", 40), ("C", 20)]);

        let first = stratified_train_holdout_split(&class_labels, 70, Some(1));
        let second = stratified_train_holdout_split(&class_labels, 70, Some(2));

        assert_ne!(first, second);
    }

    #[test]
    fn holdout_split_handles_empty_input() {
        let split = stratified_train_holdout_split(&[], 70, Some(1));
        assert!(split.training_indices.is_empty());
        assert!(split.holdout_indices.is_empty());
    }

    #[test]
    fn holdout_split_clamps_out_of_range_training_percent() {
        let class_labels = labels(&[("A", 5), ("B", 5)]);

        let all_train = stratified_train_holdout_split(&class_labels, 150, Some(1));
        assert_eq!(all_train.training_indices.len(), 10);
        assert!(all_train.holdout_indices.is_empty());

        let all_holdout = stratified_train_holdout_split(&class_labels, -20, Some(1));
        assert!(all_holdout.training_indices.is_empty());
        assert_eq!(all_holdout.holdout_indices.len(), 10);
    }

    // ---------------- validate_fold_count (keputusan Fase 11) ----------------

    #[test]
    fn folds_less_than_one_is_hard_blocked() {
        let result = validate_fold_count(0, 100, 20);
        assert!(result.is_err());

        let result_negative = validate_fold_count(-3, 100, 20);
        assert!(result_negative.is_err());
    }

    #[test]
    fn folds_exceeding_instance_count_is_hard_blocked() {
        let result = validate_fold_count(15, 10, 3);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cannot be greater"));
    }

    #[test]
    fn folds_exceeding_smallest_class_but_within_instance_count_is_warning_only() {
        // 10 instance, smallest class size 3, folds = 5 (<=10 instance,
        // >3 smallest class) -> boleh lanjut dengan peringatan.
        let result = validate_fold_count(5, 10, 3);
        assert!(result.is_ok());
        let warning = result.unwrap();
        assert!(warning.is_some());
        assert!(warning.unwrap().contains("exceeds the smallest class size"));
    }

    #[test]
    fn folds_within_smallest_class_size_has_no_warning() {
        let result = validate_fold_count(3, 10, 5);
        assert_eq!(result, Ok(None));
    }

    #[test]
    fn zero_instances_is_hard_blocked() {
        let result = validate_fold_count(5, 0, 0);
        assert!(result.is_err());
    }

    // ---------------- stratified_k_fold ----------------

    #[test]
    fn k_fold_partitions_every_index_exactly_once_across_folds() {
        let class_labels = labels(&[("A", 23), ("B", 17), ("C", 10)]);
        let result = stratified_k_fold(&class_labels, 5, Some(11)).expect("should succeed");

        let mut all: Vec<usize> = result.folds.iter().flatten().copied().collect();
        all.sort_unstable();
        assert_eq!(all, (0..class_labels.len()).collect::<Vec<_>>());
        assert_eq!(result.folds.len(), 5);
    }

    #[test]
    fn k_fold_keeps_per_fold_class_counts_balanced_when_folds_within_smallest_class() {
        // 3 kelas dengan 20 instance masing-masing, 5 folds (smallest
        // class 20 >= 5 folds) -> setiap fold harus dapat tepat 4 dari
        // tiap kelas (20 / 5 = 4, pas tanpa sisa).
        let class_labels = labels(&[("A", 20), ("B", 20), ("C", 20)]);
        let result = stratified_k_fold(&class_labels, 5, Some(99)).expect("should succeed");

        assert!(result.warning.is_none());

        for bucket in &result.folds {
            let count_a = bucket.iter().filter(|&&i| class_of(i, &class_labels) == "A").count();
            let count_b = bucket.iter().filter(|&&i| class_of(i, &class_labels) == "B").count();
            let count_c = bucket.iter().filter(|&&i| class_of(i, &class_labels) == "C").count();
            assert_eq!(count_a, 4);
            assert_eq!(count_b, 4);
            assert_eq!(count_c, 4);
        }
    }

    #[test]
    fn k_fold_returns_warning_but_still_runs_when_folds_exceed_smallest_class() {
        // Kelas C hanya 2 instance, folds = 5 -> smallest class (2) < folds
        // (5) <= n_instance (42) -> warning, tapi tetap assign folds valid.
        let class_labels = labels(&[("A", 20), ("B", 20), ("C", 2)]);
        let result = stratified_k_fold(&class_labels, 5, Some(3)).expect("should still succeed");

        assert!(result.warning.is_some());
        assert_eq!(result.folds.len(), 5);

        let mut all: Vec<usize> = result.folds.iter().flatten().copied().collect();
        all.sort_unstable();
        assert_eq!(all, (0..class_labels.len()).collect::<Vec<_>>());

        // Kelas C (2 instance) tidak mungkin hadir di semua 5 fold.
        let folds_with_c = result
            .folds
            .iter()
            .filter(|bucket| bucket.iter().any(|&i| class_of(i, &class_labels) == "C"))
            .count();
        assert!(folds_with_c <= 2);
    }

    #[test]
    fn k_fold_hard_blocks_when_folds_exceed_instance_count() {
        let class_labels = labels(&[("A", 3), ("B", 3)]);
        let result = stratified_k_fold(&class_labels, 10, Some(1));
        assert!(result.is_err());
    }

    #[test]
    fn k_fold_same_seed_is_deterministic() {
        let class_labels = labels(&[("A", 15), ("B", 15), ("C", 15)]);
        let first = stratified_k_fold(&class_labels, 4, Some(555)).unwrap();
        let second = stratified_k_fold(&class_labels, 4, Some(555)).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn k_fold_different_seed_gives_different_assignment() {
        let class_labels = labels(&[("A", 15), ("B", 15), ("C", 15)]);
        let first = stratified_k_fold(&class_labels, 4, Some(1)).unwrap();
        let second = stratified_k_fold(&class_labels, 4, Some(2)).unwrap();
        assert_ne!(first.folds, second.folds);
    }

    #[test]
    fn training_test_split_for_fold_excludes_only_that_fold() {
        let folds = vec![vec![0, 1], vec![2, 3], vec![4, 5]];
        let (train, test) = training_test_split_for_fold(&folds, 1);

        assert_eq!(test, vec![2, 3]);
        assert_eq!(train, vec![0, 1, 4, 5]);
    }
}
