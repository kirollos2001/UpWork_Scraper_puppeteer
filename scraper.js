// File: scraper.js

const path = require("path");
const fs = require("fs");
const { connect } = require("puppeteer-real-browser");


class WorkingUpworkScraper_NoCookie {
    constructor() {
        this.browser = null;
        this.page = null;
        // Use a dedicated persistent profile in the project directory
        this.profileDir = path.join(__dirname, "scraper_profile");
        // Path to the file that persists the last 10 scraped job IDs
        this.seenJobIdsFile = path.join(__dirname, "seen_job_ids.json");
    }

    async init() {
        console.log("🚀 Initializing browser...");

        const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

        // ── Ensure the profile directory exists before connect() ──────────────
        // puppeteer-real-browser writes chrome-out.log into userDataDir on
        // startup, so the folder MUST exist before we call connect().
        if (!fs.existsSync(this.profileDir)) {
            fs.mkdirSync(this.profileDir, { recursive: true });
            console.log(`📁 Created profile directory: ${this.profileDir}`);
        }

        try {
            // ── Step 1: Launch the stealth browser ────────────────────────────
            const { browser, page } = await connect({
                headless: false,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--start-maximized",
                ],
                fingerprint: false,
                turnstile: true,   // auto-solve Cloudflare Turnstile
                customConfig: {
                    chromePath,
                    userDataDir: this.profileDir,
                },
                connectOption: {
                    defaultViewport: null,
                },
            });

            this.browser = browser;
            this.page = page;
            console.log("✅ Stealth browser launched.");

            // ── Step 2: Navigate to Upwork (profile session auto-restored) ────
            console.log("🌐 Navigating to Upwork...");
            console.log("ℹ️  Using persistent Chrome profile.");
            await this.page.goto("https://www.upwork.com", {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });
            await this.waitForCloudflareComplete(this.page);

            console.log("✅ Browser initialized.");
            return true;
        } catch (error) {
            console.error("❌ Failed to initialize browser:", error.message);
            return false;
        }
    }

    async navigateToUpwork(targetUrl) {
        console.log(`🌐 Navigating to ${targetUrl}...`);
        try {
            // Use domcontentloaded instead of networkidle2.
            // Upwork/Cloudflare performs multiple redirects during the challenge
            // resolution which destroys the execution context when using
            // networkidle2. domcontentloaded resolves quickly and lets
            // waitForCloudflareComplete handle the polling loop instead.
            try {
                await this.page.goto(targetUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 90000,
                });
            } catch (navErr) {
                // "Execution context was destroyed" means Cloudflare redirected
                // us to the real page — this is expected and not a real error.
                if (
                    navErr.message.includes("Execution context was destroyed") ||
                    navErr.message.includes("Navigation failed") ||
                    navErr.message.includes("net::ERR_ABORTED")
                ) {
                    console.log("⚠️ Navigation context reset (Cloudflare redirect) — continuing...");
                } else {
                    throw navErr; // real error, re-throw
                }
            }
            await this.waitForCloudflareComplete(this.page);
            // Extra settle time for JS framework to finish rendering
            await this.delay(3000, 5000);
            console.log("✅ Successfully reached the target page.");

            // ── Verify Authentication ─────────────────────────────────────────
            console.log("🔍 Checking authentication status...");
            const isAuthenticated = await this.page.evaluate(() => {
                const hasLoginButton = document.querySelector(
                    'a[href*="/ab/account-security/login"], [data-qa="login"], a[href*="/login"]'
                );
                const hasSignUpButton = document.querySelector('a[href*="/signup"]');
                const hasAvatar = document.querySelector(
                    '.nav-avatar, [data-test="nav-avatar"], [data-qa="avatar"], img[alt*="avatar"]'
                );
                const hasMyJobs = document.querySelector('a[href*="/ab/jobs"]');

                if (hasAvatar || hasMyJobs) return true;
                if (hasLoginButton || hasSignUpButton) return false;
                return null;
            });

            if (isAuthenticated === true) {
                console.log("✅ Authentication confirmed — logged in.");
            } else if (isAuthenticated === false) {
                console.warn("⚠️  Not authenticated. Authentication session is unavailable — please log in once using the persistent Chrome profile.");
            } else {
                console.log("⚠️  Could not verify auth status, proceeding anyway...");
            }

            return true;
        } catch (error) {
            console.error("❌ Navigation failed:", error.message);
            return false;
        }
    }

    async delay(min = 2000, max = 4000) {
        const delay = Math.random() * (max - min) + min;
        console.log(`⏳ Waiting ${Math.round(delay / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // MODIFIED: now takes a `page` param (defaults to the main page) so the
    // same Cloudflare-wait logic can also be reused for job-detail tabs.
    async waitForCloudflareComplete(page = this.page) {
        console.log("🔍 Waiting for Cloudflare to complete...");
        let attempts = 0;
        const maxAttempts = 20;
        while (attempts < maxAttempts) {
            attempts++;
            const title = await page.title();
            const url = page.url();
            console.log(`Attempt ${attempts}/${maxAttempts} - ${title}`);

            const lowerTitle = title.toLowerCase();

            if (
                url.includes("upwork.com") &&
                !lowerTitle.includes("cloudflare") &&
                !lowerTitle.includes("checking") &&
                !lowerTitle.includes("moment") &&
                !lowerTitle.includes("attention required")
            ) {
                console.log("✅ Cloudflare completely bypassed!");
                return true;
            }
            await this.delay(4000, 6000);
        }
        console.log("⚠️ Continuing despite potential Cloudflare...");
        return true;
    }

    async findJobElements() {
        console.log("🔍 Looking for job elements...");

        // Upwork's search page is a SPA — job cards are injected by JS after
        // the initial HTML. We try several known selector patterns in order,
        // from most-specific (new Nuxt frontend) to older class-based ones.
        const selectors = [
            // ── New Nuxt / React frontend (2024-2025) ─────────────────────
            '[data-test="job-tile-list"] article',
            '[data-test="job-tile-list"] section',
            'article[data-job-uid]',
            '[data-test="JobTile"]',
            // ── Legacy selectors (kept as fallback) ───────────────────────
            'article[data-test="JobTile"]',
            ".job-tile",
            ".air3-card.job-tile",
            // ── Generic broad fallback (catches any job-like card) ────────
            'section.air3-card',
            '[class*="job-tile"]',
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: 12000 });
                const elements = await this.page.$$(selector);
                if (elements.length > 0) {
                    console.log(`✅ Found ${elements.length} elements with: ${selector}`);
                    return { elements, selector };
                }
            } catch (error) {
                console.log(`❌ Selector failed: ${selector}`);
            }
        }

        // ── No jobs found — save debug HTML so we can inspect the real DOM ──
        console.log("⚠️ No job elements found. Saving debug HTML for inspection...");
        try {
            const debugDir = require("path").join(__dirname, "debug_html");
            if (!require("fs").existsSync(debugDir)) {
                require("fs").mkdirSync(debugDir, { recursive: true });
            }
            const pageHtml = await this.page.content();
            const pageUrl = this.page.url();
            const filename = `search_debug_${Date.now()}.html`;
            require("fs").writeFileSync(require("path").join(debugDir, filename), pageHtml, "utf8");
            console.log(`📄 Saved: debug_html/${filename}  (URL: ${pageUrl})`);

            // Also log a snippet of text from the page body to help diagnose
            const bodyText = await this.page.evaluate(() =>
                (document.body?.innerText || "").slice(0, 500)
            );
            console.log("📝 Page body preview:", bodyText);
        } catch (e) {
            console.warn("Could not save debug HTML:", e.message);
        }

        return { elements: [], selector: null };
    }

    async scrapeJobs(maxJobs = 20) {
        console.log("📋 Starting job scraping...");
        const jobs = [];
        try {
            const { elements: jobElements } = await this.findJobElements();
            if (jobElements.length === 0) {
                console.log("❌ No job elements found to scrape.");
                return jobs;
            }

            const maxJobsToProcess = Math.min(jobElements.length, maxJobs);
            for (let i = 0; i < maxJobsToProcess; i++) {
                try {
                    const jobData = await jobElements[i].evaluate((element) => {
                        const getText = (selector) =>
                            element.querySelector(selector)?.textContent.trim() || null;

                        const job_id = element.getAttribute("data-ev-job-uid") || null;

                        const titleEl = element.querySelector('.job-tile-title a, h2 a, h3 a');
                        const title = titleEl ? titleEl.textContent.trim() : "No title";
                        const url = titleEl ? titleEl.href : "No URL";

                        const description = getText(
                            '[data-test="JpCLineClamp JobDescription"] p, .air3-line-clamp p'
                        ) || "No description";

                        let budget = "Not specified";
                        let experienceLevel = "Not specified";
                        let posted = "Not specified";
                        const jobInfoItems = element.querySelectorAll(
                            '[data-test="JobInfo"] li, .job-tile-info-list li'
                        );

                        jobInfoItems.forEach((item) => {
                            const text = item.textContent.trim();
                            if (text.includes("Hourly") || text.includes("Fixed-price")) {
                                budget = text;
                            }
                            if (
                                text.includes("Entry") ||
                                text.includes("Intermediate") ||
                                text.includes("Expert")
                            ) {
                                experienceLevel = text;
                            }
                            if (text.includes("ago")) {
                                posted = text;
                            }
                        });

                        const skills = Array.from(
                            element.querySelectorAll(
                                '[data-test="token"] span, .air3-token span'
                            )
                        ).map((el) => el.textContent.trim());

                        const paymentVerified = getText(
                            '[data-test="payment-verification-badge"]'
                        )?.includes("Payment verified")
                            ? "Verified"
                            : "Unverified";

                        const rating = getText(".air3-rating-value-text")
                            ? `${getText(".air3-rating-value-text")} stars`
                            : "No rating";

                        const totalSpent = getText('[data-test="total-spent"] strong')
                            ? `${getText('[data-test="total-spent"] strong')} spent`
                            : "No spend";

                        const location = getText('[data-test="location"]') || "No location";
                        const clientInfo = `${paymentVerified} | ${rating} | ${totalSpent} | ${location}`;

                        return {
                            job_id,
                            title,
                            description,
                            budget,
                            experienceLevel,
                            posted,
                            skills,
                            clientInfo,
                            url,
                        };
                    });

                    if (jobData && jobData.title !== "No title") {
                        jobs.push({
                            id: jobs.length + 1,
                            ...jobData,
                            scrapedAt: new Date().toISOString(),
                        });
                        console.log(
                            `✅ Job ${jobs.length}: [${jobData.job_id
                            }] ${jobData.title.substring(0, 40)}...`
                        );
                    }

                    await this.delay(200, 500);
                } catch (error) {
                    console.log(`❌ Error processing job ${i + 1}:`, error.message);
                }
            }
        } catch (error) {
            console.error("❌ Scraping error:", error.message);
        }

        return jobs;
    }

    // NEW: after scrapeJobs() has collected the job list (with URLs), this
    // opens each job's URL in its own new tab, waits for it to load (and
    // clears Cloudflare if it appears), then closes that tab.
    //
    // This intentionally does NOT extract any detail-page data yet — it's
    // step 1: prove out the "open each url, then close" loop. Step 2 (later)
    // will be adding the actual scraping logic inside the try block, before
    // the tab gets closed.
    //
    // options:
    //   maxJobs     - how many of the jobs[] array to visit (default: all)
    //   delayRange  - [min, max] ms to sit on the page before closing it,
    //                 so it doesn't look like an instant bounce
    async visitJobDetailPages(jobs, options = {}) {
        const { maxJobs = jobs.length, delayRange = [2000, 4000] } = options;
        const jobsToVisit = jobs.slice(0, maxJobs);

        console.log(`\n🔗 Visiting ${jobsToVisit.length} job detail page(s)...`);
        const visitLog = [];

        for (let i = 0; i < jobsToVisit.length; i++) {
            const job = jobsToVisit[i];

            if (!job.url || job.url === "No URL") {
                console.log(
                    `⚠️ [${i + 1}/${jobsToVisit.length}] Skipping — no valid URL for "${job.title}"`
                );
                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: false,
                    error: "No URL",
                });
                continue;
            }

            console.log(`\n➡️ [${i + 1}/${jobsToVisit.length}] Opening: ${job.url}`);
            // Use the main page instead of creating a new one to keep anti-detect evasions intact
            let jobPage = this.page;

            try {
                await jobPage.goto(job.url, {
                    waitUntil: "networkidle0",
                    timeout: 60000,
                });

                await this.waitForCloudflareComplete(jobPage);
                await this.delay(...delayRange);

                const pageTitle = await jobPage.title();
                console.log(`✅ [${i + 1}/${jobsToVisit.length}] Reached: ${pageTitle}`);

                // Wait for the actual job content to render (SPA)
                try {
                    await jobPage.waitForSelector('h1, h2, [class*="job-details"], [class*="posting"]', { timeout: 10000 });
                } catch (_) {
                    console.log(`⚠️ Could not detect job content container, proceeding anyway...`);
                }



                console.log(`🔍 Extracting detailed job data...`);
                const jobData = await jobPage.evaluate(() => {
                    const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ') || null;
                    const bText = document.body.innerText || document.body.textContent || "";

                    // ──────────────────────────────────────────────────
                    // --- Connects ---
                    // ──────────────────────────────────────────────────
                    let connects = null;
                    const connectsMatch = bText.match(/Send a proposal for:\s*(\d+)\s*Connects/i) || bText.match(/(\d+)\s*Connects/i);
                    if (connectsMatch) connects = parseInt(connectsMatch[1], 10);

                    // ──────────────────────────────────────────────────
                    // --- Posted Since ---
                    // ──────────────────────────────────────────────────
                    let postedSince = null;
                    const postedEl = document.querySelector('.posted-on-line, [data-test="PostedOn"]');
                    if (postedEl) {
                        const pText = text(postedEl);
                        const pMatch = pText.match(/(\d+\s*(minute|hour|day|week|month)s?\s+ago)/i);
                        if (pMatch) postedSince = pMatch[1];
                        else postedSince = pText.replace(/^Posted\s*/i, '').trim();
                    } else {
                        const m = bText.match(/Posted\s+(.*?ago)/i);
                        if (m) postedSince = m[1].trim();
                    }

                    // ──────────────────────────────────────────────────
                    // --- Price + Type ---
                    // ──────────────────────────────────────────────────
                    let price = null;
                    let priceType = null;
                    const priceLi = document.querySelector('[data-cy="fixed-price"], [data-cy="hourly"]')?.closest('li');
                    if (priceLi) {
                        price = text(priceLi.querySelector('strong, [data-test="BudgetAmount"] strong'));
                        priceType = text(priceLi.querySelector('.description, small'));
                    } else {
                        const pMatch = bText.match(/\$[\d,.]+(?:\s*-\s*\$[\d,.]+)?/);
                        if (pMatch) price = pMatch[0];
                        if (bText.match(/Fixed[ -]?price/i)) priceType = "Fixed-price";
                        else if (bText.match(/Hourly/i)) priceType = "Hourly";
                    }

                    // ──────────────────────────────────────────────────
                    // --- Experience Level ---
                    // ──────────────────────────────────────────────────
                    let experienceLevel = null;
                    const expLi = document.querySelector('[data-cy="expertise"]')?.closest('li');
                    if (expLi) {
                        experienceLevel = text(expLi.querySelector('strong'));
                    } else {
                        const m = bText.match(/(Entry\s*level|Intermediate|Expert)/i);
                        if (m) experienceLevel = m[1];
                    }

                    // ──────────────────────────────────────────────────
                    // --- Client Location / Country ---
                    // ──────────────────────────────────────────────────
                    let country = null;
                    const countryStrong = document.querySelector('[data-qa="client-location"] strong');
                    if (countryStrong) {
                        country = text(countryStrong);
                    } else {
                        const countryEl = document.querySelector('[data-qa="client-location"]');
                        if (countryEl) country = text(countryEl);
                    }

                    // ──────────────────────────────────────────────────
                    // --- Jobs Posted & Hire Rate ---
                    // ──────────────────────────────────────────────────
                    let totalJobsPosted = null;
                    let hireRate = null;
                    const jobStatsLi = document.querySelector('[data-qa="client-job-posting-stats"]');
                    if (jobStatsLi) {
                        const strText = text(jobStatsLi.querySelector('strong'));
                        if (strText) {
                            const jm = strText.match(/(\d+)/);
                            if (jm) totalJobsPosted = parseInt(jm[1], 10);
                        }
                        const divText = text(jobStatsLi.querySelector('div'));
                        if (divText) {
                            const hm = divText.match(/(\d+)%/);
                            if (hm) hireRate = parseInt(hm[1], 10);
                        }
                    } else {
                        const jm = bText.match(/(\d+)\s*jobs?\s*posted/i);
                        if (jm) totalJobsPosted = parseInt(jm[1], 10);
                        const hm = bText.match(/(\d+)%\s*hire rate/i);
                        if (hm) hireRate = parseInt(hm[1], 10);
                    }

                    // ──────────────────────────────────────────────────
                    // --- Rating & Review Summary ---
                    // ──────────────────────────────────────────────────
                    let rating = null;
                    let reviewSummary = null;
                    const ratingBox = document.querySelector('[data-testid="buyer-rating"]');
                    if (ratingBox) {
                        const rEl = ratingBox.querySelector('.air3-rating-value-text');
                        rating = rEl ? text(rEl) : (ratingBox.textContent.match(/(\d+\.\d+)/)?.[0] || null);

                        const rsEl = ratingBox.querySelector('.nowrap');
                        reviewSummary = rsEl ? text(rsEl) : (ratingBox.textContent.match(/\d+(\.\d+)?\s+of\s+\d+\s+reviews?/i)?.[0] || null);
                    } else {
                        const rEl = document.querySelector('.air3-rating-value-text');
                        if (rEl) rating = text(rEl);

                        const rsMatch = bText.match(/\d+(\.\d+)?\s+of\s+\d+\s+reviews?/i);
                        if (rsMatch) reviewSummary = rsMatch[0];
                    }

                    // ──────────────────────────────────────────────────
                    // --- Member Since ---
                    // ──────────────────────────────────────────────────
                    let memberSince = null;
                    const memberSinceEl = document.querySelector('[data-qa="client-contract-date"] small');
                    if (memberSinceEl) {
                        const memberSinceText = text(memberSinceEl);
                        const memberSinceMatch = memberSinceText.match(/Member since\s+(.+)/i);
                        memberSince = memberSinceMatch ? memberSinceMatch[1].trim() : memberSinceText;
                    }

                    // ──────────────────────────────────────────────────
                    // --- Total Spent ---
                    // ──────────────────────────────────────────────────
                    let totalSpent = null;
                    const spendRaw = text(document.querySelector('[data-qa="client-spend"]'));
                    totalSpent = spendRaw?.match(/\$[\d,.]+[KkMm]?/)?.[0] || null;
                    if (!totalSpent) {
                        const spMatch = bText.match(/\$[\d,.]+[KkMm]?\s*(spent|\+)/i);
                        if (spMatch) totalSpent = spMatch[0].match(/\$[\d,.]+[KkMm]?/)?.[0] || null;
                    }

                    // ──────────────────────────────────────────────────
                    // --- Payment Method Status ---
                    // ──────────────────────────────────────────────────
                    let paymentMethodStatus = "Unverified";
                    if (document.querySelector('.payment-verified') || bText.match(/Payment method verified/i) || document.querySelector('[aria-label="More info about payment verification"]')) {
                        paymentMethodStatus = "Verified";
                    }

                    // ──────────────────────────────────────────────────
                    // --- Activity on this job ---
                    // ──────────────────────────────────────────────────
                    let proposals = null;
                    let lastViewedByClient = null;
                    let hires = null;
                    let interviewing = null;
                    let invitesSent = null;
                    let unansweredInvites = null;

                    const activityItems = document.querySelectorAll('ul.client-activity-items li.ca-item');
                    activityItems.forEach((item) => {
                        const title = item.querySelector('.title')?.textContent.trim().replace(/:$/, '').trim() || '';
                        const value = item.querySelector('.value')?.textContent.trim() || null;
                        const lc = title.toLowerCase();

                        if (lc.includes('proposal')) proposals = value;
                        else if (lc.includes('last viewed')) lastViewedByClient = value;
                        else if (lc.includes('hires')) hires = value ? parseInt(value, 10) : null;
                        else if (lc.includes('interviewing')) interviewing = value ? parseInt(value, 10) : null;
                        else if (lc.includes('invites sent')) invitesSent = value ? parseInt(value, 10) : null;
                        else if (lc.includes('unanswered')) unansweredInvites = value ? parseInt(value, 10) : null;
                    });

                    return {
                        connects, postedSince, price, priceType, experienceLevel,
                        country, memberSince, totalJobsPosted, hireRate, rating, reviewSummary, totalSpent,
                        paymentMethodStatus,
                        // Activity on this job
                        proposals, lastViewedByClient, hires, interviewing, invitesSent, unansweredInvites
                    };
                });

                // Merge new details into the existing job object
                Object.assign(job, jobData);
                console.log(`✅ Extracted data:`);
                console.log(jobData);

                // Load and retain only the first ten client-history records.
                job.clientHistory = await this.extractClientHistory(jobPage, 10);
                console.log(`Extracted ${job.clientHistory.length} client history record(s).`);

                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: true,
                    visitedAt: new Date().toISOString(),
                    details: { ...jobData, clientHistory: job.clientHistory }
                });
            } catch (error) {
                console.log(`❌ [${i + 1}/${jobsToVisit.length}] Failed: ${error.message}`);
                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: false,
                    error: error.message,
                });
            }
        }

        const successCount = visitLog.filter((v) => v.success).length;
        console.log(
            `\n🏁 Done. ${successCount}/${jobsToVisit.length} job pages visited successfully.`
        );

        // Persist results to disk so data is never lost between runs.
        await this.saveResults(jobs);

        return visitLog;
    }

    /**
     * Write the full jobs array (including clientHistory) to a timestamped
     * JSON file inside the project's `results/` directory.
     *
     * File name format: results/scrape_YYYY-MM-DD_HH-MM-SS.json
     */
    async saveResults(jobs) {
        try {
            const resultsDir = path.join(__dirname, "results");
            if (!fs.existsSync(resultsDir)) {
                fs.mkdirSync(resultsDir, { recursive: true });
            }

            const timestamp = new Date()
                .toISOString()
                .replace(/:/g, "-")
                .replace(/\..+/, ""); // e.g. 2026-07-25T02-28-21

            const filename = `scrape_${timestamp}.json`;
            const filepath = path.join(resultsDir, filename);

            fs.writeFileSync(filepath, JSON.stringify(jobs, null, 2), "utf8");
            console.log(`💾 Results saved → results/${filename}  (${jobs.length} job(s))`);
            return filepath;
        } catch (err) {
            console.warn("⚠️ Could not save results to disk:", err.message);
            return null;
        }
    }

    /**
     * Extract public feedback left by freelancers for this client.
     *
     * HTML structure (per item):
     *   div.item[data-cy="job"]
     *     div.main
     *       a[data-cy="job-title"]                          ← job title
     *       div.text-body-sm.mt-2x.mb-2x                   ← freelancer→client block
     *         span.rr-mask
     *           span  (star rating widget)
     *           span.air3-truncation.ml-1x                 ← ml-1x = freelancer→client comment
     *             span > span[id^="air3-truncation-"]       ← comment text
     *       div.text-body-sm                               ← client→freelancer block ("To freelancer:")
     *         span.air3-truncation   (NO ml-1x)            ← client→freelancer comment (excluded)
     *     div[data-cy="date"]
     *       div.text-body-sm                               ← e.g. "Jul 2026 - Jul 2026"
     *     div[data-cy="stats"]
     *       span  (payment type + amount)
     *         span                                         ← amount, e.g. "$200.00"
     *
     * View-more button:
     *   footer[data-v-3f329c02] span a.up-n-link           ← "View more (N)"
     */
    async extractClientHistory(page, maxResults = 10) {
        // Selector for each history row
        const jobSelector = 'div.item[data-cy="job"]';

        try {
            await page.waitForSelector(jobSelector, { timeout: 10000 });
        } catch (_) {
            // This job has no visible client history section.
            return [];
        }

        // Click "View more" until we have enough rows or no button remains.
        for (let attempt = 0; attempt < 9; attempt++) {
            const currentCount = await page.$$eval(jobSelector, (cards) => cards.length);
            if (currentCount >= maxResults) break;

            const clicked = await page.evaluate(() => {
                // Selector: footer a.up-n-link whose text matches "view more"
                const viewMore = Array.from(document.querySelectorAll('footer a.up-n-link'))
                    .find((link) => /view more/i.test(link.textContent || ""));

                if (!viewMore) return false;
                viewMore.scrollIntoView({ block: "center" });
                viewMore.click();
                return true;
            });

            if (!clicked) break;

            try {
                await page.waitForFunction(
                    (selector, oldCount) => document.querySelectorAll(selector).length > oldCount,
                    { timeout: 8000 },
                    jobSelector,
                    currentCount
                );
            } catch (_) {
                break;
            }
        }

        return page.$$eval(jobSelector, (jobCards, limit) => {
            const cleanText = (el) =>
                (el?.textContent || "").replace(/\s+/g, " ").trim();

            return jobCards.slice(0, limit).map((job) => {
                // ── Job title ────────────────────────────────────────────────────
                const title = cleanText(job.querySelector('a[data-cy="job-title"]'));

                // ── Freelancer → Client comment ───────────────────────────────────
                // The span with class "air3-truncation ml-1x" (note: ml-1x) lives
                // inside the first .text-body-sm.mt-2x.mb-2x block and holds the
                // freelancer's review of the client.  The client's review of the
                // freelancer uses just "air3-truncation" (no ml-1x) and is skipped.
                const freelancerToClientComment = cleanText(
                    job.querySelector(
                        '.main > .text-body-sm.mt-2x.mb-2x ' +
                        'span.air3-truncation.ml-1x ' +
                        'span[id^="air3-truncation-"]'
                    )
                );

                // ── Date range ───────────────────────────────────────────────────
                // e.g. "Jul 2026 - Jul 2026"
                const dateRange = cleanText(
                    job.querySelector('div[data-cy="date"] > .text-body-sm')
                );

                // ── Payment type & amount ─────────────────────────────────────────
                // div[data-cy="stats"] > span  →  "Fixed-price" text node + <span>$200.00</span>
                const statsBlock = job.querySelector('div[data-cy="stats"]');
                const statsText = cleanText(statsBlock);
                const statsSpan = statsBlock?.querySelector(':scope > span');

                // Payment type: text node directly inside the outer span
                const paymentType =
                    (statsSpan?.childNodes[0]?.textContent || "").trim() ||
                    (statsText.match(/Fixed-price|Hourly/i) || [""])[0];

                // Amount: the nested <span> inside the outer span, e.g. "$200.00"
                const amount =
                    cleanText(statsSpan?.querySelector('span')) ||
                    (statsText.match(/\$[\d,.]+/) || [""])[0];

                return { title, freelancerToClientComment, dateRange, paymentType, amount };
            });
        }, maxResults);
    }
    // ── Deduplication helpers ─────────────────────────────────────────────────

    /**
     * Load the previously saved list of job IDs from disk.
     * Returns an array of up to 10 job ID strings, or [] if the file
     * does not exist yet (first run).
     */
    loadSeenJobIds() {
        try {
            if (fs.existsSync(this.seenJobIdsFile)) {
                const raw = fs.readFileSync(this.seenJobIdsFile, "utf8");
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    console.log(`📂 Loaded ${parsed.length} previously seen job ID(s).`);
                    return parsed;
                }
            }
        } catch (err) {
            console.warn("⚠️ Could not read seen_job_ids.json:", err.message);
        }
        return [];
    }

    /**
     * Persist the latest list of job IDs (capped at 10) to disk so they
     * can be compared on the next scheduled run.
     *
     * @param {string[]} jobIds - The full list of job IDs from the most recent scrape.
     */
    saveSeenJobIds(jobIds) {
        try {
            const toSave = jobIds.slice(0, 10);
            fs.writeFileSync(this.seenJobIdsFile, JSON.stringify(toSave, null, 2), "utf8");
            console.log(`💾 Saved ${toSave.length} job ID(s) to seen_job_ids.json`);
        } catch (err) {
            console.warn("⚠️ Could not write seen_job_ids.json:", err.message);
        }
    }

    async close() {
        try {
            if (this.browser) {
                await this.browser.close();
                console.log("🔒 Browser closed");
            }
        } catch (error) {
            console.log("⚠️ Error closing browser:", error.message);
        }
    }
}

module.exports = WorkingUpworkScraper_NoCookie;