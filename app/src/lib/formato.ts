import type { StatusMensalidade } from './tipos'

const real = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export const dinheiro = (v: number) => real.format(Number(v))

/** "2026-10-31" -> "31/10/2026" (sem passar por fuso horário) */
export const dataBR = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-10-01" -> "Outubro/2026" */
export const competenciaBR = (iso: string) => {
  const [a, m] = iso.split('-')
  const mes = MESES[Number(m) - 1]
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${a}`
}

export const idade = (nascimento: string) => {
  const n = new Date(nascimento + 'T12:00:00')
  const hoje = new Date()
  let anos = hoje.getFullYear() - n.getFullYear()
  if (hoje < new Date(hoje.getFullYear(), n.getMonth(), n.getDate())) anos--
  return anos <= 0 ? 'menos de 1 ano' : anos === 1 ? '1 ano' : `${anos} anos`
}

export const iniciais = (nome: string) =>
  nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()

export const rotuloStatus: Record<StatusMensalidade, { texto: string; classe: string }> = {
  PENDENTE: { texto: 'Pendente', classe: 'bg-amber-100 text-amber-900' },
  EM_ANALISE: { texto: 'Em análise', classe: 'bg-indigo-100 text-indigo-900' },
  PAGO: { texto: 'Paga', classe: 'bg-green-100 text-green-900' },
  ATRASADO: { texto: 'Atrasada', classe: 'bg-red-100 text-red-900' },
  CANCELADA: { texto: 'Cancelada', classe: 'bg-stone-200 text-stone-700' },
}
