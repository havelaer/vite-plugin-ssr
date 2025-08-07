document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <h1>Hello from client</h1>
`;

fetch("/api").then((res) => res.json()).then((data) => {
  document.querySelector<HTMLDivElement>('#api')!.innerHTML = `
    <h1>${data.message}</h1>
  `;
});
