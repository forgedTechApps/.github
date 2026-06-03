import { checkFrameworkSupport } from "../check-framework-support.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("framework-support", checkFrameworkSupport as unknown as Parameters<typeof runFixtureSuite>[1]);
