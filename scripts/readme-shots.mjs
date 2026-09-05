// Captures the screenshots embedded in README.md.
// Start the dev server first (npm run dev:web), then: node scripts/readme-shots.mjs [outDir]
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';

const outDir = process.argv[2] ?? 'docs/media';
fs.mkdirSync(outDir, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 950, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Captured at 2x for sharp text, then downsampled to CSS size so the files stay
// small enough to live in the repo.
const resizer = await browser.newPage();
await page.bringToFront();
const halve = async (buf) => {
  const data = await resizer.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(img.width / 2);
    c.height = Math.round(img.height / 2);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').split(',')[1];
  }, buf.toString('base64'));
  return Buffer.from(data, 'base64');
};
const shot = async (name, el) => {
  const buf = await (el ?? page).screenshot();
  fs.writeFileSync(path.join(outDir, name + '.png'), await halve(buf));
  console.log('saved', name);
};
const press = async (key, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(key); await wait(90); } };
const clickText = async (text) => {
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t), text);
  const el = handle.asElement();
  if (!el) throw new Error('no button ' + text);
  await el.click();
  await wait(250);
};
const clickRail = async (label) => { await page.click(`.rail-btn[aria-label="${label}"]`); await wait(300); };
const unhover = async () => { await page.mouse.move(8, 940); await wait(150); };
const hover = async (sel, idx = 0) => {
  const els = await page.$$(sel);
  const el = els[idx];
  if (!el) { console.log('MISSING', sel, idx); return false; }
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await wait(350);
  return true;
};
/** Move the cursor onto the datapath block whose label reads `label`. */
const hoverLabel = async (label, dx = 0, dy = 0) => {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('svg text')].find((n) => n.textContent.trim() === t);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!box) { console.log('MISSING label', label); return false; }
  await page.mouse.move(box.x + dx, box.y + dy);
  await wait(400);
  const shown = await page.$('.tooltip');
  if (!shown) console.log('no tooltip for', label);
  return !!shown;
};

const example = async (value) => {
  await page.select('select.select', value);
  await wait(400);
};

// ---- 1. Hero: single-cycle datapath mid-execution with a hover explanation.
await press('n', 4);
await hoverLabel('ALU');
await shot('hero');
await unhover();

// ---- 2. Datapath close-up: hovering the control unit.
await hoverLabel('Control');
const datapath = await page.$('.datapath');
if (datapath) await shot('datapath-hover', datapath);
await unhover();

// ---- 3. Walk mode: one stage revealed at a time.
await press('r');
await wait(200);
await press('m', 3);
await shot('walk');

// ---- 4. Pipeline with a data hazard being forwarded. Hide the side panel so
// the wider five-stage diagram gets the full window.
await example('hazards');
await clickText('Pipeline');
await press('n', 5);
await page.keyboard.down('Control'); await page.keyboard.press('KeyB'); await page.keyboard.up('Control');
await wait(400);
await hoverLabel('Forwarding');
await shot('pipeline');
await unhover();
await page.keyboard.down('Control'); await page.keyboard.press('KeyB'); await page.keyboard.up('Control');
await wait(300);

// ---- 5. Pipeline diagram with stalls and flushes.
await clickText('Pipeline diagram');
await press('n', 8);
await shot('pipeline-diagram');

// ---- 6/7. Caches and statistics, after a run with real memory traffic.
await example('strings');
await clickText('Run');
await wait(600);
await clickText('Console');
await clickRail('Cache');
await unhover();
await shot('cache');

await clickRail('Statistics');
await unhover();
await shot('stats');

// ---- 8. Memory-mapped I/O: switches driving the LED matrix.
await example('io');
await clickRail('I/O');
await clickText('This cycle');
await unhover();
const switches = await page.$$('button.switch');
for (const i of [0, 2, 3, 5, 7]) await switches[i]?.click();
await wait(150);
// The I/O example polls forever, so free-run it at full speed and pause.
const speed = await page.$('input[type=range]');
if (speed) { await speed.focus(); await page.keyboard.press('End'); await wait(150); }
await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
await clickText('Play');
await wait(7000);
await clickText('Pause');
await wait(300);
await unhover();
await shot('io');

// ---- 9. Dark theme, back on the editor.
await clickRail('Toggle theme');
await clickRail('Editor');
await unhover();
await shot('dark');

console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
