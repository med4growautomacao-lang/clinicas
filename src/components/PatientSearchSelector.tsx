import React, { useState, useMemo, useRef, useEffect } from "react";
import { useAnchoredPosition } from "../hooks/useAnchoredPosition";
import { matchesSearch } from "../lib/search";
import { Search, X, User, Phone, Fingerprint, Plus, Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Patient, Lead } from "../hooks/useSupabase";

interface PatientSearchSelectorProps {
  patients: Patient[];
  selectedId: string;
  onSelect: (patient: Patient) => void;
  onNewPatient: () => void;
  lastCreatedPatient?: Patient | null;
  leads?: Lead[];
  onSelectLead?: (lead: Lead) => void;
}

export function PatientSearchSelector({
  patients,
  selectedId,
  onSelect,
  onNewPatient,
  lastCreatedPatient,
  leads = [],
  onSelectLead,
}: PatientSearchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const allPatients = useMemo(() => {
    const list = [...patients];
    if (lastCreatedPatient && !list.find(p => p.id === lastCreatedPatient.id)) {
      list.unshift(lastCreatedPatient);
    }
    return list;
  }, [patients, lastCreatedPatient]);

  const selectedPatient = useMemo(() => {
    return allPatients.find(p => p.id === selectedId);
  }, [allPatients, selectedId]);

  const filteredPatients = useMemo(() => {
    if (!searchTerm) return allPatients.slice(0, 8);
    return allPatients.filter(p =>
      matchesSearch(searchTerm, { name: p.name, cpf: p.cpf, phone: p.phone }, ['cpf', 'phone'])
    ).slice(0, 8);
  }, [allPatients, searchTerm]);

  const filteredLeads = useMemo(() => {
    if (!leads.length || !onSelectLead) return [];
    const patientIds = new Set(allPatients.map(p => p.id));
    const unlinkedLeads = leads.filter(l => !l.converted_patient_id || !patientIds.has(l.converted_patient_id));
    if (!searchTerm) return unlinkedLeads.slice(0, 5);
    return unlinkedLeads.filter(l =>
      matchesSearch(searchTerm, { name: l.name, email: l.email, phone: l.phone }, ['phone'])
    ).slice(0, 5);
  }, [leads, allPatients, searchTerm, onSelectLead]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Lista `fixed` ancorada no campo: dentro de um modal com corpo rolável, uma
  // lista `absolute` seria cortada pelo overflow do container. As deps
  // reposicionam quando o filtro muda a altura da lista.
  const pos = useAnchoredPosition(anchorRef, isOpen, {
    maxHeight: 360,
    flipBelow: 220,
    deps: [filteredPatients.length, filteredLeads.length],
  });

  return (
    <div className="relative" ref={containerRef}>
      <div
        ref={anchorRef}
        className={cn(
          "flex items-center gap-3 px-4 py-2.5 bg-slate-50 border rounded-lg transition-all cursor-text",
          isOpen ? "border-teal-400 ring-2 ring-teal-100 bg-white" : "border-slate-200"
        )}
        onClick={() => setIsOpen(true)}
      >
        <Search className={cn("w-4 h-4", isOpen ? "text-teal-500" : "text-slate-400")} />

        {selectedPatient && !isOpen ? (
          <div className="flex-1 flex items-center justify-between">
            <span className="font-bold text-slate-700 text-sm">
              {selectedPatient.name}
              {lastCreatedPatient?.id === selectedPatient.id && (
                <span className="ml-2 text-[10px] text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded uppercase">Novo</span>
              )}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ id: '' } as any);
                setSearchTerm("");
              }}
              className="p-1 hover:bg-slate-100 rounded-full text-slate-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <input
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400"
            placeholder="Buscar por nome, CPF, telefone ou lead..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsOpen(true)}
          />
        )}
      </div>

      <AnimatePresence>
        {isOpen && pos && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
            className="fixed bg-white border border-slate-100 rounded-xl shadow-2xl z-[210] py-2 flex flex-col"
          >
            <div className="px-3 pb-2 pt-1">
              <button
                onClick={() => {
                  onNewPatient();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-teal-600 hover:bg-teal-50 rounded-lg transition-colors text-xs font-bold"
              >
                <Plus className="w-4 h-4" />
                Deseja cadastrar um novo paciente?
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar border-t border-slate-50">
              {/* Patients section */}
              {filteredPatients.length > 0 && (
                <>
                  {filteredLeads.length > 0 && (
                    <div className="px-4 pt-2 pb-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pacientes</span>
                    </div>
                  )}
                  {filteredPatients.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onSelect(p);
                        setIsOpen(false);
                        setSearchTerm("");
                      }}
                      className={cn(
                        "w-full px-4 py-3 flex flex-col items-start gap-1 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-none",
                        selectedId === p.id && "bg-teal-50/50"
                      )}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-bold text-slate-800 text-sm flex-1 truncate">{p.name}</span>
                        {lastCreatedPatient?.id === p.id && (
                          <span className="text-[10px] text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded uppercase font-bold">Novo</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                        {p.cpf && (
                          <span className="flex items-center gap-1.5">
                            <Fingerprint className="w-3 h-3" /> {p.cpf}
                          </span>
                        )}
                        {p.phone && (
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3" /> {p.phone}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Leads section */}
              {filteredLeads.length > 0 && (
                <>
                  <div className="px-4 pt-2 pb-1 border-t border-slate-50">
                    <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest flex items-center gap-1.5">
                      <Users className="w-3 h-3" /> Leads
                    </span>
                  </div>
                  {filteredLeads.map((lead) => (
                    <button
                      key={lead.id}
                      onClick={() => {
                        onSelectLead?.(lead);
                        setIsOpen(false);
                        setSearchTerm("");
                      }}
                      className="w-full px-4 py-3 flex flex-col items-start gap-1 hover:bg-amber-50/50 transition-colors text-left border-b border-slate-50 last:border-none"
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span className="font-bold text-slate-800 text-sm flex-1 truncate">{lead.name}</span>
                        <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">Lead</span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-tight text-slate-400">
                        {lead.phone && (
                          <span className="flex items-center gap-1.5">
                            <Phone className="w-3 h-3" /> {lead.phone}
                          </span>
                        )}
                        {lead.email && (
                          <span className="truncate max-w-[160px]">{lead.email}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </>
              )}

              {filteredPatients.length === 0 && filteredLeads.length === 0 && (
                <div className="px-4 py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                  <Search className="w-8 h-8 opacity-20" />
                  <p className="text-sm font-medium">Nenhum resultado encontrado.</p>
                </div>
              )}
            </div>

            <div className="px-4 py-2 border-t border-slate-50 bg-slate-50/50">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                {filteredPatients.length} paciente{filteredPatients.length !== 1 ? 's' : ''}{filteredLeads.length > 0 ? ` · ${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''}` : ''}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
