import React, { useState } from 'react';
import { useClinics, Clinic } from '../hooks/useSupabase';
import { 
  Building2, 
  Plus, 
  Search, 
  Settings2, 
  Users, 
  Activity,
  ChevronRight,
  ShieldCheck,
  MoreVertical,
  Edit2,
  Trash2
} from 'lucide-react';

export default function SuperAdmin() {
  const { data: clinics, loading, create, update } = useClinics();
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newClinic, setNewClinic] = useState<Partial<Clinic>>({
    name: '',
    plan: 'pro'
  });

  const filteredClinics = clinics.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await create(newClinic);
    if (!error) {
      setShowModal(false);
      setNewClinic({ name: '', plan: 'pro' });
    } else {
      alert('Erro ao criar clínica: ' + error.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Painel Super Admin</h1>
          <p className="text-sm text-slate-500">Gerencie todas as clínicas e acessos do sistema.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Nova Clínica
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-teal-50 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total de Clínicas</p>
            <p className="text-2xl font-bold text-slate-900">{clinics.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Contas Ativas</p>
            <p className="text-2xl font-bold text-slate-900">{clinics.filter(c => c.plan !== 'free').length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
            <Activity className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Status Sistema</p>
            <p className="text-2xl font-bold text-teal-600">Online</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-50 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Buscar clínica por nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                <th className="px-6 py-4">Clínica</th>
                <th className="px-6 py-4">Plano</th>
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClinics.map((clinic) => (
                <tr key={clinic.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Building2 className="w-4 h-4 text-slate-500" />
                      </div>
                      <span className="font-medium text-slate-900">{clinic.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium uppercase ${
                      clinic.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                      clinic.plan === 'pro' ? 'bg-teal-100 text-teal-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {clinic.plan}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">
                    {clinic.id}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 text-slate-400 hover:text-teal-600 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-slate-400 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Nova Clínica</h3>
              <p className="text-sm text-slate-500">Cadastre uma nova organização no sistema.</p>
            </div>
            
            <form onSubmit={handleCreateClinic} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Clínica</label>
                <input 
                  type="text"
                  required
                  value={newClinic.name}
                  onChange={(e) => setNewClinic({...newClinic, name: e.target.value})}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  placeholder="Ex: Clínica Saúde Total"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plano</label>
                <select 
                  value={newClinic.plan}
                  onChange={(e) => setNewClinic({...newClinic, plan: e.target.value as any})}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium shadow-sm shadow-teal-100"
                >
                  Criar Clínica
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
