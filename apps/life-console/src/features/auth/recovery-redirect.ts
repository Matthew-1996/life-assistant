const recoveryPath = "/auth/recovery";
const invalidOriginMessage = "Recovery redirect requires an HTTPS origin";

export function createRecoveryRedirect(origin: string): string {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    throw new Error(invalidOriginMessage);
  }

  const isLocalDevelopment =
    url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (
    (url.protocol !== "https:" && !isLocalDevelopment)
    || url.hostname.includes("*")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error(invalidOriginMessage);
  }

  return new URL(recoveryPath, url.origin).toString();
}
