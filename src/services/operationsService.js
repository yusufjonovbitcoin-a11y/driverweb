import { requireSupabase } from '../lib/supabase';
import { cloudinarySignedUrl } from './cloudinaryMediaService';
import { createCoalescedAsyncTrigger } from './realtimeRefresh';
import { normalizeLocale } from '../i18n/locales';
import { vehicleRowToModel } from './fleetVehicleModel';
import { loadBoardStatus } from './loadBoardStatus';
import { isCompleteVin, normalizeVin, parseNhtsaVinResult, retryVinLookup } from './nhtsaVin';
import {
  resolveDocumentMediaUrls,
  resolveProfileAvatarUrls,
} from './workspaceMediaResolver';

async function throwFunctionError(error, fallback) {
  let message = error?.message || fallback;
  let code = null;
  let params = null;
  try {
    const payload = await error?.context?.json();
    if (payload?.error) message = payload.error;
    code = payload?.code || null;
    params = payload?.params || null;
  } catch {
    // The function response may not contain JSON; keep the SDK message.
  }
  const normalized = new Error(message);
  normalized.code = code;
  normalized.params = params;
  throw normalized;
}

async function getFunctionAccessToken(client, forceRefresh = false) {
  const { data, error } = forceRefresh
    ? await client.auth.refreshSession()
    : await client.auth.getSession();
  if (error) {
    await client.auth.signOut({ scope: 'local' });
    throw new Error('Sessiya tugagan. Hisobga qayta kiring.');
  }
  let session = data.session;
  const expiresSoon = !session?.expires_at || session.expires_at * 1000 <= Date.now() + 5 * 60 * 1000;
  if (!forceRefresh && expiresSoon) {
    const refreshed = await client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      await client.auth.signOut({ scope: 'local' });
      throw new Error('Sessiya tugagan. Hisobga qayta kiring.');
    }
    session = refreshed.data.session;
  }
  if (!session?.access_token) {
    await client.auth.signOut({ scope: 'local' });
    throw new Error('Sessiya topilmadi. Hisobga qayta kiring.');
  }
  return session.access_token;
}

async function invokeAuthenticatedFunction(name, body, options = {}) {
  const client = requireSupabase();
  let accessToken = await getFunctionAccessToken(client);
  let result = await client.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
    ...options,
  });
  if (result.error?.context?.status === 401) {
    accessToken = await getFunctionAccessToken(client, true);
    result = await client.functions.invoke(name, {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
      ...options,
    });
  }
  return result;
}

export async function updateMyLocale(locale) {
  const client = requireSupabase();
  const normalized = normalizeLocale(locale);
  const { data, error } = await client.rpc('set_my_locale', {
    requested_locale: normalized,
  });
  if (error) throw error;
  return normalizeLocale(data);
}

function splitAppointment(value) {
  if (!value) return { appointmentAt: null, date: null, time: null };
  return {
    appointmentAt: value,
    date: value,
    time: null,
  };
}

