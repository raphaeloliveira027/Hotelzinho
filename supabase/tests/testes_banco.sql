-- =====================================================================
-- Testes automatizados do banco (rodar num banco recém-montado).
-- Cada teste grava OK/FALHOU em teste.resultado; o relatório sai no fim.
-- Simula o login trocando o papel (role) e o "sub" do token, como o Supabase faz.
-- =====================================================================
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

DROP SCHEMA IF EXISTS teste CASCADE;
CREATE SCHEMA teste;
CREATE TABLE teste.resultado (n SERIAL, nome TEXT, ok BOOLEAN, detalhe TEXT);
GRANT USAGE ON SCHEMA teste TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA teste TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA teste TO anon, authenticated, service_role;

-- Registra o resultado de uma condição
CREATE FUNCTION teste.ok(p_nome TEXT, p_cond BOOLEAN, p_det TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE sql AS $$ INSERT INTO teste.resultado (nome, ok, detalhe) VALUES (p_nome, COALESCE(p_cond, FALSE), p_det) $$;

-- Espera que o comando FALHE (erro = teste aprovado)
CREATE FUNCTION teste.deve_falhar(p_nome TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  INSERT INTO teste.resultado (nome, ok, detalhe) VALUES (p_nome, FALSE, 'executou sem erro');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO teste.resultado (nome, ok, detalhe) VALUES (p_nome, TRUE, SQLERRM);
END $$;

-- Executa e devolve quantas linhas foram afetadas
CREATE FUNCTION teste.linhas(p_sql TEXT) RETURNS INTEGER
LANGUAGE plpgsql AS $$ DECLARE n INTEGER; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA teste TO anon, authenticated, service_role;

-- "Faz login" como um usuário (uuid) com o papel authenticated
CREATE FUNCTION teste.entrar(p_uid TEXT) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', p_uid, false)
$$;

\set ADMIN   '00000000-0000-0000-0000-00000000000a'
\set JULIANA '00000000-0000-0000-0000-000000000001'
\set PATRICIA '00000000-0000-0000-0000-000000000003'

-- =====================================================================
-- 1) ADMINISTRADORA
-- =====================================================================
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;

SELECT teste.ok('A01 Admin vê todas as 5 crianças', (SELECT count(*) FROM crianca) = 5);
SELECT teste.ok('A02 Setembro do Benício aparece como ATRASADO',
  (SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id = v.crianca_id
   WHERE c.nome_completo = 'Benício Rocha' AND v.competencia = '2026-09-01') = 'ATRASADO');
SELECT teste.ok('A03 Setembro da Lara aparece como PAGO',
  (SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id = v.crianca_id
   WHERE c.nome_completo = 'Lara Mendes' AND v.competencia = '2026-09-01') = 'PAGO');
SELECT teste.ok('A04 Gerar mensalidades de outubro cria 5', gerar_mensalidades('2026-10-15') = 5);
SELECT teste.ok('A05 Gerar de novo não duplica', gerar_mensalidades('2026-10-01') = 0);
SELECT teste.ok('A06 Integral copia R$ 650,00 e vence em 31/10',
  (SELECT m.valor_final = 650.00 AND m.data_vencimento = '2026-10-31'
   FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
   WHERE c.nome_completo = 'Lara Mendes' AND m.competencia = '2026-10-01'));
SELECT teste.ok('A07 Meio período copia R$ 470,00',
  (SELECT m.valor_final = 470.00 FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
   WHERE c.nome_completo = 'Davi Souza' AND m.competencia = '2026-10-01'));
SELECT teste.ok('A08 Geração ficou registrada no log',
  EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'GERAR_MENSALIDADES'));

SELECT teste.deve_falhar('A09 Presença em sábado é bloqueada',
  $$INSERT INTO presenca (crianca_id, data, hora_entrada) SELECT id, '2026-10-03', '07:00' FROM crianca LIMIT 1$$);
SELECT teste.deve_falhar('A10 Presença em feriado (12/10) é bloqueada',
  $$INSERT INTO presenca (crianca_id, data, hora_entrada) SELECT id, '2026-10-12', '07:00' FROM crianca LIMIT 1$$);
SELECT teste.deve_falhar('A11 Saída antes da entrada é bloqueada',
  $$INSERT INTO presenca (crianca_id, data, hora_entrada, hora_saida) SELECT id, '2026-10-05', '08:00', '07:00' FROM crianca LIMIT 1$$);
SELECT teste.deve_falhar('A12 Mensalidade com vencimento fora do fim do mês é bloqueada',
  $$INSERT INTO mensalidade (crianca_id, competencia, valor_base, data_vencimento) SELECT id, '2026-12-01', 470, '2026-12-10' FROM crianca LIMIT 1$$);
SELECT teste.deve_falhar('A13 Desconto maior que o valor é bloqueado',
  $$INSERT INTO mensalidade (crianca_id, competencia, valor_base, desconto, data_vencimento) SELECT id, '2026-12-01', 470, 500, '2026-12-31' FROM crianca LIMIT 1$$);
SELECT teste.deve_falhar('A14 Criança ativa sem plano é bloqueada',
  $$INSERT INTO crianca (nome_completo, data_nascimento) VALUES ('Teste Sem Plano', '2022-01-01')$$);
SELECT teste.deve_falhar('A15 Data de nascimento no futuro é bloqueada',
  $$INSERT INTO crianca (nome_completo, data_nascimento, plano_id) VALUES ('Teste Futuro', '2030-01-01', 1)$$);

-- Ocorrência visível → notifica os 2 responsáveis com login da Lara
INSERT INTO registro_rotina (crianca_id, tipo, descricao, registrado_por)
SELECT id, 'OCORRENCIA', 'Bateu o joelho no parquinho; colocamos gelo.', auth.uid()
FROM crianca WHERE nome_completo = 'Lara Mendes';
RESET ROLE;  -- conferência feita pelo dono do banco: a admin só lê as próprias notificações
SELECT teste.ok('A16 Ocorrência gera aviso para os 2 responsáveis da Lara',
  (SELECT count(*) FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
   WHERE n.tipo = 'OCORRENCIA' AND u.email IN ('juliana@exemplo.com', 'rafael@exemplo.com')) = 2);
SET ROLE authenticated;

UPDATE crianca SET alergias = 'Amendoim e castanhas' WHERE nome_completo = 'Lara Mendes';
SELECT teste.ok('A17 Alteração de alergia fica no log',
  EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'ALTERAR_SAUDE'));

RESET ROLE;

-- =====================================================================
-- 2) RESPONSÁVEL: Juliana (mãe da Lara e do Pedro)
-- =====================================================================
SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;

