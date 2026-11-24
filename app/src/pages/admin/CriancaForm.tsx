import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AreaTexto, Campo, CampoTelefone, Marcar, Selecao, botaoPrincipal, botaoSecundario } from '../../components/Campos'
import { Folha } from '../../components/Folha'
import { dataISO } from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { dinheiro } from '../../lib/formato'
import { supabase } from '../../lib/supabase'
import { problemaTelefone } from '../../lib/telefone'

type Plano = { id: number; nome: string; valor: number }
type StatusCrianca = 'ATIVA' | 'EM_ADAPTACAO' | 'INATIVA'

type Dados = {
  nome_completo: string
  data_nascimento: string
  sexo: string
  endereco: string
  status: StatusCrianca
  plano_id: string
  alergias: string
  restricoes_alimentares: string
  info_saude: string
  observacoes: string
}

const VAZIO: Dados = {
  nome_completo: '', data_nascimento: '', sexo: '', endereco: '', status: 'ATIVA', plano_id: '',
  alergias: '', restricoes_alimentares: '', info_saude: '', observacoes: '',
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const nulo = (s: string) => (s.trim() === '' ? null : s.trim())

/** Valida os dados antes de enviar (o banco valida de novo). */
function validar(d: Dados) {
  const e: Partial<Record<keyof Dados, string>> = {}
  if (d.nome_completo.trim().length < 3) e.nome_completo = 'Escreva o nome completo.'
  if (!d.data_nascimento) e.data_nascimento = 'Informe a data de nascimento.'
  else if (d.data_nascimento > dataISO()) e.data_nascimento = 'A data não pode ser no futuro.'
  if (d.status !== 'INATIVA' && !d.plano_id) e.plano_id = 'Escolha o plano.'
  return e
}

// =====================================================================
// Cadastro e edição da criança
// =====================================================================
export function AdminCriancaForm() {
  const { id } = useParams()
  const novo = !id
  const navegar = useNavigate()
  const local = useLocation()
  const [planos, setPlanos] = useState<Plano[]>([])
  const [dados, setDados] = useState<Dados>(VAZIO)
  const [erros, setErros] = useState<Partial<Record<keyof Dados, string>>>({})
  const [carregando, setCarregando] = useState(!novo)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(
    (local.state as { aviso?: string } | null)?.aviso ? { tipo: 'ok', texto: (local.state as { aviso: string }).aviso } : null)

  useEffect(() => {
    if (!supabase) return
    supabase.from('plano').select('id, nome, valor').eq('ativo', true).order('valor').order('nome')
      .then(({ data }) => setPlanos((data ?? []) as Plano[]))
    if (novo) { setDados(VAZIO); setCarregando(false); return }
    supabase.from('crianca').select('*').eq('id', id).maybeSingle().then(({ data }) => {
      if (data) {
        const t = (v: unknown) => (v == null ? '' : String(v))
        setDados({
          nome_completo: t(data.nome_completo), data_nascimento: t(data.data_nascimento), sexo: t(data.sexo),
          endereco: t(data.endereco), status: data.status, plano_id: t(data.plano_id), alergias: t(data.alergias),
          restricoes_alimentares: t(data.restricoes_alimentares), info_saude: t(data.info_saude), observacoes: t(data.observacoes),
        })
      } else {
        setAviso({ tipo: 'erro', texto: 'Criança não encontrada.' })
      }
      setCarregando(false)
    })
  }, [id, novo])

  const mudar = (campo: keyof Dados) => (e: { target: { value: string } }) => {
    setDados((d) => ({ ...d, [campo]: e.target.value }))
    setErros((x) => ({ ...x, [campo]: undefined }))
  }

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const problemas = validar(dados)
    setErros(problemas)
    if (Object.keys(problemas).length) { setAviso({ tipo: 'erro', texto: 'Confira os campos marcados.' }); return }
    const registro = {
      nome_completo: dados.nome_completo.trim(),
      data_nascimento: dados.data_nascimento,
      sexo: nulo(dados.sexo),
      endereco: nulo(dados.endereco),
      status: dados.status,
      plano_id: dados.plano_id ? Number(dados.plano_id) : null,
      alergias: nulo(dados.alergias),
      restricoes_alimentares: nulo(dados.restricoes_alimentares),
      info_saude: nulo(dados.info_saude),
      observacoes: nulo(dados.observacoes),
    }
    setSalvando(true)
    if (novo) {
      const { data, error } = await supabase.from('crianca').insert(registro).select('id').single()
      setSalvando(false)
      if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
      navegar(`/admin/criancas/${data.id}`, { replace: true, state: { aviso: 'Criança cadastrada. Agora vincule os responsáveis abaixo.' } })
    } else {
      const { error } = await supabase.from('crianca').update(registro).eq('id', id)
      setSalvando(false)
      if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
      setAviso({ tipo: 'ok', texto: 'Alterações salvas.' })
    }
    window.scrollTo({ top: 0 })
  }

  if (carregando) return <p className="text-suave">Carregando…</p>

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Link to="/admin/criancas" className="self-start min-h-[44px] flex items-center text-sm font-semibold">‹ Crianças</Link>
        <div className="flex justify-between items-center gap-3">
          <h1 className="text-2xl font-bold">{novo ? 'Nova criança' : dados.nome_completo || 'Criança'}</h1>
          {!novo && <Link to={`/admin/mensagens/${id}`} className={botaoSecundario}>Mensagens</Link>}
        </div>
      </header>

      {aviso && (
        <div role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`rounded-xl p-3 text-sm font-semibold ${aviso.tipo === 'erro' ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`}>
          {aviso.texto}
        </div>
      )}

      <form onSubmit={salvar} noValidate className="flex flex-col gap-5">
        <section className="bg-white rounded-2xl p-4 flex flex-col gap-4">
          <h2 className="font-bold">Dados da criança</h2>
          <Campo rotulo="Nome completo" value={dados.nome_completo} onChange={mudar('nome_completo')} maxLength={150} autoComplete="off" erro={erros.nome_completo} />
          <Campo rotulo="Data de nascimento" type="date" max={dataISO()} value={dados.data_nascimento} onChange={mudar('data_nascimento')} erro={erros.data_nascimento} />
          <Selecao rotulo="Sexo (opcional)" value={dados.sexo} onChange={mudar('sexo')}>
            <option value="">Não informar</option>
            <option value="Feminino">Feminino</option>
            <option value="Masculino">Masculino</option>
          </Selecao>
          <Campo rotulo="Endereço (opcional)" value={dados.endereco} onChange={mudar('endereco')} maxLength={255} />
        </section>

        <section className="bg-white rounded-2xl p-4 flex flex-col gap-4">
          <h2 className="font-bold">Matrícula</h2>
          <Selecao rotulo="Plano" value={dados.plano_id} onChange={mudar('plano_id')} erro={erros.plano_id}>
            <option value="">Escolha…</option>
            {planos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {dinheiro(p.valor)}</option>)}
          </Selecao>
          <Selecao rotulo="Situação" value={dados.status} onChange={mudar('status')}>
            <option value="ATIVA">Ativa</option>
            <option value="EM_ADAPTACAO">Em adaptação</option>
            <option value="INATIVA">Inativa (saiu do hotelzinho)</option>
          </Selecao>
        </section>

        <section className="bg-white rounded-2xl p-4 flex flex-col gap-4">
          <div>
            <h2 className="font-bold">Cuidados</h2>
            <p className="text-xs text-suave">Registre somente o que a família informou. Deixe em branco o que não se aplica.</p>
          </div>
          <AreaTexto rotulo="Alergias" value={dados.alergias} onChange={mudar('alergias')} maxLength={500} placeholder="Ex.: amendoim" />
          <AreaTexto rotulo="Restrições alimentares" value={dados.restricoes_alimentares} onChange={mudar('restricoes_alimentares')} maxLength={500} placeholder="Ex.: sem lactose" />
          <AreaTexto rotulo="Informações de saúde importantes para o cuidado" value={dados.info_saude} onChange={mudar('info_saude')} maxLength={1000} />
          <AreaTexto rotulo="Observações" value={dados.observacoes} onChange={mudar('observacoes')} maxLength={1000} />
        </section>

        <button type="submit" disabled={salvando} className={botaoPrincipal}>
          {salvando ? 'Salvando…' : novo ? 'Cadastrar criança' : 'Salvar alterações'}
        </button>
      </form>

      {!novo && id && <SecaoResponsaveis criancaId={Number(id)} />}
    </div>
  )
}

