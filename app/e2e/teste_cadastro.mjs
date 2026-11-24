// Teste de ponta a ponta: escolha de perfil no início, autocadastro da família e aprovação pela administração.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import { ADMIN, APP, abrir, criarRelatorio, sql } from './apoio.mjs'

const PASTA = process.env.SAIDA ?? '.'
const { confere, fim } = criarRelatorio()
const browser = await chromium.launch()
const QUANDO = '2026-10-13T10:00:00-03:00'

const deslogado = () => abrir(browser, null, null, QUANDO)
const preencherCrianca = async (page, i, { nome, nascimento, turno, alergias }) => {
  await page.getByLabel('Nome completo da criança').nth(i).fill(nome)
  if (nascimento) await page.getByLabel('Data de nascimento').nth(i).fill(nascimento)
  if (turno) await page.getByLabel('Período desejado').nth(i).selectOption({ label: turno })
  if (alergias) await page.getByLabel('Alergias (se tiver)').nth(i).fill(alergias)
}
const entrarComo = async (page, perfil, email) => {
  await page.goto(APP)
  await page.getByRole('button', { name: perfil }).click()
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill('qualquer1')
  await page.getByRole('button', { name: 'Entrar', exact: true }).last().click()
}

// 1) Escolha de perfil
{
  const { ctx, page } = await deslogado()
  await page.goto(APP)
  await page.getByText('Como você quer entrar?').waitFor()
  confere('A01 A tela inicial pede para escolher o perfil',
    (await page.getByRole('button', { name: /Sou pai, mãe ou responsável/ }).isVisible()) &&
    (await page.getByRole('button', { name: /Sou da administração/ }).isVisible()))
  await page.screenshot({ path: `${PASTA}/cadastro_1_escolha.png` })

  await entrarComo(page, /Sou pai, mãe ou responsável/, 'admin@exemplo.com')
  await page.getByText('Este e-mail é da administração').waitFor()
  confere('A02 Administradora pela porta da família é avisada e não entra', page.url() === `${APP}/`)

  await page.getByRole('button', { name: '‹ Trocar perfil' }).click()
  await page.getByRole('button', { name: /Sou da administração/ }).click()
  await page.getByLabel('E-mail').fill('admin@exemplo.com')
  await page.getByLabel('Senha').fill('qualquer1')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL(`${APP}/admin`)
  confere('A03 Pela porta certa, a administradora entra', page.url().endsWith('/admin'))
  await ctx.close()
}
{
  const { ctx, page } = await deslogado()
  await entrarComo(page, /Sou da administração/, 'juliana@exemplo.com')
  await page.getByText('Este e-mail é de um responsável').waitFor()
  confere('A04 Responsável pela porta da administração é avisada e não entra', page.url() === `${APP}/`)
  await ctx.close()
}

