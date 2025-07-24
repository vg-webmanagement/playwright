import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';
import * as Diff from 'diff';
import { createContextWithHeaders, addPassedUrl, navigateWithRetry, getPassedUrls } from './utils.mjs';

// ANSI color codes
const ANSI_RED = '\x1b[31m'; // Red for removed
const ANSI_GREEN = '\x1b[32m'; // Green for added
const ANSI_RESET = '\x1b[0m'; // Reset color

// Prompt user for input if SOURCE_URL is not set
const prompt = promptSync();
const sourceUrl = process.env.SOURCE_URL || prompt('Enter the source URL (e.g., www.thevisiongroup.com): ');
const targetUrl = process.env.TARGET_URL || prompt('Enter the target URL (e.g., test.thevisiongroup.com): ');

// Load URLs from urls.json
const urlsFilePath = path.join(process.cwd(), 'tests', 'urls.json');
const urlsData = JSON.parse(fs.readFileSync(urlsFilePath, 'utf-8'));





// Utility function to normalize visible text for comparison
function normalizeText(text) {
    return text
        .replace(/\(DEV\)/g, '') // Remove "(DEV)" markers
        .trim();
}

// Function to generate a summary of significant differences, excluding non-content parts
function generateDiffReport(text1, text2) {
    const diffResults = Diff.diffWords(text1, text2);
    const significantChanges = diffResults.filter(part => part.added || part.removed);

    return significantChanges
        .map(part => {
            // Wrap the whole line in the corresponding color codes
            const color = part.added ? ANSI_GREEN : part.removed ? ANSI_RED : '';
            const prefix = part.added ? '[ADDED]' : part.removed ? '[REMOVED]' : '';
            return `${color}${prefix} ${part.value.trim()}${ANSI_RESET}`; // Color the entire line
        })
        .join('\n');
}



// Optimized test execution with progress bar compatibility
urlsData.forEach((url) => {
    const testLabel = url.replace(/[\/#?&]/g, '-');

    test(`Rendered Text Comparison for ${testLabel}`, async ({ browser }) => {
            const context = await createContextWithHeaders(browser, sourceUrl, targetUrl);
            const page = await context.newPage();

                    // Define URLs outside try block for error handling
        const sourceFullUrl = `https://${sourceUrl}${url}`;
        const targetFullUrl = `https://${targetUrl}${url}`;

        try {
            // Progress bar compatible start message
            console.log(`Starting comparison for: ${url}`);

                await test.step(`Navigate to source URL: ${sourceFullUrl}`, async () => {
                    await navigateWithRetry(page, sourceFullUrl);
                });

                const sourceText = normalizeText(await page.textContent('body'));

                await test.step(`Navigate to target URL: ${targetFullUrl}`, async () => {
                    await navigateWithRetry(page, targetFullUrl);
                });

                const targetText = normalizeText(await page.textContent('body'));

                await test.step('Compare text content between source and target', () => {
                    if (sourceText !== targetText) {
                        const differences = generateDiffReport(sourceText, targetText);

                        // Log the differences directly to the test output
                        console.log(`### Differences found for ${testLabel}:\n${differences}\n`);
                        console.log(`Rendered Text Comparison for ${testLabel} ended - FAILED`);

                        // Improved error message including specific details of differences
                        throw new Error(`Text differences found for ${testLabel}.\nDetails:\n${differences}`);
                    }
                });

                console.log(`Text comparison passed for ${testLabel}. No differences found.`);
                console.log(`Rendered Text Comparison for ${testLabel} ended - PASSED`);

                // Add the passed URL to the shared file
                addPassedUrl(url);
            } catch (error) {
                console.error(`Error during text comparison for ${testLabel}:`, error);
                console.error(`Source URL: ${sourceFullUrl}`);
                console.error(`Target URL: ${targetFullUrl}`);
                console.log(`Rendered Text Comparison for ${testLabel} ended - ERROR`);
                throw error; // Ensure the test fails if an error occurs
            } finally {
                await context.close();
            }
        });
    });

// After all tests, log the final passed URLs
test.afterAll(async () => {
    const passedUrls = getPassedUrls();
    console.log('Final Passed URLs:', passedUrls);
});
