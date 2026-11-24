import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { desligarAvisosAoSair } from './push'
import { supabase } from './supabase'
import type { CriancaInformada } from './criancaCadastro'
import type { Perfil, Usuario } from './tipos'

export type DadosCadastro = {
  nome: string
  telefone: string
  email: string
  senha: string
  criancas: CriancaInformada[]
  parentesco: string
}

type EstadoAuth = {
  carregando: boolean
  /** true enquanto confere se a pessoa entrou pela porta certa (evita trocar de tela antes) */
  entrando: boolean
  sessao: Session | null
  usuario: Usuario | null
  entrar: (email: string, senha: string, perfilEscolhido: Perfil) => Promise<string | null>
  cadastrar: (dados: DadosCadastro) => Promise<{ erro: string | null; confirmarEmail: boolean }>
  sair: () => Promise<void>
  /** true enquanto a pessoa veio do link de recuperação e ainda não criou a senha nova */
  recuperandoSenha: boolean
  pedirNovaSenha: (email: string) => Promise<string | null>
  trocarSenha: (nova: string) => Promise<string | null>
  concluirRecuperacao: () => void
}

const AuthContext = createContext<EstadoAuth | null>(null)

// Link "criar nova senha" do e-mail: o Supabase coloca type=recovery no endereço.
// Lido assim que o app abre, antes de o Supabase limpar o endereço.
const abriuLinkDeRecuperacao = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash)

const traduzirErroAuth = (msg: string) => {
  if (/already registered|already exists/i.test(msg)) return 'Este e-mail já tem cadastro. Volte e use "Entrar".'
  if (/password/i.test(msg) && /(6|characters|weak)/i.test(msg)) return 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.'
  if (/not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.'
  if (/signups not allowed|signup is disabled/i.test(msg)) return 'O cadastro pelo app está desativado. Fale com a administração do hotelzinho.'
  if (/rate limit/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'
  return 'E-mail ou senha incorretos.'
}

/** Guarda a sessão do Supabase Auth e o perfil (ADMIN/RESPONSAVEL) do usuário logado. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true)
  const [sessao, setSessao] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  // Só decide "logado ou não" depois de ler a sessão salva no aparelho.
  // Sem isso, ao abrir um link direto (ex.: /admin/hoje) a pessoa era mandada ao login por engano.
  const [sessaoLida, setSessaoLida] = useState(false)
  const [entrando, setEntrando] = useState(false)
  const [recuperandoSenha, setRecuperandoSenha] = useState(abriuLinkDeRecuperacao)

  useEffect(() => {
    if (!supabase) { setCarregando(false); return }
    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); setSessaoLida(true) })
    const { data: escuta } = supabase.auth.onAuthStateChange((evento, s) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperandoSenha(true)
      setSessao(s)
      if (!s) setUsuario(null)
    })
    return () => escuta.subscription.unsubscribe()
  }, [])

  // Sempre que a sessão muda, busca o perfil na tabela "usuario" (protegida por RLS)
  useEffect(() => {
    if (!supabase || !sessaoLida) return
    if (!sessao) { setUsuario(null); setCarregando(false); return }
    setCarregando(true)
    let valida = true // ignora resposta atrasada de uma sessão que já mudou (ex.: saiu logo depois de entrar)
    supabase.from('usuario').select('id, email, perfil, ativo').eq('id', sessao.user.id).maybeSingle()
      .then(({ data }) => { if (valida) { setUsuario(data as Usuario | null); setCarregando(false) } })
    return () => { valida = false }
  }, [sessao, sessaoLida])

  const entrar = async (email: string, senha: string, perfilEscolhido: Perfil) => {
    if (!supabase) return 'O sistema ainda não foi configurado.'
    setEntrando(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
      if (error || !data.user) return traduzirErroAuth(error?.message ?? '')
      // Confere se a pessoa entrou pela porta certa (administração x família)
      const { data: u } = await supabase.from('usuario').select('perfil').eq('id', data.user.id).maybeSingle()
      if (u && u.perfil !== perfilEscolhido) {
        await supabase.auth.signOut()
        return u.perfil === 'ADMIN'
          ? 'Este e-mail é da administração. Volte e escolha "Sou da administração".'
          : 'Este e-mail é de um responsável. Volte e escolha "Sou pai, mãe ou responsável".'
      }
      return null
    } finally {
      setEntrando(false)
    }
  }

  const cadastrar = async (d: DadosCadastro) => {
    if (!supabase) return { erro: 'O sistema ainda não foi configurado.', confirmarEmail: false }
    const { data, error } = await supabase.auth.signUp({
      email: d.email,
      password: d.senha,
      options: {
        emailRedirectTo: window.location.origin,
        // Só preenche a solicitação; o perfil e a liberação são decididos pelo banco e pela administração
        data: {
          origem: 'app', nome: d.nome, telefone: d.telefone,
          criancas: d.criancas.map((c) => c.nome).join(', '), criancas_dados: d.criancas,
          parentesco: d.parentesco, aceite_termo: 'true',
        },
      },
    })
    if (error) return { erro: traduzirErroAuth(error.message), confirmarEmail: false }
    // Supabase devolve usuário sem "identities" quando o e-mail já existe (proteção contra enumeração)
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { erro: 'Este e-mail já tem cadastro. Volte e use "Entrar".', confirmarEmail: false }
    }
    return { erro: null, confirmarEmail: !data.session }
  }

  const sair = async () => {
    await desligarAvisosAoSair() // este celular para de receber os avisos de quem saiu
    await supabase?.auth.signOut()
  }

  /** Envia o e-mail com o link para criar uma senha nova. */
  const pedirNovaSenha = async (email: string) => {
    if (!supabase) return 'O sistema ainda não foi configurado.'
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/nova-senha` })
    if (!error) return null
    if (/rate limit|security purposes/i.test(error.message)) return 'Muitos pedidos seguidos. Espere alguns minutos e tente de novo.'
    return 'Não foi possível enviar agora. Tente de novo em alguns minutos.'
  }

  /** Grava a senha nova (só funciona com a sessão aberta pelo link do e-mail) e encerra a sessão. */
  const trocarSenha = async (nova: string) => {
    if (!supabase) return 'O sistema ainda não foi configurado.'
    const { error } = await supabase.auth.updateUser({ password: nova })
    if (error) {
      if (/different from the old/i.test(error.message)) return 'A senha nova precisa ser diferente da anterior.'
      if (/weak|at least|characters/i.test(error.message)) return 'Senha fraca. Use pelo menos 8 caracteres, com letras e números.'
      if (/session|jwt|expired/i.test(error.message)) return 'O link expirou. Peça um novo em "Esqueci minha senha".'
      return 'Não foi possível trocar a senha. Tente de novo.'
    }
    await supabase.auth.signOut()
    return null
  }

  return (
    <AuthContext.Provider value={{
      carregando, entrando, sessao, usuario, entrar, cadastrar, sair,
      recuperandoSenha, pedirNovaSenha, trocarSenha, concluirRecuperacao: () => setRecuperandoSenha(false),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
