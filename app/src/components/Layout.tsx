import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

type ItemMenu = { para: string; rotulo: string; icone: ReactNode }

const Icone = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)

const icones = {
  inicio: <Icone d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  hoje: <Icone d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2" />,
  criancas: <Icone d="M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M17 6.5a2.5 2.5 0 1 0 0 5M16 14.6c2.6.2 4.6 2 5.3 5.4" />,
  financeiro: <Icone d="M5 6h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM3 10h18M16 14.5h2" />,
  mensagens: <Icone d="M4 5h16v11H9l-5 4z" />,
  mais: <Icone d="M4 7h16M4 12h16M4 17h16" />,
}

export const menuAdmin: ItemMenu[] = [
  { para: '/admin', rotulo: 'Início', icone: icones.inicio },
  { para: '/admin/hoje', rotulo: 'Hoje', icone: icones.hoje },
  { para: '/admin/criancas', rotulo: 'Crianças', icone: icones.criancas },
  { para: '/admin/financeiro', rotulo: 'Financeiro', icone: icones.financeiro },
  { para: '/admin/mais', rotulo: 'Mais', icone: icones.mais },
]

export const menuFamilia: ItemMenu[] = [
  { para: '/familia', rotulo: 'Início', icone: icones.inicio },
  { para: '/familia/rotina', rotulo: 'Rotina', icone: icones.hoje },
  { para: '/familia/mensalidades', rotulo: 'Mensalidades', icone: icones.financeiro },
  { para: '/familia/mensagens', rotulo: 'Mensagens', icone: icones.mensagens },
]

/** Estrutura das telas: conteúdo rolável + menu inferior (celular primeiro). */
export function Layout({ menu }: { menu: ItemMenu[] }) {
  return (
    <div className="min-h-dvh flex flex-col max-w-xl mx-auto">
      <main className="flex-1 px-5 pt-6 pb-28">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 inset-x-0 bg-white border-t-2 border-borda rounded-t-3xl shadow-[0_-4px_12px_rgba(43,42,51,0.06)]">
        <ul className="max-w-xl mx-auto grid px-1" style={{ gridTemplateColumns: `repeat(${menu.length}, minmax(0, 1fr))` }}>
          {menu.map((item) => (
            <li key={item.para}>
              <NavLink
                to={item.para}
                end={item.para === '/admin' || item.para === '/familia'}
                className={({ isActive }) =>
                  `group flex flex-col items-center justify-center gap-0.5 min-h-[64px] py-2 text-[11px] font-bold no-underline ${
                    isActive ? 'text-marca-escura' : 'text-suave'}`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex items-center justify-center w-12 h-8 rounded-full transition-colors ${isActive ? 'bg-sol' : ''}`}>
                      {item.icone}
                    </span>
                    {item.rotulo}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`bg-white rounded-2xl p-4 shadow-[0_2px_0_rgba(43,42,51,0.06)] ${className}`}>{children}</section>
}

export function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">{titulo}</h1>
      <Cartao><p className="text-suave">Esta tela será construída na próxima etapa do desenvolvimento.</p></Cartao>
    </div>
  )
}
