import assert from "node:assert/strict";
import { Request, Response } from "express";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { sendAutomateEmail } from "./email.controller";

async function main() {
  const commands: SendEmailCommand[] = [];
  const originalSend = SESClient.prototype.send;
  const originalError = console.error;
  (SESClient.prototype as any).send = async (command: SendEmailCommand) => {
    commands.push(command);
    if (command.input.Destination?.ToAddresses?.[0] === "fail@example.com") {
      throw new Error("Simulated rejection");
    }
    return { MessageId: `message-${commands.length}` };
  };
  const invoke = async (body: unknown) => {
    let status = 200;
    let json: any;
    const res = {
      status(value: number) { status = value; return this; },
      json(value: unknown) { json = value; return this; },
    };
    await sendAutomateEmail({ body } as Request, res as Response);
    return { status, json };
  };
  try {
    for (const body of [undefined, {}, { to: ["ok@example.com", "invalid"], subject: "Hi", message: "Test" },
      { to: "ok@example.com", subject: "Hi\r\nBcc: other@example.com", message: "Test" },
      { to: "ok@example.com", subject: "Hi", message: {} },
      { to: "ok@example.com", subject: "Hi", html: " " },
      { to: Array(51).fill("ok@example.com"), subject: "Hi", message: "Test" }]) {
      assert.equal((await invoke(body)).status, 400);
    }
    assert.equal(commands.length, 0, "Validate all recipients before sending anything");

    const text = await invoke({ to: [" ok@example.com ", "ok@example.com"], subject: "Hi", message: "Hello <Vision>" });
    assert.equal(text.status, 200);
    assert.equal(commands.length, 1);
    assert.equal(commands[0]!.input.Message?.Body?.Text?.Data, "Hello <Vision>");
    assert.equal(commands[0]!.input.Message?.Body?.Html, undefined);
    assert.equal(text.json.results[0].messageId, "message-1");

    await invoke({ to: "ok@example.com", subject: "Hi", html: "<p>Hello</p>", message: "Hello" });
    assert.equal(commands[1]!.input.Message?.Body?.Html?.Data, "<p>Hello</p>");
    assert.equal(commands[1]!.input.Message?.Body?.Text?.Data, "Hello");

    console.error = () => {};
    const partial = await invoke({ to: ["ok@example.com", "fail@example.com", "last@example.com"], subject: "Hi", message: "Hello" });
    assert.equal(partial.status, 502);
    assert.equal(partial.json.success, false);
    assert.deepEqual(partial.json.results.map((item: any) => item.accepted), [true, false, true]);
    assert.equal(partial.json.results[1].messageId, undefined);
    console.log("Email validation, SES payload, deduplication, and partial failure checks passed (no real emails sent).");
  } finally {
    SESClient.prototype.send = originalSend;
    console.error = originalError;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
