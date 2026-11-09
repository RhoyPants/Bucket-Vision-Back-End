import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

let client: SESClient | undefined;

export async function sendEmail(input: { to: string; subject: string; message?: string; html?: string }) {
  client ??= new SESClient({
    region: process.env.AWS_SES_REGION || process.env.AWS_REGION || "ap-southeast-1",
  });

  return client.send(new SendEmailCommand({
    Source: process.env.AWS_SES_FROM_EMAIL || "no-reply@globalvisionsinc.com.ph",
    Destination: { ToAddresses: [input.to] },
    Message: {
      Subject: { Data: input.subject, Charset: "UTF-8" },
      Body: {
        ...(input.message ? { Text: { Data: input.message, Charset: "UTF-8" } } : {}),
        ...(input.html ? { Html: { Data: input.html, Charset: "UTF-8" } } : {}),
      },
    },
  }));
}
