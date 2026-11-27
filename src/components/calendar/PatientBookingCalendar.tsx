import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Stethoscope,
  UserCheck,
  Video,
} from 'lucide-react';
import type { ConsultationMode, Department, Doctor, GlobalBranchMetadata, Patient, Slot } from '../../types/opd';
import { apiClient } from '../../services/apiClient';
import { useBranchContext } from '../../context/BranchContext';
import { useToast } from '../../context/ToastContext';
import {
  getHospitalNowParts,
  getMonthGridDates,
  isSlotEndExpired,
} from '../../utils/calendar';
import {
  filterDepartmentsByBranch,
  filterDoctorsByBranch,
  formatBranchCurrency,
  getDoctorEffectiveBranchFee,
} from '../../utils/globalBranch';
import { formatCurrencyInr, formatDisplayDate, getIsoDatePart } from '../../utils/rules';
import {
  AppointmentPaymentModal,
  type PaymentModalAppointmentDetails,
} from '../modals/AppointmentPaymentModal';

type SlotWithBranch = Slot & { branch_meta?: GlobalBranchMetadata | null };

interface PatientBookingCalendarProps {
  slots: SlotWithBranch[];
  doctors: Doctor[];
  departments: Department[];
  patients?: Patient[];
  isPatientRole: boolean;
  fixedPatientId?: number | null;
  onBooked: () => Promise<void> | void;
  onRefreshSlots?: () => Promise<void> | void;
  onCancel?: () => void;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PatientBookingCalendar({
  slots,
  doctors,
  departments,
  patients = [],
  isPatientRole,
  fixedPatientId,
  onBooked,
  onRefreshSlots,
  onCancel,
}: PatientBookingCalendarProps) {
  const { notify } = useToast();
  const {
    countries,
    branches,
    branchDepartments,
    doctorBranches,
    headquartersBranch,
    selectedCountryCode: workspaceCountryCode,
    selectedBranchId: workspaceBranchId,
  } = useBranchContext();

  const initialNow = getHospitalNowParts();
  const todayIso = initialNow.isoDate;

  const [viewYear, setViewYear] = useState(initialNow.year);
  const [viewMonth, setViewMonth] = useState(initialNow.monthIndex);
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const [bookCountryCode, setBookCountryCode] = useState<string>(workspaceCountryCode || 'ALL');
  const [bookBranchId, setBookBranchId] = useState<number | 'ALL'>(workspaceBranchId);

  const [selectedDeptId, setSelectedDeptId] = useState('ALL');
  const [selectedDoctorId, setSelectedDoctorId] = useState('ALL');
  const [selectedSlot, setSelectedSlot] = useState<SlotWithBranch | null>(null);
  const [consultationMode, setConsultationMode] = useState<ConsultationMode | ''>('');
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState(
    patients[0] ? String(patients[0].patient_id) : '',
  );
  const [bookingSource, setBookingSource] = useState<'ONLINE' | 'WALK_IN'>(
    isPatientRole ? 'ONLINE' : 'WALK_IN',
  );
  const [bookingBusy, setBookingBusy] = useState(false);
  const [pendingPayment, setPendingPayment] = useState<PaymentModalAppointmentDetails | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);

  useEffect(() => {
    setBookCountryCode(workspaceCountryCode || 'ALL');
    setBookBranchId(workspaceBranchId);
    setSelectedDeptId('ALL');
    setSelectedDoctorId('ALL');
    setSelectedSlot(null);
  }, [workspaceCountryCode, workspaceBranchId]);

  useEffect(() => {
    if (patients[0] && !selectedPatientId) {
      setSelectedPatientId(String(patients[0].patient_id));
    }
  }, [patients, selectedPatientId]);

  const activeCountries = useMemo(
    () => countries.filter((c) => c.is_active === 'Y'),
    [countries],
  );

  const branchesForSelectedCountry = useMemo(
    () =>
      branches.filter(
        (b) => b.is_active === 'Y' && (bookCountryCode === 'ALL' || b.country_code === bookCountryCode),
      ),
    [branches, bookCountryCode],
  );

  const selectedBranchObj = useMemo(
    () => (bookBranchId === 'ALL' ? null : branches.find((b) => b.branch_id === bookBranchId) || null),
    [branches, bookBranchId],
  );

