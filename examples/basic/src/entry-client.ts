import "./styles.css";

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1 class="blue">Rendered from client</h1>
`;

fetch("/api").then((res) => res.json()).then((data) => {
  document.querySelector<HTMLDivElement>('#api')!.innerHTML = `
    <h1>Fetched from client: ${data.message}</h1>
  `;
});
