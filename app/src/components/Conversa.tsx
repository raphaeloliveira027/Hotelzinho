import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { mensagemDeErro } from '../lib/erros'
import { supabase } from '../lib/supabase'

type Mensagem = { id: number; remetente_id: string; remetente_nome: string | null; conteudo: string; enviada_em: string; lida_em: string | null }

const quando = (iso: string) => {
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  return mesmoDia ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Conversa sobre uma criança entre a família e o hotelzinho.
 * Todas as pessoas responsáveis pela criança veem a mesma conversa.
 */
export function Conversa({ criancaId }: { criancaId: number }) {
  const { usuario } = useAuth()
  const [lista, setLista] = useState<Mensagem[] | null>(null)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const fim = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('mensagem')
      .select('id, remetente_id, remetente_nome, conteudo, enviada_em, lida_em')
      .eq('crianca_id', criancaId).order('enviada_em')
    setLista((data ?? []) as Mensagem[])
    await supabase.rpc('marcar_mensagens_lidas', { p_crianca: criancaId })
  }, [criancaId])

  useEffect(() => {
    setLista(null)
    carregar()
    const t = setInterval(carregar, 20000) // confere mensagens novas a cada 20 segundos
    return () => clearInterval(t)
  }, [carregar])

  useEffect(() => { fim.current?.scrollIntoView({ block: 'end' }) }, [lista])

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !usuario) return
    const t = texto.trim()
    if (!t) return
    setEnviando(true)
    const { error } = await supabase.from('mensagem').insert({ crianca_id: criancaId, remetente_id: usuario.id, conteudo: t })
    setEnviando(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    setTexto(''); setErro(null)
    carregar()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 min-h-[120px]" aria-live="polite">
        {lista === null && <p className="text-suave">Carregando…</p>}
        {lista?.length === 0 && <p className="bg-white rounded-2xl p-4 text-center text-suave">Nenhuma mensagem ainda. Escreva a primeira!</p>}
        {lista?.map((m) => {
          const minha = m.remetente_id === usuario?.id
          return (
            <div key={m.id} className={`max-w-[85%] rounded-3xl px-4 py-2.5 shadow-[0_2px_0_rgba(43,42,51,0.06)] ${
              minha ? 'self-end bg-marca text-white rounded-br-md' : 'self-start bg-white rounded-bl-md'}`}>
              {!minha && <p className="text-xs font-extrabold text-marca-escura">{m.remetente_nome}</p>}
              <p className="text-[15px] whitespace-pre-wrap break-words">{m.conteudo}</p>
              <p className={`text-[11px] text-right ${minha ? 'text-white/85' : 'text-suave'}`}>{quando(m.enviada_em)}</p>
            </div>
          )
        })}
        <div ref={fim} />
      </div>
      <form onSubmit={enviar} className="flex gap-2 items-end sticky bottom-24">
        <label className="flex-1">
          <span className="sr-only">Escreva sua mensagem</span>
          <textarea rows={1} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} placeholder="Escreva sua mensagem…"
            className="w-full min-h-[48px] max-h-32 px-4 py-3 rounded-3xl border-2 border-borda bg-white resize-none" />
        </label>
        <button type="submit" disabled={enviando || !texto.trim()} aria-label="Enviar mensagem"
          className="w-12 h-12 shrink-0 rounded-full bg-marca text-white flex items-center justify-center disabled:opacity-50">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7z" /></svg>
        </button>
      </form>
      {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
    </div>
  )
}
