"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type BioSetting = {
  enabled: boolean;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  backgroundUrl: string | null;
  instagramUrl: string;
};

type BioLink = {
  id: string;
  label: string;
  url: string | null;
  type: "external" | "booking" | "document";
  fileName: string | null;
  sortOrder: number;
  active: boolean;
};

type BioResponse = {
  setting: BioSetting;
  links: BioLink[];
};

type LinkForm = {
  label: string;
  url: string;
  type: BioLink["type"];
  sortOrder: number;
  active: boolean;
};

const MAX_IMAGE_BYTES = 900 * 1024;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

const emptyLink: LinkForm = {
  label: "",
  url: "",
  type: "external",
  sortOrder: 10,
  active: true,
};

export default function BioPage() {
  const [setting, setSetting] = useState<BioSetting>({
    enabled: false,
    title: "",
    subtitle: "",
    avatarUrl: null,
    coverUrl: null,
    backgroundUrl: null,
    instagramUrl: "",
  });
  const [links, setLinks] = useState<BioLink[]>([]);
  const [form, setForm] = useState(emptyLink);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<File | null>(null);
  const [savedDocumentName, setSavedDocumentName] = useState<string | null>(null);

  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setError(null);
    try {
      const data = await api<BioResponse>("/api/admin/bio", { auth: true });
      setSetting(data.setting);
      setLinks(data.links);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function pickImage(
    e: React.ChangeEvent<HTMLInputElement>,
    field: "avatarUrl" | "coverUrl" | "backgroundUrl",
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Imagem muito grande. Use uma imagem com até 900 KB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setSetting((current) => ({ ...current, [field]: reader.result as string }));
    reader.readAsDataURL(file);
  }

  async function saveSetting() {
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      await api("/api/admin/bio/settings", {
        method: "PUT",
        auth: true,
        body: JSON.stringify({
          ...setting,
          subtitle: setting.subtitle.trim() || null,
          instagramUrl: setting.instagramUrl.trim() || null,
        }),
      });
      setMsg("Bio salva.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function editLink(link: BioLink) {
    setEditingId(link.id);
    setSelectedDocument(null);
    setSavedDocumentName(link.type === "document" ? link.fileName : null);
    setForm({
      label: link.label,
      url: link.url ?? "",
      type: link.type,
      sortOrder: link.sortOrder,
      active: link.active,
    });
  }

  function resetLinkForm() {
    setEditingId(null);
    setForm(emptyLink);
    setSelectedDocument(null);
    setSavedDocumentName(null);
    if (documentRef.current) documentRef.current.value = "";
  }

  function pickDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    const validType = extension === "pdf" || extension === "docx";
    if (!validType) {
      setError("Selecione um arquivo PDF ou DOCX válido.");
      setSelectedDocument(null);
      e.target.value = "";
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError("Arquivo muito grande. Use um PDF ou DOCX com até 5 MB.");
      setSelectedDocument(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setSelectedDocument(file);
  }

  async function saveLink(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMsg(null);
    try {
      const documentData =
        form.type === "document" && selectedDocument
          ? await readFileAsBase64(selectedDocument)
          : null;
      await api(editingId ? `/api/admin/bio/links/${editingId}` : "/api/admin/bio/links", {
        method: editingId ? "PATCH" : "POST",
        auth: true,
        body: JSON.stringify({
          label: form.label.trim(),
          type: form.type,
          url: form.type === "external" ? form.url.trim() : null,
          ...(form.type === "document" && documentData && selectedDocument
            ? {
                documentData,
                fileName: selectedDocument.name,
                fileMime: documentMime(selectedDocument),
              }
            : {}),
          sortOrder: Number(form.sortOrder),
          active: form.active,
        }),
      });
      setMsg(editingId ? "Link atualizado." : "Link adicionado.");
      resetLinkForm();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(id: string) {
    if (!window.confirm("Remover este link da bio?")) return;
    setError(null);
    try {
      await api(`/api/admin/bio/links/${id}`, { method: "DELETE", auth: true });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-accent-100 bg-white p-4 shadow-sm shadow-accent-100/40 sm:p-5">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-[11px] font-semibold uppercase text-accent-700">
          Link na bio
        </div>
        <h1 className="font-display text-3xl text-sand-900">Bio pública</h1>
        <p className="mt-1 text-sm text-sand-500">
          Quando ativada, a página principal mostra sua bio. O agendamento fica no botão da bio.
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-700">
          {msg}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-[1fr_0.85fr]">
        <div className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-sand-900">Identidade da bio</h2>
              <p className="mt-1 text-sm text-sand-500">Foto, capa, título e descrição curta.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-2 text-sm font-semibold text-accent-700">
              <input
                type="checkbox"
                checked={setting.enabled}
                onChange={(e) => setSetting({ ...setting, enabled: e.target.checked })}
                className="h-4 w-4 accent-accent-600"
              />
              Bio ativa
            </label>
          </div>

          <div className="space-y-4">
            <Field
              label="Título"
              value={setting.title}
              onChange={(title) => setSetting({ ...setting, title })}
              placeholder="Ex.: Studio Flora"
            />
            <Field
              label="Subtítulo"
              value={setting.subtitle}
              onChange={(subtitle) => setSetting({ ...setting, subtitle })}
              placeholder="Ex.: Alongamento de unhas | Nail designer"
            />
            <Field
              label="Instagram (opcional)"
              value={setting.instagramUrl}
              onChange={(instagramUrl) => setSetting({ ...setting, instagramUrl })}
              placeholder="https://instagram.com/seuusuario"
            />

            <div className="grid gap-3 md:grid-cols-3">
              <ImagePicker
                title="Foto"
                image={setting.avatarUrl}
                onPick={() => avatarRef.current?.click()}
                onRemove={() => setSetting({ ...setting, avatarUrl: null })}
              />
              <ImagePicker
                title="Capa"
                image={setting.coverUrl}
                onPick={() => coverRef.current?.click()}
                onRemove={() => setSetting({ ...setting, coverUrl: null })}
              />
              <ImagePicker
                title="Fundo"
                image={setting.backgroundUrl}
                onPick={() => backgroundRef.current?.click()}
                onRemove={() => setSetting({ ...setting, backgroundUrl: null })}
              />
            </div>

            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, "avatarUrl")} />
            <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, "coverUrl")} />
            <input ref={backgroundRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e, "backgroundUrl")} />

            <button
              onClick={saveSetting}
              disabled={saving || setting.title.trim().length < 2}
              className="rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-40"
            >
              {saving ? "Salvando..." : "Salvar bio"}
            </button>
          </div>
        </div>

        <BioPreview setting={setting} links={links} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <form onSubmit={saveLink} className="rounded-lg border border-accent-100 bg-white p-5 shadow-sm shadow-accent-100/40">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl text-sand-900">
                {editingId ? "Editar botão" : "Novo botão"}
              </h2>
              <p className="mt-1 text-sm text-sand-500">
                Crie botões para WhatsApp, localização, serviços, agendamento ou arquivos.
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetLinkForm}
                className="rounded-lg border border-sand-200 px-3 py-2 text-xs font-medium text-sand-600 hover:bg-sand-50"
              >
                Cancelar
              </button>
            )}
          </div>

          <div className="space-y-3">
            <Field
              label="Texto do botão"
              value={form.label}
              onChange={(label) => setForm({ ...form, label })}
              placeholder="Ex.: WhatsApp"
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-sand-600">Tipo</span>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as BioLink["type"] })}
                className="w-full rounded-lg border border-sand-300 px-3 py-2.5 text-sm outline-none focus:border-accent-500"
              >
                <option value="external">Link externo</option>
                <option value="booking">Agendamento do sistema</option>
                <option value="document">Upload de arquivo (PDF ou DOCX)</option>
              </select>
            </label>
            {form.type === "external" && (
              <Field
                label="URL"
                value={form.url}
                onChange={(url) => setForm({ ...form, url })}
                placeholder="https://..."
              />
            )}
            {form.type === "document" && (
              <div>
                <span className="mb-1 block text-xs font-medium text-sand-600">Arquivo PDF ou DOCX</span>
                <input
                  ref={documentRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  onChange={pickDocument}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (documentRef.current) documentRef.current.value = "";
                      documentRef.current?.click();
                    }}
                    className="rounded-lg border border-accent-200 bg-accent-50 px-3 py-2.5 text-sm font-medium text-accent-700 hover:bg-accent-100"
                  >
                    {selectedDocument || savedDocumentName ? "Trocar arquivo" : "Selecionar arquivo"}
                  </button>
                  <span className="min-w-0 truncate text-xs text-sand-500">
                    {selectedDocument?.name || savedDocumentName || "Nenhum arquivo selecionado (máximo 5 MB)"}
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Ordem"
                value={String(form.sortOrder)}
                onChange={(sortOrder) => setForm({ ...form, sortOrder: Number(sortOrder || 0) })}
                type="number"
              />
              <label className="flex items-end gap-2 pb-3 text-sm text-sand-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="h-4 w-4 accent-accent-600"
                />
                Ativo
              </label>
            </div>
            <button
              disabled={
                saving ||
                form.label.trim().length < 2 ||
                (form.type === "external" && !form.url.trim()) ||
                (form.type === "document" && !selectedDocument && !savedDocumentName)
              }
              className="w-full rounded-lg bg-accent-600 py-3 text-sm font-medium text-white transition hover:bg-accent-700 disabled:opacity-40"
            >
              {saving ? "Salvando..." : editingId ? "Salvar botão" : "Adicionar botão"}
            </button>
          </div>
        </form>

        <div className="overflow-hidden rounded-lg border border-accent-100 bg-white shadow-sm shadow-accent-100/40">
          <div className="border-b border-accent-50 px-5 py-4">
            <h2 className="font-display text-xl text-sand-900">Botões da bio</h2>
            <p className="mt-1 text-sm text-sand-500">O menor número aparece primeiro.</p>
          </div>
          {links.length === 0 && <p className="p-5 text-sm text-sand-400">Nenhum botão cadastrado.</p>}
          {links.map((link) => (
            <div key={link.id} className="flex flex-col gap-3 border-b border-accent-50 px-5 py-4 last:border-0 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sand-900">{link.label}</p>
                  <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700">
                    {link.type === "booking" ? "Agendamento" : link.type === "document" ? "Arquivo" : "Link"}
                  </span>
                  {!link.active && (
                    <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] font-medium text-sand-500">
                      Inativo
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-sand-400">
                  Ordem {link.sortOrder}{" "}
                  {link.type === "document"
                    ? `- ${link.fileName || "Arquivo enviado"}`
                    : link.url
                      ? `- ${link.url}`
                      : "- abre o agendamento"}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => editLink(link)}
                  className="rounded-lg border border-accent-100 px-3 py-2 text-xs font-medium text-accent-700 hover:bg-accent-50"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => removeLink(link.id)}
                  className="rounded-lg border border-red-100 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-sand-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-sand-300 px-3 py-2.5 text-sm outline-none placeholder:text-sand-400 focus:border-accent-500"
      />
    </label>
  );
}

function documentMime(file: File) {
  return file.name.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo selecionado."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || !result.includes(",")) {
        reject(new Error("Não foi possível ler o arquivo selecionado."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function ImagePicker({
  title,
  image,
  onPick,
  onRemove,
}: {
  title: string;
  image: string | null;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-sand-200 p-3">
      <p className="mb-2 text-xs font-semibold text-sand-600">{title}</p>
      <div className="mb-3 flex h-24 items-center justify-center overflow-hidden rounded-lg bg-sand-50">
        {image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={image} alt={title} className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-sand-400">Sem imagem</span>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPick}
          className="flex-1 rounded-lg border border-accent-200 bg-accent-50 px-3 py-2 text-xs font-medium text-accent-700 hover:bg-accent-100"
        >
          Enviar
        </button>
        {image && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-sand-200 px-3 py-2 text-xs font-medium text-sand-500 hover:bg-sand-50"
          >
            Remover
          </button>
        )}
      </div>
    </div>
  );
}

function BioPreview({ setting, links }: { setting: BioSetting; links: BioLink[] }) {
  const visibleLinks = links.filter((link) => link.active);
  return (
    <div className="overflow-hidden rounded-lg border border-accent-100 bg-white shadow-sm shadow-accent-100/40">
      <div
        className="h-28 bg-gradient-to-r from-[#5f423a] via-[#d9a08c] to-[#2f352f] bg-cover bg-center"
        style={setting.coverUrl ? { backgroundImage: `url(${setting.coverUrl})` } : undefined}
      />
      <div className="-mt-10 px-5 pb-5 text-center">
        <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-accent-50 shadow-md">
          {setting.avatarUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={setting.avatarUrl} alt={setting.title} className="h-full w-full object-cover" />
          ) : (
            <span className="font-display text-3xl text-accent-700">
              {(setting.title || "S").charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <h3 className="text-xl font-semibold text-sand-900">{setting.title || "Sua bio"}</h3>
        {setting.subtitle && (
          <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-sand-500">{setting.subtitle}</p>
        )}
        <div className="mt-5 space-y-2">
          {visibleLinks.slice(0, 5).map((link) => (
            <div key={link.id} className="border border-sand-100 bg-white px-4 py-3 text-xs uppercase tracking-wide shadow-sm">
              {link.label}
            </div>
          ))}
          {visibleLinks.length === 0 && (
            <p className="rounded-lg border border-dashed border-sand-200 p-4 text-sm text-sand-400">
              Adicione botões para aparecerem aqui.
            </p>
          )}
        </div>
        <p className="mt-4 text-xs text-sand-400">
          {setting.enabled ? "Bio ativa na página principal" : "Bio desativada"}
        </p>
      </div>
    </div>
  );
}
