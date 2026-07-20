// Simple end-to-end test for import → annotation → export flow
// Requires the dev server to be running at http://localhost:3000
// Run with: node tests/e2e.test.js

import assert from "node:assert";

const fetchFn = globalThis.fetch ?? (await import("node-fetch")).default;

(async () => {
  try {
    // 1. Import a YouTube video (use a known short video ID)
    const videoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    let res = await fetchFn("http://localhost:3000/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
    });
    assert.strictEqual(res.ok, true, "Video import failed");
    const video = await res.json();
    console.log("Imported video ID", video.id);

    // 2. Wait for transcript generation (poll until hasTranscript)
    let attempts = 0;
    let hasTranscript = false;
    while (attempts < 20 && !hasTranscript) {
      await new Promise((r) => setTimeout(r, 3000));
      const vRes = await fetchFn(`http://localhost:3000/api/videos/${video.id}`);
      const vData = await vRes.json();
      hasTranscript = vData.hasTranscript;
      attempts++;
    }
    assert.ok(hasTranscript, "Transcript was not generated in time");

    // 3. Add an annotation
    const annotation = {
      timestamp: 30,
      title: "Test annotation",
      detail: "Testing end-to-end flow",
      tags: ["e2e"],
    };
    res = await fetchFn(`http://localhost:3000/api/videos/${video.id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotation),
    });
    assert.strictEqual(res.ok, true, "Create annotation failed");
    const created = await res.json();
    console.log("Created annotation ID", created.id);

    // 4. Export as chapters
    res = await fetchFn(`http://localhost:3000/api/videos/${video.id}/export?format=chapters`);
    assert.strictEqual(res.ok, true, "Export failed");
    const exportData = await res.text();
    console.log("Export output (first 200 chars):", exportData.slice(0, 200));

    // 5. Cleanup
    await fetchFn(`http://localhost:3000/api/videos/${video.id}`, { method: "DELETE" });
    console.log("Cleanup completed");
  } catch (err) {
    console.error("E2E test failed:", err);
    process.exit(1);
  }
})();
