import fs from "node:fs/promises";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import * as cheerio from "cheerio";
import type { RollupOutput } from "rollup";
import {
  createServerModuleRunner,
  type EnvironmentOptions,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer,
} from "vite";

interface BaseEnvConfig {
  entry: string;
  environment?: (env: EnvironmentOptions) => EnvironmentOptions;
}

interface ClientConfig extends BaseEnvConfig {}

interface SSRConfig extends BaseEnvConfig {}

interface APIConfig extends BaseEnvConfig {
  route: string;
}

type Options = {
  client: string | ClientConfig;
  ssr: string | SSRConfig;
  apis?: Record<string, string | APIConfig>;
};

type ResolvedOptions = {
  client: ClientConfig;
  ssr: SSRConfig;
  apis: Record<string, APIConfig>;
};

export type APIHandler = (request: Request) => Promise<Response>;

export type HtmlAssets = {
  js: string;
  css: string[];
};

export type Context<TApis extends string = never> = {
  assets: HtmlAssets;
  apis: { [P in TApis]: APIHandler };
};

export type SSRHandler = <TApis extends string = never>(
  request: Request,
  ctx: Context<TApis>,
) => Promise<Response>;

function resolveOptions(options: Options): ResolvedOptions {
  return {
    client: typeof options.client === "string" ? { entry: options.client } : options.client,
    ssr: typeof options.ssr === "string" ? { entry: options.ssr } : options.ssr,
    apis: options.apis
      ? Object.entries(options.apis).reduce(
          (apis, [api, config]) => {
            const entry = typeof config === "string" ? config : config.entry;
            const route = typeof config !== "string" && config.route ? config.route : `/${api}`;
            apis[api] = { entry, route };
            return apis;
          },
          {} as Record<string, APIConfig>,
        )
      : {},
  };
}

function getEnvironment(
  config: string | BaseEnvConfig,
  environment: EnvironmentOptions,
): EnvironmentOptions {
  if (typeof config === "string") {
    return environment;
  }
  return config.environment?.(environment) ?? environment;
}

type InjectedScript = { content?: string; src?: string };

function extractHtmlScripts(html: string): InjectedScript[] {
  const $ = cheerio.load(html);
  const scripts: InjectedScript[] = [];

  $("script").each((_, element) => {
    const src = $(element).attr("src");
    const content = $(element).html() ?? undefined;
    scripts.push({
      src,
      content,
    });
  });

  return scripts;
}

