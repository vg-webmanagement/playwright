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

// Track test execution status
let testStatus = {
    isRunning: false,
    startTime: null,
    completedTime: null
};

// Track the current test process
let currentTestProcess = null;

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
            DOMAIN2: sanitizeInput(req.body.DOMAIN2),
            selectedTests: Array.isArray(req.body.selectedTests) ? req.body.selectedTests : [req.body.selectedTests]
        };
        
        // Validate that at least one test is selected
        if (!formData.selectedTests || formData.selectedTests.length === 0) {
            return res.status(400).send(`
                <h1>Error: No Tests Selected</h1>
                <p>Please select at least one test to run.</p>
                <a href="/">Back to Form</a>
            `);
        }

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

// Route 5: Test status endpoint
app.get('/test-status', (req, res) => {
    console.log('Test status requested:', testStatus);
    res.json(testStatus);
});

// Route 5.1: Reset test status (for debugging)
app.post('/reset-test-status', (req, res) => {
    console.log('Resetting test status');
    testStatus.isRunning = false;
    testStatus.startTime = null;
    testStatus.completedTime = null;
    if (currentTestProcess) {
        try {
            currentTestProcess.kill('SIGTERM');
            console.log('Killed running test process');
        } catch (error) {
            console.log('Error killing test process:', error.message);
        }
        currentTestProcess = null;
    }
    res.json({ success: true, message: 'Test status reset' });
});

