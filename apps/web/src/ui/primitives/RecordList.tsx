import "./primitives.css";

export interface RecordListColumn {
  key: string;
  header: string;
}

export interface RecordListRow {
  id: string;
  cells: Record<string, string>;
}

export interface RecordListProps {
  ariaLabel: string;
  columns: readonly RecordListColumn[];
  rows: readonly RecordListRow[];
  testId?: string;
}

/**
 * RecordList primitive (plan.md §10.3): a responsive record list rendered
 * as an ARIA `grid` (`role="grid"`/`row`/`columnheader`/`gridcell`) rather
 * than a `<table>`, so it reflows in narrow (§10.2 "compact") layouts
 * without losing its screen-reader row/column semantics.
 */
export function RecordList({ ariaLabel, columns, rows, testId }: RecordListProps) {
  const templateColumns = `repeat(${columns.length}, minmax(0, 1fr))`;
  return (
    <div className="pc-record-list" role="grid" aria-label={ariaLabel} data-testid={testId}>
      <div
        className="pc-record-list__row pc-record-list__row--header"
        role="row"
        style={{ gridTemplateColumns: templateColumns }}
      >
        {columns.map((column) => (
          <span key={column.key} role="columnheader" className="pc-record-list__cell">
            {column.header}
          </span>
        ))}
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="pc-record-list__row"
          role="row"
          style={{ gridTemplateColumns: templateColumns }}
        >
          {columns.map((column) => (
            <span key={column.key} role="gridcell" className="pc-record-list__cell">
              {row.cells[column.key] ?? ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
