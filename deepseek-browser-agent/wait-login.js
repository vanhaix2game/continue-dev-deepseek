// wait-login.js — open DeepSeek in real Chrome (persistent session) and
// poll until the user has logged in. No ENTER needed — just log in in the
// opened window; this script senses it and exits.
'use strict';

const { chromium } = require('playwright');
const path         = require('path');
const config       = require('./src/config');

const SESSION_DIR  = config.SESSION_DIR;
const URL          = config.DEEPSEEK_URL;
const POLL_MS      = 3_000;
const MAX_MS       = 15 * 60 * 1000;

async function isLoggedIn(page) {
  return !(await page.evaluate(() => {
    const url = window.location.href;
    const bodyText = document.body?.innerText || '';
    return (
      url.includes('/auth') ||
      url.includes('/login') ||
      url.includes('/sign') ||
      bodyText.includes('Sign in') ||
      bodyText.includes('Log in') ||
      !!document.querySelector('input[type="password"]')
    );
  }));
}

(async () => {
  console.log(`[wait-login] launching real Chrome on session: ${SESSION_DIR}`);
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(URL);
  console.log('[wait-login] navigated. Waiting for you to log in (up to 15 min)...');

  const t0 = Date.now();
  let loggedIn = await isLoggedIn(page);
  while (!loggedIn) {
    if (Date.now() - t0 > MAX_MS) {
      console.log('[wait-login] TIMEOUT: not logged in after 15 min.');
      await context.close();
      process.exit(1);
    }
    await page.waitForTimeout(POLL_MS);
    loggedIn = await isLoggedIn(page);
  }

  console.log('[wait-login] LOGIN_OK — session saved. Exiting.');
  await context.close();
  process.exit(0);
})().catch(e => {
  console.error('[wait-login] ERROR:', e.message);
  process.exit(2);
});