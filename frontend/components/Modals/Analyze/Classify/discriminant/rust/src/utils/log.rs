/// Debug message to the browser console, e.g. `crate::debug_log!("Box M: {:?}", m)`.
///
/// Compiled only into debug WASM builds (`wasm-pack build --dev`). Release builds,
/// which the app ships, and native builds (unit tests) contain no console call and
/// never evaluate the arguments, so no text dump of the data is ever built. The
/// arguments are still type-checked in every build (inside a dead `if false`), so a
/// value used only in a log does not trigger unused-variable warnings.
#[macro_export]
macro_rules! debug_log {
    ($($arg:tt)*) => {{
        #[cfg(all(target_arch = "wasm32", debug_assertions))]
        {
            web_sys::console::log_1(&format!($($arg)*).into());
        }
        #[cfg(not(all(target_arch = "wasm32", debug_assertions)))]
        {
            if false {
                let _ = format!($($arg)*);
            }
        }
    }};
}

/// Names of the analysis steps that ran, in order.
#[derive(Debug, Clone, Default)]
pub struct FunctionLogger {
    executed_functions: Vec<String>,
}

impl FunctionLogger {
    /// Record that a step ran.
    pub fn add_log(&mut self, function_name: &str) {
        self.executed_functions.push(function_name.to_string());
    }

    /// The recorded step names, in order.
    pub fn get_executed_functions(&self) -> Vec<String> {
        self.executed_functions.clone()
    }
}
