import { ShieldAlert } from 'lucide-react';

interface UnauthorizedViewProps {
  attemptedRoute: string;
  onBackToDashboard: () => void;
}

export function UnauthorizedView({ attemptedRoute, onBackToDashboard }: UnauthorizedViewProps) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-700">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-slate-900">Access Restricted</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Your current role does not have permission to open{' '}
        <span className="font-mono text-slate-800">{attemptedRoute}</span>.
      </p>
      <button
        type="button"
        onClick={onBackToDashboard}
        className="mt-6 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 whitespace-nowrap"
      >
        Return to Dashboard
      </button>
    </div>
  );
}
