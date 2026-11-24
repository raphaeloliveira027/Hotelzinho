import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Campo, CampoTelefone, Selecao, botaoPrincipal, botaoSecundario } from '../components/Campos'
import { MAX_CRIANCAS, ROTULO_TURNO, type CriancaInformada, type Turno } from '../lib/criancaCadastro'
import { Bandeirinhas, Estrela, Logo, Nuvem } from '../components/Enfeites'
import { AvisosNoCelular } from '../components/AvisosNoCelular'
import { InstalarApp } from '../components/InstalarApp'
import { FRASE_HOTELZINHO, NOME_HOTELZINHO } from '../lib/marca'
import { useAuth } from '../lib/auth'
import { supabase, supabaseConfigurado } from '../lib/supabase'
import { problemaTelefone } from '../lib/telefone'
import type { Perfil } from '../lib/tipos'

type Etapa = 'escolha' | 'ADMIN' | 'RESPONSAVEL'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Porta de entrada: escolher o perfil, entrar ou (família) pedir cadastro. */
export function Login() {
  const { usuario, carregando: carregandoAuth, entrando, sessao } = useAuth()
  const carregando = carregandoAuth || entrando
  const [etapa, setEtapa] = useState<Etapa>('escolha')
  const [modoFamilia, setModoFamilia] = useState<'entrar' | 'cadastrar'>('entrar')
  const [confirmarEmail, setConfirmarEmail] = useState(false)

  if (!carregando && sessao && usuario?.ativo) {
    return <Navigate to={usuario.perfil === 'ADMIN' ? '/admin' : '/familia'} replace />
  }
  if (!carregando && sessao && (!usuario || !usuario.ativo)) return <AguardandoAprovacao />

  return (
    <div className="min-h-dvh max-w-md mx-auto px-6 pb-8 flex flex-col justify-between gap-8">
      <div className="flex flex-col gap-7">
        <Bandeirinhas className="-mx-6 w-[calc(100%+3rem)]" />
        <Marca />
        {!supabaseConfigurado && (
          <p role="alert" className="rounded-xl bg-amber-100 text-amber-900 p-3 text-sm">
            Sistema ainda não configurado: crie o arquivo <code>.env.local</code> a partir de <code>.env.example</code>.
          </p>
        )}

        {confirmarEmail ? (
          <div role="status" className="flex flex-col gap-3 rounded-2xl bg-white p-5">
            <h2 className="text-lg font-bold">Quase lá!</h2>
            <p className="text-sm">Enviamos um link para o seu e-mail. Abra o e-mail e confirme o endereço.</p>
            <p className="text-sm">Depois, a administração do hotelzinho vai conferir o seu cadastro. Quando for aprovado, você entra com o e-mail e a senha que criou.</p>
            <button onClick={() => { setConfirmarEmail(false); setModoFamilia('entrar') }} className={botaoSecundario}>Voltar para entrar</button>
          </div>
        ) : etapa === 'escolha' ? (
          <div className="flex flex-col gap-3">
            <h2 className="text-xl text-center">Como você quer entrar?</h2>
            <BotaoPerfil cor="bg-coral" icone="familia" titulo="Sou pai, mãe ou responsável" texto="Rotina, mensalidades e recados da criança" onClick={() => { setEtapa('RESPONSAVEL'); setModoFamilia('entrar') }} />
            <BotaoPerfil cor="bg-ceu" icone="admin" titulo="Sou da administração" texto="Gestão do hotelzinho" onClick={() => setEtapa('ADMIN')} />
            <div className="mt-3"><InstalarApp /></div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <button onClick={() => setEtapa('escolha')} className="self-start min-h-[44px] text-sm font-semibold text-marca">‹ Trocar perfil</button>
            {etapa === 'ADMIN' ? (
              <>
                <h2 className="text-lg font-bold">Administração</h2>
                <FormEntrar perfil="ADMIN" />
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold">Família</h2>
                <div className="grid grid-cols-2 gap-1.5 bg-stone-200 p-1 rounded-2xl" role="tablist">
                  {(['entrar', 'cadastrar'] as const).map((m) => (
                    <button key={m} role="tab" aria-selected={modoFamilia === m} onClick={() => setModoFamilia(m)}
                      className={`min-h-[44px] rounded-xl text-sm font-bold ${modoFamilia === m ? 'bg-white shadow-sm' : 'text-stone-700'}`}>
                      {m === 'entrar' ? 'Entrar' : 'Criar cadastro'}
                    </button>
                  ))}
                </div>
                {modoFamilia === 'entrar'
                  ? <FormEntrar perfil="RESPONSAVEL" />
                  : <FormCadastro aoConfirmarEmail={() => setConfirmarEmail(true)} />}
              </>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-suave text-center">Seus dados são tratados conforme o termo de privacidade do hotelzinho.</p>
    </div>
  )
}

function Marca() {
  return (
    <div className="relative flex flex-col items-center text-center gap-2 pt-2">
      <Nuvem className="absolute -left-4 top-2 w-20 opacity-90" />
      <Nuvem className="absolute -right-6 top-14 w-16 opacity-90" />
      <Estrela className="absolute left-12 top-20 w-5" cor="#FF8A78" />
      <Estrela className="absolute right-12 top-0 w-4" cor="#A8D8F0" />
      <div className="relative w-24 h-24 rounded-full bg-white border-4 border-sol flex items-center justify-center shadow-[0_4px_0_rgba(43,42,51,0.10)]">
        <Logo tamanho={64} />
      </div>
      <h1 className="relative text-4xl text-tinta mt-1">{NOME_HOTELZINHO}</h1>
      <p className="relative text-[15px] text-suave max-w-[17rem]">{FRASE_HOTELZINHO}</p>
    </div>
  )
}

function BotaoPerfil({ titulo, texto, onClick, cor, icone }: { titulo: string; texto: string; onClick: () => void; cor: string; icone: 'familia' | 'admin' }) {
  return (
    <button onClick={onClick} className="text-left bg-white rounded-3xl p-4 min-h-[80px] border-2 border-borda hover:border-marca flex items-center gap-4 shadow-[0_3px_0_rgba(43,42,51,0.08)]">
      <span aria-hidden="true" className={`w-12 h-12 shrink-0 rounded-2xl ${cor} flex items-center justify-center`}>
        {icone === 'familia' ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2B2A33" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="7" r="3" /><circle cx="17" cy="9.5" r="2.2" />
            <path d="M2.5 20c.6-3.6 2.8-5.6 5.5-5.6s4.9 2 5.5 5.6M13.8 20c.4-2.6 1.6-4.2 3.2-4.2s2.9 1.6 3.4 4.2" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#2B2A33" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4V3h6v1M8.5 10h7M8.5 14h7M8.5 18h4" />
          </svg>
        )}
      </span>
      <span className="flex-1">
        <span className="block font-extrabold text-[17px]">{titulo}</span>
        <span className="block text-sm text-suave">{texto}</span>
      </span>
      <span aria-hidden="true" className="text-marca text-2xl font-bold">›</span>
    </button>
  )
}

function FormEntrar({ perfil }: { perfil: Perfil }) {
  const { entrar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [esqueci, setEsqueci] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setErro(await entrar(email.trim(), senha, perfil))
    setEnviando(false)
  }

  if (esqueci) return <EsqueciSenha emailInicial={email} aoVoltar={() => setEsqueci(false)} />

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <Campo rotulo="E-mail" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Campo rotulo="Senha" type="password" required autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
      {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
      <button type="submit" disabled={enviando} className={botaoPrincipal}>{enviando ? 'Entrando…' : 'Entrar'}</button>
      <button type="button" onClick={() => setEsqueci(true)} className="self-center min-h-[44px] px-3 text-sm font-bold text-marca">
        Esqueci minha senha
      </button>
    </form>
  )
}

/** Pede o link para criar uma senha nova. A resposta é sempre a mesma, exista ou não o e-mail (não revela quem tem conta). */
function EsqueciSenha({ emailInicial, aoVoltar }: { emailInicial: string; aoVoltar: () => void }) {
  const { pedirNovaSenha } = useAuth()
  const [email, setEmail] = useState(emailInicial)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!EMAIL.test(email.trim())) { setErro('Digite o e-mail que você usa para entrar.'); return }
    setEnviando(true)
    const r = await pedirNovaSenha(email.trim().toLowerCase())
    setEnviando(false)
    if (r) { setErro(r); return }
    setEnviado(true)
  }

  if (enviado) return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl bg-white p-5">
      <h3 className="text-lg font-bold">Confira seu e-mail</h3>
      <p className="text-sm">Se <strong>{email.trim().toLowerCase()}</strong> tiver cadastro, enviamos um link para você criar uma senha nova.</p>
      <p className="text-sm text-suave">O link vale por pouco tempo. Se não chegar em alguns minutos, olhe a caixa de spam ou peça de novo.</p>
      <button type="button" onClick={aoVoltar} className={botaoSecundario}>Voltar para entrar</button>
    </div>
  )

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <h3 className="text-base font-bold">Esqueceu a senha?</h3>
      <p className="text-sm text-suave">Digite seu e-mail. Vamos mandar um link para você criar uma senha nova.</p>
      <Campo rotulo="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setErro(null) }} erro={erro} />
      <button type="submit" disabled={enviando} className={botaoPrincipal}>{enviando ? 'Enviando…' : 'Enviar link'}</button>
      <button type="button" onClick={aoVoltar} className="self-center min-h-[44px] px-3 text-sm font-bold text-marca">‹ Voltar para entrar</button>
    </form>
  )
}