SELECT teste.ok('R01 Juliana vê só os 2 filhos',
  (SELECT array_agg(nome_completo ORDER BY nome_completo) FROM crianca) = ARRAY['Lara Mendes','Pedro Mendes']::varchar[]);
SELECT teste.ok('R02 Juliana NÃO vê o Davi (outra família)',
  (SELECT count(*) FROM crianca WHERE nome_completo = 'Davi Souza') = 0);
SELECT teste.ok('R03 Juliana vê só o próprio cadastro de responsável',
  (SELECT count(*) FROM responsavel) = 1);
SELECT teste.ok('R04 Rotina: vê 5 registros visíveis e não vê a anotação interna',
  (SELECT count(*) FROM registro_rotina) = 5 AND
  (SELECT count(*) FROM registro_rotina WHERE tipo = 'OBSERVACAO') = 0);
SELECT teste.ok('R05 Mensalidades: só das próprias crianças (2 meses × 2 filhos)',
  (SELECT count(*) FROM vw_mensalidade_status) = 4);
SELECT teste.ok('R06 Vê o comunicado geral', (SELECT count(*) FROM comunicado) = 1);
SELECT teste.ok('R07 Vê só as próprias notificações',
  (SELECT bool_and(usuario_id = auth.uid()) FROM notificacao));
SELECT teste.ok('R08 Tentativa de alterar a alergia não muda nada',
  teste.linhas($$UPDATE crianca SET alergias = 'nenhuma' WHERE nome_completo = 'Lara Mendes'$$) = 0);
SELECT teste.ok('R09 Tentativa de apagar a ficha do Davi não apaga nada',
  teste.linhas($$DELETE FROM crianca WHERE nome_completo = 'Davi Souza'$$) = 0);

SELECT teste.ok('R10 Comprovante para mensalidade de outra família não é gravado',
  teste.linhas($$INSERT INTO comprovante (mensalidade_id, responsavel_id, arquivo_path)
    SELECT m.id, meu_responsavel_id(), 'x.jpg' FROM mensalidade m
    WHERE m.crianca_id = (SELECT id FROM crianca WHERE nome_completo = 'Davi Souza' LIMIT 1)$$) = 0);
SELECT teste.deve_falhar('R10b Não envia comprovante usando o id de mensalidade do Davi (id direto)',
  format($$INSERT INTO comprovante (mensalidade_id, responsavel_id, arquivo_path) VALUES (%s, meu_responsavel_id(), 'x.jpg')$$,
         (SELECT m.id FROM mensalidade m WHERE m.competencia = '2026-10-01'
            AND m.crianca_id NOT IN (SELECT minhas_criancas()) LIMIT 1)));
SELECT teste.deve_falhar('R11 Não envia comprovante já marcado como ACEITO',
  $$INSERT INTO comprovante (mensalidade_id, responsavel_id, arquivo_path, status)
    SELECT id, meu_responsavel_id(), 'x.jpg', 'ACEITO' FROM mensalidade
    WHERE competencia = '2026-10-01' LIMIT 1$$);

INSERT INTO comprovante (mensalidade_id, responsavel_id, arquivo_path)
SELECT m.id, meu_responsavel_id(), 'comprovantes/lara-out.jpg'
FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
WHERE c.nome_completo = 'Lara Mendes' AND m.competencia = '2026-10-01';
SELECT teste.ok('R12 Envia comprovante da Lara e a mensalidade vai para EM_ANALISE',
  (SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id = v.crianca_id
   WHERE c.nome_completo = 'Lara Mendes' AND v.competencia = '2026-10-01') = 'EM_ANALISE');

SELECT teste.deve_falhar('R13 Responsável não consegue confirmar o próprio pagamento',
  $$SELECT confirmar_comprovante((SELECT max(id) FROM comprovante))$$);
SELECT teste.deve_falhar('R14 Responsável não consegue inserir pagamento direto',
  $$INSERT INTO pagamento (mensalidade_id, valor_pago, data_pagamento, forma, confirmado_por)
    SELECT id, 650, CURRENT_DATE, 'PIX', auth.uid() FROM mensalidade LIMIT 1$$);
SELECT teste.deve_falhar('R15 Responsável não gera mensalidades',
  $$SELECT gerar_mensalidades('2026-11-01')$$);
SELECT teste.deve_falhar('R16 Responsável não lê o log de auditoria (nem tenta gravar)',
  $$INSERT INTO log_auditoria (acao, entidade) VALUES ('X', 'Y')$$);

SELECT atualizar_meu_contato('(11) 98888-7777', NULL, 'juliana@exemplo.com', 'Rua Fictícia, 100');
SELECT teste.ok('R17 Atualiza o próprio telefone pela função permitida',
  (SELECT telefone FROM responsavel) = '(11) 98888-7777');
SELECT teste.ok('R18 Não altera o próprio cadastro direto na tabela (ex.: nome)',
  teste.linhas($$UPDATE responsavel SET nome = 'Outro Nome'$$) = 0);

INSERT INTO mensagem (crianca_id, remetente_id, conteudo)
SELECT id, auth.uid(), 'Amanhã a Lara sai mais cedo, às 15h.' FROM crianca WHERE nome_completo = 'Lara Mendes';
SELECT teste.ok('R19 Envia mensagem sobre o próprio filho', (SELECT count(*) FROM mensagem) = 1);
SELECT teste.deve_falhar('R20 Não envia mensagem sobre criança de outra família',
  format($$INSERT INTO mensagem (crianca_id, remetente_id, conteudo) VALUES (%s, auth.uid(), 'oi')$$,
         (SELECT min(crianca_id) FROM mensalidade WHERE crianca_id NOT IN (SELECT minhas_criancas()))));

SELECT aceitar_termo();
SELECT teste.ok('R21 Aceite do termo LGPD registrado com versão',
  (SELECT consentimento_em IS NOT NULL AND versao_termo = '1.0' FROM responsavel));
RESET ROLE;

-- =====================================================================
-- 3) OUTRA FAMÍLIA: Patrícia (mãe do Davi)
-- =====================================================================
SELECT teste.entrar(:'PATRICIA');
SET ROLE authenticated;
SELECT teste.ok('P01 Patrícia vê só o Davi',
  (SELECT array_agg(nome_completo) FROM crianca) = ARRAY['Davi Souza']::varchar[]);
SELECT teste.ok('P02 Patrícia não vê o comprovante nem a mensagem da Juliana',
  (SELECT count(*) FROM comprovante) = 0 AND (SELECT count(*) FROM mensagem) = 0);
