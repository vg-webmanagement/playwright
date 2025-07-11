const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const PORT = 3000;
const execAsync = promisify(exec);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Store form data in memory
let formData = {};

// Serve static files from playwright-report directory
app.use('/playwright-report', express.static(path.join(__dirname, 'playwright-report')));

// Utility function to sanitize input
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    // Remove potentially dangerous characters but keep alphanumeric, dots, hyphens, and underscores
    return input.replace(/[^a-zA-Z0-9.\-_]/g, '');
}

// Route 1: Serve the form at /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'form.html'));
});

// Route 2: Handle form submission and run crawler
app.post('/run-crawler', async (req, res) => {
    try {
        // Store form data and sanitize inputs
        formData = {
            ENV: sanitizeInput(req.body.ENV),
            DOMAIN: sanitizeInput(req.body.DOMAIN),
            ENV1: sanitizeInput(req.body.ENV1),
            ENV2: sanitizeInput(req.body.ENV2),
            DOMAIN1: sanitizeInput(req.body.DOMAIN1),
            DOMAIN2: sanitizeInput(req.body.DOMAIN2)
        };

        console.log('Form data received:', formData);

        // Run the crawler with environment variables
        const crawlerCommand = `ENV=${formData.ENV} DOMAIN=${formData.DOMAIN} node crawler.mjs`;
        console.log('Running crawler command:', crawlerCommand);
        
        const { stdout, stderr } = await execAsync(crawlerCommand, { cwd: __dirname });
        
        if (stderr) {
            console.error('Crawler stderr:', stderr);
        }
        
        console.log('Crawler completed successfully');
        console.log('Crawler stdout:', stdout);
        
        // Redirect to edit-urls after crawler completes
        res.redirect('/edit-urls');
    } catch (error) {
        console.error('Error running crawler:', error);
        res.status(500).send(`
            <h1>Error Running Crawler</h1>
            <p>Error: ${error.message}</p>
            <a href="/">Back to Form</a>
        `);
    }
});

