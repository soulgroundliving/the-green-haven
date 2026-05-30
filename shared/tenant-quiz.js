// ===== QUIZ SYSTEM (Contract Quiz + Wellness Quiz markers + Hub/History renders) =====
// Extracted from tenant_app.html. Exports:
//   window._bkkYm               — Bangkok year-month helper
//   window._wellnessQuizMarkers  — Firestore marker map (live object, mutated by subscription)
//   window._contractQuizMarkers  — Firestore marker map (live object, mutated by subscription)
//   window._getContractQuizMarker — marker lookup helper
//   window._quizRewardContract   — default 20 pts
//   window.setupContractQuizGate — called from renderContractPage() + closeContractQuiz()
//   window.startContractQuiz / submitContractQuiz / closeContractQuiz — data-action dispatcher
//   window.renderQuizQuestion    — called from startContractQuiz
//   window.startWellnessQuiz     — data-action dispatcher
//   window.awardQuizPoints       — called from inline script after quiz completion
//   window.renderQuizHub         — called from markCommunityRead() + _onLiffClaimsReady
//   window.renderQuizHistory     — called from markCommunityRead() + _onLiffClaimsReady
//
// _subscribeQuizMarkers wired internally via window._onLiffClaimsReady() inside IIFE.
// Shared state: _taBuilding/_taRoom (var globals), _taLease (var global from tenant-liff-auth.js)

