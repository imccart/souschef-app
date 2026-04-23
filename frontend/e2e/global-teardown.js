import { deleteAllTestUsers } from "./fixtures.js";

export default async function globalTeardown(config) {
  const baseURL =
    config.projects[0]?.use?.baseURL ||
    process.env.PLAYWRIGHT_BASE_URL ||
    "https://staging.getmealrunner.app";
  try {
    await deleteAllTestUsers(baseURL);
  } catch (e) {
    console.warn("[e2e] global teardown failed:", e.message);
  }
}
