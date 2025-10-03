import type { Context } from "@havelaer/vite-plugin-ssr";
import { renderToString } from "react-dom/server";
import App from "./App.tsx";
import Document from "./Document.tsx";

export default async (_request: Request, ctx: Context<"api">): Promise<Response> => {
  const html = renderToString(
    <Document assets={ctx.assets}>
      <App />
    </Document>,
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};
