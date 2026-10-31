import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
// Each suite owns its fixture port. Sequential startup avoids shared Vite cache races.
const configs=readdirSync('.').filter(name=>/^playwright(?:\.[\w-]+)?\.config\.js$/.test(name)).sort();
for(const config of configs){
  console.log(`UI suite: ${config}`);
  const result=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',config],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
