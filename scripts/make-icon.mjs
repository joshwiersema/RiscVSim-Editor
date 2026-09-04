// Renders the app icon SVG to build/icon.png (1024x1024) with headless Chrome.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'>
<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#6366f1'/><stop offset='1' stop-color='#7c3aed'/></linearGradient></defs>
<rect width='256' height='256' rx='56' fill='url(#g)'/>
<g fill='none' stroke='white' stroke-opacity='.55' stroke-width='6' stroke-linecap='round'>
<path d='M40 96 H84 M40 128 H72 M40 160 H84'/><path d='M172 96 H216 M184 128 H216 M172 160 H216'/></g>
<text x='128' y='168' font-family='Inter,Segoe UI,Arial' font-size='120' font-weight='700' fill='white' text-anchor='middle'>R</text>
</svg>`;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.svg', svg);
const chrome = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024 });
await page.setContent(`<body style="margin:0;background:transparent">${svg.replace("viewBox='0 0 256 256'", "viewBox='0 0 256 256' width='1024' height='1024'")}</body>`);
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
console.log('wrote build/icon.png');
