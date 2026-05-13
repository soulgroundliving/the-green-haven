/**
 * ChecklistManager — client-side facade for Move-In/Out Checklist (Tier 3I).
 *
 * Exposes:
 *   getTemplate(building)                    → template doc or null
 *   saveTemplate(building, templateData)      → void
 *   createInstance(data)                      → { instanceId }
 *   getMyPendingInstance(tenantUid)           → instance doc or null
 *   subscribeAdminInstances(building, cb)     → unsub fn
 *   uploadPhoto(instanceId, building, roomId, itemId, file) → storagePath
 *   uploadSignature(instanceId, building, roomId, dataUrl)  → storagePath
 *   submitChecklist(instanceId, items, tenantSignaturePath) → { submitted }
 *   adminSignChecklist(instanceId, adminSignaturePath)      → { signed }
 *   getSignedUrl(storagePath)                 → download URL
 *
 * Depends on globals set by shared Firebase init:
 *   window.firebaseFirestore, window.firebaseFunctions
 *   window.firebaseStorage, window.firebaseStorageRef,
 *   window.firebaseStorageUploadBytes, window.firebaseStorageGetDownloadURL
 *
 * UMD-style: sets window.ChecklistManager.
 */
(function() {
  'use strict';

  // ── Firebase SDK helpers (set by shared init) ──────────────────────────
  function _db()  { return window.firebaseFirestore; }
  function _fns() { return window.firebaseFunctions; }
  function _st()  { return window.firebaseStorage; }

  function _collection(path) {
    return window.firebaseCollection
      ? window.firebaseCollection(_db(), path)
      : window.firebaseFirestoreFunctions.collection(_db(), path);
  }
  function _doc(path) {
    return window.firebaseDoc
      ? window.firebaseDoc(_db(), path)
      : window.firebaseFirestoreFunctions.doc(_db(), path);
  }
  function _getDoc(ref) {
    return window.firebaseGetDoc
      ? window.firebaseGetDoc(ref)
      : window.firebaseFirestoreFunctions.getDoc(ref);
  }
  function _setDoc(ref, data) {
    return window.firebaseSetDoc
      ? window.firebaseSetDoc(ref, data)
      : window.firebaseFirestoreFunctions.setDoc(ref, data);
  }
  function _query(...args) {
    return window.firebaseQuery
      ? window.firebaseQuery(...args)
      : window.firebaseFirestoreFunctions.query(...args);
  }
  function _where(...args) {
    return window.firebaseWhere
      ? window.firebaseWhere(...args)
      : window.firebaseFirestoreFunctions.where(...args);
  }
  function _orderBy(...args) {
    return window.firebaseOrderBy
      ? window.firebaseOrderBy(...args)
      : window.firebaseFirestoreFunctions.orderBy(...args);
  }
  function _onSnapshot(ref, cb) {
    return window.firebaseOnSnapshot
      ? window.firebaseOnSnapshot(ref, cb)
      : window.firebaseFirestoreFunctions.onSnapshot(ref, cb);
  }
  function _httpsCallable(name) {
    return window.firebaseHttpsCallable
      ? window.firebaseHttpsCallable(_fns(), name)
      : window.firebaseFirestoreFunctions.httpsCallable(_fns(), name);
  }
  function _storageRef(path) {
    return window.firebaseStorageRef(_st(), path);
  }

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
   * Tenant — get their most recent pending checklist instance (if any).
   * @param {string} tenantUid
   * @returns {Promise<object|null>}
   */
  async function getMyPendingInstance(tenantUid) {
    const q = _query(
      _collection('checklistInstances'),
      _where('tenantUid', '==', tenantUid),
      _where('status', '==', 'pending'),
      _orderBy('createdAt', 'desc')
    );
    return new Promise((resolve) => {
      const unsub = _onSnapshot(q, (snap) => {
        unsub();
        if (snap.empty) { resolve(null); return; }
        const d = snap.docs[0];
        resolve({ id: d.id, ...d.data() });
      });
    });
  }

  /**
   * Admin — subscribe to all instances for a building (live).
   * @param {string} building
   * @param {function} cb  called with Array<instance doc>
   * @returns {function} unsub
   */
  function subscribeAdminInstances(building, cb) {
    const q = _query(
      _collection('checklistInstances'),
      _where('building', '==', building),
      _orderBy('createdAt', 'desc')
    );
    return _onSnapshot(q, (snap) => {
      cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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
    await window.firebaseStorageUploadBytes(ref, file);
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
    await window.firebaseStorageUploadBytes(ref, blob, { contentType: 'image/png' });
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
    await window.firebaseStorageUploadBytes(ref, blob, { contentType: 'image/png' });
    return path;
  }

  /**
   * Get a download URL for a storage path.
   * @param {string} storagePath
   * @returns {Promise<string>} URL
   */
  async function getSignedUrl(storagePath) {
    const ref = _storageRef(storagePath);
    return window.firebaseStorageGetDownloadURL(ref);
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

  // ── Export ────────────────────────────────────────────────────────────

  window.ChecklistManager = {
    getTemplate,
    saveTemplate,
    createInstance,
    getMyPendingInstance,
    subscribeAdminInstances,
    uploadPhoto,
    uploadSignature,
    uploadAdminSignature,
    getSignedUrl,
    submitChecklist,
    adminSignChecklist,
  };
})();
