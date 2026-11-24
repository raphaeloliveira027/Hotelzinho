import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cartao } from '../../components/Layout'
import { useAuth } from '../../lib/auth'
import { competenciaBR, dataBR, dinheiro, idade, rotuloStatus } from '../../lib/formato'
import { Avatar, Logo } from '../../components/Enfeites'
import { AvisosNoCelular } from '../../components/AvisosNoCelular'
import { InstalarApp } from '../../components/InstalarApp'
import { supabase } from '../../lib/supabase'
import type { Comunicado, Crianca, Mensalidade } from '../../lib/tipos'

/**
 * Painel da família. Não há filtro por família no código:
 * o banco (RLS) já devolve somente as crianças vinculadas a quem está logado.
 */
export function FamiliaInicio() {
  const { sair } = useAuth()
  const [nome, setNome] = useState('')
  const [precisaTermo, setPrecisaTermo] = useState(false)
  const [criancas, setCriancas] = useState<Crianca[] | null>(null)
  const [mensalidades, setMensalidades] = useState<Mensalidade[]>([])
  const [comunicados, setComunicados] = useState<Comunicado[]>([])

  const carregar = () => {
    if (!supabase) return
    const db = supabase
    db.from('responsavel').select('nome, consentimento_em').single().then(({ data }) => {
      setNome(data?.nome?.split(' ')[0] ?? '')
      setPrecisaTermo(!data?.consentimento_em)
    })
    db.from('crianca').select('*, plano(nome, valor)').order('nome_completo')
      .then(({ data }) => setCriancas((data ?? []) as Crianca[]))
    db.from('vw_mensalidade_status').select('*').neq('status', 'CANCELADA')
      .order('competencia', { ascending: false })
      .then(({ data }) => setMensalidades((data ?? []) as Mensalidade[]))
    db.from('comunicado').select('*').order('publicado_em', { ascending: false }).limit(3)
      .then(({ data }) => setComunicados((data ?? []) as Comunicado[]))
  }

  useEffect(carregar, [])

  const aceitarTermo = async () => {
    await supabase?.rpc('aceitar_termo')
    setPrecisaTermo(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white border-[3px] border-sol flex items-center justify-center"><Logo tamanho={34} /></div>
          <h1 className="text-2xl">Olá{nome && `, ${nome}`}!</h1>
        </div>
        <button onClick={sair} className="min-h-[44px] px-2 text-sm font-semibold text-marca">Sair</button>
      </header>

      {precisaTermo && (
        <Cartao className="flex flex-col gap-3 border-2 border-marca">
          <h2 className="font-bold">Termo de privacidade</h2>
          <p className="text-sm text-suave">
            O hotelzinho guarda os dados da criança e da família somente para o cuidado diário,
            a comunicação e o controle das mensalidades. Você pode consultar e pedir correção a qualquer momento.
          </p>
          <button onClick={aceitarTermo} className="min-h-[48px] rounded-xl bg-marca text-white font-bold">
            Li e aceito
          </button>
        </Cartao>
      )}

      <InstalarApp />
      <AvisosNoCelular modo="convite" texto="Saiba na hora quando chegar recado, comunicado, mensagem do hotelzinho ou confirmação de pagamento." />

      {criancas === null && <p className="text-suave">Carregando…</p>}
      {criancas?.length === 0 && (
        <Cartao><p className="text-suave">Nenhuma criança vinculada à sua conta. Fale com a administração.</p></Cartao>
      )}

      {criancas?.map((c) => {
        const atual = mensalidades.find((m) => m.crianca_id === c.id)
        return (
          <Cartao key={c.id} className="flex flex-col gap-4">
            <div className="flex items-center gap-3.5">
              <Avatar id={c.id} nome={c.nome_completo} tamanho="lg" />
              <div>
                <p className="text-lg font-bold">{c.nome_completo}</p>
                <p className="text-sm text-suave">{idade(c.data_nascimento)} · {c.plano?.nome ?? 'Sem plano'}</p>
              </div>
            </div>
            {atual && (
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-suave">Mensalidade de {competenciaBR(atual.competencia)}</p>
                  <p className="text-2xl font-bold">{dinheiro(atual.valor_final)}</p>
                  <p className="text-sm text-suave">Vence em {dataBR(atual.data_vencimento)}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${rotuloStatus[atual.status].classe}`}>
                  {rotuloStatus[atual.status].texto}
                </span>
              </div>
            )}
            {atual && (atual.status === 'PENDENTE' || atual.status === 'ATRASADO') && (
              <Link to="/familia/mensalidades" className="min-h-[52px] rounded-2xl bg-marca text-white font-bold flex items-center justify-center no-underline">
                Pagar com Pix
              </Link>
            )}
          </Cartao>
        )
      })}

      {comunicados.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2 className="text-base font-bold">Comunicados</h2>
          {comunicados.map((cm) => (
            <Cartao key={cm.id}>
              <p className="font-bold">{cm.titulo}</p>
              <p className="text-sm text-suave">{cm.conteudo}</p>
            </Cartao>
          ))}
        </section>
      )}

      <AvisosNoCelular modo="ajuste" texto="Saiba na hora quando chegar recado, comunicado, mensagem do hotelzinho ou confirmação de pagamento." />
    </div>
  )
}
