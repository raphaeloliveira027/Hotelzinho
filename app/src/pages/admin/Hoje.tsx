import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Folha } from '../../components/Folha'
import { useAuth } from '../../lib/auth'
import {
  dataISO, dataPorExtenso, ehFimDeSemana, horaAgora, horaCurta, horaDeInstante, instanteHoje, intervaloDoDia,
} from '../../lib/datas'
import { mensagemDeErro } from '../../lib/erros'
import { Avatar } from '../../components/Enfeites'
import { supabase } from '../../lib/supabase'

// ---------------------------------------------------------------------
// Tipos dos dados desta tela
// ---------------------------------------------------------------------
type Turno = 'MANHA' | 'TARDE' | 'INTEGRAL'
type TipoRotina = 'REFEICAO' | 'SONO' | 'ATIVIDADE' | 'OBSERVACAO' | 'OCORRENCIA' | 'RECADO'

type Autorizado = { id: number; nome: string; parentesco: string }

type CriancaDia = {
  id: number
  nome_completo: string
  alergias: string | null
  restricoes_alimentares: string | null
  plano: { nome: string; turno: Turno } | null
  crianca_responsavel: { autorizado_buscar: boolean; parentesco: string; responsavel: { id: number; nome: string } | null }[]
}

type Presenca = {
  id: number
  crianca_id: number
  hora_entrada: string
  hora_saida: string | null
  buscado_por_id: number | null
  buscado_por_nome: string | null
}

type Registro = {
  id: number
  crianca_id: number
  tipo: TipoRotina
  inicio: string
  descricao: string
  visivel_pais: boolean
}

const TIPOS: { valor: TipoRotina; rotulo: string; exemplo: string }[] = [
  { valor: 'REFEICAO', rotulo: 'Refeição', exemplo: 'Ex.: almoço — arroz, feijão, frango e cenoura.' },
  { valor: 'SONO', rotulo: 'Sono', exemplo: 'Ex.: soneca depois do almoço.' },
  { valor: 'ATIVIDADE', rotulo: 'Atividade', exemplo: 'Ex.: pintura com guache no quintal.' },
  { valor: 'OBSERVACAO', rotulo: 'Observação', exemplo: 'Ex.: estava mais quietinha hoje.' },
  { valor: 'OCORRENCIA', rotulo: 'Ocorrência', exemplo: 'Ex.: bateu o joelho no parquinho; colocamos gelo.' },
  { valor: 'RECADO', rotulo: 'Recado', exemplo: 'Ex.: mandar uma muda de roupa amanhã.' },
]
const rotuloTipo = (t: TipoRotina) => TIPOS.find((x) => x.valor === t)?.rotulo ?? t

const FILTROS: { valor: 'TODOS' | Turno; rotulo: string }[] = [
  { valor: 'TODOS', rotulo: 'Todos' },
  { valor: 'MANHA', rotulo: 'Manhã' },
  { valor: 'TARDE', rotulo: 'Tarde' },
  { valor: 'INTEGRAL', rotulo: 'Integral' },
]

const chip = (ativo: boolean) =>
  `min-h-[40px] px-3.5 rounded-full text-sm font-bold border-[1.5px] ${
    ativo ? 'bg-marca text-white border-marca' : 'bg-white text-tinta border-stone-300'}`

/** Situação da criança hoje, calculada a partir da presença. */
function situacao(p: Presenca | undefined, turno: Turno | undefined) {
  if (p?.hora_saida) return { texto: `Saiu ${horaCurta(p.hora_saida)}`, classe: 'bg-stone-200 text-stone-700', chave: 'saiu' as const }
  if (p) return { texto: `Chegou ${horaCurta(p.hora_entrada)}`, classe: 'bg-green-100 text-green-900', chave: 'presente' as const }
  if (turno === 'TARDE' && new Date().getHours() < 12)
    return { texto: 'Chega à tarde', classe: 'bg-indigo-100 text-indigo-900', chave: 'aguardando' as const }
  return { texto: 'Aguardando', classe: 'bg-amber-100 text-amber-900', chave: 'aguardando' as const }
}

