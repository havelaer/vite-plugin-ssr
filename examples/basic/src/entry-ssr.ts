import clientEntryUrl from "./entry-client.ts?url";
import apiEntryUrl from "./entry-api.ts?url";

export default async function fetch(request: Request): Promise<Response> {
  const apiFetch = await import(/* @vite-ignore */ apiEntryUrl);

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Cookie", request.headers.get("Cookie") ?? "");

  const apiRequest = new Request(request.url, {
    headers,
  });

  const apiResponse = await apiFetch.default(apiRequest).then((r: any) => r.json());

  return new Response(`
    <h1>Rendered on server</h1>
    <div id="app"></div>
    <div id="api"></div>
    <div><h1>Fetched from server: ${apiResponse.message}</h1></div>
    <script src="${clientEntryUrl}" type="module"></script>
  `, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}
