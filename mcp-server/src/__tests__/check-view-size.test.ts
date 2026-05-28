import { checkViewSize } from "../check-view-size.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("view-size", checkViewSize);
