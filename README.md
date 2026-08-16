# UpWork Scraper (Puppeteer)

A lightweight web scraper built with Puppeteer to extract job listings and related data from UpWork. This repository contains scripts and HTML templates to automate browsing and data extraction. Use responsibly and follow UpWork's terms of service.

## Features

- Headless browser automation with Puppeteer
- Configurable search queries and filters
- Export results to JSON/CSV/HTML (adjustable in code)
- Basic retry and rate-limiting support

## Tech stack

- Node.js
- Puppeteer
- JavaScript/HTML

> Note: The repository is primarily HTML files with JavaScript puppeteer scripts.

## Prerequisites

- Node.js (v14+ recommended)
- npm or yarn

## Installation

1. Clone the repository:

   git clone https://github.com/kirollos2001/UpWork_Scraper_puppeteer.git
   cd UpWork_Scraper_puppeteer

2. Install dependencies:

   npm install
   # or
   yarn install

## Configuration

Create a `.env` file in the project root (if the project uses environment variables). Example:

```
NODE_ENV=production
HEADLESS=true
SEARCH_QUERY="web scraping"
OUTPUT_FORMAT=json
OUTPUT_PATH=./output
RATE_LIMIT_MS=2000
```

Adjust variables and defaults inside the scripts as needed.

## Usage

Run the main script (replace `index.js` with the actual entry file if different):

```
node index.js
# or with npm
npm start
```

Common options you might configure in the script:

- Search query or filters
- Date range
- Output path and format
- Headless mode (for debugging, set HEADLESS=false)

## Output

The scraper saves extracted job listings to the configured output directory in JSON/CSV/HTML formats. Inspect the output files to verify selectors and data fields.

## Scraping etiquette & Legal

- Respect UpWork's robots.txt and terms of service.
- Keep request rates low and implement exponential backoff on errors.
- Use this project for learning and legitimate automation only. The author is not responsible for misuse.

## Troubleshooting

- If pages fail to load, try disabling headless mode to see the browser: `HEADLESS=false`.
- Increase timeouts in Puppeteer navigation and waitFor selectors.
- Update selectors if UpWork changes their page structure.

## Contributing

Contributions are welcome. Please open an issue or submit a pull request with improvements, bug fixes, or tests.
