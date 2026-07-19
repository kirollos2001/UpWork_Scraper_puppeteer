const { connect } = require("puppeteer-real-browser");
const readline = require("readline");
const fs = require("fs");

const COOKIES_FILE = "cookies.json";

(async () => {
    console.log("🚀 Initializing stealth browser...");

    const { browser, page } = await connect({
        headless: false,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--start-maximized"
        ],
        turnstile: true,
        fingerprint: true,
        customConfig: {
            userDataDir: "C:\\Users\\kirollos\\puppeteer_upwork_profile",
            chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        },
        connectOption: {
            defaultViewport: null,
        }
    });

    try {
        // ── Step 1: Go to Upwork FIRST (so the domain is set) ──────────────────
        console.log("🌐 Navigating to Upwork...");
        await page.goto("https://www.upwork.com", {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        // ── Step 2: If we have saved cookies, inject them NOW ──────────────────
        if (fs.existsSync(COOKIES_FILE)) {
            console.log("🍪 Found cookies.json — injecting saved session...");
            const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));
            await page.setCookie(...cookies);
            console.log(`✅ Injected ${cookies.length} cookies.`);

            // Reload so Upwork sees the injected session
            console.log("🔄 Reloading page to apply session...");
            await page.goto("https://www.upwork.com/nx/find-work/", {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            // Quick check — are we logged in?
            const title = await page.title();
            console.log(`📄 Page title: ${title}`);

            if (title.toLowerCase().includes("find work") || title.toLowerCase().includes("dashboard")) {
                console.log("✅ Logged in successfully! Session is working.");
                console.log("\nPress [ENTER] to close the browser.");
                await pauseUntilEnter();
            } else {
                console.log("⚠️  Session might have expired. Please log in manually.");
                console.log("\n========================================================");
                console.log("👉 Log in manually, then press [ENTER] to re-save cookies.");
                console.log("========================================================\n");
                await pauseUntilEnter();
                await saveCookies(page);
            }
        } else {
            // ── First-time setup: no cookies yet ──────────────────────────────
            console.log("ℹ️  No cookies.json found — first-time setup.");
            console.log("\n========================================================");
            console.log("👉 Log in to Upwork manually in the browser window.");
            console.log("👉 Once your dashboard loads, come back here and");
            console.log("👉 press [ENTER] to save your session cookies.");
            console.log("========================================================\n");
            await pauseUntilEnter();
            await saveCookies(page);
        }

    } catch (error) {
        console.error("❌ Something went wrong:", error);
    } finally {
        await browser.close();
        console.log("🔒 Browser closed.");
    }
})();

async function saveCookies(page) {
    const cookies = await page.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`✅ Session cookies saved to ${COOKIES_FILE} (${cookies.length} cookies).`);
}

function pauseUntilEnter() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question("", () => { rl.close(); resolve(); }));
}