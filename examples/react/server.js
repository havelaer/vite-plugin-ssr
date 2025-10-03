import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { api, ssr, ssrContext } from "./dist/index.js";

const app = new Hono();

app.use(serveStatic({ root: "./dist/client" }));

app.use("/api/*", (c) => api(c.req.raw));

app.use((c) => ssr(c.req.raw, ssrContext));

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
