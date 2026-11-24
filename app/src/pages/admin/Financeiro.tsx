import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { AreaTexto, Campo, Selecao, botaoPrincipal, botaoSecundario } from '../../components/Campos'
import { Folha } from '../../components/Folha'
import { useAuth } from '../../lib/auth'
import { dataISO } from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { competenciaBR, dataBR, dinheiro, rotuloStatus } from '../../lib/formato'
import { supabase } from '../../lib/supabase'
import type { StatusMensalidade } from '../../lib/tipos'

type LinhaMens = {
  id: number
  crianca_id: number
  competencia: string
  valor_final: number
  data_vencimento: string
  cancelada: boolean
  total_pago: number
  valor_em_aberto: number
  status: StatusMensalidade
  observacao: string | null
}
type Crianca = { id: number; nome_completo: string; status: string; plano: { nome: string; valor: number } | null }
type ComprovantePend = { id: number; mensalidade_id: number }
type Aba = 'ANALISE' | 'PENDENTE' | 'ATRASADO' | 'PAGO'

const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'ANALISE', rotulo: 'Em análise' },
  { valor: 'PENDENTE', rotulo: 'Pendentes' },
  { valor: 'ATRASADO', rotulo: 'Atrasadas' },
  { valor: 'PAGO', rotulo: 'Pagas' },
]

const inicioMes = (d = new Date()) => dataISO(new Date(d.getFullYear(), d.getMonth(), 1))
const somarMes = (iso: string, n: number) => {
  const [a, m] = iso.split('-').map(Number)
  return dataISO(new Date(a, m - 1 + n, 1))
}

