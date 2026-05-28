import { checkTenantIsolation } from "../check-tenant-isolation.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("tenant-isolation", checkTenantIsolation);
