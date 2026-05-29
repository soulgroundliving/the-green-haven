#!/usr/bin/env node
/**
 * Replace inline style patterns inside JS innerHTML strings (and static HTML)
 * with the CSS classes defined in the <style> block.
 *
 * Each entry: [oldFragment, newFragment]
 * Replacements are exact substring matches — safe to run multiple times (idempotent).
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'tenant_app.html');

let html = fs.readFileSync(FILE, 'utf8');
const original = html;
let total = 0;

const SUBS = [
  // ── h3 modal headings ────────────────────────────────────────────────────
  ['<h3 style="color: var(--primary-green); margin-top:0;">',
   '<h3 class="ta-modal-h3">'],
  ['<h3 style="margin-top:0;">',
   '<h3 class="ta-modal-h3-plain">'],

  // ── slip-drop placeholder ────────────────────────────────────────────────
  ['<div style="border:2px dashed #ccc; padding:20px; text-align:center; border-radius:15px; background:#fdfdfd;">',
   '<div class="ta-slip-slot">'],

  // ── error messages ────────────────────────────────────────────────────────
  ['<p data-err="market" style="padding:20px;text-align:center;color:var(--text-muted);font-size:var(--fs-sm);">',
   '<p data-err="market" class="ta-err-msg-lg">'],
  ['<p data-err="pets" style="padding:16px;text-align:center;color:var(--text-muted);font-size:var(--fs-sm);">',
   '<p data-err="pets" class="ta-err-msg">'],
  ['<p style="text-align:center;color:var(--danger);padding:16px;">',
   '<p class="ta-err-danger">'],

  // ── empty-state / no-data messages ───────────────────────────────────────
  ['<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:var(--fs-sm);background:#fff;border:1px dashed var(--border);border-radius:12px;">',
   '<div class="ta-empty-card">'],
  ['<div class="gh-empty-state" style="padding:16px;text-align:center;color:var(--text-muted);">',
   '<div class="gh-empty-state ta-empty-state">'],
  ['<p style="color:var(--text-muted);text-align:center;padding:24px 0;">',
   '<p class="ta-loading-state">'],

  // ── loading spinner wrapper ───────────────────────────────────────────────
  ['<div style="text-align:center;padding:24px 0;color:var(--text-muted);">',
   '<div class="ta-loading-state">'],
  ['<i class="fas fa-spinner fa-spin" style="font-size:22px;">',
   '<i class="fas fa-spinner fa-spin ta-spinner-icon">'],

  // ── emoji decorators ─────────────────────────────────────────────────────
  ['<div style="font-size:3rem; margin-bottom:16px;">',
   '<div class="ta-emoji-lg">'],
  ['<div style="font-size:2.5rem;margin-bottom:10px;">',
   '<div class="ta-emoji-xl">'],

  // ── icon / camera ─────────────────────────────────────────────────────────
  ['<i class="fas fa-camera" style="color:var(--primary-green); font-size:var(--fs-lg); display:block; margin-bottom:8px;"></i>',
   '<i class="fas fa-camera ta-cam-icon"></i>'],

  // ── add-pet CTA card ─────────────────────────────────────────────────────
  ['style="border:2px dashed #e0e0e0;padding:30px 20px;border-radius:25px;text-align:center;cursor:pointer;background:#fff;"',
   'class="ta-add-cta"'],

  // ── service-provider icon span ────────────────────────────────────────────
  [`<span style="font-size:1.6rem;">\${_esc(p.icon||'🔧')}</span>`,
   `<span class="ta-icon-1-6rem">\${_esc(p.icon||'🔧')}</span>`],

  // ── receipt preview wrap ─────────────────────────────────────────────────
  ['<div style="padding:1rem;">',
   '<div class="ta-preview-wrap">'],
];

for (const [from, to] of SUBS) {
  const before = html;
  html = html.split(from).join(to);   // global replace, no regex needed
  const hits = (before.split(from).length - 1);
  if (hits > 0) {
    console.log(`  [${hits}×] ${from.slice(0, 60).padEnd(62)} → ...${to.slice(-30).trimStart()}`);
    total += hits;
  }
}

const remaining = (html.match(/style="/g) || []).length;
console.log(`\nTotal replacements : ${total}`);
console.log(`Remaining style="  : ${remaining}`);

if (html !== original) {
  fs.writeFileSync(FILE, html, 'utf8');
  console.log('✅ tenant_app.html updated.');
} else {
  console.log('ℹ️  No changes made.');
}
