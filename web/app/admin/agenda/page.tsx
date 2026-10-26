"use client";

import { useCallback, useEffect, useState } from "react";
import { api, brl, formatTime } from "@/lib/api";

type Appt = {
  id: string;
  startAt: string;
  status: string;
  totalAmount: string;
  depositAmount: string;
  service: { name: string };
  appointmentServices?: { sortOrder: number; service: { name: string } }[];
  client: { name: string; phone: string };
  professional: { name: string };
};

type Service = {
  id: string;
  name: string;
  price: string;
  durationMinutes: number;
  active: boolean;
};

const emptyForm = {
  serviceId: "",
  date: new Date().toISOString().slice(0, 10),
  time: "",
  clientName: "",
  clientPhone: "",
  clientEmail: "",
  notes: "",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending_payment: { label: "Aguardando sinal", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "Confirmado", cls: "bg-accent-50 text-accent-700 border-accent-200" },
  completed: { label: "Concluído", cls: "bg-sand-100 text-sand-600 border-sand-200" },
  cancelled: { label: "Cancelado", cls: "bg-sand-50 text-sand-400 border-sand-200" },
  no_show: { label: "Faltou", cls: "bg-red-50 text-red-600 border-red-200" },
  expired: { label: "Expirado", cls: "bg-sand-50 text-sand-400 border-sand-200" },
  removed: { label: "Removido", cls: "bg-sand-50 text-sand-400 border-sand-200" },
};

