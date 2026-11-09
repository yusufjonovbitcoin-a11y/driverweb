import { strict as assert } from 'node:assert';
import { cameraSelection, cameraRange, safeCameraUrl, normalizeCameraMedia, cameraApi } from './samsara-camera-core.ts';

Deno.test('camera selection and time ranges restrict fleet, input, past and quota-consuming clip length',()=>{
  assert.throws(()=>cameraSelection({vehicleId:'other-tenant',input:'dashcamRoadFacing'},[{id:'own'}]),/VEHICLE_NOT_FOUND/);
  assert.throws(()=>cameraSelection({vehicleId:'own',input:'arbitrary'},[{id:'own'}]),/INVALID_REQUEST/);
  const startTime='2026-11-01T12:00:00Z', endTime='2026-11-01T12:00:15Z', now=Date.parse('2026-11-02T12:00:00Z');
  assert.equal(cameraRange({startTime,endTime,mediaType:'videoHighRes'},true,now).endTime,'2026-11-01T12:00:15.000Z');
  assert.throws(()=>cameraRange({startTime,endTime,mediaType:'image'},true,now),/INVALID_TIME_RANGE/);
  assert.throws(()=>cameraRange({startTime,endTime:'2026-11-01T12:00:31Z',mediaType:'videoHighRes'},true,now),/INVALID_TIME_RANGE/);
  assert.throws(()=>cameraRange({startTime,endTime:'2026-11-03T12:00:00Z'},false,now),/INVALID_TIME_RANGE/);
  assert.throws(()=>cameraRange({startTime:'2026-10-30T12:00:00Z',endTime},false,now),/INVALID_TIME_RANGE/);
  assert.throws(()=>cameraRange({startTime:'2026-11-01T12:00',endTime},false,now),/INVALID_REQUEST/);
});
Deno.test('media normalization filters foreign vehicles, input aliases, expired and hostile URLs',()=>{
  const sample={vehicleId:'own',input:'dashcamForwardFacing',mediaType:'image',startTime:'2026-11-01T12:00:00Z',endTime:'2026-11-01T12:00:00Z',urlInfo:{url:'https://bucket.s3.us-west-2.amazonaws.com/image.jpg?signature=test',urlExpiryTime:new Date(Date.now()+3600000).toISOString()}};
  const result=normalizeCameraMedia([sample,{...sample,vehicleId:'other'},{...sample,input:'dashcamInwardFacing'}],'own','dashcamRoadFacing');
  assert.equal(result.length,1); assert.equal(result[0].input,'dashcamRoadFacing'); assert.equal(result[0].status,'available');
  assert.equal(normalizeCameraMedia([{...sample,urlInfo:{...sample.urlInfo,urlExpiryTime:'2020-01-01T00:00:00Z'}}],'own')[0].url,null);
  assert.equal(normalizeCameraMedia([{...sample,status:'pending'}],'own')[0].url,null);
  for(const url of ['http://bucket.s3.amazonaws.com/x','https://samsara.com.evil.invalid/x','javascript:alert(1)','https://user:pw@api.samsara.com/x','https://127.0.0.1/x','https://s3.amazonaws.com:999/x']) assert.equal(safeCameraUrl(url),null);
});
Deno.test('camera API keeps tokens server-side and distinguishes read/write permissions and quotas',async()=>{
  for(const [status,write,code] of [[403,false,'CAMERA_READ_REQUIRED'],[403,true,'CAMERA_WRITE_REQUIRED'],[401,false,'RECONNECT_REQUIRED'],[429,true,'RATE_LIMITED']] as const) {
    await assert.rejects(()=>cameraApi('/cameras/media/retrieval','private-token',write?{}:undefined,async(_u,init)=>{
      assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer private-token');
      assert.equal(init?.redirect,'error');
      return new Response('private provider details',{status});
    }),new RegExp(code));
  }
  await assert.rejects(()=>cameraApi('https://attacker.invalid/cameras/media','token'),/INVALID_ENDPOINT/);
});
