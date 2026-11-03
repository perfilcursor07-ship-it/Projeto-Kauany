"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, brl, formatTime } from "@/lib/api";

type Appt = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  paymentStatus: string;
  totalAmount: string;
  depositAmount: string;
  // Calculados no backend a partir dos pagamentos liquidados.
  paidAmount: string;
  remainingAmount: string;
  paidAt: string | null;
  notes: string | null;
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

// Data de hoje no fuso local. new Date().toISOString() converte para UTC e,
// no Brasil, devolve o dia seguinte depois das 21h.
function todayIso() {
  const d = new Date();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function shiftIso(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function longDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

// Telefone no formato (DD) 9XXXX-XXXX.
function prettyPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (local.length < 10) return phone;
  const rest = local.slice(2);
  return `(${local.slice(0, 2)}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
}

// Link do WhatsApp da cliente (normaliza o DDI 55).
function waPhoneLink(phone: string) {
  const d = phone.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
}

// Data curta do pagamento do sinal, para o rodape da celula.
function paidHint(paidAt: string | null) {
  if (!paidAt) return undefined;
  return new Date(paidAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Periodos do dia: agrupar deixa a leitura da agenda muito mais rapida.
const PERIODS = [
  { label: "Manhã", from: 0, to: 12 },
  { label: "Tarde", from: 12, to: 18 },
  { label: "Noite", from: 18, to: 24 },
];

// Cancelado / faltou nao entram nas contas do dia.
const DEAD_STATUSES = ["cancelled", "no_show", "expired", "removed"];

const emptyForm = {
  serviceId: "",
  date: todayIso(),
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
  const [date, setDate] = useState(todayIso());
  const [items, setItems] = useState<Appt[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [chargingId, setChargingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A pagina monta com a data de hoje e so depois le ?date= da URL, entao duas
  // buscas saem quase juntas. Sem este contador a resposta da primeira chega
  // por ultimo e apaga a lista da data pedida.
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api<Appt[]>(
        `/api/admin/appointments?from=${date}&to=${date}`,
        { auth: true },
      );
      if (seq !== reqSeq.current) return; // resposta de uma data ja trocada
      setItems(r);
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setError(e.message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
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

  // Cancelados / faltas nao entram no dinheiro do dia.
  const live = items.filter((a) => !DEAD_STATUSES.includes(a.status));
  const summary = {
    count: live.length,
    total: live.reduce((sum, a) => sum + Number(a.totalAmount), 0),
    paid: live.reduce((sum, a) => sum + Number(a.paidAmount), 0),
    remaining: live.reduce((sum, a) => sum + Number(a.remainingAmount), 0),
  };

  const groups = PERIODS.map((period) => ({
    label: period.label,
    items: items.filter((a) => {
      const hour = new Date(a.startAt).getHours();
      return hour >= period.from && hour < period.to;
    }),
  })).filter((group) => group.items.length > 0);

  // Cobranca manual do sinal: usada quando o envio automatico falhou ou quando
  // o agendamento e anterior a essa funcionalidade existir.
  async function chargeDeposit(id: string, clientName: string) {
    setChargingId(id);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ renewed: boolean; minutes: number | null }>(
        `/api/admin/appointments/${id}/charge-reminder`,
        { method: "POST", auth: true },
      );
      setNotice(
        r.renewed
          ? `Cobrança enviada para ${clientName}. A reserva foi reaberta por ${r.minutes} minutos.`
          : `Cobrança enviada para ${clientName}.`,
      );
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChargingId(null);
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
          <p className="mt-1 text-sm capitalize text-sand-500">{longDate(date)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex items-center gap-1 rounded-lg border border-accent-200 bg-accent-50 p-1">
            <button
              type="button"
              aria-label="Dia anterior"
              onClick={() => setDate(shiftIso(date, -1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-accent-700 transition hover:bg-white"
            >
              <ChevronIcon className="h-4 w-4 rotate-180" />
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border-0 bg-transparent px-1 py-1 text-sm font-medium text-accent-800 outline-none"
            />
            <button
              type="button"
              aria-label="Próximo dia"
              onClick={() => setDate(shiftIso(date, 1))}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-accent-700 transition hover:bg-white"
            >
              <ChevronIcon className="h-4 w-4" />
            </button>
          </div>
          {date !== todayIso() && (
            <button
              type="button"
              onClick={() => setDate(todayIso())}
              className="rounded-lg border border-sand-300 px-3 py-2 text-sm font-medium text-sand-700 transition hover:bg-sand-50"
            >
              Hoje
            </button>
          )}
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
      {notice && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

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

      {/* Resumo do dia: quanto entra, quanto ja foi pago em sinal e o que ainda
          falta receber no atendimento. */}
      {!loading && live.length > 0 && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Atendimentos" value={String(summary.count)} />
          <SummaryCard label="Total do dia" value={brl(summary.total)} />
          <SummaryCard label="Sinal recebido" value={brl(summary.paid)} tone="good" />
          <SummaryCard label="A receber no dia" value={brl(summary.remaining)} tone="warn" />
        </section>
      )}

      {loading && <p className="text-sand-400">Carregando…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded-lg border border-accent-100 bg-white p-6 text-sm text-sand-400 shadow-sm shadow-accent-100/40">
          Nenhum atendimento nesta data.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.label} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg text-sand-900">{group.label}</h2>
            <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-semibold text-accent-700">
              {group.items.length}
            </span>
            <div className="h-px flex-1 bg-accent-100" />
          </div>
          {group.items.map((a) => (
            <ApptCard
              key={a.id}
              appt={a}
              removing={removingId === a.id}
              charging={chargingId === a.id}
              onStatus={setStatus}
              onRemove={removeAppointment}
              onCharge={chargeDeposit}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

// Cartao de um atendimento: horario, cliente, servicos e o quadro de valores
// (total / sinal pago / falta receber).
function ApptCard({
  appt: a,
  removing,
  charging,
  onStatus,
  onRemove,
  onCharge,
}: {
  appt: Appt;
  removing: boolean;
  charging: boolean;
  onStatus: (id: string, status: string) => void;
  onRemove: (id: string, clientName: string) => void;
  onCharge: (id: string, clientName: string) => void;
}) {
  const st = STATUS_LABEL[a.status] ?? { label: a.status, cls: "bg-sand-50 text-sand-600 border-sand-200" };
  const serviceLabel = a.appointmentServices?.length
    ? a.appointmentServices
        .slice()
        .sort((first, second) => first.sortOrder - second.sortOrder)
        .map((item) => item.service.name)
        .join(" + ")
    : a.service.name;

  const total = Number(a.totalAmount);
  const paid = Number(a.paidAmount);
  const remaining = Number(a.remainingAmount);
  const dead = DEAD_STATUSES.includes(a.status);

  // Da para cobrar o sinal: ainda falta pagar e o agendamento nao foi
  // cancelado nem concluido.
  const podeCobrar =
    ["pending_payment", "expired"].includes(a.status) && paid === 0 && Number(a.depositAmount) > 0;

  // Concluir um atendimento nao registra o pagamento do restante, entao o
  // rodape precisa dizer que o valor nao foi lancado em vez de prometer que
  // ainda vai entrar.
  const remainingHint =
    remaining === 0
      ? "quitado"
      : dead
        ? "não será recebido"
        : a.status === "completed"
          ? "não registrado"
          : "no atendimento";

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm shadow-accent-100/40 transition hover:shadow-md ${
        dead ? "border-sand-200 opacity-70" : "border-accent-100"
      }`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
        {/* Horario */}
        <div className="flex shrink-0 items-center gap-3 sm:w-24 sm:flex-col sm:items-start sm:gap-0">
          <span className="font-display text-2xl leading-none text-sand-900">
            {formatTime(a.startAt)}
          </span>
          <span className="text-xs text-sand-400 sm:mt-1">até {formatTime(a.endAt)}</span>
        </div>

        <div className="hidden w-px self-stretch bg-accent-100 sm:block" />

        {/* Cliente e servicos */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sand-900">{a.client.name}</p>
          <p className="mt-0.5 truncate text-sm text-sand-600">{serviceLabel}</p>
          <a
            href={waPhoneLink(a.client.phone)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs text-sand-400 transition hover:text-accent-700 hover:underline"
          >
            {prettyPhone(a.client.phone)}
          </a>
          {a.notes && (
            <p className="mt-2 rounded-lg bg-sand-50 px-3 py-2 text-xs text-sand-600">{a.notes}</p>
          )}
        </div>

        {/* Status e remover */}
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${st.cls}`}>
            {st.label}
          </span>
          <button
            type="button"
            title="Remover agendamento"
            aria-label={`Remover agendamento de ${a.client.name}`}
            disabled={removing}
            onClick={() => onRemove(a.id, a.client.name)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Quadro de valores */}
      <div className="grid grid-cols-3 divide-x divide-accent-100 border-t border-accent-100 bg-sand-50/60">
        <MoneyCell label="Total" value={brl(total)} />
        <MoneyCell
          label="Sinal pago"
          value={brl(paid)}
          tone={paid > 0 ? "good" : "muted"}
          hint={paid === 0 ? "sem sinal" : paidHint(a.paidAt)}
        />
        <MoneyCell
          label="Falta receber"
          value={brl(remaining)}
          tone={remaining === 0 ? "good" : "warn"}
          hint={remainingHint}
        />
      </div>

      {(["confirmed", "pending_payment"].includes(a.status) || podeCobrar) && (
        <div className="flex flex-wrap gap-2 border-t border-accent-100 px-4 py-3">
          {podeCobrar && (
            <button
              type="button"
              onClick={() => onCharge(a.id, a.client.name)}
              disabled={charging}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {charging ? "Enviando…" : "Cobrar sinal no WhatsApp"}
            </button>
          )}
          {["confirmed", "pending_payment"].includes(a.status) && (
            <>
              <ActionBtn onClick={() => onStatus(a.id, "completed")}>Concluir</ActionBtn>
              <ActionBtn onClick={() => onStatus(a.id, "no_show")} variant="warn">Faltou</ActionBtn>
              <ActionBtn onClick={() => onStatus(a.id, "cancelled")} variant="danger">Cancelar</ActionBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
}) {
  const cls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-sand-900";
  return (
    <div className="rounded-lg border border-accent-100 bg-white px-4 py-3 shadow-sm shadow-accent-100/40">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-sand-400">{label}</p>
      <p className={`mt-1 font-display text-xl ${cls}`}>{value}</p>
    </div>
  );
}

function MoneyCell({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "muted";
  hint?: string;
}) {
  const cls =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "muted"
          ? "text-sand-400"
          : "text-sand-800";
  return (
    <div className="px-3 py-2.5 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sand-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${cls}`}>{value}</p>
      {hint && <p className="text-[10px] text-sand-400">{hint}</p>}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <IconBase className={className}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
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
