// File: scraper.js

const path = require("path");
const fs   = require("fs");
const { connect } = require("puppeteer-real-browser");

const COOKIES_FILE = path.join(__dirname, "cookies.json");

class WorkingUpworkScraper_NoCookie {
    constructor() {
        this.browser      = null;
        this.page         = null;
        // Use a dedicated persistent profile in the project directory
        this.profileDir   = path.join(__dirname, "scraper_profile");
    }

    async init(cookieData = null) {
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
                fingerprint: true,
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
            this.page    = page;
            console.log("✅ Stealth browser launched.");

            // ── Step 2: Navigate to Upwork so the domain is established ───────
            // Cookies can only be set for the domain the browser is already on.
            console.log("🌐 Pre-navigating to Upwork to set domain context...");
            await this.page.goto("https://www.upwork.com", {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });
            await this.waitForCloudflareComplete(this.page);

            // ── Step 3: Inject cookies (from caller or from cookies.json) ─────
            let finalCookies = (cookieData && cookieData.length > 0) ? cookieData : null;

            if (!finalCookies && fs.existsSync(COOKIES_FILE)) {
                console.log("🍪 Found cookies.json — loading saved session...");
                try {
                    finalCookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
                    console.log(`   Loaded ${finalCookies.length} cookies.`);
                } catch (e) {
                    console.warn("⚠️ Failed to parse cookies.json:", e.message);
                }
            }

            if (finalCookies && finalCookies.length > 0) {
                console.log("🔍 Injecting session cookies...");
                await this.page.setCookie(...finalCookies);
                console.log("✅ Cookies injected.");
            } else {
                console.log("⚠️ No cookies available — will proceed as a guest.");
            }

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
            // Navigate to the actual target URL (cookies are already set from init)
            await this.page.goto(targetUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });
            await this.waitForCloudflareComplete(this.page);
            await this.delay(2000, 4000);
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
                console.warn("⚠️  Not authenticated. Session may have expired — re-run test-profile.js to refresh cookies.");
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
        const selectors = [
            'article[data-test="JobTile"]',
            ".job-tile",
            ".air3-card.job-tile",
        ];

        for (const selector of selectors) {
            try {
                await this.page.waitForSelector(selector, { timeout: 10000 });
                const elements = await this.page.$$(selector);
                if (elements.length > 0) {
                    console.log(`✅ Found ${elements.length} elements with: ${selector}`);
                    return { elements, selector };
                }
            } catch (error) {
                console.log(`❌ Selector failed: ${selector}`);
            }
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

                    return {
                        connects, postedSince, price, priceType, experienceLevel,
                        country, totalJobsPosted, hireRate, rating, reviewSummary, totalSpent,
                        paymentMethodStatus
                    };
                });

                // Merge new details into the existing job object
                Object.assign(job, jobData);
                console.log(`✅ Extracted data:`);
                console.log(jobData);

                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: true,
                    visitedAt: new Date().toISOString(),
                    details: jobData
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

        return visitLog;
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