// =====================================================================
// Financeiro da administração
// =====================================================================
export function AdminFinanceiro() {
  const [competencia, setCompetencia] = useState(inicioMes())
  const [doMes, setDoMes] = useState<LinhaMens[] | null>(null)
  const [atrasadas, setAtrasadas] = useState<LinhaMens[]>([])
  const [emAnalise, setEmAnalise] = useState<LinhaMens[]>([])
  const [criancas, setCriancas] = useState<Map<number, Crianca>>(new Map())
  const [aba, setAba] = useState<Aba>('ANALISE')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [gerando, setGerando] = useState(false)
  const [aberta, setAberta] = useState<LinhaMens | null>(null)
  const [automatica, setAutomatica] = useState<boolean | null>(null)
  const [mudandoAuto, setMudandoAuto] = useState(false)
  const [individual, setIndividual] = useState(false)

  const carregar = useCallback(async () => {
    if (!supabase) return
    supabase.from('configuracao').select('cobranca_automatica').maybeSingle()
      .then(({ data }) => setAutomatica(Boolean(data?.cobranca_automatica)))
    const [rM, rA, rC, rP] = await Promise.all([
      supabase.from('vw_mensalidade_status').select('*').eq('competencia', competencia),
      supabase.from('vw_mensalidade_status').select('*').eq('status', 'ATRASADO').order('data_vencimento'),
      supabase.from('crianca').select('id, nome_completo, status, plano(nome, valor)'),
      supabase.from('comprovante').select('id, mensalidade_id').eq('status', 'PENDENTE'),
    ])
    if (rM.error || rA.error || rC.error || rP.error) { setAviso({ tipo: 'erro', texto: 'Não foi possível carregar o financeiro.' }); return }
    setDoMes(rM.data as LinhaMens[])
    setAtrasadas(rA.data as LinhaMens[])
    setCriancas(new Map((rC.data as unknown as Crianca[]).map((c) => [c.id, c])))
    // "Em análise" mostra todos os meses que têm comprovante esperando conferência
    const ids = [...new Set((rP.data as ComprovantePend[]).map((c) => c.mensalidade_id))]
    if (ids.length) {
      const { data } = await supabase.from('vw_mensalidade_status').select('*').in('id', ids).order('competencia')
      setEmAnalise((data ?? []) as LinhaMens[])
    } else setEmAnalise([])
  }, [competencia])

  useEffect(() => { carregar() }, [carregar])

  const nome = (m: LinhaMens) => criancas.get(m.crianca_id)?.nome_completo ?? '—'
  const ordenar = (l: LinhaMens[]) => [...l].sort((a, b) => nome(a).localeCompare(nome(b), 'pt-BR'))

  const lista = useMemo(() => {
    if (aba === 'ANALISE') return emAnalise
    if (aba === 'ATRASADO') return atrasadas
    return ordenar((doMes ?? []).filter((m) => m.status === aba))
  }, [aba, doMes, atrasadas, emAnalise, criancas]) // eslint-disable-line react-hooks/exhaustive-deps

  const contagem: Record<Aba, number> = {
    ANALISE: emAnalise.length,
    PENDENTE: (doMes ?? []).filter((m) => m.status === 'PENDENTE').length,
    ATRASADO: atrasadas.length,
    PAGO: (doMes ?? []).filter((m) => m.status === 'PAGO').length,
  }

  const validas = (doMes ?? []).filter((m) => !m.cancelada)
  const previsto = validas.reduce((s, m) => s + Number(m.valor_final), 0)
  const recebido = validas.reduce((s, m) => s + Number(m.total_pago), 0)
  const aberto = validas.reduce((s, m) => s + Number(m.valor_em_aberto), 0)

  const gerar = async () => {
    if (!supabase) return
    setGerando(true)
    const { data, error } = await supabase.rpc('gerar_mensalidades', { p_competencia: competencia })
    setGerando(false)
    if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
    setAviso({ tipo: 'ok', texto: data === 0
      ? `As mensalidades de ${competenciaBR(competencia)} já estavam todas geradas.`
      : `${data} mensalidade${data === 1 ? '' : 's'} de ${competenciaBR(competencia)} gerada${data === 1 ? '' : 's'}.` })
    carregar()
  }

  const alternarAutomatica = async () => {
    if (!supabase || automatica === null) return
    const ligar = !automatica
    if (!ligar && !window.confirm('Desligar a cobrança automática? As próximas mensalidades terão de ser geradas pelo botão.')) return
    setMudandoAuto(true)
    const { data, error } = await supabase.rpc('definir_cobranca_automatica', { p_ligada: ligar })
    setMudandoAuto(false)
    if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
    setAutomatica(ligar)
    setAviso({ tipo: 'ok', texto: !ligar
      ? 'Cobrança automática desligada. Use o botão para gerar as mensalidades de cada mês.'
      : data > 0
        ? `Cobrança automática ligada. ${data} mensalidade${data === 1 ? '' : 's'} do mês atual já ${data === 1 ? 'foi gerada' : 'foram geradas'}.`
        : 'Cobrança automática ligada. Todo início de mês o sistema gera as mensalidades sozinho.' })
    carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Financeiro</h1>
        <div className="flex items-center justify-between bg-white rounded-2xl p-1">
          <button onClick={() => setCompetencia(somarMes(competencia, -1))} aria-label="Mês anterior" className="min-w-[44px] min-h-[44px] text-xl">‹</button>
          <span className="font-bold">{competenciaBR(competencia)}</span>
          <button onClick={() => setCompetencia(somarMes(competencia, 1))} aria-label="Próximo mês" className="min-w-[44px] min-h-[44px] text-xl">›</button>
        </div>
      </header>

      {automatica !== null && (
        <section className="bg-white rounded-2xl p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-bold">Cobrança automática</p>
            <p className="text-xs text-suave">
              {automatica
                ? 'Ligada: no início de cada mês o sistema gera sozinho as mensalidades, com o valor do plano. Você pode editar ou excluir qualquer cobrança.'
                : 'Desligada: você gera as mensalidades de cada mês pelo botão abaixo.'}
            </p>
          </div>
          <button role="switch" aria-checked={automatica} aria-label="Cobrança automática" onClick={alternarAutomatica} disabled={mudandoAuto}
            className={`shrink-0 w-14 h-8 rounded-full p-1 transition-colors disabled:opacity-60 ${automatica ? 'bg-marca' : 'bg-stone-300'}`}>
            <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${automatica ? 'translate-x-6' : ''}`} />
          </button>
        </section>
      )}

      {aviso && (
        <div role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`rounded-xl p-3 text-sm font-semibold ${aviso.tipo === 'erro' ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`}>
          {aviso.texto}
        </div>
      )}

      {doMes === null ? <p className="text-suave">Carregando…</p> : doMes.length === 0 ? (
        <section className="bg-white rounded-2xl p-4 flex flex-col gap-3">
          <p>As mensalidades de <strong>{competenciaBR(competencia)}</strong> ainda não foram geradas.</p>
          <p className="text-sm text-suave">O sistema cria uma para cada criança ativa, com o valor do plano e vencimento no último dia do mês.</p>
          <button onClick={gerar} disabled={gerando} className={botaoPrincipal}>
            {gerando ? 'Gerando…' : `Gerar mensalidades de ${competenciaBR(competencia)}`}
          </button>
        </section>
      ) : (
        <section className="bg-white rounded-2xl p-4 flex flex-col gap-3">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div><dt className="text-xs text-suave">Previsto</dt><dd className="font-bold">{dinheiro(previsto)}</dd></div>
            <div><dt className="text-xs text-suave">Recebido</dt><dd className="font-bold text-green-800">{dinheiro(recebido)}</dd></div>
            <div><dt className="text-xs text-suave">Em aberto</dt><dd className="font-bold text-alerta">{dinheiro(aberto)}</dd></div>
          </dl>
          <p className="text-xs text-suave text-center">
            {validas.length} mensalidade{validas.length === 1 ? '' : 's'} · vencimento {dataBR(validas[0]?.data_vencimento ?? competencia)}
          </p>
          <button onClick={gerar} disabled={gerando} className={`${botaoSecundario} border-dashed`}>
            {gerando ? 'Gerando…' : 'Gerar as que faltam (crianças novas)'}
          </button>
        </section>
      )}

      <button onClick={() => setIndividual(true)} className={botaoSecundario}>+ Cobrança individual (uma criança)</button>

      <div className="grid grid-cols-2 gap-1.5 bg-stone-200 p-1 rounded-2xl" role="tablist" aria-label="Situação">
        {ABAS.map((a) => (
          <button key={a.valor} role="tab" aria-selected={aba === a.valor} onClick={() => setAba(a.valor)}
            className={`min-h-[44px] rounded-xl text-sm font-bold ${aba === a.valor ? 'bg-white text-tinta shadow-sm' : 'text-stone-700'}`}>
            {a.rotulo} ({contagem[a.valor]})
          </button>
        ))}
      </div>
      {aba === 'ATRASADO' && <p className="text-xs text-suave -mt-2">Mostra atrasadas de todos os meses.</p>}

      {lista.length === 0 && doMes !== null && <p className="text-suave text-sm">Nada aqui.</p>}
      <ul className="flex flex-col gap-2.5">
        {lista.map((m) => (
          <li key={m.id}>
            <button onClick={() => setAberta(m)} className="w-full text-left bg-white rounded-2xl p-4 flex justify-between items-center gap-3">
              <div className="min-w-0">
                <p className="font-bold truncate">{nome(m)}</p>
                <p className="text-xs text-suave">
                  {criancas.get(m.crianca_id)?.plano?.nome ?? ''} · {competenciaBR(m.competencia)}
                  {m.status === 'ATRASADO' ? ` · venceu ${dataBR(m.data_vencimento)}` : ''}
                  {m.observacao ? ' · valor ajustado' : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="font-bold">{dinheiro(m.status === 'PAGO' ? m.valor_final : m.valor_em_aberto)}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${rotuloStatus[m.status].classe}`}>{rotuloStatus[m.status].texto}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <FolhaCobrancaIndividual
        aberta={individual}
        competenciaInicial={competencia}
        criancas={[...criancas.values()].filter((c) => c.status !== 'INATIVA').sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, 'pt-BR'))}
        aoFechar={() => setIndividual(false)}
        aoCriar={(texto, comp) => { setIndividual(false); setAviso({ tipo: 'ok', texto }); if (comp !== competencia) setCompetencia(comp); else carregar() }}
      />

      <FolhaMensalidade
        mensalidade={aberta}
        nomeCrianca={aberta ? nome(aberta) : ''}
        aoFechar={() => setAberta(null)}
        aoMudar={(texto) => { setAberta(null); setAviso({ tipo: 'ok', texto }); carregar() }}
      />
    </div>
  )
}

