import { requireSupabase } from '../lib/supabase';

async function throwFunctionError(error, fallback) {
  let message = error?.message || fallback;
  try {
    const payload = await error?.context?.json();
    if (payload?.error) message = payload.error;
  } catch {
    // The function response may not contain JSON; keep the SDK message.
  }
  throw new Error(message);
}

async function getFunctionAccessToken(client, forceRefresh = false) {
  const { data, error } = forceRefresh
    ? await client.auth.refreshSession()
    : await client.auth.getSession();
  if (error) throw new Error('Sessiyani yangilab bo‘lmadi. Hisobdan chiqib, qayta kiring.');
  let session = data.session;
  const expiresSoon = !session?.expires_at || session.expires_at * 1000 <= Date.now() + 5 * 60 * 1000;
  if (!forceRefresh && expiresSoon) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw new Error('Sessiya tugagan. Hisobdan chiqib, qayta kiring.');
    }
    session = refreshed.data.session;
  }
  if (!session?.access_token) {
    throw new Error('Sessiya topilmadi. Hisobga qayta kiring.');
  }
  return session.access_token;
}

async function invokeAuthenticatedFunction(name, body) {
  const client = requireSupabase();
  let accessToken = await getFunctionAccessToken(client);
  let result = await client.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (result.error?.context?.status === 401) {
    accessToken = await getFunctionAccessToken(client, true);
    result = await client.functions.invoke(name, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  return result;
}

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

function toUiLoad(row, offersByLoad, documentsByLoad, warningsByLoad, reviewsByDocument) {
  const pickup = splitAppointment(row.pickup_from);
  const delivery = splitAppointment(row.delivery_from);
  const offers = offersByLoad.get(row.id) || [];
  const documents = documentsByLoad.get(row.id) || [];
  const docOfType = (type) => documents.find((document) => document.document_type === type);
  const docUrl = (type) => docOfType(type)?.signedUrl || null;
  const docReview = (type) => {
    const document = docOfType(type);
    return document ? reviewsByDocument.get(document.id) || null : null;
  };
  const offerWarnings = offers.flatMap((offer) => (
    Array.isArray(offer.compatibility_warnings) ? offer.compatibility_warnings : []
  ));
  const activeWarnings = [
    ...offerWarnings,
    ...(warningsByLoad.get(row.id) || []),
  ];
  return {
    id: row.id,
    loadNumber: row.load_number?.startsWith('#') ? row.load_number : `#${row.load_number}`,
    status: STATUS_TO_UI[row.status] || 'OFFER',
    databaseStatus: row.status,
    broker: row.broker_name || 'Broker ko\'rsatilmagan',
    brokerContact: row.broker_contact_name || '',
    brokerPhone: row.broker_phone || '',
    brokerEmail: row.broker_email || '',
    brokerFax: row.broker_fax || '',
    rate: Number(row.broker_rate || 0),
    distanceMiles: Number(row.loaded_miles || 0),
    ratePerMile: Number(row.loaded_rpm || 0),
    origin: {
      city: row.pickup_city || '—',
      state: row.pickup_region || '',
      facility: row.pickup_facility || 'Pickup',
      address: row.pickup_address || [row.pickup_city, row.pickup_region].filter(Boolean).join(', '),
      ...pickup,
      postalCode: row.pickup_postal_code || '',
      timezone: row.pickup_timezone || '',
      contactName: row.pickup_contact_name || '',
      contactPhone: row.pickup_contact_phone || '',
      lat: row.pickup_latitude == null ? null : Number(row.pickup_latitude),
      lng: row.pickup_longitude == null ? null : Number(row.pickup_longitude),
    },
    destination: {
      city: row.delivery_city || '—',
      state: row.delivery_region || '',
      facility: row.delivery_facility || 'Delivery',
      address: row.delivery_address || [row.delivery_city, row.delivery_region].filter(Boolean).join(', '),
      ...delivery,
      postalCode: row.delivery_postal_code || '',
      timezone: row.delivery_timezone || '',
      contactName: row.delivery_contact_name || '',
      contactPhone: row.delivery_contact_phone || '',
      lat: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
      lng: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    },
    commodity: row.cargo_description || 'Yuk tavsifi kiritilmagan',
    weightLbs: row.weight_lbs,
    equipment: row.equipment_type || '—',
    freightMode: row.freight_mode || '',
    temperature: row.temperature_fahrenheit == null ? null : Number(row.temperature_fahrenheit),
    pallets: row.pallet_count,
    cases: row.case_count,
    isHazmat: row.is_hazmat,
    specialInstructions: row.special_instructions || '',
    requirements: Array.isArray(row.load_requirements) ? row.load_requirements : [],
    warnings: activeWarnings,
    driverId: row.driver_id,
    targetDriverIds: offers.map((offer) => offer.driver_id),
    dispatchedAt: row.updated_at ? new Date(row.updated_at).toLocaleString('uz-UZ') : '',
    documents: {
      rateCon: docUrl('rate_confirmation'),
      shipperBol: docUrl('bol'),
      receiverPod: docUrl('pod'),
    },
    documentMeta: {
      rateCon: docOfType('rate_confirmation') || null,
      shipperBol: docOfType('bol') || null,
      receiverPod: docOfType('pod') || null,
    },
    documentChecks: {
      rateCon: docReview('rate_confirmation'),
      shipperBol: docReview('bol'),
      receiverPod: docReview('pod'),
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
      .select('storage_path,mime_type,file_name')
      .eq('id', document.current_version_id)
      .maybeSingle();
    if (!version?.storage_path) return document;
    const { data } = await client.storage.from('load-documents').createSignedUrl(version.storage_path, 3600);
    return {
      ...document,
      signedUrl: data?.signedUrl || null,
      mimeType: version.mime_type || null,
      fileName: version.file_name || null,
    };
  }));
}

export async function fetchWorkspace() {
  const client = requireSupabase();
  const [
    loadsResult,
    offersResult,
    documentsResult,
    driversResult,
    presenceResult,
    warningsResult,
    reviewsResult,
  ] = await Promise.all([
    client.from('load_overview').select('*').order('updated_at', { ascending: false }),
    client.from('offers').select('id,load_id,driver_id,status,compatibility_warnings').order('created_at', { ascending: false }),
    client.from('documents').select('id,load_id,document_type,current_version_id'),
    client.from('member_directory').select('*').eq('role', 'driver').order('full_name'),
    client.from('driver_presence').select('*'),
    client.from('warnings').select('id,load_id,code,message').eq('is_active', true).order('created_at'),
    client.from('document_review_overview').select('*'),
  ]);
  for (const result of [
    loadsResult,
    offersResult,
    documentsResult,
    driversResult,
    presenceResult,
    warningsResult,
    reviewsResult,
  ]) {
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
  const warningsByLoad = new Map();
  for (const warning of warningsResult.data || []) {
    const current = warningsByLoad.get(warning.load_id) || [];
    current.push(warning);
    warningsByLoad.set(warning.load_id, current);
  }
  const reviewsByDocument = new Map(
    (reviewsResult.data || []).map((review) => [review.document_id, review]),
  );
  return {
    loads: (loadsResult.data || []).map((row) => (
      toUiLoad(row, offersByLoad, documentsByLoad, warningsByLoad, reviewsByDocument)
    )),
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

export async function createMember({ email, password, fullName, phone, role = 'driver', companyId }) {
  const { data, error } = await invokeAuthenticatedFunction(
    'create-member',
    { email, password, fullName, phone, role, companyId },
  );
  if (error) await throwFunctionError(error, 'Could not create account');
  if (data?.error) throw new Error(data.error);
  return data?.profile;
}

export async function fetchCompanies() {
  const client = requireSupabase();
  const { data, error } = await client.from('companies').select('*').order('name');
  if (error) throw error;
  return data || [];
}

export async function createCompany({ companyName, adminFullName, adminEmail, adminPassword, adminPhone }) {
  const { data, error } = await invokeAuthenticatedFunction(
    'create-company',
    { companyName, adminFullName, adminEmail, adminPassword, adminPhone },
  );
  if (error) await throwFunctionError(error, 'Could not create company');
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
  const dispatch = await sendOffersForLoad(loadId, targetDriverIds);
  return { loadId, ...dispatch };
}

export async function prepareLoadFromDocument(file) {
  if (!(file instanceof File)) throw new Error('PDF yoki surat tanlang.');
  const client = requireSupabase();
  const formData = new FormData();
  formData.append('file', file, file.name);
  const { data, error } = await invokeAuthenticatedFunction('parse-load-document', formData);
  if (error) await throwFunctionError(error, 'AI hujjatni tahlil qila olmadi.');
  if (data?.error) throw new Error(data.error);
  if (!data?.loadId || !data?.preparedLoad) {
    throw new Error('AI tayyorlagan yuk ma\'lumoti qaytmadi.');
  }
  const { data: lifecycle, error: lifecycleError } = await client
    .from('load_overview')
    .select('status,current_assignment_id,driver_id')
    .eq('id', data.loadId)
    .single();
  if (lifecycleError) throw lifecycleError;
  return {
    ...data,
    preparedLoad: {
      ...data.preparedLoad,
      lifecycleStatus: lifecycle.status,
      currentAssignmentId: lifecycle.current_assignment_id,
      currentDriverId: lifecycle.driver_id,
    },
  };
}

export async function sendOffersForLoad(loadId, driverIds, missingFields = []) {
  const targets = [...new Set((driverIds || []).filter(Boolean))];
  if (!loadId || targets.length === 0) {
    throw new Error('Kamida bitta haydovchini tanlang.');
  }
  const client = requireSupabase();
  const { data: route, error: routeError } = await invokeAuthenticatedFunction(
    'calculate-load-route',
    { loadId, driverIds: targets },
  );
  if (routeError) await throwFunctionError(routeError, 'Marshrut masofasini hisoblay olmadi.');
  if (route?.error) throw new Error(route.error);
  if (!route?.loadedMiles || !Array.isArray(route?.targets)) {
    throw new Error('Marshrut xizmati masofani qaytarmadi. Manzillarni tekshiring.');
  }
  const compatibilityWarnings = [...new Set(missingFields)]
    .filter((field) => typeof field === 'string')
    .map((field) => ({
      code: 'ai_missing_field',
      field,
      message: `AI hujjatdan ${field} maydonini aniq topa olmadi.`,
    }));
  const { data, error } = await client.rpc('send_routed_offers', {
    load_id: loadId,
    offer_targets: route.targets,
    compatibility_warnings: compatibilityWarnings,
  });
  if (error) {
    if (error.message?.includes('Load is not available for offers')) {
      throw new Error('Bu yuk allaqachon tayinlangan yoki yakunlangan. Qayta tayinlash rejimidan foydalaning.');
    }
    if (error.message?.includes('Driver is not eligible')) {
      throw new Error('Tanlangan haydovchilardan biri faol emas yoki sizga biriktirilmagan.');
    }
    throw error;
  }
  return { offers: data || [], route };
}

export async function reassignLoad(loadId, driverId) {
  if (!loadId || !driverId) throw new Error('Qayta tayinlash uchun haydovchini tanlang.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('reassign_load', {
    load_id: loadId,
    new_driver_id: driverId,
    origin_latitude: null,
    origin_longitude: null,
    estimated_deadhead_miles: 0,
  });
  if (error) {
    if (error.message?.includes('Load cannot be reassigned')) {
      throw new Error('Bu yukni qayta tayinlab bo‘lmaydi. Yuk yakunlangan yoki bekor qilingan.');
    }
    if (error.message?.includes('Driver is not eligible')) {
      throw new Error('Tanlangan haydovchi faol emas.');
    }
    throw error;
  }
  return data;
}

export function subscribeWorkspace(onChange) {
  const client = requireSupabase();
  const channel = client
    .channel('dispatcher-workspace')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'document_checks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'warnings' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_presence' }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
}
