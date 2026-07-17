import React, { useEffect, useRef, useState } from "react";
import { Bot, User, Loader2, MessageSquare, FileText, Download } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";
import type { ChatMessage } from "../hooks/useSupabase";

// ─── Texto: extrai content de mensagens em qualquer formato ──────────────────
function stripToolCallPrefix(text: string): string {
  if (!text.startsWith('[Used tools:')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(i + 1).trimStart();
    }
  }
  return text;
}

export function extractMessageText(message: any): string {
  if (!message) return '';
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content) return extractMessageText(parsed.content);
        if (parsed.text) return stripToolCallPrefix(parsed.text);
        if (parsed.output) return stripToolCallPrefix(parsed.output);
      } catch {
        const match = trimmed.match(/"content"\s*:\s*"([\s\S]*?)"\s*[,}]/);
        if (match) return stripToolCallPrefix(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
      }
    }
    return stripToolCallPrefix(trimmed);
  }
  if (message.content != null) {
    if (typeof message.content === 'string') {
      const c = message.content.trim();
      if (c.startsWith('{')) return extractMessageText(c);
      return stripToolCallPrefix(message.content);
    }
    if (Array.isArray(message.content)) {
      return message.content.map((b: any) => b?.text || b?.content || '').filter(Boolean).join('\n');
    }
  }
  if (typeof message.text === 'string') return stripToolCallPrefix(message.text);
  if (typeof message.output === 'string') return stripToolCallPrefix(message.output);
  const values = Object.values(message).filter(v => typeof v === 'string') as string[];
  if (values.length > 0) return stripToolCallPrefix(values.join(' '));
  return JSON.stringify(message);
}

// ─── Traces de tool da IA: NÃO devem aparecer na conversa ────────────────────
// O agente (LangChain) persiste na MESMA tabela (chat_messages) tanto as chamadas
// de tool ("Calling X with input: …", type 'ai' com tool_calls preenchido) quanto
// os resultados (type 'tool'). Isso é memória da IA, não conteúdo pro usuário.
export function isToolTrace(message: any): boolean {
  let obj: any = message;
  if (typeof obj === 'string') {
    const t = obj.trim();
    if (t.startsWith('{')) { try { obj = JSON.parse(t); } catch { obj = null; } }
  }
  if (obj && typeof obj === 'object') {
    if (obj.type === 'tool') return true;                                                    // resultado de tool
    if (obj.type === 'ai' && Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) return true; // "Calling X…"
  }
  // fallback textual (mensagens malformadas/string)
  return /^Calling\s+\S+\s+with input:/.test(extractMessageText(message).trimStart());
}

// ─── Mídia: detecta áudio/imagem/vídeo/documento via fileURL + mimetype ──────
// `fileURL` pode ser uma URL pública (http) OU um path do bucket PRIVADO chat-media
// (ingestão nativa — a mídia do paciente é PII, então não fica em bucket público).
// No 2º caso o MediaBubble resolve o path para uma signed URL sob demanda.
export type MediaKind = 'image' | 'audio' | 'video' | 'document' | null;

export function detectMedia(message: any): { kind: MediaKind; url?: string; storagePath?: string; mime: string; caption?: string; filename?: string; duration?: number } | null {
  if (!message || typeof message !== 'object') return null;
  const raw = message.fileURL || message.file_url || message.media_url || message.url || '';
  const explicitPath = message.storagePath || message.storage_path;
  const isHttp = typeof raw === 'string' && /^https?:\/\//i.test(raw);
  const url = isHttp ? (raw as string) : undefined;
  const storagePath = explicitPath || (raw && !isHttp ? String(raw) : undefined);
  if (!url && !storagePath) return null;
  const mime = String(message.mimetype || message.mime || '');
  const explicit = String(message.kind || message.media_kind || '').toLowerCase();
  let kind: MediaKind = null;
  if (explicit === 'image' || explicit === 'audio' || explicit === 'video' || explicit === 'document') kind = explicit;
  else if (mime.startsWith('image/')) kind = 'image';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (mime.startsWith('video/')) kind = 'video';
  else if (mime) kind = 'document';
  else return null;
  return { kind, url, storagePath, mime, caption: message.caption, filename: message.filename, duration: message.duration };
}

