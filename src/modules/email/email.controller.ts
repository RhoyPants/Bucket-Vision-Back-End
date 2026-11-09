import { Request, Response } from "express";
import { sendEmail } from "./email.service";

export async function sendAutomateEmail(req: Request, res: Response) {
  const { to, subject, message, html } = req.body ?? {};
  const recipients = typeof to === "string" ? [to] : to;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 50 ||
    recipients.some((value: unknown) => typeof value !== "string" ||
      value.trim().length > 254 || !/^[^\s@<> ,;]+@[^\s@<> ,;]+\.[^\s@<> ,;]+$/.test(value.trim()))) {
    return res.status(400).json({ success: false, error: "'to' must be an email address or an array of 1–50 email addresses" });
  }
  if (typeof subject !== "string" || !subject.trim() || subject.length > 998 || /[\r\n]/.test(subject)) {
    return res.status(400).json({ success: false, error: "'subject' must be non-empty text up to 998 characters without line breaks" });
  }
  if ((message !== undefined && typeof message !== "string") || (html !== undefined && typeof html !== "string") ||
    !(typeof message === "string" && message.trim()) && !(typeof html === "string" && html.trim())) {
    return res.status(400).json({ success: false, error: "Please provide either 'message' (text) or 'html' (HTML body) as non-empty text" });
  }

  const uniqueRecipients: string[] = [...new Set<string>(recipients.map((value: string) => value.trim()))];
  const results: { recipient: string; accepted: boolean; messageId?: string }[] = [];
  for (const recipient of uniqueRecipients) {
    try {
      const result = await sendEmail({ to: recipient, subject: subject.trim(), message, html });
      results.push({ recipient, accepted: true, messageId: result.MessageId });
    } catch (error) {
      console.error("SES send failed:", error);
      results.push({ recipient, accepted: false });
    }
  }
  const success = results.every(result => result.accepted);
  return res.status(success ? 200 : 502).json({
    success,
    message: success ? "Emails accepted for delivery" : "Some emails could not be submitted. Retry only recipients with accepted: false.",
    recipients: uniqueRecipients,
    subject: subject.trim(),
    results,
  });
}
