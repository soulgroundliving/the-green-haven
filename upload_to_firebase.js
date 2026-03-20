#!/usr/bin/env node
/**
 * Firebase Meter Data Upload Script
 * Uploads extracted meter data from JSON to Firestore
 *
 * Usage: node upload_to_firebase.js [--dry-run] [--batch-size=50]
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const CONFIG = {
  dataFile: path.join(__dirname, 'meter_data_export.json'),
  batchSize: parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50'),
  dryRun: process.argv.includes('--dry-run'),
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'the-green-haven-d9b20'
};

class FirebaseUploader {
  constructor() {
    this.db = null;
    this.data = null;
    this.uploaded = 0;
    this.failed = 0;
    this.errors = [];
  }

  /**
   * Initialize Firebase Admin SDK
   */
  async initialize() {
    try {
      // Check if Firebase app is already initialized
      if (admin.apps.length === 0) {
        // Try to load service account from environment
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

        if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
          const serviceAccount = require(serviceAccountPath);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: CONFIG.projectId
          });
          console.log('✓ Firebase initialized with service account key');
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
          // Load from environment variable
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: CONFIG.projectId
          });
          console.log('✓ Firebase initialized with service account JSON');
        } else {
          // Use default credentials (useful for Google Cloud environments)
          admin.initializeApp({
            projectId: CONFIG.projectId
          });
          console.log('✓ Firebase initialized with default credentials');
        }
      }

      this.db = admin.firestore();
      return true;
    } catch (error) {
      console.error('✗ Firebase initialization failed:', error.message);
      console.error('\nPlease set one of:');
      console.error('  - FIREBASE_SERVICE_ACCOUNT_PATH: path to service account JSON');
      console.error('  - FIREBASE_SERVICE_ACCOUNT_JSON: service account JSON as string');
      return false;
    }
  }

  /**
   * Load meter data from JSON file
   */
  loadData() {
    try {
      if (!fs.existsSync(CONFIG.dataFile)) {
        console.error(`✗ Data file not found: ${CONFIG.dataFile}`);
        return false;
      }

      const content = fs.readFileSync(CONFIG.dataFile, 'utf-8');
      const json = JSON.parse(content);

      if (!Array.isArray(json.data)) {
        console.error('✗ Invalid data format: expected data array');
        return false;
      }

      this.data = json.data;
      console.log(`✓ Loaded ${this.data.length} records from ${CONFIG.dataFile}`);
      return true;
    } catch (error) {
      console.error('✗ Failed to load data:', error.message);
      return false;
    }
  }

  /**
   * Generate document ID from meter data
   */
  generateDocId(doc) {
    return `${doc.building}_${doc.year}_${doc.month}_${doc.roomId}`;
  }

  /**
   * Validate meter data document
   */
  validateDoc(doc) {
    const required = ['building', 'year', 'month', 'roomId', 'wOld', 'wNew', 'eOld', 'eNew'];
    for (const field of required) {
      if (doc[field] === undefined || doc[field] === null) {
        return `Missing required field: ${field}`;
      }
    }
    return null;
  }

  /**
   * Upload data to Firestore
   */
  async upload() {
    if (CONFIG.dryRun) {
      console.log('\n--- DRY RUN MODE ---\n');
    }

    console.log(`\nUploading ${this.data.length} documents to Firestore...`);
    console.log(`Batch size: ${CONFIG.batchSize}`);
    console.log('Collection: meter_data\n');

    let batch = this.db.batch();
    let batchCount = 0;
    let docCount = 0;

    for (const doc of this.data) {
      // Validate document
      const error = this.validateDoc(doc);
      if (error) {
        this.failed++;
        this.errors.push({ docId: this.generateDocId(doc), error });
        continue;
      }

      const docId = this.generateDocId(doc);
      docCount++;

      if (CONFIG.dryRun) {
        if (docCount <= 3) {
          console.log(`[DRY] Document: ${docId}`);
          console.log(`      ${JSON.stringify(doc, null, 2)}`);
        }
      } else {
        const docRef = this.db.collection('meter_data').doc(docId);
        batch.set(docRef, doc);
        batchCount++;

        // Commit batch when it reaches the size limit
        if (batchCount >= CONFIG.batchSize) {
          try {
            await batch.commit();
            this.uploaded += batchCount;
            console.log(`✓ Committed batch: ${batchCount} documents (total: ${this.uploaded})`);
            batch = this.db.batch();
            batchCount = 0;
          } catch (error) {
            console.error(`✗ Batch commit failed: ${error.message}`);
            this.failed += batchCount;
            batch = this.db.batch();
            batchCount = 0;
          }
        }
      }
    }

    // Commit remaining batch
    if (batchCount > 0 && !CONFIG.dryRun) {
      try {
        await batch.commit();
        this.uploaded += batchCount;
        console.log(`✓ Committed final batch: ${batchCount} documents (total: ${this.uploaded})`);
      } catch (error) {
        console.error(`✗ Final batch commit failed: ${error.message}`);
        this.failed += batchCount;
      }
    }

    if (CONFIG.dryRun) {
      console.log(`\n[DRY] Would upload ${this.data.length} documents`);
      console.log(`[DRY] Validation errors: ${this.failed}`);
    }
  }

  /**
   * Generate report
   */
  report() {
    console.log('\n' + '='.repeat(60));
    console.log('UPLOAD REPORT');
    console.log('='.repeat(60));

    if (CONFIG.dryRun) {
      console.log('\nMode: DRY RUN (no data was uploaded)');
    }

    console.log(`\nTotal records processed: ${this.data.length}`);

    if (!CONFIG.dryRun) {
      console.log(`Successfully uploaded: ${this.uploaded}`);
      console.log(`Failed: ${this.failed}`);
    }

    // Group by year-month
    const byYearMonth = {};
    for (const doc of this.data) {
      const key = `${doc.year}-${String(doc.month).padStart(2, '0')}`;
      byYearMonth[key] = (byYearMonth[key] || 0) + 1;
    }

    console.log('\nRecords by Year-Month:');
    for (const key of Object.keys(byYearMonth).sort()) {
      console.log(`  ${key}: ${byYearMonth[key]} records`);
    }

    // Group by building
    const byBuilding = {};
    for (const doc of this.data) {
      byBuilding[doc.building] = (byBuilding[doc.building] || 0) + 1;
    }

    console.log('\nRecords by Building:');
    for (const [building, count] of Object.entries(byBuilding)) {
      console.log(`  ${building}: ${count} records`);
    }

    if (this.errors.length > 0) {
      console.log(`\nValidation Errors: ${this.errors.length}`);
      for (const err of this.errors.slice(0, 5)) {
        console.log(`  ${err.docId}: ${err.error}`);
      }
      if (this.errors.length > 5) {
        console.log(`  ... and ${this.errors.length - 5} more`);
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║     Firebase Meter Data Upload                         ║');
  console.log('║     Project: the-green-haven                           ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const uploader = new FirebaseUploader();

  // Initialize Firebase
  console.log('Initializing Firebase...');
  if (!await uploader.initialize()) {
    process.exit(1);
  }

  // Load data
  console.log('\nLoading meter data...');
  if (!uploader.loadData()) {
    process.exit(1);
  }

  // Upload
  await uploader.upload();

  // Report
  uploader.report();

  console.log('✓ Process complete!');
  process.exit(0);
}

main().catch(error => {
  console.error('✗ Fatal error:', error);
  process.exit(1);
});
