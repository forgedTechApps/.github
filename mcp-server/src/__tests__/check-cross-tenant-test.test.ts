import { checkCrossTenantTest } from "../check-cross-tenant-test.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("cross-tenant-test", checkCrossTenantTest);
