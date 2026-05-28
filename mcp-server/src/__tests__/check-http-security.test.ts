import { checkHttpSecurity } from "../check-http-security.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("http-security", checkHttpSecurity);
