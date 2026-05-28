import { checkCiSetup } from "../check-ci.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("ci", checkCiSetup);
