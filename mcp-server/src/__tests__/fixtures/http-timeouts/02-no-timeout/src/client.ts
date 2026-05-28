export async function getThing(id: string) {
  return fetch(`/api/things/${id}`);
}
