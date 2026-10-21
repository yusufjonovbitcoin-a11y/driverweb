-- Applied migration version matches Supabase's recorded history.
-- Receipts are operational evidence, independent of broker commercial access.
alter policy documents_driver_pay_privacy on public.documents
  using (document_type <> 'rate_confirmation' or not private.hide_broker_terms(load_id));

-- Preserve tenant, current-version, removal and upload-lease restrictions.
do $migration$
declare signature text; definition text; updated text;
begin
  foreach signature in array array[
    'private.hidden_driver_pay_file(text)',
    'private.driver_document_file_visible(text,uuid)',
    'private.document_review_checks(uuid)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    updated := replace(definition,
      'not in (''rate_confirmation'',''receipt'')', '<> ''rate_confirmation''');
    updated := replace(updated,
      'in (''rate_confirmation'',''receipt'')', '= ''rate_confirmation''');
    if updated = definition then
      raise exception 'Unexpected document privacy definition: %', signature;
    end if;
    execute updated;
  end loop;
end $migration$;
notify pgrst, 'reload schema';
