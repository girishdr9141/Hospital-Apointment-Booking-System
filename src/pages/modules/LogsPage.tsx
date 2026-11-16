import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Eye, ShieldAlert } from 'lucide-react';
import type { AuditLogRecord, ErrorLogRecord, RbacAuditLogEntry } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { buildCsvString, downloadCsvFile } from '../../utils/csv';
import { hasModulePermission } from '../../utils/permissions';
import { formatDisplayDateTime } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';

interface LogsPageProps {
  mode: 'audit' | 'error';
}

const AUDIT_CATEGORIES: Array<'ALL' | RbacAuditLogEntry['category']> = [
  'ALL',
  'AUTH',
  'USER',
  'ROLE',
  'PERMISSION',
  'SECURITY',
  'CLINICAL',
];

export function LogsPage({ mode }: LogsPageProps) {
  const { user } = useAuth();
  const { notify } = useToast();

  const [auditTab, setAuditTab] = useState<'rbac' | 'oracle'>('rbac');
  const [rbacLogs, setRbacLogs] = useState<RbacAuditLogEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingOracleEndpoint, setMissingOracleEndpoint] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | RbacAuditLogEntry['category']>('ALL');
  const [selectedError, setSelectedError] = useState<ErrorLogRecord | null>(null);

  const canExportAudit = hasModulePermission(user, 'SYSTEM_SETTINGS', 'VIEW');

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingOracleEndpoint(false);
    try {
      if (mode === 'audit') {
        if (auditTab === 'rbac') {
          const res = await apiClient.getRbacAuditLogs();
          setRbacLogs(res.logs || []);
        } else {
          try {
            const list = await apiClient.getAuditLogs();
            setAuditLogs(list);
          } catch (err) {
            if (isEndpointNotDeployedError(err)) {
              setMissingOracleEndpoint(true);
              setAuditLogs([]);
            } else {
              throw err;
            }
          }
        }
      } else {
        try {
          const list = await apiClient.getErrorLogs();
          setErrorLogs(list);
        } catch (err) {
          if (isEndpointNotDeployedError(err)) {
            setMissingOracleEndpoint(true);
            setErrorLogs([]);
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : `Failed to load ${mode} logs`, 'error');
    } finally {
      setLoading(false);
    }
  }, [mode, auditTab, notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredRbacLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rbacLogs.filter((l) => {
      if (categoryFilter !== 'ALL' && l.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.actor_name.toLowerCase().includes(q) ||
        (l.target_label || '').toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [rbacLogs, categoryFilter, search]);

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (a) =>
        a.action_name.toLowerCase().includes(q) ||
        a.table_name.toLowerCase().includes(q) ||
        (a.username || '').toLowerCase().includes(q) ||
        (a.action_description || '').toLowerCase().includes(q),
    );
  }, [auditLogs, search]);

  const filteredErrors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return errorLogs;
    return errorLogs.filter(
      (e) =>
        e.module_name.toLowerCase().includes(q) ||
        e.procedure_name.toLowerCase().includes(q) ||
        (e.error_message || '').toLowerCase().includes(q) ||
        String(e.oracle_error_code ?? '').includes(q),
    );
  }, [errorLogs, search]);

  const handleExportRbacCsv = () => {
    if (filteredRbacLogs.length === 0) {
      notify('No RBAC audit records to export', 'info');
      return;
    }
    const headers = [
      'Timestamp',
      'Action',
      'Category',
      'Severity',
      'Actor',
      'Actor Role',
      'Target',
      'Previous Value',
      'New Value',
      'Details',
    ];
    const rows = filteredRbacLogs.map((l) => [
      l.timestamp,
      l.action,
      l.category,
      l.severity,
      l.actor_name,
      l.actor_role,
      l.target_label || '',
      l.previous_value || '',
      l.new_value || '',
      l.details,
    ]);
    downloadCsvFile('carepulse-rbac-security-audit.csv', buildCsvString(headers, rows));
    notify(`Exported ${filteredRbacLogs.length} audit log entry(ies)`, 'success');
  };

  const rbacColumns: DataColumn<RbacAuditLogEntry>[] = [
    {
      key: 'time',
      header: 'Timestamp',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
          {formatDisplayDateTime(row.timestamp)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Event',
      render: (row) => (
        <div>
          <span
            className={`font-mono text-xs font-semibold ${
              row.severity === 'critical'
                ? 'text-red-700'
                : row.severity === 'warning'
                  ? 'text-amber-800'
                  : 'text-slate-900'
            }`}
          >
            {row.action}
          </span>
          <p className="text-[11px] text-slate-500">
            {row.category} · {row.severity}
          </p>
        </div>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <div className="text-xs">
          <p className="font-medium text-slate-900">{row.actor_name}</p>
          <p className="font-mono text-[11px] text-slate-500">{row.actor_role}</p>
        </div>
      ),
    },
    {
      key: 'target',
      header: 'Target & Diff',
      render: (row) => (
        <div className="max-w-xs text-xs">
          <p className="font-medium text-slate-800 truncate">{row.target_label || '—'}</p>
          {(row.previous_value || row.new_value) && (
            <p className="mt-0.5 font-mono text-[11px] text-slate-500 truncate">
              {row.previous_value ? `${row.previous_value} → ` : ''}
              {row.new_value || ''}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => <span className="text-xs text-slate-600">{row.details}</span>,
    },
  ];

  const auditColumns: DataColumn<AuditLogRecord>[] = [
    {
      key: 'id',
      header: 'Audit ID',
      render: (row) => <span className="font-mono text-xs text-slate-500">#{row.audit_id}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-slate-900">{row.action_name}</span>
      ),
    },
    {
      key: 'table',
      header: 'Table / Record',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">
          {row.table_name}
          {row.record_id ? ` #${row.record_id}` : ''}
        </span>
      ),
    },
    {
      key: 'user',
      header: 'Actor',
      render: (row) => (
        <span className="text-slate-700">
          {row.username || (row.user_id ? `User #${row.user_id}` : 'SYSTEM')}
        </span>
      ),
    },
    {
      key: 'desc',
      header: 'Details',
      render: (row) => (
        <span className="line-clamp-2 max-w-xs text-xs text-slate-600">
          {row.action_description || '—'}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Timestamp',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDisplayDateTime(row.action_on)}
        </span>
      ),
    },
  ];

  const errorColumns: DataColumn<ErrorLogRecord>[] = [
    {
      key: 'id',
      header: 'Log ID',
      render: (row) => <span className="font-mono text-xs text-slate-500">#{row.log_id}</span>,
    },
    {
      key: 'proc',
      header: 'Module / Procedure',
      render: (row) => (
        <div>
          <p className="font-mono text-xs font-medium text-slate-900">{row.procedure_name}</p>
          <p className="text-xs text-slate-500">{row.module_name}</p>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'ORA Code',
      render: (row) => (
        <span className="font-mono text-xs font-medium text-red-700 tabular-nums">
          {row.oracle_error_code ? `ORA${row.oracle_error_code}` : '—'}
        </span>
      ),
    },
    {
      key: 'msg',
      header: 'Error Message',
      render: (row) => (
        <span className="line-clamp-2 max-w-sm text-xs text-slate-700">
          {row.error_message || '—'}
        </span>
      ),
    },
    {
      key: 'time',
      header: 'Logged On',
      render: (row) => (
        <span className="font-mono text-xs text-slate-500 tabular-nums">
          {formatDisplayDateTime(row.created_on)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Inspect',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => setSelectedError(row)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Details</span>
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {mode === 'audit' ? 'Audit Logs & Security Trail' : 'Oracle PL/SQL Error Logs'}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {mode === 'audit'
              ? 'Read-only governance trail tracking authentication, role/permission mutations, unauthorized access attempts, and clinical writes.'
              : 'Diagnostic exception entries captured by PL/SQL procedures in GIRISH_ERROR_LOG.'}
          </p>
        </div>
        {mode === 'audit' && auditTab === 'rbac' && canExportAudit && (
          <button
            type="button"
            onClick={handleExportRbacCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Export Audit CSV</span>
          </button>
        )}
      </div>

      {mode === 'audit' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
            <button
              type="button"
              onClick={() => {
                setAuditTab('rbac');
                setSearch('');
              }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                auditTab === 'rbac'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              RBAC &amp; Security Trail
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditTab('oracle');
                setSearch('');
              }}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                auditTab === 'oracle'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Oracle DB Audit Trail
            </button>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldAlert className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            Immutable read-only audit stream
          </span>
        </div>
      )}

      {missingOracleEndpoint && (mode === 'error' || auditTab === 'oracle') && (
        <MissingEndpointBanner
          endpoint={mode === 'audit' ? 'GET /audit-logs' : 'GET /error-logs'}
          description={
            mode === 'audit'
              ? 'Unable to reach GET /audit-logs in Oracle ORDS.'
              : 'Unable to reach GET /error-logs in Oracle ORDS.'
          }
        />
      )}

      {mode === 'audit' ? (
        auditTab === 'rbac' ? (
          <DataTable
            rows={filteredRbacLogs}
            columns={rbacColumns}
            getRowKey={(row) => row.id}
            loading={loading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search action, actor, target, or details..."
            filters={
              <select
                aria-label="Filter audit logs by category"
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as 'ALL' | RbacAuditLogEntry['category'])
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
              >
                {AUDIT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === 'ALL' ? 'All Categories' : cat}
                  </option>
                ))}
              </select>
            }
            emptyTitle="No security or RBAC events recorded yet"
            emptyDescription="Sign-ins, permission changes, role updates, and blocked 403 attempts appear here automatically."
          />
        ) : (
          <DataTable
            rows={filteredAudit}
            columns={auditColumns}
            getRowKey={(row) => row.audit_id}
            loading={loading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search action, table, or actor..."
            emptyTitle="No Oracle audit entries found"
            emptyDescription="Audit events from GIRISH_AUDIT_LOGS will appear here."
          />
        )
      ) : (
        <DataTable
          rows={filteredErrors}
          columns={errorColumns}
          getRowKey={(row) => row.log_id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search procedure, module, or ORA code..."
          emptyTitle="No error log entries found"
          emptyDescription="PL/SQL exception traces from GIRISH_ERROR_LOG will appear here."
        />
      )}

      <Modal
        open={Boolean(selectedError)}
        title={selectedError ? `Error Log #${selectedError.log_id}` : ''}
        subtitle={
          selectedError
            ? `${selectedError.module_name} · ${selectedError.procedure_name}`
            : undefined
        }
        onClose={() => setSelectedError(null)}
        maxWidth="xl"
      >
        {selectedError && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div>
                <p className="text-xs text-slate-500">Oracle Error Code</p>
                <p className="mt-0.5 font-mono text-xs font-medium text-red-700">
                  {selectedError.oracle_error_code ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">DB User / Logged On</p>
                <p className="mt-0.5 font-mono text-xs text-slate-800">
                  {selectedError.user_name || '—'} · {formatDisplayDateTime(selectedError.created_on)}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Error Message</p>
              <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
                {selectedError.error_message || '—'}
              </pre>
            </div>
            {selectedError.additional_info && (
              <div>
                <p className="text-xs font-medium text-slate-500">Additional Context</p>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800">
                  {selectedError.additional_info}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
