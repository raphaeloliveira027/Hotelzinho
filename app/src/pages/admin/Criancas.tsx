import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { botaoPrincipal } from '../../components/Campos'
import { idade } from '../../lib/formato'
import { Avatar } from '../../components/Enfeites'
import { supabase } from '../../lib/supabase'

type Linha = {
  id: number
  nome_completo: string
  data_nascimento: string
  status: 'ATIVA' | 'EM_ADAPTACAO' | 'INATIVA'
  alergias: string | null
  plano: { nome: string } | null
  crianca_responsavel: { responsavel: { nome: string } | null }[]
}

const STATUS = {
  ATIVA: { texto: 'Ativa', classe: 'bg-green-100 text-green-900' },
  EM_ADAPTACAO: { texto: 'Em adaptação', classe: 'bg-indigo-100 text-indigo-900' },
  INATIVA: { texto: 'Inativa', classe: 'bg-stone-200 text-stone-700' },
}

/** Lista de crianças com busca por nome e filtro de situação. */
export function AdminCriancas() {
  const [lista, setLista] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [mostrarInativas, setMostrarInativas] = useState(false)

  useEffect(() => {
    supabase?.from('crianca')
      .select('id, nome_completo, data_nascimento, status, alergias, plano(nome), crianca_responsavel(responsavel(nome))')
      .order('nome_completo')
      .then(({ data, error }) => {
        if (error) setErro('Não foi possível carregar as crianças.')
        setLista((data ?? []) as unknown as Linha[])
      })
  }, [])

  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const filtradas = (lista ?? [])
    .filter((c) => mostrarInativas || c.status !== 'INATIVA')
    .filter((c) => !termo || c.nome_completo.toLocaleLowerCase('pt-BR').includes(termo))
  const ativas = (lista ?? []).filter((c) => c.status !== 'INATIVA').length

  return (
    <div className="flex flex-col gap-4">
      <header className="flex justify-between items-end gap-3">
        <div>
          <p className="text-sm text-suave">{lista ? `${ativas} ativa${ativas === 1 ? '' : 's'}` : ' '}</p>
          <h1 className="text-2xl font-bold">Crianças</h1>
        </div>
        <Link to="/admin/criancas/nova" className={`${botaoPrincipal} min-h-[44px] text-sm`}>+ Nova criança</Link>
      </header>

      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        <span className="sr-only">Buscar por nome</span>
        <input type="search" placeholder="Buscar por nome" value={busca} onChange={(e) => setBusca(e.target.value)}
          className="h-12 px-3.5 rounded-xl border border-stone-300 bg-white font-normal" />
      </label>
      <label className="flex items-center gap-3 min-h-[44px] text-sm">
        <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} className="w-5 h-5 accent-marca" />
        Mostrar inativas
      </label>

      {erro && <p role="alert" className="rounded-xl bg-red-100 text-red-900 p-3 text-sm">{erro}</p>}
      {lista === null && <p className="text-suave">Carregando…</p>}
      {lista?.length === 0 && (
        <p className="bg-white rounded-2xl p-4 text-suave">Nenhuma criança cadastrada ainda. Toque em “+ Nova criança”.</p>
      )}
      {lista && lista.length > 0 && filtradas.length === 0 && <p className="text-suave">Nenhuma criança encontrada.</p>}

      <ul className="flex flex-col gap-3">
        {filtradas.map((c) => {
          const resps = c.crianca_responsavel.map((v) => v.responsavel?.nome).filter(Boolean)
          return (
            <li key={c.id}>
              <Link to={`/admin/criancas/${c.id}`} className="bg-white rounded-2xl p-4 flex items-center gap-3 no-underline text-tinta">
                <Avatar id={c.id} nome={c.nome_completo} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{c.nome_completo}</p>
                  <p className="text-xs text-suave">{idade(c.data_nascimento)} · {c.plano?.nome ?? 'Sem plano'}</p>
                  <p className={`text-xs ${resps.length ? 'text-suave' : 'text-alerta font-semibold'}`}>
                    {resps.length ? resps.join(', ') : 'Sem responsável vinculado'}
                  </p>
                  {c.alergias && <p className="text-xs font-semibold text-alerta">Alergia: {c.alergias}</p>}
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS[c.status].classe}`}>{STATUS[c.status].texto}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
