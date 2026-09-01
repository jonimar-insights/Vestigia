import assert from "node:assert";
import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div id="player">
        <iframe src="https://www.youtube.com/embed/test"></iframe>
      </div>
      <script>
        function applyYouTubeIframePermissions(container) {
          const iframe = container?.querySelector?.('iframe');
          if (!iframe) return;
          iframe.setAttribute(
            'allow',
            'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen'
          );
          iframe.setAttribute('allowfullscreen', '');
          iframe.setAttribute('referrerPolicy', 'strict-origin-when-cross-origin');
        }
        applyYouTubeIframePermissions(document.getElementById('player'));
      </script>
    `);

    const iframe = page.locator('iframe');
    await iframe.waitFor({ state: 'attached' });

    const allow = await iframe.getAttribute('allow');
    const allowFullScreen = await iframe.getAttribute('allowfullscreen');
    const referrerPolicy = await iframe.getAttribute('referrerPolicy');

    assert.ok(allow && allow.includes('gyroscope'), `missing gyroscope permission: ${allow}`);
    assert.ok(allow && allow.includes('fullscreen'), `missing fullscreen permission: ${allow}`);
    assert.strictEqual(allowFullScreen, '', 'missing allowfullscreen attribute');
    assert.ok(
      referrerPolicy && referrerPolicy.includes('strict-origin-when-cross-origin'),
      `missing referrerPolicy: ${referrerPolicy}`
    );

    console.log('YT 360 iframe permissions OK');
  } finally {
    await browser.close();
  }
})();
