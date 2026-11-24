// Teste de ponta a ponta: avisos no celular (ativar, desativar, sair, bloqueado, iPhone)
// e o service worker mostrando o aviso que chega do servidor.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { ADMIN, APP, abrir, criarRelatorio, sql } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T10:00:00-03:00'
const JULIANA = ['00000000-0000-0000-0000-000000000001', 'juliana@exemplo.com']
const CHAVE = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url') // chave pública de 65 bytes

/** Simula o navegador do celular: permissão de avisos e serviço de push (sem depender do Google/Apple). */
async function celular(ctx, cfg) {
  await ctx.addInitScript((c) => {
    const sub = {
      endpoint: c.endpoint,
      toJSON() { return { endpoint: c.endpoint, keys: { p256dh: 'B' + 'k'.repeat(86), auth: 'a'.repeat(22) } } },
      unsubscribe: async () => { sessionStorage.setItem('inscrito', '0'); return true },
    }
    const inscrito = () => sessionStorage.getItem('inscrito') === '1'
    const reg = { pushManager: {
      getSubscription: async () => (inscrito() ? sub : null),
      subscribe: async (o) => { sessionStorage.setItem('chave', String(o.applicationServerKey.length)); sessionStorage.setItem('inscrito', '1'); return sub },
    } }
    const sw = { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg), addEventListener() {}, removeEventListener() {} }
    Object.defineProperty(navigator, 'serviceWorker', { get: () => sw, configurable: true })
    window.PushManager = function () {}
    let perm = sessionStorage.getItem('perm') || c.permissao
    window.Notification = { get permission() { return perm }, requestPermission: async () => { perm = c.resposta; sessionStorage.setItem('perm', perm); return perm } }
    if (c.iphone) Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' })
  }, { permissao: 'default', resposta: 'granted', iphone: false, ...cfg })
  const pedidosChave = []
  await ctx.route('http://localhost:54321/functions/v1/**', (route) => {
    pedidosChave.push(route.request().method())
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ chavePublica: CHAVE }) })
  })
  return pedidosChave
}
const aparelhos = (email) => sql(`SELECT count(*) FROM push_inscricao p JOIN usuario u ON u.id = p.usuario_id WHERE u.email = '${email}'`)

// 1) Administradora ativa pelo convite do Início
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
  const pedidosChave = await celular(ctx, { endpoint: 'https://push.exemplo.com/celular-admin' })
  await page.goto(`${APP}/admin`)
  await page.getByText('Receba avisos no celular').waitFor()
  confere('V01 Início da administração convida a ativar os avisos', true)
  await page.screenshot({ path: `${PASTA}/avisos_1_convite.png` })
  await page.getByRole('button', { name: 'Ativar avisos' }).click()
  await page.getByText('Receba avisos no celular').waitFor({ state: 'detached' })
  confere('V02 Ativou: celular guardado no banco, ligado à administradora',
    aparelhos('admin@exemplo.com') === '1' &&
    sql(`SELECT aparelho FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/celular-admin'`) !== '')
  confere('V03 Usa a chave pública pedida ao servidor', pedidosChave.includes('GET') && (await page.evaluate(() => sessionStorage.getItem('chave'))) === '65')

  await page.goto(`${APP}/admin/mais`)
  await page.getByText('Avisos ativados neste celular.').waitFor()
  confere('V04 Em Mais aparece que os avisos estão ativos', true)
  await page.screenshot({ path: `${PASTA}/avisos_2_mais.png`, fullPage: true })
  await page.getByRole('button', { name: 'Desativar avisos neste celular' }).click()
  await page.getByRole('button', { name: 'Ativar avisos' }).waitFor()
  confere('V05 Desativar apaga o celular do banco', aparelhos('admin@exemplo.com') === '0')
  await ctx.close()
}

// 2) Família: dispensar o convite, ativar pelo ajuste e sair da conta
{
  const { ctx, page } = await abrir(browser, ...JULIANA, QUANDO)
  await celular(ctx, { endpoint: 'https://push.exemplo.com/celular-juliana' })
  await page.goto(`${APP}/familia`)
  await page.getByText('Receba avisos no celular').waitFor()
  await page.getByRole('button', { name: 'Agora não' }).click()
  await page.reload()
  await page.getByText('Avisos no celular').waitFor()
  confere('V06 "Agora não" esconde o convite (e continua escondido depois)', !(await page.getByText('Receba avisos no celular').isVisible()))
  await page.getByRole('button', { name: 'Ativar avisos' }).click()
  await page.getByText('Avisos ativados neste celular.').waitFor()
  confere('V07 Mãe ativa pelo ajuste no fim do Início', aparelhos('juliana@exemplo.com') === '1')

  sql(`DELETE FROM net.pedidos`)
  sql(`SELECT notificar_familia((SELECT id FROM crianca WHERE nome_completo = 'Lara Mendes'), 'RECADO', 'Você recebeu um recado do hotelzinho.', '/familia/rotina')`)
  confere('V08 Recado novo para a Lara dispara o envio para o celular da mãe',
    sql(`SELECT count(*) FROM net.pedidos`) === '1')

  await page.getByRole('button', { name: 'Sair' }).first().click()
  await page.getByText('Como você quer entrar?').waitFor()
  confere('V09 Ao sair da conta, o celular deixa de receber os avisos dela', aparelhos('juliana@exemplo.com') === '0')
  await ctx.close()
}