export default function ssrPlugin(options: Options): Plugin {
  const resolvedOptions = resolveOptions(options);
  const apiEntries = Object.entries(resolvedOptions.apis);
  let injectedScripts: InjectedScript[];
  let viteServer: ViteDevServer | undefined;
  let outDirRoot = "dist";
  let resolvedConfig: ResolvedConfig;

  return {
    name: "havelaer-vite-ssr",
    sharedDuringBuild: true,
    config(config) {
      outDirRoot = config.build?.outDir ?? "dist";
      return {
        environments: {
          client: getEnvironment(resolvedOptions.client, {
            build: {
              outDir: `${outDirRoot}/client`,
              emitAssets: true,
              copyPublicDir: true,
              emptyOutDir: false,
              rollupOptions: {
                input: normalizePath(path.resolve(resolvedOptions.client.entry)),
                output: {
                  entryFileNames: "[name]-[hash].js",
                  chunkFileNames: "assets/[name]-[hash].js",
                  assetFileNames: "assets/[name]-[hash][extname]",
                },
              },
            },
          }),
          ssr: getEnvironment(resolvedOptions.ssr, {
            build: {
              outDir: `${outDirRoot}/ssr`,
              copyPublicDir: false,
              emptyOutDir: false,
              ssrEmitAssets: false,
              rollupOptions: {
                input: normalizePath(path.resolve(resolvedOptions.ssr.entry)),
                output: {
                  entryFileNames: "[name].js",
                  chunkFileNames: "assets/[name].js",
                  assetFileNames: "assets/[name]-[hash][extname]", // same as client
                },
              },
            },
          }),
          ...apiEntries.reduce(
            (apiEnvironments, [api, config]) => {
              apiEnvironments[api] = getEnvironment(config, {
                build: {
                  rollupOptions: {
                    input: normalizePath(path.resolve(config.entry)),
                    output: {
                      entryFileNames: "[name].js",
                    },
                  },
                  outDir: `${outDirRoot}/${api}`,
                  emptyOutDir: false,
                  copyPublicDir: false,
                },
              });
              return apiEnvironments;
            },
            {} as Record<string, EnvironmentOptions>,
          ),
        },
        builder: {
          async buildApp(builder) {
            await fs.rm(path.resolve(builder.config.root, outDirRoot), {
              recursive: true,
              force: true,
            });

            const outputs = (await Promise.all([
              builder.build(builder.environments.client),
              builder.build(builder.environments.ssr),
              ...apiEntries.map(([api]) => builder.build(builder.environments[api])),
            ])) as [RollupOutput, RollupOutput, ...RollupOutput[]];

            await fs.writeFile(
              path.resolve(builder.config.root, outDirRoot, "index.js"),
              createIndexContent(outputs, apiEntries),
            );
          },
        },
        appType: "custom",
      };
    },
    configResolved(config) {
      resolvedConfig = config;
    },
    async configureServer(server) {
      viteServer = server;
      const ssrRunner = createServerModuleRunner(server.environments.ssr);

      // Extract the scripts that Vite plugins would inject into the initial HTML
      const templateHtml = `<html><head></head><body></body></html>`;
      const transformedHtml = await server.transformIndexHtml("/", templateHtml);
      injectedScripts = extractHtmlScripts(transformedHtml);

      const apiModules: Record<string, () => Promise<APIHandler>> = {};

      apiEntries.forEach(([api, config]) => {
        const moduleRunner = createServerModuleRunner(server.environments[api]);
        apiModules[api] = () => moduleRunner.import(config.entry).then((m) => m.default);

        server.middlewares.use(async (req, res, next) => {
          if (req.url?.startsWith(config.route)) {
            const apiFetch = await apiModules[api]();

            await getRequestListener(apiFetch)(req, res);
            return;
          }
          next();
        });
      });

      return async () => {
        server.middlewares.use(async (req, res, next) => {
          if (res.writableEnded) {
            return next();
          }

          try {
            const imports = await Promise.all(apiEntries.map(([api]) => apiModules[api]()));
            const ssrContext: Context<string> = {
              assets: {
                js: "/@client-entry",
                css: [],
              },
              apis: apiEntries.reduce(
                (apis, [api], index) => {
                  apis[api] = imports[index];
                  return apis;
                },
                {} as Record<string, APIHandler>,
              ),
            };

            const ssrFetch = await ssrRunner
              .import(resolvedOptions.ssr.entry)
              .then((m) => m.default);
            await getRequestListener((request) => ssrFetch(request, ssrContext))(req, res);
          } catch (e: any) {
            viteServer?.ssrFixStacktrace(e);
            console.info(e.stack);
            res.statusCode = 500;
            res.end(e.stack);
          }
        });
      };
    },
    resolveId(id) {
      if (id === "/@client-entry") {
        return "\0virtual:@client-entry";
      }
      return null;
    },
    load(id) {
      if (id === "\0virtual:@client-entry") {
        // Wrap the injected scripts and the configured client entry in a virtual entry module
        const content = injectedScripts
          .map((script) => script.content || `import "${script.src}";`)
          .join("\n");
        return `${content}\nawait import("${resolvedConfig.base}${resolvedOptions.client.entry}");`;
      }
      return null;
    },
    hotUpdate(ctx) {
      // Auto refresh client if ssr is updated
      if (this.environment.name === "ssr" && ctx.modules.length > 0) {
        ctx.server.environments.client.hot.send({
          type: "full-reload",
        });
      }
    },
  };
}

type AppOutput = [RollupOutput, RollupOutput, ...RollupOutput[]];

function createIndexContent(outputs: AppOutput, apiEntries: [string, APIConfig][]): string {
  const [client, ssr, ...apis] = outputs;
  const content: string[] = [];

  // Import the SSR function
  content.push(`import ssr from './ssr/${ssr.output[0].fileName}';`);

  // Import the API functions
  apiEntries.forEach(([api], index) => {
    content.push(`import ${api} from './${api}/${apis[index].output[0].fileName}';`);
  });

  content.push(`async function ssrWithContext(request) { return ssr(request, ssrContext); }`);

  // Create assets from the client output
  const jsEntry = client.output[0];
  const cssEntries = [...(jsEntry?.viteMetadata?.importedCss ?? [])];
  const assets: HtmlAssets = {
    js: `/${jsEntry.fileName}`,
    css: cssEntries.map((css) => `/${css}`),
  };

  // Create the SSR context object
  content.push(`const ssrContext = {`);
  content.push(`  assets: ${JSON.stringify(assets)},`);
  content.push(`  apis: {`);
  apiEntries.forEach(([api]) => {
    content.push(`    ${api},`);
  });
  content.push(`  }`);
  content.push(`};`);

  // Export the SSR and API functions, and SSR context
  const exports = ["ssr", "ssrWithContext", "ssrContext", ...apiEntries.map(([api]) => api)];
  content.push(`export { ${exports.join(", ")} };`);

  return content.join("\n");
}
