import assert from "node:assert/strict";
import prisma from "../../config/prisma";

// Exercise project creation without database or asset service calls.
process.env.ASSETS_ENV = "dev";
const { ProjectController } = require("./project.controller");

async function main() {
  const db = prisma as any;
  const originals = {
    findPin: db.pinMaster.findFirst,
    createProject: db.project.create,
    findProject: db.project.findUnique,
    createMember: db.projectMember.create,
  };
  let selectedPin: any = null;
  let created: any;
  let pinQuery: any;
  db.pinMaster.findFirst = async (query: any) => { pinQuery = query; return selectedPin; };
  db.project.create = async ({ data }: any) => { created = { id: "project-test", ...data }; return created; };
  db.project.findUnique = async () => created;
  db.projectMember.create = async () => ({});

  async function create(body: Record<string, unknown>) {
    created = undefined;
    pinQuery = undefined;
    const response: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
    };
    await ProjectController.create({ body, user: { id: "owner-test" } }, response);
    return response;
  }

  try {
    // A custom PIN missing from (or inactive in) the active master list is allowed.
    let response = await create({ name: "Custom project", pin: "CUSTOM-001", description: "Manual details" });
    assert.equal(response.statusCode, 200);
    assert.equal(created.pin, "CUSTOM-001");
    assert.equal(created.pinMasterId, undefined);
    assert.equal(created.name, "Custom project");
    assert.equal(created.description, "Manual details");

    // An explicitly selected missing/inactive master must still be rejected.
    response = await create({ name: "Project", pin: "MASTER-001", pinMasterId: "inactive-master" });
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /not available.*inactive/);
    assert.equal(Boolean(created), false);
    assert.deepEqual(pinQuery.where, { id: "inactive-master", isActive: true });

    selectedPin = { id: "active-master", pin: "MASTER-001", projectName: "Master project" };
    response = await create({ name: "Entered name", pin: "MASTER-001", pinMasterId: "active-master" });
    assert.equal(response.statusCode, 200);
    assert.equal(created.pinMasterId, "active-master");
    assert.equal(created.name, "Master project");

    // Preserve matching-by-PIN behavior for existing clients without a master ID.
    response = await create({ name: "Entered name", pin: "MASTER-001" });
    assert.equal(response.statusCode, 200);
    assert.equal(created.pinMasterId, "active-master");
    assert.deepEqual(pinQuery.where, { pin: "MASTER-001", isActive: true });

    selectedPin = null;
    response = await create({ name: "Project without PIN" });
    assert.equal(response.statusCode, 200);
    assert.equal(pinQuery, undefined);
    console.log("project PIN creation tests passed");
  } finally {
    db.pinMaster.findFirst = originals.findPin;
    db.project.create = originals.createProject;
    db.project.findUnique = originals.findProject;
    db.projectMember.create = originals.createMember;
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
