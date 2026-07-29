/**
 * Tipos de follow-up do sistema. Estes valores são o vocabulário FECHADO usado em três lugares que
 * têm de concordar: o `p_kind` da RPC `preview_followup_activation`, a coluna `kind` da tabela
 * `lead_followup_optout` (que tem CHECK com exatamente esta lista) e os rótulos de tela.
 *
 * ⚠️ Acrescentar um tipo aqui exige acrescentar no CHECK da tabela e no motor de envio
 * correspondente, senão o opt-out daquele tipo não funciona (e falha em silêncio).
 */
export type FollowupKind =
  | "welcome" | "reengagement" | "confirmation" | "appt_reminder"
  | "pos_ganho" | "pos_perdido"
  | "finish_ganho" | "finish_perdido" | "finish_service";

export const FOLLOWUP_LABELS: Record<FollowupKind, string> = {
  welcome: "Boas-vindas",
  reengagement: "Reengajamento",
  confirmation: "Confirmação",
  appt_reminder: "Lembrete de Consulta",
  pos_ganho: "Pós-Atendimento (Ganho)",
  pos_perdido: "Pós-Atendimento (Perdido)",
  finish_ganho: "Encerramento (Ganho)",
  finish_perdido: "Encerramento (Perdido)",
  finish_service: "Encerramento (Atendimento)",
};
