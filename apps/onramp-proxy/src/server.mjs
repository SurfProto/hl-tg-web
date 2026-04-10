import { createServer } from "node:http";

import { createProxyHandler } from "./proxy.mjs";

const port = Number(process.env.PORT ?? "8080");
const host = process.env.HOST ?? "0.0.0.0";
const handler = createProxyHandler();

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = `http://${incoming.headers.host ?? `${host}:${port}`}${incoming.url ?? "/"}`;
    const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming;
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers,
      body,
      duplex: "half",
    });
    const response = await handler(request);

    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const responseBody = await response.arrayBuffer();
    outgoing.end(Buffer.from(responseBody));
  } catch (error) {
    console.error(error);
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ success: false, code: "INTERNAL_ERROR", error: "Unexpected proxy error" }));
  }
});

server.listen(port, host, () => {
  console.log(`onramp proxy listening on ${host}:${port}`);
});
