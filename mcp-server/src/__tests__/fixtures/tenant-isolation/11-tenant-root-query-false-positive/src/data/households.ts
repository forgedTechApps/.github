// Households ARE the tenant root. byId(id) is the tenant-establishing query,
// run before the requester's tenant is known (auth/session flow).
// Issue #27: needs a `tenant_root_methods` allowlist.
// CURRENT-BEHAVIOR: fires.
export class HouseholdRepo {
  async byId(id: string) {
    return null;
  }
  async findByToken(token: string) {
    return null;
  }
}
