import { useState, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { logSystemError } from "../hooks/useSupabase";
import { FOLLOWUP_LABELS, type FollowupKind } from "../lib/followupKinds";

/**
 * Follow-ups desligados ESPECIFICAMENTE para este contato (tabela lead_followup_optout), com religar.
 * Sem isto, uma exclusão feita na tela de ativação ficaria invisível: ninguém saberia que aquele
 * contato deixou de receber confirmação, por exemplo, nem teria como voltar atrás.
 *
 * ⚠️ Não confundir com o toggle FOLLOW-UP do cabeçalho da conversa, que é o interruptor MESTRE do
 * lead ("não recebe nada"). Aqui é exceção por tipo.
 *
 * Fica na Secretária IA › Conversas E no painel LeadChat (usado por Kanban, Comercial e Auditoria),
 * porque o Kanban é a tela do dia a dia: esconder a exclusão lá seria esconder do operador.
 */
export function LeadFollowupOptouts({ leadId }: { leadId: string }) {
  const [kinds, setKinds] = useState<FollowupKind[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  // ⚠️ Guarda de resposta atrasada: sem ela, trocar de contato rápido fazia a resposta do ANTERIOR
  // chegar depois e rotular o contato errado como "não recebe".
  useEffect(() => {
    let alive = true;
    setKinds([]); setErro(false); // limpa na troca: não herda as etiquetas do contato anterior
    (async () => {
      const { data, error } = await supabase
        .from("lead_followup_optout").select("kind").eq("lead_id", leadId);
      if (!alive) return;
      if (error) {
        setErro(true);
        logSystemError('FOLLOWUP_OPTOUT_READ_FAIL',
          'Não foi possível ler os follow-ups desligados deste contato (a faixa pode omitir exclusões)',
          null, { lead_id: leadId, detail: error.message }, 'warn');
        return;
      }
      setKinds((data || []).map((r: any) => r.kind as FollowupKind));
    })();
    return () => { alive = false; };
  }, [leadId]);

  const religar = async (k: FollowupKind) => {
    setBusy(k);
    const { data: r, error } = await supabase.rpc("set_lead_followup_optout", {
      p_lead_id: leadId, p_kind: k, p_off: false,
    });
    setBusy(null);
    if (!error && (r as any)?.success) { setKinds(s => s.filter(x => x !== k)); return; }
    // Falhou: NÃO tira a etiqueta da tela (senão diria que religou sem ter religado).
    setErro(true);
    logSystemError('FOLLOWUP_OPTOUT_UNDO_FAIL',
      `Não foi possível religar o follow-up ${FOLLOWUP_LABELS[k] ?? k} deste contato`,
      null, { lead_id: leadId, kind: k, detail: error?.message ?? (r as any)?.error_code }, 'error');
  };

  if (kinds.length === 0 && !erro) return null;
  return (
    <div className="px-6 py-2 border-b border-slate-100 shrink-0 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
        Não recebe
      </span>
      {kinds.map(k => (
        <button
          key={k}
          onClick={() => religar(k)}
          disabled={busy === k}
          title={`${FOLLOWUP_LABELS[k] ?? k} está desligado só para este contato (vale para as próximas vezes também). Clique para religar.`}
          className="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-bold transition-all hover:bg-rose-100 disabled:opacity-40"
        >
          {FOLLOWUP_LABELS[k] ?? k}
          {busy === k ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
        </button>
      ))}
      {erro && (
        <span className="text-[10px] font-bold text-amber-700" title="A lista pode estar incompleta ou a última ação não foi salva.">
          ⚠️ não deu para confirmar esta lista
        </span>
      )}
    </div>
  );
}
