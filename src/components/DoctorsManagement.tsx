import React, { useState, useEffect } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import {
    Plus,
    Settings,
    Stethoscope,
    X,
    Loader2,
    AlertCircle,
    Clock,
    ShieldCheck,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useDoctors, Doctor } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "./ui/toast";

export function DoctorsManagement() {
    const { activeClinicId } = useAuth();
    const showToast = useToast();
    const { data: doctors, loading, error, refetch, update, remove } = useDoctors();
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        specialty: '',
        crm: '',
        email: '',
        isManager: false,
    });
    const [submitting, setSubmitting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    // doctor.id -> tem acesso de gestor (clinic_users/pending com role 'medico_gestor')
    const [managerMap, setManagerMap] = useState<Record<string, boolean>>({});

    // Descobre quais médicos têm acesso de gestor para exibir o selo e pré-marcar o checkbox.
    useEffect(() => {
        if (!activeClinicId || doctors.length === 0) { setManagerMap({}); return; }
        let cancelled = false;
        (async () => {
            const userIds = doctors.map(d => d.user_id).filter(Boolean) as string[];
            const [cuRes, pendRes] = await Promise.all([
                userIds.length
                    ? supabase.from('clinic_users').select('id, role').in('id', userIds)
                    : Promise.resolve({ data: [] as any[] }),
                supabase.from('pending_clinic_users').select('full_name, role')
                    .eq('clinic_id', activeClinicId).in('role', ['medico', 'medico_gestor']),
            ]);
            if (cancelled) return;
            const cuRole: Record<string, string> = {};
            (cuRes.data || []).forEach((u: any) => { cuRole[u.id] = u.role; });
            const pendRole: Record<string, string> = {};
            (pendRes.data || []).forEach((p: any) => { pendRole[(p.full_name || '').toLowerCase()] = p.role; });
            const map: Record<string, boolean> = {};
            doctors.forEach(d => {
                const role = d.user_id ? cuRole[d.user_id] : pendRole[d.name.toLowerCase()];
                map[d.id] = role === 'medico_gestor';
            });
            setManagerMap(map);
        })();
        return () => { cancelled = true; };
    }, [doctors, activeClinicId]);

    const openCreateModal = () => {
        setModalMode('create');
        setFormData({ name: '', specialty: '', crm: '', email: '', isManager: false });
        setSelectedDoctorId(null);
        setShowModal(true);
    };

    const openEditModal = (doc: Doctor) => {
        setModalMode('edit');
        setFormData({ name: doc.name, specialty: doc.specialty || '', crm: doc.crm || '', email: '', isManager: managerMap[doc.id] || false });
        setSelectedDoctorId(doc.id);
        setShowModal(true);
    };

    const handleSubmit = async () => {
        if (!formData.name.trim()) return;
        if (!formData.crm.trim()) {
            showToast("O CRM/CRO é obrigatório para cadastrar um profissional.", "error");
            return;
        }
        if (modalMode === 'create' && !formData.email.trim()) {
            showToast("O e-mail é obrigatório para cadastrar um profissional.", "error");
            return;
        }
        setSubmitting(true);

        try {
            if (modalMode === 'create') {
                // Pré-cadastra o email para o médico criar a própria conta no login
                const { error: pendingErr } = await supabase
                    .from('pending_clinic_users')
                    .upsert({
                        clinic_id: activeClinicId,
                        email: formData.email.trim().toLowerCase(),
                        full_name: formData.name.trim(),
                        role: formData.isManager ? 'medico_gestor' : 'medico',
                        crm: formData.crm.trim(),
                        specialty: formData.specialty.trim() || null,
                    }, { onConflict: 'email,clinic_id' });
                if (pendingErr) throw pendingErr;

                // Cria o registro no corpo clínico (user_id null até o médico ativar a conta)
                const { error: doctorErr } = await supabase
                    .from('doctors')
                    .insert({
                        clinic_id: activeClinicId,
                        name: formData.name.trim(),
                        specialty: formData.specialty.trim() || null,
                        crm: formData.crm.trim(),
                        status: 'offline',
                        user_id: null,
                    });
                if (doctorErr) throw doctorErr;

                refetch(true, true);
            } else if (selectedDoctorId) {
                await update(selectedDoctorId, {
                    name: formData.name,
                    specialty: formData.specialty || null,
                    crm: formData.crm || null,
                });
                // Sincroniza o acesso de gestor (médico ↔ médico gestor) na conta/pré-cadastro
                const editedDoc = doctors.find(d => d.id === selectedDoctorId);
                const newRole = formData.isManager ? 'medico_gestor' : 'medico';
                if (editedDoc?.user_id) {
                    await supabase.from('clinic_users').update({ role: newRole }).eq('id', editedDoc.user_id);
                } else if (activeClinicId) {
                    await supabase.from('pending_clinic_users').update({ role: newRole })
                        .eq('clinic_id', activeClinicId).ilike('full_name', formData.name.trim());
                }
                setManagerMap(prev => ({ ...prev, [selectedDoctorId]: formData.isManager }));
            }

            setFormData({ name: '', specialty: '', crm: '', email: '', isManager: false });
            setShowModal(false);
        } catch (err: any) {
            showToast("Erro ao salvar: " + err.message, "error");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        setSubmitting(true);
        await remove(id);
        setShowDeleteConfirm(null);
        setSubmitting(false);
    };


    const toggleStatus = async (doc: Doctor) => {
        const newStatus = doc.status === 'atendendo' ? 'pausa' : 'atendendo';
        await update(doc.id, { status: newStatus });
    };

    const isPending = (doc: Doctor) => !doc.user_id;
    const statusLabel = (doc: Doctor) => isPending(doc) ? 'Aguardando cadastro' : doc.status === 'atendendo' ? 'Atendendo' : doc.status === 'pausa' ? 'Em Pausa' : 'Offline';
    const statusColor = (doc: Doctor) => isPending(doc) ? 'bg-violet-300' : doc.status === 'atendendo' ? 'bg-emerald-500' : doc.status === 'pausa' ? 'bg-amber-400' : 'bg-slate-400';
    const statusBadge = (doc: Doctor) => isPending(doc)
        ? "bg-violet-50 text-violet-600 border-violet-100"
        : doc.status === 'atendendo'
            ? "bg-emerald-50 text-emerald-600 border-emerald-100"
            : doc.status === 'pausa'
                ? "bg-amber-50 text-amber-600 border-amber-100"
                : "bg-slate-50 text-slate-600 border-slate-100";

    const avatarColors = [
        "bg-blue-50", "bg-yellow-50", "bg-purple-50", "bg-rose-50", "bg-emerald-50",
        "bg-orange-50", "bg-indigo-50", "bg-pink-50", "bg-teal-50", "bg-lime-50"
    ];

    if (loading && doctors.length === 0) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                        Corpo <span className="text-teal-600">Clínico</span>
                    </h2>
                    <p className="text-slate-500 font-medium text-base">
                        Gerencie os profissionais e suas especialidades.
                    </p>
                </motion.div>
                <Button className="py-5 px-6 group" onClick={openCreateModal}>
                    <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
                    Adicionar Profissional
                </Button>
            </div>

            {error && (
                <div className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm font-medium">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence mode="popLayout">
                {doctors.map((doc, i) => (
                    <motion.div
                        key={doc.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                    >
                        <Card className="border border-slate-200 shadow-sm overflow-hidden group hover:shadow-md transition-all relative">
                            <div className={cn("h-1.5 w-full", statusColor(doc))} />
                            <CardContent className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className={cn("w-16 h-16 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform text-2xl font-bold text-slate-600", avatarColors[i % avatarColors.length])}>
                                        {doc.name.split(' ').map(n => n[0]).slice(0, 2).join('')}
                                    </div>
                                    <div className="flex flex-col items-end gap-2 text-right">
                                        {isPending(doc) ? (
                                            <span className={cn("flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border whitespace-nowrap", statusBadge(doc))}>
                                                <Clock className="w-3 h-3" />
                                                Aguardando cadastro
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => toggleStatus(doc)}
                                                className={cn(
                                                    "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border cursor-pointer hover:opacity-80 transition-opacity whitespace-nowrap",
                                                    statusBadge(doc)
                                                )}
                                            >
                                                {statusLabel(doc)}
                                            </button>
                                        )}
                                        {doc.crm && <p className="text-[10px] font-bold text-slate-400 uppercase">{doc.crm}</p>}
                                    </div>
                                </div>

                                <div className="space-y-1 mb-6">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <h3 className="text-lg font-bold text-slate-900 group-hover:text-teal-700 transition-colors truncate min-w-0">
                                            {doc.name}
                                        </h3>
                                        {managerMap[doc.id] && (
                                            <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded-md">
                                                <ShieldCheck className="w-3 h-3" />
                                                Gestor
                                            </span>
                                        )}
                                    </div>
                                    {doc.specialty && (
                                        <div className="flex items-center gap-2 text-slate-500 font-medium text-sm">
                                            <Stethoscope className="w-3.5 h-3.5 text-teal-600" />
                                            <span>{doc.specialty}</span>
                                        </div>
                                    )}
                                </div>

                                <Button
                                    variant="secondary"
                                    className="w-full h-9 flex gap-2 text-xs font-bold"
                                    onClick={() => openEditModal(doc)}
                                >
                                    <Settings className="w-3.5 h-3.5" />
                                    Editar
                                </Button>
                            </CardContent>

                            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between group-hover:bg-teal-50/30 transition-colors">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                    {isPending(doc) ? 'Conta pendente' : doc.is_active ? 'Status: Ativo' : 'Status: Inativo'}
                                </span>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setShowDeleteConfirm(doc.id)}
                                        className="text-xs font-bold text-rose-400 hover:text-rose-600 transition-colors uppercase"
                                    >
                                        Excluir
                                    </button>
                                </div>
                            </div>

                            {/* Delete Confirmation Overlay */}
                            <AnimatePresence>
                                {showDeleteConfirm === doc.id && (
                                    <motion.div 
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute inset-0 bg-white/95 z-10 flex flex-col items-center justify-center p-6 text-center"
                                    >
                                        <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
                                        <h4 className="text-sm font-bold text-slate-900 mb-1">Confirmar Exclusão?</h4>
                                        <p className="text-xs text-slate-500 mb-4">Esta ação não pode ser desfeita.</p>
                                        <div className="flex gap-2 w-full">
                                            <Button 
                                                variant="outline" 
                                                className="flex-1 h-8 text-[10px] font-bold"
                                                onClick={() => setShowDeleteConfirm(null)}
                                            >
                                                Não
                                            </Button>
                                            <Button 
                                                className="flex-1 h-8 text-[10px] font-bold bg-rose-600 hover:bg-rose-700"
                                                onClick={() => handleDelete(doc.id)}
                                                disabled={submitting}
                                            >
                                                Sim, Excluir
                                            </Button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </Card>
                    </motion.div>
                ))}
                </AnimatePresence>

                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                >
                    <button
                        onClick={openCreateModal}
                        className="w-full h-full min-h-[300px] border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center p-8 group hover:border-teal-300 hover:bg-teal-50/30 transition-all"
                    >
                        <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-white group-hover:shadow-md transition-all">
                            <Plus className="w-8 h-8 text-teal-600" />
                        </div>
                        <h4 className="text-lg font-bold text-slate-900 mb-1">Novo Profissional</h4>
                        <p className="text-center text-slate-400 font-medium max-w-[200px] text-sm">
                            Adicione um novo membro ao corpo clínico.
                        </p>
                    </button>
                </motion.div>
            </div>

            {/* Create/Edit Modal */}
            <AnimatePresence>
                {showModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
                        onClick={() => setShowModal(false)}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-6 border-b border-slate-100">
                                <h3 className="text-lg font-bold text-slate-900">
                                    {modalMode === 'create' ? 'Adicionar Profissional' : 'Editar Profissional'}
                                </h3>
                                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-bold">Nome completo *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-medium text-sm transition-all"
                                        placeholder="Dr. João Silva"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-bold">Especialidade</label>
                                    <input
                                        type="text"
                                        value={formData.specialty}
                                        onChange={e => setFormData(p => ({ ...p, specialty: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-medium text-sm transition-all"
                                        placeholder="Clínico Geral"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-bold">CRM / CRO *</label>
                                    <input
                                        type="text"
                                        value={formData.crm}
                                        onChange={e => setFormData(p => ({ ...p, crm: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-medium text-sm transition-all"
                                        placeholder="CRM 12345-SP"
                                        required
                                    />
                                </div>

                                {modalMode === 'create' && (
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 font-bold">E-mail de Login *</label>
                                        <input
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-300 font-medium text-sm transition-all"
                                            placeholder="email@clinica.com"
                                        />
                                        <p className="text-[11px] text-slate-400 mt-1.5">O médico deverá criar a conta em "Criar conta" na tela de login usando este e-mail.</p>
                                    </div>
                                )}

                                <div className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                                    <input
                                        id="doctor-is-manager"
                                        type="checkbox"
                                        checked={formData.isManager}
                                        onChange={e => setFormData(p => ({ ...p, isManager: e.target.checked }))}
                                        className="mt-0.5 w-4 h-4 accent-teal-600 cursor-pointer"
                                    />
                                    <label htmlFor="doctor-is-manager" className="cursor-pointer">
                                        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                                            <ShieldCheck className="w-4 h-4 text-teal-600" />
                                            Acesso de gestor (médico gestor)
                                        </span>
                                        <span className="block text-[11px] text-slate-400 mt-0.5">
                                            Além de atender, terá acesso de gestão (Equipe, Corpo Clínico, Financeiro etc.).
                                        </span>
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                                <Button variant="outline" className="flex-1 font-bold" onClick={() => setShowModal(false)}>
                                    Cancelar
                                </Button>
                                <Button
                                    className="flex-1 font-bold"
                                    onClick={handleSubmit}
                                    disabled={!formData.name.trim() || submitting}
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : modalMode === 'create' ? <Plus className="w-4 h-4 mr-2" /> : <Settings className="w-4 h-4 mr-2" />}
                                    {modalMode === 'create' ? 'Cadastrar' : 'Salvar Alterações'}
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

        </div>
    );
}
