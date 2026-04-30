import { Request, Response } from "express";
import { loginUser, refreshAccessToken, logoutUser, getUserInfo } from "./auth.service";

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