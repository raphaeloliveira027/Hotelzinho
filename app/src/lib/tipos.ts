// Tipos que espelham as tabelas do banco (supabase/migrations)

export type Perfil = 'ADMIN' | 'RESPONSAVEL'

export type Usuario = {
  id: string
  email: string
  perfil: Perfil
  ativo: boolean
}

export type Crianca = {
  id: number
  nome_completo: string
  data_nascimento: string
  status: 'ATIVA' | 'EM_ADAPTACAO' | 'INATIVA'
  plano_id: number | null
  alergias: string | null
  restricoes_alimentares: string | null
  info_saude: string | null
  observacoes: string | null
  plano?: { nome: string; valor: number } | null
}

export type StatusMensalidade = 'PENDENTE' | 'EM_ANALISE' | 'PAGO' | 'ATRASADO' | 'CANCELADA'

export type Mensalidade = {
  id: number
  crianca_id: number
  competencia: string
  valor_final: number
  data_vencimento: string
  valor_em_aberto: number
  status: StatusMensalidade
}

export type Comunicado = {
  id: number
  titulo: string
  conteudo: string
  crianca_id: number | null
  publicado_em: string
}
