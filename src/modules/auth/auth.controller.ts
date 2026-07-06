import { Request, Response } from "express";
import {
  loginUser,
  refreshAccessToken,
  logoutUser,
  getUserInfo,
  exchangeMicrosoftIdToken,
  submitMicrosoftRegistration,
  listSsoRegistrations,
  listSsoRegistrationAudits,
  approveSsoRegistration,
  rejectSsoRegistration,
} from "./auth.service";

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const result = await loginUser(email, password);

    res.json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    const result = await refreshAccessToken(refreshToken);

    res.json(result);
  } catch (err: any) {
    res.status(401).json({ message: err.message });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await logoutUser(userId);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getUserInfo(userId);

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const getMyPermissions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = await getUserInfo(userId);

    res.json({
      success: true,
      data: {
        role: result.user.role,
        pages: result.pagePermissions || [],
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const exchangeMicrosoft = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    const result = await exchangeMicrosoftIdToken({ idToken });

    const messageByStatus: Record<string, string> = {
      LOGIN_SUCCESS: "SSO login successful",
      REGISTRATION_REQUIRED: "Registration required",
      PENDING_APPROVAL: "Registration is pending admin approval",
      REJECTED: "Registration was rejected",
      INACTIVE_ACCOUNT: "Account is inactive",
    };

    res.json({
      success: true,
      data: result,
      message: messageByStatus[result.statusCode] || "SSO handled",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "SSO login failed",
      error: err.message,
    });
  }
};

export const registerMicrosoftSso = async (req: Request, res: Response) => {
  try {
    const { idToken, firstName, lastName, company, mobileNo, requestedRoleId, businessUnitId, position, remarks } = req.body;

    const result = await submitMicrosoftRegistration({
      idToken,
      firstName,
      lastName,
      company,
      mobileNo,
      requestedRoleId,
      businessUnitId,
      position,
      remarks,
    });

    res.status(201).json({
      success: true,
      data: result,
      message: "Registration submitted and pending admin approval",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "Registration submission failed",
      error: err.message,
    });
  }
};

export const getSsoRegistrations = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const items = await listSsoRegistrations(typeof status === "string" ? status : undefined);

    res.json({
      success: true,
      data: items,
      message: "SSO registrations fetched",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "Failed to fetch SSO registrations",
      error: err.message,
    });
  }
};

export const getSsoRegistrationAudits = async (req: Request, res: Response) => {
  try {
    const registrationId = typeof req.query.registrationId === "string" ? req.query.registrationId : undefined;
    const email = typeof req.query.email === "string" ? req.query.email : undefined;
    const items = await listSsoRegistrationAudits({ registrationId, email });

    res.json({
      success: true,
      data: items,
      message: "SSO registration audits fetched",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "Failed to fetch SSO registration audits",
      error: err.message,
    });
  }
};

export const approveSsoRegistrationRequest = async (req: Request, res: Response) => {
  try {
    const reviewerUserId = (req as any).user?.id;
    if (!reviewerUserId) {
      return res.status(401).json({
        success: false,
        data: null,
        message: "Unauthorized",
        error: "Unauthorized",
      });
    }

    const id = String(req.params.id || "");
    const { roleId, firstName, lastName, company, businessUnitId, position, remarks } = req.body;
    const result = await approveSsoRegistration(id, reviewerUserId, {
      roleId,
      firstName,
      lastName,
      company,
      businessUnitId,
      position,
      remarks,
    });

    res.json({
      success: true,
      data: result,
      message: "SSO registration approved",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "Failed to approve SSO registration",
      error: err.message,
    });
  }
};

export const rejectSsoRegistrationRequest = async (req: Request, res: Response) => {
  try {
    const reviewerUserId = (req as any).user?.id;
    if (!reviewerUserId) {
      return res.status(401).json({
        success: false,
        data: null,
        message: "Unauthorized",
        error: "Unauthorized",
      });
    }

    const id = String(req.params.id || "");
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const result = await rejectSsoRegistration(id, reviewerUserId, reason);

    res.json({
      success: true,
      data: result,
      message: "SSO registration rejected",
      error: null,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      data: null,
      message: "Failed to reject SSO registration",
      error: err.message,
    });
  }
};