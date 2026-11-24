// Datas e horas sempre no fuso do aparelho (o hotelzinho funciona no horário local).

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/** Data local no formato AAAA-MM-DD */
export const dataISO = (d: Date = new Date()) =>
  `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`

/** Hora local no formato HH:MM */
export const horaAgora = (d: Date = new Date()) => `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`

/** "06:42:00" -> "06:42" */
export const horaCurta = (h: string | null | undefined) => (h ? h.slice(0, 5) : '')

/** Junta a data de hoje com uma hora HH:MM e devolve o instante em ISO (com fuso). */
export const instanteHoje = (hhmm: string, base: Date = new Date()) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m).toISOString()
}

/** Início do dia local e do dia seguinte, em ISO, para filtrar registros de hoje. */
export const intervaloDoDia = (base: Date = new Date()) => {
  const ini = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const fim = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)
  return { ini: ini.toISOString(), fim: fim.toISOString() }
}

/** Hora local HH:MM de um instante ISO */
export const horaDeInstante = (iso: string) => horaAgora(new Date(iso))

export const ehFimDeSemana = (d: Date = new Date()) => d.getDay() === 0 || d.getDay() === 6

export const dataPorExtenso = (d: Date = new Date()) =>
  d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
