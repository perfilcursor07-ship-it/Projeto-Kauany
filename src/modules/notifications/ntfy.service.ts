// ===========================================================================
// Push dos avisos internos via ntfy (https://ntfy.sh).
//
// Usamos o formato JSON (POST na raiz do servidor) em vez de headers HTTP.
// Headers HTTP so aceitam ASCII, e os titulos tem acento e emoji -- pelo JSON
// o UTF-8 passa limpo.
//
// Isto NAO substitui o WhatsApp: as mensagens da cliente (confirmacao,
// lembretes, cancelamento, correcao de endereco) continuam indo pelo WhatsApp.
// O ntfy serve so para o studio avisar a si mesmo.
// ===========================================================================

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';

// Topicos no ntfy sao publicos: quem souber o nome le tudo que passa por ele.
// Como o aviso leva nome de cliente e valor, o topico precisa ser longo e
// impossivel de adivinhar.
export function suggestTopic(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 20; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `studio-${suffix}`;
}

// O ntfy aceita letras, numeros, '-' e '_' no nome do topico.
export function isValidTopic(topic: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(topic);
}

export function normalizeServer(server: string | null | undefined): string {
  const value = (server ?? '').trim();
  if (!value) return DEFAULT_NTFY_SERVER;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}

export interface NtfyMessage {
  title: string;
  body: string;
  /** 1 = min ... 5 = max. 4 (high) faz o celular tocar na hora. */
  priority?: number;
  tags?: string[];
  /** Abre esta URL ao tocar na notificacao. */
  clickUrl?: string;
}

export async function sendNtfy(
  server: string | null | undefined,
  topic: string,
  message: NtfyMessage,
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeServer(server);
  if (!isValidTopic(topic)) {
    return { ok: false, error: 'Topico do ntfy invalido' };
  }

  // Timeout proprio: sem ele uma indisponibilidade do ntfy travaria a fila.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        topic,
        title: message.title,
        message: message.body,
        priority: message.priority ?? 4,
        ...(message.tags?.length ? { tags: message.tags } : {}),
        ...(message.clickUrl ? { click: message.clickUrl } : {}),
      }),
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      return { ok: false, error: `ntfy respondeu ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') return { ok: false, error: 'ntfy nao respondeu em 10s' };
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}
