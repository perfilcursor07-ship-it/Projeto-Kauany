"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, brl, formatTime } from "@/lib/api";

type DashboardAppointment = {
  id: string;
  time: string;
  client: string;
  phone: string;
  service: string;
  status: string;
  paymentStatus: string;
  total: number;
  deposit: number;
};

type MonthDay = {
  date: string;
  count: number;
  pendingDeposit: number;
  expected: number;
};

type Dashboard = {
  today: {
    count: number;
    completed: number;
    remaining: number;
    pendingDeposit: number;
    needsStatus: number;
    expectedRevenue: number;
    receivedDeposits: number;
    toReceive: number;
  };
  month: {
    key: string;
    start: string;
    end: string;
    count: number;
    completed: number;
    pendingDeposit: number;
    expectedRevenue: number;
    received: number;
    toReceive: number;
    days: MonthDay[];
    appointments: DashboardAppointment[];
  };
  next: {
    id: string;
    time: string;
    client: string;
    phone: string;
    service: string;
    total: number;
    deposit: number;
    depositPaid: boolean;
  } | null;
  appointments: DashboardAppointment[];
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Aguardando sinal", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "Confirmado", cls: "bg-accent-50 text-accent-700 border-accent-200" },
  completed: { label: "Concluído", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelado", cls: "bg-sand-50 text-sand-500 border-sand-200" },
  no_show: { label: "Faltou", cls: "bg-red-50 text-red-600 border-red-200" },
  expired: { label: "Expirado", cls: "bg-sand-50 text-sand-500 border-sand-200" },
};

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(() => localDateKey(new Date()));

  useEffect(() => {
    api<Dashboard>("/api/admin/dashboard", { auth: true })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const todayKey = localDateKey(new Date());

  const dayMap = useMemo(() => {
    const map = new Map<string, MonthDay>();
    data?.month.days.forEach((day) => map.set(day.date, day));
    return map;
  }, [data]);

  const dayList = useMemo(() => {
    if (!data) return [];
    if (selected === todayKey) return data.appointments;
    return data.month.appointments.filter((item) => localDateKey(new Date(item.time)) === selected);
  }, [data, selected, todayKey]);

  const dayMoney = useMemo(() => {
    const expected = dayList.reduce((sum, item) => sum + item.total, 0);
    const received = dayList.reduce((sum, item) => sum + receivedOf(item), 0);
    return { expected, received, toReceive: Math.max(expected - received, 0) };
  }, [dayList]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Não foi possível carregar a dashboard: {error}
      </div>
    );
  }
  if (!data) return <DashboardSkeleton />;

  const pending = data.today.pendingDeposit + data.today.needsStatus;
  const isToday = selected === todayKey;
  const cells = monthCells(data.month.start);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl leading-tight text-sand-900">{formatLongDate(new Date())}</h1>
          <p className="mt-0.5 text-sm text-sand-500">
            {data.today.count === 0
              ? "Nenhum atendimento hoje"
              : `${data.today.count} atendimento${data.today.count === 1 ? "" : "s"} hoje · ${data.today.remaining} restante${data.today.remaining === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/agenda?date=${selected}&novo=1`}
            className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
          >
            <PlusIcon className="h-4 w-4" />
            Novo agendamento
          </Link>
          <Link
            href={`/admin/agenda?date=${selected}`}
            className="inline-flex items-center gap-2 rounded-lg border border-accent-200 bg-white px-4 py-2.5 text-sm font-semibold text-accent-800 hover:bg-accent-50"
          >
            <CalendarIcon className="h-4 w-4" />
            Agenda
          </Link>
        </div>
      </header>

      {data.next && (
        <Link
          href={`/admin/agenda?date=${todayKey}`}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-accent-200 bg-accent-50/70 px-4 py-3 transition hover:bg-accent-50"
        >
          <span className="flex h-11 w-16 shrink-0 items-center justify-center rounded-lg bg-white font-display text-lg text-accent-800 shadow-sm">
            {formatTime(data.next.time)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-sand-900">
              {data.next.client} <span className="font-normal text-sand-500">· {data.next.service}</span>
            </p>
            <p className="mt-0.5 text-xs text-accent-700">Próximo atendimento {timeUntil(data.next.time)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-lg text-sand-900">{brl(data.next.total)}</span>
            <PaymentPill paid={data.next.depositPaid} deposit={data.next.deposit} />
          </div>
        </Link>
      )}

      {pending > 0 && (
        <Link
          href={`/admin/agenda?date=${todayKey}`}
          className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 transition hover:bg-amber-100"
        >
          <AlertIcon className="h-4 w-4 shrink-0 text-amber-700" />
          <span className="flex-1">
            {[
              data.today.pendingDeposit > 0 && `${data.today.pendingDeposit} aguardando sinal`,
              data.today.needsStatus > 0 && `${data.today.needsStatus} sem conclusão`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <ArrowRightIcon className="h-4 w-4 shrink-0" />
        </Link>
      )}

      <section className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="rounded-xl border border-accent-100 bg-white shadow-sm shadow-accent-100/30">
          <div className="flex items-center justify-between gap-3 border-b border-accent-50 px-4 py-3">
            <div>
              <h2 className="font-display text-lg text-sand-900">
                {isToday ? "Agenda de hoje" : `Agenda de ${formatShortDate(selected)}`}
              </h2>
              <p className="text-xs text-sand-500">
                {dayList.length} atendimento{dayList.length === 1 ? "" : "s"}
                {dayMoney.expected > 0 && ` · previsto ${brl(dayMoney.expected)}`}
              </p>
            </div>
            {!isToday && (
              <button
                type="button"
                onClick={() => setSelected(todayKey)}
                className="shrink-0 rounded-lg border border-accent-200 px-2.5 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-50"
              >
                Voltar para hoje
              </button>
            )}
          </div>

          <div className="divide-y divide-accent-50">
            {dayList.length === 0 ? (
              <div className="flex items-center gap-2.5 px-4 py-8 text-sm text-sand-400">
                <CalendarIcon className="h-4 w-4 text-accent-300" />
                Nenhum atendimento neste dia.
              </div>
            ) : (
              dayList.map((appointment) => <DayRow key={appointment.id} appointment={appointment} />)
            )}
          </div>

          {dayList.length > 0 && (
            <div className="grid grid-cols-3 divide-x divide-accent-50 border-t border-accent-50 text-center">
              <MiniStat label="Recebido" value={brl(dayMoney.received)} tone="emerald" />
              <MiniStat label="A receber" value={brl(dayMoney.toReceive)} />
              <MiniStat label="Previsto" value={brl(dayMoney.expected)} />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/30">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-sand-900">{formatMonthName(data.month.start)}</h2>
            <span className="text-xs font-semibold text-accent-700">{data.month.count} no mês</span>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-sand-400">
            {WEEKDAYS.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, index) => {
              if (!cell) return <span key={`empty-${index}`} />;
              const day = dayMap.get(cell.key);
              const isSelected = cell.key === selected;
              const isCurrent = cell.key === todayKey;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelected(cell.key)}
                  title={
                    day
                      ? `${day.count} atendimento${day.count === 1 ? "" : "s"} · ${brl(day.expected)}`
                      : "Sem atendimentos"
                  }
                  className={`relative flex h-10 flex-col items-center justify-center rounded-lg text-sm transition ${
                    isSelected
                      ? "bg-accent-600 font-bold text-white"
                      : day
                        ? "bg-accent-50 font-semibold text-accent-800 hover:bg-accent-100"
                        : "text-sand-400 hover:bg-sand-50"
                  } ${isCurrent && !isSelected ? "ring-1 ring-accent-400" : ""}`}
                >
                  {cell.day}
                  {day && (
                    <span className="mt-0.5 flex gap-0.5">
                      {Array.from({ length: Math.min(day.count, 3) }).map((_, dot) => (
                        <span
                          key={dot}
                          className={`h-1 w-1 rounded-full ${
                            isSelected
                              ? "bg-white"
                              : dot < day.pendingDeposit
                                ? "bg-amber-500"
                                : "bg-accent-600"
                          }`}
                        />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-2 border-t border-accent-50 pt-3 text-sm">
            <SummaryRow label="Concluídos" value={`${data.month.completed} de ${data.month.count}`} />
            <SummaryRow label="Recebido" value={brl(data.month.received)} tone="emerald" />
            <SummaryRow label="A receber" value={brl(data.month.toReceive)} />
            {data.month.pendingDeposit > 0 && (
              <SummaryRow label="Sinais pendentes" value={String(data.month.pendingDeposit)} tone="amber" />
            )}
            <div className="h-1.5 overflow-hidden rounded-full bg-sand-100">
              <div
                className="h-full rounded-full bg-accent-600"
                style={{ width: `${progress(data.month.received, data.month.expectedRevenue)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-sand-400">
              <span>Previsto {brl(data.month.expectedRevenue)}</span>
              <Link href="/admin/financeiro" className="font-semibold text-accent-700 hover:text-accent-800">
                Financeiro →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function DayRow({ appointment }: { appointment: DashboardAppointment }) {
  const status = statusOf(appointment.status);
  const agendaDate = localDateKey(new Date(appointment.time));
  return (
    <Link
      href={`/admin/agenda?date=${agendaDate}`}
      className="flex items-center gap-3 px-4 py-3 transition hover:bg-accent-50/60"
    >
      <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-accent-50 font-display text-base text-accent-800">
        {formatTime(appointment.time)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-sand-900">{appointment.client}</p>
        <p className="truncate text-xs text-sand-500">
          {appointment.service} · {formatPhone(appointment.phone)}
        </p>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-sm font-semibold text-sand-900">{brl(appointment.total)}</p>
        <p className="text-[11px] text-sand-400">
          {appointment.paymentStatus === "paid" || appointment.status === "completed"
            ? "sinal pago"
            : appointment.deposit > 0
              ? `sinal ${brl(appointment.deposit)}`
              : "sem sinal"}
        </p>
      </div>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>
        {status.label}
      </span>
    </Link>
  );
}

function PaymentPill({ paid, deposit }: { paid: boolean; deposit: number }) {
  if (deposit <= 0) {
    return (
      <span className="rounded-full border border-sand-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-sand-600">
        Sem sinal
      </span>
    );
  }
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        paid
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {paid ? "Sinal pago" : "Sinal pendente"}
    </span>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="px-2 py-2.5">
      <p className="text-[10px] font-semibold uppercase text-sand-400">{label}</p>
      <p className={`text-sm font-semibold ${tone === "emerald" ? "text-emerald-700" : "text-sand-900"}`}>
        {value}
      </p>
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-sand-900";
  return (
    <div className="flex items-center justify-between">
      <span className="text-sand-500">{label}</span>
      <strong className={cls}>{value}</strong>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-14 animate-pulse rounded-xl bg-accent-50" />
      <div className="h-16 animate-pulse rounded-xl bg-accent-50/60" />
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="h-80 animate-pulse rounded-xl bg-sand-50" />
        <div className="h-80 animate-pulse rounded-xl bg-sand-50" />
      </div>
    </div>
  );
}

function receivedOf(appointment: DashboardAppointment) {
  if (appointment.status === "completed") return appointment.total;
  if (appointment.paymentStatus === "paid") return appointment.deposit;
  return 0;
}

function statusOf(status: string) {
  return STATUS_LABEL[status] ?? { label: status, cls: "bg-sand-50 text-sand-500 border-sand-200" };
}

/** Celulas do mes comecando na segunda-feira; `null` preenche o espaco antes do dia 1. */
function monthCells(monthStart: string) {
  const start = new Date(monthStart);
  const year = start.getFullYear();
  const month = start.getMonth();
  const total = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;

  const cells: ({ day: number; key: string } | null)[] = Array.from({ length: offset }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push({ day, key: localDateKey(new Date(year, month, day)) });
  }
  return cells;
}

function formatMonthName(monthStart: string) {
  const text = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(monthStart));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatLongDate(date: Date) {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatShortDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long" }).format(new Date(year, month - 1, day));
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 11) return phone;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function progress(received: number, expected: number) {
  if (expected <= 0) return 0;
  return Math.min(Math.round((received / expected) * 100), 100);
}

function timeUntil(time: string) {
  const minutes = Math.max(Math.round((new Date(time).getTime() - Date.now()) / 60000), 0);
  if (minutes < 60) return `em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `em ${hours}h ${rest}min` : `em ${hours}h`;
}

function IconBase({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M7 3v4" />
      <path d="M17 3v4" />
      <path d="M4 8h16" />
      <rect x="4" y="5" width="16" height="16" rx="3" />
    </IconBase>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 4.2 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    </IconBase>
  );
}
