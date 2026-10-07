-- PDF facts already persist in loads.driver_brief. Expose a small operational
-- projection without giving a hidden-price driver the original PDF/quotes.
create or replace function private.driver_document_stop_details(brief jsonb, hidden boolean)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare result jsonb := '{}'::jsonb; field jsonb; field_key text;
  field_name text; value_text text; token text; allowed boolean;
begin
  if brief->>'version' is distinct from '1'
    or nullif(brief->>'reviewedAt','') is null
    or brief->'blockingFields' is distinct from '[]'::jsonb
    or jsonb_typeof(brief->'fields') is distinct from 'array' then return result; end if;
  for field in select value from jsonb_array_elements(brief->'fields') loop
    field_key := field->>'key'; field_name := regexp_replace(field_key, '^.*\.', '');
    if field_key !~ '^(stops\.[0-9]+|pickup|delivery)\.(scheduledDate|timePrinted|appointmentPrinted|hours|referenceNumber|appointmentReference|orderReferences|note|timingNote)$'
      or jsonb_typeof(field->'value') is distinct from 'string' then continue; end if;
    value_text := btrim(field->>'value');
    if value_text = '' then continue; end if;
    if hidden then
      -- Free text and quotes may contain rates, penalties and payment terms.
      -- Only constrained schedule/reference values cross this privacy boundary.
      if field_name in ('note','timingNote','orderReferences') then continue; end if;
      if field_name in ('referenceNumber','appointmentReference') then
        if value_text !~ '^[A-Za-z0-9#/_:.-]{1,120}$'
          or value_text ~* '(rate|price|usd|dollar|payment)' then continue; end if;
      else
        if length(value_text)>180 or value_text !~ '^[A-Za-z0-9[:space:]:/.,()–—-]+$'
          or value_text !~ '[0-9]' then continue; end if;
        allowed := true;
        for token in select regexp_split_to_table(lower(value_text), '[^a-z]+') loop
          if token <> '' and token <> all(array['appt','appointment','fcfs','am','pm','a','p','m',
            'to','at','from','on','by','between','and','until','local',
            'mon','monday','tue','tues','tuesday','wed','wednesday','thu','thur','thurs','thursday',
            'fri','friday','sat','saturday','sun','sunday',
            'jan','january','feb','february','mar','march','apr','april','may','jun','june',
            'jul','july','aug','august','sep','sept','september','oct','october','nov','november','dec','december',
            'et','est','edt','ct','cst','cdt','mt','mst','mdt','pt','pst','pdt','akst','akdt','hst','utc']) then
            allowed := false; exit;
          end if;
        end loop;
        if not allowed then continue; end if;
      end if;
    end if;
    result := result || jsonb_build_object(field_key, value_text);
  end loop;
  return result;
end $$;
revoke all on function private.driver_document_stop_details(jsonb,boolean) from public,anon,authenticated;

-- Keep the current read-only actor, assignment/tenant authorization and price
-- allowlist intact. Only extend the authorized row with operational facts.
do $migration$
declare definition text := pg_get_functiondef('public.get_driver_load_rows(uuid[])'::regprocedure);
  original text := 'return next result || jsonb_build_object(''broker_terms_hidden'',hidden);';
begin
  if strpos(definition, original)=0 then raise exception 'Unexpected driver load projection'; end if;
  execute replace(definition, original,
    'return next result || jsonb_build_object(''broker_terms_hidden'',hidden,
      ''driver_stop_details'',private.driver_document_stop_details(l.driver_brief,hidden));');
end $migration$;
notify pgrst, 'reload schema';
