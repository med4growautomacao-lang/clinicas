import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { User, Mail, Building2, ShieldCheck, KeyRound, Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, Stethoscope, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/src/lib/utils";
import { encryptPinForRecovery } from "../lib/prontuarioCrypto";

const ROLE_LABELS: Record<string, string> = {
  gestor: "Gestor",
  medico: "Médico",
  medico_gestor: "Médico Gestor",
  secretaria: "Secretária",
  "super-admin": "Super Admin",
  org_owner: "Org Owner",
  org_admin: "Org Admin",
  org_team: "Org Team",
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function UserProfile() {
  const { user, profile, clinicName } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [prontuarioPin, setProntuarioPin] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [recoveryRows, setRecoveryRows] = useState<{ clinic_id: string; password_hash: string }[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    supabase
      .from("prontuario_passwords")
      .select("clinic_id, password_hash, pin_encrypted")
      .eq("user_id", profile.id)
      .not("pin_encrypted", "is", null)
      .then(({ data }) => setRecoveryRows((data || []) as any));
  }, [profile?.id]);

  const hasRecovery = recoveryRows.length > 0;

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "??";

  const roleLabel = ROLE_LABELS[profile?.role || ""] || profile?.role || "";

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(false);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Preencha todos os campos.");
      return;
    }
    if (newPassword.length < 6) {
      setError("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    if (!user?.email) {
      setError("Email do usuário não disponível.");
      return;
    }
    if (hasRecovery && !/^\d{4}$/.test(prontuarioPin)) {
      setError("Informe o PIN de 4 dígitos do Prontuário para preservar a recuperação.");
      return;
    }

    setLoading(true);

    // 1. Valida senha atual via re-login
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      setError("Senha atual incorreta.");
      setLoading(false);
      return;
    }

    // 2. Se houver recuperação ativa, valida o PIN contra password_hash
    if (hasRecovery) {
      const pinHash = await sha256(prontuarioPin);
      const mismatch = recoveryRows.find((r) => r.password_hash !== pinHash);
      if (mismatch) {
        setError("PIN do Prontuário incorreto.");
        setLoading(false);
        return;
      }
    }

    // 3. Atualiza a senha de login
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(updateError.message || "Erro ao atualizar senha.");
      setLoading(false);
      return;
    }

    // 4. Re-cifra o PIN com a nova senha
    if (hasRecovery && profile?.id) {
      try {
        const newEncrypted = await encryptPinForRecovery(prontuarioPin, newPassword, profile.id);
        if (newEncrypted) {
          for (const row of recoveryRows) {
            await supabase
              .from("prontuario_passwords")
              .update({ pin_encrypted: newEncrypted })
              .eq("user_id", profile.id)
              .eq("clinic_id", row.clinic_id);
          }
        }
      } catch (e) {
        console.error("Falha ao re-cifrar PIN de recuperação:", e);
      }
    }

    setSuccess(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setProntuarioPin("");
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-slate-900">
          Meu <span className="text-teal-600">Perfil</span>
        </h2>
        <p className="text-sm text-slate-500 mt-1 font-medium">
          Informações da conta e segurança
        </p>
      </div>

      {/* Informações do usuário */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100 bg-gradient-to-br from-teal-50 to-white">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-teal-800 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-teal-200">
              {initials}
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">{profile?.full_name || "Usuário"}</h3>
              <p className="text-sm text-slate-500 font-medium">{user?.email}</p>
            </div>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoRow icon={User} label="Nome completo" value={profile?.full_name || "—"} />
          <InfoRow icon={Mail} label="Email" value={user?.email || "—"} />
          <InfoRow icon={ShieldCheck} label="Função" value={roleLabel} />
          {profile?.organization_name ? (
            <InfoRow icon={Building2} label="Organização" value={profile.organization_name} />
          ) : clinicName ? (
            <InfoRow icon={Stethoscope} label="Clínica" value={clinicName} />
          ) : null}
        </div>
      </motion.div>

      {/* Troca de senha */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
      >
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Trocar senha de login</h3>
              <p className="text-xs text-slate-500 font-medium">Atualize a senha que você usa para acessar o sistema</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <PasswordField
            label="Senha atual"
            value={currentPassword}
            onChange={setCurrentPassword}
            visible={showCurrent}
            onToggle={() => setShowCurrent((v) => !v)}
            autoComplete="current-password"
          />
          <PasswordField
            label="Nova senha"
            value={newPassword}
            onChange={setNewPassword}
            visible={showNew}
            onToggle={() => setShowNew((v) => !v)}
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            autoComplete="new-password"
          />

          {hasRecovery && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                Você tem recuperação de PIN do Prontuário ativa. Informe seu PIN abaixo para que a recuperação continue funcionando com a nova senha.
              </p>
            </div>
          )}

          {hasRecovery && (
            <PinField
              label="PIN do Prontuário (4 dígitos)"
              value={prontuarioPin}
              onChange={setProntuarioPin}
              visible={showPin}
              onToggle={() => setShowPin((v) => !v)}
            />
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-medium flex items-center">
              <AlertCircle className="w-3.5 h-3.5 mr-2" />
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-emerald-700 text-xs font-medium flex items-center">
              <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
              Senha atualizada com sucesso.
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button onClick={handleChangePassword} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Atualizar senha
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-sm font-semibold text-slate-900 truncate">{value}</p>
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      <div className="group/field flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100/30 focus-within:bg-white transition-all duration-300">
        <KeyRound className="w-4 h-4 text-slate-400 group-focus-within/field:text-teal-500 transition-colors flex-shrink-0" />
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-700 placeholder:text-slate-300"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={onToggle}
          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function PinField({
  label,
  value,
  onChange,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      <div className="group/field flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100/30 focus-within:bg-white transition-all duration-300">
        <Lock className="w-4 h-4 text-slate-400 group-focus-within/field:text-teal-500 transition-colors flex-shrink-0" />
        <input
          type={visible ? "text" : "password"}
          inputMode="numeric"
          maxLength={4}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-700 placeholder:text-slate-300 tracking-widest"
          placeholder="0000"
        />
        <button
          type="button"
          onClick={onToggle}
          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
          aria-label={visible ? "Ocultar PIN" : "Mostrar PIN"}
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
