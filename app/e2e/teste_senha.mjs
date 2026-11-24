// Teste de ponta a ponta: "Esqueci minha senha" e criação de senha nova pelo link do e-mail.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { APP, abrir, criarRelatorio, sessaoPara } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T10:00:00-03:00'
const JULIANA = ['00000000-0000-0000-0000-000000000001', 'juliana@exemplo.com']
const deslogado = () => abrir(browser, null, null, QUANDO)
// Endereço que o Supabase monta no link do e-mail (fluxo padrão: dados depois do #)
const linkRecuperacao = (caminho) =>
  `${APP}${caminho}#access_token=${sessaoPara(...JULIANA).access_token}&expires_at=1924992000&expires_in=3600&refresh_token=local&token_type=bearer&type=recovery`

// 1) Pedir o link
{
  const { ctx, page, chamadasAuth } = await deslogado()
  await page.goto(APP)
  await page.getByRole('button', { name: /Sou pai, mãe ou responsável/ }).click()
  await page.getByLabel('E-mail').fill('juliana@exemplo.com')
  await page.getByRole('button', { name: 'Esqueci minha senha' }).click()
  confere('E01 "Esqueci minha senha" abre o pedido já com o e-mail digitado',
    (await page.getByLabel('E-mail').inputValue()) === 'juliana@exemplo.com')
  await page.getByLabel('E-mail').fill('juliana')
  await page.getByRole('button', { name: 'Enviar link' }).click()
  confere('E02 E-mail inválido é avisado', await page.getByText('Digite o e-mail que você usa para entrar.').isVisible())
  await page.getByLabel('E-mail').fill('Juliana@Exemplo.com')
  await page.getByRole('button', { name: 'Enviar link' }).click()
  await page.getByText('Confira seu e-mail').waitFor()
  const pedido = chamadasAuth.find((c) => c.url.includes('/recover'))
  confere('E03 Pede o link ao Supabase com o e-mail e a volta para /nova-senha',
    pedido?.corpo?.email === 'juliana@exemplo.com' && decodeURIComponent(pedido.url).includes(`redirect_to=${APP}/nova-senha`), JSON.stringify(pedido))
  confere('E04 Mensagem não revela se o e-mail tem conta', await page.getByText('Se juliana@exemplo.com tiver cadastro').isVisible())
  await page.screenshot({ path: `${PASTA}/senha_1_pedido.png` })
  await page.getByRole('button', { name: 'Voltar para entrar' }).click()
  confere('E05 Volta para a tela de entrar', await page.getByRole('button', { name: 'Entrar', exact: true }).isVisible())
  await ctx.close()
}
{
  const { ctx, page } = await deslogado()
  await page.goto(APP)
  await page.getByRole('button', { name: /Sou da administração/ }).click()
  confere('E06 A administração também tem "Esqueci minha senha"', await page.getByRole('button', { name: 'Esqueci minha senha' }).isVisible())
  await ctx.close()
}

// 2) Abrir o link do e-mail e criar a senha nova
{
  const { ctx, page, chamadasAuth } = await deslogado()
  await page.goto(linkRecuperacao('/nova-senha'))
  await page.getByText('Criar senha nova').waitFor()
  confere('E07 O link abre a tela de senha nova da conta certa', await page.getByText('Conta: juliana@exemplo.com').isVisible())
  await page.getByLabel(/^Senha nova/).fill('fraca')
  await page.getByLabel('Repita a senha nova').fill('outra')
  await page.getByRole('button', { name: 'Salvar senha nova' }).click()
  confere('E08 Senha fraca e senhas diferentes são avisadas',
    (await page.getByText('Use pelo menos 8 caracteres, com letras e números.').isVisible()) && (await page.getByText('As senhas não são iguais.').isVisible()))
  await page.getByLabel(/^Senha nova/).fill('novaSenha123')
  await page.getByLabel('Repita a senha nova').fill('novaSenha123')
  await page.screenshot({ path: `${PASTA}/senha_2_nova.png` })
  await page.getByRole('button', { name: 'Salvar senha nova' }).click()
  await page.getByText('Senha alterada!').waitFor()
  const troca = chamadasAuth.find((c) => c.metodo === 'PUT' && c.url.includes('/user'))
  confere('E09 Grava a senha nova no Supabase e encerra a sessão',
    troca?.corpo?.password === 'novaSenha123' && chamadasAuth.some((c) => c.url.includes('/logout')))
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByText('Como você quer entrar?').waitFor()
  confere('E10 Depois, volta para a tela de entrar (sem entrar sozinho)', page.url() === `${APP}/`)
  await ctx.close()
}

// 3) Link que caiu no endereço principal (sem /nova-senha): não entra direto no app
{
  const { ctx, page } = await deslogado()
  await page.goto(linkRecuperacao('/'))
  await page.getByText('Criar senha nova').waitFor()
  await page.waitForTimeout(800)
  confere('E11 Mesmo caindo no início, pede a senha nova em vez de abrir o painel',
    (await page.getByText('Criar senha nova').isVisible()) && !page.url().includes('/familia'))
  await ctx.close()
}

// 4) Link vencido
{
  const { ctx, page } = await deslogado()
  await page.goto(`${APP}/nova-senha#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`)
  await page.getByText('Link vencido').waitFor()
  confere('E12 Link vencido explica e oferece voltar', await page.getByRole('button', { name: 'Voltar para entrar' }).isVisible())
  await ctx.close()
}

await browser.close()
process.exit(fim() ? 1 : 0)
