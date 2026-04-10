import jwt from "jsonwebtoken";

const ACCESS_SECRET = "access_secret";

export const authenticate = (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Invalid token format" });
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
