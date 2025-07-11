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

// Test progress tracking
let testProgress = {
    currentTest: '',
    completed: 0,
    total: 0,
    failed: 0,
    passed: 0,
    currentFile: '',
    stage: 'idle', // 'running', 'completed'
    completedTests: new Set() // Track which tests have been counted
};

// Store SSE connections for real-time updates
let sseClients = [];

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

        // Run the crawler with environment variables
        console.log('🕷️ Starting crawler...');
        const crawlerCommand = `ENV=${formData.ENV} DOMAIN=${formData.DOMAIN} node crawler.mjs`;
        
        const { stdout, stderr } = await execAsync(crawlerCommand, { cwd: __dirname });
        console.log('✅ Crawler completed successfully');
        
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
    res.json(testStatus);
});

// Route 5.1: Server-Sent Events for real-time progress
app.get('/progress', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial progress state (excluding the Set)
    const initialData = {
        currentTest: testProgress.currentTest,
        completed: testProgress.completed,
        total: testProgress.total,
        failed: testProgress.failed,
        passed: testProgress.passed,
        currentFile: testProgress.currentFile,
        stage: testProgress.stage
    };
    res.write(`data: ${JSON.stringify(initialData)}\n\n`);

    // Add this client to the list
    sseClients.push(res);

    // Remove client when connection closes
    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

// Function to broadcast progress updates
function broadcastProgress() {
    // Create a clean copy without the Set (which can't be serialized)
    const progressData = {
        currentTest: testProgress.currentTest,
        completed: testProgress.completed,
        total: testProgress.total,
        failed: testProgress.failed,
        passed: testProgress.passed,
        currentFile: testProgress.currentFile,
        stage: testProgress.stage
    };
    
    const data = `data: ${JSON.stringify(progressData)}\n\n`;
    sseClients.forEach(client => {
        try {
            client.write(data);
        } catch (error) {
            // Remove dead connections
            sseClients = sseClients.filter(c => c !== client);
        }
    });
}

// Track last logged state to avoid duplicates
let lastLoggedState = {
    currentTest: '',
    completed: -1,
    passed: -1,
    failed: -1
};

// Function to log progress to server console
function logProgress() {
    if (testProgress.stage === 'running') {
        const percentage = testProgress.total > 0 ? Math.round((testProgress.completed / testProgress.total) * 100) : 0;
        
        // Only log current test if it changed
        if (testProgress.currentTest && testProgress.currentTest !== lastLoggedState.currentTest) {
            console.log(`🔄 [${percentage}%] Running: ${testProgress.currentTest}`);
            lastLoggedState.currentTest = testProgress.currentTest;
        }
        
        // Only log progress stats if numbers changed
        if (testProgress.total > 0 && 
            (testProgress.completed !== lastLoggedState.completed || 
             testProgress.passed !== lastLoggedState.passed || 
             testProgress.failed !== lastLoggedState.failed)) {
            console.log(`📊 Progress: ${testProgress.completed}/${testProgress.total} (${testProgress.passed} passed, ${testProgress.failed} failed)`);
            lastLoggedState.completed = testProgress.completed;
            lastLoggedState.passed = testProgress.passed;
            lastLoggedState.failed = testProgress.failed;
        }
    } else if (testProgress.stage === 'completed') {
        console.log(`✅ Tests completed: ${testProgress.completed} total (${testProgress.passed} passed, ${testProgress.failed} failed)`);
        // Reset for next run
        lastLoggedState = { currentTest: '', completed: -1, passed: -1, failed: -1 };
    }
}

// Function to parse test progress from Playwright output
function parseTestProgress(output) {
    const lines = output.split('\n').filter(line => line.trim()); // Remove empty lines
    let shouldBroadcast = false;
    
    lines.forEach(line => {
        // Skip lines that look like partial/corrupted output
        if (line.includes('139 |') || line.includes('console.log') || line.length < 10) {
            return;
        }
        
        // Match "Running X tests using Y workers"
        const runningMatch = line.match(/^Running\s+(\d+)\s+tests?\s+using/);
        if (runningMatch) {
            const newTotal = parseInt(runningMatch[1]);
            if (testProgress.total !== newTotal) {
                testProgress.total = newTotal;
                // Reset completed tests tracking for new run
                testProgress.completedTests.clear();
                shouldBroadcast = true;
            }
        }
        
        // Match current test: [chromium] › tests/pixel.test.mjs:79:5 › Test Name
        const testMatch = line.match(/^\[chromium\]\s*›.*?›\s*(.+?)(?:\s*─|$)/);
        if (testMatch) {
            const newTest = testMatch[1].trim();
            if (testProgress.currentTest !== newTest && !newTest.includes('ended')) {
                testProgress.currentTest = newTest;
                shouldBroadcast = true;
            }
        }
        
        // Match test completion: "Pixel Comparison for -blog ended - PASSED/FAILED/ERROR"
        const endedMatch = line.match(/^\s*(.+?) ended - (PASSED|FAILED|ERROR)(\s*\([^)]+\))?\s*$/);
        if (endedMatch) {
            const testName = endedMatch[1].trim();
            const result = endedMatch[2];
            const note = endedMatch[3] || '';
            
            // Only count each test once
            if (!testProgress.completedTests.has(testName)) {
                testProgress.completedTests.add(testName);
                testProgress.currentTest = `${testName} ended - ${result}${note}`;
                
                // Update counters based on result
                if (result === 'PASSED') {
                    testProgress.passed++;
                } else if (result === 'FAILED' || result === 'ERROR') {
                    testProgress.failed++;
                }
                testProgress.completed = testProgress.passed + testProgress.failed;
                
                const timestamp = new Date().toISOString();
                console.log(`✅ [${timestamp}] INDIVIDUAL TEST COMPLETE: ${testName} - ${result} (Progress: ${testProgress.completed}/${testProgress.total})`);
                
                shouldBroadcast = true;
            }
        }
        
        // Match final summary: "5 failed" or "3 passed" (only for logging, not completion)
        const finalMatch = line.match(/^\s*(\d+)\s+(failed|passed)\s*$/);
        if (finalMatch) {
            const count = parseInt(finalMatch[1]);
            const status = finalMatch[2];
            const timestamp = new Date().toISOString();
            console.log(`📊 [${timestamp}] FINAL SUMMARY DETECTED: ${count} ${status} (Current progress: ${testProgress.completed}/${testProgress.total})`);
            
            // Just log this, don't trigger completion - let process close handle that
            shouldBroadcast = true;
        }
        
        // Detect completion patterns
        if (line.includes('Serving HTML report at')) {
            // Tests are definitely complete, but don't force completion count
            // The process will handle final completion when it closes
            shouldBroadcast = true;
        }
    });
    
    // Only broadcast once per output chunk if something actually changed
    if (shouldBroadcast) {
        broadcastProgress();
        logProgress();
    }
}