// Route 3: Display URLs for editing
app.get('/edit-urls', (req, res) => {
    try {
        const urlsFilePath = path.join(__dirname, 'tests', 'urls.json');
        
        let urlsContent = '[]';
        if (fs.existsSync(urlsFilePath)) {
            urlsContent = fs.readFileSync(urlsFilePath, 'utf8');
        }

        res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Edit URLs - QA Dashboard</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #f5f5f5;
                    }
                    .container {
                        background-color: white;
                        padding: 30px;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    h1 {
                        color: #333;
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    textarea {
                        width: 100%;
                        height: 400px;
                        padding: 10px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 14px;
                        box-sizing: border-box;
                    }
                    .submit-btn {
                        background-color: #4CAF50;
                        color: white;
                        padding: 12px 30px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        margin-top: 20px;
                        margin-right: 10px;
                    }
                    .submit-btn:hover {
                        background-color: #45a049;
                    }
                    .back-btn {
                        background-color: #6c757d;
                        color: white;
                        padding: 12px 30px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        margin-top: 20px;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .back-btn:hover {
                        background-color: #5a6268;
                    }
                    .help-text {
                        font-size: 14px;
                        color: #666;
                        margin-bottom: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Edit URLs</h1>
                    
                    <form action="/save-urls" method="POST">
                        <div class="help-text">
                            Edit the URLs below. This should be a valid JSON array of strings.
                        </div>
                        <textarea name="urls" required>${urlsContent}</textarea>
                        <br>
                        <button type="submit" class="submit-btn">Save URLs & Run Tests</button>
                        <a href="/" class="back-btn">Back to Form</a>
                    </form>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error reading URLs file:', error);
        res.status(500).send(`
            <h1>Error Reading URLs</h1>
            <p>Error: ${error.message}</p>
            <a href="/">Back to Form</a>
        `);
    }
});

// Route 4: Save edited URLs
app.post('/save-urls', (req, res) => {
    try {
        const urlsContent = req.body.urls;
        
        // Validate JSON
        try {
            const parsedUrls = JSON.parse(urlsContent);
            if (!Array.isArray(parsedUrls)) {
                throw new Error('URLs must be a JSON array');
            }
            
            // Sanitize URLs
            const sanitizedUrls = parsedUrls.map(url => {
                if (typeof url !== 'string') return '';
                // Allow URL-safe characters
                return url.replace(/[^a-zA-Z0-9.\-_\/\?&=]/g, '');
            }).filter(url => url.length > 0);
            
            // Save to file
            const urlsFilePath = path.join(__dirname, 'tests', 'urls.json');
            fs.writeFileSync(urlsFilePath, JSON.stringify(sanitizedUrls, null, 2));
            
            console.log('URLs saved successfully');
            res.redirect('/run-tests');
        } catch (parseError) {
            throw new Error('Invalid JSON format: ' + parseError.message);
        }
    } catch (error) {
        console.error('Error saving URLs:', error);
        res.status(500).send(`
            <h1>Error Saving URLs</h1>
            <p>Error: ${error.message}</p>
            <a href="/edit-urls">Back to Edit URLs</a>
        `);
    }
});

// Route 5: Run Playwright tests
app.get('/run-tests', async (req, res) => {
    try {
        if (!formData.ENV1 || !formData.ENV2 || !formData.DOMAIN1 || !formData.DOMAIN2) {
            return res.status(400).send(`
                <h1>Error: Missing Test Configuration</h1>
                <p>Please go back and fill out all required fields.</p>
                <a href="/">Back to Form</a>
            `);
        }

        console.log('Running Playwright tests with:', formData);
        
        // Build the command with environment variables
        const testCommand = `ENV1=${formData.ENV1} ENV2=${formData.ENV2} DOMAIN1=${formData.DOMAIN1} DOMAIN2=${formData.DOMAIN2} npx playwright test --project=chromium --reporter=html`;
        
        console.log('Running test command:', testCommand);
        
        // Start the response
        res.writeHead(200, {
            'Content-Type': 'text/html',
            'Transfer-Encoding': 'chunked'
        });
        
        res.write(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Test Results - QA Dashboard</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        max-width: 1200px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #f5f5f5;
                    }
                    .container {
                        background-color: white;
                        padding: 30px;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    h1 {
                        color: #333;
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .output {
                        background-color: #000;
                        color: #00ff00;
                        padding: 20px;
                        border-radius: 4px;
                        font-family: monospace;
                        font-size: 14px;
                        white-space: pre-wrap;
                        overflow-x: auto;
                        margin-bottom: 20px;
                    }
                    .links {
                        margin-top: 20px;
                        padding: 20px;
                        background-color: #f9f9f9;
                        border-radius: 4px;
                    }
                    .btn {
                        background-color: #4CAF50;
                        color: white;
                        padding: 10px 20px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        margin-right: 10px;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .btn:hover {
                        background-color: #45a049;
                    }
                    .btn-secondary {
                        background-color: #6c757d;
                    }
                    .btn-secondary:hover {
                        background-color: #5a6268;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Running Playwright Tests</h1>
                    <div class="output" id="output">
        `);
        
        // Execute the command and stream output
        const child = exec(testCommand, { cwd: __dirname });
        
        child.stdout.on('data', (data) => {
            const escapedData = data.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
            res.write(escapedData);
        });
        
        child.stderr.on('data', (data) => {
            const escapedData = data.toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
            res.write(`<span style="color: #ff6b6b;">${escapedData}</span>`);
        });
        
        child.on('close', (code) => {
            res.write(`
                    </div>
                    <div class="links">
                        <h3>Test Results</h3>
                        <p>Test execution completed with exit code: ${code}</p>
                        <a href="/playwright-report/index.html" class="btn" target="_blank">View HTML Report</a>
                        <a href="/edit-urls" class="btn btn-secondary">Edit URLs</a>
                        <a href="/" class="btn btn-secondary">Back to Form</a>
                    </div>
                </div>
            </body>
            </html>
            `);
            res.end();
        });
        
        child.on('error', (error) => {
            console.error('Test execution error:', error);
            res.write(`<span style="color: #ff6b6b;">Error: ${error.message}</span>`);
            res.end();
        });
        
    } catch (error) {
        console.error('Error running tests:', error);
        res.status(500).send(`
            <h1>Error Running Tests</h1>
            <p>Error: ${error.message}</p>
            <a href="/">Back to Form</a>
        `);
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`QA Dashboard server running at http://localhost:${PORT}`);
    console.log('Available routes:');
    console.log('  GET  / - Main form');
    console.log('  POST /run-crawler - Run crawler with form data');
    console.log('  GET  /edit-urls - Edit URLs interface');
    console.log('  POST /save-urls - Save edited URLs');
    console.log('  GET  /run-tests - Run Playwright tests');
    console.log('  GET  /playwright-report/* - Static test reports');
});

module.exports = app; 