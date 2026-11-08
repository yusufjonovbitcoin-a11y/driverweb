const channel = { on: () => channel, subscribe: () => channel };
export const supabase = { channel: () => channel, removeChannel: async () => {} };
export const fetchRingingCalls = async () => [];
export const fetchUnreadChatCountsByDriver = async () => ({});
export const subscribeCalls = () => () => {};
export const subscribeUnreadChats = () => () => {};

export function useAuth() {
  return { configured: true, currentUser: {
    id: 'route-staff', name: 'Test dispatcher', companyId: 'route-company', roleCode: 'dispatcher', locale: 'en',
  } };
}