function FormCadastro({ aoConfirmarEmail }: { aoConfirmarEmail: () => void }) {
  const { cadastrar } = useAuth()
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [criancas, setCriancas] = useState<CriancaInformada[]>([{ nome: '' }])
  const [parentesco, setParentesco] = useState('')
  const [aceite, setAceite] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Ao corrigir um campo, o aviso de erro dele some
  const ao = (campo: string, definir: (v: string) => void) => (v: string) => {
    definir(v)
    setErros((atual) => { const n = { ...atual }; delete n[campo]; return n })
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const x: Record<string, string> = {}
    if (nome.trim().split(/\s+/).length < 2) x.nome = 'Escreva nome e sobrenome.'
    const pt = problemaTelefone(telefone); if (pt) x.telefone = pt
    if (!EMAIL.test(email.trim())) x.email = 'E-mail inválido.'
    if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) x.senha = 'Use pelo menos 8 caracteres, com letras e números.'
    if (senha2 !== senha) x.senha2 = 'As senhas não são iguais.'
    const hoje = new Date().toLocaleDateString('sv-SE')
    criancas.forEach((c, i) => {
      if (c.nome.trim().split(/\s+/).length < 2) x[`c${i}_nome`] = 'Escreva nome e sobrenome da criança.'
      if (!c.nascimento) x[`c${i}_nascimento`] = 'Informe a data de nascimento.'
      else if (c.nascimento > hoje || c.nascimento < '2000-01-01') x[`c${i}_nascimento`] = 'Data de nascimento inválida.'
      if (!c.turno) x[`c${i}_turno`] = 'Escolha o período.'
    })
    if (parentesco.trim().length < 2) x.parentesco = 'Informe o parentesco.'
    if (!aceite) x.aceite = 'É preciso aceitar o termo para continuar.'
    setErros(x)
    if (Object.keys(x).length) { setErroGeral('Confira os campos marcados.'); return }
    setErroGeral(null)
    setEnviando(true)
    const r = await cadastrar({
      nome: nome.trim(), telefone, email: email.trim().toLowerCase(), senha,
      criancas: criancas.map((c) => ({
        nome: c.nome.trim().replace(/\s+/g, ' '), nascimento: c.nascimento, turno: c.turno,
        alergias: c.alergias?.trim() || undefined, restricoes: c.restricoes?.trim() || undefined, saude: c.saude?.trim() || undefined,
      })),
      parentesco: parentesco.trim(),
    })
    setEnviando(false)
    if (r.erro) { setErroGeral(r.erro); return }
    if (r.confirmarEmail) aoConfirmarEmail()
    // Sem confirmação de e-mail, a sessão já existe e a tela muda para "aguardando aprovação"
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <p className="text-sm text-suave">Preencha seus dados e os da criança. A administração do hotelzinho confere e libera o acesso e a vaga.</p>
      <Campo rotulo="Seu nome completo" value={nome} onChange={(e) => ao('nome', setNome)(e.target.value)} maxLength={150} autoComplete="name" erro={erros.nome} />
      <CampoTelefone rotulo="Celular com DDD" valor={telefone} aoMudar={ao('telefone', setTelefone)} erro={erros.telefone} />
      <Campo rotulo="E-mail" type="email" value={email} onChange={(e) => ao('email', setEmail)(e.target.value)} maxLength={255} autoComplete="email" erro={erros.email} />
      <Campo rotulo="Crie uma senha" type="password" value={senha} onChange={(e) => ao('senha', setSenha)(e.target.value)} autoComplete="new-password"
        dica="Pelo menos 8 caracteres, com letras e números." erro={erros.senha} />
      <Campo rotulo="Repita a senha" type="password" value={senha2} onChange={(e) => ao('senha2', setSenha2)(e.target.value)} autoComplete="new-password" erro={erros.senha2} />
      {criancas.map((c, i) => (
        <BlocoCrianca key={i} numero={i + 1} total={criancas.length} crianca={c} erros={erros}
          aoMudar={(campo, valor) => {
            setCriancas((lista) => lista.map((item, j) => (j === i ? { ...item, [campo]: valor } : item)))
            setErros((atual) => { const n = { ...atual }; delete n[`c${i}_${campo}`]; return n })
          }}
          aoRemover={() => { setCriancas((lista) => lista.filter((_, j) => j !== i)); setErros({}) }} />
      ))}
      {criancas.length < MAX_CRIANCAS && (
        <button type="button" onClick={() => setCriancas((lista) => [...lista, { nome: '' }])} className={botaoSecundario}>
          + Adicionar outra criança (irmão ou irmã)
        </button>
      )}
      <Campo rotulo="Seu parentesco com a criança" value={parentesco} onChange={(e) => ao('parentesco', setParentesco)(e.target.value)} list="parentescos-cad" maxLength={40} erro={erros.parentesco} />
      <datalist id="parentescos-cad">
        {['Mãe', 'Pai', 'Avó', 'Avô', 'Tia', 'Tio', 'Responsável legal'].map((p) => <option key={p} value={p} />)}
      </datalist>
      <div className="rounded-xl bg-white border border-borda p-3 text-xs text-suave flex flex-col gap-2">
        <p className="font-semibold text-tinta">Termo de privacidade</p>
        <p>O hotelzinho guarda seus dados e os da criança só para o cuidado diário, a comunicação com a família
          e o controle das mensalidades. Os dados não são vendidos nem compartilhados para outros fins.
          Você pode pedir para consultar, corrigir ou excluir seus dados com a administração.</p>
        <label className="flex items-center gap-3 min-h-[44px] text-sm text-tinta">
          <input type="checkbox" checked={aceite} onChange={(e) => { setAceite(e.target.checked); ao('aceite', () => {})('') }} className="w-5 h-5 accent-marca" />
          Li e aceito o termo de privacidade
        </label>
        {erros.aceite && <span className="text-xs font-semibold text-red-800">{erros.aceite}</span>}
      </div>
      {erroGeral && <p role="alert" className="text-sm font-semibold text-red-800">{erroGeral}</p>}
      <button type="submit" disabled={enviando} className={botaoPrincipal}>{enviando ? 'Enviando…' : 'Enviar cadastro'}</button>
    </form>
  )
}

