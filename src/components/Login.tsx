import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Stethoscope, Mail, Lock, Loader2, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';

type Tab = 'login' | 'register';

export function Login() {
  const [tab, setTab] = useState<Tab>('login');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Register state
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regSuccess, setRegSuccess] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message);
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    if (regPassword !== regConfirm) {
      setRegError("As senhas não coincidem.");
      return;
    }
    if (regPassword.length < 6) {
      setRegError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setRegLoading(true);

    try {
      // Validate email is pre-registered as medico
      const { data: validation, error: fnErr } = await supabase.functions.invoke('validate-medico-email', {
        body: { email: regEmail },
      });

      if (fnErr) throw fnErr;
      if (validation?.error) throw new Error(validation.error);
      if (!validation?.valid) {
        setRegError(validation?.reason ?? 'E-mail não autorizado.');
        return;
      }

      // Create account via Supabase Auth (sends confirmation email)
      const { error: signUpError } = await supabase.auth.signUp({
        email: regEmail,
        password: regPassword,
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setRegError('Este e-mail já possui uma conta. Faça login normalmente.');
        } else {
          throw signUpError;
        }
        return;
      }

      setRegSuccess(true);
    } catch (err: any) {
      setRegError(err.message ?? 'Erro ao criar conta.');
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.05),transparent_50%)] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-full h-full bg-[radial-gradient(circle_at_bottom_left,rgba(13,148,136,0.05),transparent_50%)] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8 relative z-10"
      >
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-lg shadow-teal-100 mb-4">
            <Stethoscope className="w-10 h-10" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">MedDesk</h1>
          <p className="text-slate-500 text-sm font-medium">Gestão inteligente para sua clínica</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-xl p-1 mb-6">
          {(['login', 'register'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); setRegError(null); setRegSuccess(false); }}
              className={cn(
                "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                tab === t ? "bg-white shadow text-slate-900" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {t === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {tab === 'login' ? (
            <motion.form
              key="login"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onSubmit={handleLogin}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase px-1">E-mail</label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="exemplo@clinica.com"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
                  />
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase px-1">Senha</label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
                  />
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                </div>
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-rose-600 text-xs font-bold"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </motion.div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={cn(
                  "w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold shadow-lg shadow-teal-100 transition-all flex items-center justify-center gap-2 mt-4",
                  loading && "opacity-70 cursor-not-allowed"
                )}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Acessar Painel"}
              </button>
            </motion.form>
          ) : (
            <motion.div
              key="register"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
            >
              {regSuccess ? (
                <div className="flex flex-col items-center gap-4 py-4 text-center">
                  <CheckCircle2 className="w-12 h-12 text-teal-500" />
                  <div>
                    <p className="font-black text-slate-900 text-base">Verifique seu e-mail</p>
                    <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                      Enviamos um link de confirmação para <strong>{regEmail}</strong>.<br />
                      Clique no link para ativar sua conta e fazer login.
                    </p>
                  </div>
                  <button
                    onClick={() => { setTab('login'); setRegSuccess(false); }}
                    className="text-sm font-bold text-teal-600 hover:text-teal-700"
                  >
                    Voltar para o login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleRegister} className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-xl p-3">
                    Exclusivo para médicos cadastrados pela clínica. Seu e-mail deve estar pré-autorizado pelo administrador.
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">E-mail</label>
                    <div className="relative">
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={e => setRegEmail(e.target.value)}
                        placeholder="seu@email.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
                      />
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">Senha</label>
                    <div className="relative">
                      <input
                        type={showRegPwd ? "text" : "password"}
                        required
                        value={regPassword}
                        onChange={e => setRegPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
                      />
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      <button type="button" onClick={() => setShowRegPwd(v => !v)} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                        {showRegPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase px-1">Confirmar senha</label>
                    <div className="relative">
                      <input
                        type={showRegPwd ? "text" : "password"}
                        required
                        value={regConfirm}
                        onChange={e => setRegConfirm(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
                      />
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    </div>
                  </div>

                  {regError && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-rose-600 text-xs font-bold"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {regError}
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={regLoading}
                    className={cn(
                      "w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold shadow-lg shadow-teal-100 transition-all flex items-center justify-center gap-2 mt-2",
                      regLoading && "opacity-70 cursor-not-allowed"
                    )}
                  >
                    {regLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Criar conta"}
                  </button>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 text-center space-y-3">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Exclusivo para parceiros MinhaClínica
          </p>
          <div className="flex items-center justify-center gap-4">
            <a href="/politicas" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-teal-600 transition-colors">
              Políticas de Privacidade
            </a>
            <span className="text-slate-200">·</span>
            <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-teal-600 transition-colors">
              Termos de Uso
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
