// File: server.js
const express = require("express");
const WorkingUpworkScraper_NoCookie = require("./scraper");

const app = express();
// Use express's JSON parser and increase the payload limit to accommodate large cookie objects
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

// ── Singleton browser instance ──────────────────────────────────────────────
// The browser is launched ONCE when the server starts and reused for every
// /scrape request. This preserves the logged-in Chrome session across requests
// because the same Chrome process (and its DBSC keys) stays alive.
let scraperInstance = null;
let initPromise = null;

async function getOrInitScraper() {
    // If already initialised and browser still open, reuse it
    if (scraperInstance && scraperInstance.browser) {
        try {
            // Quick liveness check — throws if the browser crashed/disconnected
            await scraperInstance.browser.version();
            return scraperInstance;
        } catch (_) {
            console.warn("⚠️ Existing browser session died — reinitialising...");
            scraperInstance = null;
            initPromise = null;
        }
    }

    // Avoid concurrent init races
    if (!initPromise) {
        initPromise = (async () => {
            const s = new WorkingUpworkScraper_NoCookie();
            const ok = await s.init();
            if (!ok) throw new Error("Failed to initialise the scraping browser.");
            scraperInstance = s;
            console.log("✅ Singleton browser ready.");
            return s;
        })();
    }

    return initPromise;
}

// Gracefully shut down the browser when the process exits
process.on("SIGINT", () => { scraperInstance?.close().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { scraperInstance?.close().finally(() => process.exit(0)); });

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.status(200).json({ message: "Upwork Scraper API is running." });
});

// ── /scrape endpoint ──────────────────────────────────────────────────────────
app.post("/scrape", async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: "Upwork search URL is required." });
    }

    console.log(`Received scrape request for URL: ${url}`);

    try {
        // Reuse (or lazily init) the singleton browser
        const scraper = await getOrInitScraper();

        // Navigate to the user-provided search URL
        const navSuccess = await scraper.navigateToUpwork(url);
        if (!navSuccess) {
            throw new Error(`Failed to navigate to the specified URL: ${url}`);
        }

        // Scrape the job listings from the page
        const jobs = await scraper.scrapeJobs(10);
        console.log(`🎉 List scraping successful. Found ${jobs.length} jobs.`);

        // Visit each job's detail page and enrich the data
        const detailedJobs = await scraper.visitJobDetailPages(jobs);

        res.status(200).json({ jobs, detailedJobs });

    } catch (error) {
        console.error("❌ SCRAPING FAILED:", error.message);

        // If the error looks like a browser crash, reset so next request reinitialises
        if (
            error.message.includes("Session closed") ||
            error.message.includes("Target closed") ||
            error.message.includes("Protocol error")
        ) {
            console.warn("🔄 Resetting browser singleton due to crash...");
            await scraperInstance?.close().catch(() => { });
            scraperInstance = null;
            initPromise = null;
        }

        res.status(500).json({
            error: "An internal server error occurred during the scraping process.",
            details: error.message,
        });
    }
    // NOTE: Browser is intentionally NOT closed here — it stays alive for the next request
});

app.listen(PORT, async () => {
    console.log(`🚀 Upwork Scraper API listening on http://localhost:${PORT}`);
    // Pre-warm the browser so the first /scrape request doesn't have to wait
    try {
        await getOrInitScraper();
    } catch (err) {
        console.error("❌ Browser pre-warm failed:", err.message);
    }
});