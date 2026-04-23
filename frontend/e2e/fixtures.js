import { test as base, expect, request } from "@playwright/test";

const TEST_SECRET = process.env.PLAYWRIGHT_TEST_SECRET || "";

if (!TEST_SECRET) {
  console.warn(
    "[e2e] PLAYWRIGHT_TEST_SECRET is not set — tests that rely on the auth bypass will fail.",
  );
}

function makeTestEmail() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-${ts}-${rand}@mealrunner-test.invalid`;
}

async function loginAs(page, email) {
  const resp = await page.request.post("/api/auth/e2e-login", {
    data: { email, secret: TEST_SECRET },
  });
  if (!resp.ok()) {
    throw new Error(
      `e2e-login failed (${resp.status()}): ${await resp.text()}`,
    );
  }
  return await resp.json();
}

async function deleteAllTestUsers(baseURL) {
  const ctx = await request.newContext({ baseURL });
  try {
    const resp = await ctx.post("/api/admin/e2e-cleanup", {
      data: { secret: TEST_SECRET },
    });
    if (!resp.ok()) {
      console.warn(`[e2e] cleanup returned ${resp.status()}`);
    }
  } finally {
    await ctx.dispose();
  }
}

export const test = base.extend({
  testEmail: async ({}, use) => {
    await use(makeTestEmail());
  },
  authedPage: async ({ page, testEmail }, use) => {
    await loginAs(page, testEmail);
    await use(page);
  },
});

export { expect, deleteAllTestUsers };