// =====================================================================
// Tela "Hoje" da administração
// =====================================================================
export function AdminHoje() {
  const { usuario } = useAuth()
  const [criancas, setCriancas] = useState<CriancaDia[] | null>(null)
  const [presencas, setPresencas] = useState<Presenca[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
  const [feriado, setFeriado] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<'TODOS' | Turno>('TODOS')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<number | null>(null)
  const [saidaDe, setSaidaDe] = useState<CriancaDia | null>(null)
  const [registroDe, setRegistroDe] = useState<CriancaDia | null>(null)

  const hoje = dataISO()

  const carregar = useCallback(async () => {
    if (!supabase) return
    const { ini, fim } = intervaloDoDia()
    const [rC, rP, rR, rF] = await Promise.all([
      supabase.from('crianca')
        .select('id, nome_completo, alergias, restricoes_alimentares, plano(nome, turno), crianca_responsavel(autorizado_buscar, parentesco, responsavel(id, nome))')
        .in('status', ['ATIVA', 'EM_ADAPTACAO'])
        .order('nome_completo'),
      supabase.from('presenca').select('id, crianca_id, hora_entrada, hora_saida, buscado_por_id, buscado_por_nome').eq('data', hoje),
      supabase.from('registro_rotina').select('id, crianca_id, tipo, inicio, descricao, visivel_pais')
        .gte('inicio', ini).lt('inicio', fim).order('inicio', { ascending: false }),
      supabase.from('feriado').select('descricao').eq('data', hoje).maybeSingle(),
    ])
    if (rC.error || rP.error || rR.error) {
      setAviso({ tipo: 'erro', texto: 'Não foi possível carregar a lista de hoje.' })
      setCriancas([])
      return
    }
    setCriancas(rC.data as unknown as CriancaDia[])
    setPresencas(rP.data as Presenca[])
    setRegistros(rR.data as Registro[])
    setFeriado((rF.data as { descricao: string } | null)?.descricao ?? null)
  }, [hoje])

  useEffect(() => { carregar() }, [carregar])

  const presencaDe = useMemo(() => new Map(presencas.map((p) => [p.crianca_id, p])), [presencas])
  const registrosDe = (id: number) => registros.filter((r) => r.crianca_id === id)

  const fechado = ehFimDeSemana() ? 'Hoje é fim de semana: o hotelzinho não funciona.'
    : feriado ? `Hoje é feriado (${feriado}): o hotelzinho não funciona.` : null

  const lista = (criancas ?? []).filter((c) => filtro === 'TODOS' || c.plano?.turno === filtro)
  const presentes = presencas.filter((p) => !p.hora_saida).length

  // ---- Ações -------------------------------------------------------
  const registrarEntrada = async (c: CriancaDia) => {
    if (!supabase) return
    setOcupado(c.id)
    const { error } = await supabase.from('presenca')
      .insert({ crianca_id: c.id, data: hoje, hora_entrada: horaAgora() })
    setOcupado(null)
    if (error) { setAviso({ tipo: 'erro', texto: mensagemDeErro(error)! }); return }
    setAviso({ tipo: 'ok', texto: `Entrada de ${c.nome_completo.split(' ')[0]} registrada às ${horaAgora()}.` })
    carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-suave first-letter:uppercase">{dataPorExtenso()} · aberto das 6h às 18h</p>
        <h1 className="text-2xl font-bold">Hoje</h1>
      </header>

      {aviso && (
        <div role={aviso.tipo === 'erro' ? 'alert' : 'status'}
          className={`rounded-xl p-3 text-sm font-semibold flex justify-between items-center gap-2 ${
            aviso.tipo === 'erro' ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`}>
          <span>{aviso.texto}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar aviso" className="min-w-[44px] min-h-[44px] -my-2">✕</button>
        </div>
      )}

      {fechado && <p className="rounded-xl bg-indigo-100 text-indigo-900 p-3 text-sm font-semibold">{fechado}</p>}

      <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filtrar por turno">
        {FILTROS.map((f) => (
          <button key={f.valor} onClick={() => setFiltro(f.valor)} aria-pressed={filtro === f.valor} className={chip(filtro === f.valor)}>
            {f.rotulo}
          </button>
        ))}
      </div>

      {criancas === null ? <p className="text-suave">Carregando…</p> : (
        <p className="text-sm text-suave">
          Presentes agora: <strong className="text-tinta">{presentes}</strong> de {criancas.length}
        </p>
      )}

      {criancas?.length === 0 && (
        <p className="bg-white rounded-2xl p-4 text-suave">
          Nenhuma criança ativa. Cadastre em <Link to="/admin/criancas">Crianças</Link>.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {lista.map((c) => {
          const p = presencaDe.get(c.id)
          const s = situacao(p, c.plano?.turno)
          const doDia = registrosDe(c.id)
          const cuidado = [c.alergias && `Alergia: ${c.alergias}`, c.restricoes_alimentares && `Restrição: ${c.restricoes_alimentares}`]
            .filter(Boolean).join(' · ')
          return (
            <li key={c.id} className="bg-white rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex justify-between items-center gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar id={c.id} nome={c.nome_completo} />
                  <div className="min-w-0">
                    <p className="font-bold truncate">{c.nome_completo}</p>
                    <p className="text-xs text-suave">{c.plano?.nome ?? 'Sem plano'}</p>
                  </div>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${s.classe}`}>{s.texto}</span>
              </div>

              {cuidado && <p className="text-xs font-semibold text-alerta">{cuidado}</p>}

              {doDia.length > 0 && (
                <p className="text-sm text-suave">
                  {doDia.length} registro{doDia.length > 1 ? 's' : ''} hoje · último: {rotuloTipo(doDia[0].tipo)} às {horaDeInstante(doDia[0].inicio)}
                </p>
              )}

              {!fechado && s.chave === 'aguardando' && (
                <button onClick={() => registrarEntrada(c)} disabled={ocupado === c.id}
                  className="min-h-[44px] rounded-xl bg-marca text-white text-sm font-bold disabled:opacity-60">
                  {ocupado === c.id ? 'Registrando…' : 'Registrar entrada'}
                </button>
              )}
              {!fechado && s.chave === 'presente' && (
                <div className="flex gap-2">
                  <button onClick={() => setRegistroDe(c)}
                    className="flex-1 min-h-[44px] rounded-xl border-[1.5px] border-marca text-marca text-sm font-bold bg-white">
                    + Registro
                  </button>
                  <button onClick={() => setSaidaDe(c)}
                    className="flex-1 min-h-[44px] rounded-xl border-[1.5px] border-stone-300 text-tinta text-sm font-bold bg-white">
                    Registrar saída
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <FolhaSaida
        crianca={saidaDe}
        presenca={saidaDe ? presencaDe.get(saidaDe.id) : undefined}
        aoFechar={() => setSaidaDe(null)}
        aoSalvar={(texto) => { setSaidaDe(null); setAviso({ tipo: 'ok', texto }); carregar() }}
      />
      <FolhaRegistro
        crianca={registroDe}
        usuarioId={usuario?.id ?? ''}
        aoFechar={() => setRegistroDe(null)}
        aoSalvar={(texto) => { setRegistroDe(null); setAviso({ tipo: 'ok', texto }); carregar() }}
      />
    </div>
  )
}

// =====================================================================
// Saída: escolher quem buscou (só autorizados, ou outra pessoa com aviso)
// =====================================================================
function FolhaSaida({ crianca, presenca, aoFechar, aoSalvar }: {
  crianca: CriancaDia | null
  presenca: Presenca | undefined
  aoFechar: () => void
  aoSalvar: (mensagem: string) => void
}) {
  const [quem, setQuem] = useState<string>('')
  const [outroNome, setOutroNome] = useState('')
  const [hora, setHora] = useState(horaAgora())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const autorizados: Autorizado[] = (crianca?.crianca_responsavel ?? [])
    .filter((v) => v.autorizado_buscar && v.responsavel)
    .map((v) => ({ id: v.responsavel!.id, nome: v.responsavel!.nome, parentesco: v.parentesco }))

  useEffect(() => { setQuem(''); setOutroNome(''); setHora(horaAgora()); setErro(null) }, [crianca])

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !presenca || !crianca) return
    if (!quem) { setErro('Escolha quem veio buscar.'); return }
    if (quem === 'outro' && outroNome.trim().length < 3) { setErro('Escreva o nome de quem veio buscar.'); return }
    if (hora <= horaCurta(presenca.hora_entrada)) { setErro('A saída precisa ser depois da entrada.'); return }
    setSalvando(true)
    const { error } = await supabase.from('presenca').update({
      hora_saida: hora,
      buscado_por_id: quem === 'outro' ? null : Number(quem),
      buscado_por_nome: quem === 'outro' ? outroNome.trim() : null,
    }).eq('id', presenca.id)
    setSalvando(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoSalvar(`Saída de ${crianca.nome_completo.split(' ')[0]} registrada às ${hora}.`)
  }

  return (
    <Folha titulo={`Saída · ${crianca?.nome_completo ?? ''}`} aberta={!!crianca} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold mb-2">Quem veio buscar?</legend>
          {autorizados.length === 0 && <p className="text-sm text-suave">Nenhuma pessoa autorizada cadastrada.</p>}
          {autorizados.map((a) => (
            <label key={a.id} className="flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-stone-300">
              <input type="radio" name="quem" value={a.id} checked={quem === String(a.id)}
                onChange={(e) => setQuem(e.target.value)} className="w-5 h-5 accent-marca" />
              <span><strong>{a.nome}</strong> <span className="text-suave text-sm">· {a.parentesco}</span></span>
            </label>
          ))}
          <label className="flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-stone-300">
            <input type="radio" name="quem" value="outro" checked={quem === 'outro'}
              onChange={(e) => setQuem(e.target.value)} className="w-5 h-5 accent-marca" />
            <span>Outra pessoa</span>
          </label>
        </fieldset>

        {quem === 'outro' && (
          <>
            <p role="alert" className="rounded-xl bg-orange-100 text-orange-900 p-3 text-sm font-semibold">
              Esta pessoa não está autorizada no cadastro. Confirme com a família antes de entregar a criança.
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Nome de quem veio buscar
              <input value={outroNome} onChange={(e) => setOutroNome(e.target.value)} maxLength={150}
                className="h-12 px-3.5 rounded-xl border border-stone-300 font-normal" />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Horário da saída
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} required
            className="h-12 px-3.5 rounded-xl border border-stone-300 font-normal" />
        </label>

        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" disabled={salvando} className="min-h-[52px] rounded-2xl bg-marca text-white font-bold disabled:opacity-60">
          {salvando ? 'Salvando…' : 'Confirmar saída'}
        </button>
      </form>
    </Folha>
  )
}

// =====================================================================
// Novo registro de rotina
// =====================================================================
function FolhaRegistro({ crianca, usuarioId, aoFechar, aoSalvar }: {
  crianca: CriancaDia | null
  usuarioId: string
  aoFechar: () => void
  aoSalvar: (mensagem: string) => void
}) {
  const [tipo, setTipo] = useState<TipoRotina>('REFEICAO')
  const [inicio, setInicio] = useState(horaAgora())
  const [fim, setFim] = useState('')
  const [aceitacao, setAceitacao] = useState<'TUDO' | 'PARTE' | 'RECUSOU' | ''>('')
  const [descricao, setDescricao] = useState('')
  const [visivel, setVisivel] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    setTipo('REFEICAO'); setInicio(horaAgora()); setFim(''); setAceitacao('')
    setDescricao(''); setVisivel(true); setErro(null)
  }, [crianca])

  const escolherTipo = (t: TipoRotina) => {
    setTipo(t)
    // Observação começa como interna; o resto aparece para a família
    setVisivel(t !== 'OBSERVACAO')
  }

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase || !crianca) return
    if (descricao.trim().length === 0) { setErro('Escreva uma descrição.'); return }
    if (tipo === 'SONO' && fim && fim <= inicio) { setErro('O fim do sono precisa ser depois do início.'); return }
    setSalvando(true)
    const { error } = await supabase.from('registro_rotina').insert({
      crianca_id: crianca.id,
      tipo,
      inicio: instanteHoje(inicio),
      fim: tipo === 'SONO' && fim ? instanteHoje(fim) : null,
      descricao: descricao.trim(),
      aceitacao: tipo === 'REFEICAO' && aceitacao ? aceitacao : null,
      visivel_pais: visivel,
      registrado_por: usuarioId,
    })
    setSalvando(false)
    if (error) { setErro(mensagemDeErro(error)); return }
    aoSalvar(visivel
      ? `${rotuloTipo(tipo)} registrada. A família já pode ver.`
      : `${rotuloTipo(tipo)} registrada só para a administração.`)
  }

  const info = TIPOS.find((t) => t.valor === tipo)!

  return (
    <Folha titulo={`Novo registro · ${crianca?.nome_completo ?? ''}`} aberta={!!crianca} aoFechar={aoFechar}>
      <form onSubmit={salvar} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de registro">
          {TIPOS.map((t) => (
            <button type="button" key={t.valor} onClick={() => escolherTipo(t.valor)}
              aria-pressed={tipo === t.valor} className={chip(tipo === t.valor)}>
              {t.rotulo}
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <label className="flex-1 flex flex-col gap-1.5 text-sm font-semibold">
            {tipo === 'SONO' ? 'Dormiu às' : 'Horário'}
            <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} required
              className="h-12 px-3.5 rounded-xl border border-stone-300 font-normal" />
          </label>
          {tipo === 'SONO' && (
            <label className="flex-1 flex flex-col gap-1.5 text-sm font-semibold">
              Acordou às
              <input type="time" value={fim} onChange={(e) => setFim(e.target.value)}
                className="h-12 px-3.5 rounded-xl border border-stone-300 font-normal" />
            </label>
          )}
        </div>

        {tipo === 'REFEICAO' && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold mb-2">Como comeu?</legend>
            <div className="flex gap-2">
              {([['TUDO', 'Tudo'], ['PARTE', 'Parte'], ['RECUSOU', 'Recusou']] as const).map(([v, r]) => (
                <button type="button" key={v} onClick={() => setAceitacao(v)} aria-pressed={aceitacao === v}
                  className={`flex-1 ${chip(aceitacao === v)}`}>{r}</button>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Descrição
          <textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={1000}
            placeholder={info.exemplo}
            className="px-3.5 py-2.5 rounded-xl border border-stone-300 font-normal resize-none" />
        </label>

        {tipo === 'OCORRENCIA' && visivel && (
          <p className="rounded-xl bg-orange-100 text-orange-900 p-3 text-sm">A família recebe um aviso assim que você salvar.</p>
        )}

        <label className="flex items-center gap-3 min-h-[44px] text-sm">
          <input type="checkbox" checked={visivel} onChange={(e) => setVisivel(e.target.checked)} className="w-5 h-5 accent-marca" />
          Visível para a família
        </label>

        {erro && <p role="alert" className="text-sm font-semibold text-red-800">{erro}</p>}
        <button type="submit" disabled={salvando} className="min-h-[52px] rounded-2xl bg-marca text-white font-bold disabled:opacity-60">
          {salvando ? 'Salvando…' : 'Salvar registro'}
        </button>
      </form>
    </Folha>
  )
}
