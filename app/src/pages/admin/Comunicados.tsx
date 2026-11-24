import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AreaTexto, Campo, Selecao, botaoPrincipal } from '../../components/Campos'
import { useAuth } from '../../lib/auth'
import { mensagemDeErro } from '../../lib/erros'
import { supabase } from '../../lib/supabase'
import type { Comunicado } from '../../lib/tipos'

type Crianca = { id: number; nome_completo: string }

/** Comunicados para todas as famílias ou para a família de uma criança. */
export function AdminComunicados() {
  const { usuario } = useAuth()
  const [lista, setLista] = useState<Comunicado[] | null>(null)
  const [criancas, setCriancas] = useState<Crianca[]>([])
  const [titulo, setTitulo] = useState('')
  const [conteudo, setConteudo] = useState('')
  const [destino, setDestino] = useState('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    if (!supabase) return
    const [rC, rK] = await Promise.all([
      supabase.from('comunicado').select('*').order('publicado_em', { ascending: false }).limit(50),
      supabase.from('crianca').select('id, nome_completo').neq('status', 'INATIVA').order('nome_completo'),
    ])
    setLista((rC.data ?? []) as Comunicado[])
    setCriancas((rK.data ?? []) as Crianca[])
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const publicar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !usuario) return
    if (titulo.trim().length < 3) { setAviso({ tipo: 'erro', texto: 'Escreva um título.' }); return }
    if (conteudo.trim().length < 3) { setAviso({ tipo: 'erro', texto: 'Escreva a mensagem do comunicado.' }); return }
    setEnviando(true)
    const { error } = await supabase.from('comunicado').insert({
      titulo: titulo.trim(), conteudo: conteudo.trim(), crianca_id: destino ? Number(destino) : null, autor_id: usuario.id,
    })
    setEnviando(false)
    if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
    const para = destino ? `a família de ${criancas.find((c) => c.id === Number(destino))?.nome_completo}` : 'todas as famílias'
    setAviso({ tipo: 'ok', texto: `Comunicado enviado para ${para}. Elas recebem um aviso no app.` })
    setTitulo(''); setConteudo(''); setDestino('')
    carregar()
  }

  const nome = (id: number | null) => criancas.find((c) => c.id === id)?.nome_completo

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl">Comunicados</h1>

      <form onSubmit={publicar} noValidate className="bg-white rounded-2xl p-4 flex flex-col gap-4 shadow-[0_2px_0_rgba(43,42,51,0.06)]">
        <h2 className="text-lg">Novo comunicado</h2>
        <Selecao rotulo="Para quem" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Todas as famílias</option>
          {criancas.map((c) => <option key={c.id} value={c.id}>Família de {c.nome_completo}</option>)}
        </Selecao>
        <Campo rotulo="Título" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={120} placeholder="Ex.: Festa do Dia das Crianças" />
        <AreaTexto rotulo="Mensagem" value={conteudo} onChange={(e) => setConteudo(e.target.value)} maxLength={5000} rows={4} />
        {aviso && (
          <p role={aviso.tipo === 'erro' ? 'alert' : 'status'}
            className={`rounded-xl p-3 text-sm font-semibold ${aviso.tipo === 'erro' ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`}>{aviso.texto}</p>
        )}
        <button type="submit" disabled={enviando} className={botaoPrincipal}>{enviando ? 'Enviando…' : 'Enviar comunicado'}</button>
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">Enviados</h2>
        {lista === null && <p className="text-suave">Carregando…</p>}
        {lista?.length === 0 && <p className="text-suave">Nenhum comunicado enviado ainda.</p>}
        {lista?.map((c) => (
          <article key={c.id} className="bg-white rounded-2xl p-4 flex flex-col gap-1 shadow-[0_2px_0_rgba(43,42,51,0.06)]">
            <div className="flex justify-between items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold ${c.crianca_id ? 'bg-coral' : 'bg-ceu'}`}>
                {c.crianca_id ? `Família de ${nome(c.crianca_id) ?? 'criança'}` : 'Todas as famílias'}
              </span>
              <span className="text-xs text-suave">{new Date(c.publicado_em).toLocaleDateString('pt-BR')}</span>
            </div>
            <p className="font-extrabold">{c.titulo}</p>
            <p className="text-sm whitespace-pre-wrap">{c.conteudo}</p>
          </article>
        ))}
      </section>
    </div>
  )
}