function toUiLoad(row, offersByLoad, documentsByLoad, warningsByLoad, reviewsByDocument, stagesByAssignment) {
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
    status: loadBoardStatus(row, stagesByAssignment.get(row.current_assignment_id)),
    databaseStatus: row.status,
    broker: row.broker_name || null,
    brokerContact: row.broker_contact_name || '',
    brokerPhone: row.broker_phone || '',
    brokerEmail: row.broker_email || '',
    brokerFax: row.broker_fax || '',
    rate: Number(row.broker_rate || 0),
    rateKnown: row.broker_rate != null && !row.driver_brief?.unknownFields?.includes('brokerRate'),
    distanceMiles: Number(row.loaded_miles || 0),
    distanceKnown: row.loaded_miles != null && !row.driver_brief?.unknownFields?.includes('loadedMiles'),
    ratePerMile: Number(row.loaded_rpm || 0),
    origin: {
      city: row.pickup_city || null,
      state: row.pickup_region || '',
      facility: row.pickup_facility || null,
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
      city: row.delivery_city || null,
      state: row.delivery_region || '',
      facility: row.delivery_facility || null,
      address: row.delivery_address || [row.delivery_city, row.delivery_region].filter(Boolean).join(', '),
      ...delivery,
      postalCode: row.delivery_postal_code || '',
      timezone: row.delivery_timezone || '',
      contactName: row.delivery_contact_name || '',
      contactPhone: row.delivery_contact_phone || '',
      lat: row.delivery_latitude == null ? null : Number(row.delivery_latitude),
      lng: row.delivery_longitude == null ? null : Number(row.delivery_longitude),
    },
    commodity: row.cargo_description || null,
    weightLbs: row.weight_lbs,
    equipment: row.equipment_type || null,
    freightMode: row.freight_mode || '',
    temperature: row.temperature_fahrenheit == null ? null : Number(row.temperature_fahrenheit),
    pallets: row.pallet_count,
    cases: row.case_count,
    isHazmat: row.is_hazmat,
    specialInstructions: row.special_instructions || '',
    driverBrief: row.driver_brief || null,
    review: row.driver_brief ? {
      required: !row.driver_brief.reviewedAt,
      checksum: row.driver_brief.checksum,
      blockingFields: row.driver_brief.blockingFields || [],
    } : null,
    requirements: Array.isArray(row.load_requirements) ? row.load_requirements : [],
    warnings: activeWarnings,
    driverId: row.driver_id,
    targetDriverIds: row.driver_id ? [row.driver_id] : [],
    dispatchedAt: row.updated_at || null,
    documents: {
      rateCon: docUrl('rate_confirmation'),
      shipperBol: docUrl('bol'),
      receiverPod: docUrl('pod'),
      receipt: docUrl('receipt'),
    },
    documentMeta: {
      rateCon: docOfType('rate_confirmation') || null,
      shipperBol: docOfType('bol') || null,
      receiverPod: docOfType('pod') || null,
      receipt: docOfType('receipt') || null,
    },
    documentChecks: {
      rateCon: docReview('rate_confirmation'),
      shipperBol: docReview('bol'),
      receiverPod: docReview('pod'),
      receipt: docReview('receipt'),
    },
    version: row.version,
    requiresReconfirmation: Boolean(row.requires_reconfirmation),
  };
}

function toUiDriver(member, presence, avatar = null) {
  const online = Boolean(presence?.is_online) && Date.now() - new Date(presence.last_seen_at).getTime() < 120000;
  return {
    id: member.id,
    name: member.full_name,
    email: member.email || null,
    driverNumber: `#${member.id.slice(0, 4).toUpperCase()}`,
    phone: member.phone || null,
    status: online ? 'AVAILABLE' : 'RESTING',
    dutyStatus: online ? 'ON_DUTY' : 'OFF_DUTY',
    currentLocation: online && presence?.latitude && presence?.longitude
      ? `${Number(presence.latitude).toFixed(4)}, ${Number(presence.longitude).toFixed(4)}`
      : null,
    lat: online && presence?.latitude ? Number(presence.latitude) : null,
    lng: online && presence?.longitude ? Number(presence.longitude) : null,
    hos: {
      driveLeft: member.hos_available_minutes == null
        ? '—'
        : `${Math.floor(member.hos_available_minutes / 60)}:${String(member.hos_available_minutes % 60).padStart(2, '0')}`,
      shiftLeft: '—',
      cycleLeft: '—',
    },
    truck: member.vehicle_number || member.vehicle_type || null,
    vehicle: member.assigned_vehicle_id ? {
      id: member.assigned_vehicle_id,
      number: member.vehicle_number,
      make: member.vehicle_make,
      model: member.vehicle_model,
      year: member.vehicle_year,
      vin: member.vehicle_vin,
      fuelType: member.vehicle_fuel_type,
      plateState: member.vehicle_plate_state,
      plateNumber: member.vehicle_plate_number,
      sleeperBerthEnabled: member.sleeper_berth_enabled,
      notes: member.vehicle_notes,
    } : null,
    trailer: member.trailer_type || null,
    equipment: member.equipment || [],
    rating: null,
    completedLoads: 0,
    onTimeRate: '—',
    avatar,
    isOnline: online,
    lastSeenAt: presence?.last_seen_at || null,
  };
}

