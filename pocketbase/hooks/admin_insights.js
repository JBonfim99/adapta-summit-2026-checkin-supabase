// Insights agregados do pré-credenciamento. Retorna SOMENTE contagens/médias
// (nenhum dado pessoal). Carrega participantes + ingressos e agrega em memória,
// no mesmo padrão de /admin/stats. Gated por auth de admin.
routerAdd(
  'GET',
  '/backend/v1/admin/insights',
  (e) => {
    try {
      const parts = $app.findRecordsByFilter('participantes', "id != ''", '', 100000, 0)
      const ings = $app.findRecordsByFilter('ingressos', "id != ''", '', 100000, 0)

      // participante_id -> tipo de ingresso e data de preenchimento
      const tipoByPart = {}
      const preenchidoByPart = {}
      for (let i = 0; i < ings.length; i++) {
        const ing = ings[i]
        const pid = ing.getString('participante_id')
        if (pid) {
          tipoByPart[pid] = ing.getString('tipo_ingresso')
          preenchidoByPart[pid] = ing.getString('preenchido_em') || ing.getString('created')
        }
      }

      const inc = (obj, key) => {
        if (!key) return
        obj[key] = (obj[key] || 0) + 1
      }

      const total = parts.length
      const perfil = { empresa: 0, profissional: 0 }
      const porTipo = { GOLD: 0, PLATINUM: 0 }
      const cargo = {}
      const segmento = {}
      const faturamento = {}
      const funcionarios = {}
      const usoDist = [0, 0, 0, 0, 0]
      const profDist = [0, 0, 0, 0, 0]
      const matriz = []
      for (let i = 0; i < 5; i++) matriz.push([0, 0, 0, 0, 0])
      let usoSum = 0
      let usoCount = 0
      let profSum = 0
      let profCount = 0
      const byTipo = {
        GOLD: { usoSum: 0, usoN: 0, profSum: 0, profN: 0 },
        PLATINUM: { usoSum: 0, usoN: 0, profSum: 0, profN: 0 },
      }

      // Detecção de ferramentas por palavra-chave (case-insensitive).
      const TOOLS = [
        ['ChatGPT', ['chatgpt', 'chat gpt', 'gpt-', 'gpt ', 'openai']],
        ['Claude', ['claude']],
        ['Gemini', ['gemini', 'bard']],
        ['Copilot', ['copilot']],
        ['Perplexity', ['perplexity']],
        ['Midjourney', ['midjourney']],
        ['n8n', ['n8n']],
        ['Make', ['make.com', 'integromat']],
        ['Zapier', ['zapier']],
        ['Notion AI', ['notion']],
        ['Canva', ['canva']],
        ['DALL-E', ['dall-e', 'dalle', 'dall e']],
        ['Sora', ['sora']],
        ['ElevenLabs', ['elevenlabs', 'eleven labs']],
        ['HeyGen', ['heygen']],
        ['Runway', ['runway']],
        ['Suno', ['suno']],
        ['Cursor', ['cursor']],
        ['Grok', ['grok']],
        ['Llama', ['llama']],
        ['Manus', ['manus']],
        ['Lovable', ['lovable']],
        ['Gamma', ['gamma']],
      ]
      const ferramentas = {}
      let semFerramenta = 0

      // Temas de desafio por palavra-chave.
      const THEMES = [
        [
          'Conhecimento / capacitação',
          [
            'conheci',
            'conhecer',
            'capacit',
            'aprend',
            'saber',
            'treina',
            'educa',
            'formaç',
            'qualific',
            'domínio',
            'dominio',
            'letramento',
          ],
        ],
        [
          'Equipe / cultura',
          [
            'equipe',
            'time',
            'pessoas',
            'colaborad',
            'cultura',
            'engaj',
            'mentalidade',
            'resistênc',
            'resistenc',
            'adesão',
            'adesao',
            'mudança',
            'mudanca',
          ],
        ],
        [
          'Custo / investimento',
          [
            'custo',
            'caro',
            'investim',
            'orçament',
            'orcament',
            'preço',
            'preco',
            'financ',
            'budget',
          ],
        ],
        ['Tempo / prioridade', ['tempo', 'priorid', 'rotina', 'agenda', 'foco']],
        ['Dados', ['dados', ' data', 'informaç', 'base de', 'qualidade dos dados']],
        [
          'Integração / tecnologia',
          [
            'integr',
            'sistema',
            'tecnolog',
            'implement',
            'técnic',
            'tecnic',
            'infra',
            'automa',
            'api',
          ],
        ],
        [
          'Confiança / segurança',
          [
            'seguranç',
            'seguranc',
            'privacid',
            'confia',
            'risco',
            'ética',
            'etica',
            'alucina',
            'lgpd',
          ],
        ],
        [
          'Por onde começar / aplicação',
          [
            'começar',
            'comecar',
            'por onde',
            'aplicar',
            'caso de uso',
            'onde usar',
            'onde aplicar',
            'aplicaç',
            'estratég',
            'estrateg',
          ],
        ],
      ]
      const desafios = {}

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]
        const temEmpresa = p.getBool('tem_empresa')
        if (temEmpresa) perfil.empresa++
        else perfil.profissional++

        const tipo = tipoByPart[p.id] || ''
        if (tipo === 'GOLD') porTipo.GOLD++
        else if (tipo === 'PLATINUM') porTipo.PLATINUM++

        if (temEmpresa) {
          inc(cargo, p.getString('cargo'))
          inc(faturamento, p.getString('faturamento_anual'))
          inc(funcionarios, p.getString('num_funcionarios'))
        }
        inc(segmento, p.getString('nicho'))

        const uso = parseInt(p.get('ia_uso_diario'), 10) || 0
        const prof = parseInt(p.get('ia_profundidade'), 10) || 0
        if (uso >= 1 && uso <= 5) {
          usoDist[uso - 1]++
          usoSum += uso
          usoCount++
        }
        if (prof >= 1 && prof <= 5) {
          profDist[prof - 1]++
          profSum += prof
          profCount++
        }
        if (uso >= 1 && uso <= 5 && prof >= 1 && prof <= 5) {
          matriz[uso - 1][prof - 1]++
        }
        if (tipo === 'GOLD' || tipo === 'PLATINUM') {
          if (uso >= 1 && uso <= 5) {
            byTipo[tipo].usoSum += uso
            byTipo[tipo].usoN++
          }
          if (prof >= 1 && prof <= 5) {
            byTipo[tipo].profSum += prof
            byTipo[tipo].profN++
          }
        }

        const ferr = (p.getString('ia_ferramentas') || '').toLowerCase()
        if (!ferr.trim()) {
          semFerramenta++
        } else {
          let matchedAny = false
          for (let t = 0; t < TOOLS.length; t++) {
            const name = TOOLS[t][0]
            const kws = TOOLS[t][1]
            for (let k = 0; k < kws.length; k++) {
              if (ferr.indexOf(kws[k]) !== -1) {
                inc(ferramentas, name)
                matchedAny = true
                break
              }
            }
          }
          if (!matchedAny) inc(ferramentas, 'Outros')
        }

        const des = (p.getString('ia_desafio') || '').toLowerCase()
        if (des.trim()) {
          for (let t = 0; t < THEMES.length; t++) {
            const name = THEMES[t][0]
            const kws = THEMES[t][1]
            for (let k = 0; k < kws.length; k++) {
              if (des.indexOf(kws[k]) !== -1) {
                inc(desafios, name)
                break
              }
            }
          }
        }
      }

      const porDia = {}
      for (let i = 0; i < parts.length; i++) {
        const d = preenchidoByPart[parts[i].id] || ''
        if (d) inc(porDia, String(d).substring(0, 10))
      }

      return e.json(200, {
        total,
        perfil,
        por_tipo: porTipo,
        cargo,
        segmento,
        faturamento,
        funcionarios,
        ia: {
          uso_dist: usoDist,
          prof_dist: profDist,
          uso_avg: usoCount ? usoSum / usoCount : 0,
          prof_avg: profCount ? profSum / profCount : 0,
          matriz,
          por_tipo: {
            GOLD: {
              uso_avg: byTipo.GOLD.usoN ? byTipo.GOLD.usoSum / byTipo.GOLD.usoN : 0,
              prof_avg: byTipo.GOLD.profN ? byTipo.GOLD.profSum / byTipo.GOLD.profN : 0,
            },
            PLATINUM: {
              uso_avg: byTipo.PLATINUM.usoN ? byTipo.PLATINUM.usoSum / byTipo.PLATINUM.usoN : 0,
              prof_avg: byTipo.PLATINUM.profN ? byTipo.PLATINUM.profSum / byTipo.PLATINUM.profN : 0,
            },
          },
        },
        ferramentas,
        sem_ferramenta: semFerramenta,
        desafios,
        por_dia: porDia,
      })
    } catch (err) {
      return e.badRequestError(err.message)
    }
  },
  $apis.requireAuth(),
)
