# Vite SSR

SSR for Vite. And optional API servers. Build with Vite's new [Environment API](https://vite.dev/guide/api-environment.html).

## Getting Started

Install the SSR Vite plugin.

```bash
npm install @havelaer/vite-plugin-ssr
```

Configure the plugin in your Vite config by providing the client entry, the SSR entry, and optionally one or more API entries.

The keys in the `apis` object are the names of the APIs. The keys are also used as base path for the API requests. Eg. `/api*` requests will be sent to the `api` API.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import ssr from "@havelaer/vite-plugin-ssr";

export default defineConfig({
  plugins: [ssr({
    client: "src/entry-client.ts",
    ssr: "src/entry-ssr.ts",
    apis: {
      api: "src/entry-api.ts",
    },
  })],
});
```

Setup your client entry.

```ts
// src/entry-client.ts
console.log("Hello from client");

fetch("/api").then((res) => res.json()).then((data) => {
  console.log(data.message); // "Hello from the API"
});
```

Setup your SSR entry. This serves the HTML based on the request.

```ts
// src/entry-ssr.ts
import ctx from "@havelaer/vite-plugin-ssr/context";

export default async function fetch(request: Request): Promise<Response> {
  return new Response(`
    <h1>Hello from server</h1>
    <script src="${ctx().client.src}" type="module"></script>
  `, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}
```

Optionally, setup your API entry.

```ts
// src/entry-api.ts
export default async function fetch(request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    message: "Hello from the API",
  }), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
```

## Production

First update your package.json to build all environments by adding the `--app` flag to the `vite build` script.
Also add a `serve` script to run the server. 

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build --app",
    "serve": "node server.js"
  }
}
```

Setup a server. You can use any server and any runtime. For this example we're using [Hono](https://hono.dev) with the Node.js runtime.

```js
// server.js
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
```

Build for production.

```bash
npm run build
```

Run the server.

```bash
npm run serve
```

## License

MIT