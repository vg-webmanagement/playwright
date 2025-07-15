import { test, expect } from '@playwright/test';
import fs from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import path from 'path';
import promptSync from 'prompt-sync';

// Prompt user for input if SOURCE_URL is not set
const prompt = promptSync();
const sourceUrl = process.env.SOURCE_URL || prompt('Enter the source URL (e.g., www.thevisiongroup.com): ');
const targetUrl = process.env.TARGET_URL || prompt('Enter the target URL (e.g., test.thevisiongroup.com): ');

// Create a folder for screenshots if it doesn't exist
const screenshotsFolder = path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(screenshotsFolder)) {
    fs.mkdirSync(screenshotsFolder);
}

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

// Function to navigate with retry logic
async function navigateWithRetry(page, url, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await page.goto(url, { timeout: 30000 });
            await page.waitForTimeout(10000); // Wait for 2 seconds

            // Check if the page contains specific error messages
            const pageContent = await page.textContent('body');
            if (pageContent.includes('502 Bad Gateway') || pageContent.includes('Timeout')) {
                if (attempt < retries - 1) {
                    console.warn(`Retrying navigation to ${url} due to error text in page content (Attempt ${attempt + 1})`);
                    continue; // Retry if error text is found
                } else {
                    throw new Error(`Page contains error text: ${pageContent.trim().slice(0, 100)}...`); // Throw error if retries are exhausted
                }
            }

            return; // Exit the loop if successful and no error text is found
        } catch (error) {
            if (attempt < retries - 1 && (error.message.includes('Timeout') || error.message.includes('Navigation timeout'))) {
                console.warn(`Retrying navigation to ${url} due to timeout (Attempt ${attempt + 1})`);
            } else if (attempt < retries - 1) {
                console.warn(`Retrying navigation to ${url} due to ${error.message} (Attempt ${attempt + 1})`);
            } else {
                throw error; // Rethrow the error if retries are exhausted
            }
        }
    }
}

// Updated test logic
urlsData.forEach((url) => {
    const testLabel = url.replace(/[\/#?&]/g, '-'); // Sanitize label by replacing special characters

    test(`Pixel Comparison for ${testLabel}`, async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            console.log(`Starting comparison for: ${url}`);

                    const sourceFullUrl = `https://${sourceUrl}${url}`;
        const targetFullUrl = `https://${targetUrl}${url}`;

            // Navigate to the first URL with retry logic
            await navigateWithRetry(page, sourceFullUrl);

            const width = await page.evaluate(() => document.body.scrollWidth);
            const height = await page.evaluate(() => document.body.scrollHeight);
            await page.setViewportSize({ width: width, height: height });

            const screenshot1 = await page.screenshot({
                fullPage: true,
                clip: { x: 0, y: 0, width: width, height: height }
            });
            const screenshot1Path = path.join(screenshotsFolder, `ENV1-${testLabel}.png`);
            fs.writeFileSync(screenshot1Path, screenshot1);

            await context.close();
            const context2 = await browser.newContext();
            const page2 = await context2.newPage();

            // Navigate to the second URL with retry logic
            await navigateWithRetry(page2, targetFullUrl);

            await page2.setViewportSize({ width: width, height: height });

            const screenshot2 = await page2.screenshot({
                fullPage: true,
                clip: { x: 0, y: 0, width: width, height: height }
            });
            const screenshot2Path = path.join(screenshotsFolder, `ENV2-${testLabel}.png`);
            fs.writeFileSync(screenshot2Path, screenshot2);

            const img1 = PNG.sync.read(screenshot1);
            const img2 = PNG.sync.read(screenshot2);

            const diff = new PNG({ width: img1.width, height: img1.height });
            const mismatchedPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, { threshold: 0.1 });

            test.info().attach('ENV1 Screenshot', { body: screenshot1, contentType: 'image/png' });
            test.info().attach('ENV2 Screenshot', { body: screenshot2, contentType: 'image/png' });

            if (mismatchedPixels > 0) {
                const diffImagePath = path.join(screenshotsFolder, `diff-${testLabel}.png`);
                fs.writeFileSync(diffImagePath, PNG.sync.write(diff));
                console.log(`Diff image created for ${testLabel}.`);
                console.log(`Pixel Comparison for ${testLabel} ended - FAILED`);

                test.info().attach('Diff Image', { body: PNG.sync.write(diff), contentType: 'image/png' });

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
            await page.close();
            await context.close();
        }
    });
});

// After all tests, log the final passed URLs
test.afterAll(async () => {
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    console.log('Final Passed URLs:', passedUrls); // Print all passed URLs at the end
});
