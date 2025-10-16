# Vite SSR Plugin

A powerful Vite plugin that enables Server-Side Rendering (SSR) with optional API servers. Built with Vite's new [Environment API](https://vite.dev/guide/api-environment.html) for optimal performance and developer experience.


## Quick Start

1. Install the plugin:
   ```bash
   npm install @havelaer/vite-plugin-ssr
   ```

2. Configure your `vite.config.ts`:
   ```ts
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

3. Create your entry files and start developing:
   ```bash
   npm run dev
   ```

## Features

- 🚀 **Built with Vite's Environment API** - Leverages the latest Vite features for optimal performance
- ⚡ **Hot Module Replacement** - Full HMR support for both client and server code
- 🔧 **Flexible API Configuration** - Support for multiple API endpoints with custom routing
- 🎯 **TypeScript Support** - Full TypeScript support with comprehensive type definitions
- 📦 **Zero Configuration** - Works out of the box with sensible defaults
- 🔄 **Direct API Calls** - Call APIs directly from SSR context without HTTP roundtrips

## Installation

```bash
npm install @havelaer/vite-plugin-ssr
```

## Configuration

Configure the plugin in your Vite config by providing the client entry, SSR entry, and optionally one or more API entries.

The keys in the `apis` object are the names of the APIs. These keys are also used as base paths for API requests. For example, `/api/*` requests will be sent to the `api` API.

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

## Client Entry

Set up your client entry point. This is where your client-side JavaScript will be initialized.

Example client entry with a fetch call to the API:

```ts
// src/entry-client.ts
console.log("Hello from client");

fetch("/api").then((res) => res.json()).then((data) => {
  console.log(data.message); // "Hello from the API"
});
```

## API Entry

Optionally, set up your API entry points. Each API entry should export a default function that handles HTTP requests.

Always use the following function signature. We're using the [Fetch API Web standards](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API):

```ts
export default (request: Request) => Promise<Response>;
```

Example API entry:

```ts
// src/entry-api.ts
export default async (request: Request): Promise<Response> => {
  return new Response(JSON.stringify({
    message: "Hello from the API",
  }), {
    headers: {
      "Content-Type": "application/json",
    },
  });
};
```

## SSR Entry

Set up your SSR entry point. This serves the HTML based on the request and handles server-side rendering.

The function signature is the same as the API entry, but with an additional context object:

```ts
type HtmlAssets = {
  js: string;
  css: string[];
};
type Context<TApis extends string = never> = {
  assets: HtmlAssets;
  apis: { [P in TApis]: APIHandler };
};

export default (request: Request, ctx: Context) => Promise<Response>;
```

The context object contains the assets and the API handlers. This means you can call APIs from the SSR context directly without HTTP roundtrips:

Example calling the API from the SSR context:

```ts
// src/entry-ssr.ts
import type { Context } from "@havelaer/vite-plugin-ssr";

export default async (request: Request, ctx: Context<"api">): Promise<Response> => {
  // Create an API Request
  const apiRequest = new Request(/* ... */);

  // Call the API Handler from the SSR Handler directly without doing a HTTP roundtrip
  const apiResponse = await ctx.apis.api(apiRequest).then(r => r.json());
  
  return new Response(/* rendered html */, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};
```

The context object also contains the client entry and CSS assets. In development mode, `ctx.assets.js` points to the client entry source (e.g., "src/entry-client.ts") processed and served by Vite. 

In production, `ctx.assets.js` points to the client entry bundle (e.g., "dist/client/entry-client-[hash].js").

Simple SSR entry example:

```ts
// src/entry-ssr.ts
export default async (request: Request, ctx: Context): Promise<Response> => {
  return new Response(`
    <html>
      <head>
        ${ctx.assets.css.map(css => `<link rel="stylesheet" href="${css}" />`).join('\n')}
      </head>
      <body>
        <p>Hello from server</p>
        <script src="${ctx.assets.js}" type="module"></script>
      </body>
    </html>
  `, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};
```

## Production Setup

### 1. Update package.json

First, update your `package.json` to build all environments by adding the `--app` flag to the `vite build` script. Also add a `serve` script to run the server.

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build --app",
    "serve": "node server.js"
  }
}
```

### 2. Create a Production Server

Set up a server. You can use any server and any runtime. For this example, we're using [Hono](https://hono.dev) with the Node.js runtime.

```js
// server.js
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { api, ssr, ssrContext } from "./dist/index.js";

const app = new Hono();

// Serve static assets from the client build
app.use(serveStatic({ root: "./dist/client" }));

// Handle API routes
app.use("/api/*", (c) => api(c.req.raw));

// Handle SSR for all other routes
app.use((c) => ssr(c.req.raw, ssrContext));

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
```

### 3. Build and Run

Build for production:

```bash
npm run build
```

Run the server:

```bash
npm run serve
```

## Advanced Configuration

### Custom API Routes

You can customize API routes by providing a configuration object instead of just a string:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [ssr({
    client: "src/entry-client.ts",
    ssr: "src/entry-ssr.ts",
    apis: {
      api: {
        entry: "src/entry-api.ts",
        route: "/custom-api" // Custom route instead of /api
      },
    },
  })],
});
```

### Environment Customization

You can customize the build environment for each entry:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [ssr({
    client: {
      entry: "src/entry-client.ts",
      environment: (env) => ({
        ...env,
        build: {
          ...env.build,
          rollupOptions: {
            ...env.build?.rollupOptions,
            external: ["some-external-dependency"]
          }
        }
      })
    },
    ssr: "src/entry-ssr.ts",
    apis: {
      api: "src/entry-api.ts",
    },
  })],
});
```

## Examples

This repository includes working examples in the `examples/` directory:

- **Basic Example** (`examples/basic/`) - A minimal setup with client, SSR, and API entries
- **React Example** (`examples/react/`) - A React application with SSR support

To run an example:

```bash
cd examples/basic
npm install
npm run dev
```

## License

MIT