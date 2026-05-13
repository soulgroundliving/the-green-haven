/**
 * ChecklistManager — client-side facade for Move-In/Out Checklist (Tier 3I).
 *
 * Exposes:
 *   getTemplate(building)                    → template doc or null
 *   saveTemplate(building, templateData)      → void
 *   createInstance(data)                      → { instanceId }
 *   getMyPendingInstance(tenantUid)           → instance doc or null
 *   getActiveInstanceForRoom(building, roomId) → pending/submitted instance or null
 *   subscribeAdminInstances(building, cb)     → unsub fn
 *   uploadPhoto(instanceId, building, roomId, itemId, file) → storagePath
 *   uploadSignature(instanceId, building, roomId, dataUrl)  → storagePath
 *   submitChecklist(instanceId, items, tenantSignaturePath) → { submitted }
 *   adminSignChecklist(instanceId, adminSignaturePath)      → { signed }
 *   getSignedUrl(storagePath)                 → download URL
 *
 * Depends on canonical Firebase globals (set in dashboard.html / tenant_app.html):
 *   window.firebase.firestore()           — Firestore instance (function call)
 *   window.firebase.firestoreFunctions    — { collection, doc, getDoc, setDoc, query, where, orderBy, onSnapshot, ... }
 *   window.firebase.storage()             — Storage instance (function call)
 *   window.firebase.storageFunctions      — { ref, uploadBytes, getDownloadURL, ... }
 *   window.firebase.functions             — { httpsCallable(name) } static object
 *
 * UMD-style: sets window.ChecklistManager.
 */
