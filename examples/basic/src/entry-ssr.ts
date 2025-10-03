import type { Context } from "@havelaer/vite-plugin-ssr";

export default async function fetch(request: Request, ctx: Context<"api">): Promise<Response> {
  // Create an API Request
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Cookie", request.headers.get("Cookie") ?? "");
  const apiRequest = new Request(request.url, { headers });

  // Call the API Handler from the SSR Handler directly without doing a HTTP roundtrip
  const apiResponse = await ctx.apis.api(apiRequest).then((r: any) => r.json());

  return new Response(
    `
      ${ctx.assets.css.map((css: any) => `<link rel="stylesheet" href="${css}" />`).join("\n")}
      <h1>Rendered on server</h1>
      <div id="app"></div>
      <div id="api"></div>
      <div><h1>Fetched from server: ${apiResponse.message}</h1></div>
      <script src="${ctx.assets.js}" type="module"></script>
    `,
    {
      headers: {
        "Content-Type": "text/html",
      },
    },
  );
}
