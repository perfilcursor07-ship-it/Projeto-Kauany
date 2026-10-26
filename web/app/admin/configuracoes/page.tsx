"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Settings = {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  slug: string | null;
};

const MAX_LOGO_BYTES = 500 * 1024; // 500 KB

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeBrazilPhone(value: string) {
  let digits = onlyDigits(value);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 30);
}

function formatPhone(value: string) {
  const number = onlyDigits(value);

  if (!number) return "";
  if (number.length > 11) return number;
  if (number.length <= 2) return `(${number}`;

  const areaCode = number.slice(0, 2);
  const subscriber = number.slice(2);
  if (subscriber.length <= 4) return `(${areaCode}) ${subscriber}`;
  if (subscriber.length <= 8) {
    return `(${areaCode}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
  }
  return `(${areaCode}) ${subscriber.slice(0, 5)}-${subscriber.slice(5, 9)}`;
}

function normalizeSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export default function ConfiguracoesPage() {
  const [name, setName] = useState("");
  // Guardamos somente os dígitos; a formatação existe apenas no campo visual.
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<Settings>("/api/admin/settings", { auth: true })
      .then((s) => {
        setName(s.name);
        setPhone(normalizeBrazilPhone(s.phone ?? ""));
        setLogoUrl(s.logoUrl);
        setSlug(s.slug ?? "");
      })
      .catch((e) => setError(e.message));
  }, []);

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Imagem muito grande (máx. 500 KB). Use uma menor.");
      return;
    }
    setError(null);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = () => setLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const saved = await api<Settings>("/api/admin/settings", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({
          name: name.trim(),
          slug: normalizeSlug(slug),
          phone: phone || null,
          logoUrl,
        }),
      });
      setSlug(saved.slug ?? "");
      setPhone(normalizeBrazilPhone(saved.phone ?? ""));
      setMsg("Configurações salvas.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function updatePhone(value: string) {
    // Colagens no formato internacional são convertidas para DDD + número.
    setPhone(normalizeBrazilPhone(value));
    setError(null);
    setMsg(null);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <section className="overflow-hidden rounded-2xl border border-accent-100 bg-white shadow-sm shadow-accent-100/50">
        <div className="bg-gradient-to-br from-accent-50 via-white to-white px-5 py-6 sm:px-7 sm:py-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent-100 bg-white text-accent-700 shadow-sm">
              <SettingsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-700">
                Painel do studio
              </p>
              <h1 className="mt-1 font-display text-3xl text-sand-900">Configurações</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-sand-500">
                Cuide da identidade do seu studio e dos dados que aparecem no link de agendamento.
              </p>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
          <span className="mt-0.5 font-bold">!</span>
          <p>{error}</p>
        </div>
      )}
      {msg && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3.5 text-sm text-accent-800">
          <span className="mt-0.5 font-bold">✓</span>
          <p>{msg}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm shadow-sand-200/40">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
          <section className="space-y-6 p-5 sm:p-7" aria-labelledby="identity-heading">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">Informações públicas</p>
              <h2 id="identity-heading" className="mt-1 font-display text-xl text-sand-900">Identidade do studio</h2>
              <p className="mt-1 text-sm leading-6 text-sand-500">Esses dados ajudam as clientes a reconhecer e encontrar seu espaço.</p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-sand-700">Nome do studio</span>
              <input
                value={name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  setName(nextName);
                  if (!slug) setSlug(normalizeSlug(nextName));
                  setMsg(null);
                }}
                placeholder="Ex.: Studio Flora"
                autoComplete="organization"
                className="w-full rounded-xl border border-sand-300 bg-white px-4 py-3 text-sm text-sand-900 outline-none transition placeholder:text-sand-400 focus:border-accent-500 focus:ring-4 focus:ring-accent-100"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-sand-700">Link público</span>
              <div className="flex overflow-hidden rounded-xl border border-sand-300 bg-white transition focus-within:border-accent-500 focus-within:ring-4 focus-within:ring-accent-100">
                <span className="flex items-center border-r border-sand-200 bg-sand-50 px-4 text-sm text-sand-400">/</span>
                <input
                  value={slug}
                  onChange={(e) => {
                    setSlug(normalizeSlug(e.target.value));
                    setMsg(null);
                  }}
                  placeholder="studio-flora"
                  autoComplete="off"
                  className="min-w-0 flex-1 px-4 py-3 text-sm text-sand-900 outline-none placeholder:text-sand-400"
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-sand-500">Esse endereço abre a página de agendamento do seu studio.</p>
            </label>

            <div className="rounded-xl border border-sand-200 bg-sand-50/70 p-4">
              <p className="text-xs font-semibold text-sand-700">Endereço da página</p>
              <p className="mt-1 break-all text-sm font-medium text-accent-700">
                /{slug || "seu-studio"}
              </p>
            </div>
          </section>

          <div className="space-y-0 border-t border-sand-200 lg:border-l lg:border-t-0">
            <section className="p-5 sm:p-7" aria-labelledby="logo-heading">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">Apresentação</p>
                <h2 id="logo-heading" className="mt-1 font-display text-xl text-sand-900">Logomarca</h2>
                <p className="mt-1 text-sm leading-6 text-sand-500">Uma imagem quadrada funciona melhor no painel e na página pública.</p>
              </div>

              <div className="mt-5 flex items-center gap-4 rounded-xl border border-sand-200 bg-sand-50/60 p-4">
                {logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={logoUrl} alt="Prévia da logomarca do studio" className="h-20 w-20 shrink-0 rounded-2xl border border-sand-200 bg-white object-cover shadow-sm" />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-dashed border-accent-200 bg-white font-display text-3xl text-accent-700">
                    {(name.trim().charAt(0) || "S").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-sand-800">{name.trim() || "Seu studio"}</p>
                  <p className="mt-0.5 text-xs text-sand-500">Prévia da imagem</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input ref={fileRef} type="file" accept="image/*" onChange={onPickLogo} className="hidden" />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="rounded-lg border border-accent-200 bg-white px-3 py-2 text-xs font-semibold text-accent-700 transition hover:border-accent-300 hover:bg-accent-50"
                    >
                      {logoUrl ? "Trocar imagem" : "Enviar imagem"}
                    </button>
                    {logoUrl && (
                      <button type="button" onClick={() => { setLogoUrl(null); setMsg(null); }} className="text-xs font-medium text-sand-500 transition hover:text-red-600">
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs text-sand-400">PNG ou JPG · até 500 KB</p>
            </section>

            <section className="border-t border-sand-200 p-5 sm:p-7" aria-labelledby="phone-heading">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-700">Mensagens</p>
                <h2 id="phone-heading" className="mt-1 font-display text-xl text-sand-900">WhatsApp do studio</h2>
                <p className="mt-1 text-sm leading-6 text-sand-500">Número usado para receber avisos e confirmações do studio.</p>
              </div>

              <label className="mt-4 block">
                <span className="mb-1.5 block text-sm font-medium text-sand-700">WhatsApp / telefone</span>
                <div className="flex overflow-hidden rounded-xl border border-sand-300 bg-white transition focus-within:border-accent-500 focus-within:ring-4 focus-within:ring-accent-100">
                  <span className="flex items-center border-r border-sand-200 bg-sand-50 px-3.5 text-sm font-medium text-sand-500">+55</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={formatPhone(phone)}
                    onChange={(e) => updatePhone(e.target.value)}
                    placeholder="(63) 99999-9999"
                    className="min-w-0 flex-1 px-4 py-3 text-sm text-sand-900 outline-none placeholder:text-sand-400"
                  />
                </div>
              </label>
              <div className="mt-3 flex gap-2.5 rounded-xl border border-accent-100 bg-accent-50/70 p-3.5">
                <PhoneCheckIcon />
                <p className="text-xs leading-5 text-sand-600">
                  A máscara facilita a leitura. O sistema salva e envia somente os dígitos, sem parênteses, espaços ou traços.
                </p>
              </div>
              <p className="mt-2 text-xs text-sand-400">Digite o DDD e o número. O código +55 já está incluído.</p>
            </section>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-sand-200 bg-sand-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <p className="text-xs leading-5 text-sand-500">As alterações aparecem no link público depois de salvar.</p>
          <button
            type="button"
            onClick={save}
            disabled={saving || name.trim().length < 2 || normalizeSlug(slug).length < 2}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-800 focus:outline-none focus:ring-4 focus:ring-accent-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="m19.4 15 .1.1 1.2 2-2 3.4-2.2-.6a8 8 0 0 1-1.8 1L14 23h-4l-.7-2.1a8 8 0 0 1-1.8-1l-2.2.6-2-3.4 1.3-2a8 8 0 0 1 0-2.1l-1.3-2 2-3.4 2.2.6a8 8 0 0 1 1.8-1L10 3h4l.7 2.1a8 8 0 0 1 1.8 1l2.2-.6 2 3.4-1.3 2a8 8 0 0 1 0 2.1Z" transform="translate(0 -1) scale(.92) translate(1 1)" />
    </svg>
  );
}

function PhoneCheckIcon() {
  return (
    <svg className="mt-0.5 h-4 w-4 shrink-0 text-accent-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
