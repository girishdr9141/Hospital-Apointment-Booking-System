import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ClipboardCheck,
  Crown,
  ShieldCheck,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import type { RoleName } from '../../types/opd';
import { ROLE_PORTAL_CARDS } from '../../utils/permissions';
import { apiClient } from '../../services/apiClient';

interface RoleSelectorPageProps {
  onSelectRole: (role: RoleName) => void;
}

const ROLE_ICON: Record<RoleName, typeof ShieldCheck> = {
  SUPER_ADMIN: Crown,
  ADMIN: ShieldCheck,
  DOCTOR: Stethoscope,
  RECEPTIONIST: ClipboardCheck,
  PATIENT: UserRound,
};

export function RoleSelectorPage({ onSelectRole }: RoleSelectorPageProps) {
  const [allowPatientReg, setAllowPatientReg] = useState(true);

  useEffect(() => {
    apiClient
      .getSecurityPolicy()
      .then((res) => setAllowPatientReg(res.allow_patient_registration))
      .catch(() => null);
  }, []);

  const roleHint: Record<RoleName, string> = {
    SUPER_ADMIN: '1 immutable root governance account',
    ADMIN: 'Provisioned by Super Admin',
    DOCTOR: 'Provisioned by Administrator or Super Admin',
    RECEPTIONIST: 'Provisioned by Administrator or Super Admin',
    PATIENT: allowPatientReg
      ? 'Login · Register · Forgot Password'
      : 'Login · Forgot Password (Self-registration disabled)',
  };

  const superCard = ROLE_PORTAL_CARDS.find((c) => c.role === 'SUPER_ADMIN')!;
  const standardCards = ROLE_PORTAL_CARDS.filter((c) => c.role !== 'SUPER_ADMIN');
  const SuperIcon = ROLE_ICON.SUPER_ADMIN;

  return (
    <div className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-700 text-white shadow-xs">
            <Stethoscope className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-teal-800">
            Hospital Appointment &amp; Outpatient Portal
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Welcome to CarePulse OPD
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-600">
            Select your account type to continue.
          </p>
        </div>

        {/* 5 Protected Core Role Portals */}
        <div className="mt-8 space-y-5">
          {/* Featured Root Governance Card */}
          <div className="group flex flex-col justify-between gap-4 rounded-xl border border-slate-300 bg-white p-6 transition-all hover:border-teal-700 hover:shadow-sm sm:flex-row sm:items-center">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white transition-colors group-hover:bg-teal-700">
                <SuperIcon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{superCard.title}</h2>
                  <span className="text-xs font-medium uppercase tracking-wide text-teal-800">
                    {superCard.portalTitle}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{superCard.description}</p>
                <p className="mt-1 text-xs text-slate-500">{roleHint.SUPER_ADMIN}</p>
              </div>
            </div>
            <button
              type="button"
              aria-label={`Continue as ${superCard.title}`}
              onClick={() => onSelectRole(superCard.role)}
              className="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/30"
            >
              <span>Continue</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {standardCards.map((card) => {
              const Icon = ROLE_ICON[card.role];
              return (
                <div
                  key={card.role}
                  className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 transition-all hover:border-teal-600 hover:shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 transition-colors group-hover:bg-teal-700 group-hover:text-white">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                          <p className="text-xs font-medium text-teal-800">{card.portalTitle}</p>
                        </div>
                      </div>
                    </div>

                    <p className="mt-4 text-sm text-slate-600">{card.description}</p>
                    <p className="mt-2 text-xs text-slate-500">{roleHint[card.role]}</p>
                  </div>

                  <div className="mt-6 pt-2">
                    <button
                      type="button"
                      aria-label={`Continue as ${card.title}`}
                      onClick={() => onSelectRole(card.role)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-700/30"
                    >
                      <span>Continue</span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