SELECT teste.ok('P03 Patrícia não vê a ocorrência da Lara nas notificações',
  (SELECT count(*) FROM notificacao WHERE tipo = 'OCORRENCIA') = 0);
RESET ROLE;

-- =====================================================================
-- 4) VISITANTE SEM LOGIN
-- =====================================================================
SELECT teste.entrar('');
SET ROLE anon;
SELECT teste.deve_falhar('V01 Visitante sem login não lê crianças', $$SELECT * FROM crianca$$);
SELECT teste.deve_falhar('V02 Visitante sem login não lê mensalidades', $$SELECT * FROM mensalidade$$);
RESET ROLE;

-- =====================================================================
-- 5) ADMIN analisa o comprovante da Juliana
-- =====================================================================
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT teste.ok('A18 Admin recebeu aviso de comprovante novo',
  EXISTS (SELECT 1 FROM notificacao WHERE usuario_id = auth.uid() AND tipo = 'COMPROVANTE'));
SELECT teste.deve_falhar('A19 Recusa sem motivo é bloqueada',
  $$SELECT recusar_comprovante((SELECT max(id) FROM comprovante), '')$$);
SELECT confirmar_comprovante((SELECT max(id) FROM comprovante), '2026-10-05');
SELECT teste.ok('A20 Após confirmar, outubro da Lara fica PAGO',
  (SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id = v.crianca_id
   WHERE c.nome_completo = 'Lara Mendes' AND v.competencia = '2026-10-01') = 'PAGO');
SELECT teste.ok('A21 Pagamento criado com o valor certo (R$ 650,00)',
  (SELECT valor_pago FROM pagamento WHERE comprovante_id = (SELECT max(id) FROM comprovante)) = 650.00);
SELECT teste.deve_falhar('A22 O mesmo comprovante não é confirmado duas vezes',
  $$SELECT confirmar_comprovante((SELECT max(id) FROM comprovante))$$);
SELECT teste.ok('A23 Confirmação ficou no log',
  EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'CONFIRMAR_PAGAMENTO'));
RESET ROLE;

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT teste.ok('R22 Juliana recebeu o aviso de pagamento confirmado',
  EXISTS (SELECT 1 FROM notificacao WHERE texto LIKE 'Pagamento confirmado%'));
RESET ROLE;

-- =====================================================================
-- 6) Cadastro novo nunca nasce como administrador
-- =====================================================================
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000ff', 'novo@exemplo.com');
SELECT teste.ok('S01 Novo usuário do Auth entra como RESPONSAVEL',
  (SELECT perfil FROM usuario WHERE email = 'novo@exemplo.com') = 'RESPONSAVEL');
SELECT teste.entrar('00000000-0000-0000-0000-0000000000ff');
SET ROLE authenticated;
SELECT teste.ok('S02 Usuário sem vínculo não vê nenhuma criança', (SELECT count(*) FROM crianca) = 0);
SELECT teste.ok('S03 Usuário não consegue se promover a ADMIN',
  teste.linhas($$UPDATE usuario SET perfil = 'ADMIN' WHERE id = auth.uid()$$) = 0);
RESET ROLE;

-- =====================================================================
-- 7) Vínculo automático entre cadastro do responsável e login (0004)
-- =====================================================================
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
INSERT INTO responsavel (nome, telefone, email) VALUES ('Novo Pai', '(11) 90000-0099', 'NovoPai@Exemplo.com');
INSERT INTO responsavel (nome, telefone, email) VALUES ('Tentativa Admin', '(11) 90000-0098', 'admin@exemplo.com');
RESET ROLE;
SELECT teste.ok('L01 Responsável sem login fica sem vínculo',
  (SELECT usuario_id IS NULL FROM responsavel WHERE nome = 'Novo Pai'));
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b1', 'novopai@exemplo.com');
SELECT teste.ok('L02 Login criado depois é ligado ao responsável (e-mail sem diferenciar maiúsculas)',
  (SELECT usuario_id = '00000000-0000-0000-0000-0000000000b1' FROM responsavel WHERE nome = 'Novo Pai'));
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b2', 'mae.antes@exemplo.com');
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
INSERT INTO responsavel (nome, telefone, email) VALUES ('Mãe Antes', '(11) 90000-0097', 'mae.antes@exemplo.com');
RESET ROLE;
SELECT teste.ok('L03 Login criado antes é ligado quando o responsável é cadastrado',
  (SELECT usuario_id = '00000000-0000-0000-0000-0000000000b2' FROM responsavel WHERE nome = 'Mãe Antes'));
SELECT teste.ok('L04 Login de ADMIN nunca é ligado a um responsável',
  (SELECT usuario_id IS NULL FROM responsavel WHERE nome = 'Tentativa Admin'));

-- =====================================================================
-- 8) Financeiro: arquivos de comprovante e pagamento manual (0005)
-- =====================================================================
SELECT teste.entrar('00000000-0000-0000-0000-000000000001');  -- Juliana
SET ROLE authenticated;
SELECT teste.ok('F01 Responsável envia arquivo para a própria pasta',
  teste.linhas(format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('comprovantes', '%s/1-teste.jpg')$$, meu_responsavel_id())) = 1);
SELECT teste.deve_falhar('F02 Responsável não envia arquivo para a pasta de outra família',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('comprovantes', '999/1-teste.jpg')$$);
RESET ROLE;
SELECT teste.entrar('00000000-0000-0000-0000-000000000003');  -- Patrícia
SET ROLE authenticated;
SELECT teste.ok('F03 Outra família não enxerga o arquivo da Juliana',
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'comprovantes') = 0);
RESET ROLE;
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');  -- admin
SET ROLE authenticated;
SELECT teste.ok('F04 Administradora enxerga os comprovantes', (SELECT count(*) FROM storage.objects) = 1);
INSERT INTO pagamento (mensalidade_id, valor_pago, data_pagamento, forma, confirmado_por)
SELECT m.id, m.valor_final, '2026-10-02', 'DINHEIRO', auth.uid()
FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
WHERE c.nome_completo = 'Benício Rocha' AND m.competencia = '2026-09-01';
SELECT teste.ok('F05 Pagamento em dinheiro quita a mensalidade atrasada',
  (SELECT v.status FROM vw_mensalidade_status v JOIN crianca c ON c.id = v.crianca_id
   WHERE c.nome_completo = 'Benício Rocha' AND v.competencia = '2026-09-01') = 'PAGO');
SELECT teste.ok('F06 Pagamento manual fica no log', EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'PAGAMENTO_MANUAL'));
RESET ROLE;

