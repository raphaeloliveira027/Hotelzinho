import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Conversa } from '../../components/Conversa'
import { Avatar } from '../../components/Enfeites'
import { supabase } from '../../lib/supabase'

type Crianca = { id: number; nome_completo: string }
type Msg = { crianca_id: number; conteudo: string; enviada_em: string; lida_em: string | null; remetente_nome: string | null }
type Linha = Crianca & { ultima?: Msg; naoLidas: number }

/** Lista de conversas por criança, com as que têm mensagem nova primeiro. */
export function AdminMensagens() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [busca, setBusca] = useState('')

  useEffect(() => {
    if (!supabase) return
    Promise.all([
      supabase.from('crianca').select('id, nome_completo').neq('status', 'INATIVA').order('nome_completo'),
      supabase.from('mensagem').select('crianca_id, conteudo, enviada_em, lida_em, remetente_nome').order('enviada_em', { ascending: false }).limit(500),
    ]).then(([rC, rM]) => {
      const msgs = (rM.data ?? []) as Msg[]
      const l = ((rC.data ?? []) as Crianca[]).map((c) => {
        const daCrianca = msgs.filter((m) => m.crianca_id === c.id)
        return {
          ...c,
          ultima: daCrianca[0],
          naoLidas: daCrianca.filter((m) => !m.lida_em && m.remetente_nome !== 'Hotelzinho').length,
        }
      })
      l.sort((a, b) => (b.naoLidas - a.naoLidas) || (b.ultima?.enviada_em ?? '').localeCompare(a.ultima?.enviada_em ?? '') || a.nome_completo.localeCompare(b.nome_completo, 'pt-BR'))
      setLinhas(l)
    })
  }, [])

  const termo = busca.trim().toLocaleLowerCase('pt-BR')
  const filtradas = (linhas ?? []).filter((l) => !termo || l.nome_completo.toLocaleLowerCase('pt-BR').includes(termo))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Mensagens</h1>
      <input type="search" placeholder="Buscar criança" aria-label="Buscar criança" value={busca} onChange={(e) => setBusca(e.target.value)}
        className="h-12 px-4 rounded-2xl border-2 border-borda bg-white" />
      {linhas === null && <p className="text-suave">Carregando…</p>}
      <ul className="flex flex-col gap-2.5">
        {filtradas.map((l) => (
          <li key={l.id}>
            <Link to={`/admin/mensagens/${l.id}`} className="bg-white rounded-2xl p-3.5 flex items-center gap-3 no-underline text-tinta shadow-[0_2px_0_rgba(43,42,51,0.06)]">
              <Avatar id={l.id} nome={l.nome_completo} />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold truncate">{l.nome_completo}</p>
                <p className="text-sm text-suave truncate">
                  {l.ultima ? `${l.ultima.remetente_nome === 'Hotelzinho' ? 'Você' : l.ultima.remetente_nome}: ${l.ultima.conteudo}` : 'Nenhuma mensagem'}
                </p>
              </div>
              {l.naoLidas > 0 && (
                <span className="min-w-[28px] h-7 px-2 rounded-full bg-coral font-extrabold text-sm flex items-center justify-center" aria-label={`${l.naoLidas} mensagens novas`}>
                  {l.naoLidas}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Conversa com a família de uma criança. */
export function AdminConversa() {
  const { id } = useParams()
  const [crianca, setCrianca] = useState<Crianca | null>(null)
  useEffect(() => {
    supabase?.from('crianca').select('id, nome_completo').eq('id', id).maybeSingle().then(({ data }) => setCrianca(data as Crianca | null))
  }, [id])

  return (
    <div className="flex flex-col gap-4">
      <Link to="/admin/mensagens" className="self-start min-h-[44px] flex items-center text-sm font-bold text-marca">‹ Mensagens</Link>
      {crianca && (
        <header className="flex items-center gap-3">
          <Avatar id={crianca.id} nome={crianca.nome_completo} tamanho="lg" />
          <div>
            <h1 className="text-xl">{crianca.nome_completo}</h1>
            <p className="text-sm text-suave">Conversa com os responsáveis</p>
          </div>
        </header>
      )}
      {id && <Conversa criancaId={Number(id)} />}
    </div>
  )
}
