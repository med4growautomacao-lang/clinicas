import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap, Loader2, Play, Plus, Trash2, Edit3, ArrowUp, ArrowDown,
  UploadCloud, Link as LinkIcon, Eye, EyeOff, Search, X, Film,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { supabase } from '../lib/supabase';
import { useToast } from './ui/toast';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/modal';
import { matchesSearch } from '../lib/search';

// Módulo Tutoriais: vídeos que ensinam a usar a plataforma.
//
// Conteúdo GLOBAL (tabela `tutorials`, sem clinic_id): o Super Admin publica em
// Super Admin › System Settings › Tutoriais e todo usuário logado assiste na aba
// "Tutoriais". A RLS é quem barra a escrita — a tela só esconde o botão.
//
// Duas fontes de vídeo, e a diferença importa:
//   • arquivo enviado  -> vai para o bucket 'tutorials', `storage_path` preenchido
//                         (é esse campo que manda apagar o arquivo junto da linha);
//   • link externo     -> YouTube/Vimeo/Loom, `storage_path` NULO.
// O link externo não é luxo: o limite de upload do projeto é 50 MB, e vídeo de
// tela cheia passa disso com facilidade.

export const TUTORIAL_MAX_BYTES = 52428800; // 50 MB — teto global do Storage
const BUCKET = 'tutorials';

export interface Tutorial {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  storage_path: string | null;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── player ───────────────────────────────────────────────────────────────────

/**
 * Converte link de YouTube/Vimeo/Loom no endereço de embed.
 * Devolve null quando não é plataforma conhecida — aí o vídeo toca no <video>.
 */
export function embedUrl(url: string): string | null {
  const u = (url || '').trim();
  let m: RegExpMatchArray | null;

  m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;

  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;

  m = u.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  if (m) return `https://www.loom.com/embed/${m[1]}`;

  return null;
}

function VideoPlayer({ tutorial }: { tutorial: Tutorial }) {
  const embed = embedUrl(tutorial.video_url);
  return (
    <div className="relative w-full aspect-video bg-slate-900 rounded-2xl overflow-hidden shadow-sm">
      {embed ? (
        <iframe
          key={tutorial.id}
          src={embed}
          title={tutorial.title}
          className="absolute inset-0 w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <video
          key={tutorial.id}
          src={tutorial.video_url}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full"
        />
      )}
    </div>
  );
}

// ─── dados ────────────────────────────────────────────────────────────────────

/**
 * `includeInactive` só muda o filtro do lado do cliente: quem realmente decide o
 * que volta é a RLS (usuário comum nunca recebe tutorial desativado).
 */
export function useTutorials(includeInactive = false) {
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('tutorials')
      .select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data } = await q;
    setTutorials((data as Tutorial[]) || []);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => { fetch(); }, [fetch]);

  return { tutorials, loading, refetch: fetch };
}

// ─── visualização (módulo do usuário) ─────────────────────────────────────────

