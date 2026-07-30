create or replace function public.create_admin_buyer_access_link(
  p_buyer_id text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer public.compradores;
  access_token text;
begin
  select id, nome, email
    into buyer
    from public.compradores
   where id = p_buyer_id;

  if buyer.id is null then
    raise exception using errcode = 'P0001', message = 'BUYER_NOT_FOUND';
  end if;

  access_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.tokens_acesso (comprador_id, token, expira_em)
  values (buyer.id, access_token, p_expires_at);

  insert into public.webhooks_log (
    evento,
    method,
    status,
    detalhe,
    payload,
    metadata
  ) values (
    'admin_link_acesso',
    'ADMIN',
    200,
    format('Link de acesso gerado no admin para %s (%s)', buyer.nome, buyer.email),
    jsonb_build_object('comprador_id', buyer.id, 'expira_em', p_expires_at)::text,
    jsonb_build_object('comprador_id', buyer.id, 'expira_em', p_expires_at)
  );

  return jsonb_build_object(
    'token', access_token,
    'email', buyer.email,
    'nome', buyer.nome,
    'expira_em', p_expires_at
  );
end;
$$;

revoke execute on function public.create_admin_buyer_access_link(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_admin_buyer_access_link(text, timestamptz)
  to service_role;
