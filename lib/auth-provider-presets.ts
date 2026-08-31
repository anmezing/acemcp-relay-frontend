// OAuth protocol endpoints are provider identity, not deployment tuning. Keep the
// canonical integration in one owner so authentication code does not copy URLs.
export const LINUXDO_OAUTH_PROVIDER = Object.freeze({
  providerId: "linuxdo",
  authorizationUrl: "https://connect.linux.do/oauth2/authorize",
  tokenUrl: "https://connect.linuxdo.org/oauth2/token",
  userInfoUrl: "https://connect.linuxdo.org/api/user",
  scopes: ["profile", "email"] as const,
});
