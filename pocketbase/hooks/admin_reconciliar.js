// ---------------------------------------------------------------------------
// RECONCILIAÇÃO de ingressos: compara, por comprador, o total de ingressos
// que ele TEM no nosso sistema com o total que ele DEVERIA ter segundo uma
// planilha de referência (ex: export do Guru). Só leitura — não altera nada.
// Processado em lotes vindos do frontend (tela /admin/reconciliar).
// ---------------------------------------------------------------------------
// Correção "esperado": produtos de UPGRADE (troca de categoria GOLD<->PLATINUM
// de um ingresso que a pessoa já tinha) contam como transação no Guru/CSV mas
// NÃO são ingresso novo — o CSV de referência infla o "esperado" em +1 (ou +2)
// pra quem fez upgrade. Snapshot tirado do warehouse (Nekt) em 2026-07-21,
// somando as transações aprovadas dos produtos:
//   "[Summit 2026] Upgrade Ingresso Gold para Platinum"
//   "ADAPTA SUMMIT 2026 - Platinum" + oferta contendo "Upgrade" (Upgrade - CX)
//   "ADAPTA SUMMIT 2026 - Gold" + oferta contendo "Upgrade"
//   "ADAPTA SUMMIT 2026 B2B" + oferta contendo "Upgrade"
// Se houver upgrades novos depois desta data, este mapa fica desatualizado —
// reconsultar o warehouse e regenerar caso a reconciliação seja rodada de novo
// bem mais tarde.
const UPGRADE_COUNT_POR_EMAIL = {
  'a.marim.n@hotmail.com': 1,
  'aa.araujojr@gmail.com': 1,
  'acborriero@gmail.com': 1,
  'adriano@ganbatte.org.br': 1,
  'aflenga@outlook.com': 1,
  'aldo@dp2engenharia.com.br': 1,
  'alex.serejo@gmail.com': 1,
  'alexanboyd@gmail.com': 1,
  'alineracanelli@hotmail.com': 1,
  'americo@cidsbc.com.br': 1,
  'anagondo@hotmail.com': 1,
  'andradewellington10@gmail.com': 1,
  'andre@cgradvocacia.com.br': 1,
  'andrealimapeixoto@gmail.com': 1,
  'appiumbini1994@gmail.com': 1,
  'arnalbertojseixas@gmail.com': 1,
  'bentes@circuitoelegante.com.br': 1,
  'boragaspar78@gmail.com': 1,
  'braulinopeixoto@gmail.com': 1,
  'breno.paula@gmail.com': 1,
  'brunocavalcante@gmail.com': 1,
  'c.vendecomelas@gmail.com': 1,
  'carlos.n.lopes@gmail.com': 1,
  'celio@boavistanet.com.br': 1,
  'cezarfernandes@yahoo.com.br': 1,
  'charles.a.j.padua@gmail.com': 1,
  'chgraciliano@gmail.com': 1,
  'claudia.stranguettiadvogados@gmail.com': 1,
  'clirafreire@gmail.com': 1,
  'consultoriaberthead@gmail.com': 1,
  'contabil@mutumcontabilidade.com.br': 1,
  'contato@tedi.com.vc': 1,
  'cristianozwiener@gmail.com': 1,
  'darassil@hotmail.com': 1,
  'diogenescarvalholima@outlook.com.br': 1,
  'diogo.f.martins@electrolux.com': 1,
  'dionezvi@hotmail.com': 1,
  'diretoria@protlarm.com.br': 1,
  'drtacca@gmail.com': 1,
  'dspinardi@hotmail.com': 1,
  'easssisjr@gmail.com': 1,
  'edgard.amaral@portnet.com.br': 1,
  'edgard.lamounier@vivaaiservices.com': 1,
  'edileu@gmail.com': 1,
  'ednaa.rosa@gmail.com': 1,
  'eduardo.teixeira0624@gmail.com': 1,
  'emerson@barsp.com.br': 1,
  'ernestofabiano27@gmail.com': 1,
  'eullergustavo@hotmail.com': 1,
  'f.alcantara91@gmail.com': 1,
  'fariaclayton82@gmail.com': 1,
  'fcandidogomes@gmail.com': 1,
  'financeiro@muralhablocos.com.br': 1,
  'fladimirex@hotmail.com': 1,
  'flavio.gmsilva@outlook.com': 1,
  'gabtilk@gmail.com': 1,
  'gerenciafilialsp@gmail.com': 2,
  'godoy@causo.digital': 1,
  'gubarusco@gmail.com': 1,
  'gustavo_quadros@hotmail.com': 1,
  'halphdiniz@mouradinizadvogados.com.br': 1,
  'helionakanishi@gmail.com': 1,
  'hlopes@grupobalo.com': 1,
  'ishibashi.diogo@gmail.com': 1,
  'italogfmedeiros@gmail.com': 1,
  'itamaralucia@icloud.com': 1,
  'ivanildo_junior@honda.com.br': 1,
  'ivo.pereira@ebam.com.br': 1,
  'jakeline.vitaconsultoria@gmail.com': 1,
  'jalexsandre@gmail.com': 1,
  'jaquesilvas@gmail.com': 1,
  'javier.raie@gmail.com': 1,
  'jeancarlomello@hotmail.com': 1,
  'jeduardo.goc@gmail.com': 1,
  'jercineide@clynea.com.br': 1,
  'jmmorais2010@gmail.com': 1,
  'joaoaju@gmail.com': 1,
  'joaoleopoldo.camaroto@gmail.com': 1,
  'joaomirandaau@gmail.com': 1,
  'joaosena@senaequipamentos.com.br': 1,
  'johhanes.costa@focoinfo.com.br': 1,
  'jorge@aplastec.com.br': 1,
  'josafabatista11@gmail.com': 1,
  'josepmn99@gmail.com': 1,
  'juanjesusfamiliamengo@gmail.com': 1,
  'juliananovich6@gmail.com': 1,
  'julio@dicorpo.com.br': 1,
  'ka.fscordeiro@gmail.com': 1,
  'karen@ganbatte.org.br': 1,
  'karinapaula1@yahoo.com.br': 1,
  'karoline.ruisedu@gmail.com': 1,
  'katcamargo@uol.com.br': 1,
  'kelsenteixeira@gmail.com': 1,
  'lahirecavallero@gmail.com': 1,
  'leno.johnleno@gmail.com': 1,
  'leonardofq@gmail.com': 1,
  'lezianagoveia@gmail.com': 1,
  'lfsrdev@gmail.com': 1,
  'lopesthiago0603@gmail.com': 1,
  'ltiaraju@uol.com.br': 1,
  'lucas@onhead.com.br': 1,
  'lucasmra@hotmail.com': 1,
  'lucassurian998@gmail.com': 1,
  'lucicomercionet@gmail.com': 1,
  'm-ferretti@uol.com.br': 1,
  'mabellisomi@gmail.com': 1,
  'maisvidaroo@gmail.com': 1,
  'marcelo-coelho@uol.com.br': 1,
  'marcelolorena.ml@gmail.com': 1,
  'marcio.stancato@gmail.com': 1,
  'marco.siqueira@hydro.com': 1,
  'marcorpsales@hotmail.com': 1,
  'marcos.clayton@ampliarresultados.com.br': 1,
  'marvinred@gmail.com': 1,
  'mauriciomelq@gmail.com': 1,
  'mauro@automveiculos.com.br': 1,
  'mauro@mma.net.br': 1,
  'max@max.eti.br': 1,
  'mcb@autorola.com.br': 1,
  'medvit@medvit.co': 1,
  'michaelpfranca@gmail.com': 1,
  'mkbsilva@gmail.com': 1,
  'mlima.fal@gmail.com': 1,
  'mmgiu@hotmail.com': 2,
  'natanivens90@gmail.com': 1,
  'natroce.propaganda@gmail.com': 1,
  'nelsonshigueto@gmail.com': 2,
  'netonatrielli@remax.com.br': 1,
  'netrezende@gmail.com': 1,
  'oicele@icloud.com': 1,
  'ostoupa@gmail.com': 1,
  'oswaldo@futuraengenhariapiracicaba.com.br': 1,
  'othon@flyton.com.br': 1,
  'owlinf@gmail.com': 1,
  'pablo.mendes@aunde.com': 1,
  'paulomarcelorayner@gmail.com': 1,
  'pedro@somosnoctua.com.br': 1,
  'pjconde77@gmail.com': 1,
  'rafaelcancado@yahoo.com': 1,
  'rafaelvazgomez@hotmail.com': 1,
  'randrade@pinhalense.com.br': 1,
  'reginaldo_ramires@outlook.com': 1,
  'renan.sbr11@gmail.com': 1,
  'renatavares@proton.me': 1,
  'renatoriobr@yahoo.com': 1,
  'ricardo.paiva@focoinfo.com.br': 1,
  'ricardorodriguesvip@gmail.com': 1,
  'rickslot.16@gmail.com': 1,
  'rmfribeiro@gmail.com': 1,
  'robertaming@gmail.com': 1,
  'roberto.pascoal@b2bcambio.com.br': 1,
  'robsongv@gmail.com': 1,
  'rodolpho.simao@gmail.com': 1,
  'rodrigo.baicere@hotmail.com': 1,
  'rodrigo@equilexip.com.br': 1,
  'rogeriolacerda1969@gmail.com': 1,
  'ronaldo@deskgraphics.com.br': 1,
  'sabrinacjc@gmail.com': 1,
  'samia.cruanes@gmail.com': 1,
  'saragrvet@gmail.com': 1,
  'saravalle.adv@gmail.com': 1,
  'setorfiscal2@mlcontab.com.br': 1,
  'solimar@sia.arq.br': 1,
  'tatianarigler@gmail.com': 1,
  'tcbega@gmail.com': 1,
  'thalita@blaxtream.com': 1,
  'theodorosconsultoria@gmail.com': 1,
  'thiago.pegas@etep.edu.br': 1,
  'thiagorl@hotmail.com': 1,
  'thyago.ramalho.trt@gmail.com': 1,
  'tonyrmcoutinho@gmail.com': 1,
  'ulisses@yellowgreenbr.com.br': 2,
  'vander@dominnare.com.br': 1,
  'viniciusgferrao@hotmail.com': 1,
}

