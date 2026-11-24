import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Campo, botaoPrincipal, botaoSecundario } from '../../components/Campos'
import { AvisosNoCelular } from '../../components/AvisosNoCelular'
import { InstalarApp } from '../../components/InstalarApp'
import { useAuth } from '../../lib/auth'
import { mensagemDeErro } from '../../lib/erros'
import { limparTexto } from '../../lib/pix'
import { supabase } from '../../lib/supabase'

/** Configurações da administração: dados do recebedor Pix e saída da conta. */
export function AdminMais() {
  const { usuario, sair } = useAuth()
  const [chave, setChave] = useState('')
  const [nome, setNome] = useState('')
  const [cidade, setCidade] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    supabase?.from('configuracao').select('pix_chave, pix_nome, pix_cidade').maybeSingle().then(({ data }) => {
      setChave(data?.pix_chave ?? ''); setNome(data?.pix_nome ?? ''); setCidade(data?.pix_cidade ?? '')
      setCarregando(false)
    })
  }, [])

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (chave.trim().length < 5) { setAviso({ tipo: 'erro', texto: 'Informe a chave Pix (CPF, CNPJ, e-mail, telefone ou chave aleatória).' }); return }
    if (!limparTexto(nome, 25) || !limparTexto(cidade, 15)) { setAviso({ tipo: 'erro', texto: 'Informe o nome do recebedor e a cidade.' }); return }
    setSalvando(true)
    const { error } = await supabase.from('configuracao').upsert({
      id: true, pix_chave: chave.trim(), pix_nome: limparTexto(nome, 25), pix_cidade: limparTexto(cidade, 15),
    })
    setSalvando(false)
    setAviso(error ? { tipo: 'erro', texto: mensagemDeErro(error)! } : { tipo: 'ok', texto: 'Dados do Pix salvos.' })
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Mais</h1>

      <InstalarApp />

      <nav className="flex flex-col gap-2.5" aria-label="Atalhos">
        {[
          ['/admin/mensagens', 'Mensagens das famílias', 'bg-ceu'],
          ['/admin/comunicados', 'Comunicados', 'bg-sol'],
          ['/admin/solicitacoes', 'Cadastros de famílias para aprovar', 'bg-folha'],
        ].map(([para, rotulo, cor]) => (
          <Link key={para} to={para} className="bg-white rounded-2xl p-4 flex items-center gap-3 no-underline text-tinta font-extrabold shadow-[0_2px_0_rgba(43,42,51,0.06)]">
            <span aria-hidden="true" className={`w-3 h-3 rounded-full ${cor}`} />
            <span className="flex-1">{rotulo}</span>
            <span aria-hidden="true" className="text-marca text-xl">›</span>
          </Link>
        ))}
      </nav>

      <AvisosNoCelular modo="ajuste" texto="Saiba na hora quando chegar cadastro de família, comprovante de Pix ou mensagem." />

      <section className="bg-white rounded-2xl p-4 flex flex-col gap-4">
        <div>
          <h2 className="font-bold">Recebimento por Pix</h2>
          <p className="text-xs text-suave">
            Estes dados montam o QR Code que as famílias usam para pagar. Confira com atenção:
            o dinheiro vai para a chave informada aqui.
          </p>
        </div>
        {aviso && (
          <p role={aviso.tipo === 'erro' ? 'alert' : 'status'}
            className={`rounded-xl p-3 text-sm font-semibold ${aviso.tipo === 'erro' ? 'bg-red-100 text-red-900' : 'bg-green-100 text-green-900'}`}>
            {aviso.texto}
          </p>
        )}
        {carregando ? <p className="text-suave">Carregando…</p> : (
          <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
            <Campo rotulo="Chave Pix" value={chave} onChange={(e) => setChave(e.target.value)} maxLength={77} autoComplete="off" />
            <Campo rotulo="Nome do recebedor" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={25}
              dica="Até 25 letras, sem acento. Aparece no banco de quem paga." />
            <Campo rotulo="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} maxLength={15} dica="Até 15 letras, sem acento." />
            <button type="submit" disabled={salvando} className={botaoPrincipal}>{salvando ? 'Salvando…' : 'Salvar dados do Pix'}</button>
          </form>
        )}
      </section>

      <section className="bg-white rounded-2xl p-4 flex flex-col gap-3">
        <h2 className="font-bold">Conta</h2>
        <p className="text-sm text-suave">Conectada como {usuario?.email}</p>
        <button onClick={sair} className={botaoSecundario}>Sair</button>
      </section>
    </div>
  )
}
