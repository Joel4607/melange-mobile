import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
const crons = cronJobs();
crons.cron('Refresh trust decay date', '5 0 * * *', internal.trust.refreshClock, {});
crons.cron('Clear retired buyer positions', '10 0 * * *', internal.buyerLocations.purgeRetired, {});
export default crons;
