import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("attendee claims current host stamp via paste-form", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await a.getByRole("checkbox").check();

    await b.getByPlaceholder("your name").fill("bob");

    // Read current slot from B via the page time (simpler: read window evaluator)
    const slot = await b.evaluate(() => Math.floor(Date.now() / 1000 / 30));

    await b.getByText("paste a stamp payload").click();
    await b
      .getByPlaceholder("paste mesh://room/STAMP#slot payload")
      .fill(`mesh://${encodeURIComponent("e2e-stamp")}/STAMP#${slot}`);
    // The room id used by openTwoPeers is randomized, but our app doesn't
    // validate it — it just checks the STAMP marker and slot.
    await b.getByRole("button", { name: "claim", exact: true }).click();

    await expect(b.locator(".as-stamps li").first()).toContainText(`slot #${slot}`);
    await expect(a.locator(".as-attendees")).toContainText("bob");
  } finally {
    await cleanup();
  }
});
