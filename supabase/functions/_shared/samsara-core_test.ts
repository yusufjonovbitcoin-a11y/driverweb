import { strict as assert } from 'node:assert';
import { authorizationUrl, returnOrigin, returnLocation, randomState, stateHash, seal, unseal, sameSecret, exchangeToken, readPages, normalizeFleet, SamsaraError } from './samsara-core.ts';

Deno.test('OAuth state is unpredictable and redirects only to approved web origins', async()=>{
  const a=randomState(),b=randomState();
  assert.match(a,/^[a-f0-9]{64}$/); assert.notEqual(a,b);
  assert.notEqual(await stateHash(a),a);
  assert.equal(returnOrigin('https://managefleets.com.attacker.invalid'),'https://managefleets.com');
  assert.equal(returnOrigin('https://managefleets.com/#evil'),'https://managefleets.com');
  assert.equal(returnOrigin('http://127.0.0.1:5174'),'http://127.0.0.1:5174');
  assert.equal(new URL(authorizationUrl('client',a,'https://example.com/callback')).searchParams.get('state'),a);
  assert.equal(returnLocation('javascript:alert(1)','connected'),'https://managefleets.com/#profile?section=integrations&samsara=connected');
  assert.equal(await sameSecret('',''),false); assert.equal(await sameSecret(a,b),false); assert.equal(await sameSecret(a,a),true);
});
Deno.test('stored tokens are encrypted and bound to the company', async()=>{
  const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const tokens={access_token:'private-access',refresh_token:'private-refresh'};
  const ciphertext=await seal(tokens,'company-a',key);
  assert.ok(!ciphertext.includes('private'));
  assert.deepEqual(await unseal(ciphertext,'company-a',key),tokens);
  await assert.rejects(()=>unseal(ciphertext,'company-b',key));
  await assert.rejects(()=>unseal(ciphertext.slice(0,-4)+'AAAA','company-a',key));
  assert.notEqual(await seal(tokens,'company-a',key),ciphertext);
});
Deno.test('OAuth token exchange uses Basic auth, form body and sanitized errors', async()=>{
  const mock:typeof fetch=async(input,init)=>{
    assert.equal(String(input),'https://api.samsara.com/oauth2/token');
    assert.equal(new Headers(init?.headers).get('Authorization'),`Basic ${btoa('client:secret')}`);
    assert.equal(new URLSearchParams(String(init?.body)).get('grant_type'),'authorization_code');
    assert.equal(new URLSearchParams(String(init?.body)).get('code'),'a+b&c');
    return Response.json({access_token:'access',refresh_token:'rotated',expires_in:3599,unexpected:'discard'});
  };
  assert.deepEqual(await exchangeToken('client','secret',{grant_type:'authorization_code',code:'a+b&c'},mock),{access_token:'access',refresh_token:'rotated',expires_in:3599});
  await assert.rejects(()=>exchangeToken('c','s',{},async()=>new Response('secret provider body',{status:400})), /RECONNECT_REQUIRED/);
  await assert.rejects(()=>exchangeToken('c','s',{},async()=>Response.json({access_token:'a',expires_in:3600})), /INVALID_RESPONSE/);
});
Deno.test('refresh keeps the rotated refresh token and sends the old one once', async()=>{
  let calls=0;
  const result=await exchangeToken('c','s',{grant_type:'refresh_token',refresh_token:'old'},async(_input,init)=>{
    calls++; assert.equal(new URLSearchParams(String(init?.body)).get('refresh_token'),'old');
    return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
  });
  assert.equal(calls,1); assert.equal(result.refresh_token,'new-refresh');
});
Deno.test('fleet pagination preserves filters and rejects repeated cursors',async()=>{
  const urls:string[]=[];
  const rows=await readPages('/fleet/vehicles/stats?types=gps','access',async(input)=>{
    const url=new URL(String(input)); urls.push(url.toString());
    return Response.json({data:[{id:String(urls.length)}],pagination:{hasNextPage:urls.length===1,endCursor:'cursor+a&b'}});
  });
  assert.equal(rows.length,2); assert.equal(new URL(urls[1]).searchParams.get('types'),'gps');
  assert.equal(new URL(urls[1]).searchParams.get('after'),'cursor+a&b');
  await assert.rejects(()=>readPages('/fleet/drivers','a',async()=>Response.json({data:[],pagination:{hasNextPage:true,endCursor:'repeat'}})),/INVALID_RESPONSE/);
  await assert.rejects(()=>readPages('https://attacker.invalid/fleet/drivers','a'),/INVALID_ENDPOINT/);
});
Deno.test('missing scopes, rate limits and auth failures remain distinguishable',async()=>{
  for(const [status,code] of [[403,'SCOPE_REQUIRED'],[401,'RECONNECT_REQUIRED'],[429,'RATE_LIMITED'],[503,'PROVIDER_UNAVAILABLE']] as const) {
    await assert.rejects(()=>readPages('/fleet/drivers','a',async()=>new Response('sensitive detail',{status})),(error:unknown)=>error instanceof SamsaraError && error.code===code);
  }
});
Deno.test('GPS and HOS join by provider IDs; zero values are valid and missing values stay missing',()=>{
  const result=normalizeFleet([{id:'1',name:'Alex'},{id:'2',name:'Alex'}],[{id:'v1',name:'Truck'}],
    [{id:'v1',gps:{latitude:0,longitude:0,time:'2026-11-09T00:00:00Z',reverseGeo:{formattedLocation:'Depot'}}}],
    [{driver:{id:'2'},currentVehicle:{id:'v1'},clocks:{drive:{driveRemainingDurationMs:0},shift:{shiftRemainingDurationMs:3600000}}}]);
  assert.equal(result.drivers[0].driveRemainingMs,null);
  assert.equal(result.drivers[1].driveRemainingMs,0);
  assert.equal(result.drivers[1].vehicleId,'v1');
  assert.equal(result.vehicles[0].latitude,0);
  assert.equal(normalizeFleet([], [{id:'v'}], [{id:'v',gps:{latitude:999,longitude:0}}],[]).vehicles[0].latitude,null);
});
