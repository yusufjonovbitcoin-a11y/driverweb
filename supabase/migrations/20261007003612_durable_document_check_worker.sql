-- The upload transaction already enqueues document.ai_check. Both foreground
-- requests and Cron use this lease, so a missed dispatch or crashed Edge worker
-- cannot strand a check, and late results cannot overwrite a newer attempt.
create function public.claim_document_check(worker_id text, target_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare job public.jobs; version public.document_versions; document public.documents;
  review public.document_checks;
begin
  if worker_id is null or length(worker_id) < 16 or length(worker_id) > 200 then raise exception 'Invalid worker lease'; end if;
  for job in select j.* from public.jobs j
    where j.type='document.ai_check'
      and (target_version_id is null or j.payload->>'documentVersionId'=target_version_id::text)
      and ((j.status in ('pending','failed') and j.available_at<=clock_timestamp())
        or (j.status='processing' and j.locked_at<clock_timestamp()-interval '2 minutes'))
    order by j.available_at,j.id for update skip locked limit 50 loop
    select * into version from public.document_versions where id::text=job.payload->>'documentVersionId';
    select * into document from public.documents where id=version.document_id;
    select * into review from public.document_checks where document_version_id=version.id
      order by created_at desc,id desc limit 1 for update;
    if version.id is null or document.id is null or review.id is null
      or version.company_id is distinct from job.company_id or document.company_id is distinct from job.company_id
      or review.company_id is distinct from job.company_id
      or document.load_id::text is distinct from job.payload->>'loadId'
      or document.current_version_id is distinct from version.id
      or version.superseded_at is not null or nullif(version.storage_path,'') is null
      or document.document_type='receipt'
      or not exists(select 1 from public.loads where id=document.load_id and company_id=job.company_id and trashed_at is null)
      or review.status in ('passed','warning','overridden') then
      update public.jobs set status='completed',locked_at=null,locked_by=null,last_error=null where id=job.id;
      continue;
    end if;
    if job.attempt_count>=job.max_attempts then
      update public.jobs set status='dead_letter',locked_at=null,locked_by=null,last_error='Document review attempts exhausted' where id=job.id;
      update public.document_checks set status='failed_to_read' where id=review.id and status='checking';
      continue;
    end if;
    update public.jobs set status='processing',locked_at=clock_timestamp(),locked_by=worker_id,
      attempt_count=attempt_count+1,last_error=null where id=job.id;
    update public.document_checks set status='checking' where id=review.id;
    return jsonb_build_object('jobId',job.id,'versionId',version.id,'checkId',review.id);
  end loop;
  return null;
end $$;
revoke all on function public.claim_document_check(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_document_check(text,uuid) to service_role;

create function public.finish_document_check(
  target_job_id uuid,worker_id text,check_id uuid,next_status public.document_check_status,
  confidence numeric,model_name text,result jsonb,warnings jsonb default '[]')
returns boolean language plpgsql security definer set search_path = '' as $$
declare job public.jobs; review public.document_checks;
begin
  select * into job from public.jobs where id=target_job_id for update;
  if job.id is null or job.type<>'document.ai_check' or job.status<>'processing'
    or job.locked_by is distinct from worker_id then return false; end if;
  select * into review from public.document_checks where id=check_id for update;
  if review.id is null or review.document_version_id::text is distinct from job.payload->>'documentVersionId'
    or review.company_id is distinct from job.company_id then raise exception 'Invalid document check lease'; end if;
  if review.status in ('passed','warning','overridden') then
    update public.jobs set status='completed',locked_at=null,locked_by=null,last_error=null where id=job.id;
    return false;
  end if;
  if next_status not in ('passed','warning','failed_to_read') then raise exception 'Invalid review result'; end if;
  perform public.record_document_check(check_id,next_status,confidence,model_name,result,warnings);
  update public.jobs set
    status=case when next_status<>'failed_to_read' then 'completed'::public.job_status
      when attempt_count>=max_attempts then 'dead_letter'::public.job_status else 'failed'::public.job_status end,
    locked_at=null,locked_by=null,
    last_error=case when next_status='failed_to_read' then 'Document review temporarily unavailable' else null end,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(attempt_count-1,6)))::integer)
    where id=job.id;
  return true;
end $$;
revoke all on function public.finish_document_check(uuid,text,uuid,public.document_check_status,numeric,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_document_check(uuid,text,uuid,public.document_check_status,numeric,text,jsonb,jsonb) to service_role;

-- Preserve the existing credential-safe synchronous transport. This migration
-- neither provisions a secret nor enables a schedule (both require deployment).
alter table worker_cron.last_invocations drop constraint last_invocations_worker_check;
alter table worker_cron.last_invocations add constraint last_invocations_worker_check check(worker in ('push','media','document'));
do $$
declare definition text; marker text := '    else' || chr(10) || '      raise exception ''Unknown scheduled worker'';';
begin
  select pg_get_functiondef('worker_cron.invoke(text)'::regprocedure) into definition;
  if strpos(definition,marker)=0 then raise exception 'Unexpected Cron invocation definition'; end if;
  definition := replace(definition,marker,
    '    when ''document'' then' || chr(10) || '      secret_name := ''document_check_cron_token'';' || chr(10) ||
    '      endpoint := ''check-load-document'';' || chr(10) || marker);
  execute definition;
end $$;
