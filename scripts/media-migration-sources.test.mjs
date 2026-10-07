import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationSources } from './media-migration-sources.mjs';

function fixture({ cap = 137, failTable, failAfter = 0 } = {}) {
  const tables = ['profiles','driver_documents','document_versions','documents','chat_messages','broker_attachments','broker_messages','manual_load_imports'];
  const requests = [];
  const rows = Array.from({length: 1203}, (_, i) => ({
    id: String(i).padStart(5,'0'), company_id:'company', avatar_path:`avatar/${i}.png`, storage_path:`private/${i}.pdf`,
    raw_storage_path:`raw/${i}.eml`, load_id:`load-${i}`, document_id:String(i).padStart(5,'0'), file_name:'fixture.pdf', source_file_name:'fixture.pdf',
  }));
  const admin = { from(table) { assert.ok(tables.includes(table)); let cursor=null, limit=Infinity;
    return { select(){return this}, not(){return this}, order(key,options){assert.equal(key,'id');assert.equal(options.ascending,true);return this},
      limit(value){limit=value;return this}, gt(key,value){assert.equal(key,'id');cursor=value;return this},
      then(resolve,reject){requests.push({table,cursor}); const data=rows.filter(row=>cursor===null||row.id>cursor).slice(0,Math.min(limit,cap));
        return Promise.resolve({data,error:table===failTable&&Number(cursor)>=failAfter?new Error('fixture page failure'):null}).then(resolve,reject);}
    };
  }};
  return { admin, requests, tables };
}
test('every media table and document context is read beyond server caps smaller than the requested page', async () => {
  const {admin,requests,tables}=fixture(); const sources=await migrationSources(admin);
  assert.equal(sources.length,1203*7);
  for(const table of tables) assert.ok(requests.filter(request=>request.table===table).length>2,table);
  for(const table of tables.filter(table=>table!=='documents')) assert.equal(sources.filter(source=>source.table===table).length,1203,table);
  const last=sources.find(source=>source.table==='document_versions'&&source.rowId==='01202');
  assert.equal(last.contextId,'load-1202'); assert.equal(last.path,'private/1202.pdf');
  assert.equal(new Set(sources.map(source=>`${source.table}:${source.rowId}`)).size,sources.length);
});
test('a later source page error aborts enumeration instead of reporting a partial successful migration', async () => {
  const {admin}=fixture({failTable:'documents',failAfter:200});
  await assert.rejects(migrationSources(admin), /fixture page failure/);
});
