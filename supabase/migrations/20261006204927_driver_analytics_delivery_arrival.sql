-- Delivery punctuality measures the final delivery arrival, not the later
-- administrative completion/POD action. Old trips without attributable arrival
-- evidence stay unknown and are excluded from the measured percentage.
create index if not exists client_operations_delivery_analytics_idx
  on public.client_operations(company_id, load_id, actor_id, received_at)
  where status = 'accepted'
    and command_type in ('advance_driver_stage', 'transition_stop');

-- Patch only timing expressions so assignment pay, broker privacy, report-zone
-- buckets and deployed accounting rules retain their existing behavior.
do $migration$
declare
  definition text := pg_get_functiondef('public.get_driver_analytics(timestamptz,timestamptz)'::regprocedure);
  original text;
  replacement text;
begin
  original := 'delivery.appointment_to as delivery_to';
  if strpos(definition, original) = 0 then raise exception 'Unexpected analytics delivery projection'; end if;
  definition := replace(definition, original,
    'delivery.appointment_to as delivery_to, arrival.arrived_at as delivery_arrived_at');

  original := $old$      select appointment_from, appointment_to from public.load_stops
      where load_id = l.id and type = 'delivery' order by sequence desc limit 1
    ) delivery on true$old$;
  replacement := $new$      select id, appointment_from, appointment_to, count(*) over () as delivery_count
      from public.load_stops
      where load_id = l.id and type = 'delivery' order by sequence desc limit 1
    ) delivery on true
    left join lateral (
      select min(least(co.occurred_at, co.received_at)) as arrived_at
      from public.client_operations co
      where a.status = 'completed'
        and co.company_id = a.company_id and co.load_id = l.id
        and co.actor_id = a.driver_id and co.status = 'accepted'
        -- A reassignment/restore cannot reuse the preceding trip's evidence.
        and co.received_at >= a.assigned_at and co.received_at <= a.ended_at
        and co.occurred_at >= a.assigned_at
        and co.occurred_at <= co.received_at + interval '5 minutes'
        and (
          (co.command_type = 'advance_driver_stage'
            and co.payload->>'nextStage' = 'arrived_at_delivery'
            and co.result->>'stage' = 'arrived_at_delivery'
            and co.result->>'assignmentId' = a.id::text
            and (co.result->>'stopId' = delivery.id::text
              -- The former one-delivery workflow had no stopId in its result.
              -- Ambiguous legacy multi-stop events are deliberately unmeasured.
              or (co.result->>'stopId' is null and delivery.delivery_count = 1)))
          or (co.command_type = 'transition_stop'
            and co.payload->>'nextStatus' = 'arrived'
            and co.result->>'status' = 'arrived'
            and co.result->>'stopId' = delivery.id::text)
        )
    ) arrival on true$new$;
  if strpos(definition, original) = 0 then raise exception 'Unexpected analytics delivery join'; end if;
  definition := replace(definition, original, replacement);

  original := $old$      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
      )::integer as scheduled_count,
      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
          and ended_at <= coalesce(delivery_to, delivery_from)
      )::integer as on_time_count$old$;
  replacement := $new$      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
          and delivery_arrived_at is not null
      )::integer as scheduled_count,
      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
          and delivery_arrived_at is null
      )::integer as unmeasured_scheduled_count,
      count(*) filter (
        where coalesce(delivery_to, delivery_from) is not null
          and delivery_arrived_at <= coalesce(delivery_to, delivery_from)
      )::integer as on_time_count$new$;
  if strpos(definition, original) = 0 then raise exception 'Unexpected analytics on-time totals'; end if;
  definition := replace(definition, original, replacement);

  original := '''scheduledCount'', totals.scheduled_count,';
  if strpos(definition, original) = 0 then raise exception 'Unexpected analytics scheduled JSON'; end if;
  definition := replace(definition, original,
    original || E'\n    ''unmeasuredScheduledCount'', totals.unmeasured_scheduled_count,');
  execute definition;
end $migration$;

notify pgrst, 'reload schema';
