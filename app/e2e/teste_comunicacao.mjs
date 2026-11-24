// Teste de ponta a ponta: rotina do dia para a família, comunicados e mensagens.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { ADMIN, APP, abrir, criarRelatorio, sql } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T15:00:00-03:00'
const JULIANA = ['00000000-0000-0000-0000-000000000001', 'juliana@exemplo.com']
const PATRICIA = ['00000000-0000-0000-0000-000000000003', 'patricia@exemplo.com']
const comoAdmin = () => abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
const como = ([id, email]) => abrir(browser, id, email, QUANDO)

// 1) Rotina do dia (família)
{
  const { ctx, page } = await como(JULIANA)
  await page.goto(`${APP}/familia/rotina`)
  await page.getByText('Nenhum registro de Lara neste dia.').waitFor()
  confere('R01 Hoje sem registros mostra aviso amigável', true)
  confere('R02 Não deixa avançar para o futuro', await page.getByRole('button', { name: 'Próximo dia' }).isDisabled())
  for (let i = 0; i < 11; i++) {
    await page.getByRole('button', { name: 'Dia anterior' }).click()
    await page.waitForTimeout(120)
  }
  await page.getByText('Chegou', { exact: true }).waitFor()
  const itens = page.locator('main ol > li')
  const texto = await page.locator('main').innerText()
  confere('R03 Dia 02/10 mostra entrada, 4 registros visíveis e saída', (await itens.count()) === 6, `veio ${await itens.count()}`)
  confere('R04 Anotação interna da administração não aparece', !texto.includes('Anotação interna'))
  confere('R05 Mostra quem buscou e como comeu', texto.includes('Buscado(a) por Juliana Mendes') && texto.includes('Comeu tudo'))
  await page.screenshot({ path: `${PASTA}/comunicacao_1_rotina.png`, fullPage: true })
  await page.getByRole('button', { name: /Pedro/ }).click()
  await page.getByText('Nenhum registro de Pedro neste dia.').waitFor()
  confere('R06 Troca de criança (irmãos) funciona', true)
  await ctx.close()
}

// 2) Comunicados
{
  const { ctx, page } = await comoAdmin()
  await page.goto(`${APP}/admin/comunicados`)
  await page.getByRole('button', { name: 'Enviar comunicado' }).click()
  confere('M01 Comunicado sem título é recusado', await page.getByText('Escreva um título.').isVisible())
  await page.getByLabel('Título').fill('Reunião de pais')
  await page.getByLabel('Mensagem').fill('Sexta às 18h teremos uma conversa rápida com as famílias.')
  await page.getByRole('button', { name: 'Enviar comunicado' }).click()
  await page.getByText('Comunicado enviado para todas as famílias.').waitFor()
  await page.getByLabel('Para quem').selectOption({ label: 'Família de Davi Souza' })
  await page.getByLabel('Título').fill('Agasalho do Davi')
  await page.getByLabel('Mensagem').fill('O Davi esqueceu o agasalho azul aqui.')
  await page.getByRole('button', { name: 'Enviar comunicado' }).click()
  await page.getByText('Comunicado enviado para a família de Davi Souza.').waitFor()
  confere('M02 Comunicados gravados e famílias avisadas',
    sql(`SELECT count(*) FROM comunicado`) === '3' &&
    sql(`SELECT count(*) FROM notificacao n JOIN usuario u ON u.id=n.usuario_id WHERE u.email='patricia@exemplo.com' AND n.tipo='COMUNICADO'`) === '3')
  await ctx.close()
}
{
  const { ctx, page } = await como(JULIANA)
  await page.goto(`${APP}/familia/mensagens`)
  await page.getByText('Reunião de pais').waitFor()
  const texto = await page.locator('main').innerText()
  confere('M03 Juliana vê os comunicados gerais e não vê o do Davi', texto.includes('Festa do Dia das Crianças') && !texto.includes('Agasalho do Davi'))

  // 3) Conversa
  await page.getByRole('tab', { name: 'Fale com o hotelzinho' }).click()
  await page.getByText('Nenhuma mensagem ainda').waitFor()
  await page.getByLabel('Escreva sua mensagem').fill('A Lara vai sair às 15h amanhã.')
  await page.getByRole('button', { name: 'Enviar mensagem' }).click()
  await page.getByText('A Lara vai sair às 15h amanhã.').waitFor()
  confere('M04 Mensagem da mãe gravada com o nome dela',
    sql(`SELECT remetente_nome FROM mensagem WHERE conteudo LIKE 'A Lara vai sair%'`) === 'Juliana Mendes')
  await ctx.close()
}
{
  const { ctx, page } = await como(PATRICIA)
  await page.goto(`${APP}/familia/mensagens`)
  await page.getByText('Agasalho do Davi').waitFor()
  confere('M05 Patrícia vê o comunicado individual do Davi', true)
  await page.getByRole('tab', { name: 'Fale com o hotelzinho' }).click()
  await page.getByText('Nenhuma mensagem ainda').waitFor()
  confere('M06 Patrícia não vê a conversa da Lara', !(await page.getByText('A Lara vai sair').isVisible()))
  await ctx.close()
}
{
  const { ctx, page } = await comoAdmin()
  await page.goto(`${APP}/admin`)
  await page.getByText('1 mensagem nova das famílias').waitFor()
  confere('M07 Início avisa a mensagem nova', true)
  await page.getByText('1 mensagem nova das famílias').click()
  const lara = page.locator('main ul > li', { hasText: 'Lara Mendes' })
  await lara.locator('[aria-label="1 mensagens novas"]').waitFor({ timeout: 5000 }).catch(() => {})
  const primeira = await page.locator('main ul > li').first().innerText()
  confere('M08 Lista mostra a Lara primeiro, com 1 não lida',
    primeira.includes('Lara Mendes') && (await lara.locator('[aria-label="1 mensagens novas"]').isVisible()), primeira)
  await lara.click()
  await page.getByText('A Lara vai sair às 15h amanhã.').waitFor()
  await page.waitForTimeout(500)
  confere('M09 Ao abrir, a mensagem fica marcada como lida', sql(`SELECT lida_em IS NOT NULL FROM mensagem WHERE conteudo LIKE 'A Lara vai sair%'`) === 't')
  await page.getByLabel('Escreva sua mensagem').fill('Combinado, Juliana! Obrigada por avisar.')
  await page.getByRole('button', { name: 'Enviar mensagem' }).click()
  await page.getByText('Combinado, Juliana!').waitFor()
  await page.screenshot({ path: `${PASTA}/comunicacao_2_conversa_admin.png` })
  await ctx.close()
}
{
  const { ctx, page } = await como(JULIANA)
  await page.goto(`${APP}/familia/mensagens`)
  await page.getByRole('tab', { name: 'Fale com o hotelzinho' }).click()
  await page.getByText('Combinado, Juliana!').waitFor()
  confere('M10 Juliana recebe a resposta assinada como "Hotelzinho"', await page.getByText('Hotelzinho', { exact: true }).isVisible())
  await page.screenshot({ path: `${PASTA}/comunicacao_3_conversa_familia.png` })
  await ctx.close()
}

await browser.close()
process.exit(fim() ? 1 : 0)
