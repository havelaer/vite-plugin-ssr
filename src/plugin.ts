import fs from "node:fs/promises";
import path from "node:path";
import { getRequestListener } from "@hono/node-server";
import * as cheerio from "cheerio";
import {
  type ConfigEnv,
  createServerModuleRunner,
  type EnvironmentOptions,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
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
  route?: string;
}

type Options = {
  client: string | ClientConfig;
  ssr: string | SSRConfig;
  apis?: Record<string, string | APIConfig>;
};

type EntryMapping = Record<string, { input: string; inputFullPath: string; output: string }>;

function getEntry(config: string | BaseEnvConfig): string {
  if (typeof config === "string") {
    return config;
  }
  return config.entry;
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

function extractHtmlScripts(html: string): Array<{ content?: string; src?: string }> {
  const $ = cheerio.load(html);
  const scripts: Array<{ content?: string; src?: string }> = [];

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
  let viteServer: ViteDevServer | undefined;
  let resolvedConfig: ResolvedConfig;
  let configEnv: ConfigEnv;
  let injectedScripts: Array<{ content?: string; src?: string }> = [];
  let outDirRoot = "dist";

  const { apis } = options;

  const entryMapper: EntryMapping = {
    client: {
      input: getEntry(options.client),
      inputFullPath: normalizePath(path.resolve(getEntry(options.client))),
      output: "static/entry-client.js",
    },
    ssr: {
      input: getEntry(options.ssr),
      inputFullPath: normalizePath(path.resolve(getEntry(options.ssr))),
      output: "entry-ssr.js",
    },
    ...(apis
      ? Object.keys(apis).reduce((entries, api) => {
          entries[api] = {
            input: getEntry(apis[api]),
            inputFullPath: normalizePath(path.resolve(getEntry(apis[api]))),
            output: `entry-${api}.js`,
          };
          return entries;
        }, {} as EntryMapping)
      : {}),
  };

  return {
    name: "havelaer-vite-ssr",
    sharedDuringBuild: true,
    enforce: "pre", // To catch our client entry ?url imports
    config(config, env) {
      configEnv = env;
      outDirRoot = config.build?.outDir ?? "dist";

      return {
        environments: {
          client: getEnvironment(options.client, {
            build: {
              outDir: `${outDirRoot}/client`,
              emitAssets: true,
              copyPublicDir: true,
              emptyOutDir: false,
              rollupOptions: {
                input: entryMapper.client.inputFullPath,
                output: {
                  entryFileNames: entryMapper.client.output,
                  chunkFileNames: "static/assets/[name]-[hash].js",
                  assetFileNames: "static/assets/[name]-[hash][extname]",
                },
              },
            },
          }),
          ssr: getEnvironment(options.ssr, {
            build: {
              outDir: `${outDirRoot}/ssr`,
              copyPublicDir: false,
              emptyOutDir: false,
              ssrEmitAssets: false,
              rollupOptions: {
                input: entryMapper.ssr.inputFullPath,
                output: {
                  entryFileNames: entryMapper.ssr.output,
                  chunkFileNames: "assets/[name]-[hash].js",
                  assetFileNames: "assets/[name]-[hash][extname]",
                },
              },
            },
          }),
          ...(options.apis
            ? Object.entries(options.apis).reduce(
                (apiEnvironments, [api, config]) => {
                  apiEnvironments[api] = getEnvironment(config, {
                    build: {
                      rollupOptions: {
                        input: entryMapper[api].inputFullPath,
                        output: {
                          entryFileNames: entryMapper[api].output,
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
              )
            : {}),
        },
        builder: {
          async buildApp(builder) {
            await fs.rm(path.resolve(builder.config.root, outDirRoot), {
              recursive: true,
              force: true,
            });

            await Promise.all([
              builder.build(builder.environments.client),
              builder.build(builder.environments.ssr),
              ...(options.apis
                ? Object.entries(options.apis).map(([api]) =>
                    builder.build(builder.environments[api]),
                  )
                : []),
            ]);
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

      if (options.apis) {
        Object.entries(options.apis).forEach(([api, config]) => {
          const moduleRunner = createServerModuleRunner(server.environments[api]);
          const route = typeof config !== "string" && config.route ? config.route : `/${api}`;

          server.middlewares.use(async (req, res, next) => {
            if (req.url?.startsWith(route)) {
              const apiFetch = await moduleRunner.import(getEntry(config));

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
            const ssrFetch = await ssrRunner.import(getEntry(options.ssr));
            await getRequestListener(ssrFetch.default)(req, res);
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
    async resolveId(id, parent) {
      // Handle entry url imports
      if (id.endsWith("?url") && parent) {
        const isDev = configEnv.command === "serve";
        const resolvedId = path.resolve(path.dirname(parent), id.slice(0, -4));
        const resolvedEntry = Object.entries(entryMapper).find(
          ([_, entry]) => entry.inputFullPath === resolvedId,
        );

        // Is not one of 'our' entry files
        if (!resolvedEntry) return;

        const [targetEnvName] = resolvedEntry;

        if (targetEnvName === "client") {
          return `\0virtual:vite-plugin-ssr/entry-client-url`;
        } else {
          if (isDev) {
            return `\0${id}`;
          } else {
            return `\0${targetEnvName}?url`;
          }
        }
      }

      // Client entry wrapper (dev)
      if (id.endsWith(`@vite-plugin-ssr-entry-client`)) {
        return `\0virtual:vite-plugin-ssr/resolved-entry-client-id`;
      }
    },
    load(id) {
      // Client entry url
      if (id.startsWith(`\0virtual:vite-plugin-ssr/entry-client-url`)) {
        const isDev = configEnv.command === "serve";

        if (isDev) {
          return `export default "${resolvedConfig.base}@vite-plugin-ssr-entry-client";`;
        } else {
          return `export default "${resolvedConfig.base}${entryMapper.client.output}";`;
        }
      }

      // SSR or API entry url
      if (id.startsWith(`\0`) && id.endsWith(`?url`)) {
        const isDev = configEnv.command === "serve";

        if (isDev) {
          return `export default "${id.slice(1, -4)}";`;
        } else {
          const targetEnvName = id.slice(1, -4);
          // From the importer walk back to our outDirRoot and then to the target env
          return `
const depth = import.meta.url.split("${outDirRoot}/")[1].split("/").length - 1;
export default (depth > 0 ? "../".repeat(depth) : "./") + "${targetEnvName}/${entryMapper[targetEnvName].output}";`;
        }
      }

      // Client entry wrapper (dev)
      if (id === `\0virtual:vite-plugin-ssr/resolved-entry-client-id`) {
        // Wrap the user client entry with a plugin client entry and add the injected scripts
        const content = injectedScripts
          .map((script) => script.content || `import "${script.src}";`)
          .join("\n");
        return `${content}\nawait import("${resolvedConfig.base}${getEntry(options.client)}");`;
      }
    },
  };
}
