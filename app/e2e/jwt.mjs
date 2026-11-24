import { createHmac } from 'node:crypto'
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export const SEGREDO = 'segredo-local-de-testes-com-mais-de-32-caracteres'
export function token(claims) {
  const cab = b64({ alg: 'HS256', typ: 'JWT' })
  const corpo = b64({ exp: 1924992000, ...claims }) // expira em 2031
  const ass = createHmac('sha256', SEGREDO).update(`${cab}.${corpo}`).digest('base64url')
  return `${cab}.${corpo}.${ass}`
}
