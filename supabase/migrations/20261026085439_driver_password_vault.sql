-- Password copies are encrypted by Supabase Vault, never stored in profile/audit JSON.
-- Only the service backend can call these narrow, actor-scoped functions.
create table private.driver_password_secrets (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  secret_id uuid not null unique references vault.secrets(id) on delete cascade,
  auth_fingerprint bytea not null check (octet_length(auth_fingerprint) = 32),
  updated_at timestamptz not null default now()
);
create index driver_password_secrets_company_idx on private.driver_password_secrets(company_id);
alter table private.driver_password_secrets enable row level security;
revoke all on private.driver_password_secrets from public, anon, authenticated, service_role;

create function private.cleanup_driver_password_vault_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
revoke all on function private.cleanup_driver_password_vault_entry() from public, anon, authenticated, service_role;
-- Also handles FK cascades (including company deletion) regardless of trigger order.
create trigger cleanup_driver_password_vault_entry after delete on private.driver_password_secrets
  for each row execute function private.cleanup_driver_password_vault_entry();

create function private.driver_password_company(p_actor uuid, p_driver uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  if auth.role() is distinct from 'service_role' or p_actor = p_driver then return null; end if;
  select company_id into v_company from public.profiles
    where id = p_actor and role = 'company_admin' and status = 'active' for share;
  if v_company is null then return null; end if;
  perform 1 from public.profiles where id = p_driver and company_id = v_company
    and role = 'driver' and status in ('active', 'suspended') for share;
  if not found then return null; end if;
  return v_company;
end;
$$;
revoke all on function private.driver_password_company(uuid,uuid) from public, anon, authenticated, service_role;

create function private.clear_driver_password_secret(p_driver uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  delete from private.driver_password_secrets where driver_id = p_driver returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
end;
$$;
revoke all on function private.clear_driver_password_secret(uuid) from public, anon, authenticated, service_role;

create function private.invalidate_driver_auth_password_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.clear_driver_password_secret(old.id);
    return old;
  end if;
  if new.encrypted_password is distinct from old.encrypted_password then
    perform private.clear_driver_password_secret(old.id);
  end if;
  return new;
end;
$$;
revoke all on function private.invalidate_driver_auth_password_secret() from public, anon, authenticated, service_role;
create trigger invalidate_driver_auth_password_secret
  before update of encrypted_password or delete on auth.users
  for each row execute function private.invalidate_driver_auth_password_secret();

create function private.invalidate_driver_profile_password_secret()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.clear_driver_password_secret(old.id);
    return old;
  end if;
  if new.company_id is distinct from old.company_id or new.role is distinct from old.role
    or new.status not in ('active', 'suspended') then
    perform private.clear_driver_password_secret(old.id);
  end if;
  return new;
end;
$$;
revoke all on function private.invalidate_driver_profile_password_secret() from public, anon, authenticated, service_role;
create trigger invalidate_driver_profile_password_secret
  before update of company_id, role, status or delete on public.profiles
  for each row execute function private.invalidate_driver_profile_password_secret();

create function public.store_driver_password_secret(p_actor uuid, p_driver uuid, p_password text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_hash text; v_secret uuid;
begin
  v_company := private.driver_password_company(p_actor, p_driver);
  if v_company is null or p_password is null or char_length(p_password) not between 6 and 128
    or btrim(p_password) = '' then return false; end if;
  -- Holding the Auth row prevents a concurrent reset from attaching an obsolete copy.
  select encrypted_password into v_hash from auth.users where id = p_driver for share;
  if v_hash is null or v_hash not like '$2%' or extensions.crypt(p_password, v_hash) is distinct from v_hash then return false; end if;
  perform private.clear_driver_password_secret(p_driver);
  v_secret := vault.create_secret(p_password, null, 'T Fleets managed driver login');
  insert into private.driver_password_secrets(driver_id,company_id,secret_id,auth_fingerprint)
    values(p_driver,v_company,v_secret,extensions.digest(v_hash,'sha256'));
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_company,p_actor,'driver.password_secret_saved','profile',p_driver,'{"source":"driver_settings"}'::jsonb);
  return true;
end;
$$;
revoke all on function public.store_driver_password_secret(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.store_driver_password_secret(uuid,uuid,text) to service_role;

create function public.read_driver_password_secret(p_actor uuid, p_driver uuid, p_reveal boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_hash text; v_saved private.driver_password_secrets%rowtype; v_password text;
begin
  v_company := private.driver_password_company(p_actor, p_driver);
  if v_company is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select encrypted_password into v_hash from auth.users where id = p_driver for share;
  select * into v_saved from private.driver_password_secrets where driver_id = p_driver and company_id = v_company;
  if not found then return jsonb_build_object('available',false); end if;
  if v_hash is null or v_saved.auth_fingerprint is distinct from extensions.digest(v_hash,'sha256') then
    perform private.clear_driver_password_secret(p_driver);
    return jsonb_build_object('available',false);
  end if;
  if not coalesce(p_reveal,false) then return jsonb_build_object('available',true,'updatedAt',v_saved.updated_at); end if;
  -- Audit failure rolls back the read. Never include plaintext, hash or ciphertext in audit.
  insert into public.audit_events(company_id,actor_id,action,entity_type,entity_id,metadata)
    values(v_company,p_actor,'driver.password_viewed','profile',p_driver,'{"source":"driver_settings"}'::jsonb);
  select decrypted_secret into v_password from vault.decrypted_secrets where id = v_saved.secret_id;
  if v_password is null then raise exception 'SECRET_UNAVAILABLE'; end if;
  return jsonb_build_object('available',true,'password',v_password,'updatedAt',v_saved.updated_at);
end;
$$;
revoke all on function public.read_driver_password_secret(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.read_driver_password_secret(uuid,uuid,boolean) to service_role;
