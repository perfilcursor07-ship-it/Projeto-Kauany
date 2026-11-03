"use client";

import { useCallback, useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/api";

type Status = {
  mode: "manual" | "baileys";
  status: "disconnected" | "connecting" | "connected";
  phoneNumber: string | null;
  qr: string | null;
};

type Notification = {
  id: string;
  triggerKey: string;
  toPhone: string;
  body: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  appointment: { clientName: string; startAt: string; status: string } | null;
};

type TestMessage = {
  triggerKey: string;
  label: string;
  body: string;
  source: "template" | "padrao";
  internal: boolean;
};

type NotificationsResponse = {
  mode: "manual" | "baileys";
  studioPhone: string | null;
  // Numero que recebe os avisos internos (sinal recebido etc).
  notifyPhone: string | null;
  // Numero da conta conectada ao robo.
  connectedPhone: string | null;
  // true quando o aviso interno iria para a propria conta conectada: o
  // WhatsApp nao notifica mensagens que voce manda para voce mesmo.
  notifySelfSend: boolean;
  notifications: Notification[];
};

const TRIGGER_LABEL: Record<string, string> = {
  confirmed: "Confirmação",
  reminder_24h: "Lembrete 24h",
  reminder_2h: "Lembrete do dia",
  cancelled: "Cancelamento",
  manager_paid: "Aviso interno",
  address_update: "Correção de endereço",
};

// Exibe o numero no formato +55 (DD) 9XXXX-XXXX.
function formatPhone(phone: string | null) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  const local = d.startsWith("55") ? d.slice(2) : d;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  if (rest.length < 8) return `+${d}`;
  const head = rest.slice(0, rest.length - 4);
  return `+55 (${ddd}) ${head}-${rest.slice(-4)}`;
}

// Monta o link wa.me com a mensagem pronta (normaliza o DDI 55).
function waLink(phone: string, body: string) {
  let digits = phone.replace(/\D/g, "");
  if (!digits.startsWith("55") && digits.length <= 11) digits = "55" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
}

