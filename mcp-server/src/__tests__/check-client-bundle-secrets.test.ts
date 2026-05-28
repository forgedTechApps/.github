import { checkClientBundleSecrets } from "../check-client-bundle-secrets.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("client-bundle-secrets", checkClientBundleSecrets);
