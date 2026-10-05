# Chat worker Cron

Dedicated Edge Secrets `PUSH_CRON_TOKEN` and `MEDIA_CLEANUP_CRON_TOKEN`
correspond to Vault entries `chat_push_cron_token` and `chat_media_cron_token`.
The Vault entry `chat_cron_project_url` is the exact project's HTTPS origin.
Existing worker tokens are not rotated. No values belong in source, Vite,
mobile configuration, command arguments, chat output or Cron commands.

Provision from an authenticated Supabase CLI session, after reviewing the target:

```sh
node scripts/provision-worker-cron.mjs <project-ref>
```

The script generates independent 256-bit tokens and passes values through stdin.
It checks that previous Edge Secret digests did not change. If a call had an
unknown outcome, `--resume` reuses only these new Vault entries and checks any
existing dedicated Edge Secret's digest; it refuses conflicting credentials.
It does not read the older worker token values.
`--rotate` deliberately replaces only these two dedicated Cron credentials;
it never rotates the legacy worker keys or other project secrets.

## Transport and permissions

`worker_cron.invoke('push'|'media')` is a postgres-only, security-invoker helper.
It resolves the appropriate Vault credential at runtime and calls the matching
Edge Function synchronously using the `http` extension. Connection timeout is
10 seconds, total timeout 55 seconds, versus the worker's 45-second soft deadline.
Both SQL schedules must run as `postgres`. No frontend RPC is exposed.

The initially attempted `pg_net` approach is superseded by migration
`20261005011922_invoke_chat_workers_without_public_queue.sql`. Managed pg_net
objects are owned by `supabase_admin`; the preceding REVOKE migration returned
success but did **not** revoke effective PUBLIC permissions on this project.
A single initial smoke request used that queue before the replacement succeeded.
Both newly created Cron credentials were subsequently rotated and matched against
Vault; legacy worker credentials remained unchanged. The final helper does not
use pg_net or persist request headers. Do not roll back to the original helper.

Only the trusted project's own HTTPS worker endpoints are allowed. TLS
verification is enabled. The HTTP extension follows redirects internally;
these worker endpoints return JSON, not redirects. Do not replace them with
arbitrary redirecting endpoints.

The private, RLS-enabled `worker_cron.last_invocations` table keeps at most two
rows: latest invocation ID, times, HTTP status and whitelisted numeric/boolean
outcome fields. Raw provider responses, exception text and credentials are not
stored. `anon`, `authenticated` and `service_role` have no helper/table access.

## Schedules and monitoring

- `drivex-chat-media-cleanup`: every five minutes.
- `drivex-chat-push`: every minute; leave paused until
  `FIREBASE_SERVICE_ACCOUNT_JSON` is configured and a manual invocation succeeds.

For a new environment, create both schedules paused in one transaction, smoke
test each intended worker, and enable only the verified worker:

```sql
begin;
select cron.schedule('drivex-chat-push', '* * * * *',
  $$select worker_cron.invoke('push');$$);
select cron.schedule('drivex-chat-media-cleanup', '*/5 * * * *',
  $$select worker_cron.invoke('media');$$);
select cron.alter_job(jobid, active := false) from cron.job
where jobname in ('drivex-chat-push','drivex-chat-media-cleanup');
commit;
```

On 2026-10-05, both Edge workers were deployed as version 15, dedicated credentials
were matched between Edge Secrets and Vault, and legacy secret digests were
unchanged. The media smoke test returned HTTP 200 with zero failures; one expired,
uncommitted document upload cleanup was completed during the initial smoke test.
Push stays paused by user request until the Firebase credential is added.
The first scheduled media run at **2026-10-05 01:25 UTC** succeeded in about
1.4 seconds: HTTP 200, `failed=0`, `transitionFailures=0`, no deadline exhaustion.
This was a real Cron execution, separately verified in `cron.job_run_details`
and `worker_cron.last_invocations`, not merely the earlier manual smoke test.
The 39 worker tests and isolated final HTTP-helper database tests passed.

Read both scheduler and actual HTTP outcomes, as SQL success alone is insufficient:

```sql
select jobid, jobname, schedule, active, username
from cron.job where jobname in ('drivex-chat-push','drivex-chat-media-cleanup');

select worker, requested_at, completed_at, http_status, response_summary
from worker_cron.last_invocations order by worker;

select j.jobname, r.status, r.start_time, r.end_time, r.return_message
from cron.job_run_details r join cron.job j using (jobid)
where j.jobname in ('drivex-chat-push','drivex-chat-media-cleanup')
order by r.start_time desc limit 20;
```

Investigate non-2xx status, `transportError`, `invalidResponse`, nonzero `failed`
or `transitionFailures`, deadline exhaustion, or a stale completed timestamp.
This installs status visibility, **not** a separate alert-delivery service.

To enable push after installing the Firebase service-account JSON securely in
Supabase Edge Secrets, invoke once, inspect its HTTP outcome, then enable:

```sql
select worker_cron.invoke('push');
select http_status, response_summary from worker_cron.last_invocations where worker='push';
-- Only after a successful result:
select cron.alter_job(jobid, active := true)
from cron.job where jobname='drivex-chat-push';
```

Media cleanup uses the existing deletion queue and expired, uncommitted document
upload cleanup. It does not introduce a bulk deletion of chat history. The existing
maintenance also requeues stale jobs, expires rate-limit rows and recovers stale calls.

Focused local checks: `node --test scripts/chat-workers.test.mjs` and
`PG_BIN=/opt/homebrew/opt/postgresql@17/bin node scripts/test-worker-cron-http-db.mjs`.
Local HTTP stubs do not establish actual cloud ACLs or delivery; live verification
must check the final effective permissions and an actual scheduled invocation.

## New upload lifecycle and bounded capacity

Migration `20261005120609_chat_upload_lifecycle_and_worker_capacity.sql` registers
only new web chat uploads. Existing objects are never adopted or scanned for
orphan deletion. A new upload has an eight-day grace period (the client retains
pending sends for seven days). Registration, message attachment and expiry share
the same advisory path lock. A successful message commit atomically marks its
upload attached, even if the response is lost. Expiry revokes an unused key before
queueing deletion; it cannot subsequently be uploaded or attached again.

The worker rechecks the exact registered identity, tenant, revoked state and lack
of message/document references before removing it from `chat-media`. It never
uses the `load-documents` bucket for this work. Physical removal remains through
the Storage API, not SQL metadata deletion. Tests use an isolated database and
include a real two-session commit/cleanup race.

Both workers and the Cron helper accept at most 30 jobs per invocation rather than
three. Concurrency remains three and the soft deadline remains 45 seconds;
unfinished jobs are returned for retry. This is a bounded capacity increase, not
a measured guarantee of users or delivery latency. No schedule is enabled by the
migration; Firebase/push must remain paused until separately configured.

Deployment order: apply the additive migration, deploy `process-media-deletions`
and `process-push-notifications`, then publish the web client. The new web upload
path needs `register_chat_media_upload`; deploying it before the migration will
fail safely before upload. No existing messages or files are bulk-cleaned during
deployment. Verify effective function ACLs and worker results after deployment.