export function Tutorials() {
  const { tutorials, loading } = useTutorials();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => tutorials.filter(t => matchesSearch(search, { title: t.title, description: t.description || '' })),
    [tutorials, search],
  );

  // O primeiro da lista abre sozinho; se o filtro tirar o selecionado da tela,
  // pula para o primeiro que sobrou em vez de deixar o player órfão.
  const selected = filtered.find(t => t.id === selectedId) || filtered[0] || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-violet-600" /> Tutoriais
          </h1>
          <p className="text-sm text-slate-500">Vídeos curtos mostrando como usar cada parte da plataforma.</p>
        </div>
        {tutorials.length > 0 && (
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar tutorial..."
              className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        )}
      </div>

      {tutorials.length === 0 ? (
        <EmptyState
          title="Nenhum tutorial publicado ainda"
          hint="Assim que os vídeos forem publicados, eles aparecem aqui."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nada encontrado" hint="Tente outro termo de busca." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4 min-w-0">
            {selected && <VideoPlayer tutorial={selected} />}
            {selected && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-lg font-black text-slate-900">{selected.title}</h2>
                {selected.description && (
                  <p className="text-sm text-slate-600 mt-2 whitespace-pre-line leading-relaxed">
                    {selected.description}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden self-start">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {filtered.length} {filtered.length === 1 ? 'vídeo' : 'vídeos'}
              </p>
            </div>
            <div className="max-h-[560px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {filtered.map((t, i) => {
                const isActive = selected?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors',
                      isActive ? 'bg-teal-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                      isActive ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-400',
                    )}>
                      {isActive ? <Play className="w-4 h-4" /> : <span className="text-xs font-black">{i + 1}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className={cn('text-sm font-bold truncate', isActive ? 'text-teal-900' : 'text-slate-700')}>
                        {t.title}
                      </p>
                      {t.description && (
                        <p className="text-xs text-slate-400 line-clamp-2 mt-0.5">{t.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-16 text-center">
      <Film className="w-10 h-10 text-slate-200 mx-auto mb-3" />
      <p className="font-bold text-slate-700">{title}</p>
      <p className="text-sm text-slate-400 mt-1">{hint}</p>
    </div>
  );
}

// ─── gestão (Super Admin › System Settings › Tutoriais) ───────────────────────

type FormState = {
  id: string | null;
  title: string;
  description: string;
  mode: 'upload' | 'link';
  video_url: string;
  storage_path: string | null;
  is_active: boolean;
  file: File | null;
};

const EMPTY_FORM: FormState = {
  id: null, title: '', description: '', mode: 'upload',
  video_url: '', storage_path: null, is_active: true, file: null,
};

export function TutorialsAdminPanel() {
  const showToast = useToast();
  const { tutorials, loading, refetch } = useTutorials(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => (f ? { ...f, [k]: v } : f));

  const openNew = () => setForm({ ...EMPTY_FORM });
  const openEdit = (t: Tutorial) => setForm({
    id: t.id,
    title: t.title,
    description: t.description || '',
    mode: t.storage_path ? 'upload' : 'link',
    video_url: t.video_url,
    storage_path: t.storage_path,
    is_active: t.is_active,
    file: null,
  });

  // ── ordem ──
  // Reescreve a posição de TODAS as linhas a partir da ordem visual e grava só
  // as que mudaram. Guardar apenas o par trocado deixa buracos e empate quando o
  // banco já tem posição repetida (tudo nasce em 0 numa carga antiga).
  const move = async (index: number, delta: number) => {
    const alvo = index + delta;
    if (alvo < 0 || alvo >= tutorials.length) return;
    const nova = [...tutorials];
    [nova[index], nova[alvo]] = [nova[alvo], nova[index]];

    setBusyId(tutorials[index].id);
    const mudaram = nova
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => t.position !== i);
    for (const { t, i } of mudaram) {
      const { error } = await supabase.from('tutorials').update({ position: i }).eq('id', t.id);
      if (error) {
        setBusyId(null);
        showToast('Erro ao reordenar: ' + error.message, 'error');
        await refetch();
        return;
      }
    }
    setBusyId(null);
    await refetch();
  };

  const toggleActive = async (t: Tutorial) => {
    setBusyId(t.id);
    const { error } = await supabase.from('tutorials').update({ is_active: !t.is_active }).eq('id', t.id);
    setBusyId(null);
    if (error) return showToast('Erro ao alterar: ' + error.message, 'error');
    showToast(t.is_active ? 'Tutorial ocultado dos clientes.' : 'Tutorial publicado.', 'success');
    await refetch();
  };

  const remove = async (t: Tutorial) => {
    setBusyId(t.id);
    const { error } = await supabase.from('tutorials').delete().eq('id', t.id);
    if (error) {
      setBusyId(null);
      setConfirmingDelete(null);
      return showToast('Erro ao excluir: ' + error.message, 'error');
    }
    // Arquivo só sai DEPOIS que a linha saiu: falhar aqui deixa lixo no bucket,
    // falhar na ordem inversa deixaria um tutorial na lista sem vídeo nenhum.
    if (t.storage_path) {
      await supabase.storage.from(BUCKET).remove([t.storage_path]);
    }
    setBusyId(null);
    setConfirmingDelete(null);
    showToast('Tutorial excluído.', 'success');
    await refetch();
  };

  const pickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      return showToast('Selecione um arquivo de vídeo (MP4, WebM, MOV).', 'error');
    }
    if (file.size > TUTORIAL_MAX_BYTES) {
      return showToast(
        `Vídeo de ${(file.size / 1048576).toFixed(0)} MB. O limite de envio é 50 MB — use a opção "Link externo" (YouTube, Vimeo, Loom).`,
        'error',
      );
    }
    setForm(f => (f ? { ...f, file, title: f.title || file.name.replace(/\.[^.]+$/, '') } : f));
  };

  const save = async () => {
    if (!form) return;
    const title = form.title.trim();
    if (!title) return showToast('Dê um nome ao tutorial.', 'error');

    let videoUrl = form.video_url.trim();
    let storagePath = form.storage_path;
    const pathAntigo = form.storage_path;

    if (form.mode === 'link') {
      if (!/^https?:\/\//i.test(videoUrl)) {
        return showToast('Cole o link completo do vídeo (começando com https://).', 'error');
      }
      storagePath = null;
    } else if (!form.file && !form.storage_path) {
      // Sem arquivo novo e sem arquivo antigo: inclui o caso de trocar "Link
      // externo" por "Enviar arquivo" na edição e esquecer de escolher o vídeo.
      return showToast('Escolha o arquivo de vídeo.', 'error');
    }

    setSaving(true);

    if (form.mode === 'upload' && form.file) {
      const ext = (form.file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, form.file, { contentType: form.file.type || 'video/mp4', upsert: false });
      if (upErr) {
        setSaving(false);
        return showToast('Falha no envio do vídeo: ' + upErr.message, 'error');
      }
      videoUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      storagePath = path;
    }

    const payload = {
      title,
      description: form.description.trim() || null,
      video_url: videoUrl,
      storage_path: storagePath,
      is_active: form.is_active,
    };

    const { error } = form.id
      ? await supabase.from('tutorials').update(payload).eq('id', form.id)
      : await supabase.from('tutorials').insert({ ...payload, position: tutorials.length });

    if (error) {
      // Gravação falhou depois do upload: tira o arquivo recém-enviado, senão
      // ele fica no bucket sem nenhuma linha apontando para ele.
      if (storagePath && storagePath !== pathAntigo) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
      }
      setSaving(false);
      return showToast('Erro ao salvar: ' + error.message, 'error');
    }

    // Trocou o vídeo de um tutorial que já existia: o arquivo velho vira lixo.
    if (pathAntigo && pathAntigo !== storagePath) {
      await supabase.storage.from(BUCKET).remove([pathAntigo]);
    }

    setSaving(false);
    setForm(null);
    showToast(form.id ? 'Tutorial atualizado.' : 'Tutorial publicado.', 'success');
    await refetch();
  };

  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm';

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-violet-600" /> Tutoriais
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Os vídeos aparecem na aba "Tutoriais" de todos os clientes, na ordem definida aqui.
            </p>
          </div>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" /> Novo tutorial
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-7 h-7 text-teal-600 animate-spin" />
          </div>
        ) : tutorials.length === 0 ? (
          <div className="p-12 text-center">
            <Film className="w-9 h-9 text-slate-200 mx-auto mb-3" />
            <p className="font-bold text-slate-700">Nenhum tutorial cadastrado</p>
            <p className="text-sm text-slate-400 mt-1">Envie um vídeo ou cole um link do YouTube.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tutorials.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 p-4">
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || busyId !== null}
                    title="Subir"
                    className="p-1 rounded-md text-slate-400 hover:text-teal-600 hover:bg-teal-50 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === tutorials.length - 1 || busyId !== null}
                    title="Descer"
                    className="p-1 rounded-md text-slate-400 hover:text-teal-600 hover:bg-teal-50 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-8 text-center shrink-0">
                  {busyId === t.id
                    ? <Loader2 className="w-4 h-4 text-teal-600 animate-spin mx-auto" />
                    : <span className="text-xs font-black text-slate-300">{i + 1}</span>}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={cn('font-bold truncate', t.is_active ? 'text-slate-900' : 'text-slate-400 line-through')}>
                      {t.title}
                    </p>
                    <span className={cn(
                      'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full shrink-0',
                      t.storage_path ? 'bg-teal-50 text-teal-600' : 'bg-blue-50 text-blue-600',
                    )}>
                      {t.storage_path ? 'Arquivo' : 'Link'}
                    </span>
                    {!t.is_active && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                        Oculto
                      </span>
                    )}
                  </div>
                  {t.description && <p className="text-xs text-slate-400 truncate mt-0.5">{t.description}</p>}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(t)}
                    title={t.is_active ? 'Ocultar dos clientes' : 'Publicar'}
                    className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    {t.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => openEdit(t)}
                    title="Editar"
                    className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  {confirmingDelete === t.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => remove(t)}
                        className="px-2 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[11px] font-bold transition-colors"
                      >
                        Excluir
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete(t.id)}
                      title="Excluir"
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!form} onClose={() => !saving && setForm(null)} size="lg" closeOnBackdrop={!saving}>
        {form && (
          <>
            <ModalHeader
              title={form.id ? 'Editar tutorial' : 'Novo tutorial'}
              subtitle="Nome, descrição e o vídeo que o cliente assiste."
              onClose={() => !saving && setForm(null)}
              icon={<div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-violet-600" /></div>}
            />
            <ModalBody>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Nome</label>
                <input
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Ex.: Como mover um card no funil"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Descrição (opcional)</label>
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  placeholder="O que o cliente aprende neste vídeo."
                  className={cn(inputCls, 'h-20 resize-y')}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Vídeo</label>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-3">
                  {([
                    { id: 'upload', label: 'Enviar arquivo', icon: UploadCloud },
                    { id: 'link', label: 'Link externo', icon: LinkIcon },
                  ] as const).map(o => (
                    <button
                      key={o.id}
                      onClick={() => set('mode', o.id)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                        form.mode === o.id ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      <o.icon className="w-3.5 h-3.5" /> {o.label}
                    </button>
                  ))}
                </div>

                {form.mode === 'upload' ? (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={e => { pickFile(e.target.files?.[0] || null); e.target.value = ''; }}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="w-full border-2 border-dashed border-slate-200 hover:border-teal-300 rounded-xl p-6 flex flex-col items-center gap-2 transition-colors"
                    >
                      <UploadCloud className="w-7 h-7 text-teal-600" />
                      <span className="text-sm font-bold text-slate-700">
                        {form.file
                          ? `${form.file.name} (${(form.file.size / 1048576).toFixed(1)} MB)`
                          : form.storage_path
                          ? 'Trocar o vídeo enviado'
                          : 'Escolher vídeo'}
                      </span>
                      <span className="text-[11px] text-slate-400">MP4, WebM ou MOV — até 50 MB</span>
                    </button>
                    {form.storage_path && !form.file && (
                      <p className="text-[11px] text-slate-400 mt-2">
                        Já existe um vídeo enviado. Escolher outro arquivo substitui (o antigo é apagado).
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      value={form.video_url}
                      onChange={e => set('video_url', e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className={inputCls}
                    />
                    <p className="text-[11px] text-slate-400 mt-2">
                      YouTube, Vimeo e Loom tocam dentro da plataforma. Use esta opção para vídeos acima de 50 MB.
                    </p>
                  </>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e => set('is_active', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm font-bold text-slate-600">Visível para os clientes</span>
              </label>
            </ModalBody>
            <ModalFooter>
              <button
                onClick={() => setForm(null)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 border border-slate-200 bg-white text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : 'Salvar'}
              </button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
