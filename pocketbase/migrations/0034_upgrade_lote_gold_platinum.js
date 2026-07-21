// Conversão em massa de ingressos GOLD -> PLATINUM a partir da planilha de
// vendas do produto "[Summit 2026] Upgrade Ingresso Gold para Platinum" (Guru,
// export de 2026-07-21, 60 vendas aprovadas). Rodada única — não é idempotente
// de propósito (se rodar 2x, tenta converter de novo; na 2ª vez não vai achar
// GOLD e vai criar PLATINUM extra). NÃO reexecutar sem revisar.
//
// Regra por linha do CSV (cada linha = 1 ação independente, mesmo com email
// repetido):
//   1. Casa o comprador por email; se não achar, tenta por documento (CPF/CNPJ,
//      só dígitos); se não achar nenhum, cria o comprador.
//   2. Busca o ingresso GOLD mais antigo desse comprador.
//      - Achou: vira PLATINUM. Se esse ingresso já tinha inac_id (já
//        credenciado na INAC como Gold), marca origem com a tag
//        "pending-inac-edit" pro endpoint de sync (/admin/sync-inac-upgrades)
//        processar depois (precisa de $http, que não existe em migration).
//      - Não achou: cria ingresso PLATINUM novo (status Pendente, pedido_id =
//        id da transação Guru) + link de participante (token de acesso ao
//        formulário), igual ao padrão usado em webhook_guru.js/admin_import_buyers.js.
//   3. Resultado inteiro vai pro log (console.log) como JSON, prefixado
//      "UPGRADE_LOTE_RESULTADO:" pra dar pra puxar via skip_cloud_list_logs
//      (source=hooks) depois de aplicar.

