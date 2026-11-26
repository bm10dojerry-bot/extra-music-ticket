"use strict";

const originalFetch = globalThis.fetch;
globalThis.fetch = function fetchLocalOnly(input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]" && url.hostname !== "localhost") {
    throw Error("External fetch disabled in AI Sale test");
  }
  return originalFetch(input, init);
};
