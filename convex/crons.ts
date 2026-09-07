import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Gmail push subscriptions last 7 days; renew daily so they never lapse.
crons.daily("renew gmail watches", { hourUTC: 15, minuteUTC: 0 }, internal.google.renewAllWatches, {});
// Belt and braces: even without Pub/Sub, both mailboxes catch up every 10 minutes.
crons.interval("gmail history sync", { minutes: 10 }, internal.mail.syncAll, {});
// Abandoned public bookings release their held slot.
crons.interval("expire booking sessions", { minutes: 5 }, internal.bookings.expireSessions, {});
// Signature requests past their expiry stop accepting signatures.
crons.daily("expire signature requests", { hourUTC: 16, minuteUTC: 0 }, internal.signatures.expireRequests, {});

export default crons;
