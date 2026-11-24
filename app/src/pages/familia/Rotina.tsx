import { useEffect, useState } from 'react'
import { Avatar } from '../../components/Enfeites'
import { dataISO, horaCurta, horaDeInstante, intervaloDoDia } from '../../lib/datas'
import { supabase } from '../../lib/supabase'

type Crianca = { id: number; nome_completo: string }
type Presenca = { hora_entrada: string; hora_saida: string | null; buscado_por_nome: string | null; responsavel: { nome: string } | null }
type Registro = { id: number; tipo: string; inicio: string; fim: string | null; descricao: string; aceitacao: string | null }

const TIPOS: Record<string, { rotulo: string; cor: string }> = {
  REFEICAO: { rotulo: 'Refeição', cor: 'bg-sol' },
  SONO: { rotulo: 'Sono', cor: 'bg-lilas' },
  ATIVIDADE: { rotulo: 'Atividade', cor: 'bg-folha' },
  OBSERVACAO: { rotulo: 'Observação', cor: 'bg-ceu' },
  OCORRENCIA: { rotulo: 'Ocorrência', cor: 'bg-coral' },
  RECADO: { rotulo: 'Recado', cor: 'bg-sol' },
}
const ACEITACAO: Record<string, string> = { TUDO: 'Comeu tudo', PARTE: 'Comeu parte', RECUSOU: 'Não quis comer' }

type Item = { hora: string; titulo: string; cor: string; texto: string; extra?: string; destaque?: boolean }

/**
 * Rotina do dia para a família: entrada, refeições, sono, atividades, recados e saída.
 * Só aparece o que a administração marcou como visível (regra do banco).
 */
export function FamiliaRotina() {
  const [criancas, setCriancas] = useState<Crianca[] | null>(null)
  const [criancaId, setCriancaId] = useState<number | null>(null)
  const [dia, setDia] = useState(() => new Date())
  const [itens, setItens] = useState<Item[] | null>(null)

  useEffect(() => {
    supabase?.from('crianca').select('id, nome_completo').order('nome_completo').then(({ data }) => {
      const l = (data ?? []) as Crianca[]
      setCriancas(l)
      if (l.length) setCriancaId(l[0].id)
    })
  }, [])

  useEffect(() => {
    if (!supabase || !criancaId) return
    setItens(null)
    const { ini, fim } = intervaloDoDia(dia)
    Promise.all([
      supabase.from('presenca').select('hora_entrada, hora_saida, buscado_por_nome, responsavel(nome)')
        .eq('crianca_id', criancaId).eq('data', dataISO(dia)).maybeSingle(),
      supabase.from('registro_rotina').select('id, tipo, inicio, fim, descricao, aceitacao')
        .eq('crianca_id', criancaId).gte('inicio', ini).lt('inicio', fim).order('inicio'),
    ]).then(([rP, rR]) => {
      const p = rP.data as unknown as Presenca | null
      const lista: Item[] = []
      if (p) lista.push({ hora: horaCurta(p.hora_entrada), titulo: 'Chegou', cor: 'bg-folha', texto: 'Entrada no hotelzinho.' })
      for (const r of (rR.data ?? []) as Registro[]) {
        const t = TIPOS[r.tipo] ?? { rotulo: r.tipo, cor: 'bg-ceu' }
        lista.push({
          hora: horaDeInstante(r.inicio),
          titulo: t.rotulo,
          cor: t.cor,
          texto: r.descricao,
          extra: r.tipo === 'SONO' && r.fim ? `Dormiu das ${horaDeInstante(r.inicio)} às ${horaDeInstante(r.fim)}` : r.aceitacao ? ACEITACAO[r.aceitacao] : undefined,
          destaque: r.tipo === 'OCORRENCIA' || r.tipo === 'RECADO',
        })
      }
      if (p?.hora_saida) {
        const quem = p.responsavel?.nome ?? p.buscado_por_nome
        lista.push({ hora: horaCurta(p.hora_saida), titulo: 'Saiu', cor: 'bg-ceu', texto: quem ? `Buscado(a) por ${quem}.` : 'Saída do hotelzinho.' })
      }
      lista.sort((a, b) => a.hora.localeCompare(b.hora))
      setItens(lista)
    })
  }, [criancaId, dia])

  const hoje = dataISO(new Date())
  const ehHoje = dataISO(dia) === hoje
  const mudarDia = (n: number) => setDia((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
  const rotuloDia = (ehHoje ? 'Hoje · ' : '') + dia.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
  const crianca = criancas?.find((c) => c.id === criancaId)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Rotina do dia</h1>

      {criancas && criancas.length > 1 && (
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Escolher criança">
          {criancas.map((c) => (
            <button key={c.id} onClick={() => setCriancaId(c.id)} aria-pressed={c.id === criancaId}
              className={`flex items-center gap-2 min-h-[48px] pl-1.5 pr-4 rounded-full border-2 font-bold text-sm ${c.id === criancaId ? 'border-marca bg-white' : 'border-transparent bg-white/60'}`}>
              <Avatar id={c.id} nome={c.nome_completo} />{c.nome_completo.split(' ')[0]}
            </button>
          ))}
        </div>
      )}
      {criancas?.length === 0 && <p className="bg-white rounded-2xl p-4 text-suave">Nenhuma criança vinculada à sua conta.</p>}

      {crianca && (
        <>
          <div className="flex items-center justify-between bg-white rounded-2xl p-1 shadow-[0_2px_0_rgba(43,42,51,0.06)]">
            <button onClick={() => mudarDia(-1)} aria-label="Dia anterior" className="min-w-[44px] min-h-[44px] text-2xl font-bold text-marca">‹</button>
            <span className="font-bold first-letter:uppercase">{rotuloDia}</span>
            <button onClick={() => mudarDia(1)} disabled={ehHoje} aria-label="Próximo dia" className="min-w-[44px] min-h-[44px] text-2xl font-bold text-marca disabled:text-stone-300">›</button>
          </div>

          {itens === null && <p className="text-suave">Carregando…</p>}
          {itens?.length === 0 && (
            <p className="bg-white rounded-2xl p-5 text-center text-suave">
              Nenhum registro de {crianca.nome_completo.split(' ')[0]} neste dia.
            </p>
          )}
          {itens && itens.length > 0 && (
            <ol className="flex flex-col">
              {itens.map((it, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 pt-3.5 text-right text-sm font-bold text-suave">{it.hora}</span>
                  <span aria-hidden="true" className="flex flex-col items-center shrink-0">
                    <span className={`w-0.5 h-4 ${i === 0 ? 'bg-transparent' : 'bg-borda'}`} />
                    <span className={`w-4 h-4 rounded-full border-2 border-white ${it.cor} shadow-[0_0_0_2px_#F0E3CC]`} />
                    <span className={`w-0.5 flex-1 ${i === itens.length - 1 ? 'bg-transparent' : 'bg-borda'}`} />
                  </span>
                  <div className={`flex-1 my-1.5 rounded-2xl p-3.5 ${it.destaque ? 'bg-white border-2 border-coral' : 'bg-white'} shadow-[0_2px_0_rgba(43,42,51,0.06)]`}>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold ${it.cor}`}>{it.titulo}</span>
                    <p className="mt-1.5 text-[15px]">{it.texto}</p>
                    {it.extra && <p className="text-sm text-suave">{it.extra}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-suave text-center">Você vê os registros que o hotelzinho deixou visíveis para a família.</p>
        </>
      )}
    </div>
  )
}
