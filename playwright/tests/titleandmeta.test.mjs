import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';
import { createContextWithHeaders, addPassedUrl, addNoMetaUrl, navigateWithRetry } from './utils.js';

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







// Parallel test execution with progress bar compatibility
test.describe.parallel('Title and Meta Comparison Suite', () => {
    urlsData.forEach((url) => {
        const testLabel = url.replace(/[\/#?&]/g, '-');

        test(`Meta and Title Comparison for ${testLabel}`, async ({ browser }) => {
            const context = await createContextWithHeaders(browser, sourceUrl, targetUrl);
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
