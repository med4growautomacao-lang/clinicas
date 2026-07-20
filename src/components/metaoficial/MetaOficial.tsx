// Módulo "API Oficial Meta" — WhatsApp Cloud API oficial (Graph API), plano Meta Tester.
// Duas abas (como nas imagens): Painel de Envio + Canais & Templates.
// Fonte de dados: tabelas meta_cloud_* escopadas por clinic_id (RLS). Ações que falam com a
// Meta passam pela edge meta-cloud-api. Tema escuro, self-contained (o resto do app é claro).

import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { logSystemError } from "../../hooks/useSupabase";
import { Send, LayoutGrid, Loader2 } from "lucide-react";
import { PainelEnvio } from "./PainelEnvio";
import { CanaisTemplates } from "./CanaisTemplates";
import type { MetaChannel, MetaTemplate, MetaSend } from "./types";

export function MetaOficial() {
  const { activeClinicId, activeClinicName } = useAuth();
  const clinicId = activeClinicId;

  const [tab, setTab] = useState<"envio" | "canais">("envio");
  const [channels, setChannels] = useState<MetaChannel[]>([]);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [sends, setSends] = useState<MetaSend[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!clinicId) return;
    try {
      const [ch, tp, sn] = await Promise.all([
        supabase.from("meta_cloud_channels").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: true }),
        supabase.from("meta_cloud_templates").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
        supabase.from("meta_cloud_sends").select("*").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100),
      ]);
      setChannels((ch.data as MetaChannel[]) || []);
      setTemplates((tp.data as MetaTemplate[]) || []);
      setSends((sn.data as MetaSend[]) || []);
    } catch (e: any) {
      logSystemError("META_CLOUD_LOAD_FAIL", "Falha ao carregar dados do módulo API Oficial Meta", clinicId, { error: e?.message ?? String(e) }, "warn");
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => { reload(); }, [reload]);

  if (!clinicId) {
    return (
      <div className="min-h-full rounded-3xl bg-[#0a0f1e] flex items-center justify-center text-slate-400 text-sm">
        Selecione uma clínica para usar a API Oficial Meta.
      </div>
    );
  }

  return (
    <div className="min-h-full rounded-3xl bg-[#0a0f1e] text-slate-100 p-6 md:p-10 relative overflow-hidden">
      {/* brilho de fundo */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[320px] bg-gradient-to-br from-blue-600/20 to-cyan-400/10 blur-3xl rounded-full" />

      {/* Toggle das abas */}
      <div className="relative flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur">
          <TabButton active={tab === "envio"} onClick={() => setTab("envio")} icon={Send} label="Painel de Envio" />
          <TabButton active={tab === "canais"} onClick={() => setTab("canais")} icon={LayoutGrid} label="Canais & Templates" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-24 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" /> Carregando…
        </div>
      ) : tab === "envio" ? (
        <PainelEnvio
          clinicId={clinicId}
          clinicName={activeClinicName || ""}
          channels={channels}
          templates={templates}
          onSent={reload}
        />
      ) : (
        <CanaisTemplates
          clinicId={clinicId}
          clinicName={activeClinicName || ""}
          channels={channels}
          templates={templates}
          sends={sends}
          reload={reload}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all " +
        (active
          ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/20"
          : "text-slate-400 hover:text-slate-200")
      }
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
