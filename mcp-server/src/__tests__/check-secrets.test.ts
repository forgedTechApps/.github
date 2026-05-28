import { checkSecrets } from "../check-secrets.js";
import { runFixtureSuite } from "./harness.js";

// checkSecrets takes (repoRoot, scope) — wrap to match the harness signature.
await runFixtureSuite("secrets", (repoRoot) => checkSecrets(repoRoot, "tracked"));
