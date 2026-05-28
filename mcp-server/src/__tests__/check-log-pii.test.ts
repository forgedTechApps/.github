import { checkLogPii } from "../check-log-pii.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("log-pii", checkLogPii);