// Route 5.2: Reset test status (for debugging)
app.post('/reset-test-status', (req, res) => {
    testStatus.isRunning = false;
    testStatus.startTime = null;
    testStatus.completedTime = null;
    
    // Reset progress data
    testProgress = {
        currentTest: '',
        completed: 0,
        total: 0,
        failed: 0,
        passed: 0,
        currentFile: '',
        stage: 'idle',
        completedTests: new Set()
    };
    
    // Reset logged state
    lastLoggedState = { currentTest: '', completed: -1, passed: -1, failed: -1 };
    
    broadcastProgress();
    
    if (currentTestProcess) {
        try {
            currentTestProcess.kill('SIGTERM');
        } catch (error) {
            // Silent error handling
        }
        currentTestProcess = null;
    }
    res.json({ success: true, message: 'Test status reset' });
});

// Route 5.3: Get test results files
app.get('/test-results-files', (req, res) => {
    const passedUrlsPath = path.join(__dirname, 'tests', 'urls-passed.json');
    const noMetaPath = path.join(__dirname, 'tests', 'nometa.json');
    
    let passedUrls = [];
    let noMetaUrls = [];
    
    try {
        if (fs.existsSync(passedUrlsPath)) {
            passedUrls = JSON.parse(fs.readFileSync(passedUrlsPath, 'utf8'));
        }
    } catch (error) {
        // Handle error silently, keep empty array
    }
    
    try {
        if (fs.existsSync(noMetaPath)) {
            noMetaUrls = JSON.parse(fs.readFileSync(noMetaPath, 'utf8'));
        }
    } catch (error) {
        // Handle error silently, keep empty array
    }
    
    res.json({
        passedUrls: passedUrls,
        noMetaUrls: noMetaUrls
    });
});

