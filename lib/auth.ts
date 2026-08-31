import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth, organization } from "better-auth/plugins";
import { Pool } from "pg";
import { initDB, initRegistrationGate, isRegistrationAtCapacity, isRegistrationDisabled } from "@/lib/db";
import {
  onMemberAdded,
  onMemberLeft,
  onMemberRemoved,
  onMemberRoleUpdated,
  onOrganizationCreated,
  onOrganizationDeleted,
} from "@/lib/org-sync";
import { getOrganizationMembershipLimit } from "@/lib/billing";
import { authIpAddressOptions } from "@/lib/auth-ip";
import { LINUXDO_OAUTH_PROVIDER } from "@/lib/auth-provider-presets";
import { isEmailVerificationConfigured, sendAccountVerificationEmail } from "@/lib/email-verification";
import { MILLISECONDS_PER_DAY } from "@/lib/time-policy";
import {
  applicationBaseUrl,
  authRuntimePolicy,
  postgresConnectionOptions,
} from "@/lib/server-runtime-config";

const credentialEmailVerificationEnabled = isEmailVerificationConfigured();
const AUTH_RUNTIME_POLICY = authRuntimePolicy();

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: applicationBaseUrl(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: !credentialEmailVerificationEnabled,
    minPasswordLength: AUTH_RUNTIME_POLICY.minPasswordLength,
    maxPasswordLength: AUTH_RUNTIME_POLICY.maxPasswordLength,
    autoSignIn: false,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: AUTH_RUNTIME_POLICY.emailVerificationTtlSeconds,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountVerificationEmail({
        email: user.email,
        name: user.name,
        verificationUrl: url,
      });
    },
  },
  advanced: {
    ipAddress: authIpAddressOptions(process.env.BETTER_AUTH_TRUSTED_PROXIES),
  },
  database: new Pool(postgresConnectionOptions()),
  user: {
    additionalFields: {
      trustLevel: {
        type: "number",
        required: false,
        defaultValue: 0,
      },
      username: {
        type: "string",
        required: false,
      },
      githubCreatedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      mapProfileToUser: (profile) => ({
        name: profile.name || profile.login,
        email: profile.email,
        image: profile.avatar_url,
        username: profile.login,
        githubCreatedAt: profile.created_at ? new Date(profile.created_at) : undefined,
      }),
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // 先安装数据库触发器：应用层检查负责友好报错，数据库触发器负责
          // 与 user INSERT 同事务原子扣减，防止并发注册超发名额。
          await initRegistrationGate();
          // 注册开关：user.create 只在新用户首次注册时触发，老用户登录不受影响
          if (await isRegistrationDisabled()) {
            throw new APIError("BAD_REQUEST", {
              message: "REGISTRATION_DISABLED",
            });
          }
          if (await isRegistrationAtCapacity()) {
            throw new APIError("BAD_REQUEST", { message: "REGISTRATION_LIMIT_REACHED" });
          }
          const created = (user as { githubCreatedAt?: Date | string | null })
            .githubCreatedAt;
          if (!created) return;
          const createdMs = new Date(created).getTime();
          if (Number.isNaN(createdMs)) {
            throw new APIError("BAD_REQUEST", {
              message: "GITHUB_ACCOUNT_TOO_YOUNG:unknown:unknown",
            });
          }
          const minDays = AUTH_RUNTIME_POLICY.githubMinAccountAgeDays;
          const ageDays = Math.floor((Date.now() - createdMs) / MILLISECONDS_PER_DAY);
          if (ageDays < minDays) {
            throw new APIError("BAD_REQUEST", {
              message: `GITHUB_ACCOUNT_TOO_YOUNG:${minDays}:${ageDays}`,
            });
          }
        },
      },
    },
  },
  hooks: {
    // 组织路由依赖 initDB 建的表/列（organization、api_keys.org_*）；
    // better-auth handler 不经过业务路由的惰性 initDB，这里补上（幂等）。
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path.startsWith("/organization")) {
        await initDB();
      }
    }),
    // better-auth 1.6.23 的 /organization/leave 不触发 member hooks，
    // 在全局 after hook 兜底删除退出者的组织密钥（覆盖直接调用 API 的路径）。
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/organization/leave") return;
      const returned = ctx.context.returned;
      if (
        returned &&
        typeof returned === "object" &&
        "userId" in returned &&
        typeof returned.userId === "string" &&
        "organizationId" in returned &&
        typeof returned.organizationId === "string"
      ) {
        await onMemberLeft(returned.userId, returned.organizationId);
      }
    }),
  },
  plugins: [
    organization({
      // 邀请制：任何用户可创建组织成为 owner。角色只用 owner/member 两档。
      creatorRole: "owner",
      invitationExpiresIn: AUTH_RUNTIME_POLICY.organizationInvitationTtlSeconds,
      // 子账号按 owner 名下全部组织中的唯一用户计数；候选用户若已在其中
      // 一个组织，不会因加入另一个组织重复占用套餐席位。
      membershipLimit: async (user, targetOrganization) =>
        getOrganizationMembershipLimit(targetOrganization.id, user.id),
      organizationHooks: {
        afterCreateOrganization: onOrganizationCreated,
        afterAddMember: onMemberAdded,
        // acceptInvitation 不走 addMember hooks，单独接；ensure 幂等，双触发安全
        afterAcceptInvitation: onMemberAdded,
        afterRemoveMember: onMemberRemoved,
        afterUpdateMemberRole: onMemberRoleUpdated,
        afterDeleteOrganization: onOrganizationDeleted,
      },
    }),
    genericOAuth({
      config: [
        {
          ...LINUXDO_OAUTH_PROVIDER,
          scopes: [...LINUXDO_OAUTH_PROVIDER.scopes],
          clientId: process.env.AUTH_LINUXDO_ID!,
          clientSecret: process.env.AUTH_LINUXDO_SECRET!,
          mapProfileToUser: (profile) => {
            return {
              name: profile.name || profile.username,
              email: profile.email,
              image: profile.avatar_url || profile.avatar_template?.replace("{size}", "120"),
              username: profile.username,
              trustLevel: profile.trust_level,
            };
          },
        },
      ],
    }),
  ],
});
