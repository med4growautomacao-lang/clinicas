import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { Send, Loader2, PhoneOff, Mic, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useSettings } from "../hooks/useSupabase";
import { useQuickReplies, type QuickReply } from "../hooks/useQuickReplies";
import { QuickRepliesPicker, QuickRepliesManagerModal, filtrarRespostas } from "./QuickReplies";

// Erros que a edge chat-send devolve, em português para o operador.
const ERROS: Record<string, string> = {
  envio_desativado: "Envio pelo chat está desativado para esta clínica.",
  whatsapp_nao_conectado: "WhatsApp da clínica não está conectado.",
  telefone_invalido: "Telefone do lead é inválido.",
  texto_muito_longo: "Mensagem muito longa.",
  sem_telefone: "Este lead não tem telefone.",
  forbidden: "Você não tem acesso a esta clínica.",
  uazapi_error: "O WhatsApp recusou o envio. Tente de novo.",
  send_failed: "Falha de conexão ao enviar. Tente de novo.",
  fila_falhou: "Não foi possível colocar a mensagem na fila de envio.",
  audio_invalido: "Não foi possível ler o áudio gravado. Grave de novo.",
  audio_muito_grande: "Áudio muito longo. Grave um trecho menor.",
  upload_falhou: "Não deu para guardar o áudio. Tente de novo.",
};

// Formatos de gravação, em ordem de preferência. OGG/Opus é o que o WhatsApp usa nativamente em
// mensagem de voz; o Chrome só grava WebM (mesmo codec Opus, outro empacotamento) e o Safari MP4.
// Quem converte é a uazapi, no /send/media com type='ptt'.
const FORMATOS = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const MAX_SEGUNDOS = 300; // 5 min: teto para o binário não estourar o corpo do request

function formatoSuportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const f of FORMATOS) {
    try { if (MediaRecorder.isTypeSupported(f)) return f; } catch { /* navegador antigo */ }
  }
  return null;
}

