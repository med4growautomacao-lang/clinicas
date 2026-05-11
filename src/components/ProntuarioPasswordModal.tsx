import React, { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, Copy, Check, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { deriveKey, encryptPinForRecovery, decryptPinFromRecovery } from "../lib/prontuarioCrypto";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

interface Props {
  onAuthorized: (email: string, key: CryptoKey) => void;
}

export function ProntuarioPasswordModal({ onAuthorized }: Props) {
  const { profile, activeClinicId } = useAuth();

  const [step, setStep] = useState<"loading" | "show-pin" | "enter-pin" | "setup-recovery">("loading");

  // show-pin step
  const [newPin, setNewPin] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedEmail, setSavedEmail] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // enter-pin step
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // forgot-pin recovery
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryLoginPw, setRecoveryLoginPw] = useState("");
  const [recoveryLoading2, setRecoveryLoading2] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  // setup-recovery step
  const [pendingKey, setPendingKey] = useState<CryptoKey | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [pendingPin, setPendingPin] = useState("");
  const [setupPw, setSetupPw] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");

  // ── init ──────────────────────────────────────────────────────────────────
  const init = React.useCallback(async () => {
    if (!profile?.id || !activeClinicId) return;
    setStep("loading");

    const { data } = await supabase
      .from("prontuario_passwords")
      .select("email")
      .eq("user_id", profile.id)
      .eq("clinic_id", activeClinicId)
      .maybeSingle();

    if (data) {
      setSavedEmail(data.email);
      setStep("enter-pin");
    } else {
      const generated = generatePin();
      const hash = await sha256(generated);
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email ?? profile.id;

      await supabase.from("prontuario_passwords").upsert(
        { user_id: profile.id, clinic_id: activeClinicId, email, password_hash: hash },
        { onConflict: "user_id,clinic_id" }
      );

      setNewPin(generated);
      setSavedEmail(email);
      setStep("show-pin");
    }
  }, [profile?.id, activeClinicId]);

  useEffect(() => { init(); }, [init]);

  // ── show-pin ──────────────────────────────────────────────────────────────

  const handleCopy = () => {
    navigator.clipboard.writeText(newPin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmPin = async () => {
    if (!profile?.id || !activeClinicId) return;
    setRecoveryLoading(true);
    try {
      if (recoveryPassword.trim()) {
        const pin_encrypted = await encryptPinForRecovery(newPin, recoveryPassword.trim(), profile.id);
        if (pin_encrypted) {
          await supabase.from("prontuario_passwords")
            .update({ pin_encrypted })
            .eq("user_id", profile.id)
            .eq("clinic_id", activeClinicId);
        }
      }
    } catch { /* não bloqueia */ } finally {
      setRecoveryLoading(false);
    }
    const key = await deriveKey(newPin, profile.id, activeClinicId);
    onAuthorized(savedEmail, key);
  };

  // ── enter-pin ─────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || !profile?.id || !activeClinicId) return;
    setLoading(true);
    setError("");

    try {
      const hash = await sha256(pin.trim());

      const { data, error: dbError } = await supabase
        .from("prontuario_passwords")
        .select("email, password_hash, pin_encrypted")
        .eq("user_id", profile.id)
        .eq("clinic_id", activeClinicId)
        .maybeSingle();

      if (dbError) throw dbError;
      if (!data) { setError("Nenhum PIN configurado. Contate o administrador."); return; }
      if (data.password_hash !== hash) { setError("PIN incorreto. Tente novamente."); return; }

      const key = await deriveKey(pin.trim(), profile.id, activeClinicId);

      if (!data.pin_encrypted) {
        setPendingKey(key);
        setPendingEmail(data.email);
        setPendingPin(pin.trim());
        setPin("");
        setStep("setup-recovery");
      } else {
        onAuthorized(data.email, key);
      }
    } catch (err: any) {
      setError("Erro ao verificar: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── forgot-pin recovery ───────────────────────────────────────────────────

  const handleRecoverPin = async () => {
    if (!profile?.id || !activeClinicId || !recoveryLoginPw.trim()) return;
    setRecoveryLoading2(true);
    setRecoveryError("");
    setRecoveryResult("");
    try {
      const { data } = await supabase
        .from("prontuario_passwords")
        .select("pin_encrypted, email")
        .eq("user_id", profile.id)
        .eq("clinic_id", activeClinicId)
        .maybeSingle();

      if (data?.pin_encrypted) {
        const recovered = await decryptPinFromRecovery(data.pin_encrypted, recoveryLoginPw.trim(), profile.id);
        if (!recovered) { setRecoveryError("Senha incorreta."); return; }
        setRecoveryResult(recovered);
      } else {
        // No recovery — reset PIN by verifying login credentials
        const { data: { user } } = await supabase.auth.getUser();
        const email = user?.email ?? data?.email ?? savedEmail;
        if (!email) { setRecoveryError("Não foi possível identificar o e-mail."); return; }

        const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: recoveryLoginPw.trim() });
        if (authErr) { setRecoveryError("Senha incorreta."); return; }

        const generated = generatePin();
        const hash = await sha256(generated);
        const { error: updateErr } = await supabase.from("prontuario_passwords")
          .update({ password_hash: hash, pin_encrypted: null })
          .eq("user_id", profile.id)
          .eq("clinic_id", activeClinicId);
        if (updateErr) { setRecoveryError("Erro ao resetar PIN. Contate o suporte."); return; }

        setNewPin(generated);
        setShowRecovery(false);
        setRecoveryLoginPw("");
        setPin("");
        setStep("show-pin");
      }
    } catch {
      setRecoveryError("Erro ao recuperar PIN.");
    } finally {
      setRecoveryLoading2(false);
    }
  };

  // ── setup-recovery ────────────────────────────────────────────────────────

  const handleSaveRecovery = async () => {
    if (!profile?.id || !activeClinicId || !setupPw.trim() || !pendingKey) return;
    setSetupLoading(true);
    setSetupError("");
    try {
      const pin_encrypted = await encryptPinForRecovery(pendingPin, setupPw.trim(), profile.id);
      if (pin_encrypted) {
        await supabase.from("prontuario_passwords")
          .update({ pin_encrypted })
          .eq("user_id", profile.id)
          .eq("clinic_id", activeClinicId);
      }
      onAuthorized(pendingEmail, pendingKey);
    } catch {
      setSetupError("Erro ao salvar. Tente novamente.");
    } finally {
      setSetupLoading(false);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center mb-4">
            <ShieldCheck className="w-7 h-7 text-teal-600" />
          </div>
          <h2 className="text-lg font-black text-slate-900">Acesso Restrito</h2>
          <p className="text-xs text-slate-500 text-center mt-1 leading-relaxed">
            Dados sensíveis protegidos pela LGPD
          </p>
        </div>

        {step === "loading" && (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {step === "show-pin" && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <p className="text-xs font-bold text-amber-700 mb-3 uppercase tracking-wide">
                Seu PIN de prontuário
              </p>
              <div className="text-4xl font-black tracking-[12px] text-slate-900 mb-3">
                {newPin}
              </div>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 mx-auto text-xs font-semibold text-amber-700 hover:text-amber-900 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 text-center leading-relaxed">
              Anote este PIN — ele é pessoal e não será exibido novamente. Você precisará dele toda vez que acessar os prontuários.
            </p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-semibold text-slate-600">
                Senha de login (para recuperação do PIN)
              </p>
              <input
                type="password"
                value={recoveryPassword}
                onChange={e => setRecoveryPassword(e.target.value)}
                placeholder="Sua senha de acesso ao sistema"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Usada para criptografar o PIN localmente. Nem o servidor tem acesso a esta chave.
              </p>
            </div>
            <button
              onClick={handleConfirmPin}
              disabled={recoveryLoading}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-bold text-sm rounded-xl transition-colors"
            >
              {recoveryLoading ? "Salvando..." : "OK, guardei minha senha"}
            </button>
          </div>
        )}

        {step === "enter-pin" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={e => { setPin(e.target.value); setError(""); }}
                placeholder="PIN de 4 dígitos"
                maxLength={4}
                inputMode="numeric"
                className="w-full pl-9 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-mono font-bold text-xl text-center tracking-[8px] transition-all placeholder:tracking-normal placeholder:font-sans placeholder:font-normal placeholder:text-sm placeholder:text-slate-400"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPin(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || pin.length !== 4}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-bold text-sm rounded-xl transition-colors"
            >
              {loading ? "Verificando..." : "Acessar Prontuários"}
            </button>

            <button
              type="button"
              onClick={() => { setShowRecovery(v => !v); setRecoveryLoginPw(""); setRecoveryResult(""); setRecoveryError(""); }}
              className="w-full text-xs font-semibold text-slate-400 hover:text-teal-600 transition-colors pt-1"
            >
              {showRecovery ? "Cancelar" : "Esqueci meu PIN"}
            </button>

            {showRecovery && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                {!recoveryResult ? (
                  <>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Informe sua <strong>senha de login</strong> para recuperar o PIN.
                    </p>
                    <input
                      type="password"
                      value={recoveryLoginPw}
                      onChange={e => { setRecoveryLoginPw(e.target.value); setRecoveryError(""); }}
                      placeholder="Senha de login"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all"
                      onKeyDown={e => e.key === "Enter" && handleRecoverPin()}
                    />
                    {recoveryError && (
                      <p className="text-xs font-semibold text-rose-600">{recoveryError}</p>
                    )}
                    <button
                      type="button"
                      onClick={handleRecoverPin}
                      disabled={recoveryLoading2 || !recoveryLoginPw.trim()}
                      className="w-full py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-slate-300 text-white font-bold text-xs rounded-lg transition-colors"
                    >
                      {recoveryLoading2 ? "Verificando..." : "Recuperar PIN"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-slate-500 text-center">Seu PIN de prontuário</p>
                    <div className="text-3xl font-black tracking-[12px] text-slate-900 text-center py-2">
                      {recoveryResult}
                    </div>
                    <button
                      type="button"
                      onClick={() => { navigator.clipboard.writeText(recoveryResult); setRecoveryCopied(true); setTimeout(() => setRecoveryCopied(false), 2000); }}
                      className="w-full text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
                    >
                      {recoveryCopied ? "✓ Copiado!" : "Copiar PIN"}
                    </button>
                  </>
                )}
              </div>
            )}
          </form>
        )}

        {step === "setup-recovery" && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed">
                <strong>Recuperação de PIN não configurada.</strong> Se esquecer o PIN, não conseguirá acessar os prontuários. Configure agora para evitar bloqueios.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-600">
                Senha de login (para recuperação do PIN)
              </p>
              <input
                type="password"
                value={setupPw}
                onChange={e => { setSetupPw(e.target.value); setSetupError(""); }}
                placeholder="Sua senha de acesso ao sistema"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all"
                onKeyDown={e => e.key === "Enter" && handleSaveRecovery()}
                autoFocus
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Criptografa seu PIN localmente. O servidor nunca tem acesso a esta chave.
              </p>
            </div>

            {setupError && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                {setupError}
              </p>
            )}

            <button
              onClick={handleSaveRecovery}
              disabled={setupLoading || !setupPw.trim()}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-bold text-sm rounded-xl transition-colors"
            >
              {setupLoading ? "Salvando..." : "Salvar e Entrar"}
            </button>

            <button
              type="button"
              onClick={() => pendingKey && onAuthorized(pendingEmail, pendingKey)}
              className="w-full text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors pt-1"
            >
              Pular por agora (será solicitado novamente)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
