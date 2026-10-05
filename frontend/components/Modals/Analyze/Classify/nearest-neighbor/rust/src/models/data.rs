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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AnalysisData {
    pub target_data: Vec<Vec<DataRecord>>,
    pub features_data: Vec<Vec<DataRecord>>,
    pub focal_case_data: Vec<Vec<DataRecord>>,
    pub case_data: Option<Vec<Vec<DataRecord>>>,
    pub target_data_defs: Vec<Vec<VariableDefinition>>,
    pub features_data_defs: Vec<Vec<VariableDefinition>>,
    pub focal_case_data_defs: Vec<Vec<VariableDefinition>>,
    pub case_data_defs: Option<Vec<Vec<VariableDefinition>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KnnData {
    pub features: Vec<String>,
    pub data_matrix: Vec<Vec<f64>>,
    pub display_matrix: Vec<Vec<f64>>,
    pub target_values: Vec<DataValue>,
    pub target_measure: VariableMeasure,
    pub case_identifiers: Vec<i32>,
    pub case_labels: Vec<String>,
    pub processed_case_indices: Vec<usize>,
    pub training_indices: Vec<usize>,
    pub holdout_indices: Vec<usize>,
    pub excluded_indices: Vec<usize>,
    pub cross_validation_folds: Vec<usize>,
    pub focal_indices: Vec<usize>,
}

impl KnnData {
    pub fn target_is_categorical(&self) -> bool {
        matches!(
            self.target_measure,
            VariableMeasure::Nominal | VariableMeasure::Ordinal
        ) || self
            .target_values
            .iter()
            // Missing targets (holdout cases kept for prediction) say nothing
            // about the target type.
            .filter(|value| !matches!(value, DataValue::Null))
            .all(|value| matches!(value, DataValue::Text(_) | DataValue::Boolean(_)))
    }

    pub fn target_is_numeric_scale(&self) -> bool {
        !self.target_is_categorical()
            && self
                .target_values
                .iter()
                .any(|value| matches!(value, DataValue::Number(value) if value.is_finite()))
    }
}
