import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import type { AuditLogRecord, ErrorLogRecord } from '../../types/opd';
import { apiClient, isEndpointNotDeployedError } from '../../services/apiClient';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDateTime } from '../../utils/rules';
import { DataTable, type DataColumn } from '../../components/common/DataTable';
import { Modal } from '../../components/common/Modal';
import { MissingEndpointBanner } from '../../components/common/MissingEndpointBanner';

interface LogsPageProps {
  mode: 'audit' | 'error';
}

export function LogsPage({ mode }: LogsPageProps) {
  const { notify } = useToast();

  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingEndpoint, setMissingEndpoint] = useState(false);

  const [search, setSearch] = useState('');
  const [selectedError, setSelectedError] = useState<ErrorLogRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMissingEndpoint(false);
    try {
      if (mode === 'audit') {
        const list = await apiClient.getAuditLogs();
        setAuditLogs(list);
      } else {
        const list = await apiClient.getErrorLogs();
        setErrorLogs(list);
      }
    } catch (err) {
      if (isEndpointNotDeployedError(err)) {
        setMissingEndpoint(true);
        if (mode === 'audit') setAuditLogs([]);
        else setErrorLogs([]);
      } else {
        notify(
          err instanceof Error ? err.message : `Failed to load ${mode} logs`,
          'error',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [mode, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        <span className="text-slate-700">{row.username || (row.user_id ? `User #${row.user_id}` : 'SYSTEM')}</span>
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
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          {mode === 'audit' ? 'System Audit Logs' : 'Oracle PL/SQL Error Logs'}
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          {mode === 'audit'
            ? 'Read-only record of state mutations and administrative actions from GIRISH_AUDIT_LOGS.'
            : 'Diagnostic exception entries captured by PL/SQL procedures in GIRISH_ERROR_LOG.'}
        </p>
      </div>

      {missingEndpoint && (
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
        <DataTable
          rows={filteredAudit}
          columns={auditColumns}
          getRowKey={(row) => row.audit_id}
          loading={loading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search action, table, or actor..."
          emptyTitle="No audit log entries found"
          emptyDescription="Audit events from GIRISH_AUDIT_LOGS will appear here."
        />
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
