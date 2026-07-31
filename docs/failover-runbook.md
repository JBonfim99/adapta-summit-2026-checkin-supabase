# Runbook de failover

Objetivo: manter o Supabase atualizado com atraso inferior a 60 segundos e
ativar o fallback sem controlar as escritas do Skip ou duplicar comunicações.

## Operação normal

- O Skip é o sistema principal e continua aceitando escritas.
- O Supabase permanece com `mode=standby`.
- `external_effects_enabled` permanece `false`.
- SendGrid, BotConversa e INAC permanecem em `mock` até uma decisão operacional
  explícita.
- O Supabase Cron chama `sync-pull` a cada 30 segundos.
- O `dispatch-worker` pode continuar agendado, mas retorna sem reservar filas
  enquanto as comunicações estiverem bloqueadas.

## Bootstrap inicial

1. No Dashboard do Skip, clique em **Sincronizar Supabase**.
2. Aguarde a prévia terminar. O Skip somente serve páginas de até 100 registros;
   todo o staging é feito no Supabase.
3. Confira as contagens de `compradores`, `ingressos` e `participantes`.
4. Digite `IMPORTAR PARA O SUPABASE` e confirme.
5. Aguarde o bootstrap, a reprodução do outbox e a reconciliação.
6. Em **Sistema → Failover** no Admin do Supabase, confirme:
   - bootstrap `completed`;
   - backlog zero;
   - nenhum evento pendente ou com erro;
   - última consulta há menos de 90 segundos;
   - reconciliação há menos de 15 minutos.

O bootstrap não altera o modo do sistema e não libera comunicação externa.

## Ativação do fallback

1. Abra **Sistema → Failover** no Admin do Supabase.
2. Informe o motivo, digite `ATIVAR FALLBACK` e confirme.
3. O `admin-api` não envia comandos ao Skip e muda o Supabase para `active`
   somente após as verificações de saúde.
5. Valide login, ingressos, formulário, QR code, helpdesk e Dashboard.
6. Troque o domínio público apenas depois da validação operacional.

As comunicações ainda permanecem desabilitadas depois da ativação.

## Habilitação de comunicações

1. Mantenha SendGrid, BotConversa e INAC em `mock` durante a validação.
2. Altere os modos dos provedores somente pelo Dashboard/CLI do Supabase.
3. Confirme no Admin:
   - Supabase `active`;
   - outbox drenado;
   - sincronização saudável;
   - reconciliação recente.
4. Informe o motivo, digite `HABILITAR COMUNICACOES` e confirme.
5. Faça um envio canário e monitore `integration_attempts`.

O botão **Desabilitar comunicações** é de emergência e permanece disponível
enquanto os efeitos estiverem habilitados.

## Retorno ao standby

1. Desabilite as comunicações.
2. Confirme que não há operação externa em andamento.
3. No Admin, selecione **Voltar ao standby**.
4. O `admin-api` desabilita os efeitos. O Skip não é alterado.

Não replique dados produzidos no Supabase ativo de volta ao Skip sem um plano
explícito de merge e reconciliação.
