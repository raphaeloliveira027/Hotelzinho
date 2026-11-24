// Funções comuns aos testes de ponta a ponta.
import { execSync } from 'node:child_process'
import { token } from './jwt.mjs'

export const APP = 'http://localhost:4173'
export const API = 'http://localhost:3000'
export const ADMIN = '00000000-0000-0000-0000-00000000000a'

/** Consulta direta no banco local (para conferir o que a tela gravou). */
export const sql = (q) =>
  execSync(`psql -h /tmp -U postgres -d hotelzinho -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim()

export function criarRelatorio() {
  const resultados = []
  const confere = (nome, cond, det = '') => {
    resultados.push({ nome, ok: !!cond })
    console.log(`${cond ? 'OK    ' : 'FALHOU'} ${nome} ${cond ? '' : det}`)
  }
  const fim = () => {
    const falhas = resultados.filter((r) => !r.ok).length
    console.log(`\n${resultados.length - falhas} de ${resultados.length} verificações aprovadas`)
    return falhas
  }
  return { confere, fim }
}

/** Monta uma sessão do Supabase Auth (token assinado com o segredo do PostgREST local). */
export function sessaoPara(uid, email) {
  return {
    access_token: token({ sub: uid, role: 'authenticated', email }),
    refresh_token: 'local', token_type: 'bearer', expires_in: 3600, expires_at: 1924992000,
    user: { id: uid, email, aud: 'authenticated', role: 'authenticated', identities: [{ id: uid }] },
  }
}

const esc = (s) => String(s).replace(/'/g, "''")

/**
 * Abre o app com o relógio fixado em `quando`. Com `uid` = null, abre deslogado.
 * O Auth do Supabase é simulado: login por e-mail existente, cadastro grava em auth.users
 * (com os dados do formulário em raw_user_meta_data) e devolve "confirme seu e-mail".
 */
export async function abrir(browser, uid, email, quando) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR', serviceWorkers: 'block' })
  if (uid) await ctx.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), sessaoPara(uid, email))
  await ctx.route('http://localhost:54321/rest/v1/**', async (route) => {
    const url = route.request().url().replace('http://localhost:54321/rest/v1', API)
    try {
      const resp = await route.fetch({ url })
      await route.fulfill({ response: resp })
    } catch { /* página já fechada */ }
  })
  const chamadasAuth = [] // para os testes conferirem o que foi pedido ao Auth (ex.: recuperar senha)
  await ctx.route('http://localhost:54321/auth/v1/**', (route) => {
    const req = route.request()
    const url = req.url()
    chamadasAuth.push({ url, metodo: req.method(), corpo: req.postData() ? req.postDataJSON() : null })
    if (url.includes('/recover')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.includes('/token?grant_type=password')) {
      const { email: e } = req.postDataJSON()
      const id = sql(`SELECT id FROM auth.users WHERE lower(email)=lower('${esc(e)}')`)
      return id ? json(200, sessaoPara(id, e)) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })
    }
    if (url.includes('/signup')) {
      const { email: e, data } = req.postDataJSON()
      if (sql(`SELECT count(*) FROM auth.users WHERE lower(email)=lower('${esc(e)}')`) !== '0')
        return json(200, { id: crypto.randomUUID(), email: e, identities: [] })
      const id = crypto.randomUUID()
      sql(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${id}', '${esc(e)}', '${esc(JSON.stringify(data ?? {}))}')`)
      return json(200, { id, email: e, aud: 'authenticated', role: 'authenticated', identities: [{ id }] })
    }
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' })
    const auth = req.headers()['authorization'] ?? ''
    const corpo = auth.split('.')[1]
    const claims = corpo ? JSON.parse(Buffer.from(corpo, 'base64url').toString()) : {}
    return json(200, { id: claims.sub, email: claims.email, aud: 'authenticated', role: 'authenticated' })
  })
  // Storage simulado: aceita o envio do arquivo e devolve um link assinado fictício
  await ctx.route('http://localhost:54321/storage/v1/**', (route) => {
    const url = route.request().url()
    const body = url.includes('/object/sign/')
      ? { signedURL: '/object/sign/comprovantes/arquivo?token=teste' }
      : { Key: url.split('/object/')[1] ?? '', Id: 'teste' }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(new Date(quando))
  return { ctx, page, chamadasAuth }
}
