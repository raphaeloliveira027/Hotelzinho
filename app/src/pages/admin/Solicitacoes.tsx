import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AreaTexto, Campo, Marcar, Selecao, botaoPrincipal } from '../../components/Campos'
import { Folha } from '../../components/Folha'
import { ROTULO_TURNO, type CriancaInformada } from '../../lib/criancaCadastro'
import { dataBR, dinheiro, idade } from '../../lib/formato'
import { supabase } from '../../lib/supabase'
import { problemaTelefone } from '../../lib/telefone'

type Solicitacao = {
  id: number
  nome: string
  telefone: string
  email: string
  criancas_texto: string | null
  criancas_dados: CriancaInformada[] | null
  parentesco: string | null
  aceite_termo_em: string | null
  criado_em: string
}
type CriancaOpcao = { id: number; nome_completo: string }
type PlanoOpcao = { id: number; nome: string; turno: string; valor: number }

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/** Cadastros feitos pelas famílias no app, esperando a administração aprovar ou recusar. */
export function AdminSolicitacoes() {
  const [lista, setLista] = useState<Solicitacao[] | null>(null)
  const [criancas, setCriancas] = useState<CriancaOpcao[]>([])
  const [planos, setPlanos] = useState<PlanoOpcao[]>([])
  const [aprovando, setAprovando] = useState<Solicitacao | null>(null)
  const [recusando, setRecusando] = useState<Solicitacao | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!supabase) return
    const [rS, rC, rP] = await Promise.all([
      supabase.from('solicitacao_cadastro')
        .select('id, nome, telefone, email, criancas_texto, criancas_dados, parentesco, aceite_termo_em, criado_em')
        .eq('status', 'PENDENTE').order('criado_em'),
      supabase.from('crianca').select('id, nome_completo').neq('status', 'INATIVA').order('nome_completo'),
      supabase.from('plano').select('id, nome, turno, valor').eq('ativo', true).order('valor'),
    ])
    setLista((rS.data ?? []) as Solicitacao[])
    setCriancas((rC.data ?? []) as CriancaOpcao[])
    setPlanos((rP.data ?? []) as PlanoOpcao[])
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const concluir = (msg: string) => { setAprovando(null); setRecusando(null); setAviso(msg); carregar() }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-suave">Famílias que se cadastraram pelo app</p>
        <h1 className="text-2xl font-bold">Cadastros para aprovar</h1>
      </header>
      {aviso && <p role="status" className="rounded-xl bg-green-100 text-green-900 p-3 text-sm font-semibold">{aviso}</p>}
      {lista === null && <p className="text-suave">Carregando…</p>}
      {lista?.length === 0 && <p className="bg-white rounded-2xl p-4 text-suave">Nenhum cadastro esperando aprovação.</p>}

      {lista?.map((s) => {
        const probTel = problemaTelefone(s.telefone)
        return (
          <section key={s.id} className="bg-white rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex justify-between items-baseline gap-2">
              <h2 className="font-bold">{s.nome}</h2>
              <span className="text-xs text-suave">{quando(s.criado_em)}</span>
            </div>
            <p className="text-sm">{s.telefone} · {s.email}</p>
            {probTel && <p className="text-xs font-semibold text-alerta">Telefone com problema: {probTel}</p>}
            <ul className="flex flex-col gap-1.5">
              {criancasDoPedido(s).map((c, i) => (
                <li key={i} className="rounded-xl bg-fundo px-3 py-2 text-sm">
                  <strong>{c.nome}</strong>
                  {c.nascimento && <span className="text-suave"> · {idade(c.nascimento)}</span>}
                  {c.turno && <span className="text-suave"> · {ROTULO_TURNO[c.turno]}</span>}
                  {c.alergias && <span className="block text-xs font-semibold text-alerta">Alergias: {c.alergias}</span>}
                </li>
              ))}
            </ul>
            {s.parentesco && <p className="text-sm"><span className="text-suave">Parentesco:</span> {s.parentesco}</p>}
            <p className="text-xs text-suave">{s.aceite_termo_em ? 'Aceitou o termo de privacidade.' : 'Não registrou aceite do termo.'}</p>
            <p className="text-xs text-suave">Confira com a família (por telefone ou pessoalmente) antes de aprovar.</p>
            <div className="flex gap-2 mt-1">
              <button onClick={() => setRecusando(s)} className="flex-1 min-h-[44px] rounded-xl border-[1.5px] border-red-700 text-red-800 bg-white text-sm font-bold">Recusar</button>
              <button onClick={() => setAprovando(s)} className="flex-1 min-h-[44px] rounded-xl bg-marca text-white text-sm font-bold">Aprovar</button>
            </div>
          </section>
        )
      })}

      <FolhaAprovar solicitacao={aprovando} criancas={criancas} planos={planos} aoFechar={() => setAprovando(null)} aoConcluir={concluir} />
      <FolhaRecusar solicitacao={recusando} aoFechar={() => setRecusando(null)} aoConcluir={concluir} />
    </div>
  )
}