export default function AgendaPage() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Appt[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<Appt[]>(
        `/api/admin/appointments?from=${date}&to=${date}`,
        { auth: true },
      );
      setItems(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<Service[]>("/api/admin/services", { auth: true })
      .then((rows) => {
        const active = rows.filter((s) => s.active);
        setServices(active);
        setForm((current) => ({
          ...current,
          serviceId: current.serviceId || active[0]?.id || "",
        }));
      })
      .catch((e: any) => setError(e.message));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const shouldCreate = params.get("novo") === "1";

    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      setDate(requestedDate);
      setForm((current) => ({ ...current, date: requestedDate }));
    }
    if (shouldCreate) setShowForm(true);
  }, []);

  function toggleForm() {
    if (showForm) {
      setShowForm(false);
      return;
    }
    setError(null);
    setForm((current) => ({
      ...emptyForm,
      date,
      serviceId: current.serviceId || services[0]?.id || "",
    }));
    setShowForm(true);
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/api/admin/appointments", {
        method: "POST",
        auth: true,
        body: JSON.stringify({
          serviceId: form.serviceId,
          date: form.date,
          time: form.time,
          client: {
            name: form.clientName,
            phone: form.clientPhone,
            email: form.clientEmail || null,
          },
          notes: form.notes || null,
        }),
      });
      setDate(form.date);
      setShowForm(false);
      setForm({ ...emptyForm, serviceId: services[0]?.id || "", date: form.date });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await api(`/api/admin/appointments/${id}`, {
      method: "PATCH",
      auth: true,
      body: JSON.stringify({ status }),
    });
    load();
  }

  async function removeAppointment(id: string, clientName: string) {
    const ok = window.confirm(`Remover o agendamento de ${clientName} da agenda?`);
    if (!ok) return;

    setRemovingId(id);
    setError(null);
    try {
      await api(`/api/admin/appointments/${id}`, {
        method: "DELETE",
        auth: true,
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 rounded-lg border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/40 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-accent-700">
            Agenda
          </div>
          <h1 className="font-display text-3xl text-sand-900">Agenda do studio</h1>
          <p className="mt-1 text-sm text-sand-500">
            Acompanhe o dia, crie atendimentos manuais e atualize o status das clientes.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-sm font-medium text-accent-800 outline-none focus:border-accent-500 focus:bg-white"
          />
          <button
            type="button"
            onClick={toggleForm}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-accent-200/60 hover:bg-accent-700"
          >
            {showForm ? (
              <>
                <CloseIcon className="h-4 w-4" />
                Fechar
              </>
            ) : (
              <>
                <PlusIcon className="h-4 w-4" />
                Novo agendamento
              </>
            )}
          </button>
        </div>
      </section>

      {error && <p className="mb-4 text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={createAppointment} className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
          <div className="mb-5">
            <h2 className="font-display text-2xl text-sand-900">Agendamento manual</h2>
            <p className="mt-1 text-sm text-sand-500">
              O horário entra direto como confirmado e não cobra sinal por Pix.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sand-600">Serviço</span>
              <select
                required
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                className="w-full rounded-lg border border-sand-300 px-4 py-2.5 outline-none focus:border-sand-500"
              >
                {services.length === 0 && <option value="">Nenhum serviço ativo</option>}
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} - {brl(Number(s.price))}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Nome da cliente" value={form.clientName} onChange={(v) => setForm({ ...form, clientName: v })} />
            <Input label="Telefone" value={form.clientPhone} onChange={(v) => setForm({ ...form, clientPhone: v })} />
            <Input label="E-mail (opcional)" type="email" value={form.clientEmail} onChange={(v) => setForm({ ...form, clientEmail: v })} />
            <Input label="Data" type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
            <Input label="Horário" type="time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} />
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-sand-600">Observações (opcional)</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={500}
                className="min-h-24 w-full rounded-lg border border-sand-300 px-4 py-2.5 outline-none focus:border-sand-500"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={saving || services.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SaveIcon className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar agendamento"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-sand-300 px-5 py-2.5 text-sm font-medium text-sand-700 hover:bg-sand-50"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {loading && <p className="text-sand-400">Carregando…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded-lg border border-accent-100 bg-white p-6 text-sm text-sand-400 shadow-sm shadow-accent-100/40">
          Nenhum atendimento nesta data.
        </p>
      )}

      <div className="space-y-3">
        {items.map((a) => {
          const st = STATUS_LABEL[a.status] ?? { label: a.status, cls: "bg-sand-50 border-sand-200" };
          const serviceLabel = a.appointmentServices?.length
            ? a.appointmentServices
                .slice()
                .sort((first, second) => first.sortOrder - second.sortOrder)
                .map((item) => item.service.name)
                .join(" + ")
            : a.service.name;
          return (
            <div key={a.id} className="rounded-lg border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/40 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <span className="font-display text-xl text-sand-900">
                    {formatTime(a.startAt)}
                  </span>
                  <div>
                    <p className="font-medium text-sand-900">{a.client.name}</p>
                    <p className="text-xs text-sand-500">
                      {serviceLabel} · {brl(Number(a.totalAmount))} · {a.client.phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-medium ${st.cls}`}>
                    {st.label}
                  </span>
                  <button
                    type="button"
                    title="Remover agendamento"
                    aria-label={`Remover agendamento de ${a.client.name}`}
                    disabled={removingId === a.id}
                    onClick={() => removeAppointment(a.id, a.client.name)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {["confirmed", "pending_payment"].includes(a.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionBtn onClick={() => setStatus(a.id, "completed")}>Concluir</ActionBtn>
                  <ActionBtn onClick={() => setStatus(a.id, "no_show")} variant="warn">Faltou</ActionBtn>
                  <ActionBtn onClick={() => setStatus(a.id, "cancelled")} variant="danger">Cancelar</ActionBtn>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IconBase({
  children,
  className = "h-4 w-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
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

function PlusIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconBase>
  );
}

function SaveIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </IconBase>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-sand-600">{label}</span>
      <input
        required={!label.includes("opcional")}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-sand-300 px-4 py-2.5 outline-none focus:border-sand-500"
      />
    </label>
  );
}

function ActionBtn({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "warn" | "danger";
}) {
  const cls =
    variant === "danger"
      ? "border-red-200 text-red-600 hover:bg-red-50"
      : variant === "warn"
        ? "border-amber-200 text-amber-700 hover:bg-amber-50"
        : "border-sand-300 text-sand-700 hover:bg-sand-50";
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${cls}`}
    >
      {children}
    </button>
  );
}