// 2) Autocadastro
{
  const { ctx, page } = await deslogado()
  await page.goto(APP)
  await page.getByRole('button', { name: /Sou pai, mãe ou responsável/ }).click()
  await page.getByRole('tab', { name: 'Criar cadastro' }).click()
  await page.getByRole('button', { name: 'Enviar cadastro' }).click()
  confere('A05 Cadastro vazio mostra os erros (inclusive os da criança)', (await page.getByText('Escreva nome e sobrenome.').isVisible()) &&
    (await page.getByText('É preciso aceitar o termo').isVisible()) &&
    (await page.getByText('Informe a data de nascimento.').isVisible()) && (await page.getByText('Escolha o período.').isVisible()))

  await page.getByLabel('Seu nome completo').fill('Carla Nova Souza')
  await page.getByLabel('Celular com DDD').fill('10912345678')
  confere('A06 Telefone recebe a máscara enquanto digita', (await page.getByLabel('Celular com DDD').inputValue()) === '(10) 91234-5678')
  await page.getByLabel('E-mail').fill('carla.nova@exemplo.com')
  await page.getByLabel('Crie uma senha').fill('segredo123')
  await page.getByLabel('Repita a senha').fill('segredo123')
  await preencherCrianca(page, 0, { nome: 'Davi Souza', nascimento: '2021-11-02', turno: 'Meio período manhã (até o almoço)' })
  await page.getByRole('button', { name: '+ Adicionar outra criança (irmão ou irmã)' }).click()
  await preencherCrianca(page, 1, { nome: 'Lia Nova Souza', nascimento: '2024-02-10', turno: 'Meio período tarde (até 18h)', alergias: 'Leite de vaca' })
  await page.getByLabel('Seu parentesco com a criança').fill('Tia')
  await page.getByLabel('Li e aceito o termo de privacidade').check()
  await page.getByRole('button', { name: 'Enviar cadastro' }).click()
  confere('A07 DDD inexistente é recusado', await page.getByText('O DDD 10 não existe.').isVisible())
  await page.getByLabel('Celular com DDD').fill('11912345678')
  await page.screenshot({ path: `${PASTA}/cadastro_2_formulario.png`, fullPage: true })
  await page.getByRole('button', { name: 'Enviar cadastro' }).click()
  await page.getByText('Quase lá!').waitFor()
  confere('A08 Cadastro enviado vira solicitação pendente e conta inativa',
    sql(`SELECT s.status||'|'||s.telefone||'|'||u.ativo FROM solicitacao_cadastro s JOIN usuario u ON u.id=s.usuario_id WHERE s.email='carla.nova@exemplo.com'`)
      === 'PENDENTE|(11) 91234-5678|false')
  confere('A08b Dados das duas crianças guardados no pedido, nenhuma criada ainda',
    sql(`SELECT jsonb_array_length(criancas_dados)||'|'||(criancas_dados->1->>'turno')||'|'||(criancas_dados->1->>'alergias') FROM solicitacao_cadastro WHERE email='carla.nova@exemplo.com'`) === '2|TARDE|Leite de vaca' &&
    sql(`SELECT count(*) FROM crianca WHERE nome_completo='Lia Nova Souza'`) === '0')
  await ctx.close()
}

// 3) Conta pendente tenta entrar
{
  const { ctx, page } = await deslogado()
  await entrarComo(page, /Sou pai, mãe ou responsável/, 'carla.nova@exemplo.com')
  await page.getByText('Cadastro em análise').waitFor()
  confere('A09 Conta pendente vê "Cadastro em análise" e nenhum dado', !(await page.getByText('Davi').isVisible()))
  await page.screenshot({ path: `${PASTA}/cadastro_3_analise.png` })
  await ctx.close()
}

// 4) Administração aprova
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
  await page.goto(`${APP}/admin`)
  await page.getByText('1 cadastro de família esperando aprovação').waitFor()
  confere('A10 Início avisa que há cadastro para aprovar', true)
  await page.getByText('1 cadastro de família esperando aprovação').click()
  await page.getByText('Carla Nova Souza').waitFor()
  await page.getByRole('button', { name: 'Aprovar', exact: true }).click()
  const folha = page.getByRole('dialog')
  const idDavi = sql(`SELECT id FROM crianca WHERE nome_completo='Davi Souza'`)
  const idTarde = sql(`SELECT id FROM plano WHERE turno='TARDE'`)
  const acoes = folha.getByLabel('O que fazer com esta criança')
  await acoes.nth(1).waitFor()
  let ok = false
  for (let i = 0; i < 30 && !ok; i++) {
    ok = (await acoes.nth(0).inputValue()) === 'EXISTENTE' && (await folha.getByLabel('Criança cadastrada').inputValue()) === idDavi
      && (await acoes.nth(1).inputValue()) === 'NOVA' && (await folha.getByLabel('Plano').inputValue()) === idTarde
    if (!ok) await page.waitForTimeout(100)
  }
  confere('A11 Davi (já matriculado) vem para vincular; Lia vem como nova, com o plano do período escolhido', ok)
  await folha.getByLabel('Situação').selectOption('EM_ADAPTACAO')
  await page.screenshot({ path: `${PASTA}/cadastro_4_aprovar.png`, fullPage: true })
  await folha.getByRole('button', { name: 'Aprovar cadastro' }).click()
  await page.getByText('Cadastro de Carla Nova Souza aprovado e 1 criança cadastrada.').waitFor()
  confere('A12 Aprovado: conta ativa, vinculada ao Davi e à Lia como Tia',
    sql(`SELECT u.ativo||'|'||string_agg(c.nome_completo||':'||cr.parentesco, ',' ORDER BY c.nome_completo) FROM usuario u JOIN responsavel r ON r.usuario_id=u.id JOIN crianca_responsavel cr ON cr.responsavel_id=r.id JOIN crianca c ON c.id=cr.crianca_id WHERE u.email='carla.nova@exemplo.com' GROUP BY u.ativo`) === 'true|Davi Souza:Tia,Lia Nova Souza:Tia')
  confere('A12b Lia criada com plano da tarde, em adaptação e a alergia informada',
    sql(`SELECT c.status||'|'||p.turno||'|'||c.alergias FROM crianca c JOIN plano p ON p.id=c.plano_id WHERE c.nome_completo='Lia Nova Souza'`) === 'EM_ADAPTACAO|TARDE|Leite de vaca')
  await ctx.close()
}

