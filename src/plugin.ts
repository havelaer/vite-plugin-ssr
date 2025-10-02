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
  type ViteDevServer,
} from "vite";

export type ServerEntryHandler = (req: Request) => Promise<Response>;

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

export type Context<TApis extends string = never> = {
  root: string;
  assets: {
    js: ({ path: string } | { content: string })[];
    css: ({ path: string } | { content: string })[];
  };
  imports: { [P in TApis]: string };
};

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

function extractHtmlAssets(html: string): Context["assets"] {
  const $ = cheerio.load(html);
  const assets: Context["assets"] = {
    js: [],
    css: [],
  };

  $("script").each((_, element) => {
    const src = $(element).attr("src");
    const content = $(element).html() ?? undefined;

    assets.js.push(src ? { path: src } : { content: content! });
  });

  $("link[rel='stylesheet']").each((_, element) => {
    const src = $(element).attr("href")!;
    assets.css.push({ path: src });
  });

  return assets;
}

export default function ssrPlugin(options: Options): Plugin {
  const resolvedOptions = resolveOptions(options);
  const apiEntries = Object.entries(resolvedOptions.apis);
  let viteServer: ViteDevServer | undefined;
  let assets: Context["assets"] = { js: [], css: [] };
  let outDirRoot = "dist";

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
                  assetFileNames: "assets/[name][extname]",
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

            const [client, ssr, ...apis] = (await Promise.all([
              builder.build(builder.environments.client),
              builder.build(builder.environments.ssr),
              ...apiEntries.map(([api]) => builder.build(builder.environments[api])),
            ])) as [RollupOutput, RollupOutput, ...RollupOutput[]];

            console.log(client.output[0]);
            console.log(client.output[1]);

            const content: string[] = [];

            content.push(`import { dirname } from 'node:path';`);
            content.push(`import { fileURLToPath } from 'node:url';`);

            const jsEntries = client.output.filter((chunk) => "isEntry" in chunk && chunk.isEntry);
            const cssEntries = jsEntries.flatMap((chunk) =>
              "viteMetadata" in chunk ? [...chunk.viteMetadata!.importedCss] : [],
            );

            const assets: Context["assets"] = {
              js: jsEntries.map((chunk) => ({ path: `/${chunk.fileName}` })),
              css: cssEntries.map((css) => ({ path: `/${css}` })),
            };

            const imports: Context["imports"] = {
              ssr: `./ssr/${ssr.output[0].fileName}`,
              ...apiEntries.reduce(
                (imports, [api], index) => {
                  imports[api] = `./${api}/${apis[index].output[0].fileName}`;
                  return imports;
                },
                {} as Record<string, string>,
              ),
            };

            content.push(`export const ctx = {`);
            content.push(`  assets: ${JSON.stringify(assets)},`);
            content.push(`  imports: ${JSON.stringify(imports)},`);
            content.push(`  root: dirname(fileURLToPath(import.meta.url)),`);
            content.push(`};`);

            content.push(`import ssrFn from './ssr/${ssr.output[0].fileName}';`);
            content.push(`export async function ssr(request) { return ssrFn(request, ctx); }`);

            apiEntries.forEach(([api], index) => {
              content.push(
                `export { default as ${api} } from './${api}/${apis[index].output[0].fileName}';`,
              );
            });

            await fs.writeFile(
              path.resolve(builder.config.root, outDirRoot, "index.js"),
              content.join("\n"),
            );
          },
        },
        appType: "custom",
      };
    },
    async configureServer(server) {
      viteServer = server;
      const ssrRunner = createServerModuleRunner(server.environments.ssr);

      // Extract the scripts that Vite plugins would inject into the initial HTML
      const templateHtml = `<html><head></head><body></body></html>`;
      const transformedHtml = await server.transformIndexHtml("/", templateHtml);
      assets = extractHtmlAssets(transformedHtml);
      assets.js.push({ path: resolvedOptions.client.entry });

      const ssrContext: Context<keyof typeof options.apis> = {
        assets,
        imports: apiEntries.reduce(
          (imports, [api, config]) => {
            imports[api] = config.entry;
            return imports;
          },
          {} as Record<string, string>,
        ),
        root: server.config.root,
      };

      if (options.apis) {
        apiEntries.forEach(([api, config]) => {
          const moduleRunner = createServerModuleRunner(server.environments[api]);

          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith(config.route)) {
              const apiFetch = await moduleRunner.import(config.entry);

              await getRequestListener(apiFetch.default)(req, res);
              return;
            }
            next();
          });
        });
      }

      return async () => {
        server.middlewares.use(async (req, res, next) => {
          if (res.writableEnded) {
            return next();
          }

          try {
            const ssrFetch = await ssrRunner.import(resolvedOptions.ssr.entry);
            await getRequestListener((request) => ssrFetch.default(request, ssrContext))(req, res);
          } catch (e: any) {
            viteServer?.ssrFixStacktrace(e);
            console.info(e.stack);
            res.statusCode = 500;
            res.end(e.stack);
          }
        });
      };
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
