import React, { useState, useEffect } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, Copy, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

interface Props {
  onAuthorized: (email: string) => void;
}

export function ProntuarioPasswordModal({ onAuthorized }: Props) {
  const { profile, activeClinicId } = useAuth();

  const [step, setStep] = useState<"loading" | "show-pin" | "enter-pin">("loading");
  const [newPin, setNewPin] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedEmail, setSavedEmail] = useState("");

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      if (!profile?.id || !activeClinicId) return;

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
        // First access: generate PIN and show it
        const generated = generatePin();
        const hash = await sha256(generated);
        const userEmail = profile.id; // fallback; real email below

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
    }
    init();
  }, [profile?.id, activeClinicId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(newPin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmPin = () => {
    onAuthorized(savedEmail);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true);
    setError("");

    try {
      const hash = await sha256(pin.trim());

      const { data, error: dbError } = await supabase
        .from("prontuario_passwords")
        .select("email, password_hash")
        .eq("user_id", profile!.id)
        .eq("clinic_id", activeClinicId!)
        .maybeSingle();

      if (dbError) throw dbError;
      if (!data) {
        setError("Nenhuma senha configurada. Contate o administrador.");
        return;
      }
      if (data.password_hash !== hash) {
        setError("PIN incorreto. Tente novamente.");
        return;
      }

      onAuthorized(data.email);
    } catch (err: any) {
      setError("Erro ao verificar: " + err.message);
    } finally {
      setLoading(false);
    }
  };

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
                Sua senha de prontuário
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
              Anote este PIN — ele não será exibido novamente. Você precisará dele toda vez que acessar o módulo de prontuários.
            </p>
            <button
              onClick={handleConfirmPin}
              className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm rounded-xl transition-colors"
            >
              OK, guardei minha senha
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
                className="w-full pl-9 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-mono font-bold text-xl text-center tracking-[8px] transition-all"
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
          </form>
        )}
      </div>
    </div>
  );
}
