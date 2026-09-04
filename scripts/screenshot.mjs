// Drives the running dev server with headless Chrome and saves screenshots.
// Usage: node scripts/screenshot.mjs <outDir> [steps...]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
fs.mkdirSync(outDir, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name + '.png') }); console.log('saved', name); };
const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await new Promise((r) => setTimeout(r, 60)); } };
const clickText = async (text) => {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t), text);
  const el = handle.asElement();
  if (!el) throw new Error('no button ' + text);
  await el.click();
  await new Promise((r) => setTimeout(r, 150));
};

await shot('01-initial');
await press('n', 3);
await shot('02-single-3-steps');

// Hover the ALU to show the tooltip.
const alu = await page.$('svg .comp:nth-of-type(1)');
const hoverAt = async (sel, idx = 0, name) => {
  const els = await page.$$(sel);
  const el = els[idx];
  if (!el) { console.log('missing', sel); return; }
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, 200));
  await shot(name);
};
void alu;
await hoverAt('g.wire.kind-control.is-active', 0, '03-hover-control');
await hoverAt('g.wire.kind-data.is-active', 2, '04-hover-data');
await page.mouse.move(5, 5);

// Walk through a cycle.
await press('m', 1); await shot('05-walk-phase0');
await press('m', 2); await shot('06-walk-phase2');
await press('m', 2);

// Pipeline model with hazards example.
await page.select('select.select', 'hazards');
await new Promise((r) => setTimeout(r, 300));
await clickText('Pipeline');
await press('n', 6);
await shot('07-pipeline');
await hoverAt('g.wire.is-active', 10, '08-pipeline-hover');
await page.mouse.move(5, 5);
await clickText('Pipeline diagram');
await press('n', 6);
await shot('09-pipeline-diagram');

// Branch example, run to end.
await page.select('select.select', 'branches');
await new Promise((r) => setTimeout(r, 300));
await clickText('Run');
await clickText('Console');
await shot('10-run-console');

// Side-panel views from the activity rail.
const clickRail = async (label) => { await page.click(`.rail-btn[aria-label="${label}"]`); await new Promise((r) => setTimeout(r, 200)); };
await clickRail('Statistics'); await shot('11-stats');
await clickRail('Cache'); await shot('12-cache');
await clickRail('Reference'); await shot('13-reference');
await clickRail('Toggle theme'); await clickRail('Editor'); await shot('14-dark-editor');

console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
