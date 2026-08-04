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

        await page.goto("https://www.upwork.com/nx/find-work/", {
            waitUntil: "networkidle2",
            timeout: 60000,
        });

        const isLogged = async () => {
            const url = page.url();
            return url.includes("/find-work");
        };

        if (await isLogged()) {
            console.log("✅ Already logged in.");
        } else {
            console.log("⚠️ Not logged in.");
            console.log("👉 Please complete login and 2FA manually in the browser.");
            console.log("👉 Press ENTER here once you are successfully logged in and on the dashboard.");

            await pauseUntilEnter();
            
            if (await isLogged()) {
                console.log("✅ Login confirmed.");
            } else {
                console.log("❌ Login not detected. Please check the browser.");
            }
        }

        console.log("💾 Keeping session open for 30 seconds to ensure profile sync...");
        await new Promise(resolve => setTimeout(resolve, 30000));

    } catch (err) {
        console.error("Error during session:", err);
    } finally {
        await browser.close();
        console.log("🔒 Browser closed. Profile data should be saved.");
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