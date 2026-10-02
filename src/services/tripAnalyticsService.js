import { requireSupabase } from '../lib/supabase';

export async function fetchTripAnalytics({ group, search, from, to, page, pageSize = 25 }, signal) {
  const { data, error } = await requireSupabase().rpc('get_company_trip_analytics', {
    requested_group: group, search_text: search, date_from: from || null,
    date_to: to || null, page_number: page, page_size: pageSize,
  }).abortSignal(signal);
  if (error) throw error;
  return data;
}

export async function saveTripAccounting(row, amounts, notes) {
  const { data, error } = await requireSupabase().rpc('save_load_accounting', {
    target_load_id: row.id, expected_version: row.accounting_version,
    amounts, note_text: notes,
  });
  if (error) throw error;
  return data;
}
