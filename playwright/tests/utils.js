// Shared utility functions for Playwright tests
import fs from 'fs';
import path from 'path';

// Use a shared file to collect passed URLs across all workers
const passedUrlsFilePath = path.join(process.cwd(), 'tests', 'urls-passed.json');
if (!fs.existsSync(passedUrlsFilePath)) {
    fs.writeFileSync(passedUrlsFilePath, JSON.stringify([]));
}

// Use a shared file to collect URLs with missing meta or title
const noMetaFilePath = path.join(process.cwd(), 'tests', 'nometa.json');
if (!fs.existsSync(noMetaFilePath)) {
    fs.writeFileSync(noMetaFilePath, JSON.stringify([]));
}

/**
 * Adds a URL to the passed URLs list
 * @param {string} url - URL to add to passed list
 */
function addPassedUrl(url) {
    const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
    if (!passedUrls.includes(url)) {
        passedUrls.push(url);
        fs.writeFileSync(passedUrlsFilePath, JSON.stringify(passedUrls, null, 2));
    }
}

/**
 * Adds a URL to the no-meta list and also to passed URLs
 * @param {string} url - URL to add to no-meta list
 */
function addNoMetaUrl(url) {
    const noMetaUrls = JSON.parse(fs.readFileSync(noMetaFilePath, 'utf-8'));
    if (!noMetaUrls.includes(url)) {
        noMetaUrls.push(url);
        fs.writeFileSync(noMetaFilePath, JSON.stringify(noMetaUrls, null, 2));
    }

    // Also add to passed URLs
    addPassedUrl(url);
}

/**
 * Navigates to a URL with retry logic and error handling
 * @param {Page} page - Playwright page instance
 * @param {string} url - URL to navigate to
 * @param {number} retries - Number of retry attempts (default: 2)
 * @returns {Promise<void>}
 */
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

/**
 * Creates a browser context with conditional headers that only adds X-CS-TOKEN
 * for requests to source or target domains, not external services
 * @param {Browser} browser - Playwright browser instance
 * @param {string} sourceUrl - Source domain (e.g., 'www.thevisiongroup.com')
 * @param {string} targetUrl - Target domain (e.g., 'test.thevisiongroup.com')
 * @returns {Promise<BrowserContext>} Browser context with route interception
 */
async function createContextWithHeaders(browser, sourceUrl, targetUrl) {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Set up route interception to add X-CS-TOKEN only for source/target domains
    await page.route('**/*', async (route) => {
        const url = route.request().url();
        const isSourceOrTarget = url.includes(sourceUrl) || url.includes(targetUrl);
        
        if (isSourceOrTarget) {
            // Add the token header for source/target requests
            const headers = {
                ...route.request().headers(),
                'X-CS-TOKEN': '!!C0D3Sp@c3!!'
            };
            await route.continue({ headers });
        } else {
            // Continue without the token for external services
            await route.continue();
        }
    });
    
    return context;
}

export {
    createContextWithHeaders,
    addPassedUrl,
    addNoMetaUrl,
    navigateWithRetry
}; 