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
            `Progress: ${progress.completed}/${progress.total} tests completed ` +
            `(${progress.passed} passed, ${progress.failed} failed)`;
        
        // Update current test
        if (progress.currentTest) {
            currentTestDiv.style.display = 'block';
            currentTestDiv.innerHTML = `<strong>Running:</strong> ${progress.currentTest}`;
        }
    } else if (progress.stage === 'completed') {
        progressSection.style.display = 'block';
        progressFill.style.width = '100%';
        progressFill.style.backgroundColor = '#28a745';
        progressFill.textContent = '100%';
        
        document.getElementById('progressText').innerHTML = 
            `Completed: ${progress.completed} tests (${progress.passed} passed, ${progress.failed} failed)`;
        
        currentTestDiv.innerHTML = '<strong>All tests completed!</strong>';
        
        // Show results section when tests complete
        updateTestResults();
    }
}

function updateTestResults() {
    fetch('/test-results-files')
        .then(response => response.json())
        .then(data => {
            const resultsSection = document.getElementById('resultsSection');
            const passedUrlsColumn = document.getElementById('passedUrlsColumn');
            const noMetaUrlsColumn = document.getElementById('noMetaUrlsColumn');
            const passedUrlsDiv = document.getElementById('passedUrls');
            const noMetaUrlsDiv = document.getElementById('noMetaUrls');
            
            if (!resultsSection || !passedUrlsColumn || !noMetaUrlsColumn || !passedUrlsDiv || !noMetaUrlsDiv) {
                return;
            }
            
            let hasResults = false;
            
            // Display processed URLs only if they exist
            if (data.passedUrls && data.passedUrls.length > 0) {
                passedUrlsDiv.innerHTML = data.passedUrls
                    .map(url => `<div class="url-item">${url}</div>`)
                    .join('');
                passedUrlsColumn.style.display = 'block';
                hasResults = true;
            } else {
                passedUrlsColumn.style.display = 'none';
            }
            
            // Display no meta URLs only if they exist
            if (data.noMetaUrls && data.noMetaUrls.length > 0) {
                noMetaUrlsDiv.innerHTML = data.noMetaUrls
                    .map(url => `<div class="url-item">${url}</div>`)
                    .join('');
                noMetaUrlsColumn.style.display = 'block';
                hasResults = true;
            } else {
                noMetaUrlsColumn.style.display = 'none';
            }
            
            // Only show results section if there are results to display
            if (hasResults) {
                resultsSection.style.display = 'block';
            } else {
                resultsSection.style.display = 'none';
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

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Connect to progress stream
    connectToProgress();
    
    // Poll every 2 seconds for completion check
    setInterval(checkTestStatus, 2000);
    
    // Initial check after 3 seconds
    setTimeout(checkTestStatus, 3000);
}); 