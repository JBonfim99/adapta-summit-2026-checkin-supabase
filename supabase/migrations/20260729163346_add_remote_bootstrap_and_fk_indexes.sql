-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

INSERT INTO public.cron_health (id)
VALUES ('dispatch')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE INDEX cortesias_comprador_id_idx ON public.cortesias (comprador_id);

CREATE INDEX envios_participante_id_idx ON public.envios (participante_id);

CREATE INDEX envios_comprador_id_idx ON public.envios (comprador_id);

CREATE INDEX integration_attempts_participant_idx ON public.integration_attempts (participant_id);

CREATE INDEX pedidos_guru_comprador_id_idx ON public.pedidos_guru (comprador_id);

CREATE INDEX sync_tombstones_event_id_idx ON public.sync_tombstones (event_id);

CREATE INDEX system_state_activated_by_idx ON public.system_state (activated_by);