(function () { 'use strict';
// ---- Contract Quiz (MVP) ----
let _quizState = null; // { questions:[{q,options:[],correctIdx}], answers:{}, current:0 }
let _quizDwellTimer = null;

function _quizMonthKey() {
    const d = new Date();
    return `quiz_contract_${_taBuilding||'x'}_${_taRoom||'x'}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}

// ===== Session B — server-trusted quiz marker subscriptions ===========
// Watches Firestore subcollections written by claimWellnessQuizPoints +
// claimContractQuizPoints CFs. Demotes localStorage to a hint — Firestore
// is the source of truth.
//
// §7-U: claim-first guard (wait for _taBuilding/_taRoom)
// §7-N: error callback on every onSnapshot
// §7-V: tear down prior listener before re-attaching
// §7-KK: do NOT clear localStorage hint on cached/pending-writes snapshots
let _wellnessQuizUnsub = null;
let _contractQuizUnsub = null;
const _wellnessQuizMarkers = {}; // articleId_ym → { passed, score, total, at, reward }
const _contractQuizMarkers = {}; // ym → { passed, score, total, at, reward }

function _bkkYm() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _subscribeQuizMarkers() {
    if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
    const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
    // §7-U: wait for claims — tenant needs building/room, player needs tenantId
    if (!isPlayer && (!_taBuilding || !_taRoom)) return;
    // §7-V: tear down prior listeners before re-attaching
    if (typeof _wellnessQuizUnsub === 'function') { try { _wellnessQuizUnsub(); } catch (_) {} _wellnessQuizUnsub = null; }
    if (typeof _contractQuizUnsub === 'function') { try { _contractQuizUnsub(); } catch (_) {} _contractQuizUnsub = null; }
    try {
        const fs = window.firebase.firestoreFunctions;
        const db = window.firebase.firestore();
        const wellnessRef = isPlayer
            ? fs.collection(db, `people/${window._playerProfile.tenantId}/wellnessQuizPassed`)
            : fs.collection(db, `tenants/${_taBuilding}/list/${_taRoom}/wellnessQuizPassed`);
        _wellnessQuizUnsub = fs.onSnapshot(wellnessRef, snap => {
            // Wipe + repopulate the markers map. We don't reconcile localStorage
            // hints here for absent keys — only refresh when server explicitly
            // says something. (§7-KK: cached snapshots are not authoritative for
            // marker-absence; only confirmed-server snapshots are.)
            Object.keys(_wellnessQuizMarkers).forEach(k => delete _wellnessQuizMarkers[k]);
            snap.forEach(d => { _wellnessQuizMarkers[d.id] = d.data() || {}; });
            // Refresh visible quiz hub / history / article prompt
            try {
                if (document.getElementById('community-quiz-hub')) renderQuizHub();
                if (document.getElementById('quiz-history-list')) renderQuizHistory();
                if (window._currentWellnessArticle && typeof window._setupWellnessQuizPrompt === 'function') window._setupWellnessQuizPrompt(window._currentWellnessArticle);
            } catch (uiErr) { console.warn('quiz UI refresh failed:', uiErr?.message); }
        }, err => {
            console.warn('[wellnessQuizPassed] subscribe failed:', err?.message || err);
            // §7-U recovery: if claims were stripped mid-flight, reset unsub so
            // _onLiffClaimsReady retry path can re-attach when claims return.
            if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
                _wellnessQuizUnsub = null;
            }
        });
        if (!isPlayer) {
            const contractRef = fs.collection(db, `tenants/${_taBuilding}/list/${_taRoom}/contractQuizPassed`);
            _contractQuizUnsub = fs.onSnapshot(contractRef, snap => {
                Object.keys(_contractQuizMarkers).forEach(k => delete _contractQuizMarkers[k]);
                snap.forEach(d => { _contractQuizMarkers[d.id] = d.data() || {}; });
                try {
                    setupContractQuizGate();
                    if (document.getElementById('community-quiz-hub')) renderQuizHub();
                    if (document.getElementById('quiz-history-list')) renderQuizHistory();
                } catch (uiErr) { console.warn('contract quiz UI refresh failed:', uiErr?.message); }
            }, err => {
                console.warn('[contractQuizPassed] subscribe failed:', err?.message || err);
                if (err?.code === 'permission-denied' || err?.code === 'failed-precondition') {
                    _contractQuizUnsub = null;
                }
            });
        }
    } catch (e) {
        console.warn('quiz markers subscribe init failed:', e?.message || e);
    }
}

// Quiz contract reward — default 20 pts.
// Override via localStorage `quiz_reward_contract` (dev/manual).
// (Removed Firestore `settings/{building}.quiz.contractRewardPoints` read:
//  no admin UI ever wrote there and the `settings` collection doesn't exist.
//  If admin tunable is needed later, add to system/policies.quiz.* SSoT.)
let _quizRewardContract = 20;
async function loadQuizRewardConfig() {
    const local = parseInt(localStorage.getItem('quiz_reward_contract') || '0');
    if (local > 0) _quizRewardContract = local;
}

function setupContractQuizGate() {
    const section = document.getElementById('contract-quiz-section');
    const btn = document.getElementById('contract-quiz-start-btn');
    const label = document.getElementById('contract-quiz-btn-label');
    if (!section || !btn || !label) return;
    loadQuizRewardConfig().then(() => {
        // แสดงค่า rewardPoints ที่ admin ตั้งในคำอธิบาย
        const descEl = section.querySelector('p');
        if (descEl) descEl.innerHTML = `ทำ quiz ตอบถูก 2/3 ได้ <strong class="u-color-green">+${_quizRewardContract} pts</strong> (ทำได้ 1 ครั้ง/เดือน)`;
    });
    // already done this month?
    // Firestore marker = source of truth (Session B). localStorage = hint
    // for offline / pre-claim window. Either present → gate locked.
    const fsMarker = (typeof window._getContractQuizMarker === 'function') ? window._getContractQuizMarker() : null;
    if (fsMarker || localStorage.getItem(_quizMonthKey())) {
        btn.disabled = true;
        label.textContent = '✓ ทำ quiz เดือนนี้แล้ว (เดือนหน้าทำได้อีก)';
        btn.style.opacity = '0.6';
        return;
    }
    // dwell lock — unlock หลัง 10 วิ
    btn.disabled = true;
    btn.style.opacity = '0.6';
    label.textContent = 'อ่าน 10 วินาที เพื่อปลดล็อก…';
    let sec = 10;
    if (_quizDwellTimer) clearInterval(_quizDwellTimer);
    _quizDwellTimer = setInterval(() => {
        sec--;
        if (sec <= 0) {
            clearInterval(_quizDwellTimer);
            btn.disabled = false;
            btn.style.opacity = '1';
            label.textContent = `📝 เริ่มทำ Quiz รับ +${_quizRewardContract || 20} pts`;
        } else {
            label.textContent = `อ่าน ${sec} วินาที เพื่อปลดล็อก…`;
        }
    }, 1000);
}

function _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function _thaiDate(d) {
    try { return new Date(d).toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'}); }
    catch(e) { return String(d); }
}

function buildContractQuiz() {
    const lease = _taLease || {};
    const endRaw = lease.endDate || lease.moveOutDate;
    const rent = lease.rentAmount || lease.rent || lease.monthlyRent || 0;

    // Q1 — วันสิ้นสุดสัญญา
    const q1Options = [];
    if (endRaw) {
        const correct = _thaiDate(endRaw);
        const d = new Date(endRaw);
        const opts = [
            correct,
            _thaiDate(new Date(d.getFullYear()-1, d.getMonth(), d.getDate())),
            _thaiDate(new Date(d.getFullYear()+1, d.getMonth(), d.getDate())),
            _thaiDate(new Date(d.getFullYear(), d.getMonth()+3, d.getDate())),
        ];
        q1Options.push(...opts);
    }

    // Q2 — ค่าเช่ารายเดือน
    const q2Options = [];
    if (rent) {
        const r = Number(rent);
        q2Options.push(r, r - 1000, r + 1000, r + 2500);
    }

    // Q3 — แจ้งย้ายออกล่วงหน้ากี่วัน (fixed rule from lease terms)
    const questions = [];
    if (q1Options.length) {
        const shuffled = _shuffle([...q1Options]);
        questions.push({
            q: 'สัญญาของคุณสิ้นสุดวันใด?',
            options: shuffled.map(x => String(x)),
            correctIdx: shuffled.indexOf(q1Options[0]),
        });
    }
    if (q2Options.length) {
        const shuffled = _shuffle([...q2Options]);
        questions.push({
            q: 'ค่าเช่ารายเดือนของห้องคุณคือเท่าไร?',
            options: shuffled.map(x => Number(x).toLocaleString('th-TH') + ' บาท'),
            correctIdx: shuffled.indexOf(q2Options[0]),
        });
    }
    // Fallback pool — นโยบายทั่วไป (ใช้เสมอเมื่อคำถามจาก lease ไม่ครบ 3)
    const pool = [
        { q: 'ต้องแจ้งย้ายออกล่วงหน้าอย่างน้อยกี่วัน?', opts: ['7 วัน','15 วัน','30 วัน','60 วัน'], correct: '30 วัน' },
        { q: 'เงินประกัน (deposit) ปกติกี่เดือน?', opts: ['1 เดือน','2 เดือน','3 เดือน','6 เดือน'], correct: '2 เดือน' },
        { q: 'ผิดสัญญาก่อนครบกำหนด จะเสียอะไร?', opts: ['ค่าปรับ 500 บาท','ไม่ได้เงินประกันคืน','ค่าเช่าเพิ่ม','ไม่เสียอะไร'], correct: 'ไม่ได้เงินประกันคืน' },
        { q: 'ค่าเช่าต้องชำระภายในวันที่เท่าไรของเดือน?', opts: ['วันที่ 1','วันที่ 5','วันที่ 10','สิ้นเดือน'], correct: 'วันที่ 5' },
    ];
    _shuffle(pool);
    while (questions.length < 3 && pool.length) {
        const item = pool.shift();
        const shuffled = _shuffle([...item.opts]);
        questions.push({ q: item.q, options: shuffled, correctIdx: shuffled.indexOf(item.correct) });
    }
    return questions.slice(0, 3);
}

function startContractQuiz() {
    if (localStorage.getItem(_quizMonthKey())) { toast('ทำ quiz เดือนนี้แล้ว เดือนหน้าค่อยทำอีก', 'info'); return; }
    const questions = buildContractQuiz();
    if (!questions.length) { toast('ยังไม่มีข้อมูลสัญญา ลองรีเฟรชหน้า', 'warning'); return; }
    _quizState = { questions, answers: {}, current: 0, source: { type: 'contract' } };
    // Reset title — wellness quiz may have changed it
    const titleEl = document.getElementById('quiz-title');
    if (titleEl) titleEl.textContent = 'Contract Quiz';
    document.getElementById('quiz-modal').style.display = 'flex';
    document.getElementById('quiz-result').style.display = 'none';
    document.getElementById('quiz-submit-btn').onclick = submitContractQuiz;
    document.getElementById('quiz-submit-btn').textContent = 'ถัดไป';
    renderQuizQuestion();
}

function renderQuizQuestion() {
    const st = _quizState; if (!st) return;
    const q = st.questions[st.current];
    document.getElementById('quiz-progress').textContent = `${st.current+1}/${st.questions.length}`;
    document.getElementById('quiz-question').textContent = q.q;
    const optsEl = document.getElementById('quiz-options');
    optsEl.innerHTML = '';
    q.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'padding:12px 14px; border-radius:12px; border:1.5px solid var(--border); background:#fff; text-align:left; font-family:inherit; font-size:var(--fs-md); cursor:pointer;';
        btn.textContent = opt;
        btn.onclick = () => {
            st.answers[st.current] = idx;
            [...optsEl.children].forEach(c => {
                c.style.borderColor = 'var(--border)';
                c.style.background = '#fff';
            });
            btn.style.borderColor = 'var(--primary-green)';
            btn.style.background = 'var(--soft-green)';
            document.getElementById('quiz-submit-btn').disabled = false;
        };
        if (st.answers[st.current] === idx) {
            btn.style.borderColor = 'var(--primary-green)';
            btn.style.background = 'var(--soft-green)';
        }
        optsEl.appendChild(btn);
    });
    const submit = document.getElementById('quiz-submit-btn');
    submit.disabled = (st.answers[st.current] === undefined);
    submit.textContent = (st.current === st.questions.length - 1) ? 'ส่งคำตอบ' : 'ถัดไป';
}

// Submit + close handle BOTH contract quiz and wellness-article quiz —
// dispatch on _quizState.source ('contract' default | {type:'wellness', articleId}).
// Server (claimContractQuizPoints / claimWellnessQuizPoints) grades authoritatively;
// client preview is shown immediately while CF round-trips (~1-3s).
async function submitContractQuiz() {
    const st = _quizState; if (!st) return;
    if (st.current < st.questions.length - 1) {
        st.current++;
        renderQuizQuestion();
        return;
    }
    // Client-side preview score (server is authoritative; this only shapes the UI):
    let previewCorrect = 0;
    st.questions.forEach((q, i) => { if (st.answers[i] === q.correctIdx) previewCorrect++; });
    const total = st.questions.length;
    const passThreshold = total >= 3 ? 2 : total;
    const previewPassed = previewCorrect >= passThreshold;
    const isWellness = st.source && st.source.type === 'wellness';
    const monthKey = isWellness
        ? (window._wellnessQuizMonthKey ? window._wellnessQuizMonthKey(st.source.articleId) : '')
        : _quizMonthKey();
    const reward = isWellness ? (st.reward || window._quizRewardWellness || 10) : (_quizRewardContract || 20);
    // Optimistic localStorage hint — server marker (Firestore) is SoT.
    // §7-KK: this is overwritten if server says otherwise.
    localStorage.setItem(monthKey, JSON.stringify({ score: previewCorrect, total, passed: previewPassed, at: Date.now() }));
    // Show result UI immediately (no waiting for CF)
    document.getElementById('quiz-question').textContent = '';
    document.getElementById('quiz-options').innerHTML = '';
    const resEl = document.getElementById('quiz-result');
    resEl.style.display = 'block';
    resEl.innerHTML = previewPassed
        ? `<div class="u-fs-3rem">🎉</div><strong class="u-color-green">ตอบถูก ${previewCorrect}/${total}</strong><p class="ta-muted-6">กำลังบันทึก... <strong class="u-color-gold">+${reward} pts</strong></p>`
        : `<div class="u-fs-3rem">📖</div><strong>ตอบถูก ${previewCorrect}/${total}</strong><p class="ta-muted-6">ต้องตอบถูก ${passThreshold}/${total} ถึงได้แต้ม<br>ลองเดือนหน้านะครับ</p>`;
    document.getElementById('quiz-submit-btn').textContent = 'ปิด';
    document.getElementById('quiz-submit-btn').disabled = false;
    document.getElementById('quiz-submit-btn').onclick = closeContractQuiz;

    // Server-side claim — authoritative grading + points.
    try {
        const fns = window.firebase?.functions;
        if (!fns) throw new Error('Firebase Functions SDK not loaded');
        let resp;
        if (isWellness) {
            const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
            if (!isPlayer && (!_taBuilding || !_taRoom)) throw new Error('ยังไม่พบข้อมูลห้อง');
            const callable = fns.httpsCallable('claimWellnessQuizPoints');
            const answers = st.questions.map((_, i) => st.answers[i] != null ? Number(st.answers[i]) : -1);
            const payload = isPlayer
                ? { tenantId: window._playerProfile.tenantId, articleId: st.source.articleId, answers }
                : { building: _taBuilding, roomId: String(_taRoom), articleId: st.source.articleId, answers };
            resp = await callable(payload);
        } else {
            if (!_taBuilding || !_taRoom) throw new Error('ยังไม่พบข้อมูลห้อง');
            // Map client question state to server answer shape. Q1 = leaseEndDate,
            // Q2 = monthlyRent (when present), Q3+ = policy (q text matched server-side).
            // Send literal answer STRINGS — server doesn't trust correctIdx.
            const answers = st.questions.map((q, i) => {
                const optStr = q.options[st.answers[i]] != null ? String(q.options[st.answers[i]]) : '';
                if (/สิ้นสุดวันใด/.test(q.q)) return { kind: 'leaseEndDate', userAnswer: optStr };
                if (/ค่าเช่า.*เดือน/.test(q.q)) return { kind: 'monthlyRent', userAnswer: optStr };
                return { kind: 'policy', q: q.q, userAnswer: optStr };
            });
            const callable = fns.httpsCallable('claimContractQuizPoints');
            resp = await callable({
                building: _taBuilding,
                roomId: String(_taRoom),
                answers,
            });
        }
        const r = resp.data || {};
        // Server-confirmed result — overwrite optimistic marker if server disagrees.
        localStorage.setItem(monthKey, JSON.stringify({
            score: r.score, total: r.total, passed: !!r.passed, reward: r.reward || 0, at: Date.now(),
        }));
        // Refresh result UI with server's actual answer.
        if (typeof r.passed === 'boolean') {
            resEl.innerHTML = r.passed
                ? `<div class="u-fs-3rem">🎉</div><strong class="u-color-green">ตอบถูก ${r.score}/${r.total}</strong><p class="ta-muted-6">ได้รับ <strong class="u-color-gold">+${r.reward} pts</strong></p>`
                : `<div class="u-fs-3rem">📖</div><strong>ตอบถูก ${r.score}/${r.total}</strong><p class="ta-muted-6">ต้องตอบถูก ${r.passThreshold}/${r.total} ถึงได้แต้ม<br>ลองเดือนหน้านะครับ</p>`;
        }
        if (typeof r.pointsAfter === 'number' && typeof loadGamificationData === 'function') {
            loadGamificationData(); // refresh Quest Ecosystem display
        }
    } catch (err) {
        const code = err?.code || err?.details?.code || '';
        if (code === 'functions/already-exists') {
            toast('ทำ quiz เดือนนี้แล้ว', 'info');
        } else {
            console.warn('quiz claim failed:', err);
            // Rollback optimistic marker so user can retry.
            localStorage.removeItem(monthKey);
            toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error');
        }
    }
}

function closeContractQuiz() {
    document.getElementById('quiz-modal').style.display = 'none';
    document.getElementById('quiz-submit-btn').onclick = submitContractQuiz;
    const prevSource = _quizState && _quizState.source;
    _quizState = null;
    // Refresh whichever gate UI was the entry point so the locked/unlocked state updates
    if (prevSource && prevSource.type === 'wellness' && window._currentWellnessArticle) {
        if (typeof window._setupWellnessQuizPrompt === 'function') window._setupWellnessQuizPrompt(window._currentWellnessArticle);
    } else {
        setupContractQuizGate();
    }
    // Also refresh the community Quiz Hub + Quiz History so badges/history update without page reload
    if (typeof renderQuizHub === 'function' && document.getElementById('community-quiz-hub')) {
        renderQuizHub();
    }
    if (typeof renderQuizHistory === 'function' && document.getElementById('quiz-history-list')) {
        renderQuizHistory();
    }
}

// ---- Wellness-article quiz helpers — extracted to shared/wellness-articles.js ----
// _quizRewardWellness / _wellnessQuizMonthKey / _setupWellnessQuizPrompt
// are all exposed on window by that deferred script.

function startWellnessQuiz() {
    const article = window._currentWellnessArticle;
    if (!article || !Array.isArray(article.quiz) || article.quiz.length === 0) {
        toast('บทความนี้ยังไม่มี quiz', 'info');
        return;
    }
    // Firestore marker beats localStorage as gate (Session B)
    const ym = _bkkYm();
    const fsKey = `${article.id}_${ym}`;
    const monthKeyFn = window._wellnessQuizMonthKey;
    if ((_wellnessQuizMarkers && _wellnessQuizMarkers[fsKey]) || (monthKeyFn && localStorage.getItem(monthKeyFn(article.id)))) {
        toast('ทำ quiz บทความนี้แล้วเดือนนี้ เดือนหน้าค่อยทำอีก', 'info');
        return;
    }
    // Each question's options stay in given order — author already designed them
    const questions = article.quiz.map(q => ({
        q: q.q,
        options: q.options.slice(),
        correctIdx: q.correctIdx,
    }));
    _quizState = {
        questions, answers: {}, current: 0,
        source: { type: 'wellness', articleId: article.id },
        reward: window._quizRewardWellness || 10,
    };
    // Reuse the SAME contract-quiz modal — just retitle for context
    const titleEl = document.getElementById('quiz-title');
    if (titleEl) titleEl.textContent = `Quiz: ${article.title || 'Wellness'}`;
    document.getElementById('quiz-modal').style.display = 'flex';
    document.getElementById('quiz-result').style.display = 'none';
    document.getElementById('quiz-submit-btn').onclick = submitContractQuiz; // reset in case prior close swapped
    document.getElementById('quiz-submit-btn').textContent = 'ถัดไป';
    renderQuizQuestion();
}

function awardQuizPoints(n) {
    const _b = window._tenantAppBuilding || 'unknown';
    const _r = window._tenantAppRoom     || 'unknown';
    const key = `tenant_eco_points_${_b}_${_r}`;
    const cur = parseInt(localStorage.getItem(key) || '0') || 0;
    const next = cur + n;
    localStorage.setItem(key, String(next));
    // best-effort Firestore sync (ถ้า TenantFirebaseSync มี)
    try {
        if (typeof TenantFirebaseSync !== 'undefined' && window.firebaseReady && _r !== 'unknown') {
            const userStr = sessionStorage.getItem('user');
            const user = userStr ? JSON.parse(userStr) : { roomNumber: _r };
            TenantFirebaseSync.initialize(user, _b, _r);
            if (typeof TenantFirebaseSync.logQuizResult === 'function') TenantFirebaseSync.logQuizResult('contract', n);
            else if (typeof TenantFirebaseSync.addPoints === 'function') TenantFirebaseSync.addPoints(n, 'contract_quiz');
        }
    } catch(_){}
    loadGamificationData();
}

    window._onLiffClaimsReady(_subscribeQuizMarkers);

    // ── Render helpers ────────────────────────────────────────────────────────
    // Moved from tenant_app.html inline script — depend on private IIFE state
    // (_quizMonthKey, _wellnessQuizMarkers, _contractQuizMarkers, _bkkYm, etc.)

    // Quiz History — past attempts (passed + not passed). Session B: Firestore
    // markers (wellnessQuizPassed/contractQuizPassed subcoll) are SoT; localStorage
    // is a fallback for months before Session B migration / offline writes.
    // Sorted newest first, capped at 10.
    function renderQuizHistory() {
        const list = document.getElementById('quiz-history-list');
        if (!list) return;
        const entries = [];
        const wellnessSrc = window._getWellnessArticles ? window._getWellnessArticles() : [];
        const isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
        const _toMillis = (v) => {
            if (v == null) return 0;
            if (typeof v === 'number') return v;
            if (typeof v.toMillis === 'function') return v.toMillis();
            if (v.seconds) return v.seconds * 1000;
            const t = new Date(v).getTime();
            return isNaN(t) ? 0 : t;
        };
        const seenKeys = new Set();
        // 1. Firestore wellness markers (authoritative, including current month)
        for (const fsKey of Object.keys(_wellnessQuizMarkers || {})) {
            const m = _wellnessQuizMarkers[fsKey];
            if (!m) continue;
            const parts = fsKey.split('_');
            if (parts.length < 2) continue;
            const ym = parts[parts.length - 1];
            const articleId = parts.slice(0, -1).join('_');
            const art = wellnessSrc.find(x => x.id === articleId);
            seenKeys.add(`w:${articleId}:${ym}`);
            entries.push({ at: _toMillis(m.at), title: art ? art.title : (articleId || 'Wellness Quiz'),
                icon: '🌿', score: m.score, total: m.total, passed: m.passed, reward: m.reward });
        }
        // 2. Firestore contract markers (tenant-only)
        if (!isPlayer) {
            for (const ym of Object.keys(_contractQuizMarkers || {})) {
                const m = _contractQuizMarkers[ym];
                if (!m) continue;
                seenKeys.add(`c:${ym}`);
                entries.push({ at: _toMillis(m.at), title: 'Contract Quiz', icon: '📜',
                    score: m.score, total: m.total, passed: m.passed, reward: m.reward });
            }
        }
        // 3. localStorage fallback — only for entries Firestore doesn't already have.
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (!/^quiz_(contract|wellness)_/.test(k)) continue;
            if (isPlayer) continue;
            if (k.startsWith('quiz_wellness_player_')) continue;
            let p;
            try { p = JSON.parse(localStorage.getItem(k) || '{}'); } catch(e) { continue; }
            if (!p || typeof p.at !== 'number') continue;
            const m6 = k.match(/_(\d{6})$/);
            const ym = m6 ? `${m6[1].slice(0,4)}-${m6[1].slice(4,6)}` : '';
            let title = 'Contract Quiz', icon = '📜', dedup = `c:${ym}`;
            if (k.startsWith('quiz_wellness_')) {
                const parts = k.replace(/_(\d{6})$/, '').split('_');
                const articleId = parts.slice(4).join('_');
                const art = wellnessSrc.find(x => x.id === articleId);
                title = art ? art.title : (articleId || 'Wellness Quiz');
                icon = '🌿'; dedup = `w:${articleId}:${ym}`;
            }
            if (seenKeys.has(dedup)) continue;
            entries.push({ at: p.at, title, icon, score: p.score, total: p.total, passed: p.passed });
        }
        entries.sort((a, b) => b.at - a.at);
        const top = entries.slice(0, 10);
        if (top.length === 0) {
            list.innerHTML = `<div class="ta-empty-card">ยังไม่มีประวัติการทำ Quiz</div>`;
            return;
        }
        list.innerHTML = top.map(e => {
            const pillBg = e.passed ? '#dcfce7' : '#fef3c7';
            const pillColor = e.passed ? '#15803d' : '#92400e';
            const pillText = e.passed ? `✓ ผ่าน +${(e.title === 'Contract Quiz' ? _quizRewardContract : (window._quizRewardWellness || 10))} pts` : 'ไม่ผ่าน';
            const dateStr = new Date(e.at).toLocaleDateString('th-TH', {day:'numeric', month:'short', year:'numeric'});
            return `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:#fff;border:1px solid var(--border);border-radius:12px;">
                <div style="font-size:1.4rem;flex:0 0 auto;">${e.icon}</div>
                <div class="u-flex-1-min0">
                    <div style="font-weight:600;font-size:var(--fs-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.title}</div>
                    <div style="font-size:var(--fs-sm);color:var(--text-muted);">${dateStr} • ตอบถูก ${e.score}/${e.total}</div>
                </div>
                <span style="background:${pillBg};color:${pillColor};padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:700;flex:0 0 auto;">${pillText}</span>
            </div>`;
        }).join('');
    }

    // Quiz Hub (Phase A2) — list every quiz available to the tenant with status.
    // Includes Contract Quiz (always) + each wellness article whose data carries a quiz field.
    // localStorage markers determine status: ✅ done this month / 🟡 ready / ⏰ next month.
    function renderQuizHub() {
        const list = document.getElementById('quiz-hub-list');
        if (!list) return;
        const cards = [];
        // 1. Contract Quiz card — only if there's a lease.
        // Source-of-truth: Firestore _contractQuizMarkers; localStorage hint fallback.
        if (_taLease && (_taLease.endDate || _taLease.moveOutDate)) {
            const fsMarker = _contractQuizMarkers[_bkkYm()] || null;
            let done = !!fsMarker, scoreLine = '';
            if (fsMarker && typeof fsMarker.score === 'number') {
                scoreLine = `ตอบถูก ${fsMarker.score}/${fsMarker.total}`;
            } else {
                try {
                    const ls = localStorage.getItem(_quizMonthKey());
                    if (ls) { done = true; const p = JSON.parse(ls); if (p && typeof p.score === 'number') scoreLine = `ตอบถูก ${p.score}/${p.total}`; }
                } catch(e) {}
            }
            cards.push({ title:'Contract Quiz', subtitle:'รู้จักสัญญาของคุณดีแค่ไหน',
                pts: _quizRewardContract || 20, done, scoreLine,
                action:'startContractQuiz', arg:'', icon:'📜' });
        }
        // 2. Wellness article quizzes — Firestore markers first, localStorage hint fallback.
        const src = window._getWellnessArticles ? window._getWellnessArticles() : [];
        const ym = _bkkYm();
        for (const a of src) {
            if (!Array.isArray(a.quiz) || a.quiz.length === 0) continue;
            const fsKey = `${a.id}_${ym}`;
            const fsMarker = _wellnessQuizMarkers && _wellnessQuizMarkers[fsKey];
            let done = !!fsMarker, scoreLine = '';
            if (fsMarker && typeof fsMarker.score === 'number') {
                scoreLine = `ตอบถูก ${fsMarker.score}/${fsMarker.total}`;
            } else {
                const monthKey = window._wellnessQuizMonthKey ? window._wellnessQuizMonthKey(a.id) : '';
                try {
                    const ls = monthKey ? localStorage.getItem(monthKey) : null;
                    if (ls) { done = true; const p = JSON.parse(ls); if (p && typeof p.score === 'number') scoreLine = `ตอบถูก ${p.score}/${p.total}`; }
                } catch(e) {}
            }
            cards.push({ title:a.title, subtitle:a.category||'Wellness',
                pts: window._quizRewardWellness || 10, done, scoreLine,
                action:'openWellnessArticle', arg:a.id, icon:'🌿' });
        }
        if (cards.length === 0) {
            list.innerHTML = '<div class="gh-empty-state ta-empty-state">ยังไม่มี quiz พร้อมใช้งาน</div>';
            return;
        }
        list.innerHTML = cards.map(c => {
            const statusBadge = c.done
                ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700;">✅ ทำแล้ว</span>`
                : `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-size:.72rem;font-weight:700;">🟡 พร้อม</span>`;
            const subline = c.done && c.scoreLine
                ? `<span style="color:var(--text-muted);">${c.scoreLine} • รออีกเดือนหน้า</span>`
                : `<span style="color:var(--accent-gold,#D4AF37);font-weight:700;">+${c.pts} pts</span>`;
            const argAttr = c.arg ? ` data-arg="${c.arg}"` : '';
            return `<button class="quiz-hub-card" data-action="${c.action}"${argAttr}
                style="display:flex;align-items:center;gap:12px;padding:14px;background:#fff;border:1px solid var(--border);border-radius:14px;cursor:pointer;text-align:left;font-family:inherit;width:100%;${c.done?'opacity:.72;':''}">
                <div style="font-size:1.6rem;flex:0 0 auto;">${c.icon}</div>
                <div class="u-flex-1-min0">
                    <div style="font-weight:700;font-size:var(--fs-md);color:var(--text-dark);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.title}</div>
                    <div style="font-size:var(--fs-sm);color:var(--text-muted);margin-top:2px;">${c.subtitle}</div>
                    <div style="font-size:var(--fs-sm);margin-top:4px;">${subline}</div>
                </div>
                <div style="flex:0 0 auto;">${statusBadge}</div>
            </button>`;
        }).join('');
    }

    window._bkkYm                    = _bkkYm;
    window._wellnessQuizMarkers      = _wellnessQuizMarkers;
    window._contractQuizMarkers      = _contractQuizMarkers;
    window._getContractQuizMarker    = (ym) => _contractQuizMarkers[ym || _bkkYm()] || null;
    window._quizRewardContract       = _quizRewardContract;
    window.setupContractQuizGate     = setupContractQuizGate;
    window.startContractQuiz         = startContractQuiz;
    window.renderQuizQuestion        = renderQuizQuestion;
    window.submitContractQuiz        = submitContractQuiz;
    window.closeContractQuiz         = closeContractQuiz;
    window.startWellnessQuiz         = startWellnessQuiz;
    window.awardQuizPoints           = awardQuizPoints;
    window.renderQuizHistory         = renderQuizHistory;
    window.renderQuizHub             = renderQuizHub;
})();
