"use client";

import { useEffect, useState } from "react";
import { api, brl } from "@/lib/api";

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationMinutes: number;
  depositType: string;
  depositAmount: number;
};

type CreateResponse = {
  token: string;
  status: string;
  requiresDeposit: boolean;
  appointment: {
    service: string;
    startAt: string;
    endAt: string;
    totalAmount: number;
    depositAmount: number;
  };
};

type PixResponse = {
  amount: number;
  expiresAt: string | null;
  pix: { qrCodeText: string | null; qrCodeImageUrl: string | null };
  service: string;
  test?: boolean;
};

type LookupAppointment = {
  token: string;
  status: string;
  paymentStatus: string;
  client: string;
  service: string;
  professional: string;
  startAt: string;
  endAt: string;
  totalAmount: number;
  depositAmount: number;
  expiresAt: string | null;
  payment: {
    status: string;
    qrCodeText: string | null;
    qrCodeImageUrl: string | null;
    expiresAt: string | null;
  } | null;
};

type LookupResponse = {
  business: { id: string; name: string; logoUrl: string | null };
  appointments: LookupAppointment[];
};

type BusinessHour = {
  weekday: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

type PublicBio = {
  business: { name: string; logoUrl: string | null };
  bio: {
    enabled: boolean;
    title: string;
    subtitle: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    backgroundUrl: string | null;
    instagramUrl: string | null;
  };
  links: {
    id: string;
    label: string;
    url: string | null;
    type: "external" | "booking" | "document";
  }[];
};

const STEPS = ["Serviços", "Data e horário", "Seus dados", "Pagamento"];

function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${m}`;
  if (h) return `${h}h`;
  return `${m}min`;
}

function formatRemaining(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatAppointmentDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatAppointmentTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getBookableDays(start: Date, openWeekdays: number[] | null, offset: number, count: number) {
  const allowed = openWeekdays && openWeekdays.length > 0 ? new Set(openWeekdays) : null;
  if (openWeekdays && openWeekdays.length === 0) return [];

  const days: Date[] = [];
  let skipped = 0;
  let cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  for (let guard = 0; days.length < count && guard < 180; guard += 1) {
    if (!allowed || allowed.has(cursor.getDay())) {
      if (skipped < offset) {
        skipped += 1;
      } else {
        days.push(new Date(cursor));
      }
    }
    cursor = addDays(cursor, 1);
  }

  return days;
}

function formatDayMonth(date: Date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatWeekday(date: Date) {
  const value = date.toLocaleDateString("pt-BR", { weekday: "long" });
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatShortWeekday(date: Date) {
  const value = date.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isBrazilMobile(value: string) {
  return /^\d{2}9\d{8}$/.test(onlyDigits(value));
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function normalizeMobilePhone(value: string) {
  let digits = onlyDigits(value);
  if (digits.length > 2 && digits[2] !== "9") {
    digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  }
  return digits.slice(0, 11);
}

export default function BookingPage() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [services, setServices] = useState<Service[]>([]);
  const [businessHours, setBusinessHours] = useState<BusinessHour[] | null>(null);
  const [businessName, setBusinessName] = useState("Studio");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bio, setBio] = useState<PublicBio | null>(null);
  const [bioChecked, setBioChecked] = useState(false);
  const [queryChecked, setQueryChecked] = useState(false);
  const [forceBooking, setForceBooking] = useState(false);
  const [forceLookup, setForceLookup] = useState(false);

  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [date, setDate] = useState("");
  const [dateOffset, setDateOffset] = useState(0);
  const [slots, setSlots] = useState<string[]>([]);
  const [time, setTime] = useState("");
  const [form, setForm] = useState({ name: "", phone: "" });
  const [clientLookupMessage, setClientLookupMessage] = useState<string | null>(null);
  const [clientFound, setClientFound] = useState(false);
  const [clientLookupDone, setClientLookupDone] = useState(false);

  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [pix, setPix] = useState<PixResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const service = selectedServices[0] ?? null;
  const totalPrice = selectedServices.reduce((sum, selected) => sum + selected.price, 0);
  const totalDeposit = selectedServices.reduce((sum, selected) => sum + selected.depositAmount, 0);
  const totalDuration = selectedServices.reduce((sum, selected) => sum + selected.durationMinutes, 0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceBooking(params.get("agendar") === "1");
    setForceLookup(params.get("consulta") === "1");
    setQueryChecked(true);
  }, []);

  useEffect(() => {
    api<PublicBio>("/api/public/bio")
      .then((data) => {
        setBio(data);
        if (data.business?.name) setBusinessName(data.business.name);
        setLogoUrl(data.business?.logoUrl ?? null);
      })
      .catch(() => setBio(null))
      .finally(() => setBioChecked(true));
  }, []);

  useEffect(() => {
    api<{ business: { name: string; logoUrl: string | null }; services: Service[] }>(
      "/api/public/services",
    )
      .then((r) => {
        setServices(r.services);
        if (r.business?.name) setBusinessName(r.business.name);
        setLogoUrl(r.business?.logoUrl ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api<{ hours: BusinessHour[] }>("/api/public/business-hours")
      .then((r) => setBusinessHours(r.hours))
      .catch(() => setBusinessHours(null));
  }, []);

  // Carrega horários assim que a data muda (no passo Data e horário).
  useEffect(() => {
    if (step === 1 && selectedServices.length > 0 && date) {
      setLoading(true);
      setSlots([]);
      setTime("");
      api<{ slots: string[] }>(
        `/api/public/availability?serviceIds=${selectedServices.map((selected) => selected.id).join(",")}&date=${date}`,
      )
        .then((r) => setSlots(r.slots))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [step, selectedServices, date]);

  useEffect(() => {
    if (!created || !pix || confirmed || expired) return;
    const id = setInterval(async () => {
      try {
        const r = await api<{ status: string }>(
          `/api/public/appointments/${created.token}`,
        );
        if (r.status === "confirmed") {
          setConfirmed(true);
          clearInterval(id);
        } else if (r.status === "expired") {
          setExpired(true);
          clearInterval(id);
        }
      } catch {
        /* segue tentando */
      }
    }, 4000);
    return () => clearInterval(id);
  }, [created, pix, confirmed, expired]);

  useEffect(() => {
    if (!pix?.expiresAt || confirmed || expired) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pix?.expiresAt, confirmed, expired]);

  useEffect(() => {
    if (!pix?.expiresAt || confirmed) return;
    if (new Date(pix.expiresAt).getTime() <= now) {
      setExpired(true);
    }
  }, [pix?.expiresAt, confirmed, now]);

  useEffect(() => {
    if (!expired || !created || confirmed) return;
    api(`/api/public/appointments/${created.token}`).catch(() => {
      /* a disponibilidade ja libera pelo expiresAt, mesmo se essa chamada falhar */
    });
  }, [expired, created, confirmed]);

  const today = toDateInput(new Date());
  const openWeekdays = businessHours ? businessHours.filter((h) => h.isOpen).map((h) => h.weekday) : null;
  const visibleDays = getBookableDays(new Date(), openWeekdays, dateOffset, 6);
  const nameParts = form.name.trim().split(/\s+/).filter(Boolean);
  const needsLastName = nameParts.length === 1;
  const nameOk = nameParts.length >= 2;
  const phoneOk = isBrazilMobile(form.phone);
  const canSubmitDetails = nameOk && phoneOk && !loading;
  const submitLabel = loading
    ? "Reservando..."
    : totalDeposit > 0
      ? "Confirmar e pagar sinal"
      : "Confirmar agendamento";

  useEffect(() => {
    if (!phoneOk) {
      setClientLookupMessage(null);
      setClientFound(false);
      setClientLookupDone(false);
      return;
    }

    let cancelled = false;
    api<{ client: { name: string } | null }>("/api/public/clients/lookup", {
      method: "POST",
      body: JSON.stringify({ phone: onlyDigits(form.phone) }),
    })
      .then((r) => {
        if (cancelled) return;
        if (r.client?.name) {
          setForm((current) => ({
            ...current,
            name: r.client!.name,
          }));
          setClientFound(true);
          setClientLookupDone(true);
          setClientLookupMessage("Cadastro encontrado. Nome preenchido automaticamente.");
        } else {
          setClientFound(false);
          setClientLookupDone(true);
          setClientLookupMessage("Cadastro não encontrado. Informe seu nome completo.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setClientFound(false);
          setClientLookupDone(true);
          setClientLookupMessage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form.phone, phoneOk]);

  function updateName(name: string) {
    setForm({
      ...form,
      name,
    });
  }

  function updatePhone(phone: string) {
    const nextPhone = normalizeMobilePhone(phone);
    setForm({
      ...form,
      phone: nextPhone,
      name: clientFound ? "" : form.name,
    });
    setClientFound(false);
    setClientLookupDone(false);
    setClientLookupMessage(null);
  }

  function toggleService(s: Service) {
    setSelectedServices((current) => {
      if (current.some((selected) => selected.id === s.id)) {
        return current.filter((selected) => selected.id !== s.id);
      }
      if (current.length >= 10) return current;
      return [...current, s];
    });
  }

  function continueToDate() {
    if (selectedServices.length === 0) return;
    const firstAvailableDay = getBookableDays(new Date(), openWeekdays, 0, 1)[0];
    setDate(firstAvailableDay ? toDateInput(firstAvailableDay) : "");
    setDateOffset(0);
    setSlots([]);
    setTime("");
    setStep(1);
  }

  function chooseTime(t: string) {
    setTime(t);
    setStep(2);
  }

  async function submitAppointment() {
    if (selectedServices.length === 0) return;
    setError(null);
    setLoading(true);
    setExpired(false);
    setConfirmed(false);
    setCreated(null);
    setPix(null);
    try {
      const res = await api<CreateResponse>("/api/public/appointments", {
        method: "POST",
        body: JSON.stringify({
          serviceIds: selectedServices.map((selected) => selected.id),
          date,
          time,
          client: {
            name: form.name.trim(),
            phone: onlyDigits(form.phone),
          },
        }),
      });
      setCreated(res);
      setStep(3);
      if (res.requiresDeposit) {
        const p = await api<PixResponse>("/api/public/payments/pix", {
          method: "POST",
          body: JSON.stringify({ token: res.token }),
        });
        setPix(p);
      } else {
        setConfirmed(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function simulatePayment() {
    if (!created || expired) return;
    setError(null);
    try {
      await api("/api/public/payments/simulate", {
        method: "POST",
        body: JSON.stringify({ token: created.token }),
      });
      setConfirmed(true);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function chooseAnotherTime() {
    setCreated(null);
    setPix(null);
    setConfirmed(false);
    setExpired(false);
    setError(null);
    setStep(1);
  }

  const remainingMs = pix?.expiresAt ? new Date(pix.expiresAt).getTime() - now : 0;

  function openBooking() {
    setForceBooking(true);
    setForceLookup(false);
    window.history.pushState(null, "", "/?agendar=1");
  }

  function openLookup() {
    setForceLookup(true);
    setForceBooking(false);
    window.history.pushState(null, "", "/?consulta=1");
  }

  if (!queryChecked || (!bioChecked && !forceBooking && !forceLookup)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#f6eee7] via-[#fbf7f3] to-sand-50 px-4 text-sand-900">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#d8bda8] border-t-[#8b5e3c]" />
          <p className="text-sm font-medium text-[#8a644d]">Carregando...</p>
        </div>
      </main>
    );
  }

  if (bio?.bio.enabled && !forceBooking && !forceLookup) {
    return (
      <BioLanding
        data={bio}
        onBooking={openBooking}
        onLookup={openLookup}
      />
    );
  }

  if (forceLookup) {
    return (
      <LookupPage
        businessName={businessName}
        logoUrl={logoUrl}
        onBooking={openBooking}
      />
    );
  }

  return (
    <main
      className={`min-h-screen bg-gradient-to-b from-[#f6eee7] via-[#fbf7f3] to-sand-50 px-3 py-4 text-sand-900 sm:px-4 sm:py-8 ${
        step === 2 ? "pb-28 sm:pb-8" : ""
      }`}
    >
      <div className="mx-auto max-w-lg">
        {step === 0 && (
          <>
            <header className="mb-4 flex items-center gap-3 rounded-2xl border border-[#d8bda8] bg-white/80 px-4 py-3 shadow-sm shadow-[#c8a58e]/10 sm:mb-6 sm:justify-center sm:gap-4 sm:px-5 sm:py-4">
              <Logo name={businessName} logoUrl={logoUrl} />
              <div className="min-w-0 sm:text-center">
                <h1 className="truncate font-display text-2xl font-medium text-[#5c3a28] sm:text-3xl">
                  {businessName}
                </h1>
                <p className="text-xs font-medium text-[#8a644d] sm:text-sm">Agendamento online</p>
              </div>
            </header>

            <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-[#e4d2c3] bg-white/70 p-1.5 shadow-sm sm:mb-6">
              <button
                type="button"
                className="rounded-xl bg-[#8b5e3c] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm"
              >
                Agendar
              </button>
              <button
                type="button"
                onClick={openLookup}
                className="rounded-xl px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#6f452d] transition hover:bg-[#f6eee7]"
              >
                Consultar
              </button>
            </div>
          </>
        )}

        {/* Passos */}
        <div className="mb-4 rounded-2xl border border-[#e4d2c3] bg-white/70 px-3 py-3 shadow-sm sm:mb-6 sm:px-4 sm:py-4">
          <div className="flex items-start">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition sm:h-8 sm:w-8 ${
                    i <= step
                      ? "bg-[#8b5e3c] text-white shadow-sm shadow-[#8b5e3c]/25"
                      : "border border-[#dbc4b2] bg-white text-[#b08d73]"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-1.5 hidden max-w-20 text-center text-[10px] font-medium leading-tight sm:block ${
                    i <= step ? "text-[#5c3a28]" : "text-[#a78268]"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-1.5 mt-3.5 h-px flex-1 sm:mx-2 sm:mt-4 ${i < step ? "bg-[#8b5e3c]" : "bg-[#dbc4b2]"}`}
                />
              )}
            </div>
          ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#dcc6b5] bg-white p-4 shadow-sm shadow-[#c8a58e]/10 sm:p-6">
          {error && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* PASSO 1 — Serviço */}
          {step === 0 && (
            <section>
              <h2 className="mb-4 font-display text-2xl text-[#5c3a28]">
                Escolha seus serviços
              </h2>
              <p className="mb-4 text-sm text-[#8a6a55]">
                Você pode selecionar mais de um serviço para reservar tudo no mesmo horário.
              </p>
              <div className="space-y-2.5">
                {services.length === 0 && !error && (
                  <p className="text-sm text-sand-400">Carregando serviços…</p>
                )}
                {services.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => toggleService(s)}
                    aria-pressed={selectedServices.some((selected) => selected.id === s.id)}
                    disabled={selectedServices.length >= 10 && !selectedServices.some((selected) => selected.id === s.id)}
                    className={`group flex w-full items-center justify-between gap-4 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                      selectedServices.some((selected) => selected.id === s.id)
                        ? "border-[#8b5e3c] bg-[#f7eee7] shadow-sm"
                        : "border-[#e1d0c3] bg-[#fffaf6] hover:border-[#9b6a47] hover:bg-[#f7eee7]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs font-bold ${
                        selectedServices.some((selected) => selected.id === s.id)
                          ? "border-[#8b5e3c] bg-[#8b5e3c] text-white"
                          : "border-[#c9aa93] bg-white text-transparent"
                      }`} aria-hidden="true">✓</span>
                      <div>
                        <p className="font-medium text-[#4a3022]">{s.name}</p>
                        {s.description && (
                          <p className="mt-1 max-w-[13rem] text-xs leading-relaxed text-[#75543f] sm:max-w-xs">
                            {s.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-[#8a6a55]">
                          {durationLabel(s.durationMinutes)}
                          {s.depositAmount > 0 && ` · sinal ${brl(s.depositAmount)}`}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-3 py-1.5 font-display text-lg text-[#6f452d] shadow-sm">
                      {brl(s.price)}
                    </span>
                  </button>
                ))}
              </div>
              {selectedServices.length >= 10 && (
                <p className="mt-3 text-xs text-[#8a6a55]">Limite de 10 serviços por agendamento.</p>
              )}
              {selectedServices.length > 0 && (
                <div className="mt-4 rounded-xl border border-[#ead8ca] bg-[#fffaf6] p-4">
                  <div className="flex justify-between gap-3 text-sm text-[#6f452d]">
                    <span>{selectedServices.length} {selectedServices.length === 1 ? "serviço selecionado" : "serviços selecionados"}</span>
                    <span>{durationLabel(totalDuration)}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-3 font-semibold text-[#4a3022]">
                    <span>Total</span>
                    <span>{brl(totalPrice)}</span>
                  </div>
                  {totalDeposit > 0 && (
                    <p className="mt-1 text-right text-xs text-[#8a6a55]">Um único sinal Pix de {brl(totalDeposit)}</p>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={continueToDate}
                disabled={selectedServices.length === 0}
                className="mt-5 w-full rounded-lg bg-[#8b5e3c] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#704629] disabled:opacity-40"
              >
                Continuar para data e horário
              </button>
            </section>
          )}

          {/* PASSO 2 — Data e horário (na mesma tela) */}
          {step === 1 && service && (
            <section>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-2xl text-[#5c3a28]">Escolha data e horário</h2>
              </div>
              <p className="mb-4 text-sm text-[#7d5135]">
                {selectedServices.map((selected) => selected.name).join(" + ")} · {durationLabel(totalDuration)}
              </p>

              <div className="rounded-2xl border border-[#ead8ca] bg-[#fffaf6] px-3 py-4">
                <p className="mb-3 text-center text-sm font-bold text-[#6f452d]">
                  Selecione o dia:
                </p>

                {visibleDays.length === 0 ? (
                  <p className="rounded-xl border border-[#ead8ca] bg-white px-4 py-3 text-center text-sm text-sand-400">
                    Nenhum dia de atendimento foi configurado ainda.
                  </p>
                ) : (
                  <div className="grid grid-cols-[28px_minmax(0,1fr)_28px] items-stretch gap-1.5 sm:grid-cols-[34px_minmax(0,1fr)_34px]">
                    <button
                      type="button"
                      onClick={() => setDateOffset((current) => Math.max(0, current - 6))}
                      disabled={dateOffset === 0}
                      aria-label="Ver dias anteriores"
                      className="flex items-center justify-center rounded-xl border border-[#ead8ca] bg-white text-lg leading-none text-[#b58c70] transition hover:border-[#8b5e3c] hover:text-[#8b5e3c] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ‹
                    </button>

                    <div className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-6">
                      {visibleDays.map((day) => {
                        const value = toDateInput(day);
                        const selected = date === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setDate(value)}
                            className={`min-w-0 rounded-xl border px-1 py-2 text-center transition sm:py-2.5 ${
                              selected
                                ? "border-[#8b5e3c] bg-[#8b5e3c] text-white shadow-sm shadow-[#8b5e3c]/20"
                                : "border-[#d1ad93] bg-white text-[#9a6a49] hover:border-[#8b5e3c] hover:bg-[#f6eee7] hover:text-[#6f452d]"
                            }`}
                          >
                            <span className="block whitespace-nowrap text-sm font-bold leading-tight">{formatDayMonth(day)}</span>
                            <span className="mt-1 block whitespace-nowrap text-[11px] font-semibold leading-tight">{formatShortWeekday(day)}</span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setDateOffset((current) => current + 6)}
                      aria-label="Ver próximos dias"
                      className="flex items-center justify-center rounded-xl border border-[#ead8ca] bg-white text-lg leading-none text-[#b58c70] transition hover:border-[#8b5e3c] hover:text-[#8b5e3c]"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>

              {date ? (
                <div className="mt-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-[#5c3a28]">Horários disponíveis</p>
                    <span className="rounded-full bg-[#f6eee7] px-3 py-1 text-xs font-medium text-[#7d5135]">
                      {date.split("-").reverse().join("/")}
                    </span>
                  </div>
                  {loading && <p className="text-sm text-sand-400">Buscando horários...</p>}
                  {!loading && slots.length === 0 && (
                    <p className="rounded-xl border border-[#ead8ca] bg-[#fffaf6] px-4 py-3 text-sm text-sand-400">
                      Nenhum horário livre nesta data. Tente outro dia.
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {slots.map((s) => (
                      <button
                        key={s}
                        onClick={() => chooseTime(s)}
                        className="rounded-xl border border-[#dbc4b2] bg-[#fffaf6] py-3 text-sm font-semibold text-[#5c3a28] transition hover:border-[#8b5e3c] hover:bg-[#f6eee7]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-center text-sm text-sand-400">
                  Escolha um dia para ver os horários disponíveis.
                </p>
              )}

              <div className="mt-6">
                <BackButton onClick={() => setStep(0)} />
              </div>
            </section>
          )}

          {/* PASSO 3 — Dados */}
          {step === 2 && service && (
            <section>
              <h2 className="mb-4 font-display text-2xl text-[#5c3a28]">Seus dados</h2>
              <div className="space-y-3">
                <Field
                  label="Número de celular"
                  value={formatPhone(form.phone)}
                  onChange={updatePhone}
                  placeholder="(63) 99999-9999"
                  hint={
                    form.phone && !phoneOk
                      ? "Use DDD + 9 + número. Ex.: (63) 98101-3083."
                      : phoneOk && !clientLookupDone
                        ? "Verificando cadastro..."
                        : clientLookupMessage ?? undefined
                  }
                  invalid={Boolean(form.phone) && !phoneOk}
                  inputMode="numeric"
                  maxLength={15}
                />
                {phoneOk && clientLookupDone && (
                  <Field
                    label="Nome e sobrenome"
                    value={form.name}
                    onChange={updateName}
                    placeholder="Ex.: Maria Silva"
                    hint={needsLastName ? "Digite também o sobrenome." : undefined}
                    invalid={needsLastName}
                  />
                )}
              </div>

              <div className="mt-5 rounded-xl border border-[#dbc4b2] bg-[#fff9f4] p-4 text-sm">
                <Row label="Serviços" value={selectedServices.map((selected) => selected.name).join(" + ")} />
                <Row label="Data / hora" value={`${date.split("-").reverse().join("/")} às ${time}`} />
                <div className="my-2 border-t border-sand-200" />
                <Row label="Valor total" value={brl(totalPrice)} strong />
                {totalDeposit > 0 && (
                  <>
                    <Row label="Sinal único para reservar" value={brl(totalDeposit)} accent />
                    <Row label="Restante no atendimento" value={brl(totalPrice - totalDeposit)} />
                  </>
                )}
              </div>

              <div className="mt-6 hidden gap-3 sm:grid sm:grid-cols-[auto_1fr]">
                <BackButton onClick={() => setStep(1)} />
                <button
                  disabled={!canSubmitDetails}
                  onClick={submitAppointment}
                  className="w-full rounded-lg bg-[#8b5e3c] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#704629] disabled:opacity-40"
                >
                  {submitLabel}
                </button>
              </div>

              <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#f1c7d5] bg-white/95 px-3 py-3 shadow-[0_-10px_30px_rgba(127,52,79,0.12)] backdrop-blur sm:hidden">
                <div className="mx-auto flex max-w-lg items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="h-12 rounded-lg border border-[#ccb09a] px-4 text-sm font-medium text-[#6f452d]"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    disabled={!canSubmitDetails}
                    onClick={submitAppointment}
                    className="min-w-0 flex-1 rounded-lg bg-[#8b5e3c] px-4 py-2.5 text-sm font-semibold leading-tight text-white shadow-sm transition hover:bg-[#704629] disabled:opacity-40"
                  >
                    <span className="block">{submitLabel}</span>
                    {totalDeposit > 0 && (
                      <span className="block text-[11px] font-medium text-white/85">
                        Sinal único de {brl(totalDeposit)}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* PASSO 4 — Pagamento / Confirmação */}
          {step === 3 && (
            <section className="text-center">
              {confirmed ? (
                <div className="py-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-50 text-2xl text-accent-700">
                    ✓
                  </div>
                    <h2 className="font-display text-2xl text-[#5c3a28]">
                    Agendamento confirmado
                  </h2>
                  <p className="mt-2 text-sm text-sand-500">
                    {created?.appointment.service} —{" "}
                    {date.split("-").reverse().join("/")} às {time}
                  </p>
                  <p className="mt-4 text-sm text-sand-500">
                    Você receberá a confirmação no WhatsApp. Até lá.
                  </p>
                </div>
              ) : expired ? (
                <div className="py-4">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl text-red-600">
                    !
                  </div>
                  <h2 className="font-display text-2xl text-sand-900">
                    Prazo de pagamento expirado
                  </h2>
                  <p className="mt-2 text-sm text-sand-500">
                    O horário fica reservado por 5 minutos. Como o Pix não foi confirmado nesse prazo,
                    o agendamento não foi marcado.
                  </p>
                  <button
                    onClick={chooseAnotherTime}
                    className="mt-5 w-full rounded-lg bg-[#8b5e3c] py-3 text-sm font-medium text-white transition hover:bg-[#704629]"
                  >
                    Escolher outro horário
                  </button>
                </div>
              ) : pix ? (
                <div>
                  <h2 className="font-display text-2xl text-[#5c3a28]">Pague o sinal via Pix</h2>
                  <p className="mb-5 mt-0.5 text-sm text-sand-500">
                    {brl(pix.amount)} para reservar seu horário
                  </p>
                  <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left">
                    <p className="text-xs font-medium uppercase text-amber-700">Prazo para pagamento</p>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <span className="font-display text-3xl text-amber-900">
                        {formatRemaining(remainingMs)}
                      </span>
                      <span className="pb-1 text-xs text-amber-700">
                        após isso o horário é liberado
                      </span>
                    </div>
                  </div>
                  {pix.pix.qrCodeImageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={pix.pix.qrCodeImageUrl}
                      alt="QR Code Pix"
                      className="mx-auto mb-5 h-44 w-44 rounded-lg border border-sand-200"
                    />
                  )}
                  {pix.pix.qrCodeText && (
                    <div className="mb-5 text-left">
                      <p className="mb-1.5 text-xs text-sand-500">Pix copia e cola</p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={pix.pix.qrCodeText}
                          className="flex-1 truncate rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-xs text-sand-700"
                        />
                        <button
                          onClick={() => navigator.clipboard.writeText(pix.pix.qrCodeText || "")}
                          className="rounded-lg bg-[#8b5e3c] px-3 py-2 text-xs font-medium text-white hover:bg-[#704629]"
                        >
                          Copiar
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-2 text-sm text-sand-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" />
                    Aguardando confirmação do pagamento. O horário só será agendado após o Pix.
                  </div>

                  {pix.test && (
                    <button
                      onClick={simulatePayment}
                      disabled={expired}
                      className="mt-5 w-full rounded-lg border border-dashed border-accent-300 bg-accent-50 py-2.5 text-sm font-medium text-accent-700 transition hover:bg-accent-100"
                    >
                      ✓ Simular pagamento (modo teste)
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-sand-400">Gerando cobrança…</p>
              )}
            </section>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-sand-400">
          <a href="/admin" className="underline-offset-2 hover:text-[#6f452d] hover:underline">
            Acesso da equipe
          </a>
        </p>
      </div>
    </main>
  );
}

function LookupPage({
  businessName,
  logoUrl,
  onBooking,
}: {
  businessName: string;
  logoUrl: string | null;
  onBooking: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResponse | null>(null);

  const phoneOk = isBrazilMobile(phone);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneOk) return;
    setError(null);
    setLoading(true);
    try {
      const response = await api<LookupResponse>("/api/public/appointments/lookup", {
        method: "POST",
        body: JSON.stringify({ phone: onlyDigits(phone) }),
      });
      setResult(response);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#f6eee7] via-[#fbf7f3] to-sand-50 px-3 py-4 text-sand-900 sm:px-4 sm:py-8">
      <div className="mx-auto max-w-lg">
        <header className="mb-4 flex items-center gap-3 rounded-2xl border border-[#d8bda8] bg-white/80 px-4 py-3 shadow-sm shadow-[#c8a58e]/10 sm:mb-6 sm:justify-center sm:gap-4 sm:px-5 sm:py-4">
          <Logo name={businessName} logoUrl={logoUrl} />
          <div className="min-w-0 sm:text-center">
            <h1 className="truncate font-display text-2xl font-medium text-[#5c3a28] sm:text-3xl">
              {businessName}
            </h1>
            <p className="text-xs font-medium text-[#8a644d] sm:text-sm">Consultar atendimento</p>
          </div>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-[#e4d2c3] bg-white/70 p-1.5 shadow-sm sm:mb-6">
          <button
            type="button"
            onClick={onBooking}
            className="rounded-xl px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[#6f452d] transition hover:bg-[#f6eee7]"
          >
            Agendar
          </button>
          <button
            type="button"
            className="rounded-xl bg-[#8b5e3c] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-sm"
          >
            Consultar
          </button>
        </div>

        <section className="rounded-2xl border border-[#dcc6b5] bg-white p-4 shadow-sm shadow-[#c8a58e]/10 sm:p-6">
          <h2 className="font-display text-2xl text-[#5c3a28]">Consulte seu agendamento</h2>
          <p className="mt-1 text-sm leading-6 text-sand-500">
            Digite o WhatsApp usado no agendamento para ver os próximos atendimentos e o status do pagamento.
          </p>

          <form onSubmit={submit} className="mt-5 space-y-3">
            <Field
              label="WhatsApp"
              value={phone}
              onChange={(value) => setPhone(onlyDigits(value).slice(0, 11))}
              placeholder="63999999999"
              inputMode="numeric"
              maxLength={11}
              hint={phone && !phoneOk ? "Use 11 números: DDD + 9 + número. Ex.: 63981013083." : undefined}
              invalid={Boolean(phone) && !phoneOk}
            />
            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={!phoneOk || loading}
              className="w-full rounded-lg bg-[#8b5e3c] py-3 text-sm font-medium text-white transition hover:bg-[#704629] disabled:opacity-40"
            >
              {loading ? "Consultando..." : "Consultar agendamento"}
            </button>
          </form>

          {result && (
            <div className="mt-6">
              {result.appointments.length === 0 ? (
                <div className="rounded-xl border border-[#dbc4b2] bg-[#fff9f4] p-4 text-sm text-sand-500">
                  Nenhum agendamento foi encontrado para esse WhatsApp.
                </div>
              ) : (
                <div className="space-y-3">
                  {result.appointments.map((appointment) => (
                    <AppointmentCard key={appointment.token} appointment={appointment} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function AppointmentCard({ appointment }: { appointment: LookupAppointment }) {
  const status = APPOINTMENT_STATUS[appointment.status] ?? {
    label: appointment.status,
    className: "border-sand-200 bg-sand-50 text-sand-600",
  };
  const payment = PAYMENT_STATUS[appointment.payment?.status ?? appointment.paymentStatus] ?? {
    label: appointment.payment?.status ?? appointment.paymentStatus,
    className: "border-sand-200 bg-white text-sand-500",
  };
  const remaining =
    appointment.status === "pending_payment" && appointment.expiresAt
      ? new Date(appointment.expiresAt).getTime() - Date.now()
      : 0;

  return (
    <article className="rounded-xl border border-[#dbc4b2] bg-[#fffaf6] p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-[#4a3022]">{appointment.service}</p>
          <p className="mt-1 text-xs text-sand-500">
            {formatAppointmentDate(appointment.startAt)} às {formatAppointmentTime(appointment.startAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
          {status.label}
        </span>
      </div>

      <div className="mt-4 space-y-1 text-sm">
        <Row label="Profissional" value={appointment.professional} />
        <Row label="Valor" value={brl(appointment.totalAmount)} />
        {appointment.depositAmount > 0 && (
          <Row label="Sinal" value={brl(appointment.depositAmount)} accent />
        )}
      </div>

      <div className="mt-4 rounded-lg border border-sand-100 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase text-sand-500">Pagamento</span>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${payment.className}`}>
            {payment.label}
          </span>
        </div>

        {appointment.status === "pending_payment" && appointment.payment?.qrCodeText ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase text-amber-700">Pix disponível para pagamento</p>
            {appointment.expiresAt && (
              <p className="mt-1 text-xs text-amber-700">
                Prazo restante: {formatRemaining(remaining)}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={appointment.payment.qrCodeText}
                className="min-w-0 flex-1 truncate rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-sand-700"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(appointment.payment?.qrCodeText || "")}
                className="rounded-lg bg-[#8b5e3c] px-3 py-2 text-xs font-medium text-white hover:bg-[#704629]"
              >
                Copiar
              </button>
            </div>
          </div>
        ) : appointment.status === "pending_payment" ? (
          <p className="mt-2 text-xs text-sand-500">
            O pagamento ainda está pendente. Se o Pix expirou, faça um novo agendamento.
          </p>
        ) : appointment.paymentStatus === "paid" || appointment.payment?.status === "paid" ? (
          <p className="mt-2 text-xs text-emerald-700">Sinal pago. Seu horário está confirmado.</p>
        ) : (
          <p className="mt-2 text-xs text-sand-500">Nenhuma cobrança Pix pendente para este agendamento.</p>
        )}
      </div>
    </article>
  );
}

const APPOINTMENT_STATUS: Record<string, { label: string; className: string }> = {
  pending_payment: {
    label: "Aguardando sinal",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  confirmed: {
    label: "Confirmado",
    className: "border-accent-200 bg-accent-50 text-accent-700",
  },
  completed: {
    label: "Concluído",
    className: "border-sand-200 bg-sand-100 text-sand-600",
  },
  cancelled: {
    label: "Cancelado",
    className: "border-sand-200 bg-sand-50 text-sand-400",
  },
  no_show: {
    label: "Faltou",
    className: "border-red-200 bg-red-50 text-red-600",
  },
  expired: {
    label: "Expirado",
    className: "border-sand-200 bg-sand-50 text-sand-400",
  },
};

const PAYMENT_STATUS: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Aguardando pagamento",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  paid: {
    label: "Pago",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  expired: {
    label: "Expirado",
    className: "border-sand-200 bg-sand-50 text-sand-500",
  },
  failed: {
    label: "Falhou",
    className: "border-red-200 bg-red-50 text-red-600",
  },
  refunded: {
    label: "Estornado",
    className: "border-sand-200 bg-sand-50 text-sand-500",
  },
  cancelled: {
    label: "Cancelado",
    className: "border-sand-200 bg-sand-50 text-sand-500",
  },
};

function BioLanding({
  data,
  onBooking,
  onLookup,
}: {
  data: PublicBio;
  onBooking: () => void;
  onLookup: () => void;
}) {
  const avatar = data.bio.avatarUrl || data.business.logoUrl;
  const cover = data.bio.coverUrl;
  const background = data.bio.backgroundUrl;

  return (
    <main
      className="min-h-screen bg-white text-sand-900"
      style={
        background
          ? {
              backgroundImage: `linear-gradient(rgba(255,255,255,.86), rgba(255,255,255,.9)), url(${background})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <div className="mx-auto min-h-screen max-w-5xl">
        <section
          className="h-44 bg-gradient-to-r from-[#5f423a] via-[#d9a08c] to-[#2f352f] bg-cover bg-center sm:h-52"
          style={cover ? { backgroundImage: `url(${cover})` } : undefined}
        />

        <section className="-mt-14 px-5 pb-12 text-center">
          <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-accent-50 shadow-lg">
            {avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatar} alt={data.bio.title} className="h-full w-full object-cover" />
            ) : (
              <span className="font-display text-4xl text-accent-700">
                {(data.bio.title || data.business.name).charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          <h1 className="font-sans text-3xl font-medium tracking-normal text-sand-900">
            {data.bio.title || data.business.name}
          </h1>
          {data.bio.subtitle && (
            <p className="mx-auto mt-2 max-w-xl text-xs uppercase tracking-[0.18em] text-sand-600">
              {data.bio.subtitle}
            </p>
          )}

          {data.bio.instagramUrl && (
            <a
              href={data.bio.instagramUrl}
              target="_blank"
              rel="noreferrer"
              className="mx-auto mt-7 inline-flex h-10 w-10 items-center justify-center rounded-full text-sand-900 transition hover:bg-sand-100"
              aria-label="Instagram"
            >
              <InstagramIcon className="h-6 w-6" />
            </a>
          )}

          <div className="mx-auto mt-7 flex max-w-xl flex-col gap-4">
            {data.links.map((link) =>
              link.type === "booking" ? (
                <button
                  key={link.id}
                  onClick={onBooking}
                  className="w-full border border-sand-100 bg-white px-5 py-5 text-sm uppercase tracking-wide text-sand-900 shadow-sm transition hover:-translate-y-0.5 hover:border-accent-200 hover:text-accent-700 hover:shadow-md"
                >
                  {link.label}
                </button>
              ) : link.type === "document" ? (
                <a
                  key={link.id}
                  href={`/api/public/bio/links/${link.id}/file`}
                  className="w-full border border-sand-100 bg-white px-5 py-5 text-sm uppercase tracking-wide text-sand-900 shadow-sm transition hover:-translate-y-0.5 hover:border-accent-200 hover:text-accent-700 hover:shadow-md"
                >
                  {link.label}
                </a>
              ) : (
                <a
                  key={link.id}
                  href={link.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full border border-sand-100 bg-white px-5 py-5 text-sm uppercase tracking-wide text-sand-900 shadow-sm transition hover:-translate-y-0.5 hover:border-accent-200 hover:text-accent-700 hover:shadow-md"
                >
                  {link.label}
                </a>
              ),
            )}
            <button
              onClick={onLookup}
              className="w-full border border-[#dcc6b5] bg-[#fff9f4] px-5 py-5 text-sm uppercase tracking-wide text-[#6f452d] shadow-sm transition hover:-translate-y-0.5 hover:border-accent-200 hover:text-accent-700 hover:shadow-md"
            >
              Consultar meu agendamento
            </button>
          </div>

          <p className="mt-10 text-xs text-sand-400">
            <a href="/admin" className="underline-offset-2 hover:text-accent-700 hover:underline">
              Acesso da equipe
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}

function InstagramIcon({ className }: { className?: string }) {
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
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  );
}

function Logo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return (
      <img
        src={logoUrl}
        alt={name}
        className="h-14 w-14 shrink-0 rounded-full border-4 border-white object-cover shadow-md shadow-[#b98f72]/20 ring-1 ring-[#d8bea9] sm:h-16 sm:w-16"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "S";
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 border-white bg-[#fff8f3] font-display text-2xl text-[#8b5e3c] shadow-md shadow-[#b98f72]/20 ring-1 ring-[#d8bea9] sm:h-16 sm:w-16 sm:text-3xl">
      {initial}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-1">
      <span className="min-w-0 text-sand-500">{label}</span>
      <span
        className={`min-w-0 text-right ${
          accent
            ? "font-medium text-accent-700"
            : strong
              ? "font-semibold text-sand-900"
              : "text-sand-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  invalid,
  disabled,
  inputMode,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  invalid?: boolean;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-sand-600">{label}</span>
      <input
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-4 py-2.5 text-sand-900 outline-none placeholder:text-[#a98973] focus:border-[#8b5e3c] disabled:cursor-not-allowed disabled:bg-sand-100 disabled:text-sand-400 disabled:placeholder:text-sand-400 ${
          invalid ? "border-amber-300 bg-amber-50/50" : "border-[#ccb09a]"
        }`}
      />
      {hint && <span className="mt-1.5 block text-xs font-medium text-amber-700">{hint}</span>}
    </label>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-[#ccb09a] px-5 py-3 text-sm font-medium text-[#6f452d] transition hover:bg-[#f6eee7] sm:w-auto"
    >
      Voltar
    </button>
  );
}