// =====================================================================
// Cobrança individual: uma criança, um mês, valor do plano ou outro (com motivo)
// =====================================================================
function FolhaCobrancaIndividual({ aberta, competenciaInicial, criancas, aoFechar, aoCriar }: {
  aberta: boolean
  competenciaInicial: string
  criancas: Crianca[]
  aoFechar: () => void
  aoCriar: (mensagem: string, competencia: string) => void
}) {
  const [criancaId, setCriancaId] = useState('')
  const [mes, setMes] = useState(competenciaInicial.slice(0, 7))
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberta) return
    setCriancaId(''); setMes(competenciaInicial.slice(0, 7)); setValor(''); setMotivo(''); setErro(null)
  }, [aberta, competenciaInicial])

  const escolhida = criancas.find((c) => String(c.id) === criancaId)
  const valorPlano = escolhida?.plano ? Number(escolhida.plano.valor) : null
  const formatar = (v: number) => v.toFixed(2).replace('.', ',')
  const valorNum = Number(valor.replace(/\./g, '').replace(',', '.'))
  const diferente = valorPlano !== null && valor.trim() !== '' && Number.isFinite(valorNum) && Math.abs(valorNum - valorPlano) > 0.004

  const escolher = (id: string) => {
    setCriancaId(id); setErro(null)
    const c = criancas.find((x) => String(x.id) === id)
    setValor(c?.plano ? formatar(Number(c.plano.valor)) : '')
  }

  const criar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (!escolhida) { setErro('Escolha a criança.'); return }
    if (!/^\d{4}-\d{2}$/.test(mes)) { setErro('Escolha o mês.'); return }
    if (valor.trim() === '' || !Number.isFinite(valorNum) || valorNum < 0) { setErro('Informe um valor válido.'); return }
    if (diferente && motivo.trim().length < 3) { setErro('O valor é diferente do plano: informe o motivo (a família vai ver).'); return }
    const comp = `${mes}-01`
    setSalvando(true)
    const { error } = await supabase.rpc('criar_cobranca_individual', {
      p_crianca: escolhida.id, p_competencia: comp, p_valor: valorNum, p_motivo: diferente ? motivo.trim() : null,
    })
    setSalvando(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoCriar(`Cobrança de ${competenciaBR(comp)} criada para ${escolhida.nome_completo} (${dinheiro(valorNum)}). A família foi avisada.`, comp)
  }

  if (!aberta) return null
  return (
    <Folha titulo="Cobrança individual" aberta={aberta} aoFechar={aoFechar}>
      <form onSubmit={criar} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-suave">Cria a mensalidade de uma criança só. O valor vem do plano, mas você pode mudar antes de criar.</p>
        <Selecao rotulo="Criança" value={criancaId} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolha…</option>
          {criancas.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}{c.plano ? ` · ${c.plano.nome}` : ''}</option>)}
        </Selecao>
        <Selecao rotulo="Mês da cobrança (vence no último dia do mês)" value={mes} onChange={(e) => setMes(e.target.value)}>
          {[-3, -2, -1, 0, 1, 2, 3].map((n) => {
            const c = somarMes(inicioMes(), n)
            return <option key={c} value={c.slice(0, 7)}>{competenciaBR(c)}</option>
          })}
          {![-3, -2, -1, 0, 1, 2, 3].some((n) => somarMes(inicioMes(), n).slice(0, 7) === mes) &&
            <option value={mes}>{competenciaBR(`${mes}-01`)}</option>}
        </Selecao>
        <Campo rotulo="Valor (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
          dica={valorPlano !== null ? `Valor do plano: ${dinheiro(valorPlano)}` : undefined} />
        {diferente && (
          <Campo rotulo="Motivo do valor diferente (a família vai ver)" value={motivo} onChange={(e) => setMotivo(e.target.value)}
            maxLength={200} placeholder="Ex.: entrou no meio do mês, desconto de irmãos" />
        )}
        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" disabled={salvando} className={botaoPrincipal}>{salvando ? 'Criando…' : 'Criar cobrança'}</button>
      </form>
    </Folha>
  )
}

