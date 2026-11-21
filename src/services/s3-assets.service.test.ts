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

test("discussion attachments are limited to 5 MB and keep the other upload rules", () => {
  const base = { fileName: "screenshot.png", contentType: "image/png", category: "discussions", entityId: "project-1" };
  assert.equal(validateUploadMetadata({ ...base, fileSize: 5 * 1024 * 1024 }).category, "discussions");
  assert.throws(() => validateUploadMetadata({ ...base, fileSize: 5 * 1024 * 1024 + 1 }), /5 MB/);
  assert.throws(() => validateUploadMetadata({ ...base, fileSize: 0 }), /fileSize/);
  assert.throws(() => validateUploadMetadata({ ...base, fileSize: 1024, contentType: "application/x-msdownload" }), /Unsupported contentType/);
  // PowerPoint is allowed (old and new format); archives and scripts are still not
  for (const contentType of ["application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]) {
    assert.equal(validateUploadMetadata({ ...base, fileName: "deck.pptx", contentType, fileSize: 1024 }).contentType, contentType);
  }
  for (const contentType of ["application/zip", "application/x-sh", "text/html", "application/javascript"]) {
    assert.throws(() => validateUploadMetadata({ ...base, contentType, fileSize: 1024 }), /Unsupported contentType/, contentType);
  }
  // other categories keep their larger limit
  assert.equal(validateUploadMetadata({ ...base, category: "projects", fileSize: 20 * 1024 * 1024 }).category, "projects");
  assert.equal(
    buildObjectKey(validateUploadMetadata({ ...base, fileSize: 10 }), "dev", 1728800000000, "uuid"),
    "dev/discussions/project-1/1728800000000-uuid-screenshot.png",
  );
});
