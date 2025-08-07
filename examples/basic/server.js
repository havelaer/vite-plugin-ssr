import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import apiFetch from "./dist/api/entry-api.js";
import ssrFetch from "./dist/ssr/entry-ssr.js";

const app = new Hono();

app.use(serveStatic({ root: "./dist/client" }));

app.use("/api/*", (c) => apiFetch(c.req.raw));

app.use((c) => ssrFetch(c.req.raw));

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});