// Teste de ponta a ponta do cadastro de crianças e responsáveis (banco local real).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { ADMIN, APP, abrir, criarRelatorio, sql } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T10:00:00-03:00'

{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)

  // Lista
  await page.goto(`${APP}/admin/criancas`)
  await page.getByText('Lara Mendes').waitFor()
  const itens = page.locator('main ul > li')
  confere('C01 Lista mostra as 5 crianças ativas', (await itens.count()) === 5 && (await page.getByText('5 ativas').isVisible()))
  await page.screenshot({ path: `${PASTA}/criancas_1_lista.png` })
  await page.getByPlaceholder('Buscar por nome').fill('lara')
  confere('C02 Busca por nome filtra a lista', (await itens.count()) === 1)
  await page.getByPlaceholder('Buscar por nome').fill('')

  // Nova criança: validação
  await page.getByRole('link', { name: '+ Nova criança' }).click()
  await page.getByRole('heading', { name: 'Nova criança' }).waitFor()
  await page.getByRole('button', { name: 'Cadastrar criança' }).click()
  confere('C03 Formulário vazio mostra os erros e não grava nada',
    (await page.getByText('Escreva o nome completo.').isVisible()) &&
    (await page.getByText('Informe a data de nascimento.').isVisible()) &&
    (await page.getByText('Escolha o plano.').isVisible()) &&
    sql(`SELECT count(*) FROM crianca`) === '5')

  // Nova criança: cadastro
  await page.getByLabel('Nome completo').fill('Sofia Teste')
  await page.getByLabel('Data de nascimento').fill('2023-02-10')
  await page.getByLabel('Plano').selectOption({ label: 'Meio período tarde · R$\u00a0470,00' })
  await page.getByLabel('Alergias').fill('Ovo')
  await page.screenshot({ path: `${PASTA}/criancas_2_nova.png`, fullPage: true })
  await page.getByRole('button', { name: 'Cadastrar criança' }).click()
  await page.getByText('Criança cadastrada.').waitFor()
  confere('C04 Criança gravada com plano e alergia',
    sql(`SELECT p.nome||'|'||c.alergias||'|'||c.status FROM crianca c JOIN plano p ON p.id=c.plano_id WHERE nome_completo='Sofia Teste'`)
      === 'Meio período tarde|Ovo|ATIVA')
  await page.getByText('Nenhum responsável vinculado').waitFor({ timeout: 5000 }).catch(() => {})
  confere('C05 Ficha avisa que falta responsável', await page.getByText('Nenhum responsável vinculado').isVisible())
  const fichaUrl = page.url()

  // Novo responsável
  const folha = page.getByRole('dialog')
  await page.getByRole('button', { name: '+ Adicionar' }).click()
  await folha.getByLabel('Nome completo').fill('Ana Teste')
  await folha.getByLabel('Telefone').fill('abc')
  await folha.getByLabel('Parentesco').fill('Mãe')
  await folha.getByRole('button', { name: 'Vincular responsável' }).click()
  confere('C06 Telefone inválido é recusado', await folha.getByText('Telefone inválido').isVisible())
  await folha.getByLabel('Telefone').fill('(11) 95555-0000')
  await folha.getByLabel('E-mail (para acessar o app)').fill('Ana.Teste@Exemplo.com')
  await folha.getByLabel('Responsável pelo pagamento').check()
  await folha.getByRole('button', { name: 'Vincular responsável' }).click()
  await page.getByText('Ana Teste vinculado(a) à criança.').waitFor()
  confere('C07 Responsável novo gravado e vinculado como financeiro',
    sql(`SELECT r.email||'|'||cr.parentesco||'|'||cr.eh_financeiro FROM crianca_responsavel cr JOIN responsavel r ON r.id=cr.responsavel_id JOIN crianca c ON c.id=cr.crianca_id WHERE c.nome_completo='Sofia Teste'`)
      === 'ana.teste@exemplo.com|Mãe|true')
  await page.getByText('Ainda sem acesso ao app').waitFor({ timeout: 5000 }).catch(() => {})
  confere('C08 Ficha mostra que ainda não tem acesso ao app', await page.getByText('Ainda sem acesso ao app').isVisible())

  // Login criado no Supabase -> vínculo automático
  sql(`INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000c1', 'ana.teste@exemplo.com')`)
  await page.reload()
  await page.getByText('Tem acesso ao app.').waitFor({ timeout: 5000 }).catch(() => {})
  confere('C09 Depois de criar o login, a ficha mostra "Tem acesso ao app"', await page.getByText('Tem acesso ao app.').isVisible())

  // Responsável já cadastrado
  await page.getByRole('button', { name: '+ Adicionar' }).click()
  await folha.getByRole('button', { name: 'Já cadastrado' }).click()
  await folha.locator('select').selectOption({ label: 'Juliana Mendes · (11) 90000-0001' })
  await folha.getByLabel('Parentesco').fill('Tia')
  await folha.getByRole('button', { name: 'Vincular responsável' }).click()
  await page.getByText('Juliana Mendes vinculado(a) à criança.').waitFor()
  confere('C10 Responsável já cadastrado vinculado sem duplicar o cadastro',
    sql(`SELECT count(*) FROM responsavel WHERE nome='Juliana Mendes'`) === '1' &&
    sql(`SELECT count(*) FROM crianca_responsavel cr JOIN crianca c ON c.id=cr.crianca_id WHERE c.nome_completo='Sofia Teste'`) === '2')
  await page.screenshot({ path: `${PASTA}/criancas_3_ficha.png`, fullPage: true })

  // Remover vínculo (com confirmação)
  const cartaoJuliana = page.locator('section div.bg-white').filter({ hasText: 'Juliana Mendes' })
  await cartaoJuliana.getByRole('button', { name: 'Remover vínculo' }).click()
  await cartaoJuliana.getByRole('button', { name: 'Confirmar remoção' }).click()
  await page.getByText('Vínculo removido.').waitFor()
  confere('C11 Remoção pede confirmação e apaga só o vínculo',
    sql(`SELECT count(*) FROM crianca_responsavel cr JOIN crianca c ON c.id=cr.crianca_id WHERE c.nome_completo='Sofia Teste'`) === '1' &&
    sql(`SELECT count(*) FROM responsavel WHERE nome='Juliana Mendes'`) === '1')

  // Edição: inativar
  await page.goto(fichaUrl)
  await page.getByLabel('Situação').selectOption('INATIVA')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await page.getByText('Alterações salvas.').waitFor()
  confere('C12 Edição grava a nova situação', sql(`SELECT status FROM crianca WHERE nome_completo='Sofia Teste'`) === 'INATIVA')
  await page.goto(`${APP}/admin/criancas`)
  await page.getByText('Lara Mendes').waitFor()
  const escondida = !(await page.getByText('Sofia Teste').isVisible())
  await page.getByLabel('Mostrar inativas').check()
  confere('C13 Inativa some da lista e volta com "Mostrar inativas"', escondida && await page.getByText('Sofia Teste').isVisible())
  await ctx.close()
}

// A mãe recém-cadastrada entra e vê só a filha dela
{
  sql(`UPDATE crianca SET status='ATIVA' WHERE nome_completo='Sofia Teste'`)
  const { ctx, page } = await abrir(browser, '00000000-0000-0000-0000-0000000000c1', 'ana.teste@exemplo.com', QUANDO)
  await page.goto(`${APP}/familia`)
  await page.getByText('Sofia Teste').waitFor()
  const texto = await page.locator('main').innerText()
  confere('C14 Nova mãe vê só a filha dela', texto.includes('Sofia Teste') && !texto.includes('Lara') && !texto.includes('Davi'))
  await ctx.close()
}

await browser.close()
process.exit(fim() ? 1 : 0)