// =====================================================================
// Responsáveis vinculados à criança
// =====================================================================
type Responsavel = { id: number; nome: string; telefone: string; email: string | null; usuario_id: string | null }
type Vinculo = {
  parentesco: string
  eh_financeiro: boolean
  autorizado_buscar: boolean
  contato_emergencia: boolean
  responsavel: Responsavel | null
}

function SecaoResponsaveis({ criancaId }: { criancaId: number }) {
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null)
  const [adicionando, setAdicionando] = useState(false)
  const [removendo, setRemovendo] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('crianca_responsavel')
      .select('parentesco, eh_financeiro, autorizado_buscar, contato_emergencia, responsavel(id, nome, telefone, email, usuario_id)')
      .eq('crianca_id', criancaId)
    setVinculos((data ?? []) as unknown as Vinculo[])
  }, [criancaId])

  useEffect(() => { carregar() }, [carregar])

  const remover = async (respId: number) => {
    if (!supabase) return
    const { error } = await supabase.from('crianca_responsavel').delete().eq('crianca_id', criancaId).eq('responsavel_id', respId)
    setRemovendo(null)
    setAviso(error ? mensagemDeErro(error) : 'Vínculo removido.')
    carregar()
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="titulo-resp">
      <div className="flex justify-between items-center gap-3">
        <h2 id="titulo-resp" className="text-lg font-bold">Responsáveis</h2>
        <button onClick={() => setAdicionando(true)} className={botaoSecundario}>+ Adicionar</button>
      </div>
      {aviso && <p role="status" className="rounded-xl bg-green-100 text-green-900 p-3 text-sm font-semibold">{aviso}</p>}
      {vinculos === null && <p className="text-suave">Carregando…</p>}
      {vinculos?.length === 0 && (
        <p className="bg-orange-50 text-orange-900 rounded-2xl p-4 text-sm">
          Nenhum responsável vinculado. Adicione pelo menos um, para saber quem pode buscar a criança.
        </p>
      )}
      {vinculos?.map((v) => v.responsavel && (
        <div key={v.responsavel.id} className="bg-white rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex justify-between items-baseline gap-2">
            <p className="font-bold">{v.responsavel.nome}</p>
            <p className="text-sm text-suave">{v.parentesco}</p>
          </div>
          <p className="text-sm">{v.responsavel.telefone}{v.responsavel.email ? ` · ${v.responsavel.email}` : ''}</p>
          <div className="flex flex-wrap gap-1.5">
            {v.eh_financeiro && <span className="px-2.5 py-0.5 rounded-full bg-marca-clara text-marca-escura text-xs font-bold">Financeiro</span>}
            {v.autorizado_buscar && <span className="px-2.5 py-0.5 rounded-full bg-marca-clara text-marca-escura text-xs font-bold">Pode buscar</span>}
            {v.contato_emergencia && <span className="px-2.5 py-0.5 rounded-full bg-marca-clara text-marca-escura text-xs font-bold">Emergência</span>}
          </div>
          <p className={`text-xs ${v.responsavel.usuario_id ? 'text-green-800 font-semibold' : 'text-suave'}`}>
            {v.responsavel.usuario_id
              ? 'Tem acesso ao app.'
              : v.responsavel.email
                ? `Ainda sem acesso ao app. Crie o login no Supabase (Authentication › Users) com o e-mail ${v.responsavel.email}: o vínculo é automático.`
                : 'Sem e-mail cadastrado: não terá acesso ao app.'}
          </p>
          {removendo === v.responsavel.id ? (
            <div className="flex gap-2">
              <button onClick={() => setRemovendo(null)} className={`flex-1 ${botaoSecundario} border-stone-300 text-tinta`}>Cancelar</button>
              <button onClick={() => remover(v.responsavel!.id)} className="flex-1 min-h-[44px] rounded-xl bg-red-700 text-white text-sm font-bold">Confirmar remoção</button>
            </div>
          ) : (
            <button onClick={() => setRemovendo(v.responsavel!.id)} className="self-start min-h-[44px] text-sm font-semibold text-red-800">
              Remover vínculo
            </button>
          )}
        </div>
      ))}

      <FolhaResponsavel
        aberta={adicionando}
        criancaId={criancaId}
        jaVinculados={(vinculos ?? []).map((v) => v.responsavel?.id).filter((x): x is number => !!x)}
        aoFechar={() => setAdicionando(false)}
        aoSalvar={(msg) => { setAdicionando(false); setAviso(msg); carregar() }}
      />
    </section>
  )
}

