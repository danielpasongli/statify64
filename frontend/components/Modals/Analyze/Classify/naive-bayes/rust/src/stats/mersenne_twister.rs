// naive-bayes/rust/src/stats/mersenne_twister.rs
//
// PLAN.md Fase 10 — "Stratified split + Mersenne Twister".
//
// RNG ditulis ulang DI DALAM crate `naive-bayes` sendiri: implementasi
// MT19937 (Matsumoto & Nishimura, 1998) standar 32-bit, murni Rust, TANPA
// bergantung pada crate `rand_mt` maupun mengimpor/mem-share kode dari
// crate `nearest-neighbor` (AGENTS.md §7: repo ini memang tidak punya
// shared stats crate antar modul Classify — tiap crate berdiri sendiri,
// PLAN.md §1 "Rust crate independen"). Fallback sumber entropi ketika
// pengguna tidak mengaktifkan "Set Seed" (lihat `seeded_rng`/
// `entropy_seed`) SENGAJA tidak menambah dependency baru (`rand`/
// `getrandom`): memakai `js_sys::Math::random()` (js-sys sudah jadi
// dependency sejak Fase 8) di target `wasm32`, dan `std::time`/
// `std::hash` bawaan Rust di target native (dipakai saat `cargo test`).
//
// Seed ini dipakai konsisten untuk SEMUA operasi acak pada satu run
// (AGENTS.md §4.2 & §5.5): shuffle sebelum stratified train/holdout split,
// dan assignment fold pada stratified k-fold (lihat `stats/partition.rs`).

const N: usize = 624;
const M: usize = 397;
const MATRIX_A: u32 = 0x9908_b0df;
const UPPER_MASK: u32 = 0x8000_0000;
const LOWER_MASK: u32 = 0x7fff_ffff;

/// RNG Mersenne Twister (MT19937), seeded dengan satu `u32` — mengikuti
/// rentang seed yang sudah dipakai UI Naive Bayes (0..=4294967295, batas
/// `u32`, AGENTS.md §4.2, identik dengan konvensi KNN).
#[derive(Debug, Clone)]
pub struct MersenneTwister {
    state: [u32; N],
    index: usize,
}

impl MersenneTwister {
    /// Inisialisasi state internal dari satu seed `u32`, mengikuti skema
    /// inisialisasi referensi MT19937 (Knuth's PRNG generator digunakan
    /// untuk mengisi state awal dari seed tunggal).
    pub fn new(seed: u32) -> Self {
        let mut state = [0u32; N];
        state[0] = seed;
        for i in 1..N {
            state[i] = 1_812_433_253u32
                .wrapping_mul(state[i - 1] ^ (state[i - 1] >> 30))
                .wrapping_add(i as u32);
        }
        MersenneTwister { state, index: N }
    }

    /// Regenerasi seluruh 624-word state (dipanggil otomatis begitu semua
    /// output dari batch sebelumnya sudah dikonsumsi).
    fn generate(&mut self) {
        for i in 0..N {
            let y = (self.state[i] & UPPER_MASK) | (self.state[(i + 1) % N] & LOWER_MASK);
            let mut next = self.state[(i + M) % N] ^ (y >> 1);
            if y & 1 != 0 {
                next ^= MATRIX_A;
            }
            self.state[i] = next;
        }
        self.index = 0;
    }

    /// Ambil `u32` pseudo-random berikutnya (dengan tempering standar
    /// MT19937).
    pub fn next_u32(&mut self) -> u32 {
        if self.index >= N {
            self.generate();
        }
        let mut y = self.state[self.index];
        self.index += 1;

        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c_5680;
        y ^= (y << 15) & 0xefc6_0000;
        y ^= y >> 18;
        y
    }

    /// Nilai uniform di `[0, 1)`, dipakai bila nanti dibutuhkan sampling
    /// probabilistik (bukan dipakai untuk shuffle — shuffle memakai
    /// `next_below`/`shuffle` di bawah, yang bebas modulo-bias).
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u32() as f64) / (u32::MAX as f64 + 1.0)
    }

    /// Integer uniform di `[0, bound)` lewat rejection sampling, supaya
    /// tidak ada modulo bias (dipakai oleh `shuffle` di bawah).
    pub fn next_below(&mut self, bound: usize) -> usize {
        if bound <= 1 {
            return 0;
        }

        let bound_u64 = bound as u64;
        let range = u32::MAX as u64 + 1;
        let limit = range - (range % bound_u64);

        loop {
            let v = self.next_u32() as u64;
            if v < limit {
                return (v % bound_u64) as usize;
            }
        }
    }

    /// Fisher-Yates shuffle in-place — dipakai untuk mengacak urutan
    /// instance per kelas sebelum stratified split/fold assignment
    /// (`stats/partition.rs`).
    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.next_below(i + 1);
            items.swap(i, j);
        }
    }
}