export default function WhatsappPage() {
  const [st, setSt] = useState<Status>({ mode: "manual", status: "disconnected", phoneNumber: null, qr: null });
  const [data, setData] = useState<NotificationsResponse>({
    mode: "manual",
    studioPhone: null,
    notifyPhone: null,
    connectedPhone: null,
    notifySelfSend: false,
    notifications: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setSt(await api<Status>("/api/admin/whatsapp/status", { auth: true }));
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setData(await api<NotificationsResponse>("/api/admin/whatsapp/notifications", { auth: true }));
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadData();
    const a = setInterval(loadData, 8000);
    const b = setInterval(loadStatus, 5000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [loadStatus, loadData]);

  async function markSent(id: string) {
    try {
      await api(`/api/admin/whatsapp/notifications/${id}/sent`, { method: "POST", auth: true });
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function sendAndMark(n: Notification) {
    window.open(waLink(n.toPhone, n.body), "_blank");
    // Marca como enviada logo apos abrir o WhatsApp.
    markSent(n.id);
  }

  async function retry(id: string) {
    try {
      await api(`/api/admin/whatsapp/notifications/${id}/retry`, { method: "POST", auth: true });
      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function resendAddress(id: string) {
    setError(null);
    setNotice(null);
    setResendingId(id);
    try {
      await api(`/api/admin/whatsapp/notifications/${id}/resend-address`, { method: "POST", auth: true });
      setNotice(manual
        ? "Correção adicionada às mensagens para enviar."
        : "Correção adicionada à fila do WhatsApp.");
      await loadData();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResendingId(null);
    }
  }

  const manual = (st.mode ?? data.mode) === "manual";
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const pending = notifications.filter((n) => n.status === "pending");
  const history = notifications.filter((n) => n.status !== "pending");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-lg border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/40 sm:p-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-accent-700">
          Mensagens
        </div>
        <h1 className="font-display text-3xl text-sand-900">WhatsApp</h1>
        <p className="mt-1 text-sm text-sand-500">
          {manual
            ? "Mensagens prontas para confirmação, lembretes e avisos do studio."
            : "Conexão automática pelo número do studio."}
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {manual ? (
        <>
          <div className="rounded-lg border border-accent-100 bg-accent-50 p-4 text-sm text-sand-700 shadow-sm shadow-accent-100/40">
            <p className="font-semibold text-accent-800">Modo manual assistido</p>
            <p className="mt-1 text-sand-600">
              As mensagens ficam prontas aqui. Você toca em <strong>Enviar no WhatsApp</strong>,
              confere e envia pelo seu próprio WhatsApp, evitando envio automático em massa.
            </p>
          </div>

          <TestSendCard manual connected={false} />

          {/* Mensagens para enviar */}
          <section className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg text-sand-900">Mensagens para enviar</h2>
              {pending.length > 0 && (
                <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-semibold text-accent-700">
                  {pending.length} pendente{pending.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {pending.length === 0 && (
              <p className="text-sm text-sand-400">
                Nenhuma mensagem pendente. Quando uma cliente pagar o sinal, a confirmação aparece aqui.
              </p>
            )}

            <div className="space-y-3">
              {pending.map((n) => (
                <div key={n.id} className="rounded-xl border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/30">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-accent-50 px-2 py-0.5 text-xs font-medium text-accent-700">
                      {TRIGGER_LABEL[n.triggerKey] ?? n.triggerKey}
                    </span>
                    <span className="text-xs text-sand-400">{n.toPhone}</span>
                  </div>
                  <p className="whitespace-pre-line rounded-lg bg-white p-3 text-sm text-sand-700">
                    {n.body}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => sendAndMark(n)}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <WaIcon className="h-4 w-4" />
                      Enviar no WhatsApp
                    </button>
                    <button
                      onClick={() => markSent(n.id)}
                      className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-2 text-sm font-medium text-accent-700 hover:bg-accent-100"
                    >
                      Marcar como enviada
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Histórico */}
          {history.length > 0 && (
            <section className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
              <h2 className="mb-4 font-display text-lg text-sand-900">Enviadas recentemente</h2>
              <div className="space-y-2">
                {history.slice(0, 15).map((n) => (
                  <div
                    key={n.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-100 py-3 text-sm last:border-0"
                  >
                    <div>
                      <p className="text-sand-700">
                        {TRIGGER_LABEL[n.triggerKey] ?? n.triggerKey} · {n.appointment?.clientName ?? n.toPhone}
                      </p>
                      <p className="text-xs text-sand-400">
                        {n.toPhone} · {formatDateTime(n.appointment?.startAt ?? n.sentAt ?? n.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-sand-400">
                        {n.status === "sent" ? "enviada" : "falhou"}
                      </span>
                      {n.triggerKey === "confirmed" && n.status === "sent" && n.appointment?.status === "confirmed" && (
                        <button
                          onClick={() => resendAddress(n.id)}
                          disabled={resendingId === n.id}
                          className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-700 hover:bg-accent-100 disabled:opacity-50"
                        >
                          {resendingId === n.id ? "Adicionando…" : "Reenviar endereço"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <BaileysPanel st={st} onChanged={loadStatus} />
          <NotifyPhoneCard data={data} onSaved={loadData} />
          <TestSendCard manual={false} connected={st.status === "connected"} />
          <Logs notifications={notifications} onRetry={retry} onResendAddress={resendAddress} resendingId={resendingId} />
        </>
      )}
    </div>
  );
}

// Envio de teste: escolhe qual mensagem, confere o texto exatamente como a
// cliente vai receber e manda para um numero qualquer. O texto vem do backend
// com a mesma regra do envio real (template do banco, senao o padrao), por
// isso o teste e fiel.
function TestSendCard({ manual, connected }: { manual: boolean; connected: boolean }) {
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ messages: TestMessage[] }>("/api/admin/whatsapp/test-messages", { auth: true })
      .then((r) => {
        setMessages(r.messages);
        const first = r.messages[0];
        if (first) {
          setSelected(first.triggerKey);
          setBody(first.body);
        }
      })
      .catch((e: any) => setErr(e.message));
  }, []);

  const current = messages.find((m) => m.triggerKey === selected) ?? null;

  function pick(triggerKey: string) {
    const found = messages.find((m) => m.triggerKey === triggerKey);
    if (!found) return;
    setSelected(triggerKey);
    setBody(found.body);
    setEdited(false);
    setMsg(null);
    setErr(null);
  }

  function restore() {
    if (!current) return;
    setBody(current.body);
    setEdited(false);
  }

  async function send() {
    const digits = phone.replace(/\D/g, "");
    setMsg(null);
    setErr(null);
    if (digits.length < 10) {
      setErr("Informe o número com DDD.");
      return;
    }
    if (!body.trim()) {
      setErr("A mensagem está vazia.");
      return;
    }

    // No modo manual o robo nao envia: abre o WhatsApp com o texto pronto.
    if (manual) {
      window.open(waLink(digits, body), "_blank");
      setMsg("WhatsApp aberto com a mensagem pronta para enviar.");
      return;
    }

    setBusy(true);
    try {
      await api("/api/admin/whatsapp/test", {
        method: "POST",
        auth: true,
        body: JSON.stringify({ to: digits, message: body }),
      });
      setMsg(`Mensagem de teste enviada para ${digits}. Confira no aparelho.`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
      <h2 className="font-display text-lg text-sand-900">Testar mensagens</h2>
      <p className="mt-1 text-sm text-sand-500">
        Escolha a mensagem, confira o texto e envie para um número para ver como a cliente
        recebe. O teste usa dados de exemplo e <strong>não entra nos logs de envio</strong>.
      </p>

      {err && (
        <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {err}
        </div>
      )}
      {msg && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {msg}
        </div>
      )}
      {!manual && !connected && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          O WhatsApp está desconectado. Conecte acima para conseguir enviar o teste.
        </div>
      )}

      {/* Qual mensagem */}
      <div className="mt-4 flex flex-wrap gap-2">
        {messages.map((m) => (
          <button
            key={m.triggerKey}
            type="button"
            onClick={() => pick(m.triggerKey)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              m.triggerKey === selected
                ? "border-accent-500 bg-accent-600 text-white"
                : "border-accent-200 bg-accent-50 text-accent-700 hover:bg-accent-100"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {current && (
        <p className="mt-2 text-xs text-sand-400">
          {current.source === "template"
            ? "Texto vindo do template salvo no painel."
            : "Texto padrão do sistema (nenhum template salvo para esta mensagem)."}
          {current.internal && " · Esta mensagem é o aviso para a gestora, não vai para a cliente."}
        </p>
      )}

      {/* Previa editavel */}
      <label className="mt-4 block text-sm">
        <span className="mb-1 flex items-center justify-between font-medium text-sand-700">
          Como vai chegar
          {edited && (
            <button
              type="button"
              onClick={restore}
              className="text-xs font-semibold text-accent-700 hover:underline"
            >
              Restaurar texto original
            </button>
          )}
        </span>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setEdited(true);
          }}
          rows={8}
          className="w-full whitespace-pre-line rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-800 outline-none focus:border-accent-400"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1 text-sm">
          <span className="mb-1 block font-medium text-sand-700">Enviar para (com DDD)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
            placeholder="63 99999-0000"
            className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-800 outline-none focus:border-accent-400"
          />
        </label>
        <button
          type="button"
          onClick={send}
          disabled={busy || (!manual && !connected)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <WaIcon className="h-4 w-4" />
          {busy ? "Enviando…" : manual ? "Abrir no WhatsApp" : "Enviar teste"}
        </button>
      </div>
    </section>
  );
}

// Numero que recebe os avisos internos. Precisa ser DIFERENTE do numero
// conectado ao robo: o WhatsApp nao notifica as suas proprias mensagens, elas
// caem na conversa "Mensagem para você mesmo" sem nenhum aviso no aparelho.
function NotifyPhoneCard({
  data,
  onSaved,
}: {
  data: NotificationsResponse;
  onSaved: () => Promise<void> | void;
}) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Enquanto o campo nao for editado, segue o valor que vem do servidor.
  useEffect(() => {
    if (!touched) setValue(data.notifyPhone ?? "");
  }, [data.notifyPhone, touched]);

  async function save(next: string | null) {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await api("/api/admin/whatsapp/notify-phone", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({ notifyPhone: next }),
      });
      setTouched(false);
      setMsg(next ? "Número salvo. Os próximos avisos internos vão para ele." : "Número removido.");
      await onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
      <h2 className="font-display text-lg text-sand-900">Avisos internos</h2>
      <p className="mt-1 text-sm text-sand-500">
        Número que recebe o aviso de <strong>sinal recebido</strong>. Precisa ser um número
        diferente do que está conectado ao robô
        {data.connectedPhone ? ` (${formatPhone(data.connectedPhone)})` : ""} — o WhatsApp não
        notifica mensagens que você manda para você mesma.
      </p>

      {data.notifySelfSend && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">O aviso interno não está chegando no celular.</p>
          <p className="mt-1">
            Hoje ele vai para o próprio número conectado, então cai na conversa
            “Mensagem para você mesmo” e o WhatsApp não gera notificação. Cadastre outro
            número abaixo (ex: seu WhatsApp pessoal).
          </p>
        </div>
      )}

      {err && (
        <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {err}
        </div>
      )}
      {msg && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {msg}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[220px] text-sm">
          <span className="mb-1 block font-medium text-sand-700">Número com DDD</span>
          <input
            value={value}
            onChange={(e) => {
              setTouched(true);
              setValue(e.target.value);
            }}
            inputMode="numeric"
            placeholder="63 99999-0000"
            className="w-full rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-800 outline-none focus:border-accent-400"
          />
        </label>
        <button
          onClick={() => save(value.replace(/\D/g, "") || null)}
          disabled={busy}
          className="rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
        {data.notifyPhone && (
          <button
            onClick={() => {
              setValue("");
              save(null);
            }}
            disabled={busy}
            className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-2.5 text-sm font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50"
          >
            Remover
          </button>
        )}
      </div>
    </section>
  );
}

// Logs de envio do robô (enviadas / pendentes / falhas).
function Logs({
  notifications,
  onRetry,
  onResendAddress,
  resendingId,
}: {
  notifications: Notification[];
  onRetry: (id: string) => void;
  onResendAddress: (id: string) => Promise<void>;
  resendingId: string | null;
}) {
  const sent = notifications.filter((n) => n.status === "sent").length;
  const pending = notifications.filter((n) => n.status === "pending").length;
  const failed = notifications.filter((n) => n.status === "failed").length;

  return (
    <section className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-sand-900">Logs de envio</h2>
        <div className="flex gap-2 text-xs">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
            {sent} enviadas
          </span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700">
            {pending} na fila
          </span>
          <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700">
            {failed} falhas
          </span>
        </div>
      </div>

      {notifications.length === 0 ? (
        <p className="text-sm text-sand-400">
          Nenhuma mensagem ainda. Assim que houver um pagamento, o robô registra o envio aqui.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-accent-100">
          <div className="grid grid-cols-[1fr_1fr_110px_120px] gap-3 border-b border-accent-100 bg-accent-50 px-4 py-2.5 text-[11px] font-semibold uppercase text-accent-700 max-sm:hidden">
            <span>Tipo</span>
            <span>Destino</span>
            <span>Status</span>
            <span className="text-right">Quando</span>
          </div>
          {notifications.map((n) => (
            <div
              key={n.id}
              className="grid gap-2 border-b border-accent-50 px-4 py-3 text-sm last:border-0 sm:grid-cols-[1fr_1fr_110px_120px] sm:items-center"
            >
              <span className="font-medium text-sand-800">
                {TRIGGER_LABEL[n.triggerKey] ?? n.triggerKey}
              </span>
              <span className="text-sand-500">
                {n.appointment?.clientName ? `${n.appointment.clientName} · ` : ""}{n.toPhone}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={n.status} />
                {n.status === "failed" && (
                  <button
                    onClick={() => onRetry(n.id)}
                    className="text-xs font-semibold text-accent-700 hover:underline"
                  >
                    Reenviar
                  </button>
                )}
                {n.triggerKey === "confirmed" && n.status === "sent" && n.appointment?.status === "confirmed" && (
                  <button
                    onClick={() => onResendAddress(n.id)}
                    disabled={resendingId === n.id}
                    className="text-xs font-semibold text-accent-700 hover:underline disabled:opacity-50"
                  >
                    {resendingId === n.id ? "Adicionando…" : "Reenviar endereço"}
                  </button>
                )}
              </div>
              <span className="text-xs text-sand-400 sm:text-right">
                {formatDateTime(n.sentAt ?? n.createdAt)}
              </span>
              {n.status === "failed" && n.error && (
                <span className="text-xs text-red-500 sm:col-span-4">{n.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sent: { label: "Enviada", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    pending: { label: "Na fila", cls: "border-amber-200 bg-amber-50 text-amber-700" },
    failed: { label: "Falhou", cls: "border-red-200 bg-red-50 text-red-600" },
    cancelled: { label: "Cancelada", cls: "border-sand-200 bg-sand-50 text-sand-500" },
    expired: { label: "Expirada", cls: "border-sand-200 bg-sand-50 text-sand-500" },
  };
  const item = map[status] ?? { label: status || "Desconhecido", cls: "border-sand-200 bg-sand-50 text-sand-500" };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${item.cls}`}>
      {item.label}
    </span>
  );
}

// Painel de conexão automática (só aparece se WHATSAPP_MODE=baileys).
function BaileysPanel({ st, onChanged }: { st: Status; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try {
      await api("/api/admin/whatsapp/connect", { method: "POST", auth: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await api("/api/admin/whatsapp/disconnect", { method: "POST", auth: true });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border border-accent-100 bg-white p-6 shadow-sm shadow-accent-100/40">
      {st.status === "connected" ? (
        <div>
          <p className="text-sm text-sand-600">Conectado{st.phoneNumber ? ` (+${st.phoneNumber})` : ""}.</p>
          <button onClick={disconnect} disabled={busy} className="mt-4 rounded-lg border border-accent-200 bg-accent-50 px-5 py-2.5 text-sm font-medium text-accent-700 hover:bg-accent-100">
            Desconectar
          </button>
        </div>
      ) : st.qr ? (
        <div className="text-center">
          <p className="mb-3 text-sm text-sand-600">Escaneie o QR no WhatsApp → Aparelhos conectados.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={st.qr} alt="QR Code" className="mx-auto h-60 w-60 rounded-xl border border-sand-200" />
        </div>
      ) : (
        <button onClick={connect} disabled={busy} className="rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-700">
          {busy ? "Aguarde…" : "Conectar WhatsApp"}
        </button>
      )}
    </section>
  );
}

function WaIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.5 15.3L2 22l4.8-1.5A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.8 0-1.3.7-2 .9-2.2.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.2.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.1 2.3 1.5 2.6 1.6.3.1.5.1.7-.1l.8-1c.2-.2.4-.2.6-.1l1.9.9c.3.2.5.2.5.4.1.2.1.8-.1 1.4Z" />
    </svg>
  );
}
