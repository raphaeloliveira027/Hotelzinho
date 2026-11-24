/**
 * Geração do código Pix "copia e cola" ESTÁTICO (padrão BR Code do Banco Central).
 *
 * Importante: isto NÃO é integração bancária. O código só preenche chave, valor e
 * recebedor no app do banco de quem paga. O sistema não fica sabendo se o pagamento
 * aconteceu: a administradora confere o extrato e confirma o comprovante.
 */

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`

/** Remove acentos e caracteres fora do padrão e limita o tamanho. */
export const limparTexto = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().toUpperCase().slice(0, max)

/** CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63. */
export function crc16(texto: string) {
  let crc = 0xffff
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export type DadosPix = {
  chave: string
  nome: string
  cidade: string
  valor?: number
  identificador?: string // aparece no extrato de quem recebe (até 25 letras/números)
}

export function codigoPix({ chave, nome, cidade, valor, identificador }: DadosPix) {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave.trim())
  const txid = (identificador ?? '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const semCrc =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') + // real
    (valor && valor > 0 ? campo('54', valor.toFixed(2)) : '') +
    campo('58', 'BR') +
    campo('59', limparTexto(nome, 25) || 'RECEBEDOR') +
    campo('60', limparTexto(cidade, 15) || 'CIDADE') +
    campo('62', campo('05', txid)) +
    '6304'
  return semCrc + crc16(semCrc)
}
