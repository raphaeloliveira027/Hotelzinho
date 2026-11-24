import { useState } from 'react'
import { useInstalacao } from '../lib/instalar'
import { NOME_HOTELZINHO } from '../lib/marca'

/** Convite para colocar o app na tela inicial do celular. Some quando já está instalado. */
export function InstalarApp() {
  const { modo, instalar } = useInstalacao()
  const [fechado, setFechado] = useState(false)
  if (modo === 'nenhum' || fechado) return null

  return (
    <section aria-label="Instalar o app" className="relative rounded-2xl bg-white border-2 border-dashed border-ceu p-4 flex gap-3 items-start">
      <img src="/icones/icone-192.png" alt="" width={44} height={44} className="rounded-xl shrink-0" />
      <div className="flex-1 flex flex-col gap-2 pr-6">
        <p className="font-extrabold leading-tight">Tenha o {NOME_HOTELZINHO} no celular</p>
        {modo === 'botao' ? (
          <>
            <p className="text-sm text-suave">Fica com ícone na tela inicial e abre como um aplicativo.</p>
            <button onClick={instalar} className="self-start min-h-[44px] px-4 rounded-xl bg-marca text-white font-bold">
              Instalar no celular
            </button>
          </>
        ) : (
          <p className="text-sm text-suave">
            No Safari, toque em <strong className="text-tinta">Compartilhar</strong> (o quadrado com a setinha para cima)
            e depois em <strong className="text-tinta">Adicionar à Tela de Início</strong>.
          </p>
        )}
      </div>
      <button onClick={() => setFechado(true)} aria-label="Fechar aviso de instalação"
        className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-suave text-xl">×</button>
    </section>
  )
}
