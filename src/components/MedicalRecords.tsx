import React, { useState } from "react";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import {
    Search,
    FileText,
    History,
    Plus,
    Upload,
    Download,
    ExternalLink,
    User,
    Calendar,
    Scale,
    Ruler,
    AlertCircle,
    Stethoscope,
    ChevronRight,
    MoreVertical,
    Filter
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";

const patients = [
    { id: 1, name: "Carlos A. Santos", age: "45 anos", weight: "78kg", height: "175cm", lastVisit: "2024-02-15", initials: "CS", doctorId: "medico-1" },
    { id: 2, name: "Ana M. Oliveira", age: "32 anos", weight: "62kg", height: "165cm", lastVisit: "2024-02-20", initials: "AO", doctorId: "medico-2" },
    { id: 3, name: "Lucas F. Lima", age: "58 anos", weight: "85kg", height: "180cm", lastVisit: "2024-02-10", initials: "LL", doctorId: "medico-1" },
];

const medicalHistory = [
    {
        id: 101,
        date: "2024-02-15",
        type: "Consulta de Rotina",
        doctor: "Dr. Carlos Eduardo",
        note: "Paciente apresenta quadro clínico estável. Exames laboratoriais dentro dos parâmetros normais. Recomendada manutenção da dieta e atividade física.",
        status: "Finalizado"
    },
    {
        id: 102,
        date: "2024-01-10",
        type: "Infecção Respiratória",
        doctor: "Dra. Julia Souza",
        note: "Febre baixa e tosse persistente. Prescrito antibiótico e repouso por 5 dias. Retorno em 7 dias para reavaliação.",
        status: "Finalizado"
    },
    {
        id: 103,
        date: "2023-11-05",
        type: "Check-up Semestral",
        doctor: "Dr. Carlos Eduardo",
        note: "Exames de rotina realizados. Hemograma, glicemia e perfil lipídico normais. Próximo retorno em 6 meses.",
        status: "Finalizado"
    },
];

export function MedicalRecords() {
    const { userRole, clinicName } = useAuth();
    // Simulating logged doctor ID (e.g., Doctor 1 in Central Clinic)
    const loggedDoctorId = "medico-1";

    const filteredByRole = patients.filter(p => 
        userRole === 'medico' ? p.doctorId === loggedDoctorId : true
    );

    const [selectedPatient, setSelectedPatient] = useState(filteredByRole[0] || patients[0]);
    const [searchTerm, setSearchTerm] = useState("");

    const filteredPatients = filteredByRole.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="flex h-full gap-6 overflow-hidden">
            {/* Sidebar - Patient List */}
            <div className="w-72 flex flex-col gap-4 h-full shrink-0">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-teal-600 transition-colors" />
                    <input
                        type="text"
                        placeholder="Buscar paciente..."
                        className="w-full pl-10 pr-4 py-2.5 bg-white rounded-lg border border-slate-200 focus:border-teal-300 focus:ring-2 focus:ring-teal-100 outline-none font-medium text-slate-700 placeholder:text-slate-400 transition-all text-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                    {filteredPatients.map((patient) => (
                        <motion.button
                            key={patient.id}
                            whileHover={{ x: 3 }}
                            onClick={() => setSelectedPatient(patient)}
                            className={cn(
                                "w-full flex items-center gap-3 p-3 rounded-lg transition-all border",
                                selectedPatient.id === patient.id
                                    ? "bg-white border-teal-200 shadow-sm"
                                    : "bg-white/50 border-transparent hover:bg-white hover:border-slate-200"
                            )}
                        >
                            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-sm font-bold text-slate-600">
                                {patient.initials}
                            </div>
                            <div className="text-left">
                                <p className="font-semibold text-slate-700 text-sm leading-tight">{patient.name}</p>
                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-0.5">{patient.id.toString().padStart(4, '0')}</p>
                            </div>
                        </motion.button>
                    ))}
                </div>

                <Button className="w-full py-5 gap-2">
                    <Plus className="w-5 h-5" />
                    Novo Prontuário
                </Button>
            </div>

            {/* Main Content - Patient Detail */}
            <div className="flex-1 overflow-y-auto pr-2 pb-8 custom-scrollbar space-y-6">
                {/* Patient Profile Header */}
                <Card className="border border-slate-200 shadow-sm">
                    <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row gap-6 items-start">
                            <div className="w-24 h-24 bg-slate-100 rounded-xl flex items-center justify-center text-2xl font-bold text-slate-600 border border-slate-200">
                                {selectedPatient.initials}
                            </div>
                            <div className="flex-1 space-y-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-slate-900 leading-tight">{selectedPatient.name}</h2>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <span className="bg-teal-50 text-teal-700 px-3 py-0.5 rounded-md text-xs font-semibold border border-teal-100">ID: {selectedPatient.id.toString().padStart(4, '0')}</span>
                                        <span className="bg-emerald-50 text-emerald-700 px-3 py-0.5 rounded-md text-xs font-semibold border border-emerald-100">Ativo</span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <User className="w-4 h-4 text-teal-600 mx-auto mb-1" />
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mb-0.5">Idade</p>
                                        <p className="text-base font-bold text-slate-900">{selectedPatient.age}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <Scale className="w-4 h-4 text-teal-600 mx-auto mb-1" />
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mb-0.5">Peso</p>
                                        <p className="text-base font-bold text-slate-900">{selectedPatient.weight}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <Ruler className="w-4 h-4 text-teal-600 mx-auto mb-1" />
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mb-0.5">Altura</p>
                                        <p className="text-base font-bold text-slate-900">{selectedPatient.height}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-center">
                                        <Calendar className="w-4 h-4 text-teal-600 mx-auto mb-1" />
                                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider leading-none mb-0.5">Última Visita</p>
                                        <p className="text-base font-bold text-slate-900">{format(new Date(selectedPatient.lastVisit), 'dd/MM/yy')}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="icon" className="rounded-lg w-10 h-10">
                                    <ExternalLink className="w-4 h-4 text-slate-400" />
                                </Button>
                                <Button variant="secondary" size="icon" className="rounded-lg w-10 h-10">
                                    <MoreVertical className="w-4 h-4 text-slate-400" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Timeline & Notes */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                                <History className="w-5 h-5 text-teal-600" />
                                Histórico Clínico
                            </h3>
                            <Button variant="ghost" className="text-teal-600 font-semibold gap-2 hover:bg-teal-50 rounded-lg px-4 text-sm">
                                <Filter className="w-4 h-4" />
                                Filtrar
                            </Button>
                        </div>

                        <div className="space-y-4 relative pl-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 before:rounded-full">
                            {medicalHistory.map((item, i) => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="relative group pb-1"
                                >
                                    <div className="absolute -left-[22px] top-2 w-4 h-4 rounded-full bg-white border-2 border-teal-600 transition-transform group-hover:scale-110 z-10" />
                                    <Card className="border border-slate-200 shadow-sm group-hover:shadow-md transition-all">
                                        <CardContent className="p-5">
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{format(new Date(item.date), 'dd MMMM yyyy', { locale: ptBR })}</p>
                                                    <h4 className="text-base font-bold text-slate-900 mt-1">{item.type}</h4>
                                                </div>
                                                <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md text-[10px] font-semibold border border-emerald-100 uppercase tracking-wider">{item.status}</span>
                                            </div>
                                            <p className="text-slate-500 font-medium text-sm leading-relaxed mb-3">
                                                {item.note}
                                            </p>
                                            <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                                                <div className="w-7 h-7 rounded-md bg-teal-50 flex items-center justify-center text-teal-600">
                                                    <Stethoscope className="w-3.5 h-3.5" />
                                                </div>
                                                <span className="text-sm font-medium text-slate-400">Atendido por: <span className="text-slate-700">{item.doctor}</span></span>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Right Column - Secondary Actions */}
                    <div className="space-y-6">
                        <Card className="border border-slate-200 shadow-sm bg-slate-900 p-6 overflow-hidden relative">
                            <div className="relative z-10 space-y-4">
                                <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center">
                                    <AlertCircle className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h4 className="text-xl font-bold text-white leading-tight">Alergias & Alertas</h4>
                                    <p className="text-white/60 font-medium mt-1 text-sm">Nenhuma alergia registrada.</p>
                                </div>
                                <Button className="w-full bg-white text-slate-900 hover:bg-white/90 font-semibold h-10 shadow-sm">
                                    Adicionar Alerta
                                </Button>
                            </div>
                        </Card>

                        <Card className="border border-slate-200 shadow-sm">
                            <CardContent className="p-6 space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-base font-bold text-slate-900">Exames</h4>
                                    <Button variant="ghost" size="icon" className="rounded-lg bg-slate-50 hover:bg-slate-100">
                                        <Plus className="w-4 h-4 text-teal-600" />
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    {[
                                        { name: "Exame de Sangue.pdf", size: "1.2 MB", date: "15/02" },
                                        { name: "Raio-X Tórax.png", size: "3.5 MB", date: "10/01" }
                                    ].map((doc, i) => (
                                        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 group hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-slate-200">
                                            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center text-rose-400 shadow-sm">
                                                <FileText className="w-5 h-5" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-slate-700 truncate text-sm">{doc.name}</p>
                                                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{doc.size} • {doc.date}</p>
                                            </div>
                                            <Button variant="ghost" size="icon" className="rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Download className="w-4 h-4 text-teal-600" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-2">
                                    <Button variant="outline" className="w-full border-2 border-dashed border-slate-200 hover:border-teal-300 bg-slate-50/50 hover:bg-teal-50/30 rounded-lg py-6 flex flex-col gap-1 h-auto text-teal-600 font-semibold">
                                        <Upload className="w-5 h-5" />
                                        Enviar arquivos
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
