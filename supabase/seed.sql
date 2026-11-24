-- =====================================================================
-- DADOS FICTÍCIOS para desenvolvimento, testes e apresentação.
-- Nomes, contatos e situações são inventados. Os valores dos planos
-- são os informados pela administradora.
--
-- Pré-requisito: os usuários abaixo já existem no Auth
--   (local: criados por local/01_usuarios_ficticios.sql;
--    Supabase: criados em Authentication > Users com estes e-mails).
-- =====================================================================

-- Perfil da administradora
UPDATE usuario SET perfil = 'ADMIN' WHERE email = 'admin@exemplo.com';

-- Planos (valores reais informados em 04/10/2026)
INSERT INTO plano (nome, turno, valor) VALUES
  ('Meio período manhã', 'MANHA',    470.00),
  ('Meio período tarde', 'TARDE',    470.00),
  ('Integral',           'INTEGRAL', 650.00);

-- Feriados nacionais do restante de 2026 (municipais: a administradora cadastra)
INSERT INTO feriado (data, descricao) VALUES
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-25', 'Natal');

-- Recebedor Pix: a chave real é cadastrada pela administradora na tela de
-- Configurações. Ela NÃO fica no código nem no repositório.
INSERT INTO configuracao (pix_chave, pix_nome, pix_cidade, versao_termo)
VALUES (NULL, 'HOTELZINHO', 'SAO PAULO', '1.0');

-- Responsáveis
INSERT INTO responsavel (usuario_id, nome, telefone, email) VALUES
  ((SELECT id FROM usuario WHERE email = 'juliana@exemplo.com'),  'Juliana Mendes', '(11) 90000-0001', 'juliana@exemplo.com'),
  ((SELECT id FROM usuario WHERE email = 'rafael@exemplo.com'),   'Rafael Mendes',  '(11) 90000-0002', 'rafael@exemplo.com'),
  ((SELECT id FROM usuario WHERE email = 'patricia@exemplo.com'), 'Patrícia Souza', '(11) 90000-0003', 'patricia@exemplo.com'),
  ((SELECT id FROM usuario WHERE email = 'marcos@exemplo.com'),   'Marcos Costa',   '(11) 90000-0004', 'marcos@exemplo.com'),
  (NULL,                                                          'Carla Rocha',    '(11) 90000-0005', NULL);  -- ainda sem login

-- Crianças
INSERT INTO crianca (nome_completo, data_nascimento, plano_id, alergias, restricoes_alimentares, observacoes) VALUES
  ('Lara Mendes',   '2022-03-14', (SELECT id FROM plano WHERE turno = 'INTEGRAL'), 'Amendoim', NULL, 'Dorme melhor com o paninho que vem na mochila.'),
  ('Pedro Mendes',  '2024-01-20', (SELECT id FROM plano WHERE turno = 'MANHA'),    NULL, NULL, NULL),
  ('Davi Souza',    '2021-11-02', (SELECT id FROM plano WHERE turno = 'MANHA'),    NULL, NULL, NULL),
  ('Helena Costa',  '2022-07-30', (SELECT id FROM plano WHERE turno = 'INTEGRAL'), NULL, 'Sem lactose', NULL),
  ('Benício Rocha', '2023-05-09', (SELECT id FROM plano WHERE turno = 'INTEGRAL'), NULL, NULL, NULL);

