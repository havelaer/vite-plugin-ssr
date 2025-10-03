import type { Context } from "@havelaer/vite-plugin-ssr";

const scripts = (js: Context["assets"]["js"]) =>
  js
    .map((js: any) =>
      "path" in js
        ? `<script src="${js.path}" type="module"></script>`
        : `<script type="module">${js.content}</script>`,
    )
    .join("\n");

const styles = (css: Context["assets"]["css"]) =>
  css.map((css: any) => `<link rel="stylesheet" href="${css.path}" />`).join("\n");

export default async function fetch(request: Request, ctx: Context<"api">): Promise<Response> {
  try {
    // Create an API Request
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cookie", request.headers.get("Cookie") ?? "");
    const apiRequest = new Request(request.url, { headers });

    // Call the API Handler from the SSR Handler directly without doing a HTTP roundtrip
    const apiResponse = await ctx.apis.api(apiRequest).then((r: any) => r.json());

    return new Response(
      `${styles(ctx.assets.css)}
  
      <h1>Rendered on server</h1>
      <div id="app"></div>
      <div id="api"></div>
      <div><h1>Fetched from server: ${apiResponse.message}</h1></div>
  
      ${scripts(ctx.assets.js)}
    `,
      {
        headers: {
          "Content-Type": "text/html",
        },
      },
    );
  } catch (error) {
    console.error(error);
    return new Response(
      JSON.stringify({
        message: "Error fetching API",
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
