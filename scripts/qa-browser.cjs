const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
const { version } = require("../package.json");
const out = path.resolve(`artifacts/qa-${version}`);
fs.mkdirSync(out, { recursive: true });
async function main() {
  const server = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "1420",
      "--strictPort",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let browser;
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch("http://127.0.0.1:1420/")).ok) break;
      } catch {}
      if (attempt === 49)
        throw new Error("Local production preview did not start.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({
      executablePath: process.env.NEXUS_BROWSER_PATH || undefined,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const checks = [];
    const check = (name, passed, detail) => {
      checks.push({ name, passed, detail });
      if (!passed) console.error("FAIL", name, detail);
    };
    const shot = async (name) => {
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: false,
      });
    };
    await page.goto("http://127.0.0.1:1420/?preview", {
      waitUntil: "networkidle",
    });
    const toolbar = page.getByRole("group", {
      name: "Library controls",
      exact: true,
    });
    await toolbar.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot("library-desktop");
    const settingsButton = toolbar.getByRole("button", {
      name: "Settings",
      exact: true,
    });
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    const checkSourceSpacing = async (size) => {
      await settings.locator(".discovery-note").scrollIntoViewIfNeeded();
      const spacing = await settings.evaluate((dialog) => {
        const note = dialog
          .querySelector(".discovery-note")
          .getBoundingClientRect();
        const folders = dialog.querySelector(".folder-sources");
        const heading = folders
          .querySelector(".accounts-heading")
          .getBoundingClientRect();
        const gap = folders.getBoundingClientRect().top - note.bottom;
        return {
          gap,
          headingBelowNotice: heading.top >= note.bottom,
          horizontalOverflow: dialog.scrollWidth > dialog.clientWidth,
        };
      });
      check(
        size + " source sections have clear spacing",
        spacing.gap >= 24 &&
          spacing.headingBelowNotice &&
          !spacing.horizontalOverflow,
        spacing,
      );
      await shot("sources-spacing-" + size);
      await settings.evaluate((dialog) => {
        dialog.scrollTop = 0;
      });
    };
    check(
      "One Library opens with featured art and the game grid",
      (await page.getByRole("region", { name: "Featured game" }).isVisible()) &&
        (await page
          .getByRole("region", { name: "Game collection" })
          .isVisible()),
    );
    check(
      "Collection has one toolbar and a Settings button",
      (await page.getByRole("complementary").count()) === 0 &&
        (await settingsButton.count()) === 1 &&
        (await page.locator("header").count()) === 0 &&
        (await page
          .getByRole("heading", { name: "Library", exact: true })
          .count()) === 0 &&
        (await page
          .locator("main")
          .evaluate((n) => n.getBoundingClientRect().left < 40)),
    );
    const theme = await page.evaluate(() => {
      const rules = [...document.styleSheets].flatMap((sheet) => [
        ...sheet.cssRules,
      ]);
      const gradients = rules.filter((rule) =>
        /gradient\(/i.test(rule.cssText),
      );
      const surfaces = [
        ".library-toolbar",
        ".settings-button",
        ".hero-shade",
        ".hero .button.primary",
      ];
      const colors = surfaces.map(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).backgroundColor,
      );
      return {
        gradients: gradients.length,
        neutral: colors.every((color) => {
          const [r, g, b] = color.match(/[\d.]+/g).map(Number);
          return r === g && g === b;
        }),
      };
    });
    check(
      "Flat gray interface without gradients",
      theme.gradients === 0 && theme.neutral,
      theme,
    );
    const hero = await page.locator(".hero").evaluate((n) => {
      const s = getComputedStyle(n);
      return {
        border: s.borderWidth,
        radius: s.borderRadius,
        shadow: s.boxShadow,
        outline: s.outlineStyle,
      };
    });
    check(
      "Borderless square hero",
      hero.border === "0px" &&
        hero.radius === "0px" &&
        hero.shadow === "none" &&
        hero.outline === "none",
      hero,
    );
    check(
      "Toolbar has an icon-only Add game button",
      (await toolbar
        .getByRole("button", { name: "Add game", exact: true })
        .textContent()) === "" &&
        (await toolbar
          .getByRole("button", {
            name: /^(Activity|Quick find|Search library)$/,
          })
          .count()) === 0,
    );
    check(
      "Search starts at the collection edge and fills the space beside the controls",
      await toolbar.evaluate((n) => {
        const bounds = n.getBoundingClientRect();
        const search = n.querySelector(".search-box").getBoundingClientRect();
        const sync = n.querySelector(".sync-button").getBoundingClientRect();
        const add = n.querySelector(".add-game-button").getBoundingClientRect();
        const settings = n
          .querySelector(".settings-button")
          .getBoundingClientRect();
        const center = (rect) => rect.top + rect.height / 2;
        return (
          Math.abs(search.left - bounds.left) < 1 &&
          search.width > bounds.width * 0.45 &&
          search.right < sync.left &&
          Math.abs(center(search) - center(add)) < 1 &&
          Math.abs(center(search) - center(settings)) < 1
        );
      }),
    );
    check(
      "Recently played is removed from Library and navigation",
      (await page
        .getByRole("button", { name: "Recently played", exact: true })
        .count()) === 0 &&
        (await page
          .getByRole("region", { name: "Recently played", exact: true })
          .count()) === 0,
    );
    await toolbar
      .getByRole("button", { name: "Add game", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Add a game" }).waitFor();
    await shot("add-game");
    check(
      "Toolbar plus opens the working game form",
      await page
        .getByRole("textbox", { name: "Game name", exact: true })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    await page.locator(".game-card").first().waitFor();
    check(
      "The cover grid is the default for a new profile",
      await page.locator(".game-grid").isVisible(),
    );
    const initialCount = await page.locator(".game-card").count();
    const name = await page.locator(".game-title").first().innerText();
    await page
      .locator(".game-card .cover-button")
      .first()
      .click()
      .catch(
        async () =>
          await page
            .getByRole("button", { name: `View ${name}`, exact: true })
            .first()
            .click(),
      );
    await page.getByRole("dialog").waitFor();
    await shot("details-desktop");
    await page.keyboard.press("Escape");
    const filters = page.getByRole("button", { name: "Filter library" });
    await filters.click();
    const drawer = page.getByRole("complementary", { name: "Filters" });
    check(
      "Desktop filters dock beside the collection and focus the first option",
      await drawer.evaluate((n) => {
        const collection = n
          .closest(".library-body")
          .querySelector(".collection");
        return (
          getComputedStyle(n).position === "sticky" &&
          collection.getBoundingClientRect().right <
            n.getBoundingClientRect().left &&
          n.querySelector('input[type="checkbox"]') === document.activeElement
        );
      }),
    );
    await shot("filters-desktop");
    const platformDisclosure = drawer
      .locator("summary")
      .filter({ hasText: "Platform" });
    const gog = drawer.getByRole("radio", { name: "GOG", exact: true });
    await platformDisclosure.click();
    check("Platform choices collapse", !(await gog.isVisible()));
    await platformDisclosure.click();
    await gog.check();
    await drawer.getByRole("radio", { name: "Installed", exact: true }).check();
    await drawer.getByRole("checkbox", { name: "Favorites only" }).check();
    const titleFilter = toolbar.getByRole("searchbox", {
      name: "Search games",
    });
    await page.keyboard.press("Control+k");
    await page.waitForFunction(
      () =>
        document.querySelector(".library-toolbar input") ===
        document.activeElement,
    );
    check(
      "Ctrl+K focuses toolbar search with filters open",
      await titleFilter.evaluate((n) => n === document.activeElement),
    );
    await titleFilter.fill("Baldur");
    check(
      "Title, platform, availability, and favorites filter the same Library",
      (await page.locator(".game-card").count()) === 1 &&
        (await page
          .getByRole("button", { name: "View Baldur’s Gate 3", exact: true })
          .isVisible()),
    );
    await shot("filters-active");
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    check(
      "Reset clears the title and restores the default filter rows",
      (await titleFilter.inputValue()) === "" &&
        (await drawer
          .getByRole("radio", { name: "All games", exact: true })
          .isChecked()) &&
        (await drawer
          .getByRole("radio", { name: "All platforms", exact: true })
          .isChecked()) &&
        !(await drawer
          .getByRole("checkbox", { name: "Favorites only" })
          .isChecked()),
    );
    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "hidden" });
    check(
      "Closing filters restores focus to their button",
      await filters.evaluate((n) => n === document.activeElement),
    );
    await page.getByRole("searchbox", { name: "Search games" }).fill("Hades");
    check(
      "Instant search filters cards",
      (await page.locator(".game-card").count()) > 0 &&
        (await page.locator(".game-card").count()) < initialCount,
    );
    await shot("search-desktop");
    await page
      .getByRole("searchbox", { name: "Search games" })
      .fill("no-such-game-nexus-qa");
    check(
      "Empty search is explicit",
      (await page.locator(".game-card").count()) === 0 &&
        (await page.getByText("No games found.", { exact: true }).count()) > 0,
    );
    await settingsButton.click();
    await settings.waitFor();
    check(
      "Settings opens over the existing collection and toolbar",
      (await page.locator("main .library-toolbar").count()) === 1 &&
        (await page.locator('main [aria-label="Game collection"]').count()) ===
          1,
    );
    await settings
      .getByRole("tab", { name: "Game sources", exact: true })
      .click();
    check(
      "Game sources is inside Settings",
      (await settings.isVisible()) &&
        (await settings
          .getByRole("tab", { name: "Game sources", exact: true })
          .getAttribute("aria-selected")) === "true" &&
        (await page
          .getByRole("button", { name: "Game sources", exact: true })
          .count()) === 0,
    );
    check(
      "No account, key, login, or import setup controls",
      (await page
        .getByRole("button", {
          name: /^(Connect|Reconnect|Sign in|Import library)/i,
        })
        .count()) === 0 &&
        (await page.locator('input[type="password"]').count()) === 0,
    );
    await shot("sources-desktop");
    await checkSourceSpacing("desktop");
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    check(
      "Settings contains no manual library import",
      (await page.getByRole("button", { name: /^Import/i }).count()) === 0,
    );
    await shot("settings-desktop");
    await settings.getByRole("button", { name: "Restore preview" }).click();
    check(
      "Settings feedback is visible inside the dialog",
      await settings.getByText("Sample library restored.").evaluate((n) => {
        const message = n.getBoundingClientRect();
        const dialog = n.closest("dialog").getBoundingClientRect();
        return message.top >= dialog.top && message.bottom <= dialog.bottom;
      }),
    );
    await settings.getByRole("button", { name: "Dismiss message" }).click();
    await settings.getByRole("button", { name: "About Nexus" }).click();
    await page.getByRole("dialog", { name: "About Nexus" }).waitFor();
    await page.keyboard.press("Escape");
    check("Closing About returns to Settings", await settings.isVisible());
    await page.setViewportSize({ width: 900, height: 720 });
    await shot("settings-compact");
    await settings.getByRole("button", { name: "Close dialog" }).click();
    await settings.waitFor({ state: "hidden" });
    check(
      "Closing Settings preserves the library search and restores focus",
      (await page
        .getByRole("searchbox", { name: "Search games" })
        .inputValue()) === "no-such-game-nexus-qa" &&
        (await settingsButton.evaluate((n) => n === document.activeElement)),
    );
    await page.getByRole("searchbox", { name: "Search games" }).fill("");
    await shot("library-compact");
    check(
      "Compact library has no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.setViewportSize({ width: 760, height: 560 });
    await shot("library-minimum");
    check(
      "Minimum window library has no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    check(
      "Minimum window keeps every control in the same bar",
      await toolbar
        .locator(
          ".search-box, .sync-button, .sort-select, .view-switch, .filter-button, .add-game-button, .settings-button",
        )
        .evaluateAll((nodes) => {
          const bounds = nodes.map((n) => n.getBoundingClientRect());
          const middle = bounds[0].top + bounds[0].height / 2;
          return bounds.every(
            (rect) =>
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              Math.abs(rect.top + rect.height / 2 - middle) < 1,
          );
        }),
    );
    await filters.click();
    await drawer.evaluate((n) =>
      Promise.all(n.getAnimations().map((animation) => animation.finished)),
    );
    check(
      "Minimum window filters fit as a right-edge overlay",
      await drawer.evaluate((n) => {
        const r = n.getBoundingClientRect();
        return (
          getComputedStyle(n).position === "fixed" &&
          r.left >= 0 &&
          Math.abs(r.right - document.documentElement.clientWidth) < 1
        );
      }),
    );
    await shot("filters-minimum");
    await drawer.getByRole("radio", { name: "GOG", exact: true }).check();
    check(
      "Compact filters can scroll to the last platform and reset",
      await drawer
        .getByRole("button", { name: "Reset filters" })
        .evaluate((n) => {
          const rect = n.getBoundingClientRect();
          const toolbar = document
            .querySelector(".library-toolbar")
            .getBoundingClientRect();
          return (
            !n.disabled &&
            rect.top >= toolbar.bottom &&
            rect.bottom <= innerHeight
          );
        }),
    );
    await drawer.getByRole("button", { name: "Reset filters" }).click();
    await page.locator(".filter-scrim").click({ position: { x: 30, y: 100 } });
    check(
      "Clicking outside the compact panel closes it",
      !(await drawer.isVisible()),
    );
    await page.locator(".cover-button").first().click();
    await page.getByRole("dialog").waitFor();
    await shot("details-minimum");
    check(
      "Minimum window dialog fits horizontally",
      await page.getByRole("dialog").evaluate((n) => {
        const r = n.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
    );
    await page.keyboard.press("Escape");
    await settingsButton.click();
    await settings
      .getByRole("tab", { name: "Game sources", exact: true })
      .click();
    await shot("sources-minimum");
    for (const [role, label] of [
      ["tab", "Game sources"],
      ["button", "Close dialog"],
    ]) {
      check(
        `Minimum window ${label} stays visible`,
        await settings
          .getByRole(role, { name: label, exact: true })
          .evaluate((n) => {
            const r = n.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight;
          }),
      );
    }
    await checkSourceSpacing("minimum");
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    await shot("settings-minimum");
    check(
      "Minimum window settings have no horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await settings.evaluate((n) => {
      n.scrollTop = n.scrollHeight;
    });
    check(
      "Settings close button stays visible when scrolled",
      await settings
        .getByRole("button", { name: "Close dialog" })
        .evaluate((n) => {
          const r = n.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }),
    );
    await page.keyboard.press("Escape");
    // An isolated localStorage fixture; no native library or user data is modified.
    await page.evaluate(() => {
      const games = Array.from({ length: 10000 }, (_, i) => ({
        id: `qa-${i}`,
        appId: String(i + 1000),
        name: `QA Game ${String(i).padStart(5, "0")}`,
        platform: i % 2 ? "Epic Games" : "Steam",
        installed: i % 3 === 0,
        favorite: false,
        cover: "/art/hades.jpg",
        hero: "/art/hades-hero.jpg",
      }));
      localStorage.setItem("nexus.preview.library", JSON.stringify(games));
      localStorage.setItem(
        "nexus.preferences",
        JSON.stringify({ groupCopies: true }),
      );
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".game-card").first().waitFor();
    await filters.click();
    const platformOptions = await drawer
      .locator('fieldset[aria-label="Platform"] label')
      .allTextContents();
    check(
      "Only populated platforms appear in filters",
      platformOptions.join("|") === "All platforms|Steam|Epic Games",
      platformOptions,
    );
    await page.keyboard.press("Escape");
    const ranges = [];
    for (const fraction of [0, 0.5, 1]) {
      await page.evaluate(
        (f) =>
          scrollTo(
            0,
            (document.documentElement.scrollHeight - innerHeight) * f,
          ),
        fraction,
      );
      await page.waitForTimeout(250);
      ranges.push(
        await page.evaluate(() => ({
          scrollY,
          height: document.documentElement.scrollHeight,
          count: document.querySelectorAll(".game-card").length,
          titles: [...document.querySelectorAll(".game-title")].map(
            (n) => n.textContent,
          ),
          bottom: document.querySelector(".game-grid")?.getBoundingClientRect()
            .bottom,
        })),
      );
      await shot("large-library-" + fraction);
    }
    check(
      "10,000-game DOM stays bounded",
      ranges.every((r) => r.count > 0 && r.count < 70),
      ranges.map((r) => ({ count: r.count, scrollY: r.scrollY })),
    );
    check(
      "Final game is reachable by scrolling",
      ranges[2].titles.includes("QA Game 09999"),
      ranges[2],
    );
    await page.keyboard.press("Control+k");
    await page
      .getByRole("searchbox", { name: "Search games" })
      .fill("QA Game 09999");
    await page.waitForTimeout(150);
    check(
      "Search after deep scrolling renders result",
      (await page.locator(".game-card").count()) === 1,
      await page.locator(".game-title").allTextContents(),
    );
    await page.getByRole("searchbox", { name: "Search games" }).fill("");
    await page.getByRole("button", { name: "List view" }).click();
    await page.waitForTimeout(200);
    check(
      "List view stays bounded",
      (await page.locator(".game-card").count()) < 70,
    );
    await shot("large-library-list");
    await context.setOffline(true);
    await page
      .getByRole("searchbox", { name: "Search games" })
      .fill("QA Game 00012");
    check(
      "Cached library search works offline",
      (await page.locator(".game-card").count()) === 1,
    );
    check("No browser runtime exceptions", errors.length === 0, errors);
    fs.writeFileSync(
      path.join(out, "results.json"),
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          scope:
            "Isolated headless Chrome preview; native integrations not simulated. Demo and 10,000-game synthetic library.",
          checks,
          errors,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(checks, null, 2));
    if (checks.some((c) => !c.passed)) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
