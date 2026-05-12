import React, { useEffect, useState, useMemo } from "react";
import { useAuth, UserRole } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  X,
  Mail,
  User as UserIcon,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Shield,
  Search,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/src/lib/utils";

interface TeamMember {
  id: string;
  clinic_id: string;
  role: UserRole;
  full_name: string;
  email: string;
  created_at: string;
  pending?: boolean;
}

const TEAM_ROLES: { value: UserRole; label: string; color: string }[] = [
  { value: "gestor", label: "Gestor", color: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  { value: "secretaria", label: "Secretária", color: "bg-violet-50 text-violet-700 border-violet-100" },
  { value: "vendedor", label: "Vendedor", color: "bg-amber-50 text-amber-700 border-amber-100" },
];

const TEAM_ROLE_VALUES: UserRole[] = TEAM_ROLES.map((r) => r.value);

export function TeamManagement() {
  const { activeClinicId, activeClinicName, clinicName, profile } = useAuth();
  const clinicLabel = activeClinicName || clinicName;
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState<{ full_name: string; email: string; role: UserRole }>({
    full_name: "",
    email: "",
    role: "secretaria",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  const fetchMembers = async () => {
    if (!activeClinicId) return;
    setLoading(true);

    const [activeRes, pendingRes] = await Promise.all([
      supabase
        .from("clinic_users")
        .select("id, clinic_id, role, full_name, email, created_at")
        .eq("clinic_id", activeClinicId)
        .in("role", TEAM_ROLE_VALUES)
        .order("full_name"),
      supabase
        .from("pending_clinic_users")
        .select("id, clinic_id, role, full_name, email, created_at")
        .eq("clinic_id", activeClinicId)
        .in("role", TEAM_ROLE_VALUES)
        .order("full_name"),
    ]);

    const active = (activeRes.data || []) as TeamMember[];
    const pending = ((pendingRes.data || []) as TeamMember[]).map((p) => ({ ...p, pending: true }));
    setMembers([...active, ...pending].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    setLoading(false);
  };

  useEffect(() => {
    fetchMembers();
  }, [activeClinicId]);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      (m) => m.full_name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term)
    );
  }, [members, search]);

  const openCreate = () => {
    setEditing(null);
    setFormData({ full_name: "", email: "", role: "secretaria" });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (member: TeamMember) => {
    setEditing(member);
    setFormData({ full_name: member.full_name, email: member.email, role: member.role });
    setError(null);
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!formData.full_name.trim()) {
      setError("Informe o nome.");
      return;
    }
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError("Email inválido.");
      return;
    }
    if (!activeClinicId) {
      setError("Clínica não selecionada.");
      return;
    }

    setSubmitting(true);

    if (editing) {
      const table = editing.pending ? "pending_clinic_users" : "clinic_users";
      const { error: updateError } = await supabase
        .from(table)
        .update({ full_name: formData.full_name, role: formData.role })
        .eq("id", editing.id);
      if (updateError) {
        setError(updateError.message);
        setSubmitting(false);
        return;
      }
      setMembers((prev) =>
        prev.map((m) => (m.id === editing.id ? { ...m, full_name: formData.full_name, role: formData.role } : m))
      );
      setShowModal(false);
      setSubmitting(false);
      return;
    }

    // Pré-cadastro: insere em pending_clinic_users
    const emailNormalized = formData.email.trim().toLowerCase();

    // Verifica duplicidade em ambas as tabelas
    const [existingActive, existingPending] = await Promise.all([
      supabase.from("clinic_users").select("id").ilike("email", emailNormalized).maybeSingle(),
      supabase.from("pending_clinic_users").select("id").ilike("email", emailNormalized).maybeSingle(),
    ]);
    if (existingActive.data) {
      setError("Já existe um usuário ativo com esse email.");
      setSubmitting(false);
      return;
    }
    if (existingPending.data) {
      setError("Já existe um pré-cadastro com esse email.");
      setSubmitting(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from("pending_clinic_users")
      .insert({
        clinic_id: activeClinicId,
        email: emailNormalized,
        full_name: formData.full_name.trim(),
        role: formData.role,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    setMembers((prev) =>
      [...prev, { ...(data as TeamMember), pending: true }].sort((a, b) =>
        a.full_name.localeCompare(b.full_name)
      )
    );
    setInvitedEmail(emailNormalized);
    setShowModal(false);
    setSubmitting(false);
  };

  const handleDelete = async (member: TeamMember) => {
    if (member.id === profile?.id) {
      setError("Você não pode remover seu próprio acesso.");
      return;
    }
    setSubmitting(true);
    if (member.pending) {
      // Pré-cadastros são limpos diretamente — não têm conta auth ainda
      const { error: delError } = await supabase.from("pending_clinic_users").delete().eq("id", member.id);
      if (delError) {
        setError(delError.message);
        setSubmitting(false);
        return;
      }
    } else {
      // Usuário ativo: limpa tudo (clinic_users + org_users + auth.users + prontuario_passwords)
      const { error: rpcError } = await supabase.rpc("delete_user_full", { p_user_id: member.id });
      if (rpcError) {
        setError(rpcError.message);
        setSubmitting(false);
        return;
      }
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
    setShowDeleteConfirm(null);
    setSubmitting(false);
  };

  const roleInfo = (role: UserRole) =>
    TEAM_ROLES.find((r) => r.value === role) || { label: role, color: "bg-slate-50 text-slate-600 border-slate-200" };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Minha <span className="text-teal-600">Equipe</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1 font-medium">
            Gerencie gestores, secretárias e vendedores {clinicLabel ? `de ${clinicLabel}` : ""}.
          </p>
        </div>
        <Button onClick={openCreate} className="py-5 px-6">
          <Plus className="w-4 h-4 mr-2" /> Novo Membro
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou email..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100/30 focus:bg-white transition-all"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm font-medium">Carregando equipe...</span>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-sm font-bold text-slate-500">
              {search ? "Nenhum membro encontrado." : "Nenhum membro cadastrado ainda."}
            </p>
            {!search && (
              <p className="text-xs text-slate-400 mt-1">Clique em "Novo Membro" para pré-cadastrar.</p>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                <th className="px-6 py-3">Nome</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Função</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((m) => {
                const role = roleInfo(m.role);
                const isMe = m.id === profile?.id;
                return (
                  <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-xs",
                          m.pending ? "bg-slate-400" : "bg-teal-800"
                        )}>
                          {m.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{m.full_name}</p>
                          {isMe && <p className="text-[10px] text-teal-600 font-bold uppercase tracking-wider">Você</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">{m.email}</td>
                    <td className="px-6 py-4">
                      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border", role.color)}>
                        <Shield className="w-3 h-3" />
                        {role.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {m.pending ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border bg-amber-50 text-amber-700 border-amber-100">
                          <Clock className="w-3 h-3" />
                          Aguardando ativação
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border bg-emerald-50 text-emerald-700 border-emerald-100">
                          <CheckCircle2 className="w-3 h-3" />
                          Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(m)}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {!isMe && (
                          <button
                            onClick={() => setShowDeleteConfirm(m)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filteredMembers.length > 0 && (
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
            <p className="text-xs text-slate-400 font-medium">
              Mostrando {filteredMembers.length} {filteredMembers.length === 1 ? "membro" : "membros"}.
            </p>
          </div>
        )}
      </div>

      {/* Modal create/edit */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{editing ? "Editar Membro" : "Novo Membro"}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <Field
                  label="Nome completo"
                  icon={UserIcon}
                  value={formData.full_name}
                  onChange={(v) => setFormData((p) => ({ ...p, full_name: v }))}
                  placeholder="Ex.: Ana Silva"
                />
                <Field
                  label="Email"
                  icon={Mail}
                  value={formData.email}
                  onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
                  placeholder="email@exemplo.com"
                  type="email"
                  disabled={!!editing}
                />

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Função</label>
                  <div className="grid grid-cols-3 gap-2">
                    {TEAM_ROLES.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setFormData((p) => ({ ...p, role: r.value }))}
                        className={cn(
                          "py-3 rounded-xl border text-xs font-bold transition-all",
                          formData.role === r.value
                            ? "bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-200"
                            : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50"
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                {!editing && (
                  <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg text-sky-800 text-xs font-medium flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-sky-600" />
                    <span>
                      Após o pré-cadastro, o membro deve acessar a tela de login → aba <span className="font-bold">"Criar Conta"</span> → usar este email e definir a própria senha.
                    </span>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-medium flex items-center">
                    <AlertCircle className="w-3.5 h-3.5 mr-2" />
                    {error}
                  </div>
                )}
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : editing ? <Edit2 className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {editing ? "Atualizar" : "Pré-cadastrar"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmação de exclusão */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertCircle className="w-6 h-6 text-rose-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Remover Membro</h3>
                <p className="text-slate-500 text-sm">
                  Tem certeza que deseja remover <span className="font-bold text-slate-700">{showDeleteConfirm.full_name}</span>?{" "}
                  {showDeleteConfirm.pending ? "O pré-cadastro será apagado." : "O acesso ao sistema será revogado."}
                </p>
              </div>
              <div className="flex gap-3 p-4 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(null)}>
                  Cancelar
                </Button>
                <Button variant="destructive" className="flex-1" onClick={() => handleDelete(showDeleteConfirm)} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Remover
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmação pós-pré-cadastro */}
      <AnimatePresence>
        {invitedEmail && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setInvitedEmail(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Pré-cadastro concluído!</h3>
                <p className="text-sm text-slate-500 mb-3">
                  Informe ao novo membro:
                </p>
                <div className="space-y-2">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email cadastrado</p>
                    <p className="text-sm font-bold text-slate-900 break-all">{invitedEmail}</p>
                  </div>
                  <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg">
                    <p className="text-xs text-sky-800 font-medium leading-relaxed">
                      O membro deve acessar a tela de <span className="font-bold">login</span> → clicar em <span className="font-bold">"Criar Conta"</span> → usar este email e definir a senha que preferir.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50">
                <Button className="w-full" onClick={() => setInvitedEmail(null)}>
                  Entendi
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled = false,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      <div className={cn("group/field flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100/30 focus-within:bg-white transition-all", disabled && "opacity-60")}>
        <Icon className="w-4 h-4 text-slate-400 group-focus-within/field:text-teal-500 transition-colors flex-shrink-0" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-700 placeholder:text-slate-300"
        />
      </div>
    </div>
  );
}
