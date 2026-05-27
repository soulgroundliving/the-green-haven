/**
 * keepLiffWarm — Cloud Scheduler ping to keep CF instances warm at $0 cost.
 *
 * Pings 5 CFs every 5 minutes via GET. onRequest CFs return 200; onCall CFs return 405
 * (method not allowed for GET) but Cloud Run still spins up the instance — effective warm.
 * Schedule: every 5 minutes (well within Cloud Scheduler free tier of 3 jobs/month free).
 */
const functions = require('firebase-functions/v1');
const fetch = require('node-fetch');

const CF_BASE = 'https://asia-southeast1-the-green-haven.cloudfunctions.net';

// onRequest CFs respond 200 to GET; onCall CFs respond 405 but still warm the instance.
const TARGETS = [
  { url: `${CF_BASE}/liffSignIn`,            callable: false },
  { url: `${CF_BASE}/liffBookingSignIn`,     callable: false },
  { url: `${CF_BASE}/verifySlip`,            callable: false },
  { url: `${CF_BASE}/claimDailyLoginPoints`, callable: true  },
  { url: `${CF_BASE}/getLeaderboard`,        callable: true  },
];

exports.keepLiffWarm = functions
  .region('asia-southeast1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const results = await Promise.allSettled(
      TARGETS.map(({ url, callable }) =>
        fetch(url, { method: 'GET', timeout: 10000 })
          .then(r => ({ url, status: r.status, callable }))
          .catch(e => ({ url, error: e.message, callable }))
      )
    );
    results.forEach(r => {
      const v = r.value || r.reason;
      if (v?.status === 200) {
        console.info(`✅ keepLiffWarm: ${v.url} → 200 ok`);
      } else if (v?.status === 405 && v?.callable) {
        console.info(`✅ keepLiffWarm: ${v.url} → 405 callable warm ok`);
      } else {
        console.warn(`⚠️ keepLiffWarm: ${v?.url} → ${v?.status || v?.error}`);
      }
    });
    return null;
  });
