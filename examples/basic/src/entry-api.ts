export default async function fetch(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({
    message: "Hello from the API",
  }), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