// Signed URLs do bucket privado, com cache de módulo p/ não re-assinar a cada render.
const signedUrlCache = new Map<string, { url: string; exp: number }>();
function useSignedUrl(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!path) return null;
    const c = signedUrlCache.get(path);
    return c && c.exp > Date.now() ? c.url : null;
  });
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    const cached = signedUrlCache.get(path);
    if (cached && cached.exp > Date.now()) { setUrl(cached.url); return; }
    let cancelled = false;
    supabase.storage.from('chat-media').createSignedUrl(path, 3600).then(({ data }) => {
      if (cancelled || !data?.signedUrl) return;
      signedUrlCache.set(path, { url: data.signedUrl, exp: Date.now() + 55 * 60 * 1000 });
      setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [path]);
  return url;
}

export function MediaBubble({ media, dark }: { media: NonNullable<ReturnType<typeof detectMedia>>; dark: boolean }) {
  const { kind, mime, caption, filename } = media;
  const signed = useSignedUrl(media.url ? undefined : media.storagePath);
  const url = media.url ?? signed;
  if (!url) {
    const rotulo = kind === 'image' ? 'imagem' : kind === 'audio' ? 'áudio' : kind === 'video' ? 'vídeo' : 'arquivo';
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs", dark ? "bg-white/10" : "bg-slate-50 border border-slate-200")}>
        <Loader2 className="w-3.5 h-3.5 animate-spin opacity-60" />
        <span className="opacity-70">Carregando {rotulo}…</span>
      </div>
    );
  }
  if (kind === 'image') {
    return (
      <div className="space-y-2">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={caption || 'imagem'} className="rounded-lg max-w-[260px] max-h-[320px] object-cover" loading="lazy" />
        </a>
        {caption && <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{caption}</p>}
      </div>
    );
  }
  if (kind === 'audio') {
    return <audio src={url} controls className="max-w-[260px] h-10" preload="metadata" />;
  }
  if (kind === 'video') {
    return (
      <div className="space-y-2">
        <video src={url} controls className="rounded-lg max-w-[260px] max-h-[320px]" preload="metadata" />
        {caption && <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{caption}</p>}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors",
        dark ? "bg-white/10 border-white/20 hover:bg-white/20" : "bg-slate-50 border-slate-200 hover:bg-slate-100"
      )}
    >
      <FileText className="w-5 h-5 shrink-0 opacity-80" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{filename || 'Arquivo'}</p>
        {mime && <p className="text-[10px] opacity-60 uppercase">{mime}</p>}
      </div>
      <Download className="w-4 h-4 shrink-0 opacity-60" />
    </a>
  );
}

// ─── ChatThread: lista de mensagens compartilhada entre kanban e Conversas ───
interface ChatThreadProps {
  messages: ChatMessage[];
  loading: boolean;
  leadAvatarUrl?: string | null;
  leadName: string;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}

