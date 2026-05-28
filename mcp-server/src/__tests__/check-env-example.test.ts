import { checkEnvExample } from "../check-env-example.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("env-example", checkEnvExample as unknown as Parameters<typeof runFixtureSuite>[1]);