const ROWS = [
  {
    nome: 'Fernando Tavares Borges',
    email: 'owlinf@gmail.com',
    cpf: '05617321838',
    transacao: 'a249d58c-ca46-45b0-a109-9ed2de6144f2',
  },
  {
    nome: 'José Maria Ferrrira De Morais',
    email: 'jmmorais2010@gmail.com',
    cpf: '62262734887',
    transacao: 'a249d617-2b73-4ded-8d5b-ee862b53fa3f',
  },
  {
    nome: 'Juan Frate',
    email: 'juanjesusfamiliamengo@gmail.com',
    cpf: '16116665624',
    transacao: 'a249d61d-3d6d-473c-8066-9a4071d178f6',
  },
  {
    nome: 'Américo Murari',
    email: 'americo@cidsbc.com.br',
    cpf: '66243750868',
    transacao: 'a249d648-6aa3-4c97-91a2-ccd6d12cadf3',
  },
  {
    nome: 'Cristiane Lira Freire Garcia',
    email: 'clirafreire@gmail.com',
    cpf: '02905951770',
    transacao: 'a249d664-bc93-470d-8ac7-9bacd16d958d',
  },
  {
    nome: 'Ana Paula Martins Piumbini',
    email: 'appiumbini1994@gmail.com',
    cpf: '01699147710',
    transacao: 'a249d66f-aaba-47e7-ae1e-1639db394a3c',
  },
  {
    nome: 'Vinicius Giori Ferrao',
    email: 'viniciusgferrao@hotmail.com',
    cpf: '12573235718',
    transacao: 'a249d6b1-2bfd-4bf9-81e4-e43cc8084257',
  },
  {
    nome: 'Rogério Peres',
    email: 'rogeriolacerda1969@gmail.com',
    cpf: '08064544823',
    transacao: 'a249d6d2-6ca5-4302-8d75-384ac53f63b6',
  },
  {
    nome: 'Breno Carvalho De Paula',
    email: 'breno.paula@gmail.com',
    cpf: '03730110918',
    transacao: 'a249d6e9-383a-4b0e-8057-3a3c9350ccb3',
  },
  {
    nome: 'Uberman Antônio Lima',
    email: 'medvit@medvit.co',
    cpf: '01820959910',
    transacao: 'a249d70a-d5c7-4fcd-a2be-36a91443fb9b',
  },
  {
    nome: 'Maximiliano Avellar De Oliveira Machado',
    email: 'max@max.eti.br',
    cpf: '27176929831',
    transacao: 'a249d78a-b80c-441a-8817-f6793ad5c9fc',
  },
  {
    nome: 'Carlos Henrique Graciliano',
    email: 'chgraciliano@gmail.com',
    cpf: '66678576000110',
    transacao: 'a249d7af-f570-4d53-b17f-0fe87bf0ce8b',
  },
  {
    nome: 'Marcos Clayton De Oliveira',
    email: 'marcos.clayton@ampliarresultados.com.br',
    cpf: '11994786000126',
    transacao: 'a249d84b-874b-48b6-8ec9-6593fca37d4e',
  },
  {
    nome: 'Arnalberto Jacques Nunes Seixad',
    email: 'arnalbertojseixas@gmail.com',
    cpf: '65439570772',
    transacao: 'a249d8d9-8dd3-4a28-84a0-b4df5bca9cc9',
  },
  {
    nome: 'Charles Pádua',
    email: 'charles.a.j.padua@gmail.com',
    cpf: '73268615600',
    transacao: 'a249d944-d88a-4a5b-8698-be6b6312f131',
  },
  {
    nome: 'André Renault',
    email: 'andre@cgradvocacia.com.br',
    cpf: '05412020658',
    transacao: 'a249d96a-fc9b-4e0d-a18b-dabb4aaa9d8a',
  },
  {
    nome: 'Sara Gonçalves Rodrigues',
    email: 'saragrvet@gmail.com',
    cpf: '07330894613',
    transacao: 'a249d9ea-8a3d-4fa9-ba4f-47577d51760c',
  },
  {
    nome: 'Priscila Bentes',
    email: 'bentes@circuitoelegante.com.br',
    cpf: '06030981000104',
    transacao: 'a249dafb-98ca-4795-afed-b2a1c8261c62',
  },
  {
    nome: 'Gustavo Lordelo',
    email: 'gerenciafilialsp@gmail.com',
    cpf: '39397395882',
    transacao: 'a249db1c-7931-4757-8d18-4213bf8bba7a',
  },
  {
    nome: 'Leonardo Da Fonseca Queiroz',
    email: 'leonardofq@gmail.com',
    cpf: '85973416534',
    transacao: 'a249db9f-b7af-460b-bbe8-bfeefc3fabf7',
  },
  {
    nome: 'João Roberto Oliveira Souza',
    email: 'joaoaju@gmail.com',
    cpf: '40571815553',
    transacao: 'a249dc1d-0ea6-4fa1-b3d4-b83937c4f96a',
  },
  {
    nome: 'Diogenes Carvalho Lima',
    email: 'diogenescarvalholima@outlook.com.br',
    cpf: '08372302847',
    transacao: 'a249dc34-e0d0-4194-a08f-2e125ea018f3',
  },
  {
    nome: 'Marcos Lima',
    email: 'mlima.fal@gmail.com',
    cpf: '87235307234',
    transacao: 'a249dc84-98e3-48d5-bf66-98a03719c897',
  },
  {
    nome: 'João Victor Lima Santos',
    email: 'gerenciafilialsp@gmail.com',
    cpf: '90966694520',
    transacao: 'a249dcf8-c8ee-405b-ad61-1b766a03426e',
  },
  {
    nome: 'Mauro Dos Santos',
    email: 'mauro@automveiculos.com.br',
    cpf: '02291956876',
    transacao: 'a249de67-2799-4e84-9aba-469992022ace',
  },
  {
    nome: 'Giulianna Marega Marques',
    email: 'mmgiu@hotmail.com',
    cpf: '21764919807',
    transacao: 'a249dee5-3393-4cb3-826c-cd5b9691e7d2',
  },
  {
    nome: 'Henrique Theodoro',
    email: 'theodorosconsultoria@gmail.com',
    cpf: '33695198877',
    transacao: 'a249df33-ebd7-40ae-aab7-aec13a88230e',
  },
  {
    nome: 'Luiz Gustavo De Quadros',
    email: 'gustavo_quadros@hotmail.com',
    cpf: '30078939844',
    transacao: 'a249dff8-ebc8-4b03-9015-484d2b03f672',
  },
  {
    nome: 'Mauricio Melquiades De Araujo Silva',
    email: 'mauriciomelq@gmail.com',
    cpf: '70930384687',
    transacao: 'a249e138-513a-4f53-b4ca-65baa9f3fe6f',
  },
  {
    nome: 'Ismael Godoy',
    email: 'godoy@causo.digital',
    cpf: '39568197000103',
    transacao: 'a249e2f7-21ea-44f3-aa3d-a04b249c2f87',
  },
  {
    nome: 'Alexsandre Silva',
    email: 'jalexsandre@gmail.com',
    cpf: '51044277300',
    transacao: 'a249e722-ccb0-4129-9b51-522b74ec1e58',
  },
  {
    nome: 'Michel Perentelli Saravalle',
    email: 'saravalle.adv@gmail.com',
    cpf: '13570189830',
    transacao: 'a249e945-9f5f-4300-8d4a-d9f6b77411c3',
  },
  {
    nome: 'Andrea Peixoto',
    email: 'andrealimapeixoto@gmail.com',
    cpf: '72330562349',
    transacao: 'a249e94c-a56e-4ce8-9140-e97cbd17a330',
  },
  {
    nome: 'Celeste Oichenaz',
    email: 'oicele@icloud.com',
    cpf: '29945006000113',
    transacao: 'a249f5ed-b5f7-4c09-b407-80c10de55436',
  },
  {
    nome: 'Ernesto Fabiano',
    email: 'ernestofabiano27@gmail.com',
    cpf: '28833645835',
    transacao: 'a249f830-25ca-4300-8f87-c47341f4a344',
  },
  {
    nome: 'Renata Tavares',
    email: 'renatavares@proton.me',
    cpf: '72822120900',
    transacao: 'a24a0155-4557-402d-bf9f-769768c3fada',
  },
  {
    nome: 'Aldo Ramalho Neto',
    email: 'aldo@dp2engenharia.com.br',
    cpf: '21729133835',
    transacao: 'a24a0c0d-405e-4a88-a1b2-96c97dfe43e7',
  },
  {
    nome: 'João Sena',
    email: 'joaosena@senaequipamentos.com.br',
    cpf: '45019070297',
    transacao: 'a24a0e97-a4af-441d-b156-643cf5b29ca9',
  },
  {
    nome: 'Cristiano Paulo Tacca',
    email: 'drtacca@gmail.com',
    cpf: '94504857987',
    transacao: 'a24a1f11-b947-45f8-9bb1-1e299b72a6f8',
  },
  {
    nome: 'Roberto Mauricio Ferreira Ribeiro',
    email: 'rmfribeiro@gmail.com',
    cpf: '49213903715',
    transacao: 'a24a2569-6e5c-4c24-b9ce-155de28501f9',
  },
  {
    nome: 'Renan De',
    email: 'renan.sbr11@gmail.com',
    cpf: '13806605726',
    transacao: 'a24a400b-b4fb-4e81-b97f-32a47f523ebb',
  },
  {
    nome: 'Flávio Gomes Moreira Da Silva',
    email: 'flavio.gmsilva@outlook.com',
    cpf: '94009139153',
    transacao: 'a24a44af-acb8-4703-9364-e761c2446876',
  },
  {
    nome: 'Braulino Peixoto',
    email: 'braulinopeixoto@gmail.com',
    cpf: '96381213515',
    transacao: 'a24a4a29-fdbe-4f74-aeb1-fdb1ccd7ed30',
  },
  {
    nome: 'Robson Silva Franco',
    email: 'robsongv@gmail.com',
    cpf: '56067801604',
    transacao: 'a24a4e39-7f11-4aa7-984e-da51ea114c37',
  },
  {
    nome: 'Luís Tiarajú Brugnera',
    email: 'ltiaraju@uol.com.br',
    cpf: '70623040000',
    transacao: 'a24a4f34-a0d0-4a4d-8d3a-84b0c6242b69',
  },
  {
    nome: 'Kelsen De Oliveira Teixeira',
    email: 'kelsenteixeira@gmail.com',
    cpf: '02329193130',
    transacao: 'a24a8905-7700-4e16-97aa-51494fe57b5c',
  },
  {
    nome: 'Ivanildo Oliveira',
    email: 'ivanildo_junior@honda.com.br',
    cpf: '83121447220',
    transacao: 'a24a93c0-dfae-4581-b48d-34bc70898f8c',
  },
  {
    nome: 'Josafá Batista',
    email: 'josafabatista11@gmail.com',
    cpf: '39785130134',
    transacao: 'a24ae89f-f1a9-497f-b771-816b3a436c37',
  },
  {
    nome: 'Marcio Ferretti',
    email: 'm-ferretti@uol.com.br',
    cpf: '01415715785',
    transacao: 'a24af215-6838-4d91-8c55-9498e2032ee5',
  },
  {
    nome: 'Fabio Lima Bertholo',
    email: 'consultoriaberthead@gmail.com',
    cpf: '07700412723',
    transacao: 'a24bd5b4-fd08-479e-b90d-2a5981271656',
  },
  {
    nome: 'Alexandre Serejo',
    email: 'alex.serejo@gmail.com',
    cpf: '29682770149',
    transacao: 'a24bd6ee-7759-431e-aeaf-5c3a98d7aa1e',
  },
  {
    nome: 'Marcelo Lorena',
    email: 'marcelolorena.ml@gmail.com',
    cpf: '53589792000148',
    transacao: 'a24be121-d541-4806-94e0-d349790d5bde',
  },
  {
    nome: 'Thiago Lopes',
    email: 'lopesthiago0603@gmail.com',
    cpf: '34870278871',
    transacao: 'a24be172-a1ca-47ed-b28a-4bdd241d5542',
  },
  {
    nome: 'Leonardo Fernando De Sou',
    email: 'lfsrdev@gmail.com',
    cpf: '12215788712',
    transacao: 'a24beec8-a8a8-4eb8-a95c-91b7cbe10643',
  },
  {
    nome: 'Roberta Ming Gurgel',
    email: 'robertaming@gmail.com',
    cpf: '28821984850',
    transacao: 'a24bf8e3-8e12-4e52-a85c-587720e2161b',
  },
  {
    nome: 'Dione Aparecido Manfré Zeviani',
    email: 'dionezvi@hotmail.com',
    cpf: '03392606103',
    transacao: 'a24bf95e-546a-4176-ae91-41949c60a4ac',
  },
  {
    nome: 'Itamara Lucia Itagiba Neves',
    email: 'itamaralucia@icloud.com',
    cpf: '06452933850',
    transacao: 'a24bfe23-6233-47a2-a091-246ac60aa2ba',
  },
  {
    nome: 'Cleydi Kulesza',
    email: 'c.vendecomelas@gmail.com',
    cpf: '03305234903',
    transacao: 'a24c05b1-af9c-4964-aa80-b93128ccdb0b',
  },
  {
    nome: 'Tabata Bega',
    email: 'tcbega@gmail.com',
    cpf: '35425574800',
    transacao: 'a24c072d-63b6-4387-8bcb-f8e92f273b15',
  },
  {
    nome: 'Jeancarlo Silva De Mello',
    email: 'jeancarlomello@hotmail.com',
    cpf: '67392423053',
    transacao: 'a24e42d5-0baa-42d6-81da-085ec1649b7f',
  },
]

