import { useEffect, useState } from 'react'
import { Conversa } from '../../components/Conversa'
import { Avatar } from '../../components/Enfeites'
import { supabase } from '../../lib/supabase'
import type { Comunicado } from '../../lib/tipos'

type Crianca = { id: number; nome_completo: string }

/** Comunicados do hotelzinho e conversa da família com a administração. */
export function FamiliaMensagens() {
  const [aba, setAba] = useState<'comunicados' | 'conversa'>('comunicados')
  const [comunicados, setComunicados] = useState<Comunicado[] | null>(null)
  const [criancas, setCriancas] = useState<Crianca[]>([])
  const [criancaId, setCriancaId] = useState<number | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase.from('comunicado').select('*').order('publicado_em', { ascending: false }).limit(50)
      .then(({ data }) => setComunicados((data ?? []) as Comunicado[]))
    supabase.from('crianca').select('id, nome_completo').order('nome_completo').then(({ data }) => {
      const l = (data ?? []) as Crianca[]
      setCriancas(l)
      if (l.length) setCriancaId(l[0].id)
    })
  }, [])

  const nome = (id: number | null) => criancas.find((c) => c.id === id)?.nome_completo.split(' ')[0]

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Mensagens</h1>
      <div className="grid grid-cols-2 gap-1.5 bg-white p-1.5 rounded-2xl shadow-[0_2px_0_rgba(43,42,51,0.06)]" role="tablist">
        {(['comunicados', 'conversa'] as const).map((a) => (
          <button key={a} role="tab" aria-selected={aba === a} onClick={() => setAba(a)}
            className={`min-h-[44px] rounded-xl text-sm font-extrabold ${aba === a ? 'bg-sol' : 'text-suave'}`}>
            {a === 'comunicados' ? 'Comunicados' : 'Fale com o hotelzinho'}
          </button>
        ))}
      </div>

      {aba === 'comunicados' ? (
        <section className="flex flex-col gap-3">
          {comunicados === null && <p className="text-suave">Carregando…</p>}
          {comunicados?.length === 0 && <p className="bg-white rounded-2xl p-4 text-suave">Nenhum comunicado ainda.</p>}
          {comunicados?.map((c) => (
            <article key={c.id} className="bg-white rounded-2xl p-4 flex flex-col gap-1.5 shadow-[0_2px_0_rgba(43,42,51,0.06)]">
              <div className="flex justify-between items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${c.crianca_id ? 'bg-coral' : 'bg-ceu'}`}>
                  {c.crianca_id ? `Sobre ${nome(c.crianca_id) ?? 'seu filho(a)'}` : 'Para todas as famílias'}
                </span>
                <span className="text-xs text-suave">{new Date(c.publicado_em).toLocaleDateString('pt-BR')}</span>
              </div>
              <h2 className="text-lg">{c.titulo}</h2>
              <p className="text-[15px] whitespace-pre-wrap">{c.conteudo}</p>
            </article>
          ))}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {criancas.length > 1 && (
            <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Conversa sobre">
              {criancas.map((c) => (
                <button key={c.id} onClick={() => setCriancaId(c.id)} aria-pressed={c.id === criancaId}
                  className={`flex items-center gap-2 min-h-[48px] pl-1.5 pr-4 rounded-full border-2 font-bold text-sm ${c.id === criancaId ? 'border-marca bg-white' : 'border-transparent bg-white/60'}`}>
                  <Avatar id={c.id} nome={c.nome_completo} />{c.nome_completo.split(' ')[0]}
                </button>
              ))}
            </div>
          )}
          {criancaId ? (
            <>
              <p className="text-sm text-suave">Conversa sobre {nome(criancaId)}. Todos os responsáveis dela veem esta conversa.</p>
              <Conversa key={criancaId} criancaId={criancaId} />
            </>
          ) : <p className="bg-white rounded-2xl p-4 text-suave">Nenhuma criança vinculada à sua conta.</p>}
        </section>
      )}
    </div>
  )
}