function toUiMember(member, avatar = null) {
  return {
    id: member.id,
    name: member.full_name,
    email: member.email || '',
    phone: member.phone || '',
    role: member.role,
    status: member.status,
    avatar,
  };
}

export async function fetchWorkspace() {
  const client = requireSupabase();
  const [
    loadsResult,
    offersResult,
    assignmentsResult,
    documentsResult,
    membersResult,
    presenceResult,
    warningsResult,
    reviewsResult,
  ] = await Promise.all([
    client.from('load_overview').select('*').order('updated_at', { ascending: false }),
    client.from('offers').select('id,load_id,driver_id,status,compatibility_warnings').order('created_at', { ascending: false }),
    client.from('assignments').select('id,driver_stage').eq('status', 'active'),
    client.from('documents').select('id,load_id,document_type,current_version_id'),
    client.from('member_directory').select('*').order('full_name'),
    client.from('driver_presence').select('*'),
    client.from('warnings').select('id,load_id,code,message,params').eq('is_active', true).order('created_at'),
    client.from('document_review_overview').select('*'),
  ]);
  for (const result of [
    loadsResult,
    offersResult,
    assignmentsResult,
    documentsResult,
    membersResult,
    presenceResult,
    warningsResult,
    reviewsResult,
  ]) {
    if (result.error) throw result.error;
  }
  const members = (membersResult.data || []).filter((member) => member.status === 'active');
  const [documents, avatarUrls] = await Promise.all([
    resolveDocumentMediaUrls(client, documentsResult.data || [], cloudinarySignedUrl),
    resolveProfileAvatarUrls(client, members, cloudinarySignedUrl),
  ]);
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
  const stagesByAssignment = new Map(
    (assignmentsResult.data || []).map((assignment) => [assignment.id, assignment.driver_stage]),
  );
  return {
    loads: (loadsResult.data || []).map((row) => (
      toUiLoad(row, offersByLoad, documentsByLoad, warningsByLoad, reviewsByDocument, stagesByAssignment)
    )),
    drivers: members.filter((member) => member.role === 'driver').map((member) => (
      toUiDriver(
        member,
        (presenceResult.data || []).find((item) => item.driver_id === member.id),
        avatarUrls.get(member.id),
      )
    )),
    members: members.map((member) => toUiMember(member, avatarUrls.get(member.id))),
  };
}

