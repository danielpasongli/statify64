use std::collections::HashMap;

/// Errors and warnings of one analysis, grouped by the context that raised them.
#[derive(Debug, Clone, Default)]
pub struct ErrorCollector {
    errors: HashMap<String, Vec<String>>,
}

impl ErrorCollector {
    /// Record a message under `context`.
    pub fn add_error(&mut self, context: &str, message: &str) {
        let entry = self.errors.entry(context.to_string()).or_insert_with(Vec::new);
        entry.push(message.to_string());
    }

    /// True when any message was recorded.
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    /// Every recorded message as text, grouped by context.
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

    /// Remove every recorded message.
    pub fn clear(&mut self) {
        self.errors.clear();
    }
}
