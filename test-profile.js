const { connect } = require("puppeteer-real-browser");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

(async () => {
    console.log("🚀 Initializing browser...");

    const profileDir = path.join(__dirname, "scraper_profile");

    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }

    const { browser, page } = await connect({
        headless: false,
        args: [
            "--start-maximized",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu"
        ],
        turnstile: true,
        fingerprint: false,
        customConfig: {
            chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            userDataDir: profileDir,
        },
        connectOption: {
            defaultViewport: null,
        }
    });

    try {
        console.log("📂 Using profile:", profileDir);

        // افتح صفحة Find Work مباشرة
        await page.goto("https://www.upwork.com/nx/find-work/", {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        // انتظر ثانيتين
        await new Promise(resolve => setTimeout(resolve, 2000));

        const currentUrl = page.url();

        if (currentUrl.includes("/find-work")) {
            console.log("✅ Already logged in.");
        } else {
            console.log("⚠️ Not logged in.");
            console.log("👉 Please login manually.");
            console.log("👉 After login press ENTER to close.");

            await pauseUntilEnter();
        }

        console.log("💾 Waiting 10 seconds to let Chrome save the profile...");
        await new Promise(resolve => setTimeout(resolve, 60000));

    } catch (err) {
        console.error(err);
    } finally {
        await browser.close();
        console.log("🔒 Browser closed.");
    }

})();

function pauseUntilEnter() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question("", () => {
            rl.close();
            resolve();
        });
    });
}