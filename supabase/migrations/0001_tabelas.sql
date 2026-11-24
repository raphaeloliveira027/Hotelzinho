-- =====================================================================
-- Hotelzinho — Sistema de gestão do hotelzinho infantil
-- Migration 0001: tipos, tabelas, chaves e regras de integridade
-- Projeto de Extensão I — Sistemas de Informação
-- =====================================================================

CREATE TYPE perfil_usuario  AS ENUM ('ADMIN', 'RESPONSAVEL');
CREATE TYPE status_crianca  AS ENUM ('ATIVA', 'EM_ADAPTACAO', 'INATIVA');
CREATE TYPE turno_plano     AS ENUM ('MANHA', 'TARDE', 'INTEGRAL');
CREATE TYPE tipo_rotina     AS ENUM ('REFEICAO', 'SONO', 'ATIVIDADE', 'OBSERVACAO', 'OCORRENCIA', 'RECADO');
CREATE TYPE status_analise  AS ENUM ('PENDENTE', 'ACEITO', 'RECUSADO');
CREATE TYPE forma_pagamento AS ENUM ('PIX', 'DINHEIRO', 'OUTRO');

-- ---------------------------------------------------------------------
-- Usuários e pessoas
-- ---------------------------------------------------------------------
-- Espelha auth.users (o Supabase Auth guarda a senha com hash).
CREATE TABLE usuario (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL UNIQUE,
  perfil     perfil_usuario NOT NULL DEFAULT 'RESPONSAVEL',
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE responsavel (
  id                BIGSERIAL PRIMARY KEY,
  usuario_id        UUID UNIQUE REFERENCES usuario(id) ON DELETE SET NULL,
  nome              VARCHAR(150) NOT NULL CHECK (length(trim(nome)) >= 3),
  telefone          VARCHAR(20)  NOT NULL CHECK (telefone ~ '^[0-9()+ -]{8,20}$'),
  telefone_alt      VARCHAR(20)  CHECK (telefone_alt IS NULL OR telefone_alt ~ '^[0-9()+ -]{8,20}$'),
  email             VARCHAR(255) CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  endereco          VARCHAR(255),
  consentimento_em  TIMESTAMPTZ,            -- aceite do termo de privacidade (LGPD)
  versao_termo      VARCHAR(10),
  CHECK ((consentimento_em IS NULL) = (versao_termo IS NULL))
);

-- ---------------------------------------------------------------------
-- Planos e calendário
-- ---------------------------------------------------------------------
CREATE TABLE plano (
  id     BIGSERIAL PRIMARY KEY,
  nome   VARCHAR(40) NOT NULL UNIQUE,
  turno  turno_plano NOT NULL,
  valor  NUMERIC(10,2) NOT NULL CHECK (valor >= 0),
  ativo  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE feriado (
  data       DATE PRIMARY KEY,
  descricao  VARCHAR(80) NOT NULL
);

-- ---------------------------------------------------------------------
-- Crianças
-- ---------------------------------------------------------------------
CREATE TABLE crianca (
  id                     BIGSERIAL PRIMARY KEY,
  nome_completo          VARCHAR(150) NOT NULL CHECK (length(trim(nome_completo)) >= 3),
  data_nascimento        DATE NOT NULL CHECK (data_nascimento <= CURRENT_DATE),
  sexo                   VARCHAR(20),               -- opcional
  foto_path              VARCHAR(255),              -- caminho no storage privado
  endereco               VARCHAR(255),
  status                 status_crianca NOT NULL DEFAULT 'ATIVA',
  plano_id               BIGINT REFERENCES plano(id),
  alergias               TEXT,                      -- somente o informado pela família
  restricoes_alimentares TEXT,
  info_saude             TEXT,
  observacoes            TEXT,
  criado_em              TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- criança ativa precisa ter plano para gerar mensalidade
  CHECK (status = 'INATIVA' OR plano_id IS NOT NULL)
);

CREATE TABLE crianca_responsavel (
  crianca_id          BIGINT REFERENCES crianca(id) ON DELETE CASCADE,
  responsavel_id      BIGINT REFERENCES responsavel(id) ON DELETE CASCADE,
  parentesco          VARCHAR(40) NOT NULL,
  eh_financeiro       BOOLEAN NOT NULL DEFAULT FALSE,
  autorizado_buscar   BOOLEAN NOT NULL DEFAULT TRUE,
  contato_emergencia  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (crianca_id, responsavel_id)
);

CREATE TABLE medida_crescimento (
  id              BIGSERIAL PRIMARY KEY,
  crianca_id      BIGINT NOT NULL REFERENCES crianca(id),
  data_medicao    DATE NOT NULL CHECK (data_medicao <= CURRENT_DATE),
  peso_kg         NUMERIC(5,2) CHECK (peso_kg > 0 AND peso_kg < 100),
  altura_cm       NUMERIC(5,1) CHECK (altura_cm > 0 AND altura_cm < 200),
  registrado_por  UUID REFERENCES usuario(id),
  CHECK (peso_kg IS NOT NULL OR altura_cm IS NOT NULL),
  UNIQUE (crianca_id, data_medicao)
);

-- ---------------------------------------------------------------------
-- Rotina
-- ---------------------------------------------------------------------
CREATE TABLE presenca (
  id                BIGSERIAL PRIMARY KEY,
  crianca_id        BIGINT NOT NULL REFERENCES crianca(id),
  data              DATE NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada      TIME NOT NULL,
  hora_saida        TIME CHECK (hora_saida IS NULL OR hora_saida > hora_entrada),
  buscado_por_id    BIGINT REFERENCES responsavel(id),
  buscado_por_nome  VARCHAR(150),                       -- quando não é responsável cadastrado
  CHECK (EXTRACT(ISODOW FROM data) BETWEEN 1 AND 5),    -- só segunda a sexta
  UNIQUE (crianca_id, data)
);

CREATE TABLE registro_rotina (
  id              BIGSERIAL PRIMARY KEY,
  crianca_id      BIGINT NOT NULL REFERENCES crianca(id),
  tipo            tipo_rotina NOT NULL,
  inicio          TIMESTAMPTZ NOT NULL DEFAULT now(),
  fim             TIMESTAMPTZ CHECK (fim IS NULL OR fim >= inicio),
  descricao       TEXT NOT NULL CHECK (length(trim(descricao)) > 0 AND length(descricao) <= 1000),
  aceitacao       VARCHAR(20) CHECK (aceitacao IS NULL OR aceitacao IN ('TUDO', 'PARTE', 'RECUSOU')),
  visivel_pais    BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_por  UUID NOT NULL REFERENCES usuario(id),
  CHECK (aceitacao IS NULL OR tipo = 'REFEICAO')
);

CREATE TABLE alteracao_informada (
  id              BIGSERIAL PRIMARY KEY,
  crianca_id      BIGINT NOT NULL REFERENCES crianca(id),
  responsavel_id  BIGINT NOT NULL REFERENCES responsavel(id),
  assunto         VARCHAR(60) NOT NULL,          -- saúde, alergia, quem busca, outro
  descricao       TEXT NOT NULL CHECK (length(descricao) <= 2000),
  status          status_analise NOT NULL DEFAULT 'PENDENTE',
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revisado_por    UUID REFERENCES usuario(id),
  revisado_em     TIMESTAMPTZ
);

-- ---------------------------------------------------------------------
-- Financeiro
-- ---------------------------------------------------------------------
CREATE TABLE mensalidade (
  id               BIGSERIAL PRIMARY KEY,
  crianca_id       BIGINT NOT NULL REFERENCES crianca(id),
  competencia      DATE NOT NULL CHECK (EXTRACT(DAY FROM competencia) = 1),  -- dia 1 do mês
  valor_base       NUMERIC(10,2) NOT NULL CHECK (valor_base >= 0),            -- copiado do plano
  desconto         NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),    -- hoje sempre 0
  valor_final      NUMERIC(10,2) GENERATED ALWAYS AS (valor_base - desconto) STORED,
  data_vencimento  DATE NOT NULL,
  cancelada        BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (desconto <= valor_base),
  -- vencimento: sempre o último dia do mês da competência
  CHECK (data_vencimento = (competencia + INTERVAL '1 month' - INTERVAL '1 day')::date),
  UNIQUE (crianca_id, competencia)
);

CREATE TABLE comprovante (
  id              BIGSERIAL PRIMARY KEY,
  mensalidade_id  BIGINT NOT NULL REFERENCES mensalidade(id),
  responsavel_id  BIGINT NOT NULL REFERENCES responsavel(id),
  arquivo_path    VARCHAR(255) NOT NULL,
  enviado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          status_analise NOT NULL DEFAULT 'PENDENTE',
  motivo_recusa   TEXT,
  analisado_por   UUID REFERENCES usuario(id),
  analisado_em    TIMESTAMPTZ,
  CHECK (status <> 'RECUSADO' OR motivo_recusa IS NOT NULL)
);

CREATE TABLE pagamento (
  id              BIGSERIAL PRIMARY KEY,
  mensalidade_id  BIGINT NOT NULL REFERENCES mensalidade(id),
  comprovante_id  BIGINT UNIQUE REFERENCES comprovante(id),
  valor_pago      NUMERIC(10,2) NOT NULL CHECK (valor_pago > 0),
  data_pagamento  DATE NOT NULL,
  forma           forma_pagamento NOT NULL,
  confirmado_por  UUID NOT NULL REFERENCES usuario(id),
  confirmado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Comunicação
-- ---------------------------------------------------------------------
CREATE TABLE comunicado (
  id            BIGSERIAL PRIMARY KEY,
  titulo        VARCHAR(120) NOT NULL,
  conteudo      TEXT NOT NULL CHECK (length(conteudo) <= 5000),
  crianca_id    BIGINT REFERENCES crianca(id),   -- NULL = para todas as famílias
  autor_id      UUID NOT NULL REFERENCES usuario(id),
  publicado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mensagem (
  id            BIGSERIAL PRIMARY KEY,
  crianca_id    BIGINT NOT NULL REFERENCES crianca(id),
  remetente_id  UUID NOT NULL REFERENCES usuario(id),
  conteudo      TEXT NOT NULL CHECK (length(trim(conteudo)) > 0 AND length(conteudo) <= 2000),
  enviada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  lida_em       TIMESTAMPTZ
);

CREATE TABLE notificacao (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  tipo        VARCHAR(40) NOT NULL,   -- COMUNICADO, OCORRENCIA, VENCIMENTO, ATRASO, COMPROVANTE
  texto       VARCHAR(255) NOT NULL,
  link        VARCHAR(255),
  criada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  lida        BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- Auditoria e configuração
-- ---------------------------------------------------------------------
CREATE TABLE log_auditoria (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   UUID REFERENCES usuario(id) ON DELETE SET NULL,
  acao         VARCHAR(60) NOT NULL,
  entidade     VARCHAR(40) NOT NULL,
  entidade_id  VARCHAR(40),
  detalhes     JSONB,
  data_hora    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Linha única com os dados do recebedor Pix.
CREATE TABLE configuracao (
  id               BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),  -- garante uma só linha
  pix_chave        VARCHAR(77),
  pix_nome         VARCHAR(25),     -- limite do padrão BR Code
  pix_cidade       VARCHAR(15),
  versao_termo     VARCHAR(10) NOT NULL DEFAULT '1.0'
);

-- ---------------------------------------------------------------------
-- Índices para as consultas mais comuns
-- ---------------------------------------------------------------------
CREATE INDEX ON crianca_responsavel (responsavel_id);
CREATE INDEX ON registro_rotina (crianca_id, inicio DESC);
CREATE INDEX ON presenca (data);
CREATE INDEX ON mensalidade (competencia);
CREATE INDEX ON comprovante (mensalidade_id);
CREATE INDEX ON pagamento (mensalidade_id);
CREATE INDEX ON mensagem (crianca_id, enviada_em DESC);
CREATE INDEX ON notificacao (usuario_id, lida);
