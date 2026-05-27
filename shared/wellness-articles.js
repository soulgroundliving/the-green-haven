// ---- Wellness Articles (shared module) ----
// Extracted from tenant_app.html inline script.
//
// Runtime dependencies (resolved via window.* after DOMContentLoaded):
//   window._tenantAppBuilding / window._tenantAppRoom  — set by detectRoomBuilding / linkAuthUid
//   window.showPage                                    — global fn in inline script
//   window._isPlayerMode, window._playerProfile       — gamification state
//   window.GhHaptic                                   — haptic feedback
//   window.firebaseReady, window.firebase             — Firebase SDK globals
//   window._wellnessQuizMarkers                       — const {} from inline L12658, exposed L12723
//   window._bkkYm                                     — function decl in inline script

(function () {

    var WELLNESS_ARTICLES = [
        { id:'sleep-bedroom', icon:'fa-spa',        title:'3 เคล็ดลับจัดห้องนอนหลับลึก', excerpt:'ลองปรับแสงไฟโทนอุ่น และวางต้นไม้เล็กๆ ช่วยให้เช้าวันใหม่สดชื่น...',
          body:'<p><strong>1. ปรับแสงให้อุ่นก่อนนอน 1 ชั่วโมง</strong> — หลอดไฟโทนเหลือง 2700K ช่วยให้ร่างกายหลั่งเมลาโทนิน เข้าสู่โหมดพักผ่อนเร็วขึ้น</p><p><strong>2. ต้นไม้ฟอกอากาศหัวเตียง</strong> — พลูด่าง หรือลิ้นมังกร ดูดซับ CO₂ ตอนกลางคืน ช่วยให้อากาศสดชื่น หลับสนิทขึ้น</p><p><strong>3. อุณหภูมิ 24-26°C</strong> — ร่างกายหลับลึกที่สุดในช่วงนี้ ตั้งแอร์ไว้และห่มผ้าบางๆ ดีกว่าห้องเย็นจัดแล้วห่มหนา</p><p>ลองปรับแค่ 1-2 ข้อแล้วสังเกตคุณภาพการนอนในสัปดาห์นี้</p>',
          quiz: [
            { q:'แสงไฟโทนใดช่วยให้หลั่งเมลาโทนินก่อนนอน?', options:['ขาว 6500K','เหลือง 2700K','ฟ้า LED','แดง'], correctIdx:1 },
            { q:'ต้นไม้ชนิดใดดูดซับ CO₂ ตอนกลางคืน เหมาะวางหัวเตียง?', options:['ดอกทานตะวัน','พลูด่าง / ลิ้นมังกร','กระบองเพชร','กล้วยไม้'], correctIdx:1 },
            { q:'อุณหภูมิห้องที่ทำให้หลับลึกที่สุดคือเท่าไร?', options:['18-20°C','24-26°C','28-30°C','32°C+'], correctIdx:1 },
          ] },
        { id:'amethyst-power', icon:'fa-gem',       title:'พลังของ \'หินนำโชค\' อเมทิสต์', excerpt:'ทำความรู้จักกับอเมทิสต์ที่จะช่วยให้ใจคุณสงบ และดึงดูดสิ่งดีๆ...',
          body:'<p>อเมทิสต์เป็นหินในตระกูลควอตซ์สีม่วง ที่โบราณเชื่อว่าช่วย <strong>สงบจิตใจ</strong> และ <strong>ปัดเป่าพลังลบ</strong></p><p><strong>วิธีวางในห้อง:</strong> วางบนโต๊ะทำงาน (ด้านซ้ายสุด ใกล้ประตู) หรือหัวเตียง สะท้อนแสงอ่อนๆ ทำให้บรรยากาศสงบ</p><p><strong>การดูแล:</strong> ล้างด้วยน้ำเปล่าเดือนละครั้ง ตากแดดอ่อนๆ ช่วงเช้า 30 นาที เป็นการ "ชาร์จพลัง" ให้หิน</p><p>นอกจากความเชื่อ การมี object สวยๆ อยู่ในสายตาก็ช่วยลดความเครียดได้จริง</p>' },
        { id:'balcony-charge', icon:'fa-mug-hot',   title:'มุมระเบียงชาร์จพลัง', excerpt:'เปลี่ยนพื้นที่เล็กๆ ให้เป็นที่นั่งดูพระอาทิตย์ตกดินสุดพิเศษสำหรับคุณ...',
          body:'<p>ระเบียง 2×1 เมตร ก็สร้างมุมพักใจได้ ลองทำตามนี้</p><p><strong>เบาะนั่งพื้น</strong> — ซื้อเบาะผ้า waterproof ขนาด 60×60 ซม. + หมอนอิงใบใหญ่ จะได้มุมนั่งทันที</p><p><strong>ต้นไม้แนวตั้ง</strong> — แขวนกระถางพลูบนราวกันตก ประหยัดพื้นที่ + ช่วยกรองฝุ่น PM2.5</p><p><strong>โคมไฟ solar</strong> — ไม่ต้องเดินสายไฟ เก็บแสงกลางวัน กลางคืนให้แสงอุ่นธรรมชาติ</p><p>เวลาที่ดีที่สุดคือ 17:00-18:30 น. ดูแสงส้มกับดื่มชาร้อน</p>' },
        { id:'morning-ritual', icon:'fa-sun',       title:'Morning Ritual 10 นาที เริ่มวันดีทั้งวัน', excerpt:'ลองสร้างนิสัยเล็กๆ ที่ทำให้สมองพร้อมก่อนเช็คโทรศัพท์ครั้งแรก...',
          body:'<p>อย่าเพิ่งหยิบมือถือทันทีที่ตื่น เปลี่ยนเป็น 10 นาทีนี้แทน</p><p><strong>นาทีที่ 1-3:</strong> ดื่มน้ำเปล่า 1 แก้ว เปิดม่าน รับแสงแดด (รีเซ็ต circadian rhythm)</p><p><strong>นาทีที่ 4-7:</strong> ยืดกล้ามเนื้อง่ายๆ คอ ไหล่ หลัง หายใจลึกๆ 5 ครั้ง</p><p><strong>นาทีที่ 8-10:</strong> เขียน 3 สิ่งที่รู้สึกขอบคุณในสมุด (gratitude journaling)</p><p>ทำแค่ 7 วันจะเห็นความต่าง พลังงานเช้าขึ้นและอารมณ์ดีตลอดวัน</p>',
          quiz: [
            { q:'นาทีแรก 1-3 ของ Morning Ritual ทำอะไร?', options:['เช็คอีเมล','ดื่มน้ำ + รับแสงแดด','ออกกำลังกายหนัก','ทานอาหารเช้า'], correctIdx:1 },
            { q:'การเขียน gratitude journaling อยู่ในนาทีไหน?', options:['1-3','4-7','8-10','หลังอาหารเช้า'], correctIdx:2 },
            { q:'แสงแดดเช้าทำหน้าที่อะไรกับร่างกาย?', options:['ทำให้ผิวคล้ำ','รีเซ็ต circadian rhythm','ลดน้ำหนัก','เพิ่มน้ำตาลในเลือด'], correctIdx:1 },
          ] },
        { id:'aromatherapy',    icon:'fa-wind',      title:'กลิ่นที่ช่วยคลายเครียดในห้องคอนโด', excerpt:'Lavender, Bergamot, Eucalyptus — 3 กลิ่นที่ควรมีติดห้องไว้...',
          body:'<p>Aromatherapy ไม่ใช่แค่ของสวย — มีงานวิจัยยืนยันผลจริง</p><p><strong>Lavender (ลาเวนเดอร์)</strong> — ใช้ก่อนนอน 30 นาที ลดคลื่นสมองให้ผ่อนคลาย งานวิจัยพบว่าช่วยปรับปรุงคุณภาพการนอน 20%</p><p><strong>Bergamot (เบอร์กามอท)</strong> — ใช้ช่วงบ่าย ลดความวิตกกังวล ให้อารมณ์สดชื่นขึ้น</p><p><strong>Eucalyptus (ยูคาลิปตัส)</strong> — ใช้เช้า ปลุกสมองให้ตื่นตัว เหมาะช่วง WFH</p><p>ใช้ diffuser ดีกว่าเทียนหอม (ปลอดภัยในห้องเล็ก)</p>' },
        { id:'indoor-plants',   icon:'fa-leaf',      title:'5 ต้นไม้ในร่มที่เลี้ยงง่ายสุดๆ', excerpt:'ไม่ต้องรดน้ำบ่อย ไม่ต้องแดดเยอะ แต่ฟอกอากาศได้...',
          body:'<p>ต้นไม้ 5 ชนิดนี้ แม้ไม่มีมือเขียวก็เลี้ยงรอด</p><p><strong>1. พลูด่าง (Pothos)</strong> — รดน้ำสัปดาห์ละครั้ง แสงน้อยได้ ฟอก formaldehyde</p><p><strong>2. ลิ้นมังกร (Snake Plant)</strong> — ทนแล้ง ปล่อย O₂ ตอนกลางคืน (วางข้างเตียงได้)</p><p><strong>3. ZZ Plant</strong> — "ต้นฆ่าไม่ตาย" รดน้ำ 2-3 สัปดาห์ครั้ง</p><p><strong>4. Peace Lily</strong> — ดอกสวย ชอบที่ชื้น เหมาะในห้องน้ำ</p><p><strong>5. Monstera</strong> — ใบใหญ่ตระการตา โตเร็ว เติม aesthetic ให้ห้อง</p>' },
        { id:'digital-detox',   icon:'fa-mobile-alt',title:'Digital Detox 1 ชั่วโมงก่อนนอน', excerpt:'แสงสีฟ้าและการ scroll ก่อนนอน = คุณภาพการนอนแย่ลง...',
          body:'<p>งานวิจัยชัดเจน: แสงสีฟ้าจากหน้าจอกดการหลั่ง melatonin ทำให้หลับยาก + หลับไม่ลึก</p><p><strong>วิธีทำ Digital Detox:</strong></p><p>• ตั้ง alarm "bedtime mode" 1 ชม. ก่อนนอน</p><p>• วางโทรศัพท์นอกห้องนอน (ใช้นาฬิกาปลุกแทน)</p><p>• เปลี่ยนเป็น <strong>หนังสือเล่ม</strong> ฟังพอดแคสต์เบาๆ หรือเขียน journal</p><p>ยากวันแรก ง่ายวันที่ 4 หลังจากนั้นคุณภาพการนอนดีขึ้นชัดเจน</p>' },
    ];
    var WELLNESS_INITIAL = 3;
    var _wellnessShown = WELLNESS_INITIAL;
    var _wellnessList = WELLNESS_ARTICLES.slice(); // start with hardcoded fallback
    var _currentWellnessArticle = null;

    // ---- Wellness-article quiz (Phase A1: dogfood on hardcoded articles) ----
    var _quizRewardWellness = 10; // bonus pts per article quiz pass

    // โหลด wellness articles จาก Firestore (หากมี) — admin เขียนใน dashboard
    async function loadWellnessFromFirestore() {
        if (!window.firebaseReady || !window.firebase?.firestore) return;
        try {
            var db = window.firebase.firestore();
            var fns = window.firebase?.firestoreFunctions;
            if (!fns || !fns.collection || !fns.getDocs) return;
            var snap = await fns.getDocs(fns.query(fns.collection(db, 'wellness_articles'), fns.orderBy('createdAt', 'desc')));
            if (snap.empty) return;
            _wellnessList = snap.docs.map(function (d) {
                var a = d.data();
                // Derive cover image: explicit field first, else first <img> in body
                var coverImage = a.coverImage || null;
                if (!coverImage) {
                    var m = (a.body || '').match(/<img[^>]*src="([^"]+)"/i);
                    if (m) coverImage = m[1];
                }
                // Quiz: Firestore-provided field wins; else fall back to hardcoded
                // by ID match. Lets the dogfood quizzes on `sleep-bedroom` /
                // `morning-ritual` work even when admin has populated Firestore.
                var quiz = Array.isArray(a.quiz) ? a.quiz : null;
                if (!quiz) {
                    var fallback = WELLNESS_ARTICLES.find(function (x) { return x.id === d.id; });
                    if (fallback && Array.isArray(fallback.quiz)) quiz = fallback.quiz;
                }
                return {
                    id: d.id,
                    icon: (a.icon || 'fa-leaf').startsWith('fa-') ? a.icon : 'fa-' + a.icon,
                    title: a.title || '(ไม่มีชื่อ)',
                    excerpt: a.excerpt || '',
                    body: a.body || '',
                    category: a.category || 'Wellness',
                    readtime: a.readtime || 3,
                    reward: a.reward || 0,
                    coverImage: coverImage,
                    quiz: quiz || null,
                };
            });
            renderWellness();
        } catch (e) { console.warn('loadWellnessFromFirestore failed:', e); }
    }

    function renderWellness() {
        var list = document.getElementById('wellness-list');
        if (!list) return;
        var src = _wellnessList.length ? _wellnessList : WELLNESS_ARTICLES;
        var toShow = src.slice(0, _wellnessShown);
        list.innerHTML = toShow.map(function (a) { return (
            '<div class="blog-card" data-action="openWellnessArticle" data-arg="' + a.id + '" style="cursor:pointer;">' +
                '<div class="blog-img">' + (a.coverImage
                    ? '<img src="' + a.coverImage + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="">'
                    : '<i class="fas ' + a.icon + '"></i>') + '</div>' +
                '<div class="blog-content">' +
                    '<h3>' + a.title + '</h3>' +
                    '<p>' + a.excerpt + '</p>' +
                '</div>' +
            '</div>'
        ); }).join('');
        var btn = document.getElementById('wellness-load-more');
        if (btn) {
            var expanded = _wellnessShown >= src.length;
            btn.innerHTML = expanded
                ? 'ย่อกลับไป <i class="fas fa-chevron-up"></i>'
                : 'ค้นหาแรงบันดาลใจต่อ <i class="fas fa-chevron-down"></i>';
            btn.style.display = src.length > WELLNESS_INITIAL ? 'block' : 'none';
        }
    }

    function loadMoreWellness() {
        var src = _wellnessList.length ? _wellnessList : WELLNESS_ARTICLES;
        if (_wellnessShown >= src.length) {
            _wellnessShown = WELLNESS_INITIAL;
            document.getElementById('wellness-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            _wellnessShown = Math.min(_wellnessShown + 3, src.length);
        }
        renderWellness();
    }

    async function openWellnessArticle(id) {
        var src = _wellnessList.length ? _wellnessList : WELLNESS_ARTICLES;
        var a = src.find(function (x) { return x.id === id; });
        if (!a) return;
        _currentWellnessArticle = a;
        window._currentWellnessArticle = a; // expose for startWellnessQuiz (inline script)
        var $ = function (i) { return document.getElementById(i); };
        if ($('wellness-article-title')) $('wellness-article-title').textContent = a.title;
        if ($('wellness-article-icon')) {
            $('wellness-article-icon').innerHTML = a.coverImage
                ? '<img src="' + a.coverImage + '" style="width:48px;height:48px;object-fit:cover;border-radius:12px;" alt="">'
                : '<i class="fas ' + a.icon + '"></i>';
        }
        if ($('wellness-article-body')) $('wellness-article-body').innerHTML = a.body;
        var rtEl = $('wellness-article-readtime');
        if (rtEl) rtEl.textContent = 'อ่าน ' + (a.readtime || 3) + ' นาที' + (a.reward > 0 ? ' • +' + a.reward + ' pts' : '');
        var catEl = $('wellness-article-category');
        if (catEl) catEl.textContent = a.category || 'Wellness';
        // Setup claim button
        await _setupWellnessClaimUI(a);
        // Setup quiz prompt (only renders if article has a `quiz` field)
        _setupWellnessQuizPrompt(a);
        window.showPage('wellness-article');
    }

    // Check claim status + show appropriate UI (button enabled / already claimed / no reward)
    async function _setupWellnessClaimUI(a) {
        var $ = function (i) { return document.getElementById(i); };
        var area   = $('wellness-claim-area');
        var btn    = $('wellness-claim-btn');
        var pts    = $('wellness-claim-pts');
        var status = $('wellness-claim-status');
        if (!area || !btn || !pts || !status) return;
        if (!a.reward || a.reward <= 0) {
            btn.style.display = 'none';
            status.textContent = '🌿 ขอบคุณที่อ่านจนจบ';
            return;
        }
        pts.textContent = a.reward;
        btn.style.display = 'block';
        btn.disabled = false;
        btn.style.opacity = '1';
        status.textContent = '';
        // Check if already claimed — supports both tenant and player paths
        try {
            if (window.firebaseReady && typeof firebase !== 'undefined') {
                var isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
                var taBuilding = window._tenantAppBuilding || '';
                var taRoom     = window._tenantAppRoom     || '';
                if (!isPlayer && (!taBuilding || !taRoom)) return;
                var fns = window.firebase?.firestoreFunctions;
                if (fns) {
                    var db = firebase.firestore();
                    var claimPath = isPlayer
                        ? 'people/' + window._playerProfile.tenantId + '/wellnessClaimed/' + a.id
                        : 'tenants/' + taBuilding + '/list/' + taRoom + '/wellnessClaimed/' + a.id;
                    var ref  = fns.doc(db, claimPath);
                    var snap = await fns.getDoc(ref);
                    if (snap.exists()) {
                        btn.disabled = true;
                        btn.style.opacity = '.5';
                        btn.textContent = '✅ ได้รับแต้มแล้ว';
                        var claimedDate = snap.data().claimedAt;
                        status.textContent = 'รับเมื่อ ' + new Date(claimedDate).toLocaleDateString('th-TH');
                    }
                }
            }
        } catch (e) { console.warn('check claim:', e?.message); }
    }

    async function claimWellnessReward() {
        var a = _currentWellnessArticle;
        if (!a || !a.reward || a.reward <= 0) return;
        var btn    = document.getElementById('wellness-claim-btn');
        var status = document.getElementById('wellness-claim-status');
        if (!btn) return;
        var isPlayer  = window._isPlayerMode && window._playerProfile?.tenantId;
        var taBuilding = window._tenantAppBuilding || '';
        var taRoom     = window._tenantAppRoom     || '';
        if (!window.firebaseReady || typeof firebase === 'undefined' || (!isPlayer && (!taBuilding || !taRoom))) {
            if (status) status.textContent = '⚠️ ระบบยังไม่พร้อม ลองใหม่อีกครั้ง';
            return;
        }
        btn.disabled = true; btn.textContent = 'กำลังรับ...';
        try {
            var fns = window.firebase.firestoreFunctions;
            var db  = firebase.firestore();
            var claimPath = isPlayer
                ? 'people/' + window._playerProfile.tenantId + '/wellnessClaimed/' + a.id
                : 'tenants/' + taBuilding + '/list/' + taRoom + '/wellnessClaimed/' + a.id;
            var pointsPath = isPlayer
                ? 'people/' + window._playerProfile.tenantId
                : 'tenants/' + taBuilding + '/list/' + taRoom;
            // Idempotent check
            var claimRef  = fns.doc(db, claimPath);
            var claimSnap = await fns.getDoc(claimRef);
            if (claimSnap.exists()) {
                btn.textContent = '✅ ได้รับแต้มแล้ว';
                btn.style.opacity = '.5';
                if (status) status.textContent = 'คุณรับแต้มบทความนี้ไปแล้ว';
                return;
            }
            // Write claim doc
            await fns.setDoc(claimRef, {
                articleId: a.id,
                title:     a.title,
                reward:    a.reward,
                claimedAt: new Date().toISOString()
            });
            // Increment gamification points — tenant path or player path
            var pointsRef  = fns.doc(db, pointsPath);
            var pointsSnap = await fns.getDoc(pointsRef);
            var cur = pointsSnap.data() || {};
            var g   = cur.gamification || {};
            var newPts = (g.points || 0) + a.reward;
            await fns.setDoc(pointsRef, {
                gamification: Object.assign({}, g, { points: newPts, wellnessPts: (g.wellnessPts || 0) + a.reward })
            }, { merge: true });
            btn.textContent = '✅ +' + a.reward + ' pts! (รวม ' + newPts + ')';
            btn.style.opacity = '.5';
            if (status) status.textContent = '🌿 ขอบคุณที่อ่านจนจบ';
            if (typeof showToast === 'function') showToast('🎁 ได้รับ +' + a.reward + ' pts!', 'success');
            window.GhHaptic?.success();
        } catch (e) {
            console.error('claim wellness:', e);
            if (status) status.textContent = '❌ บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง';
            btn.disabled = false;
            btn.innerHTML = '🎁 อ่านจบ — รับ ' + a.reward + ' pts';
            window.GhHaptic?.error();
        }
    }

    function _wellnessQuizMonthKey(articleId) {
        var d  = new Date();
        var ym = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
        var isPlayer = window._isPlayerMode && window._playerProfile?.tenantId;
        if (isPlayer) return 'quiz_wellness_player_' + window._playerProfile.tenantId + '_' + articleId + '_' + ym;
        var taBuilding = window._tenantAppBuilding || 'x';
        var taRoom     = window._tenantAppRoom     || 'x';
        return 'quiz_wellness_' + taBuilding + '_' + taRoom + '_' + articleId + '_' + ym;
    }

    function _setupWellnessQuizPrompt(article) {
        var prompt = document.getElementById('wellness-quiz-prompt');
        var btn    = document.getElementById('wellness-quiz-start-btn');
        var desc   = document.getElementById('wellness-quiz-prompt-desc');
        var status = document.getElementById('wellness-quiz-status');
        if (!prompt) return;
        if (!article || !Array.isArray(article.quiz) || article.quiz.length === 0) {
            prompt.style.display = 'none';
            return;
        }
        prompt.style.display = 'block';
        var total = article.quiz.length;
        var passThreshold = total >= 3 ? 2 : total;
        if (desc) desc.innerHTML = 'ตอบถูก ' + passThreshold + '/' + total + ' รับ <strong style="color:var(--accent-gold,#D4AF37);">+' + _quizRewardWellness + ' bonus pts</strong> (1 ครั้ง/เดือน/บทความ)';
        // Firestore marker = source of truth (Session B); localStorage = hint.
        // Check Firestore first, then localStorage as offline fallback.
        try {
            var bkkYm = window._bkkYm ? window._bkkYm() : '';
            var fsKey  = article.id + '_' + bkkYm;
            var markers = window._wellnessQuizMarkers || {};
            var fsMarker = markers[fsKey];
            if (fsMarker) {
                btn.disabled = true;
                btn.style.opacity = '.55';
                btn.textContent = fsMarker.passed ? '✅ ทำแล้วเดือนนี้' : '📖 ทำแล้วเดือนนี้ (ไม่ผ่าน)';
                if (status) status.textContent = 'ลองอีกครั้งเดือนหน้า • ตอบถูก ' + fsMarker.score + '/' + fsMarker.total;
                return;
            }
            var prior = localStorage.getItem(_wellnessQuizMonthKey(article.id));
            if (prior) {
                var parsed = JSON.parse(prior);
                btn.disabled = true;
                btn.style.opacity = '.55';
                btn.textContent = parsed.passed ? '✅ ทำแล้วเดือนนี้' : '📖 ทำแล้วเดือนนี้ (ไม่ผ่าน)';
                if (status) status.textContent = 'ลองอีกครั้งเดือนหน้า • ตอบถูก ' + parsed.score + '/' + parsed.total;
                return;
            }
        } catch (e) { /* fall through to enabled */ }
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '📝 เริ่มทำ Quiz';
        if (status) status.textContent = '';
    }

    // ---- Expose to window ----
    window.openWellnessArticle       = openWellnessArticle;
    window.claimWellnessReward       = claimWellnessReward;
    window.loadMoreWellness          = loadMoreWellness;
    window.loadWellnessFromFirestore = loadWellnessFromFirestore;
    window.renderWellness            = renderWellness;   // called from initTenantApp
    window._setupWellnessQuizPrompt  = _setupWellnessQuizPrompt;
    window._wellnessQuizMonthKey     = _wellnessQuizMonthKey;
    window._quizRewardWellness       = _quizRewardWellness;
    // Returns the current article list (Firestore overrides hardcoded once loaded).
    // Used by renderQuizHistory / renderQuizHub in the inline script.
    window._getWellnessArticles = function () {
        return _wellnessList.length ? _wellnessList : WELLNESS_ARTICLES;
    };

}());
