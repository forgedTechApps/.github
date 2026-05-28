import { checkHttpTimeouts } from "../check-http-timeouts.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("http-timeouts", checkHttpTimeouts as unknown as Parameters<typeof runFixtureSuite>[1]);