  const branchFilteredDepartments = useMemo(() => {
    if (branches.length === 0) return departments;
    return filterDepartmentsByBranch(departments, branchDepartments, bookBranchId, branches);
  }, [departments, branchDepartments, bookBranchId, branches]);

  const branchFilteredDoctors = useMemo(() => {
    const baseDocs =
      branches.length === 0
        ? doctors
        : filterDoctorsByBranch(doctors, doctorBranches, bookBranchId, branches);
    if (selectedDeptId === 'ALL') return baseDocs;
    return baseDocs.filter((d) => String(d.department_id) === selectedDeptId);
  }, [doctors, doctorBranches, bookBranchId, branches, selectedDeptId]);

  const doctorById = useMemo(
    () => new Map(doctors.map((d) => [d.doctor_id, d])),
    [doctors],
  );

  const getSlotBranch = (slot: SlotWithBranch) => {
    const id = slot.branch_meta?.branch_id ?? headquartersBranch?.branch_id;
    return branches.find((b) => b.branch_id === id) || headquartersBranch;
  };

  const matchingAvailableSlots = useMemo(() => {
    const allowedDocIds = new Set(branchFilteredDoctors.map((d) => d.doctor_id));
    const countryBranchIds = new Set(branchesForSelectedCountry.map((b) => b.branch_id));

    return slots
      .filter((s) => {
        if (s.status !== 'AVAILABLE' || s.booked_patients >= s.max_patients_per_slot) return false;
        const dStr = getIsoDatePart(s.slot_date);
        if (!dStr) return false;
        if (isSlotEndExpired(dStr, s.start_time, s.end_time)) return false;

        if (branches.length > 0) {
          const slotBranchId = s.branch_meta?.branch_id ?? headquartersBranch?.branch_id;
          if (bookBranchId !== 'ALL') {
            if (slotBranchId !== bookBranchId) return false;
          } else if (bookCountryCode !== 'ALL') {
            if (!slotBranchId || !countryBranchIds.has(slotBranchId)) return false;
          }
        }

        if (selectedDoctorId !== 'ALL') {
          return String(s.doctor_id || '') === selectedDoctorId;
        }
        if (selectedDeptId !== 'ALL' || bookBranchId !== 'ALL') {
          return Boolean(s.doctor_id && allowedDocIds.has(s.doctor_id));
        }
        return true;
      })
      .sort((a, b) => {
        const dCmp = getIsoDatePart(a.slot_date).localeCompare(getIsoDatePart(b.slot_date));
        if (dCmp !== 0) return dCmp;
        return (a.start_time || '').localeCompare(b.start_time || '');
      });
  }, [
    slots,
    branchFilteredDoctors,
    branchesForSelectedCountry,
    branches.length,
    headquartersBranch?.branch_id,
    bookBranchId,
    bookCountryCode,
    selectedDoctorId,
    selectedDeptId,
  ]);