type Decisao = CriancaInformada & {
  acao: 'NOVA' | 'EXISTENTE' | 'NAO'
  criancaId: string
  planoId: string
  situacao: 'ATIVA' | 'EM_ADAPTACAO'
}

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()

/** O que a família informou: os dados completos (0008) ou só os nomes (cadastros antigos). */
const criancasDoPedido = (s: Solicitacao): CriancaInformada[] =>
  s.criancas_dados?.length
    ? s.criancas_dados
    : (s.criancas_texto ?? '').split(',').map((n) => n.trim()).filter((n) => n.length >= 2).map((nome) => ({ nome }))

function FolhaAprovar({ solicitacao: s, criancas, planos, aoFechar, aoConcluir }: {
  solicitacao: Solicitacao | null
  criancas: CriancaOpcao[]
  planos: PlanoOpcao[]
  aoFechar: () => void
  aoConcluir: (msg: string) => void
}) {
  const [decisoes, setDecisoes] = useState<Decisao[]>([])
  const [parentesco, setParentesco] = useState('')
  const [financeiro, setFinanceiro] = useState(true)
  const [buscar, setBuscar] = useState(true)
  const [emergencia, setEmergencia] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!s) return
    setDecisoes(criancasDoPedido(s).map((c) => {
      // Se já existe criança com o mesmo nome completo, sugere ligar a ela em vez de criar outra
      const igual = criancas.find((x) => normalizar(x.nome_completo) === normalizar(c.nome))
      const plano = planos.find((p) => p.turno === c.turno)
      return {
        ...c, acao: igual ? 'EXISTENTE' : 'NOVA', criancaId: igual ? String(igual.id) : '',
        planoId: plano ? String(plano.id) : '', situacao: 'ATIVA',
      }
    }))
    setParentesco(s.parentesco ?? ''); setFinanceiro(true); setBuscar(true); setEmergencia(true); setErro(null)
  }, [s, criancas, planos])

  const mudar = (i: number, campo: keyof Decisao, valor: string) =>
    setDecisoes((lista) => lista.map((d, j) => (j === i ? { ...d, [campo]: valor } : d)))

  const aprovar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !s) return
    const escolhidas = decisoes.filter((d) => d.acao !== 'NAO')
    const hoje = new Date().toLocaleDateString('sv-SE')
    for (const d of escolhidas) {
      const quem = d.nome || 'a criança'
      if (d.acao === 'EXISTENTE' && !d.criancaId) { setErro(`Escolha qual criança cadastrada é ${quem}.`); return }
      if (d.acao === 'NOVA') {
        if (d.nome.trim().length < 3) { setErro('Informe o nome completo da criança.'); return }
        if (!d.nascimento || d.nascimento > hoje) { setErro(`Confira a data de nascimento de ${quem}.`); return }
        if (!d.planoId) { setErro(`Escolha o plano de ${quem}.`); return }
      }
    }
    if (escolhidas.length && parentesco.trim().length < 2) { setErro('Informe o parentesco com a criança.'); return }
    setSalvando(true)
    const { error } = await supabase.rpc('aprovar_cadastro', {
      p_solicitacao: s.id,
      p_criancas: escolhidas.map((d) => d.acao === 'EXISTENTE'
        ? { acao: 'EXISTENTE', crianca_id: Number(d.criancaId) }
        : {
            acao: 'NOVA', nome: d.nome.trim(), nascimento: d.nascimento, plano_id: Number(d.planoId), status: d.situacao,
            alergias: d.alergias ?? null, restricoes: d.restricoes ?? null, saude: d.saude ?? null,
          }),
      p_parentesco: escolhidas.length ? parentesco.trim() : null,
      p_financeiro: financeiro, p_buscar: buscar, p_emergencia: emergencia,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const novas = escolhidas.filter((d) => d.acao === 'NOVA').length
    aoConcluir(`Cadastro de ${s.nome} aprovado${novas ? ` e ${novas === 1 ? '1 criança cadastrada' : `${novas} crianças cadastradas`}` : ''}. O acesso já está liberado.`)
  }

  if (!s) return null
  const algumaCrianca = decisoes.some((d) => d.acao !== 'NAO')
  return (
    <Folha titulo={`Aprovar ${s.nome}`} aberta={!!s} aoFechar={aoFechar}>
      <form onSubmit={aprovar} noValidate className="flex flex-col gap-4">
        {decisoes.length === 0 && <p className="text-sm text-suave">A família não informou nenhuma criança.</p>}
        {decisoes.map((d, i) => (
          <fieldset key={i} className="rounded-2xl border-2 border-sol p-3.5 flex flex-col gap-3">
            <legend className="px-1.5 font-extrabold">{d.nome || `Criança ${i + 1}`}</legend>
            <p className="text-xs text-suave">
              Informado pela família: {d.nascimento ? `nasceu em ${dataBR(d.nascimento)} (${idade(d.nascimento)})` : 'sem data de nascimento'}
              {d.turno ? ` · ${ROTULO_TURNO[d.turno]}` : ''}
            </p>
            <Selecao rotulo="O que fazer com esta criança" value={d.acao} onChange={(e) => mudar(i, 'acao', e.target.value)}>
              <option value="NOVA">Aprovar e cadastrar como nova</option>
              <option value="EXISTENTE">Já está cadastrada: só vincular</option>
              <option value="NAO">Não aprovar esta criança</option>
            </Selecao>
            {d.acao === 'EXISTENTE' && (
              <Selecao rotulo="Criança cadastrada" value={d.criancaId} onChange={(e) => mudar(i, 'criancaId', e.target.value)}>
                <option value="">Escolha…</option>
                {criancas.map((c) => <option key={c.id} value={c.id}>{c.nome_completo}</option>)}
              </Selecao>
            )}
            {d.acao === 'NOVA' && (
              <>
                <Campo rotulo="Nome completo" value={d.nome} onChange={(e) => mudar(i, 'nome', e.target.value)} maxLength={150} />
                <Campo rotulo="Data de nascimento" type="date" value={d.nascimento ?? ''} onChange={(e) => mudar(i, 'nascimento', e.target.value)} />
                <Selecao rotulo="Plano" value={d.planoId} onChange={(e) => mudar(i, 'planoId', e.target.value)}>
                  <option value="">Escolha…</option>
                  {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} — {dinheiro(p.valor)}</option>)}
                </Selecao>
                <Selecao rotulo="Situação" value={d.situacao} onChange={(e) => mudar(i, 'situacao', e.target.value)}>
                  <option value="ATIVA">Ativa</option>
                  <option value="EM_ADAPTACAO">Em adaptação</option>
                </Selecao>
                <Campo rotulo="Alergias" value={d.alergias ?? ''} onChange={(e) => mudar(i, 'alergias', e.target.value)} maxLength={500} />
                <Campo rotulo="Restrições alimentares" value={d.restricoes ?? ''} onChange={(e) => mudar(i, 'restricoes', e.target.value)} maxLength={500} />
                <Campo rotulo="Saúde (informado pela família)" value={d.saude ?? ''} onChange={(e) => mudar(i, 'saude', e.target.value)} maxLength={500} />
              </>
            )}
          </fieldset>
        ))}
        {algumaCrianca && (
          <>
            <Campo rotulo="Parentesco do responsável" value={parentesco} onChange={(e) => setParentesco(e.target.value)} maxLength={40} />
            <div className="flex flex-col">
              <Marcar rotulo="Responsável pelo pagamento" checked={financeiro} onChange={(e) => setFinanceiro(e.target.checked)} />
              <Marcar rotulo="Autorizado a buscar a criança" checked={buscar} onChange={(e) => setBuscar(e.target.checked)} />
              <Marcar rotulo="Contato de emergência" checked={emergencia} onChange={(e) => setEmergencia(e.target.checked)} />
            </div>
          </>
        )}
        <p className="text-xs text-suave">Os dados de saúde são os informados pela família. Confira com ela antes de aprovar.</p>
        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" disabled={salvando} className={botaoPrincipal}>{salvando ? 'Aprovando…' : 'Aprovar cadastro'}</button>
      </form>
    </Folha>
  )
}

function FolhaRecusar({ solicitacao: s, aoFechar, aoConcluir }: {
  solicitacao: Solicitacao | null
  aoFechar: () => void
  aoConcluir: (msg: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => { setMotivo(''); setErro(null) }, [s])

  const recusar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !s) return
    if (motivo.trim().length < 5) { setErro('Explique o motivo (a pessoa vai ver).'); return }
    const { error } = await supabase.rpc('recusar_cadastro', { p_solicitacao: s.id, p_motivo: motivo.trim() })
    if (error) { setErro(error.message); return }
    aoConcluir(`Cadastro de ${s.nome} recusado.`)
  }

  if (!s) return null
  return (
    <Folha titulo={`Recusar ${s.nome}`} aberta={!!s} aoFechar={aoFechar}>
      <form onSubmit={recusar} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo (a pessoa vai ver)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300}
          placeholder="Ex.: não encontramos criança matriculada com esse nome." />
        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" className="min-h-[52px] rounded-2xl bg-red-700 text-white font-bold">Recusar cadastro</button>
      </form>
    </Folha>
  )
}