(function() {
  'use strict';

  // ── Firebase SDK helpers (canonical window.firebase.* pattern) ─────────
  function _db()  { return window.firebase?.firestore?.(); }
  function _fs()  { return window.firebase?.firestoreFunctions; }
  function _st()  { return window.firebase?.storage?.(); }
  function _sf()  { return window.firebase?.storageFunctions; }

  function _collection(path) { return _fs().collection(_db(), path); }
  function _doc(path)        { return _fs().doc(_db(), path); }
  function _getDoc(ref)      { return _fs().getDoc(ref); }
  function _setDoc(ref, data){ return _fs().setDoc(ref, data); }
  function _query(...args)   { return _fs().query(...args); }
  function _where(...args)   { return _fs().where(...args); }
  function _orderBy(...args) { return _fs().orderBy(...args); }
  function _onSnapshot(ref, cb, errCb) { return _fs().onSnapshot(ref, cb, errCb); }

  // window.firebase.functions is a static object { httpsCallable(name) }, NOT a function.
  function _httpsCallable(name) {
    const fn = window.firebase?.functions?.httpsCallable?.(name);
    if (!fn) throw new Error(`[ChecklistManager] CF "${name}" not available — firebase.functions not ready`);
    return fn;
  }
  function _storageRef(path) { return _sf().ref(_st(), path); }
  function _uploadBytes(ref, data, meta) { return _sf().uploadBytes(ref, data, meta); }
  function _getDownloadURL(ref) { return _sf().getDownloadURL(ref); }

  // ── Template ───────────────────────────────────────────────────────────

  /**
   * Fetch the checklist template for a building.
   * @param {string} building
   * @returns {Promise<object|null>}
   */
  async function getTemplate(building) {
    const snap = await _getDoc(_doc(`checklistTemplates/${building}`));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  /**
   * Admin saves (overwrites) the template for a building.
   * @param {string} building
   * @param {{ items: Array<{id:string, label:string}> }} templateData
   */
  async function saveTemplate(building, templateData) {
    await _setDoc(_doc(`checklistTemplates/${building}`), {
      building,
      items: templateData.items || [],
      updatedAt: new Date().toISOString(),
    });
  }

  // ── Instances ──────────────────────────────────────────────────────────

  /**
   * Admin callable — create a checklist instance for a tenant.
   * @param {{ building, roomId, tenantUid, tenantRoom, tenantName, type }} data
   * @returns {Promise<{ instanceId: string }>}
   */
  async function createInstance(data) {
    const fn = _httpsCallable('createChecklistInstance');
    const res = await fn(data);
    return res.data;
  }

  /**
   * Tenant — get their most recent checklist instance (any status except archived).
   * Uses a single equality filter so no composite index is needed.
   * Client-side sort by createdAt desc (tenants have at most a handful of instances).
   * @param {string} tenantUid
   * @returns {Promise<object|null>}
   */
  async function getMyLatestInstance(tenantUid) {
    if (!tenantUid) throw new Error('tenantUid required');
    const q = _query(
      _collection('checklistInstances'),
      _where('tenantUid', '==', tenantUid)
    );
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsub = null;
      const finish = (cb) => { if (settled) return; settled = true; try { unsub && unsub(); } catch (_) {} cb(); };
      // Hard timeout — if Firestore rules silently delay (e.g. claims not yet
      // propagated), surface a real error instead of hanging on ⏳ forever.
      const timer = setTimeout(() => finish(() => reject(new Error('คิวรีหมดเวลา — ลองรีเฟรชอีกครั้ง'))), 10000);
      unsub = _onSnapshot(q, (snap) => {
        clearTimeout(timer);
        finish(() => {
          if (snap.empty) { resolve(null); return; }
          const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => {
            const aMs = a.createdAt?.toMillis?.() ?? 0;
            const bMs = b.createdAt?.toMillis?.() ?? 0;
            return bMs - aMs;
          });
          resolve(docs[0]);
        });
      }, (err) => {
        clearTimeout(timer);
        console.error('[ChecklistManager] getMyLatestInstance failed:', err);
        finish(() => reject(err));
      });
    });
  }

  /** @deprecated use getMyLatestInstance */
  const getMyPendingInstance = getMyLatestInstance;

  /**
   * Admin — subscribe to all instances for a building (live).
   * @param {string} building
   * @param {function} cb  called with Array<instance doc>
   * @returns {function} unsub
   */
  function subscribeAdminInstances(building, cb, errCb) {
    const q = _query(
      _collection('checklistInstances'),
      _where('building', '==', building),
      _orderBy('createdAt', 'desc')
    );
    return _onSnapshot(q, (snap) => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('[ChecklistManager] subscribeAdminInstances failed:', err);
      if (errCb) errCb(err);
    });
  }

  // ── Storage ───────────────────────────────────────────────────────────

  /**
   * Upload a single item photo blob to Storage.
   * @returns {Promise<string>} Storage path
   */
  async function uploadPhoto(instanceId, building, roomId, itemId, file) {
    const ext = file.name ? file.name.split('.').pop().toLowerCase() : 'jpg';
    const path = `checklists/${building}/${roomId}/${instanceId}/item_${itemId}.${ext}`;
    const ref = _storageRef(path);
    await _uploadBytes(ref, file);
    return path;
  }

  /**
   * Upload a base64 data-URL signature PNG to Storage.
   * @param {string} dataUrl  e.g. "data:image/png;base64,..."
   * @returns {Promise<string>} Storage path
   */
  async function uploadSignature(instanceId, building, roomId, dataUrl) {
    const path = `checklists/${building}/${roomId}/${instanceId}/signature_tenant.png`;
    const ref = _storageRef(path);

    // Convert data-URL to Blob
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await _uploadBytes(ref, blob, { contentType: 'image/png' });
    return path;
  }

  /**
   * Upload admin signature data-URL to Storage.
   * @returns {Promise<string>} Storage path
   */
  async function uploadAdminSignature(instanceId, building, roomId, dataUrl) {
    const path = `checklists/${building}/${roomId}/${instanceId}/signature_admin.png`;
    const ref = _storageRef(path);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await _uploadBytes(ref, blob, { contentType: 'image/png' });
    return path;
  }

  /**
   * Get a download URL for a storage path.
   * @param {string} storagePath
   * @returns {Promise<string>} URL
   */
  async function getSignedUrl(storagePath) {
    const ref = _storageRef(storagePath);
    return _getDownloadURL(ref);
  }

  // ── CF calls ───────────────────────────────────────────────────────────

  /**
   * Tenant submits the completed checklist.
   * @param {string} instanceId
   * @param {Array}  items  filled item objects
   * @param {string} tenantSignaturePath  Storage path
   * @returns {Promise<{ submitted: true }>}
   */
  async function submitChecklist(instanceId, items, tenantSignaturePath) {
    const fn = _httpsCallable('submitChecklist');
    const res = await fn({ instanceId, items, tenantSignaturePath });
    return res.data;
  }

  /**
   * Admin co-signs a submitted checklist.
   * @param {string} instanceId
   * @param {string} adminSignaturePath  Storage path
   * @returns {Promise<{ signed: true }>}
   */
  async function adminSignChecklist(instanceId, adminSignaturePath) {
    const fn = _httpsCallable('adminSignChecklist');
    const res = await fn({ instanceId, adminSignaturePath });
    return res.data;
  }

  /**
   * Admin deletes a checklist instance (Firestore doc + all Storage assets
   * under checklists/{building}/{roomId}/{instanceId}/).
   * @param {string} instanceId
   * @returns {Promise<{ deleted: true, storageFilesDeleted: number }>}
   */
  async function deleteInstance(instanceId) {
    const fn = _httpsCallable('deleteChecklistInstance');
    const res = await fn({ instanceId });
    return res.data;
  }

  /**
   * Admin duplicate guard — find any non-archived instance for a specific room
   * that is still in pending or submitted status.
   * Single equality filter on roomId; client-side status filter avoids index.
   * @param {string} building
   * @param {string} roomId
   * @returns {Promise<object|null>} first active instance, or null
   */
  async function getActiveInstanceForRoom(building, roomId) {
    const q = _query(
      _collection('checklistInstances'),
      _where('building', '==', building),
      _where('roomId', '==', roomId)
    );
    return new Promise((resolve, reject) => {
      const unsub = _onSnapshot(q, (snap) => {
        unsub();
        if (snap.empty) { resolve(null); return; }
        const active = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.status === 'pending' || d.status === 'submitted');
        active.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        resolve(active[0] || null);
      }, (err) => { unsub(); reject(err); });
    });
  }

  // ── Export ────────────────────────────────────────────────────────────

  window.ChecklistManager = {
    getTemplate,
    saveTemplate,
    createInstance,
    getMyLatestInstance,
    getMyPendingInstance,
    getActiveInstanceForRoom,
    subscribeAdminInstances,
    uploadPhoto,
    uploadSignature,
    uploadAdminSignature,
    getSignedUrl,
    submitChecklist,
    adminSignChecklist,
    deleteInstance,
  };
})();
