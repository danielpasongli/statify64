// Pengumpul error lintas fungsi — disalin persis dari pola
// `nearest-neighbor/rust/src/utils/error.rs` supaya `get_all_errors()` di
// wasm binding berperilaku sama (mengembalikan "No errors occurred." saat
// kosong, atau ringkasan per-context saat ada error).
use std::collections::HashMap;

pub type AnalysisResult<T> = Result<T, String>;

#[derive(Debug, Clone, Default)]
pub struct ErrorCollector {
    errors: HashMap<String, Vec<String>>,
}

impl ErrorCollector {
    pub fn add_error(&mut self, context: &str, message: &str) {
        let entry = self.errors.entry(context.to_string()).or_default();
        entry.push(message.to_string());
    }

    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    pub fn get_error_summary(&self) -> String {
        if !self.has_errors() {
            return "No errors occurred.".to_string();
        }

        let mut summary = String::from("Error Summary:\n");
        for (context, errors) in &self.errors {
            summary.push_str(&format!("Context: {}\n", context));
            for (i, error) in errors.iter().enumerate() {
                summary.push_str(&format!("  {}. {}\n", i + 1, error));
            }
        }

        summary
    }

    pub fn clear(&mut self) {
        self.errors.clear();
    }
}
