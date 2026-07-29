revoke execute on function public.create_helpdesk_credential(jsonb, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.delete_pending_ticket(text, text)
  from public, anon, authenticated;
revoke execute on function public.helpdesk_search(text)
  from public, anon, authenticated;
revoke execute on function public.process_guru_order(text, text, jsonb, jsonb, jsonb, text, text)
  from public, anon, authenticated;

grant execute on function public.create_helpdesk_credential(jsonb, text, text, text)
  to service_role;
grant execute on function public.delete_pending_ticket(text, text)
  to service_role;
grant execute on function public.helpdesk_search(text)
  to service_role;
grant execute on function public.process_guru_order(text, text, jsonb, jsonb, jsonb, text, text)
  to service_role;
