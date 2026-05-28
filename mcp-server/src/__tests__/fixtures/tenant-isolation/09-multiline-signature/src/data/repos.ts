export class TaskRepo {
  async findManyByBucket(
    householdId: string,
    bucket: {
      region: "UK" | "US";
      sizeMin: number;
      sizeMax: number;
    },
  ) {
    return [];
  }
}
