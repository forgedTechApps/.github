// tenant-isolation: bypass — entire file is anonymised cross-tenant aggregates.
export class AggregateRepo {
  async listAll() {
    return [];
  }
  async sum() {
    return 0;
  }
}