  const availableCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of matchingAvailableSlots) {
      const d = getIsoDatePart(s.slot_date);
      map.set(d, (map.get(d) || 0) + 1);
    }
    return map;
  }, [matchingAvailableSlots]);

  useEffect(() => {
    if (availableCountByDate.size === 0) return;
    if ((availableCountByDate.get(selectedDate) || 0) > 0) return;
    const firstAvailDate = Array.from(availableCountByDate.keys()).sort()[0];
    if (firstAvailDate) {
      setSelectedDate(firstAvailDate);
      const [y, m] = firstAvailDate.split('-').map(Number);
      if (y && m) {
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  }, [availableCountByDate, selectedDate]);

  const slotsForSelectedDate = useMemo(
    () =>
      matchingAvailableSlots.filter(
        (s) => getIsoDatePart(s.slot_date) === selectedDate,
      ),
    [matchingAvailableSlots, selectedDate],
  );

  const gridCells = useMemo(
    () => getMonthGridDates(viewYear, viewMonth, todayIso),
    [viewYear, viewMonth, todayIso],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlot) return;
    setBookingError(null);

    if (isSlotEndExpired(selectedSlot.slot_date, selectedSlot.start_time, selectedSlot.end_time)) {
      const msg = 'Selected slot end time has already passed. Available slots have been refreshed.';
      setBookingError(msg);
      notify(msg, 'error');
      setSelectedSlot(null);
      await onRefreshSlots?.();
      return;
    }

    if (!consultationMode) {
      const msg = 'Please select a mandatory Consultation Mode (Online Consultation or Face-to-Face Consultation).';
      setBookingError(msg);
      notify(msg, 'error');
      return;
    }

    const patientIdToUse = isPatientRole ? fixedPatientId : Number(selectedPatientId);
    if (!patientIdToUse) {
      notify('Please select a patient record before booking', 'error');
      return;
    }

    const targetBranch = getSlotBranch(selectedSlot);
    const doc = selectedSlot.doctor_id ? doctorById.get(selectedSlot.doctor_id) : undefined;
    const patientObj = patients.find((p) => p.patient_id === patientIdToUse);
    const feeInfo = getDoctorEffectiveBranchFee({
      doctor: doc,
      branch: targetBranch,
      countries,
      doctorBranches,
      branchDepartments,
    });

    setBookingBusy(true);
    try {
      const res = targetBranch
        ? await apiClient.bookGlobalAppointment({
            patient_id: patientIdToUse,
            slot_id: selectedSlot.slot_id,
            branch_id: targetBranch.branch_id,
            booking_source: isPatientRole ? 'ONLINE' : bookingSource,
            consultation_mode: consultationMode,
          })
        : await apiClient.bookAppointment({
            patient_id: patientIdToUse,
            slot_id: selectedSlot.slot_id,
            booking_source: isPatientRole ? 'ONLINE' : bookingSource,
            consultation_mode: consultationMode,
          });

      if (res.appointment_id && res.appointment_id > 0) {
        setPendingPayment({
          appointment_id: res.appointment_id,
          appointment_ref: res.appointment_ref || `APT#${res.appointment_id}`,
          doctor_name:
            selectedSlot.doctor_name ||
            (doc ? `Dr. ${doc.first_name} ${doc.last_name}` : `Doctor #${selectedSlot.doctor_id || ''}`),
          department_name: selectedSlot.department_name || 'OPD',
          patient_name: patientObj ? `${patientObj.first_name} ${patientObj.last_name}` : undefined,
          slot_date: selectedSlot.slot_date,
          start_time: selectedSlot.start_time,
          end_time: selectedSlot.end_time,
          consultation_mode: consultationMode,
          consultation_fee: feeInfo.base_inr_amount,
          branch_id: targetBranch?.branch_id ?? null,
          branch_name: targetBranch?.branch_name ?? null,
          country_name: targetBranch?.country_name ?? null,
          local_currency: feeInfo.currency_code,
          local_amount: feeInfo.local_amount,
        });
        setSelectedSlot(null);
        setConsultationMode('');
        setBookingError(null);
        await onRefreshSlots?.();
      } else {
        notify(
          `Appointment booked successfully (${res.appointment_ref || 'Ref generated'})${targetBranch ? ` · ${targetBranch.branch_name}` : ''}`,
          'success',
        );
        setSelectedSlot(null);
        setConsultationMode('');
        setBookingError(null);
        await onBooked();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to book appointment';
      setBookingError(msg);
      notify(msg, 'error');
      setSelectedSlot(null);
      await onRefreshSlots?.();
    } finally {
      setBookingBusy(false);
    }
  };

  const handlePayAndConfirm = async (paymentMethod: 'UPI' | 'CARD' | 'NET_BANKING' | 'CASH') => {
    if (!pendingPayment) return;
    setPaymentBusy(true);
    try {
      const res = pendingPayment.branch_id
        ? await apiClient.payAndConfirmGlobalAppointment(pendingPayment.appointment_id, {
            payment_method: paymentMethod,
            branch_id: pendingPayment.branch_id,
          })
        : await apiClient.payAndConfirmAppointment(pendingPayment.appointment_id, {
            payment_method: paymentMethod,
          });
      const paidDisplay =
        pendingPayment.local_currency &&
        pendingPayment.local_currency !== 'INR' &&
        pendingPayment.local_amount != null
          ? formatBranchCurrency(pendingPayment.local_amount, pendingPayment.local_currency)
          : formatCurrencyInr(pendingPayment.consultation_fee);
      notify(
        `Payment ${paidDisplay} (${res.payment_ref || paymentMethod}) succeeded — slot ${pendingPayment.appointment_ref} is now booked & confirmed!`,
        'success',
      );
      setPendingPayment(null);
      await onBooked();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Unable to complete payment', 'error');
    } finally {
      setPaymentBusy(false);
    }
  };

  const handlePayLater = async () => {
    if (!pendingPayment) return;
    notify(
      `Booking ${pendingPayment.appointment_ref} placed on 10-minute hold. Pay consultation fee from My Appointments to confirm.`,
      'info',
    );
    setPendingPayment(null);
    await onBooked();
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        {branches.length > 0 && (
          <>
            <div>
              <label htmlFor="cal-book-country" className="block text-xs font-medium text-slate-600">
                Country
              </label>
              <select
                id="cal-book-country"
                value={bookCountryCode}
                onChange={(e) => {
                  const nextCode = e.target.value;
                  setBookCountryCode(nextCode);
                  if (nextCode === 'ALL') {
                    setBookBranchId('ALL');
                  } else {
                    const match = branches.find((b) => b.country_code === nextCode && b.is_active === 'Y');
                    setBookBranchId(match ? match.branch_id : 'ALL');
                  }
                  setSelectedDeptId('ALL');
                  setSelectedDoctorId('ALL');
                  setSelectedSlot(null);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="ALL">All Countries ({activeCountries.length})</option>
                {activeCountries.map((c) => (
                  <option key={c.country_code} value={c.country_code}>
                    {c.country_name} ({c.currency_code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cal-book-branch" className="block text-xs font-medium text-slate-600">
                Hospital Branch
              </label>
              <select
                id="cal-book-branch"
                value={String(bookBranchId)}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'ALL') {
                    setBookBranchId('ALL');
                  } else {
                    const nextId = Number(val);
                    setBookBranchId(nextId);
                    const b = branches.find((item) => item.branch_id === nextId);
                    if (b && bookCountryCode !== 'ALL' && b.country_code !== bookCountryCode) {
                      setBookCountryCode(b.country_code);
                    }
                  }
                  setSelectedDeptId('ALL');
                  setSelectedDoctorId('ALL');
                  setSelectedSlot(null);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="ALL">All Branches ({branchesForSelectedCountry.length})</option>
                {branchesForSelectedCountry.map((b) => (
                  <option key={b.branch_id} value={String(b.branch_id)}>
                    {b.branch_name} ({b.city})
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {!isPatientRole && (
          <>
            <div>
              <label htmlFor="cal-book-patient" className="block text-xs font-medium text-slate-600">
                Patient *
              </label>
              <select
                id="cal-book-patient"
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                {patients.map((p) => (
                  <option key={p.patient_id} value={String(p.patient_id)}>
                    {p.first_name} {p.last_name} ({p.phone_number})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="cal-book-source" className="block text-xs font-medium text-slate-600">
                Booking Source *
              </label>
              <select
                id="cal-book-source"
                value={bookingSource}
                onChange={(e) => setBookingSource(e.target.value as 'ONLINE' | 'WALK_IN')}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
              >
                <option value="WALK_IN">Walk-in (Confirmed)</option>
                <option value="ONLINE">Online (10-min Hold)</option>
              </select>
            </div>
          </>
        )}

        <div>
          <label htmlFor="cal-book-dept" className="block text-xs font-medium text-slate-600">
            Department {selectedBranchObj ? `(${selectedBranchObj.city})` : ''}
          </label>
          <select
            id="cal-book-dept"
            value={selectedDeptId}
            onChange={(e) => {
              setSelectedDeptId(e.target.value);
              setSelectedDoctorId('ALL');
              setSelectedSlot(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Available Departments</option>
            {branchFilteredDepartments.map((d) => (
              <option key={d.department_id} value={String(d.department_id)}>
                {d.department_name}
                {'is_specialized' in d && d.is_specialized ? ' (Specialized)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cal-book-doc" className="block text-xs font-medium text-slate-600">
            Doctor
          </label>
          <select
            id="cal-book-doc"
            value={selectedDoctorId}
            onChange={(e) => {
              setSelectedDoctorId(e.target.value);
              setSelectedSlot(null);
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-700 focus:outline-none"
          >
            <option value="ALL">All Available Doctors</option>
            {branchFilteredDoctors.map((d) => {
              const feeInfo = getDoctorEffectiveBranchFee({
                doctor: d,
                branch: selectedBranchObj,
                countries,
                doctorBranches,
                branchDepartments,
              });
              return (
                <option key={d.doctor_id} value={String(d.doctor_id)}>
                  Dr. {d.first_name} {d.last_name} (
                  {formatBranchCurrency(feeInfo.local_amount, feeInfo.currency_code)})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Calendar + Slots Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <CalendarIcon className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <span>Appointment Calendar</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Highlighted dates have confirmed doctor slots open for booking.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const cur = getHospitalNowParts();
                setViewYear(cur.year);
                setViewMonth(cur.monthIndex);
                setSelectedDate(cur.isoDate);
                setSelectedSlot(null);
                setBookingError(null);
              }}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold text-slate-900">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500">
            {WEEKDAY_SHORT.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {gridCells.map((cell) => {
              const openCount = availableCountByDate.get(cell.isoDate) || 0;
              const isSelected = cell.isoDate === selectedDate;
              return (
                <button
                  key={cell.isoDate}
                  type="button"
                  disabled={cell.isPast}
                  onClick={() => {
                    setSelectedDate(cell.isoDate);
                    setSelectedSlot(null);
                  }}
                  aria-label={`Choose ${cell.isoDate}`}
                  className={`flex min-h-[54px] flex-col items-center justify-between rounded-lg border p-1.5 text-xs transition-colors ${
                    cell.isPast
                      ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300'
                      : isSelected
                        ? 'border-teal-700 bg-teal-50 text-teal-950 ring-2 ring-teal-700/20'
                        : openCount > 0
                          ? 'border-emerald-200 bg-emerald-50/40 text-slate-900 hover:bg-emerald-50'
                          : cell.inCurrentMonth
                            ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            : 'border-slate-100 bg-slate-50/50 text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      cell.isToday && !cell.isPast ? 'font-bold text-teal-700' : 'font-medium'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>
                  {!cell.isPast && openCount > 0 ? (
                    <span className="rounded bg-teal-700 px-1 font-mono text-[10px] font-medium text-white tabular-nums">
                      {openCount}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-300">·</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Right: Available Slots on Selected Date + Confirmation */}
        <section className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-7">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Available Slots · {formatDisplayDate(selectedDate)}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedBranchObj
                    ? `${selectedBranchObj.branch_name} (${selectedBranchObj.city}, ${selectedBranchObj.country_code}) · ${selectedBranchObj.timezone_iana}`
                    : 'Select a confirmed doctor time slot below to book your appointment.'}
                </p>
              </div>
              <span className="rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-medium text-slate-700 tabular-nums">
                {slotsForSelectedDate.length} open
              </span>
            </div>

            {slotsForSelectedDate.length === 0 ? (
              <div className="my-8 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <Stethoscope className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-slate-800">
                  No open doctor slots{selectedBranchObj ? ` at ${selectedBranchObj.branch_name}` : ''} on {formatDisplayDate(selectedDate)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Try another highlighted date on the calendar or switch the Country, Branch, Department, or Doctor filter.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid max-h-[340px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {slotsForSelectedDate.map((slot) => {
                  const doc = slot.doctor_id ? doctorById.get(slot.doctor_id) : undefined;
                  const slotBranch = getSlotBranch(slot);
                  const feeInfo = getDoctorEffectiveBranchFee({
                    doctor: doc,
                    branch: slotBranch,
                    countries,
                    doctorBranches,
                    branchDepartments,
                  });
                  const isPicked = selectedSlot?.slot_id === slot.slot_id;
                  return (
                    <button
                      key={slot.slot_id}
                      type="button"
                      onClick={() => {
                        setSelectedSlot(slot);
                        setBookingError(null);
                      }}
                      className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                        isPicked
                          ? 'border-teal-700 bg-teal-50 ring-2 ring-teal-700/20'
                          : 'border-slate-200 bg-white hover:border-teal-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                          <Clock className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                          <span>
                            {slot.start_time} – {slot.end_time}
                          </span>
                        </span>
                        {doc && (
                          <span className="font-mono text-xs font-semibold text-teal-800 tabular-nums">
                            {formatBranchCurrency(feeInfo.local_amount, feeInfo.currency_code)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-slate-900">
                        {slot.doctor_name || (slot.doctor_id ? `Doctor #${slot.doctor_id}` : 'Assigned Doctor')}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span>{slot.department_name || 'Outpatient'}</span>
                        {slotBranch && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{slotBranch.city}</span>
                          </>
                        )}
                        {doc?.tele_consult_flag === 'Y' && (
                          <span className="inline-flex items-center gap-1 text-teal-700">
                            <span aria-hidden="true">·</span>
                            <Video className="h-3 w-3" aria-hidden="true" />
                            <span>Tele-consult</span>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected Booking Summary, Mandatory Consultation Mode & Submit */}
          <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
            {bookingError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                <span>{bookingError}</span>
              </div>
            )}

            {selectedSlot ? (
              <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    Consultation Mode * <span className="font-normal text-slate-600">(Required)</span>
                  </p>
                  <div
                    role="radiogroup"
                    aria-label="Consultation Mode"
                    aria-required="true"
                    className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={consultationMode === 'ONLINE'}
                      onClick={() => {
                        setConsultationMode('ONLINE');
                        setBookingError(null);
                      }}
                      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                        consultationMode === 'ONLINE'
                          ? 'border-sky-600 bg-sky-50 ring-2 ring-sky-600/20'
                          : 'border-slate-200 bg-white hover:border-sky-400'
                      }`}
                    >
                      <Video
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          consultationMode === 'ONLINE' ? 'text-sky-600' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-900">Online Consultation</p>
                        <p className="text-[11px] text-slate-500">
                          Remote OPD consultation (ONLINE)
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      role="radio"
                      aria-checked={consultationMode === 'FACE_TO_FACE'}
                      onClick={() => {
                        setConsultationMode('FACE_TO_FACE');
                        setBookingError(null);
                      }}
                      className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                        consultationMode === 'FACE_TO_FACE'
                          ? 'border-teal-700 bg-teal-50 ring-2 ring-teal-700/20'
                          : 'border-slate-200 bg-white hover:border-teal-500'
                      }`}
                    >
                      <UserCheck
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          consultationMode === 'FACE_TO_FACE' ? 'text-teal-700' : 'text-slate-400'
                        }`}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          Face-to-Face Consultation
                        </p>
                        <p className="text-[11px] text-slate-500">
                          In-person hospital OPD visit (FACE_TO_FACE)
                        </p>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-teal-200/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-semibold text-teal-950">
                      {selectedSlot.doctor_name} · {formatDisplayDate(selectedSlot.slot_date)} ({selectedSlot.start_time} – {selectedSlot.end_time})
                    </p>
                    <p className="mt-0.5 text-xs text-teal-800">
                      {getSlotBranch(selectedSlot)?.branch_name || 'Headquarters'}
                      {' · '}
                      {isPatientRole
                        ? 'Creates an ONLINE appointment with a 10-minute payment hold.'
                        : `Booking mode: ${bookingSource === 'WALK_IN' ? 'Walk-in (Confirmed)' : 'Online (10-min Hold)'}`}
                      {consultationMode
                        ? ` · ${consultationMode === 'ONLINE' ? 'Online' : 'Face-to-Face'}`
                        : ' · Select mode above'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {onCancel && (
                      <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleConfirmBooking}
                      disabled={bookingBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                    >
                      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                      <span>{bookingBusy ? 'Booking...' : 'Confirm & Book Appointment'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Click an available time slot above to select consultation mode and confirm your booking.</span>
                {onCancel && (
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Back
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <AppointmentPaymentModal
        open={Boolean(pendingPayment)}
        appointment={pendingPayment}
        onPayAndConfirm={handlePayAndConfirm}
        allowPayLater={isPatientRole || bookingSource === 'ONLINE'}
        onPayLater={() => void handlePayLater()}
        onClose={() => void handlePayLater()}
        busy={paymentBusy}
      />
    </div>
  );
}
