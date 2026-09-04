// Renders build/icon.svg (the chip logo) to build/icon.png (1024x1024) and resources/icon.png
// with headless Chrome. The SVG is the single source of truth for the app icon.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const svg = fs.readFileSync('build/icon.svg', 'utf8');
if (!svg.includes('<svg')) throw new Error('build/icon.svg is not an SVG');
const chrome = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1024 });
const sized = svg.replace(/<svg([^>]*)>/, (_m, attrs) => `<svg${attrs} width='1024' height='1024'>`);
await page.setContent(`<body style="margin:0;background:transparent">${sized}</body>`);
await page.screenshot({ path: 'build/icon.png', omitBackground: true });
await browser.close();
fs.copyFileSync('build/icon.png', 'resources/icon.png');
console.log('wrote build/icon.png and resources/icon.png');
