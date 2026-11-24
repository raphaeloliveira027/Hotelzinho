/** Dados da criança que a família informa no autocadastro (a administração confere antes de criar). */
export type Turno = 'MANHA' | 'TARDE' | 'INTEGRAL'

export type CriancaInformada = {
  nome: string
  nascimento?: string // AAAA-MM-DD
  turno?: Turno
  alergias?: string
  restricoes?: string
  saude?: string
}

export const ROTULO_TURNO: Record<Turno, string> = {
  MANHA: 'Meio período manhã (até o almoço)',
  TARDE: 'Meio período tarde (até 18h)',
  INTEGRAL: 'Integral (das 6h às 18h)',
}

export const MAX_CRIANCAS = 5
