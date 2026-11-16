export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white p-5"
          >
            <div className="h-3 w-24 rounded bg-slate-200" />
            <div className="mt-4 h-7 w-16 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-32 rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white p-6" />
      </div>
    </div>
  );
}
