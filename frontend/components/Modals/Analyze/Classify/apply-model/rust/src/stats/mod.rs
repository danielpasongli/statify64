// Sub-modul `stats/` — statistik pasca-scoring (distribusi, evaluasi, dsb.).
// Fase 7: `value_label` (normalisasi nilai sel, AGENTS.md §5.3).
// Fase 9: `posterior` (§5.5) dan `summary` (§5.7), keduanya generik.
// Fase 10: `classification_table` (salinan NB) dan `evaluation` (§5.7).
pub mod classification_table;
pub mod evaluation;
pub mod posterior;
pub mod summary;
pub mod value_label;
