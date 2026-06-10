/**
 * READ-ONLY dump of the LIVE trustScores/* docs (§7-J — confirm the DEPLOYED CF write).
 * Shows reputation + the new kindness fields per doc. ADC; never writes. PII-lean (ids only).
 * Run: NODE_PATH=functions/node_modules node tools/read-trustscores.js
 */
'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'the-green-haven' });
const fs = admin.firestore();

(async () => {
  const snap = await fs.collection('trustScores').get();
  console.log(`\ntrustScores docs: ${snap.size}\n`);
  snap.forEach((d) => {
    const x = d.data() || {};
    const kf = x.kindnessFactors || {};
    const ts = x.computedAt && x.computedAt.toDate ? x.computedAt.toDate().toISOString() : String(x.computedAt);
    console.log(`• ${d.id}`);
    console.log(`    reputation=${x.reputation} provisional=${x.provisional}`);
    console.log(`    kindness=${x.kindness} kindnessProvisional=${x.kindnessProvisional}`);
    console.log(`    kindnessFactors: totalEvents=${kf.totalEvents} totalPoints=${kf.totalPoints} ` +
      `(quest ${kf.questCount}/${kf.questPoints}, food ${kf.foodShareCount}/${kf.foodSharePoints}, help ${kf.helpCompletedCount}/${kf.helpCompletedPoints})`);
    console.log(`    computedAt=${ts}`);
  });
  console.log('\n(READ-ONLY — no writes.)\n');
})().then(() => process.exit(0)).catch((e) => { console.error('read failed:', e && e.message ? e.message : e); process.exit(1); });
