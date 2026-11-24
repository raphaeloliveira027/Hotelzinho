import { useEffect, useRef, type ReactNode } from 'react'

/**
 * "Folha" que sobe da parte de baixo da tela (bom para uso com uma mão no celular).
 * Fecha com o botão, com Esc ou tocando fora.
 */
export function Folha({ titulo, aberta, aoFechar, children }: {
  titulo: string
  aberta: boolean
  aoFechar: () => void
  children: ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberta) return
    const anterior = document.activeElement as HTMLElement | null
    painel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    document.addEventListener('keydown', aoTeclar)
    return () => { document.removeEventListener('keydown', aoTeclar); anterior?.focus() }
  }, [aberta, aoFechar])

  if (!aberta) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={aoFechar}>
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto bg-white rounded-t-3xl p-5 pb-8 flex flex-col gap-4"
      >
        <div className="flex justify-between items-center gap-3">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button onClick={aoFechar} className="min-h-[44px] px-2 text-sm font-semibold text-marca">Fechar</button>
        </div>
        {children}
      </div>
    </div>
  )
}