-- =====================================================================
-- 9) Telefone brasileiro e autocadastro do responsável (0006)
-- =====================================================================
SELECT teste.ok('T01 Telefone: celular e fixo com DDD válido são aceitos',
  telefone_valido('(11) 91234-5678') AND telefone_valido('(21) 3456-7890') AND telefone_valido('(98) 99999-0000'));
SELECT teste.ok('T02 Telefone: DDD inexistente, celular sem 9, sem máscara ou curto são recusados',
  NOT telefone_valido('(10) 91234-5678') AND NOT telefone_valido('(20) 91234-5678') AND NOT telefone_valido('(11) 81234-5678')
  AND NOT telefone_valido('11912345678') AND NOT telefone_valido('(11) 1234-567') AND NOT telefone_valido('(11) 1234-5678'));
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT teste.deve_falhar('T03 Banco recusa cadastrar responsável com telefone inválido',
  $$INSERT INTO responsavel (nome, telefone) VALUES ('Telefone Ruim', '(00) 1234-5678')$$);
-- A administração já tinha cadastrado o pai da Helena com o e-mail dele
INSERT INTO responsavel (nome, telefone, email) VALUES ('Pai Pré-cadastrado', '(11) 98888-1111', 'pai.app@exemplo.com');
INSERT INTO crianca_responsavel (crianca_id, responsavel_id, parentesco)
SELECT c.id, r.id, 'Pai' FROM crianca c, responsavel r WHERE c.nome_completo = 'Helena Costa' AND r.nome = 'Pai Pré-cadastrado';
RESET ROLE;

-- Cadastros feitos pelo app (o Supabase grava os dados do formulário em raw_user_meta_data)
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'nova.mae@exemplo.com',
   '{"origem":"app","nome":"Nova Mãe","telefone":"(11) 97777-2222","criancas":"Davi Souza","parentesco":"Mãe","aceite_termo":"true"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'pai.app@exemplo.com',
   '{"origem":"app","nome":"Pai App","telefone":"(11) 98888-1111","criancas":"Helena"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'espertinho@exemplo.com',
   '{"origem":"app","nome":"Espertinho","telefone":"(11) 96666-3333","perfil":"ADMIN","ativo":true}');

SELECT teste.ok('S10 Cadastro pelo app nasce INATIVO e vira solicitação PENDENTE',
  (SELECT NOT ativo FROM usuario WHERE email = 'nova.mae@exemplo.com') AND
  (SELECT status = 'PENDENTE' FROM solicitacao_cadastro WHERE email = 'nova.mae@exemplo.com'));
SELECT teste.ok('S11 Tentar se cadastrar como ADMIN não funciona',
  (SELECT perfil = 'RESPONSAVEL' AND NOT ativo FROM usuario WHERE email = 'espertinho@exemplo.com'));
SELECT teste.ok('S12 Administradora recebe aviso de cadastro novo',
  (SELECT count(*) FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
   WHERE u.email = 'admin@exemplo.com' AND n.tipo = 'CADASTRO') = 3);

SELECT teste.entrar('00000000-0000-0000-0000-0000000000d2');
SET ROLE authenticated;
SELECT teste.ok('S13 Conta pendente não vê nenhuma criança (mesmo já vinculada pelo e-mail)',
  (SELECT count(*) FROM crianca) = 0 AND meu_responsavel_id() IS NULL);
SELECT teste.ok('S14 Conta pendente vê a própria solicitação', (SELECT count(*) FROM solicitacao_cadastro) = 1);
SELECT teste.deve_falhar('S15 Conta pendente não consegue se aprovar',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro LIMIT 1))$$);
RESET ROLE;

SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT teste.ok('S16 Administradora vê as 3 solicitações', (SELECT count(*) FROM solicitacao_cadastro WHERE status = 'PENDENTE') = 3);
SELECT teste.deve_falhar('S17 Aprovar com criança exige parentesco',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'nova.mae@exemplo.com'),
                            jsonb_build_array(jsonb_build_object('acao', 'EXISTENTE', 'crianca_id', (SELECT id FROM crianca WHERE nome_completo = 'Davi Souza'))))$$);
SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'nova.mae@exemplo.com'),
                        jsonb_build_array(jsonb_build_object('acao', 'EXISTENTE', 'crianca_id', (SELECT id FROM crianca WHERE nome_completo = 'Davi Souza'))),
                        'Mãe', TRUE, TRUE, FALSE);
SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'pai.app@exemplo.com'));
SELECT teste.deve_falhar('S18 Recusa sem motivo é bloqueada',
  $$SELECT recusar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'espertinho@exemplo.com'), '')$$);
SELECT recusar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'espertinho@exemplo.com'), 'Não reconhecemos este cadastro.');
RESET ROLE;

SELECT teste.ok('S19 Aprovado: conta ativa, responsável criado com telefone e termo aceito',
  (SELECT ativo FROM usuario WHERE email = 'nova.mae@exemplo.com') AND
  (SELECT telefone = '(11) 97777-2222' AND consentimento_em IS NOT NULL FROM responsavel WHERE email = 'nova.mae@exemplo.com'));
SELECT teste.ok('S20 Pré-cadastrado: aprovação reaproveita o cadastro (sem duplicar)',
  (SELECT count(*) FROM responsavel WHERE email = 'pai.app@exemplo.com') = 1);
SELECT teste.ok('S21 Recusado continua sem acesso, com o motivo registrado',
  (SELECT NOT ativo FROM usuario WHERE email = 'espertinho@exemplo.com') AND
  (SELECT motivo_recusa IS NOT NULL FROM solicitacao_cadastro WHERE email = 'espertinho@exemplo.com'));

SELECT teste.entrar('00000000-0000-0000-0000-0000000000d1');
SET ROLE authenticated;
SELECT teste.ok('S22 Nova mãe aprovada vê só o Davi', (SELECT array_agg(nome_completo) FROM crianca) = ARRAY['Davi Souza']::varchar[]);
RESET ROLE;
SELECT teste.entrar('00000000-0000-0000-0000-0000000000d2');
SET ROLE authenticated;
SELECT teste.ok('S23 Pai pré-cadastrado aprovado vê a Helena', (SELECT array_agg(nome_completo) FROM crianca) = ARRAY['Helena Costa']::varchar[]);
RESET ROLE;

-- =====================================================================
-- 10) Comunicação: nome do remetente e mensagens lidas (0007)
-- =====================================================================
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
INSERT INTO mensagem (crianca_id, remetente_id, conteudo, remetente_nome)
SELECT id, auth.uid(), 'Lara dormiu bem hoje.', 'Nome Falso' FROM crianca WHERE nome_completo = 'Lara Mendes';
RESET ROLE;
SELECT teste.ok('M01 Mensagem da administração sai como "Hotelzinho" (nome não pode ser forjado)',
  (SELECT remetente_nome FROM mensagem WHERE conteudo = 'Lara dormiu bem hoje.') = 'Hotelzinho');
