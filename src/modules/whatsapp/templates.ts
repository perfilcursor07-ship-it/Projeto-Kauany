export const STUDIO_ADDRESS_URL = 'https://maps.app.goo.gl/WmtcSPEgADHH12rR6';

// Substitui placeholders {chave} pelas variaveis fornecidas.
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
