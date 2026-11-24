// Teste de ponta a ponta do financeiro: gerar → família paga e envia comprovante → administração confere.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { ADMIN, APP, abrir, criarRelatorio, sql } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T10:00:00-03:00'
const JULIANA = ['00000000-0000-0000-0000-000000000001', 'juliana@exemplo.com']
const PATRICIA = ['00000000-0000-0000-0000-000000000003', 'patricia@exemplo.com']
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const crc16 = (t) => { let c = 0xffff; for (const ch of t) { c ^= ch.charCodeAt(0) << 8; for (let b = 0; b < 8; b++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff } return c.toString(16).toUpperCase().padStart(4, '0') }
const statusDe = (crianca, comp) => sql(`SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id=v.crianca_id WHERE c.nome_completo='${crianca}' AND v.competencia='${comp}'`)

const comoAdmin = () => abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
const comoFamilia = ([id, email]) => abrir(browser, id, email, QUANDO)
const abrirMensalidade = async (page, crianca) => {
  await page.locator('main ul > li', { hasText: crianca }).locator('button', { hasText: 'Pagar com Pix' }).first().click()
  return page.getByRole('dialog')
}

// 1) Gerar mensalidades de outubro
{
  const { ctx, page } = await comoAdmin()
  await page.goto(`${APP}/admin/financeiro`)
  await page.getByText('ainda não foram geradas').waitFor()
  await page.getByRole('button', { name: 'Gerar mensalidades de Outubro/2026' }).click()
  await page.getByText('5 mensalidades de Outubro/2026 geradas.').waitFor()
  confere('P01 Gera uma mensalidade por criança ativa', sql(`SELECT count(*) FROM mensalidade WHERE competencia='2026-10-01'`) === '5')
  await page.getByText('R$\u00a02.890,00').first().waitFor({ timeout: 5000 }).catch(() => {})
  confere('P02 Resumo mostra o total previsto do mês (R$ 2.890,00)', await page.getByText('R$ 2.890,00').first().isVisible())
  await page.getByRole('tab', { name: /Atrasadas/ }).click()
  confere('P03 Atrasadas mostra o Benício (setembro)', (await page.locator('main ul > li').count()) === 1 && await page.getByText('Benício Rocha').isVisible())
  await page.screenshot({ path: `${PASTA}/financeiro_1_admin.png` })
  await ctx.close()
}

// 2) Família tenta pagar antes de existir chave Pix
{
  const { ctx, page } = await comoFamilia(JULIANA)
  await page.goto(`${APP}/familia/mensalidades`)
  await page.getByText('Valor em aberto').waitFor()
  const folha = await abrirMensalidade(page, 'Lara Mendes')
  confere('P04 Sem chave Pix cadastrada, a família é avisada', await folha.getByText('ainda não foi cadastrada').isVisible())
  await ctx.close()
}

// 3) Administração cadastra a chave Pix
{
  const { ctx, page } = await comoAdmin()
  await page.goto(`${APP}/admin/mais`)
  await page.getByLabel('Chave Pix').waitFor()
  await page.getByRole('button', { name: 'Salvar dados do Pix' }).click()
  confere('P05 Chave vazia é recusada', await page.getByText('Informe a chave Pix').isVisible())
  await page.getByLabel('Chave Pix').fill('pix@exemplo.com')
  await page.getByLabel('Nome do recebedor').fill('Hotelzinho Teste')
  await page.getByLabel('Cidade').fill('São Paulo')
  await page.getByRole('button', { name: 'Salvar dados do Pix' }).click()
  await page.getByText('Dados do Pix salvos.').waitFor()
  confere('P06 Dados do Pix salvos sem acento e em maiúsculas',
    sql(`SELECT pix_chave||'|'||pix_nome||'|'||pix_cidade FROM configuracao`) === 'pix@exemplo.com|HOTELZINHO TESTE|SAO PAULO')
  await ctx.close()
}

// 4) Família paga a Lara e envia comprovante
{
  const { ctx, page } = await comoFamilia(JULIANA)
  await page.goto(`${APP}/familia/mensalidades`)
  await page.getByText('Valor em aberto').waitFor()
  confere('P07 Juliana vê só as mensalidades dos filhos dela (Lara e Pedro)',
    !(await page.getByText('Davi').isVisible()) && (await page.locator('main ul > li').count()) === 4)
  const folha = await abrirMensalidade(page, 'Lara Mendes')
  await folha.getByRole('img', { name: /QR Code Pix/ }).waitFor()
  await folha.getByRole('button', { name: /Copiar código Pix/ }).click()
  await folha.getByText('Código copiado!').waitFor()
  const codigo = await page.evaluate(() => navigator.clipboard.readText())
  confere('P08 Código Pix tem chave, valor R$ 650,00 e CRC válido',
    codigo.includes('pix@exemplo.com') && codigo.includes('5406650.00') && crc16(codigo.slice(0, -4)) === codigo.slice(-4), codigo)
  await page.screenshot({ path: `${PASTA}/financeiro_2_pagar.png` })

  await folha.locator('input[type=file]').setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('x') })
  confere('P09 Arquivo que não é foto/PDF é recusado', await folha.getByText('Envie uma foto (JPG, PNG) ou PDF.').isVisible())
  await folha.locator('input[type=file]').setInputFiles({ name: 'comprovante.png', mimeType: 'image/png', buffer: PNG })
  await folha.getByRole('button', { name: 'Enviar comprovante' }).click()
  await page.getByText('Comprovante enviado. A mensalidade está em análise').waitFor()
  const idJuliana = sql(`SELECT id FROM responsavel WHERE nome='Juliana Mendes'`)
  confere('P10 Comprovante registrado na pasta da Juliana e mensalidade EM_ANALISE',
    sql(`SELECT arquivo_path FROM comprovante ORDER BY id DESC LIMIT 1`).startsWith(`${idJuliana}/`) &&
    statusDe('Lara Mendes', '2026-10-01') === 'EM_ANALISE')

  // Pedro também (este será recusado)
  const folha2 = await abrirMensalidade(page, 'Pedro Mendes')
  await folha2.locator('input[type=file]').setInputFiles({ name: 'comprovante.png', mimeType: 'image/png', buffer: PNG })
  await folha2.getByRole('button', { name: 'Enviar comprovante' }).click()
  await folha2.waitFor({ state: 'hidden' })
  await ctx.close()
}

