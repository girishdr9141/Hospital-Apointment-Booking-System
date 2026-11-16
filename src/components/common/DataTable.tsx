import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { paginateItems } from '../../utils/rules';

export interface DataColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataColumn<T>[];
  getRowKey: (row: T) => string | number;
  loading?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  pageSize?: number;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  loading = false,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filters,
  emptyTitle,
  emptyDescription,
  emptyAction,
  pageSize = 10,
}: DataTableProps<T>) {
  const [page, setPage] = useState(1);

  const { pageItems, totalPages, currentPage } = useMemo(
    () => paginateItems(rows, page, pageSize),
    [rows, page, pageSize],
  );

  const handleSearch = (val: string) => {
    setPage(1);
    onSearchChange?.(val);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      {(onSearchChange || filters) && (
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          {onSearchChange && (
            <div className="relative w-full sm:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchValue ?? ''}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
              />
            </div>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-4" aria-busy="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">{emptyTitle}</p>
          {emptyDescription && (
            <p className="mt-1 text-sm text-slate-500">{emptyDescription}</p>
          )}
          {emptyAction && <div className="mt-4">{emptyAction}</div>}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-4 py-3 whitespace-nowrap ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((row) => (
                  <tr key={getRowKey(row)} className="hover:bg-slate-50">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
            <span className="font-mono tabular-nums">
              Showing {(currentPage - 1) * pageSize + 1}–
              {Math.min(currentPage * pageSize, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                aria-label="Previous page"
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="px-2 font-mono tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
