import { chromium } from 'playwright';
import fs from 'fs';
import promptSync from 'prompt-sync';

// Create a prompt instance
const prompt = promptSync();

// Get the full domain from the environment variable or prompt the user for it
const fullDomain = process.env.DOMAIN || prompt('Enter the full domain (e.g., www.thevisiongroup.com): ');

// Construct the base domain using the full domain
const baseDomain = `https://${fullDomain}`;
const visited = new Set(); // To keep track of visited URLs
let urlsToVisit = []; // Store URLs to visit

async function navigateWithRetry(page, url, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            await page.goto(url);
            return;
        } catch (error) {
            console.error(`Attempt ${i + 1}: Failed to navigate to ${url}:`, error);
            await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
        }
    }
    throw new Error(`Failed to navigate to ${url} after ${retries} attempts.`);
}

async function crawlAndCollectUrls(urlToCrawl) {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await navigateWithRetry(page, urlToCrawl);
        visited.add(urlToCrawl);

        // Only scrape links on the page
        const links = await page.$$eval('a', anchors =>
            anchors.map(anchor => anchor.href).filter(href => href)
        );

        console.log(`Links found on ${urlToCrawl}:`, links); // Debugging log for collected links

        // Extract the base domain without subdomain for filtering
        const baseDomainForFilter = fullDomain.replace(/^www\./, ''); // Remove www. if present
        
        // Normalize, filter, and deduplicate links
        const filteredLinks = Array.from(new Set(links.filter(link => {
            try {
                const parsedLink = new URL(link);
                // Ensure it's an internal link and not already visited
                return (
                    (parsedLink.hostname.endsWith(baseDomainForFilter) || parsedLink.hostname === 'www.' + baseDomainForFilter) && // Allow www
                    !visited.has(parsedLink.href) && // Check if the link has already been visited
                    !parsedLink.hash // Exclude links with a fragment (e.g., #)
                );
            } catch (error) {
                console.error(`Invalid URL: ${link}`, error);
                return false; // Skip invalid URLs
            }
        }).map(link => link.replace(baseDomain, '')))); // Remove base URL and keep relative paths

        // Explicitly include the '/blog' path
        if (!filteredLinks.includes('/blog')) {
            filteredLinks.push('/blog'); // Add '/blog' if it's not already included
        }

        // Deduplicate and sort the filtered links, keeping '/' at the top
        const sortedLinks = Array.from(new Set(filteredLinks)).sort((a, b) => {
            if (a === '/') return -1; // Keep '/' as the first path
            if (b === '/') return 1;
            return a.localeCompare(b);
        });

        urlsToVisit.push(...sortedLinks);
        console.log(`Filtered, deduplicated, and sorted paths from ${urlToCrawl}:`, sortedLinks); // Debugging log for sorted links

    } catch (error) {
        console.error(`Failed to navigate to ${urlToCrawl}:`, error);
    } finally {
        await browser.close();
    }
}

// Entry point for the crawler
(async () => {
    const sitemapUrls = [`${baseDomain}/fr/sitemap`, `${baseDomain}/en/sitemap`, `${baseDomain}/sitemap`]; // Target both sitemap pages

    for (const sitemapUrl of sitemapUrls) {
        console.log(`Crawling: ${sitemapUrl}`);
        await crawlAndCollectUrls(sitemapUrl); // Crawl each sitemap URL
    }

    // Deduplicate and ensure final list is sorted
    urlsToVisit = Array.from(new Set(urlsToVisit)).sort((a, b) => {
        if (a === '/') return -1; // Keep '/' as the first path
        if (b === '/') return 1;
        return a.localeCompare(b);
    });

    // Save collected, deduplicated, and sorted paths to a file for the scanning script
    fs.writeFileSync('tests/urls.json', JSON.stringify(urlsToVisit, null, 2));
    console.log('Crawling completed. Collected, deduplicated, and sorted paths:', urlsToVisit);
})();
