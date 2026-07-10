import { chromium } from 'playwright';

const path = process.argv[2] || '/forgot-password';
const slug = path.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'root';
const base = 'http://localhost:3005';
const widths = [
  { name: 'mobile', w: 375, h: 812 },
  { name: 'tablet', w: 768, h: 1024 },
  { name: 'desktop', w: 1440, h: 1024 },
];

const browser = await chromium.launch();
for (const { name, w, h } of widths) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const resp = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(600);
  const out = `/tmp/shot_${slug}_${name}.png`;
  await page.screenshot({ path: out, fullPage: name === 'mobile' });
  console.log(`${name} (${w}x${h}) status=${resp?.status()} -> ${out}`);
  await ctx.close();
}
await browser.close();
