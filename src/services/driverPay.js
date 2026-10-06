export async function prepareDriverPayAssignment(client, loadId, driverId) {
  const { data, error } = await client.functions.invoke('calculate-load-route', {
    body: { loadId, driverIds: [driverId], prepareDriverPay: true },
  });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* keep transport error */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function parseDriverMileageRate(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && number <= 100 ? number : null;
}
