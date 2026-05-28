export async function getThing(id: string) {
  return fetch(`/api/things/${id}`, { signal: AbortSignal.timeout(5000) });
}
