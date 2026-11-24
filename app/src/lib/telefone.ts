// Telefone brasileiro: (DDD) 9XXXX-XXXX (celular) ou (DDD) XXXX-XXXX (fixo).
// A mesma regra existe no banco (função telefone_valido, migração 0006).

const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
])

/** Formata enquanto a pessoa digita: 11912345678 -> (11) 91234-5678 */
export function mascararTelefone(valor: string) {
  const d = valor.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  if (d.length === 11) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`
  return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`
}

/** Explica o problema do telefone, ou devolve null se estiver certo. */
export function problemaTelefone(t: string): string | null {
  const d = t.replace(/\D/g, '')
  if (d.length < 10) return 'Digite o DDD e o número completo. Ex.: (11) 91234-5678'
  if (!DDDS.has(Number(d.slice(0, 2)))) return `O DDD ${d.slice(0, 2)} não existe.`
  if (d.length === 11 && d[2] !== '9') return 'Celular deve começar com 9 depois do DDD.'
  if (d.length === 10 && !/[2-5]/.test(d[2])) return 'Telefone fixo deve começar com 2, 3, 4 ou 5 depois do DDD.'
  if (!/^\(\d{2}\) (9\d{4}|[2-5]\d{3})-\d{4}$/.test(t)) return 'Use o formato (11) 91234-5678.'
  return null
}

export const telefoneValido = (t: string) => problemaTelefone(t) === null
