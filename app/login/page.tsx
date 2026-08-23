"use client";

import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Github,
  Loader2,
  LockKeyhole,
  LogIn,
  Mail,
  UserPlus,
  UserRound,
} from "lucide-react";
import { loginUrl, sanitizeCallbackUrl } from "@/lib/auth-redirect";
import { LceBrand } from "@/components/LceBrand";
import {
  credentialAuthErrorMessage,
  registrationAvailabilityFromResponse,
  type RegistrationAvailability,
  type CredentialMessage,
  type CredentialMode,
  validateCredentialFields,
} from "@/lib/credential-auth";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslations } from "next-intl";

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500/45 focus:bg-white/[0.045] disabled:cursor-not-allowed disabled:opacity-60";

function parseAuthError(raw: string | null): CredentialMessage | null {
  if (!raw) return null;
  if (raw.startsWith("GITHUB_ACCOUNT_TOO_YOUNG:")) {
    const [, required, actual] = raw.split(":");
    if (actual === "unknown") {
      return { key: "githubAccountAgeUnknown" };
    }
    return { key: "githubAccountTooYoung", values: { required, actual } };
  }
  if (raw.includes("REGISTRATION_DISABLED")) {
    return { key: "registrationClosedExistingUsers" };
  }
  return { key: "loginFailed" };
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  autoComplete: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function PasswordField({
  id,
  label,
  value,
  autoComplete,
  placeholder,
  disabled,
  onChange,
}: PasswordFieldProps) {
  const t = useTranslations("Login");
  const [visible, setVisible] = useState(false);
  return (
    <label htmlFor={id} className="block space-y-1.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="relative block">
        <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          required
          className={cn(INPUT_CLASS, "pl-9 pr-10")}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? t("hidePassword") : t("showPassword")}
          title={visible ? t("hidePassword") : t("showPassword")}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-white/[0.05] hover:text-slate-300 disabled:pointer-events-none"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

function LoginContent() {
  const t = useTranslations("Login");
  const params = useSearchParams();
  const oauthErrorMessage = parseAuthError(params.get("error"));
  const oauthError = oauthErrorMessage
    ? t(oauthErrorMessage.key, oauthErrorMessage.values)
    : null;
  const callbackUrl = sanitizeCallbackUrl(params.get("callbackUrl"));
  const errorCallbackUrl = loginUrl(callbackUrl);
  const requestedMode: CredentialMode =
    params.get("mode") === "register" ? "register" : "login";
  // Registration stays fail-closed until the status endpoint confirms it is open.
  // A slow or failed H5 request must never expose the registration form.
  const [mode, setMode] = useState<CredentialMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [registrationAvailability, setRegistrationAvailability] =
    useState<RegistrationAvailability>("checking");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/registration", {
          signal: controller.signal,
          cache: "no-store",
        });
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (controller.signal.aborted) return;
        const availability = registrationAvailabilityFromResponse(response.ok, payload);
        setRegistrationAvailability(availability);
        setMode(availability === "open" ? requestedMode : "login");
      } catch {
        if (controller.signal.aborted) return;
        setRegistrationAvailability("unavailable");
        setMode("login");
      }
    })();
    return () => controller.abort();
  }, [requestedMode]);

  const selectMode = (next: CredentialMode) => {
    if (next === "register" && registrationAvailability !== "open") return;
    setMode(next);
    setFormError("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleCredentialSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateCredentialFields({
      mode,
      name,
      email,
      password,
      confirmPassword,
    });
    if (validationError) {
      setFormError(t(validationError.key, validationError.values));
      return;
    }

    setBusy(true);
    setFormError("");
    try {
      const result = mode === "register"
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
            callbackURL: callbackUrl,
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
            callbackURL: callbackUrl,
            rememberMe: true,
          });

      if (result.error) {
        const message = credentialAuthErrorMessage(result.error, mode);
        setFormError(t(message.key, message.values));
        return;
      }
      window.location.assign(callbackUrl);
    } catch {
      const message = credentialAuthErrorMessage(null, mode);
      setFormError(t(message.key, message.values));
    } finally {
      setBusy(false);
    }
  };

  const handleLinuxDoLogin = () => {
    authClient.signIn.oauth2({
      providerId: "linuxdo",
      callbackURL: callbackUrl,
      errorCallbackURL: errorCallbackUrl,
    });
  };

  const handleGithubLogin = () => {
    authClient.signIn.social({
      provider: "github",
      callbackURL: callbackUrl,
      errorCallbackURL: errorCallbackUrl,
    });
  };

  const errorMessage = formError || oauthError;

  return (
    <div className="relative min-h-dvh overflow-x-hidden overflow-y-auto bg-[#0a0f1a] px-4 py-6 animate-page-fade-in sm:py-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:64px_64px]" />
      <LanguageSwitcher className="absolute right-4 top-4 z-20" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-3rem)] w-full max-w-sm flex-col justify-center sm:min-h-[calc(100dvh-5rem)]">
        <div className="relative border border-white/[0.07] bg-[#0d1424]/95 p-6 backdrop-blur-xl sm:p-8">
          <div className="mb-6 text-center">
            <Link href="/" className="inline-block mb-3" aria-label="LCE">
              <LceBrand
                iconSize={56}
                className="flex-col gap-2"
                textClassName="text-2xl"
                priority
              />
            </Link>
            <p className="text-sm font-light text-slate-500">
              {mode === "register" ? t("createAnAccountAndGetAnApi") : t("logInToOpenTheConsole")}
            </p>
          </div>

          <div
            role="tablist"
            aria-label={t("accountAction")}
            className="mb-5 grid h-10 grid-cols-2 rounded-lg border border-white/[0.07] bg-black/15 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              onClick={() => selectMode("login")}
              className={cn(
                "rounded-md text-sm transition-colors",
                mode === "login"
                  ? "bg-white/[0.08] text-white"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {t("logIn")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              disabled={registrationAvailability !== "open"}
              title={
                registrationAvailability === "checking"
                  ? t("checkingRegistrationAvailability")
                  : registrationAvailability === "closed"
                    ? t("registrationHasBeenDisabledByAnAdministrator")
                    : registrationAvailability === "unavailable"
                      ? t("registrationStatusUnavailable")
                      : undefined
              }
              onClick={() => selectMode("register")}
              className={cn(
                "rounded-md text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                mode === "register"
                  ? "bg-white/[0.08] text-white"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {t("signUp")}
            </button>
          </div>

          {registrationAvailability === "checking" && requestedMode === "register" && (
            <p className="mb-4 flex items-center justify-center gap-2 text-center text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("checkingRegistrationAvailability")}
            </p>
          )}

          {registrationAvailability === "closed" && (
            <p className="mb-4 text-center text-xs text-amber-300/80">
              {t("registrationIsClosedExistingUsersCanStill")}
            </p>
          )}

          {registrationAvailability === "unavailable" && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <span className="font-light leading-relaxed">{t("registrationStatusUnavailable")}</span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
              <span className="font-light leading-relaxed">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleCredentialSubmit} className="space-y-3.5">
            {mode === "register" && (
              <label htmlFor="credential-name" className="block space-y-1.5">
                <span className="text-xs text-slate-400">{t("displayName")}</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                  <input
                    id="credential-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    placeholder={t("yourDisplayName")}
                    disabled={busy}
                    required
                    maxLength={80}
                    className={cn(INPUT_CLASS, "pl-9")}
                  />
                </span>
              </label>
            )}

            <label htmlFor="credential-email" className="block space-y-1.5">
              <span className="text-xs text-slate-400">{t("email")}</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
                <input
                  id="credential-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  disabled={busy}
                  required
                  className={cn(INPUT_CLASS, "pl-9")}
                />
              </span>
            </label>

            <PasswordField
              id="credential-password"
              label={t("password")}
              value={password}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder={mode === "register" ? t("atLeast8Characters") : t("enterYourPassword")}
              disabled={busy}
              onChange={setPassword}
            />

            {mode === "register" && (
              <PasswordField
                id="credential-password-confirm"
                label={t("confirmPassword")}
                value={confirmPassword}
                autoComplete="new-password"
                placeholder={t("enterYourPasswordAgain")}
                disabled={busy}
                onChange={setConfirmPassword}
              />
            )}

            <Button
              type="submit"
              size="lg"
              disabled={busy || (mode === "register" && registrationAvailability !== "open")}
              className="w-full justify-center rounded-lg bg-cyan-500/90 text-slate-950 hover:bg-cyan-400"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "register" ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {busy ? t("pleaseWait") : mode === "register" ? t("createAccount") : t("logIn")}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-white/[0.07]" />
            <span className="text-[11px] text-slate-600">{t("orContinueWith")}</span>
            <span className="h-px flex-1 bg-white/[0.07]" />
          </div>

          <div className="flex flex-col gap-2.5">
            <Button
              onClick={handleLinuxDoLogin}
              variant="glass"
              size="lg"
              className="w-full justify-center rounded-lg group"
            >
              <span className="flex h-5 w-5 flex-col overflow-hidden rounded-full border border-white/20">
                <span className="flex-[1] bg-[#2d2d2d]" />
                <span className="flex-[1.5] bg-[#f5f5f5]" />
                <span className="flex-[1] bg-[#f0a030]" />
              </span>
              <span className="font-light">{mode === "register" ? t("signUpWithLinuxdo") : t("logInWithLinuxdo")}</span>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-400" />
            </Button>

            <Button
              onClick={handleGithubLogin}
              variant="glass"
              size="lg"
              className="w-full justify-center rounded-lg group"
            >
              <Github className="h-5 w-5 text-slate-200" />
              <span className="font-light">{mode === "register" ? t("signUpWithGithub") : t("logInWithGithub")}</span>
              <ChevronRight className="h-4 w-4 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-400" />
            </Button>
          </div>
        </div>

        <div className="relative z-10 mt-6 text-center">
          <Button
            variant="ghost"
            asChild
            className="rounded-full border border-white/[0.06] bg-white/[0.02] font-light text-slate-500 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-slate-300 group"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              <span>{t("backToHome")}</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
