import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });  // ✅ Headless mode for server/CLI
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://os.lasikmd.com/');
console.log('Page loaded!');
await browser.close();