SELECT teste.ok('M02 Família recebe aviso de mensagem nova',
  (SELECT count(*) FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
   WHERE n.tipo = 'MENSAGEM' AND u.email IN ('juliana@exemplo.com', 'rafael@exemplo.com')) = 2);

SELECT teste.entrar('00000000-0000-0000-0000-000000000002');  -- Rafael (pai da Lara)
SET ROLE authenticated;
INSERT INTO mensagem (crianca_id, remetente_id, conteudo)
SELECT id, auth.uid(), 'Obrigado pelo aviso!' FROM crianca WHERE nome_completo = 'Lara Mendes';
SELECT teste.ok('M03 Mensagem do pai sai com o nome dele', (SELECT remetente_nome FROM mensagem WHERE conteudo = 'Obrigado pelo aviso!') = 'Rafael Mendes');
SELECT teste.ok('M04 Pai marca como lida só a mensagem do hotelzinho', marcar_mensagens_lidas((SELECT id FROM crianca WHERE nome_completo = 'Lara Mendes')) = 1);
RESET ROLE;
SELECT teste.entrar('00000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT teste.deve_falhar('M05 Pai não marca conversa de outra família',
  format('SELECT marcar_mensagens_lidas(%s)', (SELECT id FROM crianca WHERE nome_completo = 'Davi Souza')));
RESET ROLE;

SELECT teste.entrar('00000000-0000-0000-0000-000000000001');  -- Juliana vê a conversa da Lara inteira
SET ROLE authenticated;
SELECT teste.ok('M06 Mãe vê na conversa a mensagem do pai, com o nome dele',
  EXISTS (SELECT 1 FROM mensagem WHERE remetente_nome = 'Rafael Mendes'));
RESET ROLE;
SELECT teste.ok('M07 Administração recebe aviso da mensagem do pai',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'admin@exemplo.com' AND n.tipo = 'MENSAGEM'));

-- =====================================================================
-- 11) Criança enviada no autocadastro e aprovada pela administração (0008)
-- =====================================================================
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-0000000000d4', 'familia.ramos@exemplo.com',
   '{"origem":"app","nome":"Carla Ramos","telefone":"(21) 99876-5432","parentesco":"Mãe","aceite_termo":"true",
     "criancas_dados":[{"nome":"Bia Ramos","nascimento":"2023-05-04","turno":"TARDE","alergias":"Amendoim","perfil":"ADMIN"},
                       {"nome":"Caio Ramos","nascimento":"2021-01-15","turno":"MANHA"},
                       {"nome":"x"}, {"nome":"Data Ruim","nascimento":"ontem","turno":"NOITE"}]}');

SELECT teste.ok('C01 Dados das crianças guardados na solicitação, limpos (sem campos estranhos nem itens inválidos)',
  (SELECT jsonb_array_length(criancas_dados) = 3
      AND criancas_texto = 'Bia Ramos, Caio Ramos, Data Ruim'
      AND NOT (criancas_dados -> 0 ? 'perfil')
      AND NOT (criancas_dados -> 2 ? 'nascimento') AND NOT (criancas_dados -> 2 ? 'turno')
   FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'));
SELECT teste.ok('C02 Nenhuma criança é criada antes da aprovação',
  (SELECT count(*) FROM crianca WHERE nome_completo IN ('Bia Ramos', 'Caio Ramos')) = 0);

SELECT teste.entrar('00000000-0000-0000-0000-0000000000d4');
SET ROLE authenticated;
SELECT teste.deve_falhar('C03 Família não consegue aprovar a própria criança',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro LIMIT 1),
      '[{"acao":"NOVA","nome":"Bia Ramos","nascimento":"2023-05-04","plano_id":1}]', 'Mãe')$$);
SELECT teste.deve_falhar('C04 Família não cria criança direto na tabela',
  $$INSERT INTO crianca (nome_completo, data_nascimento, plano_id) VALUES ('Bia Ramos', '2023-05-04', 1)$$);
RESET ROLE;

SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT teste.deve_falhar('C05 Criança nova sem data de nascimento é recusada',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'),
      jsonb_build_array(jsonb_build_object('acao','NOVA','nome','Bia Ramos','plano_id',(SELECT id FROM plano WHERE turno='TARDE'))), 'Mãe')$$);
SELECT teste.deve_falhar('C06 Criança nova sem plano é recusada',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'),
      '[{"acao":"NOVA","nome":"Bia Ramos","nascimento":"2023-05-04"}]', 'Mãe')$$);
SELECT teste.deve_falhar('C07 Data de nascimento no futuro é recusada',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'),
      jsonb_build_array(jsonb_build_object('acao','NOVA','nome','Bia Ramos','nascimento','2999-01-01','plano_id',(SELECT id FROM plano WHERE turno='TARDE'))), 'Mãe')$$);
SELECT teste.deve_falhar('C08 Ligar a criança inexistente é recusado',
  $$SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'),
      '[{"acao":"EXISTENTE","crianca_id":999999}]', 'Mãe')$$);
