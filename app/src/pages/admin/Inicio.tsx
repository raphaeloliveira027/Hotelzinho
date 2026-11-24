import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AvisosNoCelular } from '../../components/AvisosNoCelular'
import { Logo } from '../../components/Enfeites'
import { Cartao } from '../../components/Layout'
import { useAuth } from '../../lib/auth'
import { competenciaBR, dataBR } from '../../lib/formato'
import { supabase } from '../../lib/supabase'
import type { Mensalidade } from '../../lib/tipos'

type Resumo = {
  ativas: number
  presentes: number
  comprovantes: number
  atrasadas: number
  mes: { pagas: number; analise: number; pendentes: number }
}

const hojeISO = () => new Date().toLocaleDateString('sv-SE') // AAAA-MM-DD no fuso local
const competenciaAtual = () => hojeISO().slice(0, 8) + '01'
const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }

/** Painel inicial da administradora: só indicadores que levam a uma ação. */
export function AdminInicio() {
  const { sair } = useAuth()
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [cadastros, setCadastros] = useState(0)
  const [naoLidas, setNaoLidas] = useState(0)

  useEffect(() => {
    supabase?.from('solicitacao_cadastro').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE')
      .then(({ count }) => setCadastros(count ?? 0))
    supabase?.from('mensagem').select('id', { count: 'exact', head: true }).is('lida_em', null).neq('remetente_nome', 'Hotelzinho')
      .then(({ count }) => setNaoLidas(count ?? 0))
  }, [])

  useEffect(() => {
    if (!supabase) return
    const db = supabase
    Promise.all([
      db.from('crianca').select('id', { count: 'exact', head: true }).in('status', ['ATIVA', 'EM_ADAPTACAO']),
      db.from('presenca').select('id', { count: 'exact', head: true }).eq('data', hojeISO()).is('hora_saida', null),
      db.from('comprovante').select('id', { count: 'exact', head: true }).eq('status', 'PENDENTE'),
      db.from('vw_mensalidade_status').select('status').eq('status', 'ATRASADO'),
      db.from('vw_mensalidade_status').select('status').eq('competencia', competenciaAtual()),
    ]).then(([ativas, presentes, comprovantes, atrasadas, mes]) => {
      const falha = [ativas, presentes, comprovantes, atrasadas, mes].find((r) => r.error)
      if (falha?.error) { setErro('Não foi possível carregar o painel.'); return }
      const lista = (mes.data ?? []) as Pick<Mensalidade, 'status'>[]
      setResumo({
        ativas: ativas.count ?? 0,
        presentes: presentes.count ?? 0,
        comprovantes: comprovantes.count ?? 0,
        atrasadas: atrasadas.data?.length ?? 0,
        mes: {
          pagas: lista.filter((m) => m.status === 'PAGO').length,
          analise: lista.filter((m) => m.status === 'EM_ANALISE').length,
          pendentes: lista.filter((m) => m.status === 'PENDENTE' || m.status === 'ATRASADO').length,
        },
      })
    })
  }, [])

  const hoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-col gap-5">
      <header className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white border-[3px] border-sol flex items-center justify-center"><Logo tamanho={34} /></div>
          <div>
            <p className="text-sm text-suave first-letter:uppercase">{hoje}</p>
            <h1 className="text-2xl">{saudacao()}!</h1>
          </div>
        </div>
        <button onClick={sair} className="min-h-[44px] px-2 text-sm font-bold text-marca">Sair</button>
      </header>

      <AvisosNoCelular modo="convite" texto="Saiba na hora quando chegar cadastro de família, comprovante de Pix ou mensagem." />

      {naoLidas > 0 && (
        <Link to="/admin/mensagens" className="rounded-2xl bg-ceu text-tinta p-4 flex justify-between items-center no-underline font-bold shadow-[0_3px_0_rgba(43,42,51,0.10)]">
          <span>{naoLidas} mensage{naoLidas > 1 ? 'ns novas' : 'm nova'} das famílias</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}
      {cadastros > 0 && (
        <Link to="/admin/solicitacoes" className="rounded-2xl bg-sol text-tinta p-4 flex justify-between items-center no-underline font-bold shadow-[0_3px_0_rgba(43,42,51,0.10)]">
          <span>{cadastros} cadastro{cadastros > 1 ? 's' : ''} de família esperando aprovação</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}
      {erro && <p role="alert" className="rounded-xl bg-red-100 text-red-900 p-3 text-sm">{erro}</p>}
      {!resumo && !erro && <p className="text-suave">Carregando…</p>}

      {resumo && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Link to="/admin/criancas" className="bg-folha rounded-2xl p-4 no-underline text-tinta shadow-[0_3px_0_rgba(43,42,51,0.10)]">
              <p className="text-sm font-bold">Crianças ativas</p>
              <p className="text-4xl font-extrabold font-display">{resumo.ativas}</p>
            </Link>
            <Link to="/admin/hoje" className="bg-ceu rounded-2xl p-4 no-underline text-tinta shadow-[0_3px_0_rgba(43,42,51,0.10)]">
              <p className="text-sm font-bold">Presentes agora</p>
              <p className="text-4xl font-extrabold font-display">{resumo.presentes}</p>
            </Link>
            <Link to="/admin/financeiro" className="bg-lilas rounded-2xl p-4 no-underline text-tinta shadow-[0_3px_0_rgba(43,42,51,0.10)]">
              <p className="text-sm font-bold">Comprovantes a analisar</p>
              <p className="text-4xl font-extrabold font-display">{resumo.comprovantes}</p>
            </Link>
            <Link to="/admin/financeiro" className={`${resumo.atrasadas ? 'bg-coral' : 'bg-white'} rounded-2xl p-4 no-underline text-tinta shadow-[0_3px_0_rgba(43,42,51,0.10)]`}>
              <p className="text-sm font-bold">Mensalidades atrasadas</p>
              <p className="text-4xl font-extrabold font-display">{resumo.atrasadas}</p>
            </Link>
          </div>

          <Cartao className="flex flex-col gap-3">
            <div className="flex justify-between items-baseline">
              <h2 className="text-base font-bold">Mensalidades de {competenciaBR(competenciaAtual())}</h2>
              <span className="text-xs text-suave">
                vencem {dataBR(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toLocaleDateString('sv-SE'))}
              </span>
            </div>
            <ul className="flex gap-4 text-sm flex-wrap">
              <li><strong>{resumo.mes.pagas}</strong> pagas</li>
              <li><strong>{resumo.mes.analise}</strong> em análise</li>
              <li><strong>{resumo.mes.pendentes}</strong> em aberto</li>
            </ul>
            {resumo.mes.pagas + resumo.mes.analise + resumo.mes.pendentes === 0 && (
              <p className="text-sm text-suave">As mensalidades deste mês ainda não foram geradas.</p>
            )}
          </Cartao>
        </>
      )}
    </div>
  )
}