export async function fetchBrokerInbox() {
  const client = requireSupabase();
  const [messagesResult, extractionsResult, attachmentsResult, readsResult] = await Promise.all([
    client.from('broker_messages').select('*').order('received_at', { ascending: false }).limit(100),
    client.from('ai_extractions').select('*').order('processed_at', { ascending: false }).limit(100),
    client.from('broker_attachments').select('id,message_id,file_name,mime_type,size_bytes,created_at').order('created_at'),
    client.from('broker_message_reads').select('message_id'),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (extractionsResult.error) throw extractionsResult.error;
  if (attachmentsResult.error) throw attachmentsResult.error;
  if (readsResult.error) throw readsResult.error;
  const readMessageIds = new Set((readsResult.data || []).map((item) => item.message_id));
  return (messagesResult.data || []).map((message) => ({
    ...message,
    is_read: readMessageIds.has(message.id),
    extraction: (extractionsResult.data || []).find((item) => item.message_id === message.id) || null,
    attachments: (attachmentsResult.data || []).filter((attachment) => attachment.message_id === message.id),
  }));
}

export async function fetchBrokerInboxUnreadCount() {
  const client = requireSupabase();
  const [attachmentsResult, readsResult] = await Promise.all([
    client.from('broker_attachments').select('message_id,mime_type,file_name'),
    client.from('broker_message_reads').select('message_id'),
  ]);
  if (attachmentsResult.error) throw attachmentsResult.error;
  if (readsResult.error) throw readsResult.error;
  const readMessageIds = new Set((readsResult.data || []).map((item) => item.message_id));
  const supportedMessageIds = new Set((attachmentsResult.data || [])
    .filter((attachment) => (
      attachment.mime_type === 'application/pdf'
      || attachment.mime_type?.startsWith('image/')
      || /\.(pdf|jpe?g|png|webp|gif)$/i.test(attachment.file_name || '')
    ))
    .map((attachment) => attachment.message_id));
  return [...supportedMessageIds].filter((messageId) => !readMessageIds.has(messageId)).length;
}

export async function fetchGmailIntegration() {
  const client = requireSupabase();
  const { data, error } = await client
    .from('gmail_connections')
    .select('id,mailbox_email,status,last_synced_at,last_error,updated_at')
    .maybeSingle();
  if (error) throw new Error('Gmail holatini olib bo‘lmadi.');
  if (!data) return null;
  return {
    id: data.id,
    mailboxEmail: data.mailbox_email,
    status: data.status,
    lastSyncedAt: data.last_synced_at,
    lastError: data.last_error,
    updatedAt: data.updated_at,
  };
}

export async function connectGmailIntegration({ mailboxEmail, appPassword }) {
  const { data, error } = await invokeAuthenticatedFunction('gmail-integration', {
    action: 'connect',
    mailboxEmail,
    appPassword,
  });
  if (error) await throwFunctionError(error, 'Gmail ulanishini saqlab bo‘lmadi.');
  if (data?.error) throw new Error(data.error);
  return data?.connection || null;
}

export async function disconnectGmailIntegration() {
  const { data, error } = await invokeAuthenticatedFunction('gmail-integration', {
    action: 'disconnect',
  });
  if (error) await throwFunctionError(error, 'Gmail ulanishini uzib bo‘lmadi.');
  if (data?.error) throw new Error(data.error);
  return data?.connection || null;
}

export async function markBrokerMessageRead(messageId) {
  const client = requireSupabase();
  const { error } = await client.rpc('mark_broker_message_read', { target_message_id: messageId });
  if (error) throw error;
}

export async function forwardGmailAttachmentToDriver({ attachmentId, driverId }) {
  const { data, error } = await invokeAuthenticatedFunction('forward-gmail-attachment', {
    attachmentId,
    driverId,
  });
  if (error) await throwFunctionError(error, 'PDF faylni driverga yuborib bo‘lmadi.');
  if (data?.error) throw new Error(data.error);
  return data;
}

const LEGACY_AI_PLACEHOLDERS = Object.freeze({
  broker: 'Broker aniqlanmadi',
  commodity: 'Yuk tavsifi aniqlanmadi',
  equipment: 'Aniqlanmadi',
  pickupFacility: 'Pickup',
  deliveryFacility: 'Delivery',
  region: '--',
});

function nullableProposalValue(value, legacyPlaceholder) {
  if (typeof value !== 'string') return value ?? null;
  const normalized = value.trim();
  return normalized && normalized !== legacyPlaceholder ? normalized : null;
}

export async function createLoadFromBrokerProposal(proposal) {
  const client = requireSupabase();
  if (!proposal?.brokerMessageId || !proposal?.origin || !proposal?.destination) {
    throw new Error('Broker taklifi to\u2018liq emas. PDF\u2019ni qayta tahlil qiling.');
  }
  const { data: loadId, error: createError } = await client.rpc('create_load_draft', {
    load_number: String(proposal.loadNumber || '').replace(/^#/, '') || `GMAIL-${Date.now()}`,
    broker_name: nullableProposalValue(proposal.broker, LEGACY_AI_PLACEHOLDERS.broker),
    cargo_description: nullableProposalValue(proposal.commodity, LEGACY_AI_PLACEHOLDERS.commodity),
    equipment_type: nullableProposalValue(proposal.equipment, LEGACY_AI_PLACEHOLDERS.equipment),
    weight_lbs: proposal.weightLbs || null,
    broker_rate: Number(proposal.rate || 0),
    loaded_miles: Number(proposal.distanceMiles || 0),
    pickup: {
      facilityName: nullableProposalValue(proposal.origin.facility, LEGACY_AI_PLACEHOLDERS.pickupFacility),
      addressLine: proposal.origin.address || [proposal.origin.city, proposal.origin.state].filter(Boolean).join(', '),
      city: proposal.origin.city || '',
      region: nullableProposalValue(proposal.origin.state, LEGACY_AI_PLACEHOLDERS.region) || '',
      postalCode: proposal.origin.postalCode || null,
      latitude: null,
      longitude: null,
      appointmentFrom: proposal.origin.appointmentFrom || null,
      appointmentTo: proposal.origin.appointmentTo || null,
      requiresDocument: true,
    },
    delivery: {
      facilityName: nullableProposalValue(proposal.destination.facility, LEGACY_AI_PLACEHOLDERS.deliveryFacility),
      addressLine: proposal.destination.address || [proposal.destination.city, proposal.destination.state].filter(Boolean).join(', '),
      city: proposal.destination.city || '',
      region: nullableProposalValue(proposal.destination.state, LEGACY_AI_PLACEHOLDERS.region) || '',
      postalCode: proposal.destination.postalCode || null,
      latitude: null,
      longitude: null,
      appointmentFrom: proposal.destination.appointmentFrom || null,
      appointmentTo: proposal.destination.appointmentTo || null,
      requiresDocument: true,
    },
    broker_message_id: proposal.brokerMessageId,
  });
  if (createError) throw createError;
  const { error: approveError } = await client.rpc('approve_load_draft', { load_id: loadId });
  if (approveError) throw approveError;
  return { ...proposal, id: loadId, lifecycleStatus: 'ready_for_offer' };
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

export async function deleteCompanyMember(memberId) {
  const { data, error } = await invokeAuthenticatedFunction(
    'delete-member',
    { memberId },
  );
  if (error) await throwFunctionError(error, 'Could not remove company member');
  if (data?.error) {
    const failure = new Error(data.error);
    failure.code = data.code || null;
    throw failure;
  }
  return data?.profile || null;
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

export async function createManualLoad(newLoad) {
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
  if (approveError) {
    const failure = new Error(approveError.message);
    failure.code = 'LOAD_SAVED_APPROVAL_FAILED';
    failure.loadId = loadId;
    throw failure;
  }
  return loadId;
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

export async function fetchImportRoadRoute(loadId, driverId, signal) {
  const { data, error } = await invokeAuthenticatedFunction('calculate-load-route', {
    loadId, driverIds: driverId ? [driverId] : [], preview: true,
  }, { signal });
  if (error) await throwFunctionError(error, 'Route unavailable');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchImportContacts(loadId, signal) {
  const { data, error } = await invokeAuthenticatedFunction('lookup-load-contacts', { loadId }, { signal });
  if (error) await throwFunctionError(error, 'Contacts unavailable');
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function assignLoadDirectly(loadId, driverId) {
  if (!loadId || !driverId) throw new Error('Tayinlash uchun bitta haydovchini tanlang.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('assign_load_directly', {
    load_id: loadId,
    driver_id: driverId,
  });
  if (error) {
    if (error.message?.includes('not available for direct assignment')) {
      throw new Error('Bu yukni tayinlab bo‘lmaydi. Yuk tayyor emas yoki yakunlangan.');
    }
    if (error.message?.includes('Driver is not eligible')) {
      throw new Error('Tanlangan haydovchi faol emas.');
    }
    throw error;
  }
  return data;
}

export async function reviewAndAssignDocumentLoad(loadId, driverId, checksum) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('review_and_assign_document_load', {
    target_load_id: loadId, target_driver_id: driverId, source_checksum: checksum,
  });
  if (error) throw error;
  return data;
}

export async function deleteUnassignedLoad(loadId) {
  if (!loadId) throw new Error('O‘chirish uchun yuk topilmadi.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('delete_unassigned_load', {
    target_load_id: loadId,
  });
  if (error) {
    if (error.message?.includes('Only an unassigned load can be deleted')) {
      throw new Error('Faqat driver qabul qilmagan yukni o‘chirish mumkin.');
    }
    if (error.message?.includes('Load not found')) {
      throw new Error('Yuk topilmadi yoki uni o‘chirishga ruxsat yo‘q.');
    }
    if (error.message?.includes('Only a company admin or dispatcher')) {
      throw new Error('Yukni faqat admin yoki dispatcher o‘chira oladi.');
    }
    throw error;
  }
  return data;
}

export async function fetchFleetVehicles() {
  const client = requireSupabase();
  const { data, error } = await client
    .from('fleet_vehicle_overview')
    .select('*')
    .order('vehicle_number');
  if (error) throw error;
  return (data || []).map(vehicleRowToModel);
}

export async function updateCompanyDriverContact(driverId, { name, phone }) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('update_company_driver_contact', {
    p_driver_id: driverId,
    p_full_name: name.trim(),
    p_phone: phone.trim() || null,
  });
  if (error) throw error;
  return data;
}

export async function decodeVehicleVin(value, { signal } = {}) {
  const vin = normalizeVin(value);
  if (!isCompleteVin(vin)) throw new Error('Invalid VIN');

  const payload = await retryVinLookup(async () => {
    if (import.meta.env.DEV) {
      const response = await fetch(`/api/vin-decode/${vin}?format=json`, { signal });
      if (!response.ok) throw new Error('VIN decoder is unavailable');
      return response.json();
    }
    const result = await invokeAuthenticatedFunction('decode-vin', { vin }, {
      signal,
      timeout: 10000,
    });
    if (result.error) throw result.error;
    return result.data;
  }, { signal });
  return parseNhtsaVinResult(payload, vin);
}

export async function createFleetVehicle(vehicle) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_fleet_vehicle', {
    p_vehicle_number: vehicle.vehicleNumber,
    p_vin: vehicle.vin,
    p_make: vehicle.make,
    p_model: vehicle.model,
    p_model_year: vehicle.modelYear,
    p_fuel_type: vehicle.fuelType,
    p_plate_issued_state: vehicle.plateIssuedState || null,
    p_plate_number: vehicle.plateNumber || null,
    p_sleeper_berth_enabled: vehicle.sleeperBerthEnabled,
    p_notes: vehicle.notes || null,
    p_driver_id: null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function updateFleetVehicle(vehicleId, vehicle, status = 'active') {
  const client = requireSupabase();
  const { data, error } = await client.rpc('update_fleet_vehicle', {
    p_vehicle_id: vehicleId,
    p_vehicle_number: vehicle.vehicleNumber,
    p_make: vehicle.make,
    p_model: vehicle.model,
    p_model_year: vehicle.modelYear,
    p_fuel_type: vehicle.fuelType,
    p_plate_issued_state: vehicle.plateIssuedState || null,
    p_plate_number: vehicle.plateNumber || null,
    p_sleeper_berth_enabled: vehicle.sleeperBerthEnabled,
    p_notes: vehicle.notes || null,
    p_status: status,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function assignFleetVehicleDriver(vehicleId, driverId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('assign_vehicle_driver', {
    p_vehicle_id: vehicleId,
    p_driver_id: driverId,
  });
  if (error) throw error;
  return data;
}

export async function unassignFleetVehicleDriver(vehicleId) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('unassign_vehicle_driver', {
    p_vehicle_id: vehicleId,
  });
  if (error) throw error;
  return data;
}

export function subscribeWorkspace(onChange) {
  const client = requireSupabase();
  const refresh = createCoalescedAsyncTrigger(onChange);
  const channel = client
    .channel('dispatcher-workspace')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loads' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'offers' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'document_checks' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'warnings' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_presence' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_driver_assignments' }, refresh)
    .subscribe();
  return () => {
    refresh.dispose();
    void client.removeChannel(channel);
  };
}