RESET ROLE;
SELECT teste.ok('C09 Tentativas com erro não deixam nada pela metade',
  (SELECT status = 'PENDENTE' FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com')
  AND NOT EXISTS (SELECT 1 FROM responsavel WHERE email = 'familia.ramos@exemplo.com')
  AND NOT EXISTS (SELECT 1 FROM crianca WHERE nome_completo = 'Bia Ramos'));

-- A administradora aprova a Bia (corrigindo o nome e em adaptação) e NÃO aprova o Caio nem a "Data Ruim"
SELECT teste.entrar('00000000-0000-0000-0000-00000000000a');
SET ROLE authenticated;
SELECT aprovar_cadastro((SELECT id FROM solicitacao_cadastro WHERE email = 'familia.ramos@exemplo.com'),
  jsonb_build_array(jsonb_build_object('acao','NOVA','nome','Beatriz Ramos','nascimento','2023-05-04',
    'plano_id',(SELECT id FROM plano WHERE turno='TARDE'),'status','EM_ADAPTACAO','alergias','Amendoim')),
  'Mãe', TRUE, TRUE, TRUE);
RESET ROLE;
SELECT teste.ok('C10 Criança aprovada é criada com os dados conferidos, plano e situação escolhidos',
  (SELECT c.data_nascimento = '2023-05-04' AND c.status = 'EM_ADAPTACAO' AND p.turno = 'TARDE' AND c.alergias = 'Amendoim'
   FROM crianca c JOIN plano p ON p.id = c.plano_id WHERE c.nome_completo = 'Beatriz Ramos'));
SELECT teste.ok('C11 Criança não aprovada não é criada',
  NOT EXISTS (SELECT 1 FROM crianca WHERE nome_completo IN ('Caio Ramos', 'Data Ruim')));
SELECT teste.ok('C12 Mãe fica vinculada à criança como financeira, autorizada e emergência',
  (SELECT cr.parentesco = 'Mãe' AND cr.eh_financeiro AND cr.autorizado_buscar AND cr.contato_emergencia
   FROM crianca_responsavel cr JOIN responsavel r ON r.id = cr.responsavel_id JOIN crianca c ON c.id = cr.crianca_id
   WHERE r.email = 'familia.ramos@exemplo.com' AND c.nome_completo = 'Beatriz Ramos'));
SELECT teste.ok('C13 Aviso de aprovação cita a criança e o log registra a criança criada',
  (SELECT texto LIKE '%Beatriz%' FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
   WHERE u.email = 'familia.ramos@exemplo.com' AND n.tipo = 'CADASTRO')
  AND (SELECT jsonb_array_length(detalhes -> 'criancas') = 1 FROM log_auditoria
       WHERE acao = 'APROVAR_CADASTRO' ORDER BY id DESC LIMIT 1));

SELECT teste.entrar('00000000-0000-0000-0000-0000000000d4');
SET ROLE authenticated;
SELECT teste.ok('C14 Família aprovada entra e vê só a criança aprovada',
  (SELECT array_agg(nome_completo) FROM crianca) = ARRAY['Beatriz Ramos']::varchar[]);
RESET ROLE;

-- =====================================================================
-- 12) Avisos no celular (0009)
-- =====================================================================
SELECT teste.entrar('');
SET ROLE anon;
SELECT teste.deve_falhar('N01 Visitante sem login não registra aparelho',
  $$SELECT registrar_push('https://push.exemplo.com/visitante', repeat('k', 60), repeat('a', 16))$$);
RESET ROLE;

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT registrar_push('https://push.exemplo.com/celular-juliana', repeat('k', 87), repeat('a', 22), 'Android');
SELECT teste.ok('N02 Mãe registra o próprio celular e vê só os aparelhos dela',
  (SELECT count(*) FROM push_inscricao) = 1 AND (SELECT usuario_id = auth.uid() FROM push_inscricao));
SELECT teste.deve_falhar('N03 Não dá para gravar aparelho direto na tabela (só pela função)',
  $$INSERT INTO push_inscricao (usuario_id, endpoint, p256dh, auth) VALUES (auth.uid(), 'https://x.com/a', repeat('k', 60), repeat('a', 16))$$);
SELECT teste.deve_falhar('N04 Família não lê as chaves secretas do aparelho', $$SELECT p256dh FROM push_inscricao$$);
SELECT teste.deve_falhar('N05 Família não consegue pedir o envio de avisos (função do servidor)',
  $$SELECT reivindicar_push((SELECT max(id) FROM notificacao))$$);
SELECT teste.deve_falhar('N06 Endereço que não é https é recusado',
  $$SELECT registrar_push('http://push.exemplo.com/x', repeat('k', 87), repeat('a', 22))$$);
RESET ROLE;

-- Notificação para quem tem aparelho → dispara a função; para quem não tem → nada
DELETE FROM net.pedidos;
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
INSERT INTO comunicado (titulo, conteudo, crianca_id, autor_id)
SELECT 'Passeio no parque', 'Sexta teremos passeio.', id, auth.uid() FROM crianca WHERE nome_completo = 'Lara Mendes';
RESET ROLE;
SELECT teste.ok('N07 Comunicado da Lara dispara 1 aviso (só a Juliana tem aparelho inscrito)',
  (SELECT count(*) FROM net.pedidos) = 1 AND
  (SELECT (body ->> 'notificacao')::bigint FROM net.pedidos) =
    (SELECT n.id FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
      WHERE u.email = 'juliana@exemplo.com' AND n.texto = 'Passeio no parque: Sexta teremos passeio.') AND
  (SELECT url FROM net.pedidos) LIKE 'https://%/functions/v1/enviar-push');

-- A função do servidor pega a notificação uma vez só
SELECT (body ->> 'notificacao') AS nid FROM net.pedidos \gset
SET ROLE service_role;
SELECT teste.ok('N08 Servidor recebe o texto vindo do banco e o aparelho de destino',
  (SELECT r ->> 'titulo' = 'Comunicado' AND r ->> 'texto' = 'Passeio no parque: Sexta teremos passeio.' AND r ->> 'link' = '/familia'
          AND jsonb_array_length(r -> 'inscricoes') = 1
          AND r -> 'inscricoes' -> 0 ->> 'endpoint' = 'https://push.exemplo.com/celular-juliana'
   FROM (SELECT reivindicar_push(:nid) AS r) x));
SELECT teste.ok('N09 A mesma notificação não é enviada duas vezes',
  reivindicar_push(:nid) IS NULL);
RESET ROLE;
UPDATE notificacao SET criada_em = now() - interval '1 hour', push_enviado_em = NULL
 WHERE id = :nid;
SET ROLE service_role;
SELECT teste.ok('N10 Notificação antiga não vira aviso (evita avisos atrasados)',
  reivindicar_push(:nid) IS NULL);
RESET ROLE;

