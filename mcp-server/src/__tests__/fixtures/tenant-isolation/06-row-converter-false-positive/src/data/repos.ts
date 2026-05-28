// Pure row-to-domain mapper. No DB call. Issue #27: should not require bypass.
// Pinned as a CURRENT-BEHAVIOR test — this fires today; will flip to OK once #27 ships.
interface HouseholdRow { id: string; name: string }
interface Household { id: string; name: string }

export function toHousehold(row: HouseholdRow): Household {
  return { id: row.id, name: row.name };
}