const BATCH_TAG = 'upgrade-lote-guru-2026-07-21'
const PENDING_EDIT_TAG = 'pending-inac-edit'

migrate(
  (app) => {
    const compradoresColl = app.findCollectionByNameOrId('compradores')
    const ingressosColl = app.findCollectionByNameOrId('ingressos')
    const linksColl = app.findCollectionByNameOrId('links_participante')

    const results = {
      convertidos: [],
      convertidos_precisa_inac_edit: [],
      criados: [],
      compradores_criados: [],
      erros: [],
    }

    for (const row of ROWS) {
      try {
        const email = (row.email || '').trim().toLowerCase()
        const cpf = (row.cpf || '').replace(/\D/g, '')
        const nome = (row.nome || '').trim()

        let comprador = null
        if (email) {
          try {
            comprador = app.findFirstRecordByData('compradores', 'email', email)
          } catch (_) {}
        }
        if (!comprador && cpf) {
          try {
            comprador = app.findFirstRecordByData('compradores', 'documento', cpf)
          } catch (_) {}
        }

        if (!comprador) {
          comprador = new Record(compradoresColl)
          comprador.set('email', email)
          comprador.set('documento', cpf)
          comprador.set('nome', nome)
          app.save(comprador)
          results.compradores_criados.push({ nome: nome, email: email, cpf: cpf })
        }

        const golds = app.findRecordsByFilter(
          'ingressos',
          'comprador_id = "' + comprador.id + '" && tipo_ingresso = "GOLD"',
          'created',
          1,
          0,
        )

        if (golds.length > 0) {
          const ingresso = golds[0]
          const pedidoId = ingresso.getString('pedido_id')
          const jaTemInac = !!ingresso.getString('inac_id')
          ingresso.set('tipo_ingresso', 'PLATINUM')
          if (jaTemInac) {
            const origemAtual = ingresso.getString('origem') || ''
            ingresso.set(
              'origem',
              origemAtual ? origemAtual + ';' + PENDING_EDIT_TAG : PENDING_EDIT_TAG,
            )
          }
          app.save(ingresso)

          const entry = {
            ingresso_id: ingresso.id,
            pedido_id: pedidoId,
            nome: nome,
            email: email,
            transacao: row.transacao,
          }
          if (jaTemInac) {
            results.convertidos_precisa_inac_edit.push(entry)
          } else {
            results.convertidos.push(entry)
          }
        } else {
          const ingresso = new Record(ingressosColl)
          ingresso.set('comprador_id', comprador.id)
          ingresso.set('pedido_id', row.transacao)
          ingresso.set('tipo_ingresso', 'PLATINUM')
          ingresso.set('status', 'Pendente')
          ingresso.set('status_webhook', 'pendente')
          ingresso.set('origem', BATCH_TAG)
          app.save(ingresso)

          const link = new Record(linksColl)
          link.set('ingresso_id', ingresso.id)
          link.set('token', $security.randomString(32))
          link.set('usado', false)
          const exp = new Date()
          exp.setFullYear(exp.getFullYear() + 1)
          link.set('expira_em', exp.toISOString())
          app.save(link)

          results.criados.push({
            ingresso_id: ingresso.id,
            pedido_id: row.transacao,
            nome: nome,
            email: email,
          })
        }
      } catch (err) {
        results.erros.push({
          nome: row.nome,
          email: row.email,
          transacao: row.transacao,
          erro: err && err.message ? err.message : String(err),
        })
      }
    }

    console.log('UPGRADE_LOTE_RESULTADO: ' + JSON.stringify(results))
  },
  (app) => {
    // Down intencionalmente vazio: reverter uma conversão em massa por dado
    // (não por schema) exigiria saber exatamente quais ingressos eram GOLD
    // antes — não dá pra inferir isso com segurança depois do fato. Reversão,
    // se necessário, é manual (via admin) usando o UPGRADE_LOTE_RESULTADO logado.
  },
)