-- Celular compartilhado: o pai entra no mesmo aparelho → o aparelho passa a ser dele
SELECT teste.entrar('00000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT registrar_push('https://push.exemplo.com/celular-juliana', repeat('k', 87), repeat('a', 22), 'Android');
RESET ROLE;
SELECT teste.ok('N11 Aparelho usado por outra pessoa passa a avisar só quem está logado',
  (SELECT count(*) FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/celular-juliana') = 1 AND
  (SELECT u.email FROM push_inscricao p JOIN usuario u ON u.id = p.usuario_id
    WHERE endpoint = 'https://push.exemplo.com/celular-juliana') = 'rafael@exemplo.com');

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT remover_push('https://push.exemplo.com/celular-juliana');
RESET ROLE;
SELECT teste.ok('N12 Ninguém desliga o aparelho de outra pessoa',
  (SELECT count(*) FROM push_inscricao WHERE endpoint = 'https://push.exemplo.com/celular-juliana') = 1);
SELECT teste.entrar('00000000-0000-0000-0000-000000000002');
SET ROLE authenticated;
SELECT remover_push('https://push.exemplo.com/celular-juliana');
RESET ROLE;
SELECT teste.ok('N13 Ao sair ou desativar, o aparelho deixa de receber avisos',
  (SELECT count(*) FROM push_inscricao) = 0);

-- Sem aparelho inscrito, nenhuma chamada é feita
DELETE FROM net.pedidos;
SELECT notificar_admins('CADASTRO', 'Teste sem aparelho', '/admin/solicitacoes');
SELECT teste.ok('N14 Sem aparelho inscrito, o banco não chama a função', (SELECT count(*) FROM net.pedidos) = 0);

-- =====================================================================
-- 13) Cobrança automática, edição de valor e exclusão de cobrança (0010)
-- =====================================================================
SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT teste.deve_falhar('K01 Família não liga a cobrança automática', $$SELECT definir_cobranca_automatica(TRUE)$$);
RESET ROLE;

DELETE FROM mensalidade m WHERE m.competencia = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date
  AND NOT EXISTS (SELECT 1 FROM pagamento p WHERE p.mensalidade_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM comprovante c WHERE c.mensalidade_id = m.id);
DELETE FROM config_sistema WHERE chave = 'ultima_cobranca_automatica';
CREATE TEMP TABLE mes_atual AS SELECT date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS d;
GRANT SELECT ON mes_atual TO authenticated;

SELECT teste.ok('K02 Desligada, a cobrança automática não gera nada', gerar_mensalidades_automatico() = 0);

SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
CREATE TEMP TABLE r_ligar AS SELECT definir_cobranca_automatica(TRUE) AS qtd;
RESET ROLE;
SELECT teste.ok('K03 Ao ligar, gera na hora as mensalidades do mês atual para as crianças ativas',
  (SELECT qtd FROM r_ligar) > 0 AND
  (SELECT count(*) FROM mensalidade WHERE competencia = (SELECT d FROM mes_atual)) =
  (SELECT count(*) FROM crianca WHERE status IN ('ATIVA', 'EM_ADAPTACAO')));
SELECT teste.ok('K04 Rodar de novo no mesmo mês não duplica', gerar_mensalidades_automatico() = 0);
SELECT teste.ok('K05 Geração automática fica no log', EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'GERAR_MENSALIDADES_AUTO'));

-- Edição de valor
CREATE TEMP TABLE alvo AS
  SELECT m.id, m.crianca_id FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
  WHERE m.competencia = (SELECT d FROM mes_atual) AND c.nome_completo = 'Lara Mendes';
GRANT SELECT ON alvo, r_ligar TO authenticated;

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT teste.deve_falhar('K06 Família não altera o valor da mensalidade',
  $$SELECT editar_mensalidade((SELECT id FROM alvo), 1, 'quero pagar menos')$$);
RESET ROLE;

SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT teste.deve_falhar('K07 Alterar valor exige motivo', $$SELECT editar_mensalidade((SELECT id FROM alvo), 600, '')$$);
SELECT teste.deve_falhar('K08 Valor negativo é recusado', $$SELECT editar_mensalidade((SELECT id FROM alvo), -10, 'teste')$$);
SELECT editar_mensalidade((SELECT id FROM alvo), 585, 'Desconto de irmãos (10%)');
SELECT teste.deve_falhar('K09 Valor menor que o já pago é recusado',
  $$SELECT editar_mensalidade((SELECT m.id FROM mensalidade m JOIN pagamento p ON p.mensalidade_id = m.id LIMIT 1), 1, 'erro')$$);
RESET ROLE;
SELECT teste.ok('K10 Novo valor e motivo gravados na mensalidade',
  (SELECT valor_final = 585 AND observacao = 'Desconto de irmãos (10%)' FROM mensalidade WHERE id = (SELECT id FROM alvo)));
SELECT teste.ok('K11 Alteração de valor fica no log com o valor antigo e o novo',
  EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'EDITAR_MENSALIDADE'
          AND (detalhes ->> 'de')::numeric = 650 AND (detalhes ->> 'para')::numeric = 585));
SELECT teste.ok('K12 A família é avisada da alteração',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.tipo = 'MENSALIDADE' AND n.texto LIKE '%R$ 585,00%'));

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT teste.ok('K13 A família vê o novo valor e o motivo',
  (SELECT valor_final = 585 AND observacao LIKE 'Desconto%' FROM vw_mensalidade_status WHERE id = (SELECT id FROM alvo)));
SELECT teste.deve_falhar('K14 Família não exclui cobrança', $$SELECT excluir_mensalidade((SELECT id FROM alvo), 'não quero')$$);
RESET ROLE;

-- Exclusão
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT teste.deve_falhar('K15 Cobrança com pagamento não pode ser excluída',
  $$SELECT excluir_mensalidade((SELECT m.id FROM mensalidade m JOIN pagamento p ON p.mensalidade_id = m.id LIMIT 1), 'erro')$$);
SELECT teste.deve_falhar('K16 Excluir exige motivo', $$SELECT excluir_mensalidade((SELECT id FROM alvo), '')$$);
SELECT excluir_mensalidade((SELECT id FROM alvo), 'Lançada por engano');
RESET ROLE;
SELECT teste.ok('K17 Cobrança errada é excluída', NOT EXISTS (SELECT 1 FROM mensalidade WHERE id = (SELECT id FROM alvo)));
SELECT teste.ok('K18 Exclusão fica no log com o motivo',
  EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'EXCLUIR_MENSALIDADE' AND detalhes ->> 'motivo' = 'Lançada por engano'));
SELECT teste.ok('K19 A família é avisada do cancelamento',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.texto LIKE 'A cobrança de % foi cancelada%'));
SELECT teste.ok('K20 A cobrança automática não recria a cobrança excluída no mesmo mês',
  gerar_mensalidades_automatico() = 0 AND
  NOT EXISTS (SELECT 1 FROM mensalidade WHERE crianca_id = (SELECT crianca_id FROM alvo) AND competencia = (SELECT d FROM mes_atual)));

-- Comprovante em análise bloqueia edição e exclusão
INSERT INTO comprovante (mensalidade_id, responsavel_id, arquivo_path)
SELECT m.id, cr.responsavel_id, 'teste/em_analise.pdf'
FROM mensalidade m JOIN crianca_responsavel cr ON cr.crianca_id = m.crianca_id
WHERE m.competencia = (SELECT d FROM mes_atual) AND NOT EXISTS (SELECT 1 FROM pagamento p WHERE p.mensalidade_id = m.id)
LIMIT 1;
CREATE TEMP TABLE em_analise AS SELECT mensalidade_id AS id FROM comprovante WHERE arquivo_path = 'teste/em_analise.pdf';
GRANT SELECT ON em_analise TO authenticated;
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT teste.deve_falhar('K21 Com comprovante em análise, o valor não muda', $$SELECT editar_mensalidade((SELECT id FROM em_analise), 100, 'teste')$$);
SELECT teste.deve_falhar('K22 Com comprovante em análise, a cobrança não é excluída', $$SELECT excluir_mensalidade((SELECT id FROM em_analise), 'teste')$$);
SELECT definir_cobranca_automatica(FALSE);
RESET ROLE;
SELECT teste.ok('K23 Administração desliga a cobrança automática', NOT (SELECT cobranca_automatica FROM configuracao));