export function ChatThread({
  messages,
  loading,
  leadAvatarUrl,
  leadName,
  emptyTitle = "Nenhuma mensagem encontrada nesta jornada.",
  emptyHint,
  className,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Scroll robusto: observa mutações no DOM e força o fundo (cobre slide-in do modal)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollDown = () => { el.scrollTop = el.scrollHeight; };
    scrollDown();
    const observer = new MutationObserver(scrollDown);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    let pings = 0;
    const interval = setInterval(() => {
      scrollDown();
      pings++;
      if (pings > 10) clearInterval(interval);
    }, 50);
    return () => { observer.disconnect(); clearInterval(interval); };
  }, [loading]);

  const getDateLabel = (date: Date) => {
    if (isToday(date)) return 'Hoje';
    if (isYesterday(date)) return 'Ontem';
    return format(date, "d 'de' MMMM", { locale: ptBR });
  };

  // Esconde os traces de tool da IA (chamadas + resultados) — só exibição
  const visibleMessages = messages.filter((m) => !isToolTrace(m.message));

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden p-6 bg-slate-50/50 custom-scrollbar relative block",
        className
      )}
    >
      {loading ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Carregando conversa...</p>
        </div>
      ) : visibleMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 opacity-50">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-teal-600" />
          </div>
          <p className="text-sm font-medium text-center max-w-[220px]">{emptyTitle}</p>
          {emptyHint && <p className="text-xs text-center max-w-[220px]">{emptyHint}</p>}
        </div>
      ) : (() => {
        const sorted = [...visibleMessages].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        return (
          <div className="space-y-6 pb-4">
            {sorted.map((msg, i) => {
              const isOutbound = msg.direction === 'outbound';
              const isAI = msg.sender === 'ai';
              const currentDate = new Date(msg.created_at);
              const prevDate = i > 0 ? new Date(sorted[i - 1].created_at) : null;
              const showDateSeparator = !prevDate ||
                format(prevDate, 'yyyy-MM-dd') !== format(currentDate, 'yyyy-MM-dd');

              return (
                <React.Fragment key={msg.id}>
                  {showDateSeparator && (
                    <div className="flex items-center gap-3 my-8 px-1">
                      <div className="flex-1 h-px bg-slate-200" />
                      <span className="bg-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 py-1 rounded-full shrink-0">
                        {getDateLabel(currentDate)}
                      </span>
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex gap-4 max-w-[85%] min-w-0",
                      isOutbound ? "ml-auto flex-row-reverse" : ""
                    )}
                  >
                    {!isOutbound && !isAI && leadAvatarUrl ? (
                      <div className="relative w-8 h-8 shrink-0">
                        <img
                          src={leadAvatarUrl}
                          alt={leadName}
                          className="w-8 h-8 rounded-lg object-cover border border-slate-200 shadow-sm"
                          onError={e => {
                            e.currentTarget.style.display = 'none';
                            (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex';
                          }}
                        />
                        <div style={{ display: 'none' }} className="absolute inset-0 w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm items-center justify-center">
                          <User className="w-4 h-4 text-slate-400" />
                        </div>
                      </div>
                    ) : (
                      <div className={cn(
                        "w-8 h-8 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center",
                        isAI ? "bg-teal-600 shadow-md" :
                        (isOutbound ? "bg-slate-800 shadow-md" : "bg-white border border-slate-200")
                      )}>
                        {isAI ? <Bot className="w-5 h-5 text-white" /> : <User className={cn("w-4 h-4", isOutbound ? "text-white" : "text-slate-400")} />}
                      </div>
                    )}

                    <div className={cn(
                      "px-4 py-3 rounded-2xl text-sm shadow-sm max-w-full overflow-hidden break-words",
                      isAI
                        ? "bg-teal-600 text-white rounded-tr-none"
                        : (isOutbound
                            ? "bg-slate-800 text-white rounded-tr-none"
                            : "bg-white border border-slate-200 text-slate-700 rounded-tl-none")
                    )}>
                      {(() => {
                        const media = detectMedia(msg.message);
                        if (media) return <MediaBubble media={media} dark={isOutbound || isAI} />;
                        return (
                          <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words">
                            {extractMessageText(msg.message)}
                          </p>
                        );
                      })()}
                      <div className="flex items-center justify-between gap-4 mt-1">
                        <span className={cn(
                          "text-[9px] block opacity-60 font-bold uppercase ml-auto",
                          isOutbound || isAI ? "text-white text-right" : "text-slate-400"
                        )}>
                          {format(new Date(msg.created_at), 'HH:mm')}
                        </span>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
            <div ref={endRef} className="h-1 opacity-0 pointer-events-none" />
          </div>
        );
      })()}
    </div>
  );
}
