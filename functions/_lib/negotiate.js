// CLI clients get one line of text. Browsers get the HTML page.
// User-Agent wins: curl asking for text/html is still a CLI client.
const CLI_UA =
  /curl|wget|httpie|powershell|python-requests|python-urllib|go-http-client|okhttp|libwww-perl|aiohttp|axios\/|node-fetch|undici|postman|insomnia|java\/|dart\//i;

export function wantsPlainText(request) {
  const ua = request.headers.get("user-agent") || "";
  if (CLI_UA.test(ua)) return true;
  const accept = request.headers.get("accept");
  if (accept == null || accept.trim() === "") return ua.trim() === "";
  const lowered = accept.toLowerCase();
  if (lowered.includes("text/html") || lowered.includes("application/xhtml+xml")) return false;
  return true;
}
