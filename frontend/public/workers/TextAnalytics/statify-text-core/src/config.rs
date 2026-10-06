use crate::error::TextError;
use serde::{Deserialize, Serialize};

/// Metode stopwords. Nilai di luar daftar ditolak (INVALID_CONFIG), tidak ada fallback diam-diam.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StopwordsMethod {
    None,
    Indonesian,
    English,
    Custom,
}

/// Metode stemming.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StemmingMethod {
    None,
    Indonesian,
    English,
}

/// Standar rumus (preset). Menentukan kombinasi TF/IDF/normalisasi yang sah (Fase S3, §3.1)
/// dan cara merangking kosakata untuk Words to Keep (§3.2 langkah 3).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FormulaStandard {
    #[default]
    Weka,
    Sklearn,
    Custom,
}

impl FormulaStandard {
    /// Nama snake_case (sama dengan nilai JSON) untuk `stats.formula_standard`.
    pub fn as_str(&self) -> &'static str {
        match self {
            FormulaStandard::Weka => "weka",
            FormulaStandard::Sklearn => "sklearn",
            FormulaStandard::Custom => "custom",
        }
    }
}

/// Metode TF. Alias nilai lama: "none" → Binary, "log" → Sublinear (1 + ln f).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TfMethod {
    #[serde(alias = "none")]
    Binary,
    Raw,
    /// ln(1 + f) — TFTransform Weka.
    Log1p,
    /// 1 + ln(f) — sklearn `sublinear_tf`. Alias lama: "log".
    #[serde(alias = "log")]
    Sublinear,
    Normalized,
}

impl TfMethod {
    /// Nama snake_case (sama dengan nilai JSON) untuk `stats.method` (§3.5).
    pub fn as_str(&self) -> &'static str {
        match self {
            TfMethod::Binary => "binary",
            TfMethod::Raw => "raw",
            TfMethod::Log1p => "log1p",
            TfMethod::Sublinear => "sublinear",
            TfMethod::Normalized => "normalized",
        }
    }

    /// Label teks untuk `stats.method`. Sublinear tetap berlabel "log" (label v1);
    /// format `method` baru ditetapkan di Fase S3 (§3.5).
    pub fn v1_label(&self) -> &'static str {
        match self {
            TfMethod::Binary => "binary",
            TfMethod::Raw => "raw",
            TfMethod::Log1p => "log1p",
            TfMethod::Sublinear => "log",
            TfMethod::Normalized => "normalized",
        }
    }
}

/// Metode IDF. Alias nilai lama: "idf" → Standard.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IdfMethod {
    None,
    /// ln(N / df). Alias lama: "idf".
    #[serde(alias = "idf")]
    Standard,
    /// ln((1+N)/(1+df)) + 1
    Smooth,
    /// ln(N / df) + 1
    Plus1,
}

impl IdfMethod {
    /// Nama snake_case (sama dengan nilai JSON) untuk `stats.method` (§3.5).
    pub fn as_str(&self) -> &'static str {
        match self {
            IdfMethod::None => "none",
            IdfMethod::Standard => "standard",
            IdfMethod::Smooth => "smooth",
            IdfMethod::Plus1 => "plus1",
        }
    }

    /// Label teks untuk `stats.method` (label v1; lihat `TfMethod::v1_label`).
    pub fn v1_label(&self) -> &'static str {
        match self {
            IdfMethod::None => "none",
            IdfMethod::Standard => "idf",
            IdfMethod::Smooth => "smooth",
            IdfMethod::Plus1 => "plus1",
        }
    }
}

/// Normalisasi baris (Fase S3): l1, l2, atau doc_length (Weka normalizeDocLength).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum Normalization {
    #[default]
    None,
    L1,
    L2,
    DocLength,
}

impl Normalization {
    /// Nama snake_case (sama dengan nilai JSON) untuk `stats.method` (§3.5).
    pub fn as_str(&self) -> &'static str {
        match self {
            Normalization::None => "none",
            Normalization::L1 => "l1",
            Normalization::L2 => "l2",
            Normalization::DocLength => "doc_length",
        }
    }
}

fn one() -> usize {
    1
}

/// Konfigurasi vectorizer — harus cocok dengan objek JSON (snake_case) yang dikirim Web Worker.
///
/// Fase S2: metode berupa enum (nilai tak dikenal → INVALID_CONFIG) dengan alias nilai lama.
/// Field baru (formula_standard, normalization, min_term_freq) bersifat opsional (`serde(default)`)
/// sehingga JSON v1 tetap diterima; perilakunya diimplementasi di Fase S3 (vectorizer.rs).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct TextVectorizerConfig {
    pub lowercase: bool,
    /// "none" | "indonesian" | "english"
    pub stemming_method: StemmingMethod,
    /// "none" | "indonesian" | "english" | "custom"
    pub stopwords_method: StopwordsMethod,
    /// JSON string berisi array stopwords: "[\"ada\",\"adalah\",...]"
    pub custom_stopwords: Option<String>,
    /// Pola Regex untuk delimiter tokenizer, contoh: r"[\s\p{P}]+"
    pub delimiters: String,
    pub ngram_min: usize,
    pub ngram_max: usize,
    /// "weka" (default) | "sklearn" | "custom"
    #[serde(default)]
    pub formula_standard: FormulaStandard,
    /// "binary" | "raw" | "log1p" | "sublinear" | "normalized" (alias lama: "none", "log")
    pub tf_method: TfMethod,
    /// "none" | "standard" | "smooth" | "plus1" (alias lama: "idf")
    pub idf_method: IdfMethod,
    /// "none" (default) | "l1" | "l2" | "doc_length"
    #[serde(default)]
    pub normalization: Normalization,
    pub words_to_keep: usize,
    /// Minimum total kemunculan kata (>= 1). Default 1.
    #[serde(default = "one")]
    pub min_term_freq: usize,
}

impl TextVectorizerConfig {
    /// Parse konfigurasi dari nilai JSON. Nilai enum tak dikenal / field hilang → `INVALID_CONFIG`.
    pub fn from_json_value(value: serde_json::Value) -> Result<Self, TextError> {
        serde_json::from_value(value).map_err(|e| {
            TextError::new("INVALID_CONFIG", &format!("Failed to parse the text configuration: {}", e))
        })
    }

    /// Parse konfigurasi dari string JSON (lihat `from_json_value`).
    pub fn from_json_str(json: &str) -> Result<Self, TextError> {
        serde_json::from_str(json).map_err(|e| {
            TextError::new("INVALID_CONFIG", &format!("Failed to parse the text configuration: {}", e))
        })
    }
}
