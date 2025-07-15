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

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

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
            SOURCE_URL: sanitizeInput(req.body.SOURCE_URL),
            TARGET_URL: sanitizeInput(req.body.TARGET_URL),
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
        const crawlerCommand = `DOMAIN=${formData.SOURCE_URL} node crawler.mjs`;
        
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

        // Read the HTML template and replace placeholder
        const templatePath = path.join(__dirname, 'public', 'edit-urls.html');
        let htmlContent = fs.readFileSync(templatePath, 'utf8');
        htmlContent = htmlContent.replace('{{URLS_CONTENT}}', urlsContent);
        
        res.send(htmlContent);
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
        // Skip verbose output while keeping essential test completion messages
        if (line.includes('at file:///') ||
            line.includes('at /workspaces/') ||
            line.includes('node_modules/playwright/lib/') ||
            line.includes('TimeoutManager.withRunnable') ||
            line.includes('TestInfoImpl._runAsStage') ||
            line.includes('WorkerMain._runTest') ||
            line.includes('WorkerMain.runTestGroup') ||
            line.includes('at process.<anonymous>') ||
            line.includes('An error occurred while comparing') ||
            line.includes('Error: Test failed:') ||
            line.includes('Check the attached diff image') ||
            line.length < 10) {
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
                shouldBroadcast = true;
            }
        }
        
        // Match final summary: "5 failed" or "3 passed" (for progress tracking only)
        const finalMatch = line.match(/^\s*(\d+)\s+(failed|passed)\s*$/);
        if (finalMatch) {
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
        if (!formData.SOURCE_URL || !formData.TARGET_URL) {
            return res.status(400).send(`
                <h1>Error: Missing Test Configuration</h1>
                <p>Please go back and fill out Source URL and Target URL fields.</p>
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
        const testCommand = `SOURCE_URL=${formData.SOURCE_URL} TARGET_URL=${formData.TARGET_URL} npx playwright test ${testFiles} --project=chromium --reporter=html --workers=8`;
        

        
        // Generate selected tests HTML
        const selectedTestsHTML = formData.selectedTests.map(test => {
            const testName = test.replace('.test.mjs', '');
            const displayName = testName === 'pixel' ? 'Pixel Comparison Tests' :
                              testName === 'textcompare' ? 'Text Content Comparison Tests' :
                              testName === 'titleandmeta' ? 'Title & Meta Tag Tests' : testName;
            return `<li><strong>${displayName}</strong> (${test})</li>`;
        }).join('');

        // Read the HTML template and replace placeholder
        const templatePath = path.join(__dirname, 'public', 'test-results.html');
        let htmlContent = fs.readFileSync(templatePath, 'utf8');
        htmlContent = htmlContent.replace('{{SELECTED_TESTS}}', selectedTestsHTML);
        
        // Show the initial page immediately
        res.send(htmlContent);
        
        // Execute the command in the background with extended options and suppressed output
        const child = exec(testCommand, { 
            cwd: __dirname,
            maxBuffer: 1024 * 1024 * 10, // 10MB buffer to prevent issues with large output
            timeout: 0 // Disable timeout - let tests run as long as needed
        });
        currentTestProcess = child;
        
        console.log('🚀 Starting test execution...');
        
                child.stdout.on('data', (data) => {
            const output = data.toString();
            
            // Check for test completion
            if (output.includes('Serving HTML report at')) {
                if (testStatus.isRunning) {
                    console.log('✅ Tests completed - Report is ready');
                    testStatus.isRunning = false;
                    testStatus.completedTime = new Date().toISOString();
                    
                    testProgress.stage = 'completed';
                    broadcastProgress();
                    logProgress();
                }
            }
            
            // Parse test progress 
            parseTestProgress(output);
        });
        
        child.stderr.on('data', (data) => {
            // Log errors if they occur
            console.log('⚠️ Test process error:', data.toString().trim());
        });
        
        child.on('close', (code, signal) => {
            currentTestProcess = null;
            
            if (testStatus.isRunning) {
                console.log('🏁 Test process ended, marking as complete');
                testStatus.isRunning = false;
                testStatus.completedTime = new Date().toISOString();
                
                testProgress.stage = 'completed';
                broadcastProgress();
                logProgress();
            }
        });
        
        child.on('error', (error) => {
            console.log('💥 Test process error:', error.message);
            
            currentTestProcess = null;
            testStatus.isRunning = false;
            testStatus.completedTime = new Date().toISOString();
            
            testProgress.stage = 'completed';
            broadcastProgress();
            logProgress();
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