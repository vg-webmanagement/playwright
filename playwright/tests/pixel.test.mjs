import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import promptSync from 'prompt-sync';

// Prompt user for input if SOURCE_URL is not set
const prompt = promptSync();
const sourceUrl = process.env.SOURCE_URL || prompt('Enter the source URL (e.g., www.thevisiongroup.com): ');
const targetUrl = process.env.TARGET_URL || prompt('Enter the target URL (e.g., test.thevisiongroup.com): ');

// Create a folder for screenshots if it doesn't exist
const screenshotsFolder = path.join(process.cwd(), 'screenshots');
fs.mkdirSync(screenshotsFolder, { recursive: true });

// Load URLs from urls.json
const urlsFilePath = path.join(process.cwd(), 'tests', 'urls.json');
const urlsData = JSON.parse(fs.readFileSync(urlsFilePath, 'utf-8'));

// Use a shared file to collect passed URLs across all workers
const passedUrlsFilePath = path.join(process.cwd(), 'tests', 'urls-passed.json');
if (!fs.existsSync(passedUrlsFilePath)) {
    fs.writeFileSync(passedUrlsFilePath, JSON.stringify([]));
}

// Add debugging to track when URLs are added
function addPassedUrl(url) {
    console.log(`Attempting to add URL to passed list: ${url}`); // Debugging log
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    if (!passedUrls.includes(url)) {
        passedUrls.push(url);
        fs.writeFileSync(passedUrlsFilePath, JSON.stringify(passedUrls, null, 2));
        console.log(`Successfully added URL to passed list: ${url}`); // Debugging log
    } else {
        console.log(`URL already exists in passed list: ${url}`); // Debugging log
    }
}

// Function to navigate with retry logic - improved version
async function navigateWithRetry(page, url, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await page.goto(url, { timeout: 20000 });
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(3000); // Reduced from 10000ms for better performance

            // Check response status
            if (!response || response.status() >= 400) {
                const statusCode = response?.status() || 'No response';
                if (attempt < retries - 1) {
                    console.warn(`Retrying navigation to ${url} due to HTTP ${statusCode} (Attempt ${attempt + 1})`);
                    continue;
                } else {
                    throw new Error(`Failed to load ${url}, HTTP ${statusCode}`);
                }
            }

            // Check if the page contains specific error messages
            const pageContent = await page.textContent('body');
            if (pageContent.includes('502 Bad Gateway') || pageContent.includes('Timeout')) {
                if (attempt < retries - 1) {
                    console.warn(`Retrying navigation to ${url} due to error text in page content (Attempt ${attempt + 1})`);
                    continue;
                } else {
                    throw new Error(`Page contains error text: ${pageContent.trim().slice(0, 100)}...`);
                }
            }

            return; // Exit the loop if successful
        } catch (error) {
            if (attempt < retries - 1) {
                console.warn(`Retrying navigation to ${url} due to: ${error.message} (Attempt ${attempt + 1})`);
            } else {
                throw error;
            }
        }
    }
}

// Parallel test execution with progress bar compatibility
test.describe.parallel('Pixel Comparison Suite', () => {
    urlsData.forEach((url) => {
        const testLabel = url.replace(/[\/#?&]/g, '-');

        test(`Pixel Comparison for ${testLabel}`, async ({ browser }) => {
            const context = await browser.newContext();
            
            try {
                // Progress bar compatible start message
                console.log(`Starting comparison for: ${url}`);
                console.log(`Pixel Comparison for ${testLabel}`);

                const sourceFullUrl = `https://${sourceUrl}${url}`;
                const targetFullUrl = `https://${targetUrl}${url}`;

                // Navigate to first URL
                const page1 = await context.newPage();
                await navigateWithRetry(page1, sourceFullUrl);

                // Get viewport dimensions
                const viewport = {
                    width: await page1.evaluate(() => document.body.scrollWidth),
                    height: await page1.evaluate(() => document.body.scrollHeight)
                };
                await page1.setViewportSize(viewport);

                const screenshot1 = await page1.screenshot({
                    fullPage: true,
                    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height }
                });

                // Navigate to second URL (reuse context for performance)
                const page2 = await context.newPage();
                await navigateWithRetry(page2, targetFullUrl);
                await page2.setViewportSize(viewport);

                const screenshot2 = await page2.screenshot({
                    fullPage: true,
                    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height }
                });

                // Save screenshots
                const screenshot1Path = path.join(screenshotsFolder, `ENV1-${testLabel}.png`);
                const screenshot2Path = path.join(screenshotsFolder, `ENV2-${testLabel}.png`);
                fs.writeFileSync(screenshot1Path, screenshot1);
                fs.writeFileSync(screenshot2Path, screenshot2);

                // Compare images
                const img1 = PNG.sync.read(screenshot1);
                const img2 = PNG.sync.read(screenshot2);
                const diff = new PNG({ width: img1.width, height: img1.height });
                const mismatchedPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold: 0.1 });

                // Attach screenshots to test report
                test.info().attach('ENV1 Screenshot', { body: screenshot1, contentType: 'image/png' });
                test.info().attach('ENV2 Screenshot', { body: screenshot2, contentType: 'image/png' });

                if (mismatchedPixels > 0) {
                    const diffImagePath = path.join(screenshotsFolder, `diff-${testLabel}.png`);
                    const diffBuffer = PNG.sync.write(diff);
                    fs.writeFileSync(diffImagePath, diffBuffer);
                    test.info().attach('Diff Image', { body: diffBuffer, contentType: 'image/png' });
                    
                    console.log(`Diff image created for ${testLabel}.`);
                    console.log(`Pixel Comparison for ${testLabel} ended - FAILED`);
                    
                    throw new Error(`Test failed: Found ${mismatchedPixels} mismatched pixels. Check the attached diff image for details.`);
                } else {
                    console.log(`No differences found for ${testLabel}.`);
                    console.log(`Pixel Comparison for ${testLabel} ended - PASSED`);
                    
                    // Add the passed URL to the shared file
                    addPassedUrl(url);
                }

            } catch (error) {
                console.error(`An error occurred while comparing ${testLabel}:`, error);
                console.log(`Pixel Comparison for ${testLabel} ended - ERROR`);
                throw error;
            } finally {
                await context.close();
            }
        });
    });
});

// After all tests, log the final passed URLs
test.afterAll(async () => {
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    console.log('Final Passed URLs:', passedUrls);
});
