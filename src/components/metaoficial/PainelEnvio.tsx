// Aba "Painel de Envio" — dispara um template APROVADO a partir de um remetente (canal).
// Identidade visual do app (card branco, CustomDropdown, botão teal).

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../ui/toast";
import { logSystemError } from "../../hooks/useSupabase";
import { CustomDropdown } from "../CustomDropdown";
import { CheckCircle2, Send, Loader2, Smartphone } from "lucide-react";
import type { MetaChannel, MetaTemplate } from "./types";

interface Props {
  clinicId: string;
  clinicName: string;
  channels: MetaChannel[];
  templates: MetaTemplate[];
  onSent: () => void;
}

const CAT_LABEL: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidade", AUTHENTICATION: "Autenticação" };

export function PainelEnvio({ clinicId, clinicName, channels, templates, onSent }: Props) {
  const showToast = useToast();
  const approved = useMemo(() => templates.filter((t) => t.status === "APPROVED"), [templates]);
  const connected = useMemo(() => channels.filter((c) => c.status === "connected"), [channels]);

  const [templateId, setTemplateId] = useState<string>("");
  const [channelId, setChannelId] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [sending, setSending] = useState(false);

  useEffect(() => { if (!templateId && approved[0]) setTemplateId(approved[0].id); }, [approved, templateId]);
  useEffect(() => { if (!channelId && connected[0]) setChannelId(connected[0].id); }, [connected, channelId]);

  const template = approved.find((t) => t.id === templateId) || null;
  const canSend = !!template && !!channelId && phone.replace(/\D/g, "").length >= 8 && !sending;

  const handleSend = async () => {
    if (!template || !channelId) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-cloud-api", {
        body: { action: "send_template", clinic_id: clinicId, channel_id: channelId, template_name: template.name, language: template.language, to_phone: phone },
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

  const templateOptions = approved.map((t) => ({ value: t.id, label: `${t.name} · ${CAT_LABEL[t.category] || t.category}` }));
  const channelOptions = connected.map((c) => ({ value: c.id, label: c.label || c.phone_display || c.phone_number_id }));

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-5 border-b border-slate-100 text-center">
        <h3 className="text-xl font-bold text-slate-900">Painel de Disparo</h3>
        <p className="text-xs font-bold uppercase tracking-widest text-teal-600 mt-0.5">{clinicName || "—"}</p>
      </div>

      <div className="p-6">
        {approved.length === 0 || connected.length === 0 ? (
          <div className="text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl px-4 py-8">
            <p className="text-sm font-semibold text-slate-600 mb-1">Ainda não dá para disparar</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {connected.length === 0 && "Conecte um canal (remetente) na aba Canais & Templates. "}
              {approved.length === 0 && "Crie e aguarde a aprovação de ao menos um template."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <CustomDropdown label="Template ativo" icon={CheckCircle2} value={templateId} onChange={setTemplateId} options={templateOptions} placeholder="Selecione o template" />

            {template && (
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4">
                <div className="flex items-center gap-1.5 text-emerald-700 text-[10px] font-bold uppercase tracking-widest mb-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Template aprovado — prévia
                </div>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{template.body_text || "(sem corpo de texto)"}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CustomDropdown label="Remetente" icon={Smartphone} value={channelId} onChange={setChannelId} options={channelOptions} placeholder="Selecione o remetente" />
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Telefone destino</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="55 + DDD + número"
                  inputMode="tel"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
            </div>

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar mensagem aprovada
            </button>
            <p className="text-center text-[11px] text-slate-400">
              Use o número no formato internacional (ex.: 55 + DDD + número). Templates de marketing exigem opt-in do destinatário.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