/** Dados de uma criança no autocadastro. Ficam guardados só no pedido até a administração aprovar. */
function BlocoCrianca({ numero, total, crianca: c, erros, aoMudar, aoRemover }: {
  numero: number
  total: number
  crianca: CriancaInformada
  erros: Record<string, string>
  aoMudar: (campo: keyof CriancaInformada, valor: string) => void
  aoRemover: () => void
}) {
  const e = (campo: string) => erros[`c${numero - 1}_${campo}`]
  const hoje = new Date().toLocaleDateString('sv-SE')
  return (
    <fieldset className="rounded-2xl bg-white border-2 border-sol p-4 flex flex-col gap-4">
      <legend className="px-2 font-extrabold font-display text-lg">{total > 1 ? `Criança ${numero}` : 'Dados da criança'}</legend>
      <Campo rotulo="Nome completo da criança" value={c.nome} onChange={(ev) => aoMudar('nome', ev.target.value)} maxLength={150} erro={e('nome')} />
      <Campo rotulo="Data de nascimento" type="date" max={hoje} value={c.nascimento ?? ''} onChange={(ev) => aoMudar('nascimento', ev.target.value)} erro={e('nascimento')} />
      <Selecao rotulo="Período desejado" value={c.turno ?? ''} onChange={(ev) => aoMudar('turno', ev.target.value as Turno)} erro={e('turno')}>
        <option value="">Escolha…</option>
        {(Object.keys(ROTULO_TURNO) as Turno[]).map((t) => <option key={t} value={t}>{ROTULO_TURNO[t]}</option>)}
      </Selecao>
      <Campo rotulo="Alergias (se tiver)" value={c.alergias ?? ''} onChange={(ev) => aoMudar('alergias', ev.target.value)} maxLength={500} placeholder="Ex.: amendoim, dipirona" />
      <Campo rotulo="Restrições alimentares (se tiver)" value={c.restricoes ?? ''} onChange={(ev) => aoMudar('restricoes', ev.target.value)} maxLength={500} placeholder="Ex.: sem lactose" />
      <Campo rotulo="Algo sobre a saúde que devemos saber? (opcional)" value={c.saude ?? ''} onChange={(ev) => aoMudar('saude', ev.target.value)} maxLength={500} />
      {total > 1 && (
        <button type="button" onClick={aoRemover} className="self-start min-h-[44px] text-sm font-bold text-red-800">Remover esta criança</button>
      )}
    </fieldset>
  )
}

