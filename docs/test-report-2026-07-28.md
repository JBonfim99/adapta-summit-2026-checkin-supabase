# Relatorio de testes - 28/07/2026

## Resultado

| Suite | Resultado |
| --- | --- |
| Build Vite | Aprovado |
| Vitest | 7 testes aprovados |
| pgTAP | 68 testes aprovados |
| Matriz de rotas | 65 de 65 contratos representados |
| Migration do zero + seed | Aprovado |
| TypeScript | Aprovado |
| Lint | Aprovado, com 6 avisos de dependencias de hooks herdados |
| Edge Functions e worker | Aprovado |
| Token de comprador invalido | Aprovado |
| RLS, grants e varredura de segredos | Aprovado |
| `pg_cron` apos reset | Aprovado |
| Sete telas restauradas, sem erro de rota ou overflow | Aprovado |
| Carga reduzida | Aprovado |
| Carga completa | Aprovado |

## Carga completa local

- 10.000 ingressos.
- 500 compradores e sessoes de leitura concorrentes.
- 100 submissoes concorrentes.
- INAC em modo mock.
- 0 falhas de leitura.
- 0 falhas de escrita.
- p95 de leitura: 1.320 ms.
- p95 de escrita: 1.109 ms.

O proxy local encerrou conexoes em uma rajada anterior. A camada frontend foi
ajustada para repetir apenas requisicoes GET idempotentes; mutacoes continuam
sem retry automatico.

## Cobertura pgTAP

- existencia de tabelas e colunas;
- RLS em todas as tabelas;
- ausencia de grants para navegador;
- grants de `service_role`;
- constraints de tipo, CPF e e-mail;
- submissao atomica e link consumido;
- segunda submissao e duplicidade;
- sync duplicado e fora de ordem;
- tombstone;
- bloqueio de sync apos ativacao.
- seis tabelas de paridade, RLS e grants;
- cotas de cortesias;
- validade de convite do comprador em 24 horas;
- validade de convite administrativo em 30 dias;
- validade do link inicial em 1 ano;
- validade do link de visualizacao em 60 dias;
- importacao das quatro categorias;
- Guru idempotente;
- claims e conclusao das filas de e-mail e WhatsApp;
- sync das novas tabelas sem replicar `cron_health`.

## Pendente fora do ambiente local

- login e deploy na Vercel, adiado deliberadamente;
- autenticacao da Supabase CLI e deploy no projeto remoto;
- comparacao de contratos com o PocketBase de producao apos importar snapshot;
- canario real da INAC;
- ensaio de troca de dominio;
- medicao de RTO/RPO no ambiente hospedado.