/// Seed fallback ketika pengguna TIDAK mencentang "Set Seed" (AGENTS.md
/// §4.2: run tetap harus jalan, hanya saja tidak reproducible). Di target
/// `wasm32` (build produksi lewat `wasm-pack`) memakai `js_sys::Math::
/// random()` — sumber entropi JS yang sudah tersedia lewat dependency
/// `js-sys` yang ada sejak Fase 8, tanpa perlu crate `getrandom`/`rand`
/// tambahan. Di target lain (native, dipakai saat `cargo test`) memakai
/// jam sistem (`std::time::SystemTime`) di-hash lewat `DefaultHasher` bawaan
/// `std::hash` — cukup untuk fallback non-deterministik, TIDAK dipakai
/// untuk keperluan kriptografis.
fn entropy_seed() -> u32 {
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Math::random() * (u32::MAX as f64 + 1.0)) as u32
    }

    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        use std::time::{SystemTime, UNIX_EPOCH};

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);

        let mut hasher = DefaultHasher::new();
        nanos.hash(&mut hasher);
        // Alamat sebuah nilai lokal ikut di-hash supaya dua pemanggilan
        // yang sangat berdekatan waktu (mis. dalam loop test yang sama)
        // tetap cenderung menghasilkan seed berbeda.
        let local = 0u8;
        (&local as *const u8 as usize).hash(&mut hasher);

        hasher.finish() as u32
    }
}

/// Bangun RNG dari seed opsional. `Some(seed)` -> deterministik (dipakai
/// saat pengguna mencentang "Set Seed"). `None` -> seed diambil dari
/// `entropy_seed()` di atas — hasil tetap tidak deterministik antar run,
/// sesuai perilaku "Set Seed" tidak dicentang di AGENTS.md §4.2.
pub fn seeded_rng(seed: Option<u32>) -> MersenneTwister {
    let seed = seed.unwrap_or_else(entropy_seed);
    MersenneTwister::new(seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_produces_identical_sequence() {
        let mut a = MersenneTwister::new(1234);
        let mut b = MersenneTwister::new(1234);

        let seq_a: Vec<u32> = (0..50).map(|_| a.next_u32()).collect();
        let seq_b: Vec<u32> = (0..50).map(|_| b.next_u32()).collect();

        assert_eq!(seq_a, seq_b);
    }

    #[test]
    fn different_seed_produces_different_sequence() {
        let mut a = MersenneTwister::new(1234);
        let mut b = MersenneTwister::new(5678);

        let seq_a: Vec<u32> = (0..50).map(|_| a.next_u32()).collect();
        let seq_b: Vec<u32> = (0..50).map(|_| b.next_u32()).collect();

        assert_ne!(seq_a, seq_b);
    }

    #[test]
    fn known_seed_matches_reference_mt19937_output() {
        // Nilai referensi standar MT19937 dengan seed 5489 (default seed
        // klasik dari makalah asli Matsumoto & Nishimura), dicocokkan
        // terhadap implementasi referensi C mt19937ar.c: output pertama
        // untuk seed 5489 adalah 3499211612 (diverifikasi ulang lewat
        // simulasi algoritma yang sama di Python sebelum ditulis di sini).
        let mut rng = MersenneTwister::new(5489);
        assert_eq!(rng.next_u32(), 3_499_211_612);
    }

    #[test]
    fn shuffle_is_a_permutation_not_a_resample() {
        let mut rng = MersenneTwister::new(42);
        let mut items: Vec<usize> = (0..20).collect();
        rng.shuffle(&mut items);

        let mut sorted = items.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..20).collect::<Vec<_>>());
    }

    #[test]
    fn shuffle_with_same_seed_is_deterministic() {
        let mut items_a: Vec<usize> = (0..20).collect();
        let mut items_b: Vec<usize> = (0..20).collect();

        MersenneTwister::new(777).shuffle(&mut items_a);
        MersenneTwister::new(777).shuffle(&mut items_b);

        assert_eq!(items_a, items_b);
    }

    #[test]
    fn next_below_stays_within_bound_and_covers_range() {
        let mut rng = MersenneTwister::new(99);
        let mut seen = [false; 5];
        for _ in 0..2000 {
            let v = rng.next_below(5);
            assert!(v < 5);
            seen[v] = true;
        }
        assert!(seen.iter().all(|&s| s), "expected all 5 values to appear across 2000 draws");
    }

    #[test]
    fn next_below_zero_or_one_always_returns_zero() {
        let mut rng = MersenneTwister::new(1);
        assert_eq!(rng.next_below(0), 0);
        assert_eq!(rng.next_below(1), 0);
    }

    #[test]
    fn seeded_rng_with_explicit_seed_is_deterministic() {
        let mut a = seeded_rng(Some(4242));
        let mut b = seeded_rng(Some(4242));
        assert_eq!(a.next_u32(), b.next_u32());
    }

    #[test]
    fn seeded_rng_without_seed_does_not_panic_and_still_produces_values() {
        // Kasus "Set Seed" tidak dicentang (AGENTS.md §4.2): tidak boleh
        // panic, dan harus tetap menghasilkan urutan angka yang valid.
        let mut rng = seeded_rng(None);
        let _ = rng.next_u32();
        let _ = rng.next_f64();
    }
}
