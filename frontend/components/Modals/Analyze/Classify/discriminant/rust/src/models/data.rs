use serde::{ Deserialize, Serialize };
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
    pub group_data: Vec<Vec<DataRecord>>,
    pub independent_data: Vec<Vec<DataRecord>>,
    pub selection_data: Option<Vec<Vec<DataRecord>>>,
    /// Values of the bootstrap "Strata Variables": one inner Vec per strata
    /// variable, rows in the same order as `group_data`. Only the bootstrap
    /// reads it; `None` when the user selected no strata variables.
    #[serde(default)]
    pub strata_data: Option<Vec<Vec<DataRecord>>>,
    /// Data-file row (0-based) of every row still held, set by filter_valid_cases.
    /// `None` for unfiltered data, whose rows are the file rows themselves. Lets
    /// per-case output (casewise statistics) report the case's own row number.
    #[serde(default)]
    pub row_numbers: Option<Vec<usize>>,
    pub group_data_defs: Vec<Vec<VariableDefinition>>,
    pub independent_data_defs: Vec<Vec<VariableDefinition>>,
    pub selection_data_defs: Option<Vec<Vec<VariableDefinition>>>,
}
