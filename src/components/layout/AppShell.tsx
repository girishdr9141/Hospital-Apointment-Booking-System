import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Calendar,
  CalendarClock,
  CalendarPlus,
  CheckCheck,
  ClipboardCheck,
  CreditCard,
  FileSearch,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  Building2,
  Pill,
  Shield,
  Sliders,
  Stethoscope,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AuthUser, NavItem, PortalNotification, RouteKey } from '../../types/opd';
import { getNavForUser, getRouteLabel, ROLE_LABELS } from '../../utils/permissions';
import { formatDisplayDateTime } from '../../utils/rules';
import { ConfirmDialog } from './ConfirmDialog';

const ROUTE_ICONS: Record<RouteKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  patients: Users,
  'register-patient': UserPlus,
  doctors: Stethoscope,
  departments: Building2,
  'consultation-types': Activity,
  'medical-records': FileText,
  prescriptions: Pill,
  appointments: Calendar,
  'book-appointment': CalendarPlus,
  'appointment-history': History,
  slots: CalendarClock,
  'doctor-leaves': ClipboardCheck,
  approvals: ClipboardCheck,
  payments: CreditCard,
  'token-queue': ListOrdered,
  'users-roles': UserCog,
  'role-management': Shield,
  'permission-management': Sliders,
  'audit-logs': FileSearch,
  'security-settings': Lock,
  'error-logs': AlertTriangle,
  profile: UserCheck,
};

const SECTION_LABELS: Record<NavItem['section'], string> = {
  governance: 'Governance & RBAC',
  overview: 'Overview',
  clinical: 'Clinical',
  operations: 'Operations',
  administration: 'Administration',
};

interface AppShellProps {
  user: AuthUser;
  activeRoute: RouteKey;
  onNavigate: (route: RouteKey) => void;
  onLogout: () => Promise<void>;
  notifications?: PortalNotification[];
  onNotificationClick?: (notification: PortalNotification) => void;
  onDismissAllNotifications?: () => void;
  children: React.ReactNode;
}

export function AppShell({
  user,
  activeRoute,
  onNavigate,
  onLogout,
  notifications = [],
  onNotificationClick,
  onDismissAllNotifications,
  children,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const showBell = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'DOCTOR';
  const unreadCount = notifications.filter((n) => !n.read).length;

  const navItems = getNavForUser(user);
  const activeLabel = getRouteLabel(user, activeRoute);

  const groupedSections = (['governance', 'overview', 'clinical', 'operations', 'administration'] as const)
    .map((sec) => ({
      section: sec,
      label: SECTION_LABELS[sec],
      items: navItems.filter((item) => item.section === sec),
    }))
    .filter((group) => group.items.length > 0);

  const handleNavClick = (route: RouteKey) => {
    onNavigate(route);
    setMobileOpen(false);
  };

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setLoggingOut(false);
      setConfirmLogoutOpen(false);
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
        <a
          href="#/dashboard"
          onClick={(e) => {
            e.preventDefault();
            handleNavClick('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          CarePulse OPD
        </a>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groupedSections.map((group) => (
          <div key={group.section}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.label}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const Icon = ROUTE_ICONS[item.key] || KeyRound;
                const isActive = activeRoute === item.key;
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => handleNavClick(item.key)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-teal-50 text-teal-900'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      }`}
                    >
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isActive ? 'text-teal-700' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="text-sm font-medium text-slate-900 truncate">{user.full_name}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
          <span>{ROLE_LABELS[user.role]}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{user.username}</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirmLogoutOpen(true)}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="sticky top-0 h-screen">{sidebarContent}</div>
        </aside>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-950/40"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative z-50 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-xl">
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* Main Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="hidden font-medium text-slate-500 sm:inline whitespace-nowrap">
                  {ROLE_LABELS[user.role]}
                </span>
                <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
                  /
                </span>
                <h1 className="truncate text-base font-semibold text-slate-900">
                  {activeLabel}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              {showBell && (
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Open notifications"
                    onClick={() => setNotifOpen((prev) => !prev)}
                    className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                  >
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    {unreadCount > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-semibold text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {notifOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setNotifOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-xl">
                        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Notifications</p>
                            <p className="text-[11px] text-slate-500">
                              {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                            </p>
                          </div>
                          {unreadCount > 0 && onDismissAllNotifications && (
                            <button
                              type="button"
                              onClick={() => {
                                onDismissAllNotifications();
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"
                            >
                              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Mark all read</span>
                            </button>
                          )}
                        </div>
                        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className="p-6 text-center text-xs text-slate-500">
                              No notifications right now.
                            </div>
                          ) : (
                            notifications.slice(0, 15).map((n) => (
                              <button
                                key={n.id}
                                type="button"
                                onClick={() => {
                                  setNotifOpen(false);
                                  onNotificationClick?.(n);
                                }}
                                className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                                  n.read ? 'opacity-70' : 'bg-teal-50/35'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-900">
                                    {n.title}
                                  </span>
                                  {!n.read && (
                                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                                  )}
                                </div>
                                <span className="text-xs text-slate-600">{n.message}</span>
                                <span className="font-mono text-[10px] text-slate-400">
                                  {formatDisplayDateTime(n.created_at)}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-slate-900 leading-tight">{user.full_name}</p>
                <p className="text-xs text-slate-500 leading-tight">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmLogoutOpen(true)}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0 lg:hidden"
              >
                Sign out
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>
        </div>
      </div>

      <ConfirmDialog
        open={confirmLogoutOpen}
        title="Sign out of CarePulse OPD?"
        description="Your active session will be closed and you will return to the hospital portal sign-in screen."
        confirmLabel="Sign out"
        busy={loggingOut}
        onConfirm={handleConfirmLogout}
        onCancel={() => setConfirmLogoutOpen(false)}
      />
    </div>
  );
}
