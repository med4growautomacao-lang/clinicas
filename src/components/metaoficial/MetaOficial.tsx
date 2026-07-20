// Módulo "API Oficial Meta" — WhatsApp Cloud API oficial (Graph API), plano Meta Tester.
// Duas abas: Painel de Envio + Canais & Templates. Identidade visual do app (tema claro).
// Dados: tabelas meta_cloud_* escopadas por clinic_id (RLS). Ações que falam com a Meta
// passam pela edge meta-cloud-api.

import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { logSystemError } from "../../hooks/useSupabase";
import { cn } from "@/src/lib/utils";
import { Send, LayoutGrid, Loader2 } from "lucide-react";
import { PainelEnvio } from "./PainelEnvio";
import { CanaisTemplates } from "./CanaisTemplates";
import { invokeMetaCloud } from "./invoke";
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

  // Ao abrir (por clínica), puxa TODOS os templates da WABA da Meta e recarrega — assim os
  // aprovados já aparecem na tela sem precisar clicar em "Sincronizar".
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    invokeMetaCloud({ action: "sync_templates", clinic_id: clinicId })
      .then(() => { if (!cancelled) reload(); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clinicId, reload]);

  if (!clinicId) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
        Selecione uma clínica para usar a API Oficial Meta.
      </div>
    );
  }

  const tabs = [
    { id: "envio" as const, label: "Painel de Envio", icon: Send },
    { id: "canais" as const, label: "Canais & Templates", icon: LayoutGrid },
  ];

  return (
    <div className="space-y-6 pb-24">
      {/* Cabeçalho */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            API Oficial <span className="text-teal-600">Meta</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            WhatsApp Cloud API — {activeClinicName || "clínica"}.
          </p>
        </motion.div>

        <div className="flex bg-white p-1 rounded-lg w-fit shadow-sm border border-slate-200">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md transition-all",
                  isActive ? "bg-teal-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-white" : "text-teal-500")} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-24 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-teal-500" /> Carregando…
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {tab === "envio" ? (
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
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
