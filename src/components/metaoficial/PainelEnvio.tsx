// Aba "Painel de Envio" — dispara um template APROVADO a partir de um remetente (canal).
// Espelha a imagem 1: template ativo + prévia + remetente + telefone destino + botão.

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../ui/toast";
import { logSystemError } from "../../hooks/useSupabase";
import { Tag, CheckCircle2, Send, Loader2, PlugZap } from "lucide-react";
import type { MetaChannel, MetaTemplate } from "./types";

interface Props {
  clinicId: string;
  clinicName: string;
  channels: MetaChannel[];
  templates: MetaTemplate[];
  onSent: () => void;
}

export function PainelEnvio({ clinicId, clinicName, channels, templates, onSent }: Props) {
  const showToast = useToast();
  const approved = useMemo(() => templates.filter((t) => t.status === "APPROVED"), [templates]);
  const connected = useMemo(() => channels.filter((c) => c.status === "connected"), [channels]);

  const [templateId, setTemplateId] = useState<string>("");
  const [channelId, setChannelId] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [sending, setSending] = useState(false);

  // Seleção default quando os dados chegam.
  useEffect(() => { if (!templateId && approved[0]) setTemplateId(approved[0].id); }, [approved, templateId]);
  useEffect(() => { if (!channelId && connected[0]) setChannelId(connected[0].id); }, [connected, channelId]);

  const template = approved.find((t) => t.id === templateId) || null;
  const canSend = template && channelId && phone.replace(/\D/g, "").length >= 8 && !sending;

  const handleSend = async () => {
    if (!template || !channelId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-cloud-api", {
        body: {
          action: "send_template",
          clinic_id: clinicId,
          channel_id: channelId,
          template_name: template.name,
          language: template.language,
          to_phone: phone,
        },
      });
      if (error) {
        showToast("Falha ao enviar (erro de rede/função).", "error");
        logSystemError("META_CLOUD_SEND_INVOKE_FAIL", "Falha ao invocar send_template", clinicId, { error: error.message }, "warn");
      } else if (!data?.ok) {
        showToast(data?.detail || "A Meta recusou o envio.", "error");
      } else {
        showToast("Mensagem enviada!", "success");
        setPhone("");
      }
      onSent();
    } catch (e: any) {
      showToast("Erro inesperado ao enviar.", "error");
      logSystemError("META_CLOUD_SEND_FAIL", "Exceção ao enviar template", clinicId, { error: e?.message ?? String(e) }, "warn");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="relative max-w-2xl mx-auto rounded-3xl bg-[#0f1629]/70 border border-white/10 backdrop-blur px-6 md:px-10 py-9 shadow-2xl shadow-black/40">
      <div className="text-center mb-8">
        <h2 className="text-2xl md:text-3xl font-black tracking-tight">PAINEL DE DISPARO</h2>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400 mt-1">Cliente: {clinicName || "—"}</p>
      </div>

      {approved.length === 0 || connected.length === 0 ? (
        <EmptyHint noTemplates={approved.length === 0} noChannels={connected.length === 0} />
      ) : (
        <div className="space-y-7">
          {/* Template ativo */}
          <Field icon={Tag} label="Template ativo">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-100 focus:outline-none focus:border-cyan-500/50 appearance-none"
            >
              {approved.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0f1629]">
                  {t.name.toUpperCase()} ({t.category === "UTILITY" ? "UTILIDADE" : t.category === "AUTHENTICATION" ? "AUTENTICAÇÃO" : "MARKETING"})
                </option>
              ))}
            </select>
          </Field>

          {/* Prévia */}
          {template && (
            <div className="rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/20 p-5">
              <div className="flex items-center gap-2 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Template aprovado — prévia:
              </div>
              <p className="text-sm italic text-slate-300 leading-relaxed whitespace-pre-wrap">
                {template.body_text || "(sem corpo de texto)"}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Remetente */}
            <Field icon={PlugZap} label="Remetente">
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-100 focus:outline-none focus:border-cyan-500/50 appearance-none"
              >
                {connected.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#0f1629]">
                    {c.label || c.phone_display || c.phone_number_id}
                  </option>
                ))}
              </select>
            </Field>

            {/* Telefone destino */}
            <Field icon={Send} label="Telefone destino">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(00) 00000-0000"
                inputMode="tel"
                className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3.5 text-sm font-semibold text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
            </Field>
          </div>

          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl text-sm font-bold uppercase tracking-wider text-white bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar mensagem aprovada
          </button>
          <p className="text-center text-[11px] text-slate-500">
            Use o número no formato internacional (ex.: 55 + DDD + número). Templates de marketing exigem opt-in do destinatário.
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-400/80 mb-2">
        <Icon className="w-3 h-3" /> {label}
      </label>
      {children}
    </div>
  );
}

function EmptyHint({ noTemplates, noChannels }: { noTemplates: boolean; noChannels: boolean }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-dashed border-white/15 p-8 text-center">
      <p className="text-sm text-slate-300 font-semibold mb-1">Ainda não dá para disparar</p>
      <p className="text-xs text-slate-500 leading-relaxed">
        {noChannels && "Conecte um canal (remetente) na aba Canais & Templates. "}
        {noTemplates && "Crie e aguarde a aprovação de ao menos um template para poder enviar."}
      </p>
    </div>
  );
}