/** Conta criada, mas ainda não liberada (ou recusada) pela administração. */
function AguardandoAprovacao() {
  const { sair, usuario } = useAuth()
  const [info, setInfo] = useState<{ status: string; motivo_recusa: string | null } | null | undefined>(undefined)

  useEffect(() => {
    supabase?.from('solicitacao_cadastro').select('status, motivo_recusa').maybeSingle()
      .then(({ data }) => setInfo(data ?? null))
  }, [])

  let conteudo: ReactNode
  if (info === undefined) conteudo = <p className="text-suave">Carregando…</p>
  else if (info?.status === 'RECUSADO') conteudo = (
    <>
      <h2 className="text-lg font-bold">Cadastro não aprovado</h2>
      <p className="text-sm">{info.motivo_recusa}</p>
      <p className="text-sm text-suave">Se achar que é um engano, fale com a administração do hotelzinho.</p>
    </>
  )
  else if (info?.status === 'PENDENTE') conteudo = (
    <>
      <h2 className="text-lg font-bold">Cadastro em análise</h2>
      <p className="text-sm">Recebemos o seu cadastro. A administração do hotelzinho vai conferir os seus dados e os da criança e liberar o acesso.</p>
      <p className="text-sm text-suave">Você pode fechar o app. Quando for aprovado, é só entrar de novo.</p>
    </>
  )
  else conteudo = (
    <>
      <h2 className="text-lg font-bold">Acesso não liberado</h2>
      <p className="text-sm">{usuario ? 'Esta conta está desativada.' : 'Esta conta ainda não está ligada ao hotelzinho.'} Fale com a administração.</p>
    </>
  )

  return (
    <div className="min-h-dvh max-w-md mx-auto px-6 pb-8 flex flex-col gap-7">
      <Bandeirinhas className="-mx-6 w-[calc(100%+3rem)]" />
      <Marca />
      <div role="status" className="bg-white rounded-2xl p-5 flex flex-col gap-3">{conteudo}</div>
      {info?.status === 'PENDENTE' && (
        <AvisosNoCelular modo="convite" texto="Ative os avisos para saber na hora quando o seu cadastro for aprovado." />
      )}
      <button onClick={sair} className={botaoSecundario}>Sair</button>
    </div>
  )
}
