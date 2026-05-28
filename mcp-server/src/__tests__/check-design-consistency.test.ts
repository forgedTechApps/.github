import { checkDesignConsistency } from "../check-design-consistency.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("design-consistency", checkDesignConsistency);
