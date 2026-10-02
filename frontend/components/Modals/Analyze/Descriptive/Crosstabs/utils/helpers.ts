/** Shared table definitions used by Crosstabs formatter utilities */
export interface ColumnHeader {
  header: string;
  key?: string;
  children?: ColumnHeader[];
}

export interface TableRowData {
  rowHeader: (string | null)[];
  [key: string]: any;
}

export interface FormattedTable {
  title: string;
  columnHeaders: ColumnHeader[];
  rows: TableRowData[];
  footnotes?: string[];
  footer?: string[];
  description?: string[];
}
