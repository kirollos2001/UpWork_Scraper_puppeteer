// File: WorkingUpworkScraper_NoCookie.js

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
                headless: false,
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
            await this.waitForCloudflareComplete();
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

    async waitForCloudflareComplete() {
        console.log("🔍 Waiting for Cloudflare to complete...");
        let attempts = 0;
        const maxAttempts = 20;
        while (attempts < maxAttempts) {
            attempts++;
            const title = await this.page.title();
            const url = this.page.url();
            console.log(`Attempt ${attempts}/${maxAttempts} - ${title}`);

            const lowerTitle = title.toLowerCase();

            // Added checks for "moment" and "attention" to capture Cloudflare splash screens
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

                        // NEW: Get Job ID from article attribute
                        const job_id = element.getAttribute("data-ev-job-uid") || null;

                        // Title and URL
                        const titleEl = element.querySelector('.job-tile-title a, h2 a, h3 a');
                        const title = titleEl ? titleEl.textContent.trim() : "No title";
                        const url = titleEl ? titleEl.href : "No URL";

                        // Full Description
                        const description = getText(
                            '[data-test="JpCLineClamp JobDescription"] p, .air3-line-clamp p'
                        ) || "No description";

                        // Budget, Experience, and Posted Time
                        let budget = "Not specified";
                        let experienceLevel = "Not specified";
                        let posted = "Not specified"; // Inferred based on return object
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

                        // Skills
                        const skills = Array.from(
                            element.querySelectorAll(
                                '[data-test="token"] span, .air3-token span'
                            )
                        ).map((el) => el.textContent.trim());

                        // Client Info
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

                    // Add valid jobs to the array
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