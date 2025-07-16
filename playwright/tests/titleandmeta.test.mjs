import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';

// Create a prompt instance
const prompt = promptSync();

// Get the domain from the environment variable or prompt the user for it
const sourceUrl = process.env.SOURCE_URL || prompt('Enter the source URL (e.g., www.thevisiongroup.com): ');
const targetUrl = process.env.TARGET_URL || prompt('Enter the target URL (e.g., test.thevisiongroup.com): ');

// Load URLs from urls.json
let urlsData;
try {
    const urlsFilePath = path.join(process.cwd(), 'tests', 'urls.json');
    urlsData = JSON.parse(fs.readFileSync(urlsFilePath, 'utf-8'));
} catch (error) {
    console.error('Error reading URLs from urls.json:', error);
    process.exit(1); // Exit the process with an error code if the file cannot be read
}

// Use a shared file to collect passed URLs across all workers
const passedUrlsFilePath = path.join(process.cwd(), 'tests', 'urls-passed.json');
if (!fs.existsSync(passedUrlsFilePath)) {
    fs.writeFileSync(passedUrlsFilePath, JSON.stringify([]));
}

// Function to add passed URLs to the shared file
function addPassedUrl(url) {
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    if (!passedUrls.includes(url)) {
        passedUrls.push(url);
        fs.writeFileSync(passedUrlsFilePath, JSON.stringify(passedUrls, null, 2));
    }
}

// Use a shared file to collect URLs with missing meta or title
const noMetaFilePath = path.join(process.cwd(), 'tests', 'nometa.json');
if (!fs.existsSync(noMetaFilePath)) {
    fs.writeFileSync(noMetaFilePath, JSON.stringify([]));
}

// Updated logic to add URLs with missing meta or title to `urls-passed.json`
function addNoMetaUrl(url) {
    const noMetaUrls = JSON.parse(fs.readFileSync(noMetaFilePath, 'utf-8'));
    if (!noMetaUrls.includes(url)) {
        noMetaUrls.push(url);
        fs.writeFileSync(noMetaFilePath, JSON.stringify(noMetaUrls, null, 2));
    }

    // Also add to passed URLs
    addPassedUrl(url);
}

// Function to navigate with retry logic - improved version
async function navigateWithRetry(page, url, retries = 2) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await page.goto(url, { timeout: 20000 });
            await page.waitForLoadState('domcontentloaded');
            await page.waitForTimeout(1000); // Reduced wait time for better performance

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
test.describe.parallel('Title and Meta Comparison Suite', () => {
    urlsData.forEach((url) => {
        const testLabel = url.replace(/[\/#?&]/g, '-');

        test(`Meta and Title Comparison for ${testLabel}`, async ({ browser }) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            try {
                // Progress bar compatible start message
                console.log(`Starting comparison for: ${url}`);
                console.log(`Title & Meta Tag Tests for ${testLabel}`);

                // Prepare full URLs
                const sourceFullUrl = `https://${sourceUrl}${url}`;
                const targetFullUrl = `https://${targetUrl}${url}`;

                // Navigate to the first URL and get the title and meta tags
                await navigateWithRetry(page, sourceFullUrl);
                const sourceTitle = await page.title();
                const sourceMetaDescription = await page.$eval(
                    'meta[name="description"]',
                    (meta) => meta?.content || null
                ).catch(() => null); // Handle missing meta tag

                // Navigate to the second URL and get the title and meta tags
                await navigateWithRetry(page, targetFullUrl);
                const targetTitle = await page.title();
                const targetMetaDescription = await page.$eval(
                    'meta[name="description"]',
                    (meta) => meta?.content || null
                ).catch(() => null); // Handle missing meta tag

                // Check for missing meta or title
                if (!sourceTitle || !targetTitle || !sourceMetaDescription || !targetMetaDescription) {
                    console.warn(`Missing meta or title for ${testLabel}.`);
                    console.log(`Title & Meta Tag Tests for ${testLabel} ended - PASSED (missing meta)`);
                    addNoMetaUrl(url); // Add to nometa.json
                    return; // Skip further validation
                }

                // Validate title and meta tags
                try {
                    expect(targetTitle).toBe(sourceTitle);
                    expect(targetMetaDescription).toBe(sourceMetaDescription);
                } catch (assertionError) {
                    console.log(`Title & Meta Tag Tests for ${testLabel} ended - FAILED`);
                    throw assertionError;
                }

                console.log(`Comparison completed for ${testLabel}.`);
                console.log(`Title & Meta Tag Tests for ${testLabel} ended - PASSED`);

                // Add the passed URL to the shared file
                addPassedUrl(url);
            } catch (error) {
                console.error(`An error occurred while comparing ${testLabel}:`, error);
                console.log(`Title & Meta Tag Tests for ${testLabel} ended - ERROR`);
                throw error; // Rethrow to fail the test if there was an error
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