function FolhaResponsavel({ aberta, criancaId, jaVinculados, aoFechar, aoSalvar }: {
  aberta: boolean
  criancaId: number
  jaVinculados: number[]
  aoFechar: () => void
  aoSalvar: (mensagem: string) => void
}) {
  const [modo, setModo] = useState<'novo' | 'existente'>('novo')
  const [existentes, setExistentes] = useState<Responsavel[]>([])
  const [escolhido, setEscolhido] = useState('')
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [parentesco, setParentesco] = useState('')
  const [financeiro, setFinanceiro] = useState(false)
  const [buscar, setBuscar] = useState(true)
  const [emergencia, setEmergencia] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberta || !supabase) return
    setModo('novo'); setEscolhido(''); setNome(''); setTelefone(''); setEmail(''); setParentesco('')
    setFinanceiro(false); setBuscar(true); setEmergencia(false); setErro(null)
    supabase.from('responsavel').select('id, nome, telefone, email, usuario_id').order('nome')
      .then(({ data }) => setExistentes(((data ?? []) as Responsavel[]).filter((r) => !jaVinculados.includes(r.id))))
  }, [aberta]) // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (parentesco.trim().length < 2) { setErro('Informe o parentesco (ex.: Mãe, Pai, Avó).'); return }
    let respId: number
    let nomeResp: string
    setSalvando(true)
    if (modo === 'existente') {
      if (!escolhido) { setSalvando(false); setErro('Escolha o responsável.'); return }
      respId = Number(escolhido)
      nomeResp = existentes.find((r) => r.id === respId)?.nome ?? ''
    } else {
      if (nome.trim().length < 3) { setSalvando(false); setErro('Escreva o nome completo do responsável.'); return }
      const probTel = problemaTelefone(telefone.trim())
      if (probTel) { setSalvando(false); setErro(`Telefone inválido: ${probTel}`); return }
      if (email.trim() && !EMAIL.test(email.trim())) { setSalvando(false); setErro('E-mail inválido.'); return }
      const { data, error } = await supabase.from('responsavel')
        .insert({ nome: nome.trim(), telefone: telefone.trim(), email: nulo(email.toLowerCase()) })
        .select('id').single()
      if (error) { setSalvando(false); setErro(mensagemDeErro(error)); return }
      respId = data.id
      nomeResp = nome.trim()
    }
    const { error } = await supabase.from('crianca_responsavel').insert({
      crianca_id: criancaId, responsavel_id: respId, parentesco: parentesco.trim(),
      eh_financeiro: financeiro, autorizado_buscar: buscar, contato_emergencia: emergencia,
    })
    setSalvando(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoSalvar(`${nomeResp} vinculado(a) à criança.`)
  }

  return (
    <Folha titulo="Adicionar responsável" aberta={aberta} aoFechar={aoFechar}>
      <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de cadastro">
          {(['novo', 'existente'] as const).map((m) => (
            <button type="button" key={m} onClick={() => setModo(m)} aria-pressed={modo === m}
              className={`min-h-[44px] rounded-xl text-sm font-bold border-[1.5px] ${modo === m ? 'bg-marca text-white border-marca' : 'bg-white border-stone-300'}`}>
              {m === 'novo' ? 'Novo responsável' : 'Já cadastrado'}
            </button>
          ))}
        </div>

        {modo === 'existente' ? (
          <Selecao rotulo="Responsável" value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
            <option value="">Escolha…</option>
            {existentes.map((r) => <option key={r.id} value={r.id}>{r.nome} · {r.telefone}</option>)}
          </Selecao>
        ) : (
          <>
            <Campo rotulo="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={150} autoComplete="off" />
            <CampoTelefone rotulo="Telefone com DDD" valor={telefone} aoMudar={setTelefone} />
            <Campo rotulo="E-mail (para acessar o app)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255}
              dica="Use o mesmo e-mail ao criar o login dele no Supabase." />
          </>
        )}

        <Campo rotulo="Parentesco" value={parentesco} onChange={(e) => setParentesco(e.target.value)} list="parentescos" maxLength={40} />
        <datalist id="parentescos">
          {['Mãe', 'Pai', 'Avó', 'Avô', 'Tia', 'Tio', 'Madrasta', 'Padrasto', 'Responsável legal'].map((p) => <option key={p} value={p} />)}
        </datalist>
        <div className="flex flex-col">
          <Marcar rotulo="Responsável pelo pagamento" checked={financeiro} onChange={(e) => setFinanceiro(e.target.checked)} />
          <Marcar rotulo="Autorizado a buscar a criança" checked={buscar} onChange={(e) => setBuscar(e.target.checked)} />
          <Marcar rotulo="Contato de emergência" checked={emergencia} onChange={(e) => setEmergencia(e.target.checked)} />
        </div>

        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" disabled={salvando} className={botaoPrincipal}>{salvando ? 'Salvando…' : 'Vincular responsável'}</button>
      </form>
    </Folha>
  )
}
