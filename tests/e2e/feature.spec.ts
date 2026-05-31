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

test("an expired (old-slot) stamp is rejected and never propagates to the host", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    // A is the host; B is an attendee trying to cheat with a stale stamp.
    await a.getByPlaceholder("your name").fill("alice");
    await a.getByRole("checkbox").check();
    await b.getByPlaceholder("your name").fill("mallory");

    // A stamp from a slot well in the past — beyond the ±1 rotation tolerance.
    const staleSlot = (await b.evaluate(() => Math.floor(Date.now() / 1000 / 30))) - 5;

    await b.getByText("paste a stamp payload").click();
    await b
      .getByPlaceholder("paste mesh://room/STAMP#slot payload")
      .fill(`mesh://${encodeURIComponent("e2e-stamp")}/STAMP#${staleSlot}`);
    await b.getByRole("button", { name: "claim", exact: true }).click();

    // The attendee sees an expiry error and earns no stamp...
    await expect(b.locator(".mesh-qrx-error")).toContainText("expired");
    await expect(b.locator(".as-stamps li")).toHaveCount(0);

    // ...and crucially the host (the OPPOSITE peer) never sees mallory:
    // the stale write was rejected before it ever touched the shared Yjs log,
    // so the host's attendee list stays empty ("none yet", count 0 total).
    await b.waitForTimeout(300);
    await expect(a.getByText(/0 stamps total/)).toBeVisible();
    await expect(a.locator(".as-attendees li")).toHaveCount(0);
    await expect(a.getByText("none yet")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("a second attendee's valid claim also reaches the opposite peer", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    // Neither peer is the host here — both are attendees who claim the same
    // rotating stamp. Proves the shared log is symmetric, not host-only.
    await a.getByPlaceholder("your name").fill("carol");
    await b.getByPlaceholder("your name").fill("dave");

    const slot = await a.evaluate(() => Math.floor(Date.now() / 1000 / 30));
    const payload = `mesh://${encodeURIComponent("e2e-stamp")}/STAMP#${slot}`;

    await a.getByText("paste a stamp payload").click();
    await a.getByPlaceholder("paste mesh://room/STAMP#slot payload").fill(payload);
    await a.getByRole("button", { name: "claim", exact: true }).click();

    // A's claim must surface on B (the opposite peer).
    await expect(b.locator(".as-attendees")).toContainText("carol");

    // Now B claims the same slot; A must see dave too.
    await b.getByText("paste a stamp payload").click();
    await b.getByPlaceholder("paste mesh://room/STAMP#slot payload").fill(payload);
    await b.getByRole("button", { name: "claim", exact: true }).click();

    await expect(a.locator(".as-attendees")).toContainText("dave");
    await expect(a.getByText(/2 stamps total/)).toBeVisible();
  } finally {
    await cleanup();
  }
});
