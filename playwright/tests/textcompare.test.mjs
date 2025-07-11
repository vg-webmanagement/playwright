import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import promptSync from 'prompt-sync';
import * as Diff from 'diff';

// ANSI color codes
const ANSI_RED = '\x1b[31m'; // Read for removed
const ANSI_GREEN = '\x1b[32m'; // Green for added
const ANSI_RESET = '\x1b[0m'; // Reset color

// Prompt user for input if DOMAIN is not set
const prompt = promptSync();
const domain1 = process.env.DOMAIN1 || prompt('Enter the domain (e.g., tlcvision.ca): ');
const domain2 = process.env.DOMAIN2 || prompt('Enter the domain (e.g., tlcvision.ca): ');
const env1 = process.env.ENV1 || prompt('Enter the first env (e.g., www, test, dev): ');
const env2 = process.env.ENV2 || prompt('Enter the second env (e.g., www, test, dev): ');

// Load URLs from urls.json
const urlsFilePath = path.join(process.cwd(), 'tests', 'urls.json');
const urlsData = JSON.parse(fs.readFileSync(urlsFilePath, 'utf-8'));

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
        .replace(/,\s*]/g, ']') // Remove trailing commas before closing brackets
        .replace(/],\s*}/g, ']}') // Remove trailing commas before closing braces
        .replace(/\s*}\s*$/, '}') // Trim whitespace before closing braces
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

// Function to navigate with retry logic
async function navigateWithRetry(page, url, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000); // Wait for 2 seconds

      // Check if the page contains specific error messages
      const pageContent = await page.textContent('body');
      if (pageContent.includes('502 Bad Gateway') || pageContent.includes('Timeout')) {
        if (attempt < retries) {
          console.warn(`Retrying navigation to ${url} due to error text in page content (Attempt ${attempt + 1})`);
          continue; // Retry if error text is found
        } else {
          throw new Error(`Page contains error text: ${pageContent.trim().slice(0, 100)}...`); // Throw error if retries are exhausted
        }
      }

      return; // Exit the loop if successful and no error text is found
    } catch (error) {
      if (attempt < retries && (error.message.includes('Timeout') || error.message.includes('Navigation timeout'))) {
        console.warn(`Retrying navigation to ${url} due to timeout (Attempt ${attempt + 1})`);
      } else if (attempt < retries) {
        console.warn(`Retrying navigation to ${url} due to ${error.message} (Attempt ${attempt + 1})`);
      } else {
        throw error; // Rethrow the error if retries are exhausted
      }
    }
  }
}

// Define the tests for each URL
urlsData.forEach((url) => {
  const testLabel = url.replace(/[\/#?&]/g, '-'); // Create a readable label from the URL

  test(`Rendered Text Comparison for ${testLabel}`, async ({ page }) => {
    const env1Url = `https://${env1}.${domain1}${url}`;
    const env2Url = `https://${env2}.${domain2}${url}`;

    try {
      await test.step(`Navigate to environment 1 URL: ${env1Url}`, async () => {
        await navigateWithRetry(page, env1Url); // Use retry logic for environment 1
      });

      const env1Text = normalizeText(await page.textContent('body'));

      await test.step(`Navigate to environment 2 URL: ${env2Url}`, async () => {
        await navigateWithRetry(page, env2Url); // Use retry logic for environment 2
      });

      const env2Text = normalizeText(await page.textContent('body'));

      await test.step('Compare text content between the two environments', () => {
        if (env1Text !== env2Text) {
          const differences = generateDiffReport(env1Text, env2Text);

          // Log the differences directly to the test output
          console.log(`### Differences found for ${testLabel}:\n${differences}\n`);
          console.log(`Text Content Comparison for ${testLabel} ended - FAILED`);

          // Improved error message including specific details of differences
          throw new Error(`Text differences found for ${testLabel}.\nDetails:\n${differences}`);
        }
      });

      console.log(`Text comparison passed for ${testLabel}. No differences found.`);
      console.log(`Text Content Comparison for ${testLabel} ended - PASSED`);

      // Add the passed URL to the shared file
      addPassedUrl(url);
    } catch (error) {
      console.error(`Error during text comparison for ${testLabel}:`, error);
      console.error(`Environment 1 URL: ${env1Url}`);
      console.error(`Environment 2 URL: ${env2Url}`);
      console.log(`Text Content Comparison for ${testLabel} ended - ERROR`);
      throw error; // Ensure the test fails if an error occurs
    }
  });
});

// After all tests, log the final passed URLs
test.afterAll(async () => {
  const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));
  console.log('Final Passed URLs:', passedUrls); // Print all passed URLs at the end
});
