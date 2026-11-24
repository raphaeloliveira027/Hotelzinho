// Rodar (na pasta local/): npm i web-push@3.6.7, gerar cert.pem/chave.pem (openssl, CN=localhost)
// e: POSTGREST=caminho/do/postgrest node teste_funcao_push.mjs
// Teste da função enviar-push rodando de verdade (Deno), contra o banco local (PostgREST)
// e um "serviço de push" falso em HTTPS que DECIFRA a mensagem como o celular faria.
import https from 'node:https'
import http from 'node:http'
import crypto from 'node:crypto'
import { execSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const webpush = require('web-push')
const ece = require('http_ece')

const RAIZ = '/home/claude/hotelzinho'
const sql = (q) => execSync(`psql -h /tmp -U postgres -d hotelzinho -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim()
const { token } = await import(`${RAIZ}/app/e2e/jwt.mjs`)
const resultados = []
const confere = (nome, cond, det = '') => { resultados.push(!!cond); console.log(`${cond ? 'OK    ' : 'FALHOU'} ${nome} ${cond ? '' : det}`) }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) Aparelho falso: chaves como as que o navegador cria
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
const p256dh = ecdh.getPublicKey().toString('base64url')
const authSecret = crypto.randomBytes(16)
const recebidos = []
const servidorPush = https.createServer({ key: readFileSync(new URL('chave.pem', import.meta.url)), cert: readFileSync(new URL('cert.pem', import.meta.url)) }, (req, res) => {
  const partes = []
  req.on('data', (c) => partes.push(c))
  req.on('end', () => {
    const corpo = Buffer.concat(partes)
    let texto = null
    try { texto = ece.decrypt(corpo, { version: 'aes128gcm', privateKey: ecdh, authSecret }).toString() } catch (e) { texto = 'ERRO ' + e.message }
    recebidos.push({ caminho: req.url, cabecalhos: req.headers, texto })
    if (req.url.startsWith('/vencida')) { res.writeHead(410); return res.end() }
    res.writeHead(201); res.end()
  })
}).listen(8443)

// 2) Rota /rest/v1 → PostgREST (como no Supabase)
const proxy = http.createServer((req, res) => {
  const alvo = http.request({ host: 'localhost', port: 3000, path: req.url.replace('/rest/v1', ''), method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res)
  })
  req.pipe(alvo)
}).listen(54321)

const pgrst = spawn(process.env.POSTGREST, ['/tmp/pgrst-hotelzinho.conf'], { stdio: 'ignore' })
const vapid = webpush.generateVAPIDKeys()
const funcao = spawn('deno', ['run', '-A', '--unsafely-ignore-certificate-errors=localhost', `${RAIZ}/supabase/functions/enviar-push/index.ts`], {
  env: { ...process.env, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:hotelzinho@exemplo.com',
         SUPABASE_URL: 'http://localhost:54321', DENO_CERT: new URL('cert.pem', import.meta.url).pathname, NODE_EXTRA_CA_CERTS: new URL('cert.pem', import.meta.url).pathname, SUPABASE_SERVICE_ROLE_KEY: token({ role: 'service_role' }) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logFuncao = ''
funcao.stdout.on('data', (d) => { logFuncao += d }); funcao.stderr.on('data', (d) => { logFuncao += d })
const FUNCAO = 'http://localhost:8000'
for (let i = 0; i < 60; i++) { try { await fetch(FUNCAO, { method: 'OPTIONS' }); break } catch { await espera(500) } }

try {
  // GET devolve a chave pública
  const g = await (await fetch(FUNCAO)).json()
  confere('F01 GET devolve a chave pública (para o app ativar os avisos)', g.chavePublica === vapid.publicKey, JSON.stringify(g))
  const o = await fetch(FUNCAO, { method: 'OPTIONS' })
  confere('F02 Aceita chamadas do app (CORS)', o.headers.get('access-control-allow-origin') === '*')
  const ruim = await fetch(FUNCAO, { method: 'POST', body: '{"notificacao":"abc"}' })
  confere('F03 Pedido inválido é recusado', ruim.status === 400)

  // Juliana com dois aparelhos: um ativo e um que já não existe
  const juliana = sql(`SELECT id FROM usuario WHERE email='juliana@exemplo.com'`)
  sql(`DELETE FROM push_inscricao`)
  sql(`INSERT INTO push_inscricao (usuario_id, endpoint, p256dh, auth) VALUES
       ('${juliana}', 'https://localhost:8443/ok-celular', '${p256dh}', '${authSecret.toString('base64url')}'),
       ('${juliana}', 'https://localhost:8443/vencida', '${p256dh}', '${authSecret.toString('base64url')}')`)
  sql(`SELECT notificar_familia((SELECT id FROM crianca WHERE nome_completo='Lara Mendes'), 'RECADO', 'Você recebeu um recado do hotelzinho.', '/familia/rotina')`)
  const id = sql(`SELECT id FROM notificacao WHERE usuario_id='${juliana}' ORDER BY id DESC LIMIT 1`)

  const r1 = await (await fetch(FUNCAO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificacao: Number(id) }) })).json()
  confere('F04 Envia para o aparelho ativo e remove o vencido', r1.enviados === 1 && r1.removidos === 1, JSON.stringify(r1) + logFuncao)
  const ok = recebidos.find((x) => x.caminho === '/ok-celular')
  const aviso = ok && JSON.parse(ok.texto)
  confere('F05 O celular consegue decifrar o aviso e o texto é o do banco',
    aviso?.titulo === 'Recado' && aviso?.texto === 'Você recebeu um recado do hotelzinho.' && aviso?.link === '/familia/rotina', ok?.texto)
  confere('F06 Aviso assinado com a chave do hotelzinho (VAPID) e válido por 1 dia',
    /vapid t=.+, k=/.test(ok?.cabecalhos?.authorization ?? '') && ok?.cabecalhos?.ttl === '86400', JSON.stringify(ok?.cabecalhos))
  confere('F07 Aparelho vencido apagado do banco', sql(`SELECT count(*) FROM push_inscricao WHERE endpoint LIKE '%/vencida'`) === '0')

  const antes = recebidos.length
  const r2 = await (await fetch(FUNCAO, { method: 'POST', body: JSON.stringify({ notificacao: Number(id) }) })).json()
  confere('F08 Chamar de novo não repete o aviso', r2.enviados === 0 && recebidos.length === antes, JSON.stringify(r2))
  const r3 = await (await fetch(FUNCAO, { method: 'POST', body: JSON.stringify({ notificacao: 999999 }) })).json()
  confere('F09 Notificação inexistente não envia nada', r3.enviados === 0 && recebidos.length === antes)
} finally {
  funcao.kill(); pgrst.kill(); servidorPush.close(); proxy.close()
}
console.log(`\n${resultados.filter(Boolean).length} de ${resultados.length} verificações aprovadas`)
process.exit(resultados.every(Boolean) ? 0 : 1)