routerAdd(
  'POST',
  '/backend/v1/admin/reconciliar-ingressos',
  (e) => {
    const body = e.requestInfo().body || {}
    const rows = Array.isArray(body.rows) ? body.rows : []

    const out = {
      classificacoes: { ok: 0, excesso: 0, faltando: 0, comprador_nao_encontrado: 0 },
      anomalias: [],
    }

    for (const row of rows) {
      const email = (row.email || '').toString().trim().toLowerCase()
      const cpf = (row.cpf || '').toString().replace(/\D/g, '')
      const nome = (row.nome || '').toString().trim()
      const categorias = (row.categorias || '').toString().trim()
      const esperadoBruto = parseInt(row.ingressos_esperado, 10) || 0
      const upgrades = UPGRADE_COUNT_POR_EMAIL[email] || 0
      const esperado = Math.max(0, esperadoBruto - upgrades)

      let comprador = null
      if (email) {
        try {
          comprador = $app.findFirstRecordByData('compradores', 'email', email)
        } catch (_) {}
      }
      if (!comprador && cpf) {
        try {
          comprador = $app.findFirstRecordByData('compradores', 'documento', cpf)
        } catch (_) {}
      }

      if (!comprador) {
        out.classificacoes.comprador_nao_encontrado++
        out.anomalias.push({
          nome: nome,
          email: email,
          cpf: cpf,
          categorias: categorias,
          esperado: esperado,
          atual: 0,
          classificacao: 'comprador_nao_encontrado',
          tickets: [],
        })
        continue
      }

      let tickets = []
      try {
        tickets = $app.findRecordsByFilter(
          'ingressos',
          'comprador_id = "' + comprador.id + '"',
          'created',
          50,
          0,
        )
      } catch (_) {
        tickets = []
      }

      const atual = tickets.length
      const delta = atual - esperado
      let classificacao = 'ok'
      if (delta > 0) classificacao = 'excesso'
      else if (delta < 0) classificacao = 'faltando'

      out.classificacoes[classificacao]++

      if (classificacao !== 'ok') {
        out.anomalias.push({
          nome: nome,
          email: email,
          cpf: cpf,
          categorias: categorias,
          comprador_id: comprador.id,
          esperado: esperado,
          atual: atual,
          delta: delta,
          classificacao: classificacao,
          tickets: tickets.map((t) => ({
            id: t.id,
            pedido_id: t.getString('pedido_id'),
            tipo_ingresso: t.getString('tipo_ingresso'),
            status: t.getString('status'),
            participante_id: t.getString('participante_id'),
            inac_id: t.getString('inac_id'),
            origem: t.getString('origem'),
            created: t.getString('created'),
          })),
        })
      }
    }

    return e.json(200, out)
  },
  $apis.requireAuth(),
)
