import { checkBranching } from "../check-branching.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("branching", checkBranching);
