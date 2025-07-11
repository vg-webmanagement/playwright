# QA Dashboard

A comprehensive web-based quality assurance dashboard for automated testing using Node.js, Express, and Playwright.

## Features

- **Web Form Interface**: User-friendly form for configuring test environments and domains
- **Automated Web Crawling**: Runs crawler.mjs to discover URLs from sitemaps
- **URL Management**: Edit and manage the list of URLs to test via web interface
- **Playwright Test Execution**: Run automated tests with real-time output display
- **HTML Test Reports**: View detailed test results through integrated reporting
- **Real-time Progress Tracking**: Monitor test execution with live progress bars and status updates

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
node server.js
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

### 1. Configure Test Parameters

Fill out the form with the following information:

**Crawler Configuration:**
- **ENV**: Environment for crawler (e.g., `dev`, `test`, `www`)
- **DOMAIN**: Domain to crawl (e.g., `tlcvision.ca`)

**Test Configuration:**
- **ENV1**: First environment for comparison
- **ENV2**: Second environment for comparison
- **DOMAIN1**: First domain for comparison
- **DOMAIN2**: Second domain for comparison

**Test Selection:**
- **Pixel Comparison Tests**: Visual comparison between environments using pixel-perfect matching
- **Text Content Comparison Tests**: Compare rendered text content between environments
- **Title & Meta Tag Tests**: Compare page titles and meta descriptions between environments

### 2. Run Crawler

- Click "Start Crawler" to execute the web crawler
- The crawler will discover URLs from the specified domain's sitemaps
- URLs are saved to `tests/urls.json`

### 3. Edit URLs

- Review and modify the discovered URLs
- Add or remove URLs as needed
- Ensure the JSON format is valid (array of strings)

### 4. Execute Tests

- Select which test types to run (pixel comparison, text comparison, title/meta comparison)
- Run Playwright tests with your configured parameters
- Monitor progress with real-time progress bars showing:
  - Current test being executed
  - Number of tests completed/total
  - Pass/fail counts
- Access detailed HTML reports

### 5. View Results

- Click "View HTML Report" to see detailed test results
- Reports are served from `/playwright-report/index.html`

## Security Features

- **Input Sanitization**: All user inputs are sanitized to prevent injection attacks
- **URL Validation**: URLs are validated and sanitized before saving
- **JSON Validation**: Proper JSON format validation for URL lists

## File Structure

```
playwright/
├── server.js          # Express server with all routes
├── form.html          # Main form interface
├── crawler.mjs        # Web crawler script
├── tests/
│   └── urls.json      # Discovered/edited URLs
├── playwright-report/ # Generated test reports
└── package.json       # Dependencies
```

## API Routes

- `GET /` - Main form interface
- `POST /run-crawler` - Execute crawler with form data
- `GET /edit-urls` - URL editing interface
- `POST /save-urls` - Save edited URLs
- `GET /run-tests` - Execute Playwright tests
- `GET /test-status` - Check test execution status (JSON)
- `GET /progress` - Real-time test progress updates (Server-Sent Events)
- `POST /reset-test-status` - Reset test status (for debugging)
- `GET /playwright-report/*` - Static test reports

## Dependencies

- **express**: Web server framework
- **body-parser**: Request body parsing
- **@playwright/test**: Automated testing framework
- **fs**: File system operations
- **child_process**: Execute shell commands

## Notes

- The server runs on port 3000 by default
- Form data is stored in memory (session-based)
- All file operations are performed locally
- Test reports are automatically generated and served
- Test execution status is tracked server-side to prevent showing stale results
- Old test reports are automatically cleaned up before new test runs
- Real-time progress updates use Server-Sent Events for live feedback
- Progress tracking shows current test execution, completion counts, and pass/fail statistics

## Troubleshooting

1. **Dependencies not found**: Run `npm install` to install required packages
2. **Port already in use**: Stop any existing processes on port 3000
3. **Crawler fails**: Check that the specified domain and environment are accessible
4. **Tests fail**: Verify that all environment variables are correctly set
5. **Tests stuck in "running" state**: Use `POST /reset-test-status` to reset status
6. **Report not showing**: Verify that `playwright-report/index.html` exists in the project directory

## Development

To modify the dashboard:

1. Edit `server.js` for backend functionality
2. Edit `form.html` for frontend interface
3. Modify `crawler.mjs` for crawling behavior
4. Update `playwright.config.js` for test configuration 