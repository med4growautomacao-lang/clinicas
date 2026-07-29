// Consumo de IA (Super Admin) — quanto cada função e cada clínica gastam.
//
// Existe porque o consumo vinha na resposta de todo provedor e era DESCARTADO em tudo menos no
// analista: "quem está gastando mais?" só tinha resposta por estimativa de volume. Agora cada
// chamada vira uma linha em `llm_usage` e este painel soma.
//
// A agregação é toda na RPC: são dezenas de milhares de linhas por mês, e somar no navegador
// cairia no clamp de max_rows do PostgREST (o total mentiria sem avisar).
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, BrainCircuit, MessageSquare, Mic, Image as ImageIcon, RefreshCw, AlertTriangle, DollarSign, Activity } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";

// Mapeia a chave de system_settings para o nome que o dono reconhece na tela.
const FUNCOES: Record<string, { label: string; desc: string; Icon: typeof Bot; cor: string }> = {
  agent_ai_config:     { label: "Agente IA",              desc: "Conversa com o paciente no WhatsApp", Icon: Bot,          cor: "text-teal-600 bg-teal-50" },
  conv_ai_config:      { label: "Analista de Conversas",  desc: "Move card e sugere venda sozinho",    Icon: BrainCircuit, cor: "text-violet-600 bg-violet-50" },
  ai_assistant_config: { label: "Assistente de Dados",    desc: "Perguntas sobre os números no app",   Icon: MessageSquare, cor: "text-blue-600 bg-blue-50" },
  media_ai_config:     { label: "Leitura de Mídia",       desc: "Transcreve áudio e lê imagem/PDF",    Icon: ImageIcon,    cor: "text-amber-600 bg-amber-50" },
  elevenlabs_config:   { label: "Voz (áudio da IA)",      desc: "Converte a resposta em áudio",        Icon: Mic,          cor: "text-rose-600 bg-rose-50" },
};

type Resumo = {
  periodo: { de: string; ate: string };
  total: { chamadas: number; falhas: number; tokens_in: number; tokens_out: number; custo: number; sem_custo_medido: number };
  por_funcao: Array<{ feature: string; chamadas: number; falhas: number; tokens_in: number; tokens_out: number; custo: number; sem_custo_medido: number }>;
  por_escopo: Array<{ feature: string; scope: string; chamadas: number; falhas: number; custo: number }>;
  por_clinica: Array<{ clinic_id: string | null; nome: string; chamadas: number; falhas: number; tokens_in: number; tokens_out: number; custo: number }>;
  por_modelo: Array<{ provider: string; model: string; tem_preco: boolean; chamadas: number; tokens_in: number; tokens_out: number; unidades: number; unidade: string | null; custo: number }>;
  por_dia: Array<{ dia: string; chamadas: number; custo: number }>;
  modelos_sem_preco: string[];
  moeda: string;
};

const PERIODOS = [
  { label: "7 dias", dias: 6 },
  { label: "30 dias", dias: 29 },
  { label: "90 dias", dias: 89 },
];

const num = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));

// Com preço por 1 MILHÃO de tokens, o custo de UMA clínica por dia fica em centésimos de dólar.
// Formatar sempre com 2 casas fazia a tabela "Por clínica" mostrar US$ 0,00 em toda linha
// enquanto o total aparecia diferente de zero, ou seja o painel parecia quebrado exatamente na
// granularidade onde está a resposta. Casas decimais acompanham a ordem de grandeza.
const money = (n: number, moeda: string) => {
  const v = n || 0;
  const simbolo = moeda === "BRL" ? "R$" : "US$";
  const casas = v === 0 ? 2 : Math.abs(v) >= 1 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6;
  return `${simbolo} ${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v)}`;
};

// Dia de negócio é dia em SÃO PAULO (CLAUDE.md §0.1). `toISOString()` devolve UTC: entre 21h e
// meia-noite em SP já é o dia seguinte lá, então a janela pedida pulava um dia — o gráfico ganhava
// um dia vazio e o período perdia o mais antigo, só nessas três horas de toda noite.
const diaSP = (offsetDias = 0) => {
  const agora = new Date(Date.now() - offsetDias * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora); // en-CA => AAAA-MM-DD
};

