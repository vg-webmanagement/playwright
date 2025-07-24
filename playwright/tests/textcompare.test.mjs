import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';
import * as Diff from 'diff';
import { createContextWithHeaders, addPassedUrl, navigateWithRetry } from './utils.js';

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
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/"permissionsHash":"[a-f0-9]{64}"/g, '') // Remove permissionsHash
        .replace(/[a-f0-9]{64}/g, '') // Remove any 64-character hash-like strings
        .replace(/dataLayer\.push\((.*?)\);?/g, '') // Remove dataLayer.push(...) entries
        .replace(/"requestURI":".*?"/g, '') // Remove requestURI entries
        .replace(/"clinicCity":".*?"/g, '') // Remove clinicCity entries
        .replace(/"clinicProvince":".*?"/g, '') // Remove clinicProvince entries
        .replace(/"clinicCountry":".*?"/g, '') // Remove clinicCountry entries
        .replace(/"contentType":".*?"/g, '') // Remove contentType entries
        .replace(/"language":".*?"/g, '') // Remove language entries
        .replace(/"contentPersonnalization":".*?"/g, '') // Remove contentPersonnalization entries
        .replace(/os|www/g, '') // Remove specific keywords like 'os' and 'www'
        .replace(/{\s*"@context":\s*"http:\/\/schema\.org",.*?}/g, '') // Remove JSON-like schema.org structures
        .replace(/"contactPoint":\s*\[.*?\],?/g, '') // Remove contactPoint arrays
        .replace(/"sameAs":\s*\[.*?\]/g, '') // Remove sameAs arrays
        .replace(/,\s*{\s*"@type":\s*"ContactPoint",.*?}/g, '') // Remove individual ContactPoint objects
        .replace(/Opens in a new window.*?Cle Cookie Preferences/g, '') // Remove cookie-related banners
        .replace(/\(DEV\)/g, '') // Remove "(DEV)" markers
        .replace(/<script.*?>.*?<\/script>/g, '') // Remove all <script> tags and their content
        .replace(/!function\(.*?\}\)\(.*?\);/g, '') // Remove inline analytics/tracking functions
        .replace(/var\s+[a-zA-Z0-9_]+\s*=\s*google_tag_manager\[.*?\];/g, '') // Remove Google Tag Manager variables
        .replace(/fbq\(".*?"\);/g, '') // Remove Facebook Pixel tracking calls
        .replace(/ttq\.track\(".*?"\);/g, '') // Remove TikTok Pixel tracking calls
        .replace(/_tvq\.push\(\[.*?\]\);/g, '') // Remove TVSquared tracking calls
        .replace(/var\s+_tvq=window\._tvq=window\._tvq\|\|[\s\S]*?tvsquared\.com[\s\S]*?;/g, '') // Remove TVSquared initialization
        .replace(/_tvq=window\._tvq=window\._tvq\|\|[\s\S]*?tvsquared\.com[\s\S]*?;/g, '') // Remove TVSquared initialization (without var)
        .replace(/\(function\(a,b\)[\s\S]*?spdt\("view"\)[\s\S]*?\)\(window,document\);/g, '') // Remove Spotify pixel tracking
        .replace(/var\s+_tvq=[\s\S]*?collector-\d+\.us\.tvsquared\.com[\s\S]*?;/g, '') // Remove TVSquared collector scripts
        .replace(/_tvq=[\s\S]*?collector-\d+\.us\.tvsquared\.com[\s\S]*?;/g, '') // Remove TVSquared collector scripts (without var)
        .replace(/,\s*]/g, ']') // Remove trailing commas before closing brackets
        .replace(/],\s*}/g, ']}') // Remove trailing commas before closing braces
        .replace(/\s*}\s*$/, '}') // Trim whitespace before closing braces
        // Remove JSON structural elements that cause noise in diffs - be more aggressive
        .replace(/\]\s*}/g, '') // Remove ]} patterns completely
        .replace(/}\s*\]/g, '') // Remove }] patterns completely
        .replace(/^\s*\]}\s*$/gm, '') // Remove lines that are just ]}
        .replace(/^\s*}\]\s*$/gm, '') // Remove lines that are just }]
        .replace(/^\s*[\[\]{}]+\s*$/gm, '') // Remove lines that are just structural characters
        .replace(/\s*[\[\]{}]+\s*/g, ' ') // Remove standalone structural characters
        .replace(/\s*[\[\]{}]\s*/g, ' ') // Remove single structural characters
        .replace(/[\[\]{}]+/g, ' ') // Remove consecutive structural characters
        .replace(/\s{2,}/g, ' ') // Normalize multiple spaces back to single spaces
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
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    console.log('Final Passed URLs:', passedUrls);
});