// =====================================================================
// Detalhe da mensalidade: comprovantes e pagamento manual
// =====================================================================
type Comprovante = {
  id: number
  arquivo_path: string
  enviado_em: string
  status: 'PENDENTE' | 'ACEITO' | 'RECUSADO'
  motivo_recusa: string | null
  responsavel: { nome: string } | null
}
type Pagamento = { id: number; valor_pago: number; data_pagamento: string; forma: string }

function FolhaMensalidade({ mensalidade: m, nomeCrianca, aoFechar, aoMudar }: {
  mensalidade: LinhaMens | null
  nomeCrianca: string
  aoFechar: () => void
  aoMudar: (mensagem: string) => void
}) {
  const { usuario } = useAuth()
  const [comprovantes, setComprovantes] = useState<Comprovante[]>([])
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([])
  const [recusando, setRecusando] = useState<number | null>(null)
  const [motivo, setMotivo] = useState('')
  const [dataPag, setDataPag] = useState(dataISO())
  const [manual, setManual] = useState(false)
  const [forma, setForma] = useState('DINHEIRO')
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [ajuste, setAjuste] = useState<'nenhum' | 'editar' | 'excluir'>('nenhum')
  const [novoValor, setNovoValor] = useState('')
  const [motivoAjuste, setMotivoAjuste] = useState('')

  useEffect(() => {
    if (!m || !supabase) return
    setAjuste('nenhum'); setNovoValor(Number(m.valor_final).toFixed(2).replace('.', ',')); setMotivoAjuste('')
    setRecusando(null); setMotivo(''); setDataPag(dataISO()); setManual(false); setForma('DINHEIRO')
    setValor(Number(m.valor_em_aberto).toFixed(2).replace('.', ',')); setErro(null)
    supabase.from('comprovante').select('id, arquivo_path, enviado_em, status, motivo_recusa, responsavel(nome)')
      .eq('mensalidade_id', m.id).order('enviado_em', { ascending: false })
      .then(({ data }) => setComprovantes((data ?? []) as unknown as Comprovante[]))
    supabase.from('pagamento').select('id, valor_pago, data_pagamento, forma').eq('mensalidade_id', m.id)
      .then(({ data }) => setPagamentos((data ?? []) as Pagamento[]))
  }, [m])

  const verArquivo = async (caminho: string) => {
    if (!supabase) return
    const { data, error } = await supabase.storage.from('comprovantes').createSignedUrl(caminho, 300)
    if (error || !data) { setErro('Não foi possível abrir o arquivo.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  const confirmar = async (id: number) => {
    if (!supabase) return
    setOcupado(true)
    const { error } = await supabase.rpc('confirmar_comprovante', { p_comprovante: id, p_data_pagamento: dataPag })
    setOcupado(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoMudar(`Pagamento de ${nomeCrianca} confirmado. A família foi avisada.`)
  }

  const recusar = async (e: FormEvent, id: number) => {
    e.preventDefault()
    if (!supabase) return
    if (motivo.trim().length < 5) { setErro('Explique o motivo para a família (mínimo 5 letras).'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('recusar_comprovante', { p_comprovante: id, p_motivo: motivo.trim() })
    setOcupado(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoMudar('Comprovante recusado. A família recebeu o motivo.')
  }

  const registrarManual = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !m) return
    const v = Number(valor.replace(/\./g, '').replace(',', '.'))
    if (!(v > 0)) { setErro('Informe um valor maior que zero.'); return }
    if (dataPag > dataISO()) { setErro('A data do pagamento não pode ser no futuro.'); return }
    setOcupado(true)
    const { error } = await supabase.from('pagamento').insert({
      mensalidade_id: m.id, valor_pago: v, data_pagamento: dataPag, forma, confirmado_por: usuario?.id,
    })
    setOcupado(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoMudar(`Pagamento de ${dinheiro(v)} registrado para ${nomeCrianca}.`)
  }

  const editarValor = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !m) return
    const v = Number(novoValor.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(v) || v < 0 || novoValor.trim() === '') { setErro('Informe um valor válido.'); return }
    if (motivoAjuste.trim().length < 3) { setErro('Informe o motivo (a família vai ver).'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('editar_mensalidade', { p_mensalidade: m.id, p_valor: v, p_motivo: motivoAjuste.trim() })
    setOcupado(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoMudar(`Mensalidade de ${nomeCrianca} alterada para ${dinheiro(v)}. A família foi avisada.`)
  }

  const excluir = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !m) return
    if (motivoAjuste.trim().length < 3) { setErro('Informe o motivo da exclusão.'); return }
    setOcupado(true)
    const { error } = await supabase.rpc('excluir_mensalidade', { p_mensalidade: m.id, p_motivo: motivoAjuste.trim() })
    setOcupado(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoMudar(`Cobrança de ${competenciaBR(m.competencia)} de ${nomeCrianca} excluída. A família foi avisada.`)
  }

  if (!m) return null
  const pendentes = comprovantes.filter((c) => c.status === 'PENDENTE')
  const podeEditar = pendentes.length === 0
  const podeExcluir = pagamentos.length === 0 && !comprovantes.some((c) => c.status === 'PENDENTE' || c.status === 'ACEITO')

  return (
    <Folha titulo={`${nomeCrianca} · ${competenciaBR(m.competencia)}`} aberta={!!m} aoFechar={aoFechar}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-suave">Situação</dt>
        <dd><span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${rotuloStatus[m.status].classe}`}>{rotuloStatus[m.status].texto}</span></dd>
        <dt className="text-suave">Valor</dt><dd className="font-bold">{dinheiro(m.valor_final)}</dd>
        <dt className="text-suave">Vencimento</dt><dd>{dataBR(m.data_vencimento)}</dd>
        <dt className="text-suave">Pago</dt><dd>{dinheiro(m.total_pago)}</dd>
        <dt className="text-suave">Em aberto</dt><dd className="font-bold">{dinheiro(m.valor_em_aberto)}</dd>
      </dl>
      {m.observacao && <p className="text-sm rounded-xl bg-stone-100 p-3">Valor ajustado: {m.observacao}</p>}

      {pagamentos.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold">Pagamentos</p>
          {pagamentos.map((p) => <p key={p.id} className="text-suave">{dataBR(p.data_pagamento)} · {p.forma} · {dinheiro(p.valor_pago)}</p>)}
        </div>
      )}

      {pendentes.map((c) => (
        <section key={c.id} className="rounded-2xl border-2 border-indigo-300 p-4 flex flex-col gap-3">
          <p className="font-bold">Comprovante enviado</p>
          <p className="text-sm text-suave">
            Por {c.responsavel?.nome ?? '—'} em {new Date(c.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
          <button onClick={() => verArquivo(c.arquivo_path)} className={botaoSecundario}>Ver comprovante</button>
          <p className="rounded-xl bg-amber-50 text-amber-900 p-3 text-sm">
            Antes de confirmar, confira no extrato do seu banco se {dinheiro(m.valor_em_aberto)} entrou. O sistema não consulta o banco.
          </p>
          {recusando === c.id ? (
            <form onSubmit={(e) => recusar(e, c.id)} className="flex flex-col gap-3">
              <AreaTexto rotulo="Motivo da recusa (a família vai ver)" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                maxLength={300} placeholder="Ex.: o valor do comprovante é diferente da mensalidade." />
              <div className="flex gap-2">
                <button type="button" onClick={() => setRecusando(null)} className={`flex-1 ${botaoSecundario} border-stone-300 text-tinta`}>Voltar</button>
                <button type="submit" disabled={ocupado} className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold">Enviar recusa</button>
              </div>
            </form>
          ) : (
            <>
              <Campo rotulo="Data em que o dinheiro entrou" type="date" max={dataISO()} value={dataPag} onChange={(e) => setDataPag(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => { setRecusando(c.id); setErro(null) }} className="flex-1 min-h-[48px] rounded-xl border-[1.5px] border-red-700 text-red-800 bg-white text-sm font-bold">Recusar</button>
                <button onClick={() => confirmar(c.id)} disabled={ocupado} className="flex-1 min-h-[48px] rounded-xl bg-marca text-white text-sm font-bold disabled:opacity-60">Confirmar pagamento</button>
              </div>
            </>
          )}
        </section>
      ))}

      {comprovantes.filter((c) => c.status === 'RECUSADO').map((c) => (
        <p key={c.id} className="text-sm text-red-800">Comprovante recusado em {new Date(c.enviado_em).toLocaleDateString('pt-BR')}: {c.motivo_recusa}</p>
      ))}

      {ajuste === 'nenhum' && Number(m.valor_em_aberto) > 0 && !m.cancelada && pendentes.length === 0 && (
        manual ? (
          <form onSubmit={registrarManual} className="flex flex-col gap-3 border-t border-borda pt-4">
            <p className="font-bold">Registrar pagamento recebido</p>
            <Selecao rotulo="Forma" value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="DINHEIRO">Dinheiro</option>
              <option value="PIX">Pix (recebido fora do app)</option>
              <option value="OUTRO">Outro</option>
            </Selecao>
            <Campo rotulo="Valor recebido (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            <Campo rotulo="Data do pagamento" type="date" max={dataISO()} value={dataPag} onChange={(e) => setDataPag(e.target.value)} />
            <button type="submit" disabled={ocupado} className={botaoPrincipal}>{ocupado ? 'Salvando…' : 'Registrar pagamento'}</button>
          </form>
        ) : (
          <button onClick={() => { setManual(true); setErro(null) }} className={botaoSecundario}>Registrar pagamento em dinheiro ou fora do app</button>
        )
      )}

      {ajuste === 'editar' && (
        <form onSubmit={editarValor} className="flex flex-col gap-3 border-t border-borda pt-4">
          <p className="font-bold">Editar valor desta cobrança</p>
          <Campo rotulo="Novo valor (R$)" inputMode="decimal" value={novoValor} onChange={(e) => setNovoValor(e.target.value)} />
          <Campo rotulo="Motivo (a família vai ver)" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} maxLength={200}
            placeholder="Ex.: desconto de irmãos, entrou no meio do mês" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAjuste('nenhum'); setErro(null) }} className={`flex-1 ${botaoSecundario} border-stone-300 text-tinta`}>Voltar</button>
            <button type="submit" disabled={ocupado} className="flex-1 min-h-[44px] rounded-xl bg-marca text-white text-sm font-bold disabled:opacity-60">{ocupado ? 'Salvando…' : 'Salvar valor'}</button>
          </div>
        </form>
      )}

      {ajuste === 'excluir' && (
        <form onSubmit={excluir} className="flex flex-col gap-3 border-t border-borda pt-4">
          <p className="font-bold text-red-800">Excluir esta cobrança</p>
          <p className="text-sm text-suave">A mensalidade some do sistema e a família recebe um aviso. Isso não pode ser desfeito. (Se depois você usar "Gerar as que faltam" neste mês, ela é criada de novo.)</p>
          <Campo rotulo="Motivo" value={motivoAjuste} onChange={(e) => setMotivoAjuste(e.target.value)} maxLength={200}
            placeholder="Ex.: gerada por engano, criança saiu do hotelzinho" />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setAjuste('nenhum'); setErro(null) }} className={`flex-1 ${botaoSecundario} border-stone-300 text-tinta`}>Voltar</button>
            <button type="submit" disabled={ocupado} className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold disabled:opacity-60">{ocupado ? 'Excluindo…' : 'Excluir cobrança'}</button>
          </div>
        </form>
      )}

      {ajuste === 'nenhum' && !manual && (podeEditar || podeExcluir) && (
        <div className="flex gap-2 border-t border-borda pt-4">
          {podeEditar && (
            <button onClick={() => { setAjuste('editar'); setErro(null) }} className={`flex-1 ${botaoSecundario}`}>Editar valor</button>
          )}
          {podeExcluir && (
            <button onClick={() => { setAjuste('excluir'); setErro(null) }}
              className="flex-1 min-h-[44px] px-4 rounded-xl border-[1.5px] border-red-700 text-red-800 bg-white text-sm font-bold">Excluir cobrança</button>
          )}
        </div>
      )}
      {!podeExcluir && ajuste === 'nenhum' && (
        <p className="text-xs text-suave">Cobranças com pagamento ou comprovante não podem ser excluídas. Se o valor estiver errado, use "Editar valor".</p>
      )}

      {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
    </Folha>
  )
}