-- =====================================================================
-- 14) Cobrança individual (0011)
-- =====================================================================
CREATE TEMP TABLE indiv AS SELECT id FROM crianca WHERE nome_completo = 'Pedro Mendes';
GRANT SELECT ON indiv TO authenticated;
DELETE FROM mensalidade WHERE crianca_id = (SELECT id FROM indiv) AND competencia = '2027-01-01';

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
SELECT teste.deve_falhar('I01 Família não cria cobrança', $$SELECT criar_cobranca_individual((SELECT id FROM indiv), '2027-01-01')$$);
RESET ROLE;

SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT teste.deve_falhar('I02 Valor diferente do plano exige motivo',
  $$SELECT criar_cobranca_individual((SELECT id FROM indiv), '2027-01-15', 300)$$);
CREATE TEMP TABLE r_indiv AS SELECT criar_cobranca_individual((SELECT id FROM indiv), '2027-01-15') AS id;
SELECT teste.deve_falhar('I03 Não cria duas cobranças da mesma criança no mesmo mês',
  $$SELECT criar_cobranca_individual((SELECT id FROM indiv), '2027-01-01')$$);
RESET ROLE;
SELECT teste.ok('I04 Cobrança individual criada só para a criança escolhida, com valor do plano e vencimento no fim do mês',
  (SELECT count(*) FROM mensalidade WHERE competencia = '2027-01-01') = 1 AND
  (SELECT valor_final = 470 AND data_vencimento = '2027-01-31' AND observacao IS NULL
     FROM mensalidade WHERE id = (SELECT id FROM r_indiv)));
SELECT teste.ok('I05 A família é avisada da nova cobrança',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.texto LIKE 'Nova cobrança: mensalidade de janeiro/2027 (Pedro), R$ 470,00%'));
SELECT teste.ok('I06 Cobrança individual fica no log', EXISTS (SELECT 1 FROM log_auditoria WHERE acao = 'COBRANCA_INDIVIDUAL'));

INSERT INTO crianca (nome_completo, data_nascimento, status) VALUES ('Criança Que Saiu', '2023-01-01', 'INATIVA');
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
SELECT criar_cobranca_individual((SELECT id FROM crianca WHERE nome_completo = 'Lara Mendes'), '2027-01-01', 325, 'Entrou no meio do mês');
SELECT teste.deve_falhar('I07 Criança inativa não recebe cobrança',
  $$SELECT criar_cobranca_individual((SELECT id FROM crianca WHERE nome_completo = 'Criança Que Saiu'), '2027-01-01', 100, 'teste')$$);
RESET ROLE;
SELECT teste.ok('I08 Valor diferente do plano é gravado com o motivo',
  (SELECT valor_final = 325 AND observacao = 'Entrou no meio do mês' FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
   WHERE c.nome_completo = 'Lara Mendes' AND m.competencia = '2027-01-01'));

-- =====================================================================
-- 15) Avisos com prévia do conteúdo (0012)
-- =====================================================================
SELECT teste.entrar(:'ADMIN');
SET ROLE authenticated;
INSERT INTO mensagem (crianca_id, remetente_id, conteudo)
SELECT id, auth.uid(), 'A Lara    vai sair às 15h amanhã.' FROM crianca WHERE nome_completo = 'Lara Mendes';
INSERT INTO comunicado (titulo, conteudo, autor_id)
VALUES ('Reunião de pais', repeat('Teremos reunião na sexta-feira às 18h no salão. ', 10), auth.uid());
INSERT INTO registro_rotina (crianca_id, tipo, descricao, registrado_por, visivel_pais)
SELECT id, 'OCORRENCIA', 'Bateu o joelho no parquinho, fizemos compressa.', auth.uid(), TRUE FROM crianca WHERE nome_completo = 'Lara Mendes';
INSERT INTO registro_rotina (crianca_id, tipo, descricao, registrado_por, visivel_pais)
SELECT id, 'RECADO', 'Recado interno da equipe', auth.uid(), FALSE FROM crianca WHERE nome_completo = 'Lara Mendes';
RESET ROLE;

SELECT teste.ok('W01 Mensagem do hotelzinho chega com o nome da criança e o texto',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.texto = 'Lara · Hotelzinho: A Lara vai sair às 15h amanhã.'));
SELECT teste.ok('W02 Comunicado longo chega com título e começo do texto, cortado com reticências',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.texto LIKE 'Reunião de pais: Teremos reunião na sexta-feira%…'
            AND length(n.texto) <= 200));
SELECT teste.ok('W03 Ocorrência chega com o nome da criança e o que aconteceu',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'juliana@exemplo.com' AND n.tipo = 'OCORRENCIA'
            AND n.texto = 'Lara: Bateu o joelho no parquinho, fizemos compressa.'));
SELECT teste.ok('W04 Registro não visível para a família não gera aviso',
  NOT EXISTS (SELECT 1 FROM notificacao WHERE texto LIKE '%Recado interno da equipe%'));

SELECT teste.entrar(:'JULIANA');
SET ROLE authenticated;
INSERT INTO mensagem (crianca_id, remetente_id, conteudo)
SELECT id, auth.uid(), 'Ela já tomou o remédio.' FROM crianca WHERE nome_completo = 'Lara Mendes';
RESET ROLE;
SELECT teste.ok('W05 Mensagem da família chega à administração com quem mandou, a criança e o texto',
  EXISTS (SELECT 1 FROM notificacao n JOIN usuario u ON u.id = n.usuario_id
          WHERE u.email = 'admin@exemplo.com' AND n.texto = 'Juliana (Lara): Ela já tomou o remédio.'));

-- =====================================================================
-- Relatório
-- =====================================================================
\echo
\echo '==================== RESULTADO DOS TESTES ===================='
SELECT CASE WHEN ok THEN 'OK     ' ELSE 'FALHOU ' END AS resultado, nome,
       CASE WHEN ok THEN '' ELSE COALESCE(detalhe, '') END AS detalhe
FROM teste.resultado ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS aprovados, count(*) FILTER (WHERE NOT ok) AS falharam, count(*) AS total
FROM teste.resultado;
