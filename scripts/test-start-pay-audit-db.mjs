import { spawnSync } from 'node:child_process';

// Isolated synthetic PostgreSQL fixture only; no application credentials.
const result = spawnSync(process.execPath,[new URL('./test-load-trash-db.mjs',import.meta.url).pathname],{
  stdio:'inherit', env:{...process.env,BACKEND_AUDIT_TEST:'1',DRIVER_PAY_TEST:'1',SECURITY_AUDIT_TEST:'1',
    DOCUMENT_PRIVACY_TEST:'1',AUDIT_FIX_TEST:'1',PENDING_DRIVER_PAY_TEST:'1',START_PAY_AUDIT_TEST:'1'},
});
if(result.error) throw result.error;
process.exitCode=result.status??1;
