// Tipe data mentah + definisi variabel, disalin persis dari
// `naive-bayes/rust/src/models/data.rs:10-111` (PLAN.md Fase 6 item 2,
// AGENTS.md §7.1). HANYA struct berikut yang disalin (tanpa
// `SlicedData`/`PreprocessedCase` yang spesifik NB): DataRecord, DataValue,
// ValueLabel, VariableType, VariableAlign, VariableMeasure, VariableRole,
// VariableDefinition. Jangan mengubah isi tanpa merevisi `../AGENTS.md`.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataRecord {
    #[serde(flatten)]
    pub values: HashMap<String, DataValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum DataValue {
    Number(f64),
    Text(String),
    Boolean(bool),
    Null,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ValueLabel {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i32>,
    pub variable_name: String,
    pub value: DataValue,
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum VariableType {
    Numeric,
    Comma,
    Dot,
    Scientific,
    Date,
    Adate,
    Edate,
    Sdate,
    Jdate,
    Qyr,
    Moyr,
    Wkyr,
    Datetime,
    Time,
    Dtime,
    Wkday,
    Month,
    Dollar,
    Cca,
    Ccb,
    Ccc,
    Ccd,
    Cce,
    String,
    #[serde(rename = "RESTRICTED_NUMERIC")]
    RestrictedNumeric,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableAlign {
    Right,
    Left,
    Center,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableMeasure {
    Scale,
    Ordinal,
    Nominal,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VariableRole {
    Input,
    Target,
    Both,
    None,
    Partition,
    Split,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VariableDefinition {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i32>,
    #[serde(rename = "columnIndex")]
    pub column_index: usize,
    pub name: String,
    pub r#type: VariableType,
    pub width: i32,
    pub decimals: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub values: Vec<ValueLabel>,
    pub missing: Vec<DataValue>,
    pub columns: i32,
    pub align: VariableAlign,
    pub measure: VariableMeasure,
    pub role: VariableRole,
}
