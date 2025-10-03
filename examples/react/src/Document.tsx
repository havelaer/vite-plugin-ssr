import type { HtmlAssets } from "@havelaer/vite-plugin-ssr";

interface Props {
  assets: HtmlAssets;
  children: React.ReactNode;
}

function Document({ assets, children }: Props) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/vite.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>react</title>
        {assets.css.map((css) => (
          <link rel="stylesheet" href={css} key={css} />
        ))}
      </head>
      <body>
        <div id="root">{children}</div>
        <script
          type="module"
          dangerouslySetInnerHTML={{ __html: `window.__ssr_assets = ${JSON.stringify(assets)}` }}
        />
        <script type="module" src={assets.js}></script>
      </body>
    </html>
  );
}

export default Document;