// Route 6: Run Playwright tests
app.get('/run-tests', async (req, res) => {
    try {
        if (!formData.ENV1 || !formData.ENV2 || !formData.DOMAIN1 || !formData.DOMAIN2) {
            return res.status(400).send(`
                <h1>Error: Missing Test Configuration</h1>
                <p>Please go back and fill out all required fields.</p>
                <a href="/">Back to Form</a>
            `);
        }
        
        if (!formData.selectedTests || formData.selectedTests.length === 0) {
            return res.status(400).send(`
                <h1>Error: No Tests Selected</h1>
                <p>Please go back and select at least one test to run.</p>
                <a href="/">Back to Form</a>
            `);
        }

        console.log('Running Playwright tests with:', formData);
        
        // Mark test as running
        testStatus.isRunning = true;
        testStatus.startTime = new Date().toISOString();
        testStatus.completedTime = null;
        console.log('Test status updated to running at:', testStatus.startTime);
        
        // Clean up old report directory to ensure fresh results
        const reportDir = path.join(__dirname, 'playwright-report');
        if (fs.existsSync(reportDir)) {
            try {
                fs.rmSync(reportDir, { recursive: true, force: true });
                console.log('Cleaned up old test report directory');
            } catch (error) {
                console.warn('Could not clean up old report directory:', error.message);
            }
        }
        
        // Also clean up test-results if it exists (legacy)
        const testResultsDir = path.join(__dirname, 'test-results');
        if (fs.existsSync(testResultsDir)) {
            try {
                fs.rmSync(testResultsDir, { recursive: true, force: true });
                console.log('Cleaned up old test-results directory');
            } catch (error) {
                console.warn('Could not clean up old test-results directory:', error.message);
            }
        }
        
        // Build the command with environment variables and selected test files
        const testFiles = formData.selectedTests.map(test => `tests/${test}`).join(' ');
        const testCommand = `ENV1=${formData.ENV1} ENV2=${formData.ENV2} DOMAIN1=${formData.DOMAIN1} DOMAIN2=${formData.DOMAIN2} npx playwright test ${testFiles} --project=chromium --reporter=html`;
        
        console.log('Running test command:', testCommand);
        
        // Show the initial page immediately
        res.send(`
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
                    .status {
                        padding: 20px;
                        border-radius: 4px;
                        margin-bottom: 20px;
                        text-align: center;
                        font-size: 16px;
                    }
                    .status.running {
                        background-color: #fff3cd;
                        color: #856404;
                        border: 1px solid #ffeaa7;
                    }
                    .status.completed {
                        background-color: #d4edda;
                        color: #155724;
                        border: 1px solid #c3e6cb;
                    }
                    .status.error {
                        background-color: #f8d7da;
                        color: #721c24;
                        border: 1px solid #f5c6cb;
                    }
                    .links {
                        margin-top: 20px;
                        padding: 20px;
                        background-color: #f9f9f9;
                        border-radius: 4px;
                        text-align: center;
                    }
                    .btn {
                        background-color: #4CAF50;
                        color: white;
                        padding: 12px 24px;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        margin: 5px;
                        text-decoration: none;
                        display: inline-block;
                        transition: background-color 0.3s;
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
                    .test-info {
                        margin-bottom: 20px;
                        padding: 15px;
                        background-color: #e8f5e8;
                        border-radius: 4px;
                    }
                    .spinner {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #3498db;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 0 auto 20px;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
                <script>
                    let testCompleted = false;
                    
                    function checkTestStatus() {
                        if (testCompleted) return;
                        
                        // Check the test status endpoint
                        fetch('/test-status')
                            .then(response => response.json())
                            .then(status => {
                                console.log('Test status received:', status);
                                if (!status.isRunning && status.completedTime) {
                                    console.log('Test is complete, checking for report...');
                                    // Test is complete, now check if report exists
                                    fetch('/playwright-report/index.html')
                                        .then(reportResponse => {
                                            console.log('Report response status:', reportResponse.status);
                                            if (reportResponse.ok) {
                                                console.log('Report is ready, showing completion message');
                                                document.getElementById('status').className = 'status completed';
                                                document.getElementById('status').innerHTML = '✅ <strong>Tests Completed Successfully!</strong><br>Results are ready to view.';
                                                document.getElementById('spinner').style.display = 'none';
                                                document.getElementById('reportBtn').style.display = 'inline-block';
                                                testCompleted = true;
                                            } else {
                                                // Test completed but report not ready yet
                                                console.log('Test completed but report not ready yet');
                                                document.getElementById('status').innerHTML = '⏳ <strong>Generating report...</strong><br>Please wait while the report is being generated.';
                                            }
                                        })
                                        .catch(error => {
                                            // Report not ready yet
                                            console.log('Error fetching report:', error);
                                            document.getElementById('status').innerHTML = '⏳ <strong>Generating report...</strong><br>Please wait while the report is being generated.';
                                        });
                                } else {
                                    console.log('Test still running or not completed yet');
                                }
                            })
                            .catch(error => {
                                console.error('Error checking test status:', error);
                            });
                    }
                    
                    // Poll every 2 seconds
                    setInterval(checkTestStatus, 2000);
                    
                    // Initial check after 3 seconds
                    setTimeout(checkTestStatus, 3000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>Playwright Test Execution</h1>
                    
                    <div class="test-info">
                        <h3>Selected Tests:</h3>
                        <ul>
                            ${formData.selectedTests.map(test => {
                                const testName = test.replace('.test.mjs', '');
                                const displayName = testName === 'pixel' ? 'Pixel Comparison Tests' :
                                                  testName === 'textcompare' ? 'Text Content Comparison Tests' :
                                                  testName === 'titleandmeta' ? 'Title & Meta Tag Tests' : testName;
                                return `<li><strong>${displayName}</strong> (${test})</li>`;
                            }).join('')}
                        </ul>
                    </div>
                    
                    <div id="spinner" class="spinner"></div>
                    
                    <div id="status" class="status running">
                        🔄 <strong>Tests are running...</strong><br>
                        Please wait while the tests execute. This page will automatically update when complete.
                    </div>
                    
                    <div class="links">
                        <h3>Actions</h3>
                        <a href="/playwright-report/index.html" id="reportBtn" class="btn" target="_blank" style="display: none;">View HTML Report</a>
                        <a href="/edit-urls" class="btn btn-secondary">Edit URLs</a>
                        <a href="/" class="btn btn-secondary">Back to Form</a>
                    </div>
                </div>
            </body>
            </html>
        `);
        
        // Execute the command in the background
        const child = exec(testCommand, { cwd: __dirname });
        currentTestProcess = child;
        
        child.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('Test stdout:', output);
            
            // Check if this indicates test completion
            if (output.includes('Serving HTML report at') || 
                output.includes('failed') || 
                output.includes('passed') || 
                output.match(/\d+ (passed|failed)/)) {
                
                                // Tests are likely complete, check for report file
                setTimeout(() => {
                    const reportFile = path.join(__dirname, 'playwright-report', 'index.html');
                    if (fs.existsSync(reportFile) && testStatus.isRunning) {
                        console.log('Test completion detected via stdout, marking as complete');
                        testStatus.isRunning = false;
                        testStatus.completedTime = new Date().toISOString();
                        console.log('Test status updated to completed at:', testStatus.completedTime);
                        
                        // Kill the child process since we no longer need it
                        if (currentTestProcess) {
                            try {
                                currentTestProcess.kill('SIGTERM');
                                console.log('Child process terminated');
                            } catch (error) {
                                console.log('Error terminating child process:', error.message);
                            }
                        }
                    }
                }, 3000); // Wait 3 seconds for report to be fully written
            }
        });
        
        child.stderr.on('data', (data) => {
            console.error('Test stderr:', data.toString());
        });
        
        child.on('close', (code) => {
            console.log(`Test execution completed with exit code: ${code}`);
            currentTestProcess = null;
            
            // Only update status if not already marked as completed
            if (testStatus.isRunning) {
                // Wait a moment for report files to be written, then mark as completed
                setTimeout(() => {
                    if (testStatus.isRunning) { // Check again in case it was marked complete elsewhere
                        testStatus.isRunning = false;
                        testStatus.completedTime = new Date().toISOString();
                        console.log('Test status updated to completed at:', testStatus.completedTime);
                        
                        // Check if report file exists
                        const reportDir = path.join(__dirname, 'playwright-report');
                        const reportFile = path.join(reportDir, 'index.html');
                        
                        console.log('Checking for report directory at:', reportDir);
                        if (fs.existsSync(reportDir)) {
                            console.log('Report directory exists');
                            const files = fs.readdirSync(reportDir);
                            console.log('Files in report directory:', files);
                            
                            if (fs.existsSync(reportFile)) {
                                console.log('Report file confirmed to exist at:', reportFile);
                            } else {
                                console.log('Report file not found at:', reportFile);
                            }
                        } else {
                            console.log('Report directory does not exist');
                        }
                    }
                }, 2000); // Wait 2 seconds for report generation
            }
        });
        
        child.on('error', (error) => {
            console.error('Test execution error:', error);
            currentTestProcess = null;
            // Mark test as completed (with error)
            testStatus.isRunning = false;
            testStatus.completedTime = new Date().toISOString();
            console.log('Test status updated to completed (with error) at:', testStatus.completedTime);
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