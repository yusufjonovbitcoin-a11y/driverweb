import { requireSupabase } from '../lib/supabase';

const STATUS_TO_UI = {
  draft: 'OFFER',
  review: 'OFFER',
  ready_for_offer: 'OFFER',
  offered: 'OFFER',
  assigned: 'ASSIGNED',
  in_progress: 'IN_TRANSIT',
  delivered: 'DELIVERED',
  completed: 'COMPLETED',
  cancelled: 'COMPLETED',
  dispute: 'DELIVERED',
};

function splitAppointment(value) {
  if (!value) return { date: '', time: 'Vaqt belgilanmagan' };
  const date = new Date(value);
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

function toUiLoad(row, offersByLoad, documentsByLoad) {
  const pickup = splitAppointment(row.pickup_from);
  const delivery = splitAppointment(row.delivery_from);
  const offers = offersByLoad.get(row.id) || [];
  const documents = documentsByLoad.get(row.id) || [];
  const docUrl = (type) => documents.find((document) => document.document_type === type)?.signedUrl || null;
  return {
    id: row.id,
    loadNumber: row.load_number?.startsWith('#') ? row.load_number : `#${row.load_number}`,
    status: STATUS_TO_UI[row.status] || 'OFFER',
    databaseStatus: row.status,
    broker: row.broker_name || 'Broker ko\'rsatilmagan',
    brokerContact: '',
    brokerPhone: '',
    rate: Number(row.broker_rate || 0),
    distanceMiles: Number(row.loaded_miles || 0),
    ratePerMile: Number(row.loaded_rpm || 0),
    origin: {
      city: row.pickup_city || '—',
      state: row.pickup_region || '',
      facility: row.pickup_facility || 'Pickup',
      address: row.pickup_address || [row.pickup_city, row.pickup_region].filter(Boolean).join(', '),
      ...pickup,
      lat: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
      lng: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
    },
    destination: {
      city: row.delivery_city || '—',
      state: row.delivery_region || '',
      facility: row.delivery_facility || 'Delivery',
      address: row.delivery_address || [row.delivery_city, row.delivery_region].filter(Boolean).join(', '),
      ...delivery,
      lat: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
      lng: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    },
    commodity: row.cargo_description || 'Yuk tavsifi kiritilmagan',
    weightLbs: row.weight_lbs,
    equipment: row.equipment_type || '—',
    temperature: null,
    pallets: null,
    driverId: row.driver_id,
    targetDriverIds: offers.map((offer) => offer.driver_id),
    dispatchedAt: row.updated_at ? new Date(row.updated_at).toLocaleString('uz-UZ') : '',
    documents: {
      rateCon: docUrl('rate_confirmation'),
      shipperBol: docUrl('bol'),
      receiverPod: docUrl('pod'),
    },
    version: row.version,
    requiresReconfirmation: Boolean(row.requires_reconfirmation),
  };
}

function toUiDriver(member, presence) {
  const online = Boolean(presence?.is_online) && Date.now() - new Date(presence.last_seen_at).getTime() < 120000;
  return {
    id: member.id,
    name: member.full_name,
    driverNumber: `#${member.id.slice(0, 4).toUpperCase()}`,
    phone: member.phone || '—',
    status: online ? 'AVAILABLE' : 'RESTING',
    dutyStatus: online ? 'ON_DUTY' : 'OFF_DUTY',
    currentLocation: online && presence?.latitude && presence?.longitude
      ? `${Number(presence.latitude).toFixed(4)}, ${Number(presence.longitude).toFixed(4)}`
      : 'Oflayn',
    lat: online && presence?.latitude ? Number(presence.latitude) : null,
    lng: online && presence?.longitude ? Number(presence.longitude) : null,
    hos: {
      driveLeft: member.hos_available_minutes == null
        ? '—'
        : `${Math.floor(member.hos_available_minutes / 60)}:${String(member.hos_available_minutes % 60).padStart(2, '0')}`,
      shiftLeft: '—',
      cycleLeft: '—',
    },
    truck: member.vehicle_type || 'Texnika kiritilmagan',
    trailer: member.trailer_type || 'Treyler kiritilmagan',
    equipment: member.equipment || [],
    rating: null,
    completedLoads: 0,
    onTimeRate: '—',
    avatar: null,
    isOnline: online,
    lastSeenAt: presence?.last_seen_at || null,
  };
}

async function signedDocumentUrls(client, documents) {
  return Promise.all(documents.map(async (document) => {
    if (!document.current_version_id) return document;
    const { data: version } = await client
      .from('document_versions')
      .select('storage_path')
      .eq('id', document.current_version_id)
      .maybeSingle();
    if (!version?.storage_path) return document;
    const { data } = await client.storage.from('load-documents').createSignedUrl(version.storage_path, 3600);
    return { ...document, signedUrl: data?.signedUrl || null };
  }));
}

export async function fetchWorkspace() {
  const client = requireSupabase();
  const [loadsResult, offersResult, documentsResult, driversResult, presenceResult] = await Promise.all([
    client.from('load_overview').select('*').order('updated_at', { ascending: false }),
    client.from('offers').select('id,load_id,driver_id,status').order('created_at', { ascending: false }),
    client.from('documents').select('id,load_id,document_type,current_version_id'),
    client.from('member_directory').select('*').eq('role', 'driver').order('full_name'),
    client.from('driver_presence').select('*'),
  ]);
  for (const result of [loadsResult, offersResult, documentsResult, driversResult, presenceResult]) {
    if (result.error) throw result.error;
  }
  const documents = await signedDocumentUrls(client, documentsResult.data || []);
  const offersByLoad = new Map();
  for (const offer of offersResult.data || []) {
    const current = offersByLoad.get(offer.load_id) || [];
    current.push(offer);
    offersByLoad.set(offer.load_id, current);
  }
  const documentsByLoad = new Map();
  for (const document of documents) {
    const current = documentsByLoad.get(document.load_id) || [];
    current.push(document);
    documentsByLoad.set(document.load_id, current);
  }
  return {
    loads: (loadsResult.data || []).map((row) => toUiLoad(row, offersByLoad, documentsByLoad)),
    drivers: (driversResult.data || []).map((member) => (
      toUiDriver(member, (presenceResult.data || []).find((item) => item.driver_id === member.id))
    )),
  };
}

export async function fetchBrokerInbox() {
  const client = requireSupabase();
  const [messagesResult, extractionsResult] = await Promise.all([
    client.from('broker_messages').select('*').order('received_at', { ascending: false }).limit(100),
    client.from('ai_extractions').select('*').order('processed_at', { ascending: false }).limit(100),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (extractionsResult.error) throw extractionsResult.error;
  return (messagesResult.data || []).map((message) => ({
    ...message,
    extraction: (extractionsResult.data || []).find((item) => item.message_id === message.id) || null,
  }));
}

export async function inviteMember({ email, fullName, phone, role = 'driver', companyId }) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('invite-member', {
    body: { email, fullName, phone, role, companyId },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.profile;
}

export async function fetchCompanies() {
  const client = requireSupabase();
  const { data, error } = await client.from('companies').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function createCompany({ companyName, adminFullName, adminEmail, adminPhone }) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke('create-company', {
    body: { companyName, adminFullName, adminEmail, adminPhone },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.companyId;
}

function stopPayload(stop, requiresDocument) {
  return {
    facilityName: stop.facility || null,
    addressLine: stop.address || [stop.city, stop.state].filter(Boolean).join(', '),
    city: stop.city,
    region: stop.state,
    postalCode: null,
    latitude: stop.lat,
    longitude: stop.lng,
    appointmentFrom: stop.date ? `${stop.date}T${stop.time?.slice(0, 5) || '08:00'}:00` : null,
    appointmentTo: null,
    requiresDocument,
  };
}

export async function createAndOfferLoad(newLoad) {
  const client = requireSupabase();
  const { data: loadId, error: createError } = await client.rpc('create_load_draft', {
    load_number: newLoad.loadNumber.replace(/^#/, ''),
    broker_name: newLoad.broker,
    cargo_description: newLoad.commodity,
    equipment_type: newLoad.equipment,
    weight_lbs: newLoad.weightLbs,
    broker_rate: newLoad.rate,
    loaded_miles: newLoad.distanceMiles,
    pickup: stopPayload(newLoad.origin, true),
    delivery: stopPayload(newLoad.destination, true),
    broker_message_id: null,
  });
  if (createError) throw createError;
  const { error: approveError } = await client.rpc('approve_load_draft', { load_id: loadId });
  if (approveError) throw approveError;
  const targetDriverIds = (newLoad.targetDriverIds || []).filter(Boolean);
  const offers = [];
  for (const driverId of targetDriverIds) {
    const { data, error } = await client.rpc('send_offer', {
      load_id: loadId,
      driver_id: driverId,
      origin_latitude: null,
      origin_longitude: null,
      estimated_deadhead_miles: 0,
      compatibility_warnings: [],
    });
    if (error) throw error;
    offers.push(data);
  }
  return { loadId, offers };
}

export function subscribeWorkspace(onChange) {
  const client = requireSupabase();
  const channel = client
    .channel('dispatcher-workspace')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_presence' }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
}
