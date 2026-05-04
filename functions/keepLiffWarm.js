/**
 * keepLiffWarm — Cloud Scheduler ping (belt-and-suspenders alongside minInstances:1)
 *
 * Hits the GET health-check endpoint on liffSignIn + liffBookingSignIn every 5 minutes.
 * Belt-and-suspenders: minInstances:1 already prevents cold starts, but GCP can occasionally
 * evict even "minimum" instances under memory pressure. This ping ensures the instance is
 * exercised regularly so any eviction is immediately replaced.
 *
 * GET /liffSignIn and GET /liffBookingSignIn return { status:'ok', ts:... } — no auth required.
 * Schedule: every 5 minutes (12×/hour, well within Cloud Scheduler free tier of 3 jobs/month free).
 */
const functions = require('firebase-functions');
const fetch = require('node-fetch');

const CF_BASE = 'https://asia-southeast1-the-green-haven.cloudfunctions.net';
const TARGETS = [
  `${CF_BASE}/liffSignIn`,
  `${CF_BASE}/liffBookingSignIn`,
];

exports.keepLiffWarm = functions
  .region('asia-southeast1')
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const results = await Promise.allSettled(
      TARGETS.map(url =>
        fetch(url, { method: 'GET', timeout: 10000 })
          .then(r => ({ url, status: r.status }))
          .catch(e => ({ url, error: e.message }))
      )
    );
    results.forEach(r => {
      const v = r.value || r.reason;
      if (v?.status === 200) {
        console.log(`✅ keepLiffWarm: ${v.url} → 200 ok`);
      } else {
        console.warn(`⚠️ keepLiffWarm: ${v?.url} → ${v?.status || v?.error}`);
      }
    });
    return null;
  });
