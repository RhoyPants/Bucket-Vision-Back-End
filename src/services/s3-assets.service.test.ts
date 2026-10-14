process.env.ASSETS_ENV = "dev";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildAssetUrl,
  buildObjectKey,
  deleteManagedAsset,
  fileKeyFromStoredValue,
  isManagedFileKey,
  parseAssetsEnvironment,
  validateUploadMetadata,
} = require("./s3-assets.service");

const metadata = validateUploadMetadata({
  fileName: "site photo.jpg",
  contentType: "image/jpeg",
  fileSize: 1024,
  category: "incidents",
  entityId: "INC-001",
});

test("builds development and production keys with mandatory prefixes", () => {
  assert.equal(
    buildObjectKey(metadata, "dev", 1728800000000, "uuid"),
    "dev/incidents/INC-001/1728800000000-uuid-site_photo.jpg",
  );
  assert.equal(
    buildObjectKey(metadata, "prod", 1728800000000, "uuid"),
    "prod/incidents/INC-001/1728800000000-uuid-site_photo.jpg",
  );
});

test("rejects missing and unexpected asset environments", () => {
  assert.throws(() => parseAssetsEnvironment(undefined), /ASSETS_ENV/);
  assert.throws(() => parseAssetsEnvironment("test123"), /ASSETS_ENV/);
  assert.equal(parseAssetsEnvironment(" DEV "), "dev");
  assert.equal(parseAssetsEnvironment("prod"), "prod");
});

test("recognizes prefixed and pre-prefix stored keys", () => {
  assert.equal(isManagedFileKey("dev/projects/P-1/file.pdf"), true);
  assert.equal(isManagedFileKey("prod/projects/P-1/file.pdf"), true);
  assert.equal(isManagedFileKey("projects/P-1/file.pdf"), true);
  assert.equal(fileKeyFromStoredValue("projects/P-1/file.pdf"), "projects/P-1/file.pdf");
  assert.equal(
    fileKeyFromStoredValue(buildAssetUrl("prod/projects/P-1/file.pdf")),
    "prod/projects/P-1/file.pdf",
  );
});

test("deletion skips external references and refuses cross-environment keys before S3", async () => {
  assert.equal(await deleteManagedAsset("https://example.sharepoint.com/file.jpg"), false);
  await assert.rejects(
    () => deleteManagedAsset("prod/progress/P-1/file.jpg"),
    /outside dev\/ environment/,
  );
});
