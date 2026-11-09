import { SamsaraError, seal, unseal, exchangeToken, errorCode, type Credentials } from './samsara-core.ts';
import { type Admin, check, serverConfig } from './samsara-server.ts';
import { cameraApi, cameraRange, cameraSelection, normalizeCameraMedia, requestIdValid } from './samsara-camera-core.ts';

const publicRequest = (row: Record<string, any>) => ({ id:row.id, vehicleId:row.vehicle_id, input:row.camera_input, mediaType:row.media_type,
  startTime:row.start_time, endTime:row.end_time, state:row.state, createdAt:row.created_at });

export async function cameraAction(admin: Admin, company: string, actor: string, body: Record<string, unknown>, api = cameraApi) {
  if (!['list','create','get','history'].includes(String(body.action))) throw new SamsaraError('INVALID_ACTION');
  // Share the fleet worker's lease: rotating refresh tokens cannot be used twice.
  const lease = crypto.randomUUID();
  const row = check(await admin.rpc('claim_samsara_connection', {p_company:company,p_lease:lease}))?.[0];
  if (!row) {
    const existing = check(await admin.from('samsara_connections').select('status').eq('company_id',company).maybeSingle());
    throw new SamsaraError(existing?.status === 'active' ? 'SYNC_BUSY':'RECONNECT_REQUIRED');
  }
  const save = async (patch: Record<string,unknown>) => check(await admin.from('samsara_connections').update(patch).eq('company_id',company).eq('generation',row.generation).eq('lease_id',lease).select('company_id'));
  const requests = () => admin.from('samsara_camera_requests').select('*').eq('company_id',company).eq('generation',row.generation);
  try {
    if (row.status !== 'active') throw new SamsaraError('RECONNECT_REQUIRED');
    const selection = cameraSelection(body, row.snapshot?.vehicles || []);
    if (body.action === 'history') return {requests:(check(await requests().eq('vehicle_id',selection.vehicleId).order('created_at',{ascending:false}).limit(12)) || []).map(publicRequest)};
    let owned: Record<string,any> | null = null;
    if (body.action === 'get') {
      if (!requestIdValid(body.id)) throw new SamsaraError('INVALID_REQUEST');
      owned = check(await requests().eq('id',body.id).eq('vehicle_id',selection.vehicleId).maybeSingle());
      if (!owned) throw new SamsaraError('RECORDING_NOT_FOUND');
      if (!owned.retrieval_id) return {request:publicRequest(owned),media:[]};
    }
    const range = body.action === 'get' ? null : cameraRange(body,body.action === 'create');
    if (body.action === 'create') {
      if (!requestIdValid(body.id)) throw new SamsaraError('INVALID_REQUEST');
      const existing = check(await requests().eq('id',body.id).maybeSingle());
      if (existing) {
        if (existing.vehicle_id !== selection.vehicleId || existing.camera_input !== selection.input || existing.media_type !== body.mediaType || Date.parse(existing.start_time) !== Date.parse(range!.startTime) || Date.parse(existing.end_time) !== Date.parse(range!.endTime)) throw new SamsaraError('INVALID_REQUEST');
        return {request:publicRequest(existing),media:[]};
      }
      // Under the lease, reserve once before the quota-consuming provider POST.
      const recent = check(await requests().gte('created_at',new Date(Date.now()-60000).toISOString()).limit(6));
      if ((recent?.length || 0) >= 5) throw new SamsaraError('RATE_LIMITED');
    }
    const config = await serverConfig(admin);
    let credentials: Credentials = await unseal(row.credentials,company,config('SAMSARA_ENCRYPTION_KEY'));
    if (!row.expires_at || Date.parse(row.expires_at) < Date.now()+60000) {
      try { credentials = await exchangeToken(config('SAMSARA_CLIENT_ID'),config('SAMSARA_CLIENT_SECRET'),{grant_type:'refresh_token',refresh_token:credentials.refresh_token}); }
      catch (error) { if (errorCode(error) !== 'RATE_LIMITED') await save({status:'needs_reconnect'}); throw error; }
      if (!(await save({credentials:await seal(credentials,company,config('SAMSARA_ENCRYPTION_KEY')),expires_at:new Date(Date.now()+credentials.expires_in*1000).toISOString()}))?.length) throw new SamsaraError('RECONNECT_REQUIRED');
    }
    let result: unknown;
    if (body.action === 'list') {
      if (body.after != null && (typeof body.after !== 'string' || body.after.length > 2000)) throw new SamsaraError('INVALID_REQUEST');
      const query = new URLSearchParams({...range!,vehicleIds:selection.vehicleId,inputs:selection.input});
      if (body.after) query.set('after',String(body.after));
      const data = await api(`/cameras/media?${query}`,credentials.access_token);
      const after = data.pagination?.hasNextPage ? data.pagination.endCursor : null;
      if (after !== null && (typeof after !== 'string' || !after || after === body.after || after.length > 2000)) throw new SamsaraError('INVALID_RESPONSE');
      result = {media:normalizeCameraMedia(data.data.media,selection.vehicleId,selection.input),after};
    } else if (body.action === 'create') {
      const inserted = check(await admin.from('samsara_camera_requests').insert({id:body.id,company_id:company,generation:row.generation,created_by:actor,
        vehicle_id:selection.vehicleId,camera_input:selection.input,media_type:body.mediaType,start_time:range!.startTime,end_time:range!.endTime,state:'submitting'}).select('*').single());
      try {
        const data = await api('/cameras/media/retrieval',credentials.access_token,{vehicleId:selection.vehicleId,inputs:[selection.input],mediaType:body.mediaType,...range});
        if (typeof data.data.retrievalId !== 'string' || !data.data.retrievalId || data.data.retrievalId.length > 200) throw new SamsaraError('INVALID_RESPONSE');
        const updated = check(await admin.from('samsara_camera_requests').update({retrieval_id:data.data.retrievalId,state:'pending'}).eq('company_id',company).eq('generation',row.generation).eq('id',inserted.id).select('*').single());
        result = {request:publicRequest(updated),media:[]};
      } catch (error) {
        const definite = ['CAMERA_WRITE_REQUIRED','CAMERA_REQUEST_REJECTED','RECONNECT_REQUIRED','RATE_LIMITED'].includes(errorCode(error));
        check(await admin.from('samsara_camera_requests').update({state:definite?'failed':'unknown'}).eq('company_id',company).eq('generation',row.generation).eq('id',inserted.id));
        if (definite) throw error;
        throw new SamsaraError('REQUEST_UNCONFIRMED');
      }
    } else if (owned) {
      const data = await api(`/cameras/media/retrieval?${new URLSearchParams({retrievalId:owned.retrieval_id})}`,credentials.access_token);
      const media = normalizeCameraMedia(data.data.media,selection.vehicleId,owned.camera_input);
      const state = !media.length || media.some(m=>m.status==='pending') ? 'pending' : media.some(m=>m.status==='available') ? 'available' : 'unavailable';
      check(await admin.from('samsara_camera_requests').update({state}).eq('company_id',company).eq('generation',row.generation).eq('id',owned.id));
      result = {request:publicRequest({...owned,state}),media};
    }
    // Re-consent can replace the fleet while the provider is responding.
    const current = check(await admin.from('samsara_connections').select('company_id').eq('company_id',company).eq('generation',row.generation).eq('status','active').maybeSingle());
    if (!current) throw new SamsaraError('RECONNECT_REQUIRED');
    return result;
  } catch (error) {
    if (errorCode(error) === 'RECONNECT_REQUIRED') await save({status:'needs_reconnect'});
    throw error;
  } finally { await save({lease_id:null,lease_until:null}); }
}
