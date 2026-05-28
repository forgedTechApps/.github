import { checkCodebaseHygiene } from "../check-codebase-hygiene.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("codebase-hygiene", checkCodebaseHygiene as unknown as Parameters<typeof runFixtureSuite>[1]);
