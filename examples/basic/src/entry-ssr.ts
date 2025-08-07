import clientEntryUrl from "./entry-client.ts?url";

export default async function fetch(_request: Request): Promise<Response> {
  return new Response(`
    <h1>Hello from server</h1>
    <div id="app"></div>
    <div id="api"></div>
    <script src="${clientEntryUrl}" type="module"></script>
  `);
}
