-- Persist only operator-owned contact data and Google Place IDs.
-- Google Places phone/name/address values are fetched on demand and are not stored.

alter table public.load_stops
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_source text,
  add column if not exists contact_place_id text;

alter table public.load_stops
  drop constraint if exists load_stops_contact_source_check;

alter table public.load_stops
  add constraint load_stops_contact_source_check
  check (
    contact_source is null
    or contact_source in ('broker_document', 'dispatcher', 'manual')
  );

alter table public.loads
  add column if not exists broker_contact_name text,
  add column if not exists broker_phone text;

comment on column public.load_stops.contact_phone is
  'Operator-owned phone extracted from a broker document or entered manually; Google Places phone values are never persisted here.';

comment on column public.load_stops.contact_place_id is
  'Google Place ID only. Place IDs may be stored; other Google Places content is fetched on demand.';

