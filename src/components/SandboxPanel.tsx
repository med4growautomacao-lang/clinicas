import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useClinics } from '../hooks/useSupabase';
import { cn } from '@/src/lib/utils';
import { useToast } from './ui/toast';
import { Send, Loader2, RotateCcw, FlaskConical, Bot, ChevronDown } from 'lucide-react';

// Ambiente de teste do Agente IA. Conversa como "paciente"; o agente REAL da clínica responde,
// mas nada sai para o WhatsApp (o lead é is_simulation → o Emissor roteia para transport=sandbox).
// A resposta chega por Realtime (chat_messages). "Reiniciar" limpa a sessão (purge reversível).

interface Msg {
  id: string;
  sender: string;      // 'human' (você) | 'ai' (agente) | 'system'
  direction: string;   // 'inbound' | 'outbound'
  content: string;
  created_at: string;
}

const contentOf = (m: any): string => {
  const msg = m?.message;
  if (typeof msg === 'string') return msg;
  if (msg && typeof msg === 'object') return String(msg.content ?? '');
  return '';
};

// clinicId por prop = escopo fixo (Configurações IA da clínica, sem seletor). Sem prop = mostra o
// seletor (uso cross-clínica no Super Admin).
export function SandboxPanel({ clinicId: fixedClinicId }: { clinicId?: string } = {}) {
  const { data: clinics } = useClinics();
  const showToast = useToast();
  const [pickedClinic, setPickedClinic] = useState<string>('');
  const clinicId = fixedClinicId ?? pickedClinic;
  const showSelector = !fixedClinicId;
  // Chave da conversa = session_id (NAO lead_id): a resposta do agente (saveAiResponse) grava por
  // session_id e nem sempre tem lead_id preenchido; o inbound e o ai compartilham o session_id.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const sortedClinics = [...(clinics || [])].sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, waiting]);

  // Rede de seguranca: se o agente terminar SEM gravar resposta (resposta vazia ou bloqueada por
  // conteudo tecnico, ambas com early-return no worker antes do saveAiResponse), nenhum evento
  // Realtime chega e o spinner ficaria girando p/ sempre. Limpa apos 45s e avisa.
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => {
      setWaiting(false);
      showToast('O agente não respondeu (resposta vazia ou bloqueada). Veja a Central de Erros.', 'error');
    }, 45000);
    return () => clearTimeout(t);
  }, [waiting]);

  // Troca de clínica: zera a tela (a sessão é por clínica; carrega ao enviar/assinar).
  useEffect(() => { setSessionId(null); setMessages([]); }, [clinicId]);

  // Realtime: assina a conversa de simulação (por session_id) assim que ele é conhecido.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('chat_messages')
        .select('id, sender, direction, message, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (!cancelled && data) {
        setMessages(data.map((m: any) => ({
          id: m.id, sender: m.sender, direction: m.direction, content: contentOf(m), created_at: m.created_at,
        })));
      }
    })();

    const channel = supabase
      .channel(`sandbox_${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const m = payload.new as any;
          setMessages(prev => {
            if (prev.find(x => x.id === m.id)) return prev;
            return [...prev, { id: m.id, sender: m.sender, direction: m.direction, content: contentOf(m), created_at: m.created_at }];
          });
          if (m.sender === 'ai' || m.sender === 'system') setWaiting(false);
        })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [sessionId]);

  const send = async () => {
    const text = input.trim();
    if (!text || !clinicId || sending) return;
    setSending(true);
    setInput('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-sandbox', {
        body: { action: 'send', clinic_id: clinicId, mensagem: text },
      });
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'falha');
      setSessionId((data as any).session_id as string);
      setWaiting(true);
    } catch (e: any) {
      showToast(`Não deu para enviar: ${String(e?.message ?? e)}`, 'error');
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    if (!clinicId) return;
    try {
      const { data, error } = await supabase.functions.invoke('ai-sandbox', {
        body: { action: 'reset', clinic_id: clinicId, delete_lead: true },
      });
      if (error || !(data as any)?.ok) throw new Error((data as any)?.error || error?.message || 'falha');
      setSessionId(null); setMessages([]); setWaiting(false);
      showToast('Sessão de teste reiniciada.', 'success');
    } catch (e: any) {
      showToast(`Não deu para reiniciar: ${String(e?.message ?? e)}`, 'error');
    }
  };

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-violet-700">
          <FlaskConical className="w-5 h-5" />
          <h3 className="font-black">Testar o Agente</h3>
        </div>
        {showSelector && (
          <div className="relative">
            <select
              value={pickedClinic}
              onChange={(e) => setPickedClinic(e.target.value)}
              className="appearance-none bg-white border border-slate-200 rounded-xl pl-3 pr-9 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            >
              <option value="">Escolha a clínica…</option>
              {sortedClinics.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}
        {clinicId && (
          <button onClick={reset}
            className="ml-auto flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-rose-600 transition-colors">
            <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400 -mt-1">
        Você conversa como paciente e o agente real da clínica responde. Nada é enviado para o WhatsApp:
        é uma simulação isolada. Agendamentos criados no teste são apagados ao reiniciar.
      </p>

      {/* Chat */}
      <div className="border border-slate-200 rounded-2xl bg-slate-50 flex flex-col" style={{ height: '60vh', maxHeight: 640 }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {!clinicId ? (
            <div className="h-full flex items-center justify-center text-slate-400 text-sm">
              {showSelector ? 'Escolha uma clínica para começar.' : 'Carregando…'}
            </div>
          ) : messages.length === 0 && !waiting ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
              <Bot className="w-8 h-8 text-slate-300" />
              Envie uma mensagem para iniciar a conversa de teste.
            </div>
          ) : (
            messages.map(m => {
              const mine = m.sender === 'human';
              const isSystem = m.sender === 'system';
              return (
                <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[78%] px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm',
                    mine ? 'bg-violet-600 text-white rounded-br-sm'
                      : isSystem ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-white text-slate-700 border border-slate-200 rounded-bl-sm')}>
                    {!mine && !isSystem && (
                      <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-teal-600 mb-0.5">
                        <Bot className="w-3 h-3" /> Agente
                      </div>
                    )}
                    {m.content}
                  </div>
                </div>
              );
            })
          )}
          {waiting && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm">
                <Loader2 className="w-4 h-4 text-teal-500 animate-spin" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-3 bg-white rounded-b-2xl">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={!clinicId || sending}
              rows={1}
              placeholder={clinicId ? 'Escreva como se fosse o paciente…' : 'Escolha uma clínica primeiro'}
              className="flex-1 resize-none max-h-32 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={!clinicId || !input.trim() || sending}
              className="flex-shrink-0 w-11 h-11 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 transition-colors">
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
