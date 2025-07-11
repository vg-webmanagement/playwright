import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';

// Create a prompt instance
const prompt = promptSync();

// Get the domain from the environment variable or prompt the user for it
const domain1 = process.env.DOMAIN1 || prompt('Enter the domain (e.g., tlcvision.ca): ');
const domain2 = process.env.DOMAIN2 || prompt('Enter the domain (e.g., tlcvision.ca): ');
const env1 = process.env.ENV1 || prompt('Enter the first env (e.g., www, test, dev): ');
const env2 = process.env.ENV2 || prompt('Enter the second env (e.g., www, test, dev): ');

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

// Updated test logic to handle missing meta or title
urlsData.forEach((url) => {
  const testLabel = url.replace(/[\/#?&]/g, '-'); // Sanitize label by replacing special characters

  test(`Meta and Title Comparison for ${testLabel}`, async ({ browser }) => {
    const page = await browser.newPage();

    try {
      console.log(`Starting comparison for: ${url}`);

      // Prepare full URLs
      const url1 = `https://${env1}.${domain1}${url}`; // First URL 
      const url2 = `https://${env2}.${domain2}${url}`; // Second URL 

      // Navigate to the first URL and get the title and meta tags
      await page.goto(url1, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const env1Title = await page.title();
      const env1MetaDescription = await page.$eval(
        'meta[name="description"]',
        (meta) => meta?.content || null
      ).catch(() => null); // Handle missing meta tag

      // Navigate to the second URL and get the title and meta tags
      await page.goto(url2, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const env2Title = await page.title();
      const env2MetaDescription = await page.$eval(
        'meta[name="description"]',
        (meta) => meta?.content || null
      ).catch(() => null); // Handle missing meta tag

      // Check for missing meta or title
      if (!env1Title || !env2Title || !env1MetaDescription || !env2MetaDescription) {
        console.warn(`Missing meta or title for ${testLabel}.`);
        console.log(`Title & Meta Tag Tests for ${testLabel} ended - PASSED (missing meta)`);
        addNoMetaUrl(url); // Add to nometa.json
        return; // Skip further validation
      }

      // Validate title and meta tags
      try {
        expect(env2Title).toBe(env1Title);
        expect(env2MetaDescription).toBe(env1MetaDescription);
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
      await page.close(); // Ensure the page is closed after the test
    }
  });
});

// After all tests, log the final passed URLs
test.afterAll(async () => {
  const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
  console.log('Final Passed URLs:', passedUrls); // Print all passed URLs at the end
});