// Route 5.4: Clean up report folders manually
app.post('/cleanup-reports', (req, res) => {
    const foldersToClean = [
        { name: 'playwright-report', path: path.join(__dirname, 'playwright-report') },
        { name: 'test-results', path: path.join(__dirname, 'test-results') },
        { name: 'screenshots', path: path.join(__dirname, 'screenshots') }
    ];
    
    const filesToClean = [
        { name: 'urls-passed.json', path: path.join(__dirname, 'tests', 'urls-passed.json') },
        { name: 'nometa.json', path: path.join(__dirname, 'tests', 'nometa.json') }
    ];
    
    const cleanupResults = [];
    
    // Clean folders
    foldersToClean.forEach(folder => {
        try {
            if (fs.existsSync(folder.path)) {
                fs.rmSync(folder.path, { recursive: true, force: true });
                cleanupResults.push({ item: folder.name, type: 'folder', status: 'cleaned' });
            } else {
                cleanupResults.push({ item: folder.name, type: 'folder', status: 'not found' });
            }
        } catch (error) {
            cleanupResults.push({ item: folder.name, type: 'folder', status: 'error', error: error.message });
        }
    });
    
    // Clean files
    filesToClean.forEach(file => {
        try {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
                cleanupResults.push({ item: file.name, type: 'file', status: 'cleaned' });
            } else {
                cleanupResults.push({ item: file.name, type: 'file', status: 'not found' });
            }
        } catch (error) {
            cleanupResults.push({ item: file.name, type: 'file', status: 'error', error: error.message });
        }
    });
    
    res.json({ 
        success: true, 
        message: 'Manual cleanup completed', 
        results: cleanupResults 
    });
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
        
        // Reset and initialize progress tracking
        testProgress = {
            currentTest: '',
            completed: 0,
            total: 0,
            failed: 0,
            passed: 0,
            currentFile: '',
            stage: 'running',
            completedTests: new Set()
        };
        
        // Reset logged state for new test run
        lastLoggedState = { currentTest: '', completed: -1, passed: -1, failed: -1 };
        
        console.log('🚀 Starting Playwright tests...');
        broadcastProgress();
        
        // Clean up old report directory to ensure fresh results
        const reportDir = path.join(__dirname, 'playwright-report');
        if (fs.existsSync(reportDir)) {
            try {
                fs.rmSync(reportDir, { recursive: true, force: true });
            } catch (error) {
                // Silent error handling
            }
        }
        
        // Also clean up test-results if it exists (legacy)
        const testResultsDir = path.join(__dirname, 'test-results');
        if (fs.existsSync(testResultsDir)) {
            try {
                fs.rmSync(testResultsDir, { recursive: true, force: true });
            } catch (error) {
                // Silent error handling
            }
        }
        
        // Clean up screenshots folder to prevent accumulation
        const screenshotsDir = path.join(__dirname, 'screenshots');
        if (fs.existsSync(screenshotsDir)) {
            try {
                fs.rmSync(screenshotsDir, { recursive: true, force: true });
            } catch (error) {
                // Silent error handling
            }
        }
        
        // Clean up test result files to ensure fresh results
        const urlsPassedFile = path.join(__dirname, 'tests', 'urls-passed.json');
        const noMetaFile = path.join(__dirname, 'tests', 'nometa.json');
        
        if (fs.existsSync(urlsPassedFile)) {
            try {
                fs.unlinkSync(urlsPassedFile);
            } catch (error) {
                // Silent error handling
            }
        }
        
        if (fs.existsSync(noMetaFile)) {
            try {
                fs.unlinkSync(noMetaFile);
            } catch (error) {
                // Silent error handling
            }
        }
        
        // Build the command with environment variables and selected test files
        const testFiles = formData.selectedTests.map(test => `tests/${test}`).join(' ');
        const testCommand = `ENV1=${formData.ENV1} ENV2=${formData.ENV2} DOMAIN1=${formData.DOMAIN1} DOMAIN2=${formData.DOMAIN2} npx playwright test ${testFiles} --project=chromium --reporter=html --workers=8`;
        
        console.log('🧪 Executing command:', testCommand);
        
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

                    .progress-section {
                        margin: 20px 0;
                        padding: 20px;
                        background-color: #f8f9fa;
                        border-radius: 4px;
                        border: 1px solid #dee2e6;
                    }
                    .progress-bar {
                        width: 100%;
                        height: 20px;
                        background-color: #e9ecef;
                        border-radius: 10px;
                        overflow: hidden;
                        margin: 10px 0;
                    }
                    .progress-fill {
                        height: 100%;
                        background-color: #28a745;
                        transition: width 0.3s ease;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 12px;
                        font-weight: bold;
                    }
                    .progress-text {
                        font-size: 14px;
                        color: #495057;
                        margin: 5px 0;
                    }
                    .current-test {
                        font-family: monospace;
                        background-color: #f1f3f4;
                        padding: 8px;
                        border-radius: 4px;
                        margin: 10px 0;
                        border-left: 4px solid #007bff;
                    }
                    .results-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                        gap: 20px;
                        margin-top: 15px;
                    }
                    .result-column {
                        background-color: #f8f9fa;
                        padding: 15px;
                        border-radius: 4px;
                        border: 1px solid #dee2e6;
                    }
                    .result-column h5 {
                        margin: 0 0 10px 0;
                        color: #495057;
                    }
                    .url-list {
                        font-family: monospace;
                        font-size: 13px;
                        line-height: 1.4;
                        max-height: 200px;
                        overflow-y: auto;
                    }
                    .url-item {
                        padding: 4px 8px;
                        margin: 2px 0;
                        background-color: white;
                        border-radius: 2px;
                        border: 1px solid #e9ecef;
                    }
                </style>
                <script>
                    let testCompleted = false;
                    let eventSource = null;
                    
                    function connectToProgress() {
                        eventSource = new EventSource('/progress');
                        
                        eventSource.onmessage = function(event) {
                            const progress = JSON.parse(event.data);
                            updateProgressDisplay(progress);
                        };
                        
                        eventSource.onerror = function() {
                            // Reconnect after a delay if connection fails
                            setTimeout(connectToProgress, 5000);
                        };
                    }
                    
                    function updateProgressDisplay(progress) {
                        const progressSection = document.getElementById('progressSection');
                        const progressBar = document.getElementById('progressBar');
                        const progressFill = document.getElementById('progressFill');
                        const currentTestDiv = document.getElementById('currentTest');
                        
                        if (progress.stage === 'running') {
                            progressSection.style.display = 'block';
                            
                            // Update progress bar
                            const percentage = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
                            progressFill.style.width = percentage + '%';
                            progressFill.textContent = percentage + '%';
                            
                            // Update progress text
                            document.getElementById('progressText').innerHTML = 
                                \`Progress: \${progress.completed}/\${progress.total} tests completed \` +
                                \`(\${progress.passed} passed, \${progress.failed} failed)\`;
                            
                            // Update current test
                            if (progress.currentTest) {
                                currentTestDiv.style.display = 'block';
                                currentTestDiv.innerHTML = \`<strong>Running:</strong> \${progress.currentTest}\`;
                            }
                        } else if (progress.stage === 'completed') {
                            progressSection.style.display = 'block';
                            progressFill.style.width = '100%';
                            progressFill.style.backgroundColor = '#28a745';
                            progressFill.textContent = '100%';
                            
                            document.getElementById('progressText').innerHTML = 
                                \`Completed: \${progress.completed} tests (\${progress.passed} passed, \${progress.failed} failed)\`;
                            
                            currentTestDiv.innerHTML = '<strong>All tests completed!</strong>';
                            
                            // Show results section when tests complete
                            updateTestResults();
                        }
                    }
                    
                    function updateTestResults() {
                        console.log('Updating test results...');
                        fetch('/test-results-files')
                            .then(response => response.json())
                            .then(data => {
                                console.log('Test results data:', data);
                                const resultsSection = document.getElementById('resultsSection');
                                const passedUrlsColumn = document.getElementById('passedUrlsColumn');
                                const noMetaUrlsColumn = document.getElementById('noMetaUrlsColumn');
                                const passedUrlsDiv = document.getElementById('passedUrls');
                                const noMetaUrlsDiv = document.getElementById('noMetaUrls');
                                
                                // Check if all required elements exist
                                if (!resultsSection || !passedUrlsColumn || !noMetaUrlsColumn || !passedUrlsDiv || !noMetaUrlsDiv) {
                                    console.error('Some required DOM elements are missing');
                                    return;
                                }
                                
                                let hasResults = false;
                                
                                // Display passed URLs only if they exist
                                if (data.passedUrls && data.passedUrls.length > 0) {
                                    passedUrlsDiv.innerHTML = data.passedUrls
                                        .map(url => \`<div class="url-item">\${url}</div>\`)
                                        .join('');
                                    passedUrlsColumn.style.display = 'block';
                                    hasResults = true;
                                    console.log('Showing passed URLs:', data.passedUrls.length);
                                } else {
                                    passedUrlsColumn.style.display = 'none';
                                    console.log('No passed URLs to display');
                                }
                                
                                // Display no meta URLs only if they exist
                                if (data.noMetaUrls && data.noMetaUrls.length > 0) {
                                    noMetaUrlsDiv.innerHTML = data.noMetaUrls
                                        .map(url => \`<div class="url-item">\${url}</div>\`)
                                        .join('');
                                    noMetaUrlsColumn.style.display = 'block';
                                    hasResults = true;
                                    console.log('Showing no meta URLs:', data.noMetaUrls.length);
                                } else {
                                    noMetaUrlsColumn.style.display = 'none';
                                    console.log('No meta URLs to display');
                                }
                                
                                // Only show results section if there are results to display
                                if (hasResults) {
                                    resultsSection.style.display = 'block';
                                    console.log('Results section shown');
                                } else {
                                    resultsSection.style.display = 'none';
                                    console.log('Results section hidden - no results to display');
                                }
                            })
                            .catch(error => {
                                console.error('Error fetching test results:', error);
                            });
                    }
                    
                    function checkTestStatus() {
                        if (testCompleted) return;
                        
                        // Check the test status endpoint
                        fetch('/test-status')
                            .then(response => response.json())
                            .then(status => {
                                if (!status.isRunning && status.completedTime) {
                                    // Test is complete, now check if report exists
                                    fetch('/playwright-report/index.html')
                                        .then(reportResponse => {
                                            if (reportResponse.ok) {
                                                document.getElementById('status').className = 'status completed';
                                                document.getElementById('status').innerHTML = '✅ <strong>Tests Completed Successfully!</strong><br>Results are ready to view.';
                                                document.getElementById('reportBtn').style.display = 'inline-block';
                                                testCompleted = true;
                                                
                                                // Close progress connection
                                                if (eventSource) {
                                                    eventSource.close();
                                                }
                                            } else {
                                                // Test completed but report not ready yet
                                                document.getElementById('status').innerHTML = '⏳ <strong>Generating report...</strong><br>Please wait while the report is being generated.';
                                            }
                                        })
                                        .catch(error => {
                                            // Report not ready yet
                                            document.getElementById('status').innerHTML = '⏳ <strong>Generating report...</strong><br>Please wait while the report is being generated.';
                                        });
                                }
                            })
                            .catch(error => {
                                // Silent error handling
                            });
                    }
                    
                    // Connect to progress stream
                    connectToProgress();
                    
                    // Poll every 2 seconds for completion check
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
                    
                    <div id="status" class="status running">
                        🔄 <strong>Tests are running...</strong><br>
                        Please wait while the tests execute. This page will automatically update when complete.
                    </div>
                    
                    <div id="progressSection" class="progress-section" style="display: none;">
                        <h4>Test Progress</h4>
                        <div class="progress-bar">
                            <div id="progressFill" class="progress-fill" style="width: 0%;">0%</div>
                        </div>
                        <div id="progressText" class="progress-text">Initializing tests...</div>
                        <div id="currentTest" class="current-test" style="display: none;"></div>
                    </div>
                    
                    <div id="resultsSection" class="progress-section" style="display: none;">
                        <h4>Test Results Summary</h4>
                        <div class="results-grid">
                            <div id="passedUrlsColumn" class="result-column">
                                <h5>✅ Passed URLs</h5>
                                <div id="passedUrls" class="url-list"></div>
                            </div>
                            <div id="noMetaUrlsColumn" class="result-column">
                                <h5>⚠️ Missing Meta/Title</h5>
                                <div id="noMetaUrls" class="url-list"></div>
                            </div>
                        </div>
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
            const timestamp = new Date().toISOString();
            
            // Log key events for debugging
            if (output.includes('Serving HTML report at')) {
                console.log(`🎯 [${timestamp}] DETECTED: Serving HTML report`);
            }
            
            if (output.match(/^\s*\d+\s+(passed|failed)\s*$/)) {
                console.log(`🎯 [${timestamp}] DETECTED: Final summary line in output`);
            }
            
            // Parse test progress from output
            parseTestProgress(output);
        });
        
        child.stderr.on('data', (data) => {
            const timestamp = new Date().toISOString();
            console.log(`🚨 [${timestamp}] STDERR: ${data.toString().trim()}`);
        });
        
        child.on('close', (code) => {
            const timestamp = new Date().toISOString();
            console.log(`🏁 [${timestamp}] PROCESS CLOSE EVENT - Exit code: ${code}`);
            console.log(`🏁 [${timestamp}] Current progress: ${testProgress.completed}/${testProgress.total} (${testProgress.passed} passed, ${testProgress.failed} failed)`);
            console.log(`🏁 [${timestamp}] Test status isRunning: ${testStatus.isRunning}`);
            
            currentTestProcess = null;
            
            // Only update status if not already marked as completed
            if (testStatus.isRunning) {
                console.log(`🏁 [${timestamp}] Setting completion in 2 seconds...`);
                // Wait a moment for report files to be written, then mark as completed
                setTimeout(() => {
                    const completionTimestamp = new Date().toISOString();
                    if (testStatus.isRunning) { // Check again in case it was marked complete elsewhere
                        console.log(`🏁 [${completionTimestamp}] SETTING COMPLETION - Final counts: ${testProgress.completed}/${testProgress.total}`);
                        
                        testStatus.isRunning = false;
                        testStatus.completedTime = completionTimestamp;
                        
                        // Set completion when process closes - this is the definitive signal
                        testProgress.stage = 'completed';
                        broadcastProgress();
                        logProgress();
                        
                        console.log(`✅ [${completionTimestamp}] Test execution completed`);
                    } else {
                        console.log(`🏁 [${completionTimestamp}] Already marked complete, skipping`);
                    }
                }, 2000); // Wait 2 seconds for report generation
            } else {
                console.log(`🏁 [${timestamp}] Tests already marked as not running, skipping completion`);
            }
        });
        
        child.on('error', (error) => {
            const timestamp = new Date().toISOString();
            console.log(`💥 [${timestamp}] PROCESS ERROR EVENT: ${error.message}`);
            
            currentTestProcess = null;
            // Mark test as completed (with error)
            testStatus.isRunning = false;
            testStatus.completedTime = timestamp;
            
            // Set completion when process errors - this is the definitive signal  
            testProgress.stage = 'completed';
            broadcastProgress();
            logProgress();
            
            console.log(`💥 [${timestamp}] Marked complete due to error`);
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
});

module.exports = app; 