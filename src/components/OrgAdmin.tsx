import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { Building2, Users, ArrowRight, LogIn, Plus, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "framer-motion";

interface Clinic {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  organization_id: string | null;
}

interface OrgUser {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

export function OrgAdmin() {
  const { profile, activeClinicId, setActiveClinicId, clinicName } = useAuth();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"clinics" | "users">("clinics");

  const fetchClinics = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoadingClinics(true);
    const { data } = await supabase
      .from("clinics")
      .select("id, name, plan, logo_url, organization_id")
      .eq("organization_id", profile.organization_id)
      .order("name");
    setClinics(data || []);
    setLoadingClinics(false);
  }, [profile?.organization_id]);

  const fetchOrgUsers = useCallback(async () => {
    if (!profile?.organization_id) return;
    const { data } = await supabase
      .from("org_users")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("full_name");
    setOrgUsers(data || []);
  }, [profile?.organization_id]);

  useEffect(() => {
    fetchClinics();
    fetchOrgUsers();
  }, [fetchClinics, fetchOrgUsers]);

  return (
    <div className="space-y-8 h-full flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Gestão <span className="text-violet-600">Organizacional</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            {profile?.organization_name} — visão geral das clínicas
          </p>
        </div>
        {activeClinicId && (
          <div className="flex items-center gap-3 px-4 py-2 bg-violet-50 border border-violet-200 rounded-xl">
            <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
            <span className="text-xs font-bold text-violet-700">
              Visualizando: {clinics.find(c => c.id === activeClinicId)?.name || "Clínica"}
            </span>
            <button
              onClick={() => setActiveClinicId(null)}
              className="text-xs text-violet-500 hover:text-violet-700 font-bold transition-colors"
            >
              Sair
            </button>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex bg-white p-1 rounded-xl border border-slate-200 gap-1 w-fit">
        {[
          { id: "clinics", label: "Clínicas", icon: Building2 },
          { id: "users", label: "Usuários da Org", icon: Users },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveSubTab(t.id as any)}
            className={cn(
              "flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all",
              activeSubTab === t.id
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeSubTab === "clinics" && (
        <div className="flex-1">
          {loadingClinics ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
          ) : clinics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Building2 className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Nenhuma clínica vinculada a esta organização.</p>
              <p className="text-slate-400 text-xs mt-1">Vincule clínicas existentes pelo Super Admin.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {clinics.map((clinic) => (
                <motion.div
                  key={clinic.id}
                  whileHover={{ y: -2 }}
                  className={cn(
                    "p-5 rounded-2xl border shadow-sm cursor-pointer transition-all",
                    activeClinicId === clinic.id
                      ? "bg-violet-50 border-violet-300 shadow-violet-100"
                      : "bg-white border-slate-200 hover:border-violet-200 hover:shadow-md"
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-violet-100 flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-violet-600" />
                    </div>
                    <span className={cn(
                      "text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                      clinic.plan === 'enterprise' ? "bg-amber-100 text-amber-700"
                        : clinic.plan === 'pro' ? "bg-violet-100 text-violet-700"
                        : "bg-slate-100 text-slate-500"
                    )}>
                      {clinic.plan}
                    </span>
                  </div>

                  <p className="text-sm font-bold text-slate-900 mb-1">{clinic.name}</p>

                  <button
                    onClick={() => setActiveClinicId(activeClinicId === clinic.id ? null : clinic.id)}
                    className={cn(
                      "mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all",
                      activeClinicId === clinic.id
                        ? "bg-violet-600 text-white hover:bg-violet-700"
                        : "bg-slate-50 text-slate-600 hover:bg-violet-50 hover:text-violet-700 border border-slate-200"
                    )}
                  >
                    {activeClinicId === clinic.id ? (
                      <>
                        <LogIn className="w-3.5 h-3.5" />
                        Visualizando
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-3.5 h-3.5" />
                        Entrar como clínica
                      </>
                    )}
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "users" && (
        <div className="flex-1">
          {orgUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Users className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Nenhum usuário na organização.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200">
                  <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-xs shrink-0">
                    {(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{u.full_name || '—'}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
                    {u.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