// 5) Administração confere: confirma a Lara, recusa o Pedro, recebe o Benício em dinheiro
{
  const { ctx, page } = await comoAdmin()
  await page.goto(`${APP}/admin/financeiro`)
  await page.getByRole('tab', { name: 'Em análise (2)' }).waitFor()
  confere('P11 Aba "Em análise" mostra os 2 comprovantes', true)
  await page.locator('main ul > li', { hasText: 'Lara Mendes' }).click()
  const folha = page.getByRole('dialog')
  await folha.getByText('Antes de confirmar, confira no extrato').waitFor()
  await page.screenshot({ path: `${PASTA}/financeiro_3_conferir.png` })
  await folha.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await page.getByText('Pagamento de Lara Mendes confirmado.').waitFor()
  confere('P12 Confirmado: Lara PAGO com pagamento de R$ 650,00',
    statusDe('Lara Mendes', '2026-10-01') === 'PAGO' &&
    sql(`SELECT p.valor_pago FROM pagamento p JOIN mensalidade m ON m.id=p.mensalidade_id JOIN crianca c ON c.id=m.crianca_id WHERE c.nome_completo='Lara Mendes' AND m.competencia='2026-10-01'`) === '650.00')

  await page.getByRole('tab', { name: /Em análise/ }).click()
  await page.locator('main ul > li', { hasText: 'Pedro Mendes' }).click()
  await folha.getByRole('button', { name: 'Recusar' }).click()
  await folha.getByRole('button', { name: 'Enviar recusa' }).click()
  confere('P13 Recusa sem motivo é bloqueada', await folha.getByText('Explique o motivo').isVisible())
  await folha.getByLabel(/Motivo da recusa/).fill('Valor diferente da mensalidade.')
  await folha.getByRole('button', { name: 'Enviar recusa' }).click()
  await page.getByText('Comprovante recusado. A família recebeu o motivo.').waitFor()
  confere('P14 Recusado: Pedro volta para PENDENTE', statusDe('Pedro Mendes', '2026-10-01') === 'PENDENTE')

  await page.getByRole('tab', { name: /Atrasadas/ }).click()
  await page.locator('main ul > li', { hasText: 'Benício Rocha' }).click()
  await folha.getByRole('button', { name: /Registrar pagamento em dinheiro/ }).click()
  await folha.getByRole('button', { name: 'Registrar pagamento', exact: true }).click()
  await page.getByText('Pagamento de R$ 650,00 registrado para Benício Rocha.').waitFor()
  await page.getByRole('tab', { name: 'Atrasadas (0)' }).waitFor({ timeout: 5000 }).catch(() => {})
  confere('P15 Pagamento em dinheiro quita o setembro do Benício',
    statusDe('Benício Rocha', '2026-09-01') === 'PAGO' && (await page.getByRole('tab', { name: 'Atrasadas (0)' }).isVisible()))
  await ctx.close()
}

// 6) Família vê o resultado; outra família não vê nada disso
{
  const { ctx, page } = await comoFamilia(JULIANA)
  await page.goto(`${APP}/familia/mensalidades`)
  await page.getByText('Comprovante anterior recusado: Valor diferente da mensalidade.').waitFor({ timeout: 8000 }).catch(() => {})
  confere('P16 Juliana vê o motivo da recusa do Pedro', await page.getByText('Comprovante anterior recusado: Valor diferente da mensalidade.').isVisible())
  await page.screenshot({ path: `${PASTA}/financeiro_4_familia.png`, fullPage: true })
  await ctx.close()
}
{
  const { ctx, page } = await comoFamilia(PATRICIA)
  await page.goto(`${APP}/familia/mensalidades`)
  await page.getByText('Valor em aberto').waitFor()
  await page.locator('main ul > li').first().waitFor()
  const texto = await page.locator('main').innerText()
  confere('P17 Patrícia vê só as mensalidades do Davi',
    (await page.locator('main ul > li').count()) === 2 && texto.includes('Davi Souza') && !texto.includes('Lara') && !texto.includes('Pedro'))
  await ctx.close()
}

await browser.close()
process.exit(fim() ? 1 : 0)
