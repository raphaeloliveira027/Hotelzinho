import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Campo, botaoPrincipal, botaoSecundario } from '../components/Campos'
import { Bandeirinhas, Logo } from '../components/Enfeites'
import { useAuth } from '../lib/auth'
import { NOME_HOTELZINHO } from '../lib/marca'

// Link vencido ou já usado: o Supabase devolve o erro no endereço (lido antes de ele limpar)
const linkComErro = typeof window !== 'undefined' && /error_code=|error=access_denied/.test(window.location.hash + window.location.search)

/** Tela aberta pelo link do e-mail "Esqueci minha senha": a pessoa cria a senha nova. */
export function NovaSenha() {
  const { carregando, sessao, trocarSenha, concluirRecuperacao } = useAuth()
  const navigate = useNavigate()
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  const [erros, setErros] = useState<{ senha?: string; senha2?: string }>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)

  const irParaEntrar = () => { concluirRecuperacao(); navigate('/', { replace: true }) }

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const x: typeof erros = {}
    if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) x.senha = 'Use pelo menos 8 caracteres, com letras e números.'
    if (senha2 !== senha) x.senha2 = 'As senhas não são iguais.'
    setErros(x)
    if (x.senha || x.senha2) return
    setSalvando(true)
    const r = await trocarSenha(senha)
    setSalvando(false)
    if (r) { setErroGeral(r); return }
    setPronto(true)
  }

  let conteudo
  if (pronto) {
    conteudo = (
      <div role="status" className="flex flex-col gap-3 rounded-2xl bg-white p-5">
        <h2 className="text-lg font-bold">Senha alterada!</h2>
        <p className="text-sm">Agora é só entrar com o seu e-mail e a senha nova.</p>
        <button onClick={irParaEntrar} className={botaoPrincipal}>Entrar</button>
      </div>
    )
  } else if (carregando) {
    conteudo = <p className="text-suave text-center">Carregando…</p>
  } else if (!sessao || linkComErro) {
    conteudo = (
      <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-white p-5">
        <h2 className="text-lg font-bold">Link vencido</h2>
        <p className="text-sm">Este link para criar senha nova não vale mais (ele dura pouco tempo e só pode ser usado uma vez).</p>
        <p className="text-sm text-suave">Volte, toque em "Esqueci minha senha" e peça um link novo.</p>
        <button onClick={irParaEntrar} className={botaoSecundario}>Voltar para entrar</button>
      </div>
    )
  } else {
    conteudo = (
      <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
        <h2 className="text-xl font-bold">Criar senha nova</h2>
        {sessao.user.email && <p className="text-sm text-suave">Conta: {sessao.user.email}</p>}
        <Campo rotulo="Senha nova" type="password" autoComplete="new-password" value={senha}
          onChange={(e) => { setSenha(e.target.value); setErros((x) => ({ ...x, senha: undefined })) }}
          dica="Pelo menos 8 caracteres, com letras e números." erro={erros.senha} />
        <Campo rotulo="Repita a senha nova" type="password" autoComplete="new-password" value={senha2}
          onChange={(e) => { setSenha2(e.target.value); setErros((x) => ({ ...x, senha2: undefined })) }} erro={erros.senha2} />
        {erroGeral && <p role="alert" className="text-sm font-semibold text-red-800">{erroGeral}</p>}
        <button type="submit" disabled={salvando} className={botaoPrincipal}>{salvando ? 'Salvando…' : 'Salvar senha nova'}</button>
      </form>
    )
  }

  return (
    <div className="min-h-dvh max-w-md mx-auto px-6 pb-8 flex flex-col gap-7">
      <Bandeirinhas className="-mx-6 w-[calc(100%+3rem)]" />
      <div className="flex flex-col items-center gap-2">
        <div className="w-20 h-20 rounded-full bg-white border-[3px] border-sol flex items-center justify-center"><Logo tamanho={56} /></div>
        <p className="font-display text-2xl font-extrabold">{NOME_HOTELZINHO}</p>
      </div>
      {conteudo}
    </div>
  )
}
