/**
 * Leitura das chaves de `clinics.features` (jsonb). A semântica MUDA por chave
 * (CLAUDE.md §0.3): umas são opt-in (`=== true`), outras opt-out (`!== false`).
 * Centralizar o predicado evita a cópia de linha que troca `=== true` por
 * `!== false` e liga ou desliga módulo em todos os clientes de uma vez.
 */

type ComFeatures = { features?: { feature_chat_send?: boolean | null } | null } | null | undefined;

/**
 * Envio manual pelo chat (ChatComposer, respostas rápidas e a aba que as gerencia).
 * Opt-IN: ausente ou false = desligado.
 */
export function chatSendAtivo(clinic: ComFeatures): boolean {
  return clinic?.features?.feature_chat_send === true;
}
