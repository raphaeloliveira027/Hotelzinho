import { useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Layout, menuAdmin, menuFamilia } from './components/Layout'
import { AuthProvider, useAuth } from './lib/auth'
import type { Perfil } from './lib/tipos'
import { Login } from './pages/Login'
import { NovaSenha } from './pages/NovaSenha'
import { AdminComunicados } from './pages/admin/Comunicados'
import { AdminCriancaForm } from './pages/admin/CriancaForm'
import { AdminCriancas } from './pages/admin/Criancas'
import { AdminFinanceiro } from './pages/admin/Financeiro'
import { AdminHoje } from './pages/admin/Hoje'
import { AdminInicio } from './pages/admin/Inicio'
import { AdminMais } from './pages/admin/Mais'
import { AdminConversa, AdminMensagens } from './pages/admin/Mensagens'
import { AdminSolicitacoes } from './pages/admin/Solicitacoes'
import { FamiliaInicio } from './pages/familia/Inicio'
import { FamiliaMensagens } from './pages/familia/Mensagens'
import { FamiliaMensalidades } from './pages/familia/Mensalidades'
import { FamiliaRotina } from './pages/familia/Rotina'

/**
 * Protege as rotas por perfil. Isto organiza a navegação;
 * a proteção real dos dados está no banco (RLS).
 */
function SomentePerfil({ perfil, children }: { perfil: Perfil; children: ReactNode }) {
  const { carregando, usuario } = useAuth()
  if (carregando) return <p className="p-6 text-suave">Carregando…</p>
  if (!usuario || !usuario.ativo) return <Navigate to="/" replace />
  if (usuario.perfil !== perfil) return <Navigate to={usuario.perfil === 'ADMIN' ? '/admin' : '/familia'} replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Rotas />
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Ao tocar num aviso com o app já aberto, o service worker pede para abrir a tela do aviso. */
function AbrirTelaDoAviso() {
  const navigate = useNavigate()
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const ouvir = (ev: MessageEvent) => {
      const link = (ev.data as { tipo?: string; link?: string } | null)
      if (link?.tipo === 'abrir-aviso' && typeof link.link === 'string' && link.link.startsWith('/')) navigate(link.link)
    }
    navigator.serviceWorker.addEventListener('message', ouvir)
    return () => navigator.serviceWorker.removeEventListener('message', ouvir)
  }, [navigate])
  return null
}

function Rotas() {
  const { recuperandoSenha } = useAuth()
  // Quem chegou pelo link "criar nova senha" fica nessa tela até trocar a senha,
  // mesmo que o link tenha caído em outro endereço do app.
  if (recuperandoSenha) return <NovaSenha />
  return (
      <>
        <AbrirTelaDoAviso />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/nova-senha" element={<NovaSenha />} />

          <Route path="/admin" element={<SomentePerfil perfil="ADMIN"><Layout menu={menuAdmin} /></SomentePerfil>}>
            <Route index element={<AdminInicio />} />
            <Route path="hoje" element={<AdminHoje />} />
            <Route path="criancas" element={<AdminCriancas />} />
            <Route path="criancas/nova" element={<AdminCriancaForm key="nova" />} />
            <Route path="criancas/:id" element={<AdminCriancaForm />} />
            <Route path="financeiro" element={<AdminFinanceiro />} />
            <Route path="mais" element={<AdminMais />} />
            <Route path="solicitacoes" element={<AdminSolicitacoes />} />
            <Route path="comunicados" element={<AdminComunicados />} />
            <Route path="mensagens" element={<AdminMensagens />} />
            <Route path="mensagens/:id" element={<AdminConversa />} />
          </Route>

          <Route path="/familia" element={<SomentePerfil perfil="RESPONSAVEL"><Layout menu={menuFamilia} /></SomentePerfil>}>
            <Route index element={<FamiliaInicio />} />
            <Route path="rotina" element={<FamiliaRotina />} />
            <Route path="mensalidades" element={<FamiliaMensalidades />} />
            <Route path="mensagens" element={<FamiliaMensagens />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </>
  )
}
