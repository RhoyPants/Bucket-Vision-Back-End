# Vision email API

`POST /api/emails/send` with `Content-Type: application/json`. No authentication or `Authorization` header is required.

```json
{
  "to": ["recipient@example.com"],
  "subject": "Vision notification",
  "message": "Your project has been updated."
}
```

`to` accepts a single email string or 1–50 email strings. Exact duplicate addresses are sent once. Supply `message` (plain text), `html`, or both. Plain text is sent as text, so characters such as `<` are preserved without becoming markup. Recipients receive separate messages.

HTTP 200 means SES accepted all messages for delivery; it does not confirm inbox delivery. The response contains `success`, `message`, `recipients`, `subject`, and `results` with each `recipient`, `accepted`, and SES `messageId`. HTTP 400 means invalid input, and 502 means one or more submissions failed. A 502 can include successful submissions: retry only entries with `accepted: false` to avoid repeating accepted messages. An ambiguous network failure can still lead to a duplicate on retry; this endpoint does not provide idempotency.

## Backend configuration

Optional environment variables (defaults shown):

```dotenv
AWS_SES_REGION=ap-southeast-1
AWS_SES_FROM_EMAIL=no-reply@globalvisionsinc.com.ph
```

The region falls back to `AWS_REGION` before the Singapore default. Credentials come from the AWS SDK default credential provider chain, such as the deployed server's IAM role or backend environment credentials. The principal needs `ses:SendEmail` permission for the sender identity. Keep AWS credentials on the backend; the frontend never supplies the sender or credentials.

The sender address or its domain must be verified in SES in the configured region. An account in the SES sandbox can send only to verified recipients or SES mailbox simulator addresses. Production access is needed for other recipients. An existing SES sender can be reused with authorized AWS credentials; a different AWS account requires SES sending authorization configuration.

The endpoint is public so integrations such as Item Master can submit custom emails without a Vision token. Existing callers may still send an `Authorization` header; this route does not validate it. Anyone who can reach the endpoint can submit email using the configured AWS sender, with spam and cost implications. Browser calls remain subject to the existing CORS origin allowlist; backend-to-backend calls do not require a CORS change. Other endpoints retain their existing authentication requirements.

It sends on request; scheduled or workflow-triggered notifications still require backend triggers calling `sendEmail` in `src/modules/email/email.service.ts`.

AWS requirements: https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html
