import { checkSubscription } from "../check-subscription.js";
import { runFixtureSuite } from "./harness.js";

await runFixtureSuite("subscription", checkSubscription as unknown as Parameters<typeof runFixtureSuite>[1]);
