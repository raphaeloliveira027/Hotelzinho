import { chromium, devices } from '/opt/node22/lib/node_modules/playwright/index.mjs'
const URL = 'http://localhost:4173'  // app gerado por e2e/rodar.sh
const out = []
const ok = (n, c, d = '') => out.push(`${c ? 'OK  ' : 'FALHOU'} ${n}${d ? ' — ' + d : ''}`)
const b = await chromium.launch()
// 1) Android/Chrome: manifesto, service worker, instalável
{
  const ctx = await b.newContext({ ...devices['Pixel 7'] })
  const p = await ctx.newPage()
  await p.goto(URL); await p.waitForLoadState('networkidle')
  const cdp = await ctx.newCDPSession(p)
  const man = await cdp.send('Page.getAppManifest')
  ok('P01 Manifesto lido sem erros', man.errors.length === 0, JSON.stringify(man.errors))
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active })
  ok('P02 Service worker ativo', sw)
  await p.reload(); await p.waitForTimeout(500)
  const inst = await cdp.send('Page.getInstallabilityErrors')
  ok('P03 Chrome considera o app instalável', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors))
  ok('P04 Cartão não aparece antes do pedido de instalação', !(await p.getByText('Instalar no celular').isVisible()))
  await p.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = async () => { window.__pediu = true }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e) })
  await p.getByRole('button', { name: 'Instalar no celular' }).waitFor()
  ok('P05 Botão "Instalar no celular" aparece no Android', true)
  await p.screenshot({ path: `${process.env.SAIDA}/pwa_1_android.png`, fullPage: true })
  await p.getByRole('button', { name: 'Instalar no celular' }).click()
  await p.waitForTimeout(300)
  ok('P06 Toque abre a janela de instalação e o cartão some', (await p.evaluate(() => window.__pediu)) === true && !(await p.getByText('Instalar no celular').isVisible()))
  // offline: abre a última versão guardada
  await ctx.setOffline(true)
  await p.goto(URL + '/familia').catch(() => {})
  ok('P07 Sem internet, o app ainda abre a tela', await p.getByText('Como você quer entrar?').waitFor({ timeout: 5000 }).then(() => true, () => false))
  await ctx.close()
}
// 2) iPhone: instruções do Safari
{
  const ctx = await b.newContext({ ...devices['iPhone 14'] })
  const p = await ctx.newPage()
  await p.goto(URL)
  await p.getByText('Adicionar à Tela de Início').waitFor()
  ok('P08 No iPhone mostra o passo a passo do Safari', true)
  await p.screenshot({ path: `${process.env.SAIDA}/pwa_2_iphone.png`, fullPage: true })
  await p.getByRole('button', { name: 'Fechar aviso de instalação' }).click()
  ok('P09 Dá para fechar o aviso', !(await p.getByText('Adicionar à Tela de Início').isVisible()))
  await ctx.close()
}
// 3) Já instalado: não mostra nada
{
  const ctx = await b.newContext({ ...devices['iPhone 14'] })
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }))
  const p = await ctx.newPage()
  await p.goto(URL); await p.getByText('Como você quer entrar?').waitFor()
  ok('P10 Aberto pelo ícone (já instalado), o convite não aparece', !(await p.getByText('Adicionar à Tela de Início').isVisible()))
  await ctx.close()
}
// 4) Rota direta funciona (rewrite do SPA no preview)
{
  const p = await b.newPage()
  const r = await p.goto(URL + '/manifest.webmanifest')
  ok('P11 Manifesto servido com tipo correto', (r.headers()['content-type'] ?? '').includes('manifest') || (r.headers()['content-type'] ?? '').includes('json'), r.headers()['content-type'])
}
await b.close()
console.log(out.join('\n'))
console.log(`\n${out.filter(l => l.startsWith('OK')).length} de ${out.length} aprovados`)
