export class WorkerRepo {
  // tenant-isolation: bypass — worker scan across all tenants; not user-initiated.
  async pendingProcessing(limit: number) {
    return [];
  }
}
