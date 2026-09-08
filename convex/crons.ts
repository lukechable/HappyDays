import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Gmail push subscriptions last 7 days; renew daily so they never lapse.
crons.daily("renew gmail watches", { hourUTC: 15, minuteUTC: 0 }, internal.google.renewAllWatches, {});
// Gmail push (Pub/Sub) syncs a mailbox the moment it changes; this hourly pass only catches accounts whose push
// watch has lapsed or that have not synced in a while, so it costs almost nothing on a normal day.
crons.interval("gmail history sync", { hours: 1 }, internal.mail.syncAll, {});
// Abandoned public bookings release their held slot. Reads already ignore expired holds, so this is housekeeping.
crons.interval("expire booking sessions", { minutes: 30 }, internal.bookings.expireSessions, {});
// Reschedule requests spotted in mail get the "Already rescheduled" pill once the appointment moves in Cliniko.
crons.interval("recheck reschedule requests", { hours: 4 }, internal.bookings.recheckReschedules, {});
// Signature requests past their expiry stop accepting signatures.
crons.daily("expire signature requests", { hourUTC: 16, minuteUTC: 0 }, internal.signatures.expireRequests, {});

export default crons;
