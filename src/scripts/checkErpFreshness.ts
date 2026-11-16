#!/usr/bin/env node
/**
 * ERP Static Data Freshness Check
 * Checks DataMall portal for updated ERP datasets (SHP + PDF)
 * Re-parses and re-seeds if changed
 * Usage: npm run check:erp-freshness
 * 
 * Can be scheduled as weekly cron on Render/GitHub Actions
 */

import https from 'https';
import { createWriteStream, createReadStream } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = 'C:/Users/tanbb/erp-data';
const STATE_FILE = path.join(DATA_DIR, '.freshness-state.json');

// DataMall static dataset URLs (from portal)
const DATASETS = {
  gantry_shp: {
    url: 'https://datamall.lta.gov.sg/content/dam/datamall/datasets/Geospatial/ERPGantry_Sep2026.zip',
    localZip: path.join(DATA_DIR, 'ERPGantry_latest.zip'),
    extractDir: path.join(DATA_DIR, 'ERPGantry_latest'),
    stateKey: 'gantry_shp',
  },
  rates_pdf: {
    url: 'https://datamall.lta.gov.sg/content/dam/datamall/datasets/Facts_Figures/Traffic_and_Trips/ERP%20Rates.zip',
    localZip: path.join(DATA_DIR, 'ERPRates_latest.zip'),
    extractDir: path.join(DATA_DIR, 'ERPRates_latest'),
    stateKey: 'rates_pdf',
  },
};

interface DatasetInfo {
  url: string;
  localZip: string;
  extractDir: string;
  stateKey: string;
}

interface FreshnessEntry {
  etag?: string;
  lastModified?: string;
  contentHash?: string;
  checkedAt: string;
}

interface FreshnessState {
  [key: string]: FreshnessEntry | undefined;
  gantry_shp?: FreshnessEntry;
  rates_pdf?: FreshnessEntry;
}

async function loadState(): Promise<FreshnessState> {
  try {
    const content = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveState(state: FreshnessState): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchHead(url: string): Promise<{ etag?: string; lastModified?: string; contentLength?: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD' }, (res) => {
      resolve({
        etag: res.headers.etag,
        lastModified: res.headers['last-modified'],
        contentLength: res.headers['content-length'] ? parseInt(res.headers['content-length']) : undefined,
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('HEAD request timeout')));
    req.end();
  });
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', reject);
  });
}

async function computeHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function extractZip(zipPath: string, extractDir: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);
}

async function checkDataset(key: string, dataset: DatasetInfo, state: FreshnessState): Promise<boolean> {
  console.log(`\n🔍 Checking ${key}...`);
  
  const head = await fetchHead(dataset.url);
  console.log(`   ETag: ${head.etag || 'N/A'}`);
  console.log(`   Last-Modified: ${head.lastModified || 'N/A'}`);
  console.log(`   Content-Length: ${head.contentLength || 'N/A'}`);

  const prev = state[dataset.stateKey];
  const currentEtag = head.etag || '';
  const currentLastMod = head.lastModified || '';

  // Quick check: if ETag or Last-Modified changed, download and verify
  if (prev?.etag === currentEtag && prev?.lastModified === currentLastMod) {
    console.log(`   ✓ No change detected (ETag/Last-Modified match)`);
    return false;
  }

  console.log(`   ⬇️  Change detected, downloading...`);
  await downloadFile(dataset.url, dataset.localZip);
  
  const contentHash = await computeHash(dataset.localZip);
  console.log(`   SHA256: ${contentHash}`);

  if (prev?.contentHash === contentHash) {
    console.log(`   ✓ Content unchanged (hash match)`);
    // Update state with new headers
    state[dataset.stateKey] = { etag: currentEtag, lastModified: currentLastMod, contentHash, checkedAt: new Date().toISOString() };
    return false;
  }

  console.log(`   📦 Content changed! Extracting...`);
  await extractZip(dataset.localZip, dataset.extractDir);
  
  state[dataset.stateKey] = { etag: currentEtag, lastModified: currentLastMod, contentHash, checkedAt: new Date().toISOString() };
  return true;
}

async function runParseScripts(): Promise<void> {
  console.log('\n🔄 Running parse scripts...');
  
  // Run the Python parse script
  try {
    execSync('python3 C:/Users/tanbb/opencode/parse_erp_fixed.py', { stdio: 'inherit', cwd: process.cwd() });
    console.log('✓ Parse script completed');
  } catch (e) {
    console.error('❌ Parse script failed:', e);
    throw e;
  }

  // Run the Node sync script
  try {
    execSync('npm run sync:erp', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('✓ Sync script completed');
  } catch (e) {
    console.error('❌ Sync script failed:', e);
    throw e;
  }
}

async function main() {
  console.log('=== ERP Static Data Freshness Check ===');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Data dir: ${DATA_DIR}`);

  const state = await loadState();
  let anyChanged = false;

  try {
    for (const [key, dataset] of Object.entries(DATASETS)) {
      const changed = await checkDataset(key, dataset, state);
      if (changed) anyChanged = true;
    }

    if (anyChanged) {
      console.log('\n📊 Changes detected, re-parsing and re-seeding...');
      await runParseScripts();
      console.log('\n✅ Freshness check complete - data updated!');
    } else {
      console.log('\n✅ Freshness check complete - no changes needed');
    }

    await saveState(state);
  } catch (err) {
    console.error('\n❌ Freshness check failed:', err);
    process.exit(1);
  }
}

main();