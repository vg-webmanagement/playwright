import fs from 'fs';
import path from 'path';

// Path to the `urls.json` file
const urlsFilePath = path.join(process.cwd(), 'tests', 'urls.json');

// Path to the `urls-passed.json` file
const passedUrlsFilePath = path.join(process.cwd(), 'tests', 'urls-passed.json');

// Load the current URLs from `urls.json`
const urlsData = JSON.parse(fs.readFileSync(urlsFilePath, 'utf-8'));

// Load the passed URLs from `urls-passed.json`
const passedUrls = JSON.parse(fs.readFileSync(passedUrlsFilePath, 'utf-8'));

// Filter out the passed URLs
const updatedUrls = urlsData.filter((url) => !passedUrls.includes(url));

// Write the updated URLs back to `urls.json`
fs.writeFileSync(urlsFilePath, JSON.stringify(updatedUrls, null, 2));

console.log('Passed URLs have been removed from urls.json.');