-- Vínculos (Lara e Pedro são irmãos: Juliana e Rafael veem os dois)
INSERT INTO crianca_responsavel (crianca_id, responsavel_id, parentesco, eh_financeiro, autorizado_buscar, contato_emergencia)
SELECT c.id, r.id, v.parentesco, v.fin, v.busca, v.emerg
FROM (VALUES
  ('Lara Mendes',   'Juliana Mendes', 'Mãe', TRUE,  TRUE, TRUE),
  ('Lara Mendes',   'Rafael Mendes',  'Pai', FALSE, TRUE, FALSE),
  ('Pedro Mendes',  'Juliana Mendes', 'Mãe', TRUE,  TRUE, TRUE),
  ('Pedro Mendes',  'Rafael Mendes',  'Pai', FALSE, TRUE, FALSE),
  ('Davi Souza',    'Patrícia Souza', 'Mãe', TRUE,  TRUE, TRUE),
  ('Helena Costa',  'Marcos Costa',   'Pai', TRUE,  TRUE, TRUE),
  ('Benício Rocha', 'Carla Rocha',    'Mãe', TRUE,  TRUE, TRUE)
) AS v(crianca, resp, parentesco, fin, busca, emerg)
JOIN crianca c ON c.nome_completo = v.crianca
JOIN responsavel r ON r.nome = v.resp;

-- Crescimento
INSERT INTO medida_crescimento (crianca_id, data_medicao, peso_kg, altura_cm)
SELECT id, d, p, a FROM crianca, (VALUES
  ('2026-03-04'::date, 15.1, 100.0), ('2026-06-03'::date, 15.8, 102.0), ('2026-09-01'::date, 16.2, 104.0)
) AS m(d, p, a) WHERE nome_completo = 'Lara Mendes';

-- Mensalidades de setembro/2026 (vencidas em 30/09)
INSERT INTO mensalidade (crianca_id, competencia, valor_base, data_vencimento)
SELECT c.id, '2026-09-01', p.valor, '2026-09-30'
FROM crianca c JOIN plano p ON p.id = c.plano_id;

-- Setembro: todos pagaram, menos o Benício (fica ATRASADO)
INSERT INTO pagamento (mensalidade_id, valor_pago, data_pagamento, forma, confirmado_por)
SELECT m.id, m.valor_final, '2026-09-29', 'PIX', (SELECT id FROM usuario WHERE email = 'admin@exemplo.com')
FROM mensalidade m JOIN crianca c ON c.id = m.crianca_id
WHERE m.competencia = '2026-09-01' AND c.nome_completo <> 'Benício Rocha';

-- Um dia de rotina (sexta, 02/10/2026)
INSERT INTO presenca (crianca_id, data, hora_entrada, hora_saida, buscado_por_id)
SELECT c.id, '2026-10-02', '06:42', '17:40', (SELECT id FROM responsavel WHERE nome = 'Juliana Mendes')
FROM crianca c WHERE c.nome_completo = 'Lara Mendes';

INSERT INTO registro_rotina (crianca_id, tipo, inicio, fim, descricao, aceitacao, visivel_pais, registrado_por)
SELECT c.id, v.tipo::tipo_rotina, v.ini::timestamptz, v.fim::timestamptz, v.descr, v.aceit, v.vis,
       (SELECT id FROM usuario WHERE email = 'admin@exemplo.com')
FROM crianca c, (VALUES
  ('REFEICAO',   '2026-10-02 07:30-03', NULL,                  'Café da manhã: pão e leite.', 'PARTE', TRUE),
  ('ATIVIDADE',  '2026-10-02 09:15-03', NULL,                  'Pintura com guache.',          NULL,    TRUE),
  ('REFEICAO',   '2026-10-02 11:30-03', NULL,                  'Almoço: arroz, feijão e frango.', 'TUDO', TRUE),
  ('SONO',       '2026-10-02 12:20-03', '2026-10-02 14:05-03', 'Soneca após o almoço.',        NULL,    TRUE),
  ('OBSERVACAO', '2026-10-02 15:00-03', NULL,                  'Anotação interna da administração.', NULL, FALSE)
) AS v(tipo, ini, fim, descr, aceit, vis)
WHERE c.nome_completo = 'Lara Mendes';

-- Comunicado geral
INSERT INTO comunicado (titulo, conteudo, autor_id)
VALUES ('Festa do Dia das Crianças',
        'Na sexta teremos lanche especial e brincadeiras.',
        (SELECT id FROM usuario WHERE email = 'admin@exemplo.com'));
