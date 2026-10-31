import fs from 'node:fs/promises';
import path from 'node:path';
const slug=process.argv[2];if(!/^[a-z][a-z0-9-]+$/.test(slug||''))throw Error('Invalid function name');
const root=path.resolve('supabase/functions'), files=new Map();
async function add(file){
 const absolute=path.resolve(file),relative=path.relative(root,absolute);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Function import outside source root');
 if(files.has(absolute))return;const content=await fs.readFile(absolute,'utf8');files.set(absolute,content);
 for(const [,specifier] of content.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g))if(specifier.startsWith('.'))await add(path.resolve(path.dirname(absolute),specifier));
}
await add(path.join(root,slug,'index.ts'));
let config;for(const name of ['deno.json','deno.jsonc']){const file=path.join(root,slug,name);try{await add(file);config=file;break}catch(e){if(e.code!=='ENOENT')throw e}}
const name=file=>path.relative(process.cwd(),file).replaceAll('\\','/');
const bundle={name:slug,entrypoint_path:name(path.join(root,slug,'index.ts')),files:[...files].map(([file,content])=>({name:name(file),content})),...(config?{import_map_path:name(config)}:{})};
await fs.writeFile(`output/deploy-${slug}.json`,JSON.stringify(bundle));console.log(`${slug}: ${files.size} files`);
