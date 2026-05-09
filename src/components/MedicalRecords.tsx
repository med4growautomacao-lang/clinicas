import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import {
    Search, FileText, History, Plus, User, Calendar, Scale, Ruler,
    AlertCircle, Stethoscope, Loader2, Trash2, Edit2, X,
    ClipboardList, Printer, Pill, FlaskConical, Microscope, ChevronDown, ChevronUp,
    Heart, Thermometer,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";
import {
    usePatients, useMedicalRecords, useDoctors, usePrescriptions, useExamRequests,
    Patient, MedicalRecord, Prescription, PrescriptionMed, ExamRequest, ExamItem, Doctor,
} from "../hooks/useSupabase";
import { PatientModal } from "./PatientModal";
import { ProntuarioPasswordModal } from "./ProntuarioPasswordModal";
import { exportKey, importKey, encryptField, decryptField, encryptJSON, decryptJSON } from "../lib/prontuarioCrypto";

// ─── Print: Receituário ───────────────────────────────────────────────────────
function printPrescription(p: Prescription, patient: Patient, doctor: Doctor | undefined, clinicName: string) {
    const age = patient.birth_date ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Receituário</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Times New Roman',serif;font-size:12pt;color:#000;padding:18mm 16mm;max-width:210mm;margin:0 auto}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px}
.clinic-name{font-size:17pt;font-weight:bold;text-transform:uppercase}.clinic-sub{font-size:9pt;color:#444;margin-top:3px}.header-right{text-align:right;font-size:9pt;color:#444}
.title-bar{text-align:center;font-size:13pt;font-weight:bold;text-transform:uppercase;letter-spacing:4px;border:1.5px solid #000;padding:6px 0;margin-bottom:14px}
.pbox{border:1px solid #ccc;border-radius:4px;padding:8px 12px;margin-bottom:16px;background:#fafafa}.prow{display:flex;gap:24px;flex-wrap:wrap}.pf{font-size:10pt}.pf span{font-weight:bold}
.stitle{font-size:10.5pt;font-weight:bold;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:10px}
.mi{margin-bottom:13px;padding-left:8px;border-left:3px solid #000}.mn{font-size:11.5pt;font-weight:bold}.md{font-size:10pt;margin-top:2px;color:#222}.md span{font-weight:bold}
.nb{background:#fafafa;border:1px dashed #bbb;border-radius:4px;padding:8px 12px;font-size:10.5pt;line-height:1.6;white-space:pre-wrap;margin-bottom:16px}
.dl{text-align:right;font-size:10pt;margin-bottom:36px}.sb{text-align:center}.sl{display:inline-block;border-top:1px solid #000;width:220px;padding-top:5px;font-size:10pt}
.val{font-size:8pt;color:#666;text-align:center;margin-top:24px;border-top:1px dashed #ccc;padding-top:8px}
@media print{body{padding:12mm 10mm}}</style></head><body>
<div class="header"><div><div class="clinic-name">${clinicName}</div>${doctor ? `<div class="clinic-sub">Dr(a). ${doctor.name}${doctor.crm ? ' | CRM ' + doctor.crm : ''}${doctor.specialty ? ' | ' + doctor.specialty : ''}</div>` : ''}</div><div class="header-right">Data: ${new Date(p.created_at).toLocaleDateString('pt-BR')}<br/>Receita Simples</div></div>
<div class="title-bar">RECEITUÁRIO MÉDICO</div>
<div class="pbox"><div class="prow"><div class="pf">Paciente: <span>${patient.name}</span></div>${age !== null ? `<div class="pf">Idade: <span>${age} anos</span></div>` : ''}${patient.cpf ? `<div class="pf">CPF: <span>${patient.cpf}</span></div>` : ''}${patient.birth_date ? `<div class="pf">Nascimento: <span>${new Date(patient.birth_date + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>` : ''}</div></div>
<div class="stitle">Medicamentos Prescritos</div>
${p.medications.map((m, i) => `<div class="mi"><div class="mn">${i + 1}. ${m.name}${m.dosage ? ' – ' + m.dosage : ''}</div>${m.quantity ? `<div class="md"><span>Quantidade:</span> ${m.quantity}</div>` : ''}${m.instructions ? `<div class="md"><span>Posologia:</span> ${m.instructions}</div>` : ''}</div>`).join('')}
${p.notes ? `<div class="stitle" style="margin-top:16px">Observações</div><div class="nb">${p.notes}</div>` : ''}
<div class="dl">_________________________, ${new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
<div class="sb"><div class="sl">${doctor ? `Dr(a). ${doctor.name}${doctor.crm ? '<br/>CRM ' + doctor.crm : ''}` : 'Assinatura / Carimbo'}</div></div>
<div class="val">Validade: 30 dias — RECEITA SIMPLES</div></body></html>`;
    const w = window.open('', '_blank', 'width=820,height=960');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}

// ─── Print: Pedido de Exames ──────────────────────────────────────────────────
function printExamRequest(req: ExamRequest, patient: Patient, doctor: Doctor | undefined, clinicName: string) {
    const age = patient.birth_date ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
    const typeLabel: Record<string, string> = { laboratorial: 'Laboratorial', imagem: 'Imagem', funcional: 'Funcional', outro: 'Outro' };
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Pedido de Exames</title><style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Times New Roman',serif;font-size:12pt;color:#000;padding:18mm 16mm;max-width:210mm;margin:0 auto}
.header{display:flex;justify-content:space-between;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:14px}
.clinic-name{font-size:17pt;font-weight:bold;text-transform:uppercase}.clinic-sub{font-size:9pt;color:#444;margin-top:3px}.header-right{text-align:right;font-size:9pt;color:#444}
.title-bar{text-align:center;font-size:13pt;font-weight:bold;text-transform:uppercase;letter-spacing:4px;border:1.5px solid #000;padding:6px 0;margin-bottom:14px}
.pbox{border:1px solid #ccc;border-radius:4px;padding:8px 12px;margin-bottom:16px;background:#fafafa}.prow{display:flex;gap:24px;flex-wrap:wrap}.pf{font-size:10pt}.pf span{font-weight:bold}
.stitle{font-size:10.5pt;font-weight:bold;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:10px}
.ei{display:flex;align-items:baseline;gap:8px;margin-bottom:9px;padding-left:8px;border-left:3px solid #000}.en{font-weight:bold;font-size:11pt;min-width:18px}.ename{font-size:11pt;font-weight:bold;flex:1}
.badge{font-size:8pt;padding:1px 6px;border:1px solid #999;border-radius:3px}.badge.u{border-color:#c00;color:#c00;font-weight:bold}
.ib{background:#fafafa;border:1px solid #ccc;border-radius:4px;padding:8px 12px;font-size:10.5pt;line-height:1.5;margin-bottom:16px}
.nb{background:#fafafa;border:1px dashed #bbb;border-radius:4px;padding:8px 12px;font-size:10.5pt;white-space:pre-wrap;margin-bottom:16px}
.dl{text-align:right;font-size:10pt;margin-bottom:36px}.sb{text-align:center}.sl{display:inline-block;border-top:1px solid #000;width:220px;padding-top:5px;font-size:10pt}
.val{font-size:8pt;color:#666;text-align:center;margin-top:24px;border-top:1px dashed #ccc;padding-top:8px}
@media print{body{padding:12mm 10mm}}</style></head><body>
<div class="header"><div><div class="clinic-name">${clinicName}</div>${doctor ? `<div class="clinic-sub">Dr(a). ${doctor.name}${doctor.crm ? ' | CRM ' + doctor.crm : ''}${doctor.specialty ? ' | ' + doctor.specialty : ''}</div>` : ''}</div><div class="header-right">Data: ${new Date(req.created_at).toLocaleDateString('pt-BR')}<br/>Pedido de Exames</div></div>
<div class="title-bar">PEDIDO DE EXAMES</div>
<div class="pbox"><div class="prow"><div class="pf">Paciente: <span>${patient.name}</span></div>${age !== null ? `<div class="pf">Idade: <span>${age} anos</span></div>` : ''}${patient.cpf ? `<div class="pf">CPF: <span>${patient.cpf}</span></div>` : ''}${patient.birth_date ? `<div class="pf">Nascimento: <span>${new Date(patient.birth_date + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>` : ''}</div></div>
<div class="stitle">Exames Solicitados</div>
${req.exams.map((e, i) => `<div class="ei"><span class="en">${i + 1}.</span><span class="ename">${e.name}</span><span class="badge">${typeLabel[e.type] || e.type}</span>${e.urgency === 'urgente' ? '<span class="badge u">URGENTE</span>' : ''}</div>`).join('')}
${req.clinical_indication ? `<div class="stitle" style="margin-top:16px">Indicação Clínica</div><div class="ib">${req.clinical_indication}</div>` : ''}
${req.notes ? `<div class="stitle">Observações</div><div class="nb">${req.notes}</div>` : ''}
<div class="dl">_________________________, ${new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
<div class="sb"><div class="sl">${doctor ? `Dr(a). ${doctor.name}${doctor.crm ? '<br/>CRM ' + doctor.crm : ''}` : 'Assinatura / Carimbo'}</div></div>
<div class="val">Validade: 90 dias a partir da data de emissão</div></body></html>`;
    const w = window.open('', '_blank', 'width=820,height=960');
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}

const emptyMed = (): PrescriptionMed => ({ name: '', dosage: '', quantity: '', instructions: '' });
const emptyExam = (): ExamItem => ({ name: '', type: 'laboratorial', urgency: 'rotina' });

// ─── Componente de Prescrição dentro do card ──────────────────────────────────
function RecordPrescriptions({ recordId, prescriptions, examRequests, doctors, patient, clinicName, onAddPresc, onAddExam, onDeletePresc, onDeleteExam }: {
    recordId: string;
    prescriptions: Prescription[];
    examRequests: ExamRequest[];
    doctors: Doctor[];
    patient: Patient;
    clinicName: string;
    onAddPresc: (recordId: string) => void;
    onAddExam: (recordId: string) => void;
    onDeletePresc: (p: Prescription) => void;
    onDeleteExam: (e: ExamRequest) => void;
}) {
    const linked_prescs = prescriptions.filter(p => p.record_id === recordId);
    const linked_exams = examRequests.filter(e => e.record_id === recordId);
    const hasItems = linked_prescs.length > 0 || linked_exams.length > 0;

    return (
        <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Documentos desta consulta</span>
                <div className="flex gap-1.5">
                    <button onClick={() => onAddPresc(recordId)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors">
                        <Plus className="w-3 h-3" /> Receita
                    </button>
                    <button onClick={() => onAddExam(recordId)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100 transition-colors">
                        <Plus className="w-3 h-3" /> Exames
                    </button>
                </div>
            </div>

            {!hasItems && (
                <p className="text-[10px] text-slate-400 italic">Nenhum documento adicionado.</p>
            )}

            {linked_prescs.map(presc => {
                const doc = doctors.find(d => d.id === presc.doctor_id);
                return (
                    <div key={presc.id} className="flex items-start gap-2 p-2.5 bg-emerald-50 rounded-lg border border-emerald-100 mb-1.5 group/item">
                        <ClipboardList className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-emerald-700 uppercase">Receituário</p>
                            <p className="text-xs text-slate-700 font-medium">{presc.medications.map(m => m.name).join(', ')}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <button onClick={() => printPrescription(presc, patient, doc, clinicName)} className="p-1 text-emerald-600 hover:bg-emerald-100 rounded transition-colors"><Printer className="w-3.5 h-3.5" /></button>
                            <button onClick={() => onDeletePresc(presc)} className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                    </div>
                );
            })}

            {linked_exams.map(req => {
                const doc = doctors.find(d => d.id === req.doctor_id);
                return (
                    <div key={req.id} className="flex items-start gap-2 p-2.5 bg-indigo-50 rounded-lg border border-indigo-100 mb-1.5 group/item">
                        <FlaskConical className="w-3.5 h-3.5 text-indigo-600 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-indigo-700 uppercase">Pedido de Exames</p>
                            <p className="text-xs text-slate-700 font-medium">{req.exams.map(e => e.name).join(', ')}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <button onClick={() => printExamRequest(req, patient, doc, clinicName)} className="p-1 text-indigo-600 hover:bg-indigo-100 rounded transition-colors"><Printer className="w-3.5 h-3.5" /></button>
                            <button onClick={() => onDeleteExam(req)} className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Conteúdo (só monta após autenticação) ───────────────────────────────────
function MedicalRecordsContent({ encKey }: { encKey: CryptoKey }) {
    const { clinicName } = useAuth();
    const { data: patients, loading: patientsLoading, create: createPatient, update: updatePatient, remove: removePatient, refetch: refetchPatients } = usePatients();
    const { data: doctors } = useDoctors();
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const { data: records, loading: recordsLoading, create: createRecord, update: updateRecord, remove: removeRecord } = useMedicalRecords(selectedPatient?.id || null);
    const { data: prescriptions, loading: prescLoading, create: createPrescription, remove: removePrescription } = usePrescriptions(selectedPatient?.id || null);
    const { data: examRequests, loading: examLoading, create: createExamRequest, remove: removeExamRequest } = useExamRequests(selectedPatient?.id || null);

    // Versões descriptografadas para exibição
    const [decRecords, setDecRecords] = useState<MedicalRecord[]>([]);
    const [decPrescriptions, setDecPrescriptions] = useState<Prescription[]>([]);
    const [decExamRequests, setDecExamRequests] = useState<ExamRequest[]>([]);

    useEffect(() => {
        if (!encKey) return;
        Promise.all((records || []).map(async r => ({
            ...r,
            description: await decryptField(r.description, encKey),
            diagnosis: await decryptField(r.diagnosis, encKey),
            prescription: await decryptField(r.prescription, encKey),
            weight: await decryptField(r.weight, encKey),
            height: await decryptField(r.height, encKey),
            blood_pressure: await decryptField(r.blood_pressure, encKey),
            temperature: await decryptField(r.temperature, encKey),
        }))).then(setDecRecords);
    }, [records, encKey]);

    useEffect(() => {
        if (!encKey) return;
        Promise.all((prescriptions || []).map(async p => ({
            ...p,
            medications: (await decryptJSON<PrescriptionMed[]>(p.medications, encKey)) ?? (Array.isArray(p.medications) ? p.medications : []),
            notes: await decryptField(p.notes, encKey),
        }))).then(setDecPrescriptions);
    }, [prescriptions, encKey]);

    useEffect(() => {
        if (!encKey) return;
        Promise.all((examRequests || []).map(async e => ({
            ...e,
            exams: (await decryptJSON<ExamItem[]>(e.exams, encKey)) ?? (Array.isArray(e.exams) ? e.exams : []),
            clinical_indication: await decryptField(e.clinical_indication, encKey),
            notes: await decryptField(e.notes, encKey),
        }))).then(setDecExamRequests);
    }, [examRequests, encKey]);

    // Patient Modal
    const [showPatientModal, setShowPatientModal] = useState(false);
    const [patientModalMode, setPatientModalMode] = useState<'create' | 'edit'>('create');
    const [patientFormData, setPatientFormData] = useState({ name: '', phone: '', cpf: '', birth_date: '', gender: '', weight: '', height: '', allergies: [] as string[] });
    const [showDeletePatientConfirm, setShowDeletePatientConfirm] = useState(false);

    // Record Modal
    const [showRecordModal, setShowRecordModal] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
    const [recordFormData, setRecordFormData] = useState({ type: 'consulta' as any, description: '', diagnosis: '', prescription: '', doctor_id: '', weight: '', height: '', blood_pressure: '', temperature: '' });
    const [showDeleteRecordConfirm, setShowDeleteRecordConfirm] = useState(false);

    // Prescription Modal (linked to a record)
    const [showPrescModal, setShowPrescModal] = useState(false);
    const [prescRecordId, setPrescRecordId] = useState<string | null>(null);
    const [prescDoctorId, setPrescDoctorId] = useState('');
    const [prescMeds, setPrescMeds] = useState<PrescriptionMed[]>([emptyMed()]);
    const [prescNotes, setPrescNotes] = useState('');
    const [showDeletePrescConfirm, setShowDeletePrescConfirm] = useState(false);
    const [selectedPresc, setSelectedPresc] = useState<Prescription | null>(null);

    // Exam Modal (linked to a record)
    const [showExamModal, setShowExamModal] = useState(false);
    const [examRecordId, setExamRecordId] = useState<string | null>(null);
    const [examDoctorId, setExamDoctorId] = useState('');
    const [examItems, setExamItems] = useState<ExamItem[]>([emptyExam()]);
    const [examIndication, setExamIndication] = useState('');
    const [examNotes, setExamNotes] = useState('');
    const [showDeleteExamConfirm, setShowDeleteExamConfirm] = useState(false);
    const [selectedExam, setSelectedExam] = useState<ExamRequest | null>(null);

    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (patients.length > 0 && !selectedPatient) setSelectedPatient(patients[0]);
    }, [patients]);

    const filteredPatients = patients.filter(p => {
        const t = searchTerm.toLowerCase();
        return p.name.toLowerCase().includes(t) || p.cpf?.includes(t) || p.phone?.includes(t);
    });

    const getInitials = (name: string) => name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    const getAge = (d: string | null) => d ? `${Math.floor((Date.now() - new Date(d).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} anos` : '—';

    // Patient actions
    const handleOpenCreatePatient = () => { setPatientModalMode('create'); setPatientFormData({ name: '', phone: '', cpf: '', birth_date: '', gender: '', weight: '', height: '', allergies: [] }); setShowPatientModal(true); };
    const handleOpenEditPatient = () => {
        if (!selectedPatient) return;
        setPatientModalMode('edit');
        setPatientFormData({ name: selectedPatient.name, phone: selectedPatient.phone || '', cpf: selectedPatient.cpf || '', birth_date: selectedPatient.birth_date || '', gender: selectedPatient.gender || '', weight: selectedPatient.weight?.toString() || '', height: selectedPatient.height?.toString() || '', allergies: selectedPatient.allergies || [] });
        setShowPatientModal(true);
    };
    const handleDeletePatient = async () => { if (!selectedPatient) return; setSubmitting(true); await removePatient(selectedPatient.id); setSelectedPatient(null); setShowDeletePatientConfirm(false); setSubmitting(false); };
    const handlePatientSuccess = (patient: Patient) => { if (patientModalMode === 'create') setSelectedPatient(patient); refetchPatients(); };

    // Record actions
    const handleOpenCreateRecord = () => {
        if (!selectedPatient) return;
        setSelectedRecord(null);
        setRecordFormData({ type: 'consulta', description: '', diagnosis: '', prescription: '', doctor_id: doctors[0]?.id || '', weight: selectedPatient?.weight?.toString() || '', height: selectedPatient?.height?.toString() || '', blood_pressure: '', temperature: '' });
        setShowRecordModal(true);
    };
    const handleOpenEditRecord = (record: MedicalRecord) => {
        setSelectedRecord(record);
        setRecordFormData({ type: record.type, description: record.description || '', diagnosis: record.diagnosis || '', prescription: record.prescription || '', doctor_id: record.doctor_id || '', weight: record.weight || '', height: record.height || '', blood_pressure: record.blood_pressure || '', temperature: record.temperature || '' });
        setShowRecordModal(true);
    };
    const handleRecordSubmit = async () => {
        if (!selectedPatient || !recordFormData.doctor_id || !encKey) return;
        setSubmitting(true);
        try {
            const enc = {
                ...recordFormData,
                patient_id: selectedPatient.id,
                description: await encryptField(recordFormData.description || null, encKey),
                diagnosis: await encryptField(recordFormData.diagnosis || null, encKey),
                prescription: await encryptField(recordFormData.prescription || null, encKey),
                weight: await encryptField(recordFormData.weight || null, encKey),
                height: await encryptField(recordFormData.height || null, encKey),
                blood_pressure: await encryptField(recordFormData.blood_pressure || null, encKey),
                temperature: await encryptField(recordFormData.temperature || null, encKey),
            };
            if (selectedRecord) await updateRecord(selectedRecord.id, enc);
            else await createRecord(enc);
            setShowRecordModal(false);
        } catch (err) {
            console.error('[Prontuário] Erro na criptografia:', err);
            alert('Erro ao criptografar os dados. Verifique o console.');
        } finally {
            setSubmitting(false);
        }
    };
    const handleDeleteRecord = async () => { if (!selectedRecord) return; setSubmitting(true); await removeRecord(selectedRecord.id); setShowDeleteRecordConfirm(false); setSelectedRecord(null); setSubmitting(false); };

    // Prescription actions
    const openNewPresc = (recordId: string) => { setPrescRecordId(recordId); setPrescDoctorId(doctors[0]?.id || ''); setPrescMeds([emptyMed()]); setPrescNotes(''); setShowPrescModal(true); };
    const handlePrescSubmit = async () => {
        if (!selectedPatient || !encKey) return;
        const valid = prescMeds.filter(m => m.name.trim());
        if (!valid.length) return;
        setSubmitting(true);
        await createPrescription({
            patient_id: selectedPatient.id,
            doctor_id: prescDoctorId || null,
            medications: await encryptJSON(valid, encKey) as any,
            notes: await encryptField(prescNotes.trim() || null, encKey),
            record_id: prescRecordId,
        });
        setShowPrescModal(false);
        setSubmitting(false);
    };
    const handleDeletePresc = async () => { if (!selectedPresc) return; setSubmitting(true); await removePrescription(selectedPresc.id); setShowDeletePrescConfirm(false); setSelectedPresc(null); setSubmitting(false); };

    // Exam actions
    const openNewExam = (recordId: string) => { setExamRecordId(recordId); setExamDoctorId(doctors[0]?.id || ''); setExamItems([emptyExam()]); setExamIndication(''); setExamNotes(''); setShowExamModal(true); };
    const handleExamSubmit = async () => {
        if (!selectedPatient || !encKey) return;
        const valid = examItems.filter(e => e.name.trim());
        if (!valid.length) return;
        setSubmitting(true);
        await createExamRequest({
            patient_id: selectedPatient.id,
            doctor_id: examDoctorId || null,
            exams: await encryptJSON(valid, encKey) as any,
            clinical_indication: await encryptField(examIndication.trim() || null, encKey),
            notes: await encryptField(examNotes.trim() || null, encKey),
            record_id: examRecordId,
        });
        setShowExamModal(false);
        setSubmitting(false);
    };
    const handleDeleteExam = async () => { if (!selectedExam) return; setSubmitting(true); await removeExamRequest(selectedExam.id); setShowDeleteExamConfirm(false); setSelectedExam(null); setSubmitting(false); };

    const updateMed = (i: number, f: keyof PrescriptionMed, v: string) => setPrescMeds(p => p.map((m, idx) => idx === i ? { ...m, [f]: v } : m));
    const updateExamItem = (i: number, f: keyof ExamItem, v: string) => setExamItems(p => p.map((e, idx) => idx === i ? { ...e, [f]: v } : e));

    const typeConfig: Record<string, { label: string; dotColor: string; badgeClass: string }> = {
        consulta:      { label: 'Consulta',      dotColor: 'border-teal-500',   badgeClass: 'bg-teal-50 text-teal-700 border-teal-100' },
        retorno:       { label: 'Retorno',        dotColor: 'border-teal-400',   badgeClass: 'bg-teal-50 text-teal-600 border-teal-100' },
        exame:         { label: 'Exame',          dotColor: 'border-blue-500',   badgeClass: 'bg-blue-50 text-blue-700 border-blue-100' },
        procedimento:  { label: 'Procedimento',   dotColor: 'border-violet-500', badgeClass: 'bg-violet-50 text-violet-700 border-violet-100' },
    };

    const isLoading = recordsLoading || prescLoading || examLoading;

    if (patientsLoading && patients.length === 0) {
        return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
    }

    return (
        <div className="flex h-full gap-6 overflow-hidden">
            {/* Sidebar */}
            <div className="w-72 flex flex-col gap-4 h-full shrink-0">
                <Button variant="outline" className="w-full justify-start h-11 px-4 gap-2 border-dashed border-teal-200 hover:border-teal-400 hover:bg-teal-50 text-teal-700 font-bold" onClick={handleOpenCreatePatient}>
                    <Plus className="w-4 h-4" /> Novo Paciente
                </Button>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" placeholder="Buscar paciente..." className="w-full pl-10 pr-4 py-2.5 bg-white rounded-lg border border-slate-200 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 outline-none font-bold text-slate-700 placeholder:text-slate-400 text-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                    {filteredPatients.map(patient => (
                        <motion.button key={patient.id} whileHover={{ x: 3 }} onClick={() => setSelectedPatient(patient)} className={cn("w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all", selectedPatient?.id === patient.id ? "bg-white border-teal-200 shadow-sm" : "bg-white/50 border-transparent hover:bg-white hover:border-slate-200")}>
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600 uppercase">{getInitials(patient.name)}</div>
                            <div className="flex-1 overflow-hidden">
                                <p className="font-bold text-slate-700 text-sm truncate">{patient.name}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5 truncate">{patient.phone || 'Sem telefone'}</p>
                            </div>
                        </motion.button>
                    ))}
                </div>
            </div>

            {/* Detail */}
            {selectedPatient ? (
                <div className="flex-1 overflow-y-auto pr-2 pb-8 custom-scrollbar space-y-4">
                    {/* Patient card */}
                    <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
                        <CardContent className="p-6">
                            <div className="flex flex-col md:flex-row gap-6 items-start">
                                <div className="w-24 h-24 bg-slate-100 rounded-xl flex items-center justify-center text-2xl font-bold text-slate-600 border border-slate-200 shrink-0 uppercase">{getInitials(selectedPatient.name)}</div>
                                <div className="flex-1 space-y-4 w-full">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h2 className="text-2xl font-bold text-slate-900">{selectedPatient.name}</h2>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <span className="bg-emerald-50 text-emerald-700 px-3 py-0.5 rounded-md text-[10px] font-bold border border-emerald-100 uppercase">{selectedPatient.is_active ? 'Ativo' : 'Inativo'}</span>
                                                {selectedPatient.cpf && <span className="bg-teal-50 text-teal-700 px-3 py-0.5 rounded-md text-[10px] font-bold border border-teal-100 uppercase">CPF: {selectedPatient.cpf}</span>}
                                                {selectedPatient.allergies?.length > 0 && <span className="bg-rose-50 text-rose-700 px-3 py-0.5 rounded-md text-[10px] font-bold border border-rose-100 uppercase">⚠ {selectedPatient.allergies.join(', ')}</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="secondary" size="sm" className="h-8 font-bold text-[10px] uppercase" onClick={handleOpenEditPatient}>Editar</Button>
                                            <Button variant="outline" size="sm" className="h-8 font-bold text-[10px] uppercase text-rose-500 border-rose-100 hover:bg-rose-50" onClick={() => setShowDeletePatientConfirm(true)}>Excluir</Button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                        {[
                                            { icon: User, label: "Nome Completo", val: selectedPatient.name },
                                            { icon: Calendar, label: "Nascimento", val: selectedPatient.birth_date ? new Date(selectedPatient.birth_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—' },
                                            { icon: User, label: "Gênero", val: selectedPatient.gender || '—' },
                                            { icon: FileText, label: "CPF", val: selectedPatient.cpf || '—' },
                                        ].map(it => (
                                            <div key={it.label} className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                                <it.icon className="w-4 h-4 text-teal-600 mx-auto mb-1" />
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{it.label}</p>
                                                <p className="text-sm font-bold text-slate-900 capitalize truncate">{it.val}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                        <AnimatePresence>
                            {showDeletePatientConfirm && (
                                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white/95 z-20 flex flex-col items-center justify-center p-6 text-center">
                                    <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
                                    <h4 className="text-lg font-bold text-slate-900 mb-1">Deseja excluir este paciente?</h4>
                                    <p className="text-sm text-slate-500 mb-6">Todos os prontuários serão removidos. Esta ação é irreversível.</p>
                                    <div className="flex gap-4">
                                        <Button variant="outline" className="px-8 font-bold" onClick={() => setShowDeletePatientConfirm(false)}>Cancelar</Button>
                                        <Button className="px-8 font-bold bg-rose-600 hover:bg-rose-700" onClick={handleDeletePatient} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Confirmar</Button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </Card>

                    {/* Timeline */}
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-bold text-slate-700 flex items-center gap-2"><History className="w-4 h-4 text-teal-600" /> Linha do Tempo</h3>
                        <Button onClick={handleOpenCreateRecord} size="sm" className="h-8 font-bold text-[10px] uppercase gap-1.5 bg-teal-600 hover:bg-teal-700">
                            <Plus className="w-3.5 h-3.5" /> Nova Consulta
                        </Button>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>
                    ) : decRecords.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-slate-200 border-dashed">
                            <FileText className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                            <p className="font-bold text-lg text-slate-600">Nenhum registro</p>
                            <p className="text-sm mt-1">Clique em "Nova Consulta" para iniciar o prontuário.</p>
                        </div>
                    ) : (
                        <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 before:rounded-full">
                            {decRecords.map((item) => {
                                const cfg = typeConfig[item.type] || typeConfig.consulta;
                                const doc = doctors.find(d => d.id === item.doctor_id);
                                return (
                                    <motion.div key={item.id} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="relative group">
                                        <div className={cn("absolute -left-[22px] top-4 w-4 h-4 rounded-full bg-white border-2 transition-transform group-hover:scale-110 z-10", cfg.dotColor)} />
                                        <Card className="border border-slate-200 shadow-sm group-hover:shadow-md transition-all">
                                            <CardContent className="p-5">
                                                {/* Header */}
                                                <div className="flex justify-between items-start mb-3">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-black uppercase border", cfg.badgeClass)}>{cfg.label}</span>
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{format(parseISO(item.created_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</span>
                                                        {doc && <span className="text-[10px] font-bold text-slate-500 flex items-center gap-0.5"><Stethoscope className="w-3 h-3 text-teal-500" /> {doc.name}</span>}
                                                    </div>
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => handleOpenEditRecord(item)} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md"><Edit2 className="w-3.5 h-3.5" /></button>
                                                        <button onClick={() => { setSelectedRecord(item); setShowDeleteRecordConfirm(true); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md"><Trash2 className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                </div>

                                                {/* Sinais vitais */}
                                                {(item.weight || item.height || item.blood_pressure || item.temperature) && (
                                                    <div className="flex flex-wrap gap-2 mb-3">
                                                        {item.weight && <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[11px] font-bold text-blue-700"><Scale className="w-3 h-3" />{item.weight} kg</span>}
                                                        {item.height && <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-100 rounded-lg text-[11px] font-bold text-blue-700"><Ruler className="w-3 h-3" />{item.height} m</span>}
                                                        {item.blood_pressure && <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 border border-rose-100 rounded-lg text-[11px] font-bold text-rose-700"><Heart className="w-3 h-3" />{item.blood_pressure} mmHg</span>}
                                                        {item.temperature && <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-100 rounded-lg text-[11px] font-bold text-amber-700"><Thermometer className="w-3 h-3" />{item.temperature} °C</span>}
                                                    </div>
                                                )}

                                                {/* Content */}
                                                {item.description && <p className="text-slate-600 text-sm leading-relaxed mb-3 whitespace-pre-wrap">{item.description}</p>}
                                                {(item.diagnosis || item.prescription) && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                                                        {item.diagnosis && <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100"><p className="text-[9px] font-bold text-slate-400 uppercase mb-0.5">Diagnóstico</p><p className="text-xs font-bold text-slate-700">{item.diagnosis}</p></div>}
                                                        {item.prescription && <div className="p-2.5 bg-teal-50/30 rounded-lg border border-teal-100/50"><p className="text-[9px] font-bold text-teal-600 uppercase mb-0.5">Prescrição (nota)</p><p className="text-xs font-bold text-teal-800">{item.prescription}</p></div>}
                                                    </div>
                                                )}

                                                {/* Nested docs */}
                                                <RecordPrescriptions
                                                    recordId={item.id}
                                                    prescriptions={decPrescriptions}
                                                    examRequests={decExamRequests}
                                                    doctors={doctors}
                                                    patient={selectedPatient}
                                                    clinicName={clinicName}
                                                    onAddPresc={openNewPresc}
                                                    onAddExam={openNewExam}
                                                    onDeletePresc={p => { setSelectedPresc(p); setShowDeletePrescConfirm(true); }}
                                                    onDeleteExam={e => { setSelectedExam(e); setShowDeleteExamConfirm(true); }}
                                                />
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                );
                            })}
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-white rounded-xl border border-slate-200">
                    <User className="w-16 h-16 mb-4 text-slate-200" />
                    <h3 className="text-xl font-bold text-slate-900">Selecione um Paciente</h3>
                    <p className="text-sm mt-1 max-w-xs text-center font-medium">Escolha um paciente na lista ao lado para visualizar o prontuário.</p>
                </div>
            )}

            {/* ── Patient Modal ── */}
            <PatientModal isOpen={showPatientModal} onClose={() => setShowPatientModal(false)} onSuccess={handlePatientSuccess} initialData={selectedPatient} mode={patientModalMode} />

            {/* ── Record Modal ── */}
            <AnimatePresence>
                {showRecordModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowRecordModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-6 border-b border-slate-100">
                                <h3 className="text-lg font-bold">{selectedRecord ? 'Editar Registro' : 'Nova Consulta'}</h3>
                                <button onClick={() => setShowRecordModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                            </div>
                            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Tipo</label>
                                        <select value={recordFormData.type} onChange={e => setRecordFormData(p => ({ ...p, type: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm">
                                            <option value="consulta">Consulta</option>
                                            <option value="retorno">Retorno</option>
                                            <option value="exame">Exame</option>
                                            <option value="procedimento">Procedimento</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Médico *</label>
                                        <select value={recordFormData.doctor_id} onChange={e => setRecordFormData(p => ({ ...p, doctor_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm">
                                            <option value="">Selecione</option>
                                            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {/* Sinais vitais */}
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Sinais Vitais / Medidas</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Peso (kg)</label>
                                            <input type="text" value={recordFormData.weight} onChange={e => setRecordFormData(p => ({ ...p, weight: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="ex: 90" />
                                        </div>
                                        <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Altura (m)</label>
                                            <input type="text" value={recordFormData.height} onChange={e => setRecordFormData(p => ({ ...p, height: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="ex: 1.80" />
                                        </div>
                                        <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Pressão (mmHg)</label>
                                            <input type="text" value={recordFormData.blood_pressure} onChange={e => setRecordFormData(p => ({ ...p, blood_pressure: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="ex: 120/80" />
                                        </div>
                                        <div>
                                            <label className="block text-[9px] font-bold text-slate-400 uppercase mb-1">Temperatura (°C)</label>
                                            <input type="text" value={recordFormData.temperature} onChange={e => setRecordFormData(p => ({ ...p, temperature: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="ex: 36.5" />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Evolução / Descrição *</label>
                                    <textarea rows={5} value={recordFormData.description} onChange={e => setRecordFormData(p => ({ ...p, description: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm resize-none" placeholder="Descreva os sintomas, observações e anamnese..." />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-teal-600 uppercase mb-1.5">Diagnóstico</label>
                                        <input type="text" value={recordFormData.diagnosis} onChange={e => setRecordFormData(p => ({ ...p, diagnosis: e.target.value }))} className="w-full px-4 py-2.5 bg-teal-50/30 border border-teal-100 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="CID-10 ou nome da patologia" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Nota de Prescrição</label>
                                        <input type="text" value={recordFormData.prescription} onChange={e => setRecordFormData(p => ({ ...p, prescription: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm" placeholder="Anotação rápida" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                                <Button variant="outline" className="flex-1 font-bold" onClick={() => setShowRecordModal(false)}>Cancelar</Button>
                                <Button className="flex-1 font-bold bg-teal-600 hover:bg-teal-700" onClick={handleRecordSubmit} disabled={!recordFormData.description || !recordFormData.doctor_id || submitting}>
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : selectedRecord ? <Edit2 className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                                    {selectedRecord ? 'Atualizar' : 'Salvar Consulta'}
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Record Delete ── */}
            <AnimatePresence>
                {showDeleteRecordConfirm && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteRecordConfirm(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="p-6 text-center">
                                <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" />
                                <h3 className="text-lg font-bold mb-2">Excluir Registro</h3>
                                <p className="text-slate-500 text-sm">Todos os documentos vinculados (receitas e exames) também serão excluídos.</p>
                            </div>
                            <div className="flex gap-3 p-6 border-t bg-slate-50">
                                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteRecordConfirm(false)}>Cancelar</Button>
                                <Button variant="destructive" className="flex-1" onClick={handleDeleteRecord} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}Excluir</Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Prescription Modal ── */}
            <AnimatePresence>
                {showPrescModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPrescModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-6 border-b border-slate-100">
                                <div><h3 className="text-lg font-bold">Receituário</h3><p className="text-xs text-slate-400 mt-0.5">{selectedPatient?.name}</p></div>
                                <button onClick={() => setShowPrescModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                            </div>
                            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Médico Responsável</label>
                                    <select value={prescDoctorId} onChange={e => setPrescDoctorId(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm">
                                        <option value="">Sem médico</option>
                                        {doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.crm ? ` — CRM ${d.crm}` : ''}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Medicamentos *</label>
                                        <button onClick={() => setPrescMeds(p => [...p, emptyMed()])} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
                                    </div>
                                    <div className="space-y-3">
                                        {prescMeds.map((med, idx) => (
                                            <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-black text-teal-600 uppercase">Medicamento {idx + 1}</span>
                                                    {prescMeds.length > 1 && <button onClick={() => setPrescMeds(p => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <input value={med.name} onChange={e => updateMed(idx, 'name', e.target.value)} placeholder="Nome do medicamento *" className="col-span-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-200" />
                                                    <input value={med.dosage} onChange={e => updateMed(idx, 'dosage', e.target.value)} placeholder="Dosagem (ex: 500mg)" className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-200" />
                                                    <input value={med.quantity} onChange={e => updateMed(idx, 'quantity', e.target.value)} placeholder="Quantidade (ex: 1 caixa)" className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-200" />
                                                    <input value={med.instructions} onChange={e => updateMed(idx, 'instructions', e.target.value)} placeholder="Posologia (ex: 1 comprimido a cada 8h)" className="col-span-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-200" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Observações</label>
                                    <textarea rows={2} value={prescNotes} onChange={e => setPrescNotes(e.target.value)} placeholder="Ex: Retornar em 30 dias..." className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 text-sm resize-none" />
                                </div>
                            </div>
                            <div className="flex gap-3 p-6 border-t bg-slate-50">
                                <Button variant="outline" className="flex-1" onClick={() => setShowPrescModal(false)}>Cancelar</Button>
                                <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={handlePrescSubmit} disabled={submitting || prescMeds.every(m => !m.name.trim())}>
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ClipboardList className="w-4 h-4 mr-2" />} Emitir Receita
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Prescription Delete ── */}
            <AnimatePresence>
                {showDeletePrescConfirm && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeletePrescConfirm(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="p-6 text-center"><AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" /><h3 className="text-lg font-bold mb-1">Excluir Receita</h3><p className="text-slate-500 text-sm">Esta ação não pode ser desfeita.</p></div>
                            <div className="flex gap-3 p-6 border-t bg-slate-50">
                                <Button variant="outline" className="flex-1" onClick={() => setShowDeletePrescConfirm(false)}>Cancelar</Button>
                                <Button variant="destructive" className="flex-1" onClick={handleDeletePresc} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}Excluir</Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Exam Modal ── */}
            <AnimatePresence>
                {showExamModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowExamModal(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-6 border-b border-slate-100">
                                <div><h3 className="text-lg font-bold">Pedido de Exames</h3><p className="text-xs text-slate-400 mt-0.5">{selectedPatient?.name}</p></div>
                                <button onClick={() => setShowExamModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
                            </div>
                            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Médico Solicitante</label>
                                    <select value={examDoctorId} onChange={e => setExamDoctorId(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 font-bold text-sm">
                                        <option value="">Sem médico</option>
                                        {doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.crm ? ` — CRM ${d.crm}` : ''}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Exames *</label>
                                        <button onClick={() => setExamItems(p => [...p, emptyExam()])} className="flex items-center gap-1 text-xs font-bold text-teal-600 hover:text-teal-700"><Plus className="w-3.5 h-3.5" /> Adicionar</button>
                                    </div>
                                    <div className="space-y-2">
                                        {examItems.map((exam, idx) => (
                                            <div key={idx} className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                                                <FlaskConical className="w-4 h-4 text-indigo-500 shrink-0" />
                                                <input value={exam.name} onChange={e => updateExamItem(idx, 'name', e.target.value)} placeholder="Nome do exame *" className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-200" />
                                                <select value={exam.type} onChange={e => updateExamItem(idx, 'type', e.target.value)} className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none">
                                                    <option value="laboratorial">Laboratorial</option>
                                                    <option value="imagem">Imagem</option>
                                                    <option value="funcional">Funcional</option>
                                                    <option value="outro">Outro</option>
                                                </select>
                                                <select value={exam.urgency} onChange={e => updateExamItem(idx, 'urgency', e.target.value)} className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none">
                                                    <option value="rotina">Rotina</option>
                                                    <option value="urgente">Urgente</option>
                                                </select>
                                                {examItems.length > 1 && <button onClick={() => setExamItems(p => p.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-500 shrink-0"><X className="w-4 h-4" /></button>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Indicação Clínica</label>
                                    <textarea rows={2} value={examIndication} onChange={e => setExamIndication(e.target.value)} placeholder="Hipótese diagnóstica..." className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 text-sm resize-none" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Observações</label>
                                    <textarea rows={2} value={examNotes} onChange={e => setExamNotes(e.target.value)} placeholder="Ex: Jejum de 12h obrigatório..." className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200 text-sm resize-none" />
                                </div>
                            </div>
                            <div className="flex gap-3 p-6 border-t bg-slate-50">
                                <Button variant="outline" className="flex-1" onClick={() => setShowExamModal(false)}>Cancelar</Button>
                                <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={handleExamSubmit} disabled={submitting || examItems.every(e => !e.name.trim())}>
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FlaskConical className="w-4 h-4 mr-2" />} Emitir Pedido
                                </Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* ── Exam Delete ── */}
            <AnimatePresence>
                {showDeleteExamConfirm && (
                    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteExamConfirm(false)}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="p-6 text-center"><AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" /><h3 className="text-lg font-bold mb-1">Excluir Pedido de Exames</h3><p className="text-slate-500 text-sm">Esta ação não pode ser desfeita.</p></div>
                            <div className="flex gap-3 p-6 border-t bg-slate-50">
                                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteExamConfirm(false)}>Cancelar</Button>
                                <Button variant="destructive" className="flex-1" onClick={handleDeleteExam} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}Excluir</Button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ─── Gate de autenticação ─────────────────────────────────────────────────────
export function MedicalRecords() {
    const { profile, activeClinicId } = useAuth();

    const [authorized, setAuthorized] = useState(false);
    const [encKey, setEncKey] = useState<CryptoKey | null>(null);

    useEffect(() => {
        if (!activeClinicId || !profile?.id) return;
        const stored = sessionStorage.getItem(`prontuario_enc_${activeClinicId}_${profile.id}`);
        if (stored) {
            importKey(stored)
                .then(key => { setEncKey(key); setAuthorized(true); })
                .catch(() => {});
        }
    }, [activeClinicId, profile?.id]);

    const handleAuthorized = async (email: string, key: CryptoKey) => {
        const b64 = await exportKey(key);
        sessionStorage.setItem(`prontuario_enc_${activeClinicId}_${profile?.id}`, b64);
        setEncKey(key);
        setAuthorized(true);
    };

    if (authorized && encKey) {
        return <MedicalRecordsContent encKey={encKey} />;
    }

    return <ProntuarioPasswordModal onAuthorized={handleAuthorized} />;
}
