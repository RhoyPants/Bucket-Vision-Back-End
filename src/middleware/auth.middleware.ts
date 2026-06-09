import jwt from "jsonwebtoken";

const ACCESS_SECRET = "access_secret";

export const authenticate = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;

    let token: string | undefined;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else {
      const queryToken = req.query?.token || req.query?.accessToken;
      if (typeof queryToken === "string" && queryToken.trim()) {
        token = queryToken;
      }
    }

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, ACCESS_SECRET) as {
      id: string;
      roleId: string;
    };

    req.user = decoded; // ✅ always attach

    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};
