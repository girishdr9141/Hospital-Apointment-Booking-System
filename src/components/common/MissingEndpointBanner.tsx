import { Database } from 'lucide-react';

interface MissingEndpointBannerProps {
  endpoint: string;
  description: string;
}

export function MissingEndpointBanner({ endpoint, description }: MissingEndpointBannerProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
      <div>
        <p className="font-medium">
          Oracle ORDS endpoint <span className="font-mono text-xs">{endpoint}</span> is not deployed yet.
        </p>
        <p className="mt-0.5 text-xs text-amber-800">{description}</p>
      </div>
    </div>
  );
}
