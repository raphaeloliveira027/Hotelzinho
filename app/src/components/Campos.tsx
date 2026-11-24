import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { mascararTelefone } from '../lib/telefone'

const base = 'px-3.5 rounded-xl border border-stone-300 bg-white font-normal text-base text-tinta'

/** Rótulo + campo de texto, com dica e mensagem de erro opcionais. */
export function Campo({ rotulo, dica, erro, ...props }: InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string; dica?: string; erro?: string | null
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {rotulo}
      <input {...props} aria-invalid={erro ? true : undefined}
        className={`h-12 ${base} ${erro ? 'border-red-700' : ''}`} />
      {dica && !erro && <span className="text-xs font-normal text-suave">{dica}</span>}
      {erro && <span className="text-xs font-semibold text-red-800">{erro}</span>}
    </label>
  )
}

export function AreaTexto({ rotulo, dica, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { rotulo: string; dica?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {rotulo}
      <textarea rows={2} {...props} className={`py-2.5 resize-none ${base}`} />
      {dica && <span className="text-xs font-normal text-suave">{dica}</span>}
    </label>
  )
}

export function Selecao({ rotulo, erro, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & {
  rotulo: string; erro?: string | null; children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold">
      {rotulo}
      <select {...props} aria-invalid={erro ? true : undefined}
        className={`h-12 ${base} ${erro ? 'border-red-700' : ''}`}>{children}</select>
      {erro && <span className="text-xs font-semibold text-red-800">{erro}</span>}
    </label>
  )
}

export function Marcar({ rotulo, ...props }: InputHTMLAttributes<HTMLInputElement> & { rotulo: string }) {
  return (
    <label className="flex items-center gap-3 min-h-[44px] text-sm">
      <input type="checkbox" {...props} className="w-5 h-5 accent-marca" />
      {rotulo}
    </label>
  )
}

export const botaoPrincipal = 'min-h-[52px] px-5 rounded-2xl bg-marca text-white font-bold disabled:opacity-60 flex items-center justify-center no-underline'
export const botaoSecundario = 'min-h-[44px] px-4 rounded-xl border-[1.5px] border-marca text-marca bg-white text-sm font-bold flex items-center justify-center no-underline'

/** Campo de telefone com máscara (DDD) 91234-5678 enquanto digita. */
export function CampoTelefone({ rotulo, valor, aoMudar, erro, dica }: {
  rotulo: string; valor: string; aoMudar: (v: string) => void; erro?: string | null; dica?: string
}) {
  return (
    <Campo rotulo={rotulo} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 91234-5678" maxLength={15}
      value={valor} onChange={(e) => aoMudar(mascararTelefone(e.target.value))} erro={erro} dica={dica} />
  )
}
