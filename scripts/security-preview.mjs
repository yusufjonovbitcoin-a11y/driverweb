import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';
const root=path.resolve('output/security-build');const config=JSON.parse(await fs.readFile('vercel.json','utf8'));
http.createServer(async(req,res)=>{try{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Invalid path');
 for(const header of config.headers[0].headers)res.setHeader(header.key,header.value);
 const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}}).listen(5193,'127.0.0.1');
