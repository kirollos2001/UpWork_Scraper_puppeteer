// File: scraper.js

const { connect } = require("puppeteer-real-browser");
const fs = require("fs");

class WorkingUpworkScraper_NoCookie {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    async init(cookieData = null) {
        console.log("🚀 Initializing browser...");
        try {
            const { browser, page } = await connect({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ],
                fingerprint: true,
                turnstile: true,
                connectOption: {
                    defaultViewport: null,
                },
            });

            this.browser = browser;
            this.page = page;

            if (cookieData && Array.isArray(cookieData) && cookieData.length > 0) {
                console.log("🔍 Attempting to load provided cookies...");
                try {
                    await this.page.setCookie(...cookieData);
                    console.log("✅ Cookies loaded successfully.");
                } catch (error) {
                    console.error("❌ Failed to load or set cookies:", error.message);
                }
            }

            await this.page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            );

            console.log("✅ Browser initialized");
            return true;
        } catch (error) {
            console.error("❌ Failed to initialize browser:", error.message);
            return false;
        }
    }

    async navigateToUpwork(targetUrl) {
        console.log(`🌐 Navigating to ${targetUrl}...`);
        try {
            await this.page.goto(targetUrl, {
                waitUntil: "networkidle0",
                timeout: 60000,
            });
            await this.waitForCloudflareComplete(this.page);
            await this.delay(3000, 5000);
            console.log("✅ Successfully reached the target page");
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
            let jobPage = null;

            try {
                // New tab in the SAME browser/context, so the Cloudflare
                // clearance + cookies from init() carry over automatically.
                jobPage = await this.browser.newPage();

                await jobPage.goto(job.url, {
                    waitUntil: "networkidle0",
                    timeout: 60000,
                });

                await this.waitForCloudflareComplete(jobPage);
                await this.delay(...delayRange);

                const pageTitle = await jobPage.title();
                console.log(`✅ [${i + 1}/${jobsToVisit.length}] Reached: ${pageTitle}`);

                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: true,
                    visitedAt: new Date().toISOString(),
                });
            } catch (error) {
                console.log(`❌ [${i + 1}/${jobsToVisit.length}] Failed: ${error.message}`);
                visitLog.push({
                    job_id: job.job_id,
                    url: job.url,
                    success: false,
                    error: error.message,
                });
            } finally {
                if (jobPage) {
                    await jobPage.close();
                    console.log(`🔒 [${i + 1}/${jobsToVisit.length}] Tab closed`);
                }
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