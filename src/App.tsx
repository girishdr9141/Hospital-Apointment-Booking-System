/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CalendarPlus, CheckCheck, ChevronRight, ClipboardCheck } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BranchProvider } from './context/BranchContext';
import { ToastProvider, useToast } from './context/ToastContext';
import type { DashboardSummaryResponse, PortalNotification, RoleName, RouteKey } from './types/opd';
import { canAccessRoute } from './utils/permissions';
import {
  doesDoctorNeedDailySlotsPrompt,
  getAppointmentsAwaitingOutcome,
  getTodayIsoLocal,
} from './utils/calendar';
import { formatDisplayDate, formatDisplayDateTime } from './utils/rules';
import { apiClient } from './services/apiClient';
import { RoleSelectorPage } from './pages/auth/RoleSelectorPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPatientPage } from './pages/auth/RegisterPatientPage';
import { PatientForgotPasswordPage } from './pages/auth/PatientForgotPasswordPage';
import { AppShell } from './components/layout/AppShell';
import { BackendToggle } from './components/common/BackendToggle';
import { Modal } from './components/common/Modal';
import { DashboardSkeleton } from './components/layout/SkeletonBlock';
import { UnauthorizedView } from './components/layout/UnauthorizedView';
import { AdminDashboard } from './pages/dashboards/AdminDashboard';
import { SuperAdminDashboard } from './pages/dashboards/SuperAdminDashboard';
import { DoctorDashboard } from './pages/dashboards/DoctorDashboard';
import { PatientDashboard } from './pages/dashboards/PatientDashboard';
import { ReceptionistDashboard } from './pages/dashboards/ReceptionistDashboard';
import { PatientsPage } from './pages/modules/PatientsPage';
import { DoctorsPage } from './pages/modules/DoctorsPage';
import { DepartmentsPage } from './pages/modules/DepartmentsPage';
import { ConsultationTypesPage } from './pages/modules/ConsultationTypesPage';
import { AppointmentsPage } from './pages/modules/AppointmentsPage';
import { SlotsPage } from './pages/modules/SlotsPage';
import { DoctorLeavesPage } from './pages/modules/DoctorLeavesPage';
import { ApprovalsPage } from './pages/modules/ApprovalsPage';
import { PaymentsPage } from './pages/modules/PaymentsPage';
import { TokenQueuePage } from './pages/modules/TokenQueuePage';
import { MedicalRecordsPage } from './pages/modules/MedicalRecordsPage';
import { PrescriptionsPage } from './pages/modules/PrescriptionsPage';
import { UsersRolesPage } from './pages/modules/UsersRolesPage';
import { RoleManagementPage } from './pages/modules/RoleManagementPage';
import { PermissionManagementPage } from './pages/modules/PermissionManagementPage';
import { SecuritySettingsPage } from './pages/modules/SecuritySettingsPage';
import { LogsPage } from './pages/modules/LogsPage';
import { ProfilePage } from './pages/modules/ProfilePage';
import { AnalyticsPage } from './pages/modules/AnalyticsPage';
import { BranchesPage } from './pages/modules/BranchesPage';
import { DoctorShiftModal } from './components/modals/DoctorShiftModal';
import { DoctorOutcomePromptModal } from './components/modals/DoctorOutcomePromptModal';

const VALID_ROUTES: RouteKey[] = [
  'dashboard',
  'analytics',
  'branches',
  'patients',
  'register-patient',
  'doctors',
  'departments',
  'consultation-types',
  'appointments',
  'book-appointment',
  'appointment-history',
  'slots',
  'doctor-leaves',
  'approvals',
  'payments',
  'token-queue',
  'medical-records',
  'prescriptions',
  'users-roles',
  'role-management',
  'permission-management',
  'security-settings',
  'audit-logs',
  'error-logs',
  'profile',
];

function parseHashRoute(): RouteKey {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  if (VALID_ROUTES.includes(raw as RouteKey)) {
    return raw as RouteKey;
  }
  return 'dashboard';
}

function PortalContent() {
  const { user, loading, logout } = useAuth();
  const { notify } = useToast();

  const [selectedRole, setSelectedRole] = useState<RoleName | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot-password'>('login');
  const [authBanner, setAuthBanner] = useState<string | null>(null);
  const [prefillEmail, setPrefillEmail] = useState<string>('');
  const [authSessionNonce, setAuthSessionNonce] = useState(0);
  const [activeRoute, setActiveRoute] = useState<RouteKey>(() => parseHashRoute());
  const [selectedMatrixRole, setSelectedMatrixRole] = useState<RoleName | undefined>(undefined);
  const [dashboardData, setDashboardData] = useState<DashboardSummaryResponse | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);

  // Mandatory first-login shift registration & daily slot reminder modals
  const [shiftModalDismissedForUser, setShiftModalDismissedForUser] = useState<number | null>(null);
  const [dailyModalDismissedForUser, setDailyModalDismissedForUser] = useState<number | null>(null);
  const [notifPopupDismissedForUser, setNotifPopupDismissedForUser] = useState<number | null>(null);
  const [outcomeSnoozedSignature, setOutcomeSnoozedSignature] = useState<string | null>(null);
  const [outcomeCheckNow, setOutcomeCheckNow] = useState<number>(() => Date.now());
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [quickGenerating, setQuickGenerating] = useState(false);

  useEffect(() => {
    const onHashChange = () => {
      setActiveRoute(parseHashRoute());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((route: RouteKey) => {
    window.location.hash = `#/${route}`;
    setActiveRoute(route);
  }, []);

  const loadNotifications = useCallback(async () => {
    if (
      !user ||
      (user.role !== 'SUPER_ADMIN' &&
        user.role !== 'ADMIN' &&
        user.role !== 'DOCTOR' &&
        user.role !== 'PATIENT')
    ) {
      setNotifications([]);
      return;
    }
    try {
      const res = await apiClient.getNotifications();
      setNotifications(res.notifications || []);
    } catch {
      // Ignore transient notification fetch error
    }
  }, [user]);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    if (user.role === 'SUPER_ADMIN') {
      void loadNotifications();
      return;
    }
    setDashLoading(true);
    setDashError(null);
    try {
      const summary = await apiClient.getDashboardSummary();
      setDashboardData(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load dashboard metrics';
      setDashError(msg);
      notify(msg, 'error');
    } finally {
      setDashLoading(false);
    }
    void loadNotifications();
  }, [user, notify, loadNotifications]);

  useEffect(() => {
    if (user) {
      loadDashboard();
    } else {
      setDashboardData(null);
      setNotifications([]);
      setShiftModalDismissedForUser(null);
      setDailyModalDismissedForUser(null);
      setNotifPopupDismissedForUser(null);
      setOutcomeSnoozedSignature(null);
    }
  }, [user, loadDashboard]);

  // Periodically check if any doctor appointment has crossed its slot end time
  useEffect(() => {
    if (!user || user.role !== 'DOCTOR') return;
    const tickTimer = window.setInterval(() => {
      setOutcomeCheckNow(Date.now());
    }, 30_000);
    const refreshTimer = window.setInterval(() => {
      void loadDashboard();
    }, 60_000);
    return () => {
      window.clearInterval(tickTimer);
      window.clearInterval(refreshTimer);
    };
  }, [user, loadDashboard]);

  const handleLogout = useCallback(async () => {
    await logout();
    window.location.hash = '';
    setSelectedRole(null);
    setAuthMode('login');
    setAuthBanner(null);
    setPrefillEmail('');
    setAuthSessionNonce((n) => n + 1);
    setActiveRoute('dashboard');
    setNotifications([]);
    setShiftModalDismissedForUser(null);
    setDailyModalDismissedForUser(null);
    setNotifPopupDismissedForUser(null);
    setOutcomeSnoozedSignature(null);
    notify('You have been signed out', 'info');
  }, [logout, notify]);

  const pendingOutcomeAppointments = useMemo(() => {
    if (!user || user.role !== 'DOCTOR' || !dashboardData) return [];
    const serverList = dashboardData.pending_outcome_appointments ?? [];
    const liveChecked = getAppointmentsAwaitingOutcome(
      dashboardData.recent_appointments ?? [],
      user.doctor_id,
      new Date(outcomeCheckNow),
    );
    const mergedMap = new Map<number, (typeof serverList)[number]>();
    for (const appt of serverList) mergedMap.set(appt.appointment_id, appt);
    for (const appt of liveChecked) mergedMap.set(appt.appointment_id, appt);
    return Array.from(mergedMap.values()).sort(
      (a, b) =>
        String(a.slot_date || '').localeCompare(String(b.slot_date || '')) ||
        String(a.start_time || '').localeCompare(String(b.start_time || '')) ||
        a.appointment_id - b.appointment_id,
    );
  }, [user, dashboardData, outcomeCheckNow]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-600">Restoring session...</div>
      </div>
    );
  }

  if (!user) {
    let authContent: React.ReactNode;
    if (!selectedRole) {
      authContent = (
        <RoleSelectorPage
          onSelectRole={(role) => {
            setSelectedRole(role);
            setAuthMode('login');
            setAuthBanner(null);
            setPrefillEmail('');
            setAuthSessionNonce((n) => n + 1);
          }}
        />
      );
    } else if (selectedRole === 'PATIENT' && authMode === 'register') {
      authContent = (
        <RegisterPatientPage
          onSwitchToLogin={() => {
            setAuthMode('login');
            setAuthBanner(null);
          }}
          onChangeRole={() => {
            setSelectedRole(null);
            setAuthMode('login');
            setAuthBanner(null);
            setPrefillEmail('');
            setAuthSessionNonce((n) => n + 1);
          }}
        />
      );
    } else if (selectedRole === 'PATIENT' && authMode === 'forgot-password') {
      authContent = (
        <PatientForgotPasswordPage
          onBackToLogin={() => setAuthMode('login')}
          onResetSuccess={(resetEmail, message) => {
            setPrefillEmail(resetEmail);
            setAuthBanner(message);
            setAuthMode('login');
          }}
        />
      );
    } else {
      authContent = (
        <LoginPage
          key={`${selectedRole}:${authSessionNonce}`}
          selectedRole={selectedRole}
          onChangeRole={() => {
            setSelectedRole(null);
            setAuthMode('login');
            setAuthBanner(null);
            setPrefillEmail('');
            setAuthSessionNonce((n) => n + 1);
          }}
          onSwitchToRegister={
            selectedRole === 'PATIENT'
              ? () => {
                  setAuthBanner(null);
                  setAuthMode('register');
                }
              : undefined
          }
          onSwitchToForgotPassword={
            selectedRole === 'PATIENT'
              ? () => {
                  setAuthBanner(null);
                  setAuthMode('forgot-password');
                }
              : undefined
          }
          initialEmail={selectedRole === 'PATIENT' ? prefillEmail : ''}
          bannerMessage={authBanner}
        />
      );
    }

    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide text-slate-600">
              CarePulse OPD · Backend Mode
            </span>
            <BackendToggle compact />
          </div>
        </header>
        <div className="flex flex-1 flex-col">{authContent}</div>
      </div>
    );
  }

  const todayIso = getTodayIsoLocal();
  const doctorNeedsShiftRegistration =
    user.role === 'DOCTOR' &&
    Boolean(dashboardData?.doctor_shift) &&
    !dashboardData?.doctor_shift?.is_registered;

  const showShiftRegistrationModal =
    doctorNeedsShiftRegistration && shiftModalDismissedForUser !== user.user_id;

  const doctorNeedsDailySlots =
    user.role === 'DOCTOR' &&
    Boolean(dashboardData) &&
    doesDoctorNeedDailySlotsPrompt(
      dashboardData?.doctor_all_slots ?? dashboardData?.upcoming_slots ?? [],
      dashboardData?.doctor_leaves ?? [],
      user.doctor_id,
      todayIso,
    );

  const pendingOutcomeSignature =
    pendingOutcomeAppointments.length > 0
      ? `${user.user_id}:${pendingOutcomeAppointments.map((a) => a.appointment_id).join(',')}`
      : null;

  const showOutcomePromptModal =
    !showShiftRegistrationModal &&
    pendingOutcomeAppointments.length > 0 &&
    outcomeSnoozedSignature !== pendingOutcomeSignature;

  const unreadNotifications = notifications.filter((n) => !n.read);
  const showLoginNotifModal =
    (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'DOCTOR') &&
    !showShiftRegistrationModal &&
    !showOutcomePromptModal &&
    unreadNotifications.length > 0 &&
    notifPopupDismissedForUser !== user.user_id;

  const showDailyReminderModal =
    !showShiftRegistrationModal &&
    !showOutcomePromptModal &&
    !showLoginNotifModal &&
    doctorNeedsDailySlots &&
    dailyModalDismissedForUser !== user.user_id;

  const handleNotificationClick = async (notif: PortalNotification) => {
    setNotifPopupDismissedForUser(user.user_id);
    navigate(notif.route);
    if (!notif.read) {
      try {
        const res = await apiClient.dismissNotifications({ ids: [notif.id] });
        setNotifications(res.notifications);
      } catch {
        setNotifications((prev) =>
          prev.map((item) => (item.id === notif.id ? { ...item, read: true } : item)),
        );
      }
    }
  };

  const handleMarkNotificationRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const res = await apiClient.dismissNotifications({ ids });
      setNotifications(res.notifications);
    } catch {
      const idSet = new Set(ids);
      setNotifications((prev) =>
        prev.map((item) => (idSet.has(item.id) ? { ...item, read: true } : item)),
      );
    }
  };

  const handleDismissAllNotifications = async () => {
    setNotifPopupDismissedForUser(user.user_id);
    try {
      const res = await apiClient.dismissNotifications({ all: true });
      setNotifications(res.notifications);
    } catch {
      setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
    }
  };

  const handleConfirmTodayForDoctor = async () => {
    if (!user.doctor_id) return;
    setQuickGenerating(true);
    try {
      const res = await apiClient.confirmDoctorDaySlots({
        slot_date: todayIso,
      });
      notify(res.message || 'Confirmed today’s shift slots', 'success');
      setDailyModalDismissedForUser(user.user_id);
      await loadDashboard();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to generate today’s slots', 'error');
    } finally {
      setQuickGenerating(false);
    }
  };

  const authorized = canAccessRoute(user, activeRoute);

  const renderDashboard = () => {
    if (user.role === 'SUPER_ADMIN') {
      return <SuperAdminDashboard onNavigate={navigate} />;
    }
    if (dashLoading && !dashboardData) {
      return <DashboardSkeleton />;
    }
    if (dashError && !dashboardData) {
      return (
        <div className="rounded-xl border border-red-200 bg-white p-6">
          <h2 className="text-base font-semibold text-red-900">Unable to load Oracle dashboard</h2>
          <p className="mt-1 text-sm text-red-700">{dashError}</p>
          <button
            type="button"
            onClick={loadDashboard}
            className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
          >
            Retry
          </button>
        </div>
      );
    }
    if (!dashboardData) {
      return <DashboardSkeleton />;
    }

    switch (user.role) {
      case 'ADMIN':
        return (
          <AdminDashboard
            data={dashboardData}
            onRefresh={loadDashboard}
            refreshing={dashLoading}
            onNavigate={navigate}
          />
        );
      case 'DOCTOR':
        return (
          <DoctorDashboard
            user={user}
            data={dashboardData}
            onRefresh={loadDashboard}
            refreshing={dashLoading}
            onNavigate={navigate}
          />
        );
      case 'PATIENT':
        return (
          <PatientDashboard
            user={user}
            data={dashboardData}
            onRefresh={loadDashboard}
            refreshing={dashLoading}
            onNavigate={navigate}
            notifications={notifications}
            onMarkNotificationRead={handleMarkNotificationRead}
            onMarkAllNotificationsRead={handleDismissAllNotifications}
          />
        );
      case 'RECEPTIONIST':
        return (
          <ReceptionistDashboard
            data={dashboardData}
            onRefresh={loadDashboard}
            refreshing={dashLoading}
            onNavigate={navigate}
          />
        );
    }
  };

  const renderActiveRoute = () => {
    if (!authorized) {
      return (
        <UnauthorizedView
          attemptedRoute={`#/${activeRoute}`}
          onBackToDashboard={() => navigate('dashboard')}
        />
      );
    }

    switch (activeRoute) {
      case 'dashboard':
        return renderDashboard();
      case 'analytics':
        return <AnalyticsPage />;
      case 'branches':
        return <BranchesPage />;
      case 'patients':
        return <PatientsPage key="patients" mode="directory" />;
      case 'register-patient':
        return (
          <PatientsPage
            key="register-patient"
            mode="register"
            onRegistered={() => navigate('patients')}
          />
        );
      case 'doctors':
        return <DoctorsPage />;
      case 'departments':
        return <DepartmentsPage />;
      case 'consultation-types':
        return <ConsultationTypesPage />;
      case 'appointments':
        return (
          <AppointmentsPage
            key="appointments"
            mode="list"
            onDataChanged={loadDashboard}
          />
        );
      case 'book-appointment':
        return (
          <AppointmentsPage
            key="book-appointment"
            mode="book"
            onModeHandled={() => navigate('appointments')}
            onDataChanged={loadDashboard}
          />
        );
      case 'appointment-history':
        return (
          <AppointmentsPage
            key="appointment-history"
            mode="history"
            onDataChanged={loadDashboard}
          />
        );
      case 'slots':
        return <SlotsPage onDoctorSlotsChanged={loadDashboard} />;
      case 'doctor-leaves':
        return <DoctorLeavesPage />;
      case 'approvals':
        return <ApprovalsPage />;
      case 'payments':
        return <PaymentsPage />;
      case 'token-queue':
        return <TokenQueuePage />;
      case 'medical-records':
        return <MedicalRecordsPage />;
      case 'prescriptions':
        return <PrescriptionsPage />;
      case 'users-roles':
        return <UsersRolesPage />;
      case 'role-management':
        return (
          <RoleManagementPage
            onNavigate={navigate}
            onSelectRoleForMatrix={(role) => setSelectedMatrixRole(role)}
          />
        );
      case 'permission-management':
        return <PermissionManagementPage initialRole={selectedMatrixRole} />;
      case 'security-settings':
        return <SecuritySettingsPage />;
      case 'audit-logs':
        return <LogsPage key="audit-logs" mode="audit" />;
      case 'error-logs':
        return <LogsPage key="error-logs" mode="error" />;
      case 'profile':
        return <ProfilePage />;
    }
  };

  return (
    <AppShell
      user={user}
      activeRoute={activeRoute}
      onNavigate={navigate}
      onLogout={handleLogout}
      notifications={notifications}
      onNotificationClick={handleNotificationClick}
      onMarkNotificationRead={handleMarkNotificationRead}
      onDismissAllNotifications={handleDismissAllNotifications}
    >
      {/* Persistent banner across all Doctor pages when finished appointments await Completed / No-Show */}
      {user.role === 'DOCTOR' && pendingOutcomeAppointments.length > 0 && (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2.5">
            <ClipboardCheck className="h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
            <span>
              <span className="font-semibold">
                Post-Slot Outcome Required ({pendingOutcomeAppointments.length}):
              </span>{' '}
              Mark completed slot{pendingOutcomeAppointments.length === 1 ? '' : 's'} as Completed or No-Show so accurate records go to analytics.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOutcomeSnoozedSignature(null)}
            className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 whitespace-nowrap shrink-0"
          >
            Enter Outcomes ({pendingOutcomeAppointments.length})
          </button>
        </div>
      )}

      {/* Persistent non-ignorable bar across all Doctor pages until today's slots exist */}
      {doctorNeedsDailySlots && activeRoute !== 'dashboard' && (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <span>
              <span className="font-semibold">Mandatory Daily Reminder:</span> Please confirm &amp; generate your working-hours slots for today ({formatDisplayDate(todayIso)}).
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('slots')}
            className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900 whitespace-nowrap shrink-0"
          >
            Go to Slot Calendar
          </button>
        </div>
      )}

      {renderActiveRoute()}

      {/* One-time First-Login Shift Registration Modal for Doctors */}
      {user.role === 'DOCTOR' && (
        <DoctorShiftModal
          open={showShiftRegistrationModal}
          mode="register"
          doctorName={user.full_name}
          shift={dashboardData?.doctor_shift || null}
          onClose={() => setShiftModalDismissedForUser(user.user_id)}
          onCompleted={async () => {
            setShiftModalDismissedForUser(user.user_id);
            await loadDashboard();
          }}
        />
      )}

      {/* Mandatory Post-Slot Doctor Outcome Prompt Modal (Completed vs No-Show) */}
      {user.role === 'DOCTOR' && (
        <DoctorOutcomePromptModal
          open={showOutcomePromptModal}
          doctorName={user.full_name}
          appointments={pendingOutcomeAppointments}
          onClose={() => setOutcomeSnoozedSignature(pendingOutcomeSignature)}
          onOutcomeSubmitted={loadDashboard}
        />
      )}

      {/* Mandatory Daily Doctor Login Reminder Modal (Single Day Only) */}
      <Modal
        open={showDailyReminderModal}
        title="Daily Slot Confirmation Required"
        subtitle={`${user.full_name} · ${formatDisplayDate(todayIso)}`}
        onClose={() => setDailyModalDismissedForUser(user.user_id)}
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <div>
              <p className="font-semibold">No slots generated for today yet</p>
              <p className="mt-1 text-xs text-amber-900">
                It is mandatory to confirm your availability and generate OPD slots for today before patients can book appointments. Confirm all slots in your shift for today or pick individual slots on your calendar.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              disabled={quickGenerating}
              onClick={handleConfirmTodayForDoctor}
              className="flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              <span>{quickGenerating ? 'Confirming...' : 'Confirm Today’s Shift Slots'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDailyModalDismissedForUser(user.user_id);
                navigate('slots');
              }}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Pick Individual Slots on Calendar
            </button>
          </div>
        </div>
      </Modal>

      {/* Immediate Login Notifications Modal (Admin & Doctor) */}
      <Modal
        open={showLoginNotifModal}
        title={
          user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
            ? `New Requests Awaiting Review (${unreadNotifications.length})`
            : `New Updates & Appointments (${unreadNotifications.length})`
        }
        subtitle={`${user.full_name} · Notifications since your last check`}
        onClose={() => setNotifPopupDismissedForUser(user.user_id)}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {unreadNotifications.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => void handleNotificationClick(n)}
                className="flex w-full items-start justify-between gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-teal-50/50"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      n.severity === 'success'
                        ? 'bg-emerald-50 text-emerald-700'
                        : n.severity === 'warning'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-teal-50 text-teal-700'
                    }`}
                  >
                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{n.message}</p>
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      {formatDisplayDateTime(n.created_at)}
                    </p>
                  </div>
                </div>
                <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNotifPopupDismissedForUser(user.user_id)}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => void handleDismissAllNotifications()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Mark All as Read</span>
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BranchProvider>
          <PortalContent />
        </BranchProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
