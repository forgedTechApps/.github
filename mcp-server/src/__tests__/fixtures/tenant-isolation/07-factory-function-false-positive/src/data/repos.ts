// Factory; no DB call. Issue #27: should be skipped via heuristic.
// CURRENT-BEHAVIOR: fires.
class TaskRepo {}
class UserRepo {}

export function createMemoryRepos() {
  return { task: new TaskRepo(), user: new UserRepo() };
}
