import { describe, expect, it } from "vitest";
import {
  credentialAuthErrorMessage,
  emailRegistrationEnabledFromResponse,
  registrationAvailabilityFromResponse,
  validateCredentialFields,
} from "./credential-auth";

describe("credential auth form", () => {
  it("fails registration availability closed when the status response is unusable", () => {
    expect(registrationAvailabilityFromResponse(false, { enabled: true })).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, {})).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, { enabled: "false" })).toBe("unavailable");
    expect(registrationAvailabilityFromResponse(true, null)).toBe("unavailable");
  });

  it("maps a valid registration status response", () => {
    expect(registrationAvailabilityFromResponse(true, { enabled: true })).toBe("open");
    expect(registrationAvailabilityFromResponse(true, { enabled: false })).toBe("closed");
  });

  it("fails email registration closed unless the server explicitly confirms SMTP readiness", () => {
    expect(emailRegistrationEnabledFromResponse(true, { emailRegistrationEnabled: true })).toBe(true);
    expect(emailRegistrationEnabledFromResponse(true, { emailRegistrationEnabled: false })).toBe(false);
    expect(emailRegistrationEnabledFromResponse(true, {})).toBe(false);
    expect(emailRegistrationEnabledFromResponse(false, { emailRegistrationEnabled: true })).toBe(false);
  });

  it("validates registration-only fields", () => {
    expect(validateCredentialFields({
      mode: "register",
      name: "",
      email: "user@example.com",
      password: "password",
      confirmPassword: "password",
    })).toEqual({ key: "enterDisplayName" });

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "password",
      confirmPassword: "different",
    })).toEqual({ key: "passwordsDoNotMatch" });
  });

  it("does not require registration fields when logging in", () => {
    expect(validateCredentialFields({
      mode: "login",
      name: "",
      email: "user@example.com",
      password: "short",
      confirmPassword: "",
    })).toBeNull();
  });

  it("maps Better Auth errors to translation keys", () => {
    expect(credentialAuthErrorMessage(
      { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
      "register"
    )).toEqual({ key: "emailAlreadyRegistered" });
    expect(credentialAuthErrorMessage(
      { message: "REGISTRATION_DISABLED" },
      "register"
    )).toEqual({ key: "registrationClosed" });
    expect(credentialAuthErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD" },
      "login"
    )).toEqual({ key: "incorrectEmailOrPassword" });
    expect(credentialAuthErrorMessage(
      { code: "EMAIL_NOT_VERIFIED" },
      "login"
    )).toEqual({ key: "emailNotVerified" });
    expect(credentialAuthErrorMessage(
      { message: "EMAIL_VERIFICATION_UNAVAILABLE" },
      "register"
    )).toEqual({ key: "emailVerificationUnavailable" });
    expect(credentialAuthErrorMessage(
      { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" },
      "register"
    )).toEqual({ key: "emailVerificationUnavailable" });
  });
});
