import { checkSqlInjection } from "../check-sql-injection.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("sql-injection", checkSqlInjection as unknown as Parameters<typeof runFixtureSuite>[1]);
