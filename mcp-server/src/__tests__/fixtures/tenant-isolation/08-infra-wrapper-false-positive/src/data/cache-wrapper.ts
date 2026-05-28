// Cache instrumentation. No DB call. Issue #27: should be skipped.
// CURRENT-BEHAVIOR: fires.
export class CacheWrapper {
  isWrite(methodName: string): boolean {
    return methodName.startsWith("insert") || methodName.startsWith("update");
  }
}