// 5) Agora a família entra e vê a criança
{
  const { ctx, page } = await deslogado()
  await entrarComo(page, /Sou pai, mãe ou responsável/, 'carla.nova@exemplo.com')
  await page.waitForURL(`${APP}/familia`)
  await page.getByText('Davi Souza').waitFor()
  const texto = await page.locator('main').innerText()
  confere('A13 Depois de aprovada, entra e vê o Davi e a Lia, e mais ninguém', texto.includes('Lia Nova Souza') && !texto.includes('Lara') && !texto.includes('Helena'))
  await ctx.close()
}

// 6) Cadastro recusado
{
  const { ctx, page } = await deslogado()
  await page.goto(APP)
  await page.getByRole('button', { name: /Sou pai, mãe ou responsável/ }).click()
  await page.getByRole('tab', { name: 'Criar cadastro' }).click()
  await page.getByLabel('Seu nome completo').fill('Pessoa Desconhecida')
  await page.getByLabel('Celular com DDD').fill('21934567890')
  await page.getByLabel('E-mail').fill('desconhecida@exemplo.com')
  await page.getByLabel('Crie uma senha').fill('segredo123')
  await page.getByLabel('Repita a senha').fill('segredo123')
  await preencherCrianca(page, 0, { nome: 'Joãozinho Silva', nascimento: '2022-01-01', turno: 'Integral (das 6h às 18h)' })
  await page.getByLabel('Seu parentesco com a criança').fill('Mãe')
  await page.getByLabel('Li e aceito o termo de privacidade').check()
  await page.getByRole('button', { name: 'Enviar cadastro' }).click()
  await page.getByText('Quase lá!').waitFor()
  await ctx.close()
}
{
  const { ctx, page } = await abrir(browser, ADMIN, 'admin@exemplo.com', QUANDO)
  await page.goto(`${APP}/admin/solicitacoes`)
  await page.getByText('Pessoa Desconhecida').waitFor()
  await page.getByRole('button', { name: 'Recusar', exact: true }).click()
  const folha = page.getByRole('dialog')
  await folha.getByLabel(/Motivo/).fill('Não há criança matriculada com esse nome.')
  await folha.getByRole('button', { name: 'Recusar cadastro' }).click()
  await page.getByText('Cadastro de Pessoa Desconhecida recusado.').waitFor()
  confere('A14b Recusado: a criança informada não é criada', sql(`SELECT count(*) FROM crianca WHERE nome_completo='Joãozinho Silva'`) === '0')
  await ctx.close()
}
{
  const { ctx, page } = await deslogado()
  await entrarComo(page, /Sou pai, mãe ou responsável/, 'desconhecida@exemplo.com')
  await page.getByText('Cadastro não aprovado').waitFor()
  confere('A14 Recusado vê o motivo e continua sem acesso', await page.getByText('Não há criança matriculada com esse nome.').isVisible())
  await ctx.close()
}

await browser.close()
process.exit(fim() ? 1 : 0)
