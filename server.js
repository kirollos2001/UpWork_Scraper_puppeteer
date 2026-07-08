// File: server.js
const fs = require("fs");

const express = require("express");
const WorkingUpworkScraper_NoCookie = require("./scraper");

const app = express();
// Use express's JSON parser and increase the payload limit to accommodate large cookie objects
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

// API Health Check Endpoint
app.get("/", (req, res) => {
    res.status(200).json({ message: "Upwork Scraper API is running." });
});

// Define the main /scrape endpoint
app.post("/scrape", async (req, res) => {
    const { url, cookies } = req.body;

    // Validate that a URL was provided
    if (!url) {
        return res.status(400).json({ error: "Upwork search URL is required." });
    }

    console.log(`Received scrape request for URL: ${url}`);

    // Choose scraper based on whether cookies are provided
    const scraper = new WorkingUpworkScraper_NoCookie();

    try {
        // Step 1: Initialize the browser, passing cookies if they exist
        const initSuccess = await scraper.init(cookies);
        if (!initSuccess) {
            throw new Error("Failed to initialize the scraping browser.");
        }

        // Step 2: Navigate to the user-provided URL
        const navSuccess = await scraper.navigateToUpwork(url);
        if (!navSuccess) {
            throw new Error(`Failed to navigate to the specified URL: ${url}`);
        }

        // Step 3: Scrape the job listings from the page
        const jobs = await scraper.scrapeJobs(10); // You could make maxJobs an optional request param

        // Step 4: Send the results back to the client
        console.log(`🎉 Scraping successful. Found ${jobs.length} jobs.`);
        res.status(200).json(jobs);

    } catch (error) {
        console.error("❌ SCRAPING FAILED:", error.message);
        res.status(500).json({
            error: "An internal server error occurred during the scraping process.",
            details: error.message,
        });
    } finally {
        // Step 5: CRITICAL - Always ensure the browser is closed to prevent resource leaks
        await scraper.close();
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Upwork Scraper API listening on http://localhost:${PORT}`);
});