function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface ChatComposerProps {
  // Vem do useChatMessages do mesmo lead exibido na conversa.
  onSend: (text: string) => Promise<{ ok: boolean; error?: string }>;
  // Idem: envia o áudio gravado. Ausente = sem botão de microfone.
  onSendAudio?: (base64: string, mimetype: string, durationMs: number) => Promise<{ ok: boolean; error?: string }>;
  // ⚠️ DE QUEM é esta conversa. Não é enfeite nem telemetria: trocar de contato NÃO desmonta este
  // componente (é o mesmo ramo do JSX nas três telas que o usam), então sem saber que o contato
  // mudou a gravação em curso continuaria viva e, ao encerrar, seria entregue ao contato ANTERIOR
  // — a função de envio fica presa na closure do momento em que o microfone foi clicado.
  leadId?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Caixa de envio de mensagem do chat. Só aparece com a feature `feature_chat_send`
 * ligada na clínica (Gestão Organizacional). A mensagem enviada entra na conversa
 * pelo realtime — não há eco local, para a tela nunca mostrar algo que não foi entregue.
 *
 * Respostas rápidas: "/" no início da caixa abre o seletor (como no WhatsApp), a resposta escolhida
 * entra na caixa para revisão e o lápis do seletor abre o gerenciador (tabela `quick_replies`).
 */
export function ChatComposer({ onSend, onSendAudio, leadId, disabled, disabledReason }: ChatComposerProps) {
  const { clinic } = useSettings();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Gravação de áudio ──────────────────────────────────────────────────────
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pedacosRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Descartar precisa ser um ref, não estado: quem lê é o `onstop`, que é registrado uma vez e
  // enxergaria o valor congelado do estado no momento em que a gravação começou.
  const descartarRef = useRef(false);
  const duracaoRef = useRef(0);
  // ⚠️ Trava SÍNCRONA de reentrância. Conferir `gravando` não basta: ele só vira true DEPOIS do
  // `await` do getUserMedia, e enquanto o navegador abre o dispositivo (ou enquanto o balão de
  // permissão está aberto) a tela não muda nada. Dois cliques nessa janela abriam DOIS microfones
  // e DOIS cronômetros, e as refs guardavam só o segundo: o primeiro seguia capturando até
  // recarregar a página, e o contador órfão fazia a gravação seguinte andar 2s por segundo.
  const abrindoRef = useRef(false);
  // ⚠️ Muda a cada troca de contato e ao sair da tela. É o que separa "esta gravação ainda é da
  // conversa que está aberta" de "isto sobrou de outra conversa". Um booleano de montagem não
  // serviria: trocar de contato não desmonta nada aqui, e uma checagem de montagem voltaria a
  // true na mesma hora, deixando a gravação órfã seguir viagem para o contato errado.
  const geracaoRef = useRef(0);

  const encerrarStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  // Trocar de contato ou sair da tela (fechar o modal) com o microfone aberto deixaria a luzinha de
  // gravação acesa e o navegador ouvindo à toa. Descarta: enviar áudio de uma conversa que já não
  // está aberta seria enviar para a pessoa errada.
  useEffect(() => () => {
    geracaoRef.current += 1;
    descartarRef.current = true;
    try { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); } catch { /* já parado */ }
    encerrarStream();
    setGravando(false);
  }, [leadId]);

  // ── Respostas rápidas (atalho "/") ──────────────────────────────────────────
  const chatSendOn = clinic?.features?.feature_chat_send === true;
  const respostas = useQuickReplies(chatSendOn);
  // Esc (ou clique fora) fecha o seletor até o texto mudar de novo.
  const [rapidasFechado, setRapidasFechado] = useState(false);
  const [rapidasIdx, setRapidasIdx] = useState(0);
  const [gerenciar, setGerenciar] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Só com a caixa contendo "/" e uma palavra (sem espaço), como no WhatsApp: barra no meio de uma
  // frase não é atalho, e "/abc def" também não.
  const rapidasMatch = /^\/(\S*)$/.exec(text);
  const rapidasQuery = rapidasMatch?.[1] ?? "";
  const rapidasAberto = chatSendOn && !!rapidasMatch && !rapidasFechado && !gravando && !disabled;
  const rapidasLista = useMemo(() => filtrarRespostas(respostas.items, rapidasQuery), [respostas.items, rapidasQuery]);
  // Digitar mais uma letra reordena a lista: o destaque volta para o primeiro.
  useEffect(() => { setRapidasIdx(0); }, [rapidasQuery, rapidasLista.length]);
  const rapidasIdxAtivo = Math.min(rapidasIdx, Math.max(0, rapidasLista.length - 1));
  // Clique fora da caixa e fora do seletor fecha (o seletor mora num portal, então `contains` no
  // elemento dele é o único jeito de saber que o clique foi "dentro").
  useEffect(() => {
    if (!rapidasAberto) return;
    const onDown = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (inputRef.current?.contains(alvo) || pickerRef.current?.contains(alvo)) return;
      setRapidasFechado(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [rapidasAberto]);

  // Altura da caixa acompanha o texto, venha ele do teclado, de uma resposta rápida ou do envio
  // (que a esvazia). Teto de 120px: passando disso, rola.
  // ⚠️ `scrollHeight` NÃO inclui a borda, mas o `height` daqui sim (box-sizing: border-box em tudo).
  // Sem somar a borda de volta, a caixa nascia 2px menor que o próprio texto e o navegador punha
  // barra de rolagem já na PRIMEIRA linha, com as setinhas ao lado do cursor. `offsetHeight -
  // clientHeight` é exatamente essa borda.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const borda = el.offsetHeight - el.clientHeight;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + borda, 120)}px`;
  }, [text, gravando]);

  // Opt-in: ausente ou false = escondido.
  if (!chatSendOn) return null;

  const enviar = async () => {
    const clean = text.trim();
    if (!clean || sending || disabled) return;
    setSending(true);
    setErro(null);
    const res = await onSend(clean);
    setSending(false);
    if (res.ok) {
      setText("");
      inputRef.current?.focus();
    } else {
      setErro(ERROS[res.error ?? ""] ?? "Não foi possível enviar a mensagem.");
    }
  };

  // Resposta escolhida entra na caixa (não é enviada): o operador revisa e manda com Enter, como no
  // WhatsApp. O cursor vai para o fim, para já emendar um complemento.
  const usarResposta = (r: QuickReply) => {
    setText(r.content);
    setRapidasFechado(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const abrirGerenciador = () => { setRapidasFechado(true); setGerenciar(true); };
  // Ao fechar o gerenciador a caixa ainda tem o "/" digitado: o seletor reabre já com a lista nova,
  // para escolher o que acabou de ser criado sem digitar de novo.
  const fecharGerenciador = () => {
    setGerenciar(false);
    setRapidasFechado(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (rapidasAberto) {
      if (e.key === "Escape") { e.preventDefault(); setRapidasFechado(true); return; }
      const n = rapidasLista.length;
      if (n > 0) {
        if (e.key === "ArrowDown") { e.preventDefault(); setRapidasIdx((rapidasIdxAtivo + 1) % n); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setRapidasIdx((rapidasIdxAtivo - 1 + n) % n); return; }
        // Shift+Tab fica de fora: é o gesto de sair da caixa para trás, não de escolher.
        if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          usarResposta(rapidasLista[rapidasIdxAtivo]);
          return;
        }
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Nada bate com o que foi digitado (ou a lista ainda carrega): Enter fecha o seletor em vez
        // de mandar "/abc" para o contato. Um segundo Enter envia o texto como está.
        e.preventDefault();
        setRapidasFechado(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  // ── Áudio ────────────────────────────────────────────────────────────────
  // O microfone só aparece se o navegador souber gravar (precisa de HTTPS: em http o
  // `mediaDevices` nem existe) e se quem usa o componente souber enviar.
  const formato = formatoSuportado();
  const podeGravar = !!onSendAudio && !!formato
    && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const iniciarGravacao = async () => {
    if (!podeGravar || gravando || sending || disabled || abrindoRef.current) return;
    abrindoRef.current = true;
    setErro(null);
    // Congelado ANTES do await: é com esta conversa que a gravação vai ser comparada lá na frente.
    const geracao = geracaoRef.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      abrindoRef.current = false;
      const nome = (e as Error)?.name ?? "";
      setErro(nome === "NotAllowedError" || nome === "SecurityError"
        ? "Permita o acesso ao microfone no navegador para gravar áudio."
        : nome === "NotFoundError"
        ? "Nenhum microfone encontrado neste computador."
        : "Não foi possível abrir o microfone.");
      return;
    }

    // ⚠️ Abrir o microfone DEMORA (o navegador inicializa o dispositivo, e no primeiro uso ainda
    // pergunta a permissão). Se o operador trocou de contato nesse meio tempo, seguir daqui seria
    // gravar escondido para uma conversa que não está mais na tela: sem cronômetro, sem botão de
    // parar, e ao bater o teto de 5 minutos o áudio sairia para o contato ANTERIOR sozinho.
    if (geracao !== geracaoRef.current) {
      stream.getTracks().forEach(t => t.stop());
      abrindoRef.current = false;
      return;
    }

    // 32 kbps: o padrão do Chrome grava voz a ~100 kbps, três vezes mais bytes para trafegar sem
    // ganho nenhum de inteligibilidade (a própria mensagem de voz do WhatsApp fica abaixo disso).
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: formato!, audioBitsPerSecond: 32000 });
    } catch {
      // O microfone JÁ está aberto neste ponto: sem fechar aqui, o construtor recusando o formato
      // deixaria o navegador capturando com a luzinha acesa e nenhuma gravação acontecendo.
      stream.getTracks().forEach(t => t.stop());
      abrindoRef.current = false;
      setErro("Este navegador não conseguiu gravar áudio.");
      return;
    }

    // Cinto: se sobrou stream ou cronômetro de uma tentativa anterior, morre aqui antes de as refs
    // serem sobrescritas (o que deixaria o anterior sem dono, sem ninguém para pará-lo).
    encerrarStream();
    streamRef.current = stream;
    recorderRef.current = rec;
    pedacosRef.current = [];
    descartarRef.current = false;
    duracaoRef.current = 0;

    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) pedacosRef.current.push(ev.data); };
    rec.onstop = async () => {
      encerrarStream();
      setGravando(false);
      const pedacos = pedacosRef.current;
      pedacosRef.current = [];
      // Descartada de propósito (lixeira) OU sobrou de outra conversa: nos dois casos não sai daqui.
      if (descartarRef.current || geracao !== geracaoRef.current) return;

      const blob = new Blob(pedacos, { type: formato! });
      // Toque no microfone sem falar nada: não vale mandar um áudio mudo de 0s.
      if (blob.size < 1024) { setErro("Gravação muito curta."); return; }

      setSending(true);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onerror = () => reject(new Error("leitura falhou"));
          // readAsDataURL devolve "data:<mime>;base64,<dados>" — a edge também aceita o prefixo,
          // mas mandar só os dados evita carregar o mime duas vezes no corpo.
          fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
          fr.readAsDataURL(blob);
        });
        const res = await onSendAudio!(base64, blob.type || formato!, duracaoRef.current * 1000);
        if (!res.ok) setErro(ERROS[res.error ?? ""] ?? "Não foi possível enviar o áudio.");
      } catch {
        setErro("Não foi possível ler o áudio gravado. Grave de novo.");
      } finally {
        setSending(false);
      }
    };

    try {
      rec.start();
    } catch {
      // `start()` ainda pode recusar depois de tudo dar certo (encoder que não inicializa, fone que
      // some entre abrir e gravar). Sem este catch a trava de reentrância ficaria presa em true e
      // TODO clique seguinte no microfone seria ignorado, sem mensagem e com o dispositivo aberto.
      encerrarStream();
      recorderRef.current = null;
      abrindoRef.current = false;
      setErro("Não foi possível iniciar a gravação. Tente de novo.");
      return;
    }
    setGravando(true);
    setSegundos(0);
    abrindoRef.current = false;
    timerRef.current = setInterval(() => {
      duracaoRef.current += 1;
      setSegundos(duracaoRef.current);
      // No teto, encerra e ENVIA o que já foi gravado (descartar puniria quem falou 5 minutos).
      if (duracaoRef.current >= MAX_SEGUNDOS) {
        try { recorderRef.current?.stop(); } catch { /* já parado */ }
      }
    }, 1000);
  };

  const pararGravacao = (descartar: boolean) => {
    descartarRef.current = descartar;
    try { recorderRef.current?.stop(); } catch { encerrarStream(); setGravando(false); }
  };

  return (
    <div className="border-t border-slate-100 bg-white px-4 py-3 shrink-0">
      {disabled && disabledReason && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-rose-700">
          <PhoneOff className="w-3 h-3 shrink-0" />
          {disabledReason}
        </div>
      )}
      {erro && (
        <p className="mb-2 text-[11px] font-semibold text-rose-600">{erro}</p>
      )}
      {gravando ? (
        // Gravando: a caixa de texto sai de cena. Lixeira descarta, botão redondo encerra e envia
        // (mesmo gesto do WhatsApp Web) — não há passo de revisão para não emperrar a resposta.
        <div className="flex items-center gap-3">
          <button
            onClick={() => pararGravacao(true)}
            title="Descartar gravação"
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-2xl px-3.5 py-2.5">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
            <span className="text-sm font-semibold text-rose-700 tabular-nums">{mmss(segundos)}</span>
            <span className="text-[11px] text-rose-600/70">Gravando… (máx. {mmss(MAX_SEGUNDOS)})</span>
          </div>
          <button
            onClick={() => pararGravacao(false)}
            title="Encerrar e enviar"
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-teal-600 text-white hover:bg-teal-700 shadow transition-all"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      ) : (
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled || sending}
          onChange={e => {
            setText(e.target.value);
            // Texto mudou: um Esc anterior deixa de valer e o seletor do "/" pode voltar.
            setRapidasFechado(false);
          }}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Envio indisponível" : "Escreva uma mensagem… ou / para respostas rápidas"}
          // `scrollbar-hide`: passando de 120px a caixa rola, mas sem barra nem setas em cima do
          // texto. Rolagem por roda e teclado continua funcionando.
          className="flex-1 resize-none scrollbar-hide text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 max-h-[120px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-60 transition-all"
        />
        {/* Microfone só com a caixa vazia: com texto escrito, o botão é de enviar o texto. */}
        {podeGravar && !text.trim() && !sending ? (
          <button
            onClick={iniciarGravacao}
            disabled={disabled}
            title="Gravar áudio"
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
              disabled ? "bg-slate-100 text-slate-300" : "bg-slate-100 text-slate-500 hover:bg-teal-600 hover:text-white",
            )}
          >
            <Mic className="w-4 h-4" />
          </button>
        ) : (
        <button
          onClick={enviar}
          disabled={!text.trim() || sending || disabled}
          title="Enviar (Enter)"
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
            text.trim() && !sending && !disabled
              ? "bg-teal-600 text-white hover:bg-teal-700 shadow"
              : "bg-slate-100 text-slate-300",
          )}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
        )}
      </div>
      )}
      {/* Seletor do "/" e gerenciador: os dois moram em portal (ver QuickReplies.tsx), então a posição
          aqui no JSX não importa para o layout. */}
      <QuickRepliesPicker
        anchorRef={inputRef}
        containerRef={pickerRef}
        open={rapidasAberto}
        query={rapidasQuery}
        items={rapidasLista}
        total={respostas.items.length}
        loading={respostas.loading}
        erro={respostas.erro}
        activeIndex={rapidasIdxAtivo}
        onHover={setRapidasIdx}
        onPick={usarResposta}
        onManage={abrirGerenciador}
      />
      <QuickRepliesManagerModal
        open={gerenciar}
        onClose={fecharGerenciador}
        items={respostas.items}
        loading={respostas.loading}
        erro={respostas.erro}
        onSave={respostas.save}
        onRemove={respostas.remove}
        comecarCriando={respostas.items.length === 0}
      />
    </div>
  );
}
