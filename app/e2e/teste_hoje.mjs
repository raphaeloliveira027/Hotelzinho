// Teste de ponta a ponta da tela "Hoje" contra o banco local real (PostgREST + RLS).
// Pré-requisitos: banco recém-montado, PostgREST na porta 3000, app em http://localhost:4173
//   (build com VITE_SUPABASE_URL=http://localhost:54321).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { execSync } from 'node:child_process'
import { token } from './jwt.mjs'

const APP = 'http://localhost:4173'
const API = 'http://localhost:3000'
const PASTA = process.env.SAIDA ?? '.'
const ADMIN = '00000000-0000-0000-0000-00000000000a'
const JULIANA = '00000000-0000-0000-0000-000000000001'

const sql = (q) => execSync(`psql -h /tmp -U postgres -d hotelzinho -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim()
const resultados = []
const confere = (nome, cond, det = '') => { resultados.push({ nome, ok: !!cond, det }); console.log(`${cond ? 'OK    ' : 'FALHOU'} ${nome} ${cond ? '' : det}`) }

async function abrir(browser, uid, email, quando) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Sao_Paulo', locale: 'pt-BR', serviceWorkers: 'block' })
  const sessao = {
    access_token: token({ sub: uid, role: 'authenticated', email }),
    refresh_token: 'local', token_type: 'bearer', expires_in: 3600, expires_at: 1924992000,
    user: { id: uid, email, aud: 'authenticated', role: 'authenticated' },
  }
  await ctx.addInitScript((s) => localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s)), sessao)
  // /rest/v1 -> PostgREST local (o banco aplica o RLS de verdade)
  await ctx.route('http://localhost:54321/rest/v1/**', async (route) => {
    const url = route.request().url().replace('http://localhost:54321/rest/v1', API)
    try {
      const resp = await route.fetch({ url })
      await route.fulfill({ response: resp })
    } catch { /* página já fechada no fim do teste */ }
  })
  await ctx.route('http://localhost:54321/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessao.user) }))
  const page = await ctx.newPage()
  await page.clock.setFixedTime(new Date(quando))
  return { ctx, page }
}

const browser = await chromium.launch()

// ---------------------------------------------------------------------
// 1) Administradora numa segunda-feira, 05/10/2026, 09:00
// ---------------------------------------------------------------------
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', '2026-10-05T09:00:00-03:00')
  await page.goto(`${APP}/admin/hoje`)
  await page.getByText('Presentes agora').waitFor()
  const cartoes = page.locator('main ul > li')
  confere('H01 Lista as 5 crianças ativas', (await cartoes.count()) === 5, `veio ${await cartoes.count()}`)
  confere('H02 Mostra alerta de alergia da Lara', await page.getByText('Alergia: Amendoim').isVisible())
  await page.screenshot({ path: `${PASTA}/hoje_1_inicio.png` })

  const lara = cartoes.filter({ hasText: 'Lara Mendes' })
  await lara.getByRole('button', { name: 'Registrar entrada' }).click()
  await lara.getByText('Chegou 09:00').waitFor()
  confere('H03 Entrada registrada no banco às 09:00',
    sql(`SELECT hora_entrada FROM presenca p JOIN crianca c ON c.id=p.crianca_id WHERE c.nome_completo='Lara Mendes' AND data='2026-10-05'`) === '09:00:00')

  // Registro de refeição
  await lara.getByRole('button', { name: '+ Registro' }).click()
  const folha = page.getByRole('dialog')
  await folha.getByRole('button', { name: 'Tudo', exact: true }).click()
  await folha.getByLabel('Descrição').fill('Lanche da manhã: banana e suco.')
  await page.screenshot({ path: `${PASTA}/hoje_2_registro.png` })
  await folha.getByRole('button', { name: 'Salvar registro' }).click()
  await page.getByText('Refeição registrada. A família já pode ver.').waitFor()
  confere('H04 Refeição gravada com aceitação TUDO, visível e autora = admin',
    sql(`SELECT tipo||'|'||aceitacao||'|'||visivel_pais||'|'||registrado_por FROM registro_rotina WHERE descricao LIKE 'Lanche da manhã%'`)
      === `REFEICAO|TUDO|true|${ADMIN}`)

  // Ocorrência -> notifica a família
  await lara.getByRole('button', { name: '+ Registro' }).click()
  await folha.getByRole('button', { name: 'Ocorrência' }).click()
  confere('H05 Ocorrência avisa que a família será notificada', await folha.getByText('A família recebe um aviso').isVisible())
  await folha.getByLabel('Descrição').fill('Tropeçou no quintal, sem machucado.')
  await folha.getByRole('button', { name: 'Salvar registro' }).click()
  await page.getByText('Ocorrência registrada').waitFor()
  confere('H06 Banco criou aviso para os 2 responsáveis da Lara',
    sql(`SELECT count(*) FROM notificacao WHERE tipo='OCORRENCIA'`) === '2')

  // Observação começa como interna
  await lara.getByRole('button', { name: '+ Registro' }).click()
  await folha.getByRole('button', { name: 'Observação' }).click()
  confere('H07 Observação começa marcada como NÃO visível', !(await folha.getByLabel('Visível para a família').isChecked()))
  await folha.getByRole('button', { name: 'Fechar' }).click()

  // Saída: outra pessoa mostra alerta; horário antes da entrada é recusado
  await lara.getByRole('button', { name: 'Registrar saída' }).click()
  await folha.getByLabel('Outra pessoa').check()
  confere('H08 "Outra pessoa" mostra alerta de não autorizada', await folha.getByText('não está autorizada').isVisible())
  await page.screenshot({ path: `${PASTA}/hoje_3_saida.png` })
  await folha.getByLabel(/Juliana Mendes/).check()
  await folha.getByLabel('Horário da saída').fill('08:00')
  await folha.getByRole('button', { name: 'Confirmar saída' }).click()
  confere('H09 Saída antes da entrada é recusada na tela', await folha.getByText('A saída precisa ser depois da entrada.').isVisible())
  await folha.getByLabel('Horário da saída').fill('17:30')
  await folha.getByRole('button', { name: 'Confirmar saída' }).click()
  await lara.getByText('Saiu 17:30').waitFor()
  confere('H10 Saída gravada com quem buscou (Juliana)',
    sql(`SELECT p.hora_saida||'|'||r.nome FROM presenca p JOIN responsavel r ON r.id=p.buscado_por_id WHERE p.data='2026-10-05'`) === '17:30:00|Juliana Mendes')

  // Filtro por turno
  await page.getByRole('button', { name: 'Manhã', exact: true }).click()
  confere('H11 Filtro Manhã mostra só Pedro e Davi', (await cartoes.count()) === 2)
  await page.getByRole('button', { name: 'Todos' }).click()
  await page.screenshot({ path: `${PASTA}/hoje_4_final.png`, fullPage: true })
  await ctx.close()
}

// ---------------------------------------------------------------------
// 2) Dias sem funcionamento
// ---------------------------------------------------------------------
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', '2026-10-12T09:00:00-03:00')
  await page.goto(`${APP}/admin/hoje`)
  await page.getByText('Presentes agora').waitFor()
  confere('H12 Feriado (12/10) mostra aviso e esconde os botões',
    (await page.getByText('Hoje é feriado (Nossa Senhora Aparecida)').isVisible()) &&
    (await page.getByRole('button', { name: 'Registrar entrada' }).count()) === 0)
  await ctx.close()
}
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', '2026-10-10T09:00:00-03:00')
  await page.goto(`${APP}/admin/hoje`)
  await page.getByText('Presentes agora').waitFor()
  confere('H13 Sábado mostra aviso de fim de semana', await page.getByText('fim de semana').isVisible())
  await ctx.close()
}

// ---------------------------------------------------------------------
// 3) Família tentando abrir a tela da administração
// ---------------------------------------------------------------------
{
  const { ctx, page } = await abrir(browser, JULIANA, 'juliana@exemplo.com', '2026-10-05T18:00:00-03:00')
  await page.goto(`${APP}/admin/hoje`)
  await page.waitForURL(`${APP}/familia`)
  confere('H14 Responsável é redirecionada para a área da família', page.url().endsWith('/familia'))
  await page.getByText('Lara Mendes').waitFor()
  const texto = await page.locator('main').innerText()
  confere('H15 Família vê só os próprios filhos (Lara e Pedro)',
    texto.includes('Lara Mendes') && texto.includes('Pedro Mendes') && !texto.includes('Davi') && !texto.includes('Helena'))
  await page.screenshot({ path: `${PASTA}/familia_inicio.png`, fullPage: true })
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((r) => !r.ok).length
console.log(`\n${resultados.length - falhas} de ${resultados.length} verificações aprovadas`)
process.exit(falhas ? 1 : 0)
