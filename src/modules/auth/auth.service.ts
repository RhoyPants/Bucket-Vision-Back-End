import prisma from "../../config/prisma";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const ACCESS_SECRET = "access_secret"; //I will need to change it for the secret in production, maybe use env variable for it
const REFRESH_SECRET = "refresh_secret";//I will need to change it for the secret in production, maybe use env variable for it

interface MicrosoftIdTokenPayload {
  idToken: string;
}

interface JwtClaims {
  aud?: string;
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
  preferred_username?: string;
  tid?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  oid?: string;
}

interface SsoRegistrationPayload {
  idToken: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  mobileNo?: string;
  requestedRoleId?: string;
  businessUnitId?: string;
  position?: string;
  remarks?: string;
}

interface SsoRegistrationReviewPayload {
  roleId?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  businessUnitId?: string;
  position?: string;
  remarks?: string;
}

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || "";

const AZURE_ISSUER = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`;

const ensureMinimalSsoEnvConfigured = () => {
  const missing = [
    ["AZURE_CLIENT_ID", AZURE_CLIENT_ID],
    ["AZURE_TENANT_ID", AZURE_TENANT_ID],
  ].filter((entry) => !entry[1]);

  if (missing.length) {
    throw new Error(`Missing SSO env config: ${missing.map((entry) => entry[0]).join(", ")}`);
  }
};

const decodeJwtPayload = (token: string): JwtClaims => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ID token format");
  }

  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload) as JwtClaims;
};

const buildRegistrationReferenceNo = () => {
  const timestamp = Date.now().toString().slice(-8);
  return `REG-${new Date().getFullYear()}-${timestamp}`;
};

const extractMicrosoftName = (claims: JwtClaims) => {
  const given = (claims.given_name || "").trim();
  const family = (claims.family_name || "").trim();
  const full = (claims.name || "").trim();

  // Prefer given_name and family_name from Azure
  if (given && family) {
    return {
      firstName: given,
      lastName: family,
      fullName: `${given} ${family}`,
    };
  }

  // Fallback: use name
  if (full) {
    const parts = full.split(/\s+/);
    if (parts.length === 1) {
      return {
        firstName: parts[0],
        lastName: "",
        fullName: parts[0],
      };
    }
    // Take first word as given, rest as family
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      fullName: full,
    };
  }

  return {
    firstName: "",
    lastName: "",
    fullName: "",
  };
};

const writeSsoRegistrationAudit = async (params: {
  registrationId: string;
  action: "CREATED" | "RESUBMITTED" | "APPROVED" | "REJECTED" | "UPDATED";
  fromStatus?: "PENDING" | "APPROVED" | "REJECTED";
  toStatus?: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string;
  changedById?: string;
  snapshot?: Record<string, any>;
}) => {
  await prisma.ssoRegistrationAudit.create({
    data: {
      registrationId: params.registrationId,
      action: params.action,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      reason: params.reason,
      changedById: params.changedById,
      snapshot: params.snapshot,
    },
  });
};

const validateAndGetMicrosoftIdentity = (idToken: string) => {
  ensureMinimalSsoEnvConfigured();

  if (!idToken || idToken.trim().length === 0) {
    throw new Error("idToken is required");
  }

  const claims = decodeJwtPayload(idToken);
  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== AZURE_ISSUER) {
    throw new Error("Invalid token issuer");
  }

  if (claims.aud !== AZURE_CLIENT_ID) {
    throw new Error("Invalid token audience");
  }

  if (claims.tid !== AZURE_TENANT_ID) {
    throw new Error("Invalid tenant");
  }

  if (!claims.exp || claims.exp <= now) {
    throw new Error("ID token expired");
  }

  if (claims.nbf && claims.nbf > now) {
    throw new Error("ID token is not valid yet");
  }

  const email = (claims.email || claims.preferred_username || "").toLowerCase();
  if (!email) {
    throw new Error("Email not found in Microsoft token");
  }
  const nameData = extractMicrosoftName(claims);

  return {
    email,
    fullName: nameData.fullName,
    firstName: nameData.firstName,
    lastName: nameData.lastName,
    oid: claims.oid || null,
  };
};

const buildAuthPayloadForUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      isActive: true,
      roleId: true,
      position: true,
      role: {
        select: {
          id: true,
          name: true,
          isActive: true,
          rolePermissions: {
            select: {
              module: {
                select: {
                  name: true,
                },
              },
              permission: {
                select: {
                  action: true,
                },
              },
            },
          },
        },
      },
      businessUnit: {
        select: {
          id: true,
          code: true,
          name: true,
          entity: true,
          buHead: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.isActive) {
    throw new Error("Account is inactive. Please contact your administrator.");
  }

  if (!user.role?.isActive) {
    throw new Error("Assigned role is inactive. Please contact your administrator.");
  }

  const permissions: Record<string, string[]> = {};
  user.role.rolePermissions.forEach((rp) => {
    const moduleName = rp.module.name;
    if (!permissions[moduleName]) {
      permissions[moduleName] = [];
    }
    permissions[moduleName].push(rp.permission.action);
  });

  const accessToken = jwt.sign(
    { id: user.id, roleId: user.roleId },
    ACCESS_SECRET,
    { expiresIn: "7d" }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    REFRESH_SECRET,
    { expiresIn: "7d" }
  );

  // save refresh token in DB
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      email: user.email,
      isActive: user.isActive,
      role: user.role.name,
      position: user.position,
      businessUnit: user.businessUnit,
      buHead: user.businessUnit?.buHead || null,
    },
    permissions,
  };
};

export const loginUser = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) throw new Error("User not found");
  if (!user.isActive) throw new Error("Account is inactive. Please contact your administrator.");

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) throw new Error("Invalid password");

  return await buildAuthPayloadForUser(user.id);
};

export const refreshAccessToken = async (token: string) => {
  try {
    const decoded: any = jwt.verify(token, REFRESH_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== token) {
      throw new Error("Invalid refresh token");
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, roleId: user.roleId },
      ACCESS_SECRET,
      { expiresIn: "15m" }
    );
    return { accessToken: newAccessToken };
  } catch {
    throw new Error("Invalid or expired refresh token");
  }
};

export const logoutUser = async (userId: string) => {
  // Clear refresh token from database
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  });

  return { message: "Logged out successfully" };
};

export const getUserInfo = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      company: true,
      email: true,
      isActive: true,
      position: true,
      businessUnit: {
        select: {
          id: true,
          code: true,
          name: true,
          entity: true,
          buHead: true,
        },
      },
      role: {
        select: {
          id: true,
          name: true,
          rolePermissions: {
            select: {
              module: {
                select: {
                  id: true,
                  name: true,
                  path: true,
                },
              },
              permission: {
                select: {
                  id: true,
                  action: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!user) throw new Error("User not found");

  // Transform permissions into a structured format
  const permissions: Record<string, string[]> = {};
  user.role.rolePermissions.forEach((rp) => {
    const moduleName = rp.module.name;
    if (!permissions[moduleName]) {
      permissions[moduleName] = [];
    }
    permissions[moduleName].push(rp.permission.action);
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      company: user.company,
      email: user.email,
      isActive: user.isActive,
      role: user.role.name,
      position: user.position,
      businessUnit: user.businessUnit,
      buHead: user.businessUnit?.buHead || null,
    },
    permissions, // { USERS: ["CREATE", "READ", "UPDATE", "DELETE"], ... }
  };
};

export const exchangeMicrosoftIdToken = async (payload: MicrosoftIdTokenPayload) => {
  const { idToken } = payload;
  const identity = validateAndGetMicrosoftIdentity(idToken);

  const existingUser = await prisma.user.findUnique({
    where: { email: identity.email },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (existingUser && existingUser.isActive) {
    const auth = await buildAuthPayloadForUser(existingUser.id);

    return {
      statusCode: "LOGIN_SUCCESS",
      ...auth,
    };
  }

  const registration = await prisma.ssoRegistration.findUnique({
    where: { email: identity.email },
    select: {
      id: true,
      referenceNo: true,
      status: true,
      rejectReason: true,
      requestedRoleId: true,
      businessUnitId: true,
      departmentId: true,
      position: true,
      mobileNo: true,
      remarks: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!registration) {
    return {
      statusCode: "REGISTRATION_REQUIRED",
    };
  }

  if (registration.status === "PENDING") {
    return {
      statusCode: "PENDING_APPROVAL",
      registration,
    };
  }

  if (registration.status === "REJECTED") {
    return {
      statusCode: "REJECTED",
      registration,
    };
  }

  if (existingUser && !existingUser.isActive) {
    return {
      statusCode: "INACTIVE_ACCOUNT",
      message: "Account is inactive. Please contact your administrator.",
    };
  }

  return {
    statusCode: "REGISTRATION_REQUIRED",
  };
};

export const submitMicrosoftRegistration = async (payload: SsoRegistrationPayload) => {
  const identity = validateAndGetMicrosoftIdentity(payload.idToken);

  const existingUser = await prisma.user.findUnique({
    where: { email: identity.email },
    select: { id: true, isActive: true },
  });

  if (existingUser?.isActive) {
    throw new Error("User already active. Please login with Microsoft.");
  }

  const roleIsValid = payload.requestedRoleId
    ? await prisma.role.findFirst({
        where: { id: payload.requestedRoleId, isActive: true },
        select: { id: true },
      })
    : null;

  if (payload.requestedRoleId && !roleIsValid) {
    throw new Error("Requested role is invalid or inactive");
  }

  if (payload.businessUnitId) {
    const bu = await prisma.businessUnit.findFirst({
      where: { id: payload.businessUnitId, isActive: true },
      select: { id: true },
    });
    if (!bu) {
      throw new Error("Business unit not found or inactive");
    }
  }

  const incomingFirstName = payload.firstName?.trim() || identity.firstName || null;
  const incomingLastName = payload.lastName?.trim() || identity.lastName || null;
  const incomingFullName = `${incomingFirstName || ""} ${incomingLastName || ""}`.trim() || identity.fullName;

  const existingRegistration = await prisma.ssoRegistration.findUnique({
    where: { email: identity.email },
  });

  const commonData = {
    fullName: incomingFullName,
    firstName: incomingFirstName,
    lastName: incomingLastName,
    company: payload.company?.trim() || null,
    providerOid: identity.oid,
    mobileNo: payload.mobileNo,
    requestedRoleId: payload.requestedRoleId,
    businessUnitId: payload.businessUnitId,
    position: payload.position,
    remarks: payload.remarks,
    status: "PENDING" as const,
    rejectReason: null,
    reviewedById: null,
    reviewedAt: null,
  };

  const registration = existingRegistration
    ? await prisma.ssoRegistration.update({
        where: { id: existingRegistration.id },
        data: commonData,
        select: {
          id: true,
          referenceNo: true,
          email: true,
          fullName: true,
          firstName: true,
          lastName: true,
          company: true,
          status: true,
          requestedRoleId: true,
          businessUnitId: true,
          position: true,
          mobileNo: true,
          remarks: true,
          createdAt: true,
          updatedAt: true,
        },
      })
    : await prisma.ssoRegistration.create({
        data: {
          referenceNo: buildRegistrationReferenceNo(),
          email: identity.email,
          provider: "MICROSOFT",
          ...commonData,
        },
        select: {
          id: true,
          referenceNo: true,
          email: true,
          fullName: true,
          firstName: true,
          lastName: true,
          company: true,
          status: true,
          requestedRoleId: true,
          businessUnitId: true,
          position: true,
          mobileNo: true,
          remarks: true,
          createdAt: true,
          updatedAt: true,
        },
      });

  await writeSsoRegistrationAudit({
    registrationId: registration.id,
    action: existingRegistration
      ? existingRegistration.status === "REJECTED"
        ? "RESUBMITTED"
        : "UPDATED"
      : "CREATED",
    fromStatus: existingRegistration?.status,
    toStatus: "PENDING",
    snapshot: {
      email: registration.email,
      fullName: registration.fullName,
      firstName: registration.firstName,
      lastName: registration.lastName,
      company: registration.company,
      requestedRoleId: registration.requestedRoleId,
      businessUnitId: registration.businessUnitId,
      position: registration.position,
      mobileNo: registration.mobileNo,
      remarks: registration.remarks,
    },
  });

  return {
    statusCode: "PENDING_APPROVAL",
    registration,
  };
};

export const listSsoRegistrations = async (status?: string) => {
  const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED"];
  const normalizedStatus = (status || "").trim().toUpperCase();

  // If status is explicitly provided but is not valid, return empty
  const statusProvided = (status !== undefined && status.trim() !== "");
  if (statusProvided && !VALID_STATUSES.includes(normalizedStatus)) {
    return [];
  }

  const where = statusProvided
    ? { status: normalizedStatus as "PENDING" | "APPROVED" | "REJECTED" }
    : {};

  const items = await prisma.ssoRegistration.findMany({
    where,
    include: {
      requestedRole: {
        select: { id: true, name: true },
      },
      businessUnit: {
        select: { id: true, code: true, name: true, entity: true },
      },
      reviewedBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return items;
};

export const approveSsoRegistration = async (
  registrationId: string,
  reviewerUserId: string,
  payload: SsoRegistrationReviewPayload
) => {
  const registration = await prisma.ssoRegistration.findUnique({
    where: { id: registrationId },
  });

  if (!registration) {
    throw new Error("Registration request not found");
  }

  const roleId = payload.roleId || registration.requestedRoleId;
  if (!roleId) {
    throw new Error("Role is required before approval");
  }

  const role = await prisma.role.findFirst({
    where: { id: roleId, isActive: true },
    select: { id: true },
  });

  if (!role) {
    throw new Error("Role is invalid or inactive");
  }

  if (payload.businessUnitId) {
    const bu = await prisma.businessUnit.findFirst({
      where: { id: payload.businessUnitId, isActive: true },
      select: { id: true },
    });

    if (!bu) {
      throw new Error("Business unit not found or inactive");
    }
  }

  const randomPassword = `SSO-${Date.now()}-${registration.email}`;
  const hashedPassword = await bcrypt.hash(randomPassword, 10);

  const fullNameFromReview = `${payload.firstName || registration.firstName || ""} ${payload.lastName || registration.lastName || ""}`.trim();
  const userDisplayName = fullNameFromReview || registration.fullName;

  const user = await prisma.user.upsert({
    where: { email: registration.email },
    update: {
      name: userDisplayName,
      firstName: payload.firstName || registration.firstName || null,
      lastName: payload.lastName || registration.lastName || null,
      company: payload.company || registration.company || null,
      roleId,
      businessUnitId: payload.businessUnitId || registration.businessUnitId || null,
      position: payload.position || registration.position || null,
      isActive: true,
    },
    create: {
      name: userDisplayName,
      firstName: payload.firstName || registration.firstName || null,
      lastName: payload.lastName || registration.lastName || null,
      company: payload.company || registration.company || null,
      email: registration.email,
      password: hashedPassword,
      roleId,
      businessUnitId: payload.businessUnitId || registration.businessUnitId || null,
      position: payload.position || registration.position || null,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      roleId: true,
    },
  });

  const updatedRegistration = await prisma.ssoRegistration.update({
    where: { id: registration.id },
    data: {
      status: "APPROVED",
      rejectReason: null,
      reviewedById: reviewerUserId,
      reviewedAt: new Date(),
      requestedRoleId: roleId,
      fullName: userDisplayName,
      firstName: payload.firstName ?? registration.firstName,
      lastName: payload.lastName ?? registration.lastName,
      company: payload.company ?? registration.company,
      businessUnitId: payload.businessUnitId ?? registration.businessUnitId,
      position: payload.position ?? registration.position,
      remarks: payload.remarks ?? registration.remarks,
    },
    include: {
      requestedRole: {
        select: { id: true, name: true },
      },
      businessUnit: {
        select: { id: true, code: true, name: true, entity: true },
      },
      reviewedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  await writeSsoRegistrationAudit({
    registrationId: registration.id,
    action: "APPROVED",
    fromStatus: registration.status,
    toStatus: "APPROVED",
    changedById: reviewerUserId,
    snapshot: {
      email: updatedRegistration.email,
      fullName: updatedRegistration.fullName,
      requestedRoleId: updatedRegistration.requestedRoleId,
      businessUnitId: updatedRegistration.businessUnitId,
      position: updatedRegistration.position,
      remarks: updatedRegistration.remarks,
    },
  });

  return {
    user,
    registration: updatedRegistration,
  };
};

export const rejectSsoRegistration = async (
  registrationId: string,
  reviewerUserId: string,
  reason: string
) => {
  if (!reason || !reason.trim()) {
    throw new Error("Reject reason is required");
  }

  const registration = await prisma.ssoRegistration.findUnique({
    where: { id: registrationId },
  });

  if (!registration) {
    throw new Error("Registration request not found");
  }

  const updatedRegistration = await prisma.ssoRegistration.update({
    where: { id: registrationId },
    data: {
      status: "REJECTED",
      rejectReason: reason.trim(),
      reviewedById: reviewerUserId,
      reviewedAt: new Date(),
    },
    include: {
      requestedRole: {
        select: { id: true, name: true },
      },
      businessUnit: {
        select: { id: true, code: true, name: true, entity: true },
      },
      reviewedBy: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  await writeSsoRegistrationAudit({
    registrationId,
    action: "REJECTED",
    fromStatus: registration.status,
    toStatus: "REJECTED",
    reason: reason.trim(),
    changedById: reviewerUserId,
    snapshot: {
      email: updatedRegistration.email,
      fullName: updatedRegistration.fullName,
      requestedRoleId: updatedRegistration.requestedRoleId,
      businessUnitId: updatedRegistration.businessUnitId,
      position: updatedRegistration.position,
      remarks: updatedRegistration.remarks,
    },
  });

  return updatedRegistration;
};

export const listSsoRegistrationAudits = async (filters?: {
  registrationId?: string;
  email?: string;
}) => {
  let registrationId = filters?.registrationId;

  if (!registrationId && filters?.email) {
    const reg = await prisma.ssoRegistration.findUnique({
      where: { email: filters.email.toLowerCase() },
      select: { id: true },
    });
    registrationId = reg?.id;
  }

  // If registrationId resolved, filter by it; otherwise return all audits for admin view
  const where = registrationId ? { registrationId } : {};

  return await prisma.ssoRegistrationAudit.findMany({
    where,
    include: {
      changedBy: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
};