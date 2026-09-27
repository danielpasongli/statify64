// error_summary.rs
use crate::models::result::{ClassificationPartition, ClassificationTable, ErrorSummary};

use super::common::error_rate_percent;

/// Calculate error summary based on classification table results
pub fn calculate_error_summary(
    classification_table: &Option<ClassificationTable>,
) -> Result<ErrorSummary, String> {
    match classification_table {
        Some(table) => Ok(ErrorSummary {
            training: partition_error_percent(&table.training),
            holdout: partition_error_percent(&table.holdout),
        }),
        None => Err("Classification table not available for error summary calculation".to_string()),
    }
}

/// Error rate (1 - sum of correct / N) x 100%, taken directly from the counts
/// in the confusion matrix rather than back from rounded percentages.
fn partition_error_percent(partition: &ClassificationPartition) -> f64 {
    let total: usize = partition.observed.iter().sum();
    if total == 0 {
        return 100.0;
    }

    let correct: usize = partition
        .confusion_matrix
        .iter()
        .enumerate()
        .filter_map(|(idx, row)| row.get(idx))
        .sum();

    error_rate_percent(total - correct.min(total), total)
}

#[cfg(test)]
mod tests {
    use crate::models::result::{ClassificationPartition, ClassificationTable};

    use super::calculate_error_summary;

    fn partition(confusion_matrix: Vec<Vec<usize>>) -> ClassificationPartition {
        let observed = confusion_matrix.iter().map(|row| row.iter().sum()).collect();
        ClassificationPartition {
            confusion_matrix,
            observed,
            predicted: Vec::new(),
            missing: Vec::new(),
            overall_percent: Vec::new(),
            percent_correct: Vec::new(),
        }
    }

    #[test]
    fn error_summary_uses_counts_from_the_confusion_matrix() {
        let table = ClassificationTable {
            categories: vec!["A".to_string(), "B".to_string()],
            // 1 of 3 correct; the old path via percentages gave 66.66666666666667.
            training: partition(vec![vec![1, 1], vec![1, 0]]),
            // 63 of 70 correct.
            holdout: partition(vec![vec![40, 3], vec![4, 23]]),
        };

        let summary = calculate_error_summary(&Some(table)).unwrap();
        assert_eq!(summary.training, 2.0 / 3.0 * 100.0);
        assert_eq!(summary.holdout, 10.0);
    }
}
