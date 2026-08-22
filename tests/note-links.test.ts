import assert from "node:assert";
import { tokenizeNoteLinks } from "../lib/youtube";

function main() {
  // plain text untouched
  assert.deepStrictEqual(tokenizeNoteLinks("no links here"), [
    { kind: "text", value: "no links here" },
  ]);
  console.log("plain text: ok");

  // bare https url
  assert.deepStrictEqual(tokenizeNoteLinks("see https://example.com/a?b=1 now"), [
    { kind: "text", value: "see " },
    { kind: "link", href: "https://example.com/a?b=1", display: "https://example.com/a?b=1" },
    { kind: "text", value: " now" },
  ]);
  console.log("bare url: ok");

  // www url gets https scheme
  assert.deepStrictEqual(tokenizeNoteLinks("www.example.com"), [
    { kind: "link", href: "https://www.example.com", display: "www.example.com" },
  ]);
  console.log("www prefix: ok");

  // trailing punctuation not part of the link
  assert.deepStrictEqual(tokenizeNoteLinks("(check https://example.com.)"), [
    { kind: "text", value: "(check " },
    { kind: "link", href: "https://example.com", display: "https://example.com" },
    { kind: "text", value: ".)" },
  ]);
  console.log("trailing punctuation trimmed: ok");

  // balanced parens kept
  assert.deepStrictEqual(tokenizeNoteLinks("https://en.wikipedia.org/wiki/Foo_(bar)"), [
    {
      kind: "link",
      href: "https://en.wikipedia.org/wiki/Foo_(bar)",
      display: "https://en.wikipedia.org/wiki/Foo_(bar)",
    },
  ]);
  console.log("balanced parens kept: ok");

  // [label](url) markdown-style link
  assert.deepStrictEqual(tokenizeNoteLinks("docs at [the guide](https://x.dev/readme) pls"), [
    { kind: "text", value: "docs at " },
    { kind: "link", href: "https://x.dev/readme", display: "the guide" },
    { kind: "text", value: " pls" },
  ]);
  console.log("labeled link: ok");

  // labeled link with www url also normalized
  assert.deepStrictEqual(tokenizeNoteLinks("[home](www.x.dev)"), [
    { kind: "link", href: "https://www.x.dev", display: "home" },
  ]);
  console.log("labeled www normalized: ok");

  // javascript: scheme never becomes a link
  assert.deepStrictEqual(tokenizeNoteLinks("[click](javascript:alert(1))"), [
    { kind: "text", value: "[click](javascript:alert(1))" },
  ]);
  assert.deepStrictEqual(tokenizeNoteLinks("javascript:alert(1)"), [
    { kind: "text", value: "javascript:alert(1)" },
  ]);
  console.log("javascript: rejected: ok");

  // multiple links + text preserved in order
  const multi = tokenizeNoteLinks("a https://a.io b [t](http://b.co) c");
  assert.strictEqual(multi.length, 5);
  assert.deepStrictEqual(multi[1], { kind: "link", href: "https://a.io", display: "https://a.io" });
  assert.deepStrictEqual(multi[3], { kind: "link", href: "http://b.co", display: "t" });
  console.log("mixed order: ok");

  // query strings with & survive as text tokens (caller sanitizes)
  assert.deepStrictEqual(tokenizeNoteLinks("https://y.com/?a=1&b=2"), [
    { kind: "link", href: "https://y.com/?a=1&b=2", display: "https://y.com/?a=1&b=2" },
  ]);
  console.log("query string: ok");

  console.log("ALL PASS");
}

main();
