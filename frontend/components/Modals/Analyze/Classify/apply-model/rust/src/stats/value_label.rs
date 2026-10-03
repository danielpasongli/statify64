// Normalisasi nilai sel (AGENTS.md §5.3) — PLAN.md Fase 7 langkah 1.
//
// SALINAN dari `naive-bayes/rust/src/stats/preprocess_data.rs`:
//   - baris 28      : `MISSING_CATEGORY_LABEL`
//   - baris 224-252 : `is_missing_value`, `data_value_to_label`,
//                     `format_number_label`
//   - baris 113-117 : aturan nilai numerik (hanya `Number` finite) ->
//                     dibungkus sebagai `numeric_value` (tambahan Apply Model)
// Tanggal salin: 2026-10-02. Logika identik; jangan "diperbaiki" di sini
// tanpa merevisi `../../../AGENTS.md` (prinsip P4: konsistensi dengan NB).
//
// Nilai dari TS sudah melewati `parseCellValue` persis seperti saat training
// NB — JANGAN mem-parse ulang di Rust.
use crate::models::data::DataValue;

pub const MISSING_CATEGORY_LABEL: &str = "(Missing)";

/// Definisi missing: `Null`, teks kosong (setelah di-trim), atau angka
/// non-finite (NaN/Inf). `Boolean` tidak pernah missing.
pub fn is_missing_value(value: &DataValue) -> bool {
    match value {
        DataValue::Null => true,
        DataValue::Text(s) => s.trim().is_empty(),
        DataValue::Number(n) => !n.is_finite(),
        DataValue::Boolean(_) => false,
    }
}

/// Stringify nilai jadi label kategori/kelas. Angka bulat dirender tanpa
/// desimal (`1.0` -> `"1"`).
pub fn data_value_to_label(value: &DataValue) -> String {
    match value {
        DataValue::Text(s) => s.trim().to_string(),
        DataValue::Number(n) => format_number_label(*n),
        DataValue::Boolean(b) => b.to_string(),
        DataValue::Null => MISSING_CATEGORY_LABEL.to_string(),
    }
}

pub fn format_number_label(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

/// Nilai numerik untuk fitur numerical: hanya `Number(n)` dengan
/// `n.is_finite()`; selain itu dianggap missing (AGENTS.md §5.3, sama dengan
/// `preprocess_data.rs:113-117`).
pub fn numeric_value(value: &DataValue) -> Option<f64> {
    match value {
        DataValue::Number(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_value_to_label_number_integer_has_no_decimal() {
        assert_eq!(data_value_to_label(&DataValue::Number(1.0)), "1");
        assert_eq!(data_value_to_label(&DataValue::Number(-3.0)), "-3");
    }

    #[test]
    fn data_value_to_label_number_fraction_kept() {
        assert_eq!(data_value_to_label(&DataValue::Number(1.5)), "1.5");
    }

    #[test]
    fn data_value_to_label_text_is_trimmed() {
        assert_eq!(
            data_value_to_label(&DataValue::Text(" Sunny ".to_string())),
            "Sunny"
        );
    }

    #[test]
    fn data_value_to_label_boolean_and_null() {
        assert_eq!(data_value_to_label(&DataValue::Boolean(true)), "true");
        assert_eq!(data_value_to_label(&DataValue::Boolean(false)), "false");
        assert_eq!(data_value_to_label(&DataValue::Null), MISSING_CATEGORY_LABEL);
        assert_eq!(MISSING_CATEGORY_LABEL, "(Missing)");
    }

    #[test]
    fn is_missing_value_cases() {
        assert!(is_missing_value(&DataValue::Null));
        assert!(is_missing_value(&DataValue::Text("  ".to_string())));
        assert!(is_missing_value(&DataValue::Text(String::new())));
        assert!(is_missing_value(&DataValue::Number(f64::NAN)));
        assert!(is_missing_value(&DataValue::Number(f64::INFINITY)));
        assert!(!is_missing_value(&DataValue::Number(0.0)));
        assert!(!is_missing_value(&DataValue::Text("a".to_string())));
        assert!(!is_missing_value(&DataValue::Boolean(false)));
    }

    #[test]
    fn numeric_value_only_finite_numbers() {
        assert_eq!(numeric_value(&DataValue::Number(85.0)), Some(85.0));
        assert_eq!(numeric_value(&DataValue::Number(f64::NAN)), None);
        assert_eq!(numeric_value(&DataValue::Number(f64::INFINITY)), None);
        assert_eq!(numeric_value(&DataValue::Text("85".to_string())), None);
        assert_eq!(numeric_value(&DataValue::Boolean(true)), None);
        assert_eq!(numeric_value(&DataValue::Null), None);
    }
}