// 3) Avisos bloqueados no celular
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
  await celular(ctx, { endpoint: 'https://push.exemplo.com/bloqueado', permissao: 'denied' })
  await page.goto(`${APP}/admin/mais`)
  await page.getByText('bloqueados').waitFor()
  await page.goto(`${APP}/admin`)
  await page.getByText('Crianças ativas').waitFor()
  confere('V10 Bloqueado: explica como liberar e não fica insistindo no Início', !(await page.getByText('Receba avisos no celular').isVisible()))
  await ctx.close()
}

// 4) iPhone sem o app instalado
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
  await celular(ctx, { endpoint: 'https://push.exemplo.com/iphone', iphone: true })
  await page.goto(`${APP}/admin/mais`)
  await page.getByText('No iPhone, os avisos só funcionam com o app instalado').waitFor()
  confere('V11 iPhone sem o app instalado: mostra como instalar primeiro', true)
  await ctx.close()
}

// 5) Cadastro esperando aprovação: pode ativar para saber quando for aprovado
{
  const id = '00000000-0000-0000-0000-0000000000e1'
  sql(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${id}', 'esperando@exemplo.com',
       '{"origem":"app","nome":"Mãe Esperando","telefone":"(11) 95555-1111","parentesco":"Mãe","aceite_termo":"true"}') ON CONFLICT DO NOTHING`)
  const { ctx, page } = await abrir(browser, id, 'esperando@exemplo.com', QUANDO)
  await celular(ctx, { endpoint: 'https://push.exemplo.com/esperando' })
  await page.goto(APP)
  await page.getByText('Ative os avisos para saber na hora quando o seu cadastro for aprovado.').waitFor()
  await page.getByRole('button', { name: 'Ativar avisos' }).click()
  await page.getByText('Ative os avisos para saber').waitFor({ state: 'detached' })
  confere('V12 Conta em análise ativa os avisos para saber da aprovação', aparelhos('esperando@exemplo.com') === '1')
  await ctx.close()
}

// 6) Service worker de verdade: aviso chegando do servidor aparece no celular
// (o Chromium completo; o modo "headless shell" não mostra notificações)
const chromiumCompleto = await chromium.launch({ channel: 'chromium' })
{
  const ctx = await chromiumCompleto.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.grantPermissions(['notifications'], { origin: APP })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const registros = []
  cdp.on('ServiceWorker.workerRegistrationUpdated', (ev) => registros.push(...ev.registrations))
  await cdp.send('ServiceWorker.enable')
  await page.goto(APP)
  await page.evaluate(() => navigator.serviceWorker.ready)
  for (let i = 0; i < 30 && !registros.some((r) => !r.isDeleted); i++) await page.waitForTimeout(100)
  const reg = registros.find((r) => !r.isDeleted)
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: APP, registrationId: reg.registrationId,
    data: JSON.stringify({ titulo: 'Recado', texto: 'Você recebeu um recado do hotelzinho.', link: '/familia/rotina', tag: 'RECADO-1' }),
  })
  let avisos = []
  for (let i = 0; i < 30 && !avisos.length; i++) {
    avisos = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
      .map((n) => ({ titulo: n.title, texto: n.body, link: n.data?.link, icone: n.icon })))
    if (!avisos.length) await page.waitForTimeout(100)
  }
  confere('V13 O aviso aparece no celular com título, texto, ícone e a tela certa para abrir',
    avisos[0]?.titulo === 'Hotelzinho · Recado' && avisos[0]?.texto === 'Você recebeu um recado do hotelzinho.' &&
    avisos[0]?.link === '/familia/rotina' && avisos[0]?.icone?.endsWith('/icones/icone-192.png'), JSON.stringify(avisos))
  await ctx.close()
}

await chromiumCompleto.close()
await browser.close()
process.exit(fim() ? 1 : 0)