export function LlmUsagePanel() {
  const [dias, setDias] = useState(29);
  const [data, setData] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async (d: number) => {
    setLoading(true); setErro(null);
    const { data: r, error } = await supabase.rpc("get_llm_usage_summary", {
      p_from: diaSP(d), p_to: diaSP(0),
    });
    if (error) setErro(error.message); else setData(r as Resumo);
    setLoading(false);
  };

  useEffect(() => { carregar(dias); }, [dias]);

  // Calendário completo: `por_dia` só traz dia COM chamada. Sem preencher os buracos, um fim de
  // semana parado some do gráfico, as barras restantes se alargam e escorregam, e 12 dias ativos
  // num mês desenham 12 barras que se leem como 12 dias seguidos.
  const serie = useMemo(() => {
    const porDia = new Map((data?.por_dia ?? []).map((d) => [d.dia, d]));
    const out: Array<{ dia: string; custo: number; chamadas: number }> = [];
    for (let i = dias; i >= 0; i--) {
      const dia = diaSP(i);
      const achado = porDia.get(dia);
      out.push({ dia, custo: achado?.custo ?? 0, chamadas: achado?.chamadas ?? 0 });
    }
    return out;
  }, [data, dias]);

  // Escala pela maior barra REAL. O `Math.max(1, ...)` de antes fixava um teto invisível de US$ 1
  // e achatava tudo: com gasto diário na casa dos centavos, um pico de 6x parecia um degrauzinho.
  const maxDia = useMemo(() => {
    const m = Math.max(0, ...serie.map((d) => d.custo));
    return m > 0 ? m : 1;
  }, [serie]);

  if (loading && !data) {
    return <div className="p-8 text-center text-sm font-semibold text-slate-400">Carregando consumo…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho + período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">Consumo de IA</h2>
          <p className="text-xs font-medium text-slate-500">
            Uma linha por chamada, em todas as funções. Custo estimado pelos preços em System Settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                onClick={() => setDias(p.dias)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                  dias === p.dias ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => carregar(dias)}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            title="Atualizar"
          >
            <RefreshCw className={cn("w-4 h-4 text-slate-500", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Erro fica DENTRO da tela, não no lugar dela: trocar o painel inteiro pelo aviso
          desmontava o seletor de período e o botão de atualizar, e uma falha passageira
          (timeout, rede) deixava o super admin sem nenhum jeito de tentar de novo. */}
      {erro && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-rose-700">Não consegui carregar o consumo: {erro}</span>
          <button
            onClick={() => carregar(dias)}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 shrink-0"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {!data ? null : data.total.chamadas === 0 ? (
        <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-500">
          Nenhuma chamada registrada no período. O monitor grava a partir do momento em que foi ligado,
          então logo depois de ativar é normal aparecer vazio.
        </div>
      ) : (
        <>
          {/* Totais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Custo no período", valor: money(data.total.custo, data.moeda), Icon: DollarSign, cor: "bg-emerald-50 text-emerald-600" },
              { label: "Chamadas", valor: num(data.total.chamadas), Icon: Activity, cor: "bg-blue-50 text-blue-600" },
              { label: "Tokens de entrada", valor: num(data.total.tokens_in), Icon: BrainCircuit, cor: "bg-violet-50 text-violet-600" },
              { label: "Falhas", valor: num(data.total.falhas), Icon: AlertTriangle, cor: data.total.falhas > 0 ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-400" },
            ].map((c) => (
              <div key={c.label} className="p-4 bg-white border border-slate-200 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", c.cor)}>
                    <c.Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{c.label}</span>
                </div>
                <p className="text-xl font-black text-slate-900">{c.valor}</p>
              </div>
            ))}
          </div>

          {data.modelos_sem_preco?.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs font-semibold text-amber-800">
              Sem preço cadastrado: {data.modelos_sem_preco.join(", ")}. O consumo desses modelos aparece nas
              chamadas e nos tokens, mas entra como custo zero. Cadastre em System Settings › <code>llm_prices</code>.
            </div>
          )}

          {/* Honestidade do total: chamada que aconteceu mas cujo custo não dá para calcular
              (leitura de mídia é cobrada por token, e o que guardamos ali é o tamanho do arquivo).
              Sem este aviso, o total pareceria a conta inteira. */}
          {data.total.sem_custo_medido > 0 && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600">
              {num(data.total.sem_custo_medido)} chamada(s) aconteceram mas <strong>não entram no custo acima</strong>:
              são cobradas por algo que ainda não medimos (leitura de mídia) ou usam modelo sem preço.
              O total é o piso do gasto, não o valor final.
            </div>
          )}

          <p className="text-[11px] text-slate-400 font-medium pl-1">
            Custo é <strong>estimativa</strong> pelos preços de tabela em System Settings ›{" "}
            <code>llm_prices</code>. Confira contra a fatura real de cada provedor antes de usar para decidir.
          </p>

          {/* Por função (as mesmas que o Super Admin configura) */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pl-1">Por função</p>
            <div className="grid gap-2 md:grid-cols-2">
              {data.por_funcao.map((f) => {
                const meta = FUNCOES[f.feature] ?? { label: f.feature, desc: "", Icon: Bot, cor: "text-slate-600 bg-slate-50" };
                const escopos = data.por_escopo.filter((e) => e.feature === f.feature);
                return (
                  <motion.div
                    key={f.feature}
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    className="p-4 bg-white border border-slate-200 rounded-xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", meta.cor)}>
                          <meta.Icon className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 truncate">{meta.label}</p>
                          <p className="text-[11px] text-slate-400 font-medium truncate">{meta.desc}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-black text-slate-900">{money(f.custo, data.moeda)}</p>
                        <p className="text-[10px] font-semibold text-slate-400">{num(f.chamadas)} chamadas</p>
                      </div>
                    </div>
                    {f.falhas > 0 && (
                      <p className="mt-2 text-[11px] font-bold text-rose-600">
                        {num(f.falhas)} falha(s) — chamada que falha também consome cota
                      </p>
                    )}
                    {f.sem_custo_medido > 0 && (
                      <p className="mt-1 text-[11px] font-semibold text-slate-500">
                        {num(f.sem_custo_medido)} chamada(s) sem custo medido
                      </p>
                    )}
                    {escopos.length > 1 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                        {escopos.map((e) => (
                          <div key={e.scope} className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-500">{e.scope}</span>
                            <span className="font-bold text-slate-700">{money(e.custo, data.moeda)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Por clínica */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pl-1">Por clínica</p>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5">Clínica</th>
                      <th className="text-right px-4 py-2.5">Custo</th>
                      <th className="text-right px-4 py-2.5">Chamadas</th>
                      <th className="text-right px-4 py-2.5">Tokens entrada</th>
                      <th className="text-right px-4 py-2.5">Falhas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.por_clinica.map((c) => (
                      <tr key={c.clinic_id ?? "sem"} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-bold text-slate-800">{c.nome}</td>
                        <td className="px-4 py-2.5 text-right font-black text-slate-900">{money(c.custo, data.moeda)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-500">{num(c.chamadas)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-500">{num(c.tokens_in)}</td>
                        <td className={cn("px-4 py-2.5 text-right font-bold", c.falhas > 0 ? "text-rose-600" : "text-slate-300")}>
                          {c.falhas > 0 ? num(c.falhas) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Por dia */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pl-1">Por dia</p>
            <div className="p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-end gap-[2px] h-28">
                {serie.map((d) => (
                  <div key={d.dia} className="flex-1 flex flex-col items-center justify-end group relative">
                    <div
                      className={cn(
                        "w-full rounded-t transition-colors",
                        d.chamadas > 0 ? "bg-teal-500/80 group-hover:bg-teal-600" : "bg-slate-200",
                      )}
                      style={{ height: d.chamadas > 0 ? `${Math.max(3, (d.custo / maxDia) * 100)}%` : "3px" }}
                    />
                    <div className="absolute bottom-full mb-1 hidden group-hover:block bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap z-10">
                      {new Date(d.dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                      {d.chamadas > 0 ? ` · ${money(d.custo, data.moeda)} · ${num(d.chamadas)} chamadas` : " · sem uso"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2 text-[10px] font-semibold text-slate-400">
                <span>{new Date(serie[0].dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                <span>maior dia: {money(maxDia, data.moeda)}</span>
                <span>{new Date(serie[serie.length - 1].dia + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
              </div>
            </div>
          </div>

          {/* Por modelo */}
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 pl-1">Por modelo</p>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <th className="text-left px-4 py-2.5">Provedor / Modelo</th>
                      <th className="text-right px-4 py-2.5">Custo</th>
                      <th className="text-right px-4 py-2.5">Chamadas</th>
                      <th className="text-right px-4 py-2.5">Entrada</th>
                      <th className="text-right px-4 py-2.5">Saída</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.por_modelo.map((m) => (
                      <tr key={`${m.provider}/${m.model}`} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <span className="font-bold text-slate-800">{m.model}</span>
                          <span className="ml-2 text-[10px] font-bold text-slate-400 uppercase">{m.provider}</span>
                          {!m.tem_preco && (
                            <span className="ml-2 text-[10px] font-bold text-amber-600">sem preço</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-black text-slate-900">{money(m.custo, data.moeda)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-500">{num(m.chamadas)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-500">
                          {m.tokens_in > 0
                            ? num(m.tokens_in)
                            : m.unidades > 0
                            ? `${num(m.unidades)} ${m.unidade === "chars" ? "caract." : m.unidade === "bytes" ? "bytes" : "un."}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-500">{num(m.tokens_